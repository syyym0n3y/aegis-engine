#!/usr/bin/env -S deno run --allow-net --allow-env
// net-share-issuance.ts (D-648) — PREREG D-648-net-share-issuance.
//
// WHY THIS EXISTS. Auditing THE COVERAGE LAW's founding complaint ("five of hundreds of available EDGAR concepts")
// showed the gap is substantially closed: 14 of 15 documented factor inputs are held. The one absent was SHARE
// ISSUANCE — and the data turned out to be present all along under a dei tag rather than a us-gaap one, 69,086
// observations across 6,151 filers. An unfetched free dataset is a research failure; a fetched dataset nobody
// queried is the same failure wearing a better disguise.
//
// Net stock issues is among the most replicated accounting anomalies (Pontiff-Woodgate 2008; Daniel-Titman 2006).
// Firms that issue underperform; firms that repurchase outperform.
//
// EVERY LAW BUILT IN FROM THE START, not bolted on after a result:
//   THE BENCHMARK LAW (D-636)  — universe mean and excess reported beside the spread, because a spread over a flat
//     cross-section can be precisely estimated and worth nothing (D-630: t -7.37 headline, t -0.46 excess).
//   THE LIQUIDITY LAW (D-424)  — both halves measured directly, never one and inferred (D-633: the illiquid half of
//     the fails book carried the WRONG SIGN, which subtraction would never have revealed).
//   THE UNIVERSE LAW (D-535, extended D-645/646) — coverage stated beside breadth.
//   PSEUDO-REPLICATION (D-612) — t computed on the QUARTERLY PORTFOLIO series, never across events.
//   THE POSITIVE-CONTROL RULE (D-641) — every zero-shaped finding carries a control that must be non-zero.
//   SPLITS (pre-registered kill clause) — a share count jumping 3:1 is a corporate action, not issuance, and would
//     otherwise dominate the ranking entirely.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("net-share-issuance", [
  { name: "LOOKBACK_Q", def: "4", note: "quarters over which issuance is measured (~1 year)" },
  { name: "HOLD_D", def: "63", note: "sessions held, ~one quarter" },
  { name: "LAG_D", def: "90", note: "days after period_end before the filing is public" },
  { name: "COST_BP", def: "20" },
  { name: "QUINTILES", def: "5" },
  { name: "MIN_NAMES", def: "200", note: "per rebalance; the pre-registered floor" },
  { name: "SPLIT_CAP", def: "0.40", note: "|share change| beyond this in one step = corporate action, EXCLUDED" },
  { name: "LIQ_HALF", def: "", note: "hi | lo — measure a liquidity half directly" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "nsi", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const plus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const LB = Number(K.LOOKBACK_Q), HOLD = Number(K.HOLD_D), LAG = Number(K.LAG_D);
const COST = Number(K.COST_BP) / 1e4, Q = Number(K.QUINTILES), MINN = Number(K.MIN_NAMES);
const SPLIT = Number(K.SPLIT_CAP);

// ---- share counts ----
interface Obs { ticker: string; period: string; shares: number }
const raw: Obs[] = [];
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker,period_end,value&order=period_end&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { ticker: string; period_end: string; value: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) { const v = Number(r.value); if (r.ticker && v > 0) raw.push({ ticker: r.ticker, period: r.period_end, shares: v }); }
  if (rows.length < 50000) break;
}
assertNonEmpty("share-count observations", raw, 10000);

const bySym = new Map<string, Obs[]>();
for (const o of raw) (bySym.get(o.ticker) ?? bySym.set(o.ticker, []).get(o.ticker)!).push(o);
for (const arr of bySym.values()) arr.sort((a, b) => a.period < b.period ? -1 : 1);

// ---- issuance, with corporate actions removed ----
interface Sig { ticker: string; pubD: string; iss: number }
const sigs: Sig[] = [];
let splitsDropped = 0;
for (const [ticker, arr] of bySym) {
  for (let i = LB; i < arr.length; i++) {
    const a = arr[i - LB].shares, b = arr[i].shares;
    if (!(a > 0) || !(b > 0)) continue;
    // A split multiplies the count without issuing economic claims. Any single STEP beyond the cap disqualifies the
    // window — checked step-by-step rather than end-to-end, because a 3:1 split followed by drift can leave the
    // endpoints looking innocent.
    let corporateAction = false;
    for (let j = i - LB + 1; j <= i; j++) {
      const prev = arr[j - 1].shares, cur = arr[j].shares;
      if (prev > 0 && Math.abs(cur / prev - 1) > SPLIT) { corporateAction = true; break; }
    }
    if (corporateAction) { splitsDropped++; continue; }
    sigs.push({ ticker, pubD: plus(arr[i].period, LAG), iss: b / a - 1 });
  }
}
assertNonEmpty("issuance signals after removing corporate actions", sigs, 5000);
console.log(`==> NET SHARE ISSUANCE — PREREG D-648-net-share-issuance`);
console.log(`    ${raw.length.toLocaleString()} share observations, ${bySym.size.toLocaleString()} tickers`);
console.log(`    ${sigs.length.toLocaleString()} usable ${LB}-quarter issuance signals | ${splitsDropped.toLocaleString()} windows dropped as corporate actions (|step| > ${(100 * SPLIT).toFixed(0)}%)`);

// ---- prices ----
const need = [...new Set(sigs.map((s) => s.ticker))];
const px = new Map<string, { d: string[]; c: number[]; v: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = r.bars as (number | string)[][]; if (!Array.isArray(b) || b.length < 300) continue;
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (const x of b) {
      const dd = typeof x[0] === "string" ? String(x[0]).slice(0, 10) : new Date(Number(x[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(x[4]), vv = Number(x[5]) || 0;
      if (cc > 0) { d.push(dd); c.push(cc); v.push(vv * cc); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c, v });
  }
}
assertNonEmpty("priced tickers", [...px.keys()], 200);
// UNIVERSE COVERAGE (THE UNIVERSE LAW as extended D-645/646) — stated beside breadth, not instead of it.
console.log(`    UNIVERSE COVERAGE: ${px.size.toLocaleString()} priced of ${need.length.toLocaleString()} signalled tickers = ${(100 * px.size / need.length).toFixed(1)}%`);

const idxAt = (arr: string[], d: string) => { let lo = 0, hi = arr.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= d) { at = m; lo = m + 1; } else hi = m - 1; } return at; };

// ---- quarterly portfolio series ----
const byQ = new Map<string, Sig[]>();
for (const s of sigs) { const q = s.pubD.slice(0, 7); (byQ.get(q) ?? byQ.set(q, []).get(q)!).push(s); }

const spread: number[] = [], hiRaw: number[] = [], uniRaw: number[] = [], excess: number[] = [];
const qRet: number[][] = Array.from({ length: Q }, () => []);
let breadth = 0, periods = 0, hiNeg = 0;

for (const [, group] of [...byQ.entries()].sort()) {
  const seen = new Set<string>();
  let rows: { sig: number; ret: number; dv: number }[] = [];
  for (const s of group) {
    if (seen.has(s.ticker)) continue; seen.add(s.ticker);
    const p = px.get(s.ticker); if (!p) continue;
    const i0 = idxAt(p.d, s.pubD), i1 = i0 + HOLD;
    if (i0 < 20 || i1 >= p.d.length) continue;
    const r = p.c[i1] / p.c[i0] - 1;
    if (!Number.isFinite(r) || Math.abs(r) > 3) continue;
    rows.push({ sig: s.iss, ret: r, dv: mean(p.v.slice(Math.max(0, i0 - 20), i0)) });
  }
  if (K.LIQ_HALF === "hi" || K.LIQ_HALF === "lo") {
    const med = [...rows.map((x) => x.dv)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    rows = K.LIQ_HALF === "hi" ? rows.filter((x) => x.dv >= med) : rows.filter((x) => x.dv < med);
  }
  if (rows.length < MINN) continue;
  rows.sort((a, b) => a.sig - b.sig);                     // ascending: q0 = LOWEST issuance (buybacks)
  const per = Math.floor(rows.length / Q); if (per < 20) continue;
  for (let q = 0; q < Q; q++) qRet[q].push(mean(rows.slice(q * per, (q + 1) * per).map((x) => x.ret)));
  const lo = mean(rows.slice(0, per).map((x) => x.ret));
  const hi = mean(rows.slice(-per).map((x) => x.ret));
  const uni = mean(rows.map((x) => x.ret));
  spread.push(lo - hi - 2 * COST); hiRaw.push(hi); uniRaw.push(uni); excess.push(hi - uni);
  if (hi < 0) hiNeg++;
  breadth += rows.length; periods++;
}
assertNonEmpty("rebalance periods", spread, 20);

const perYr = 252 / HOLD;
const pct = (a: number[]) => (mean(a) * perYr * 100).toFixed(2);
console.log(`\n    ${periods} rebalances of ${HOLD} sessions | mean breadth ${(breadth / periods).toFixed(0)} names${K.LIQ_HALF ? ` | ${K.LIQ_HALF === "hi" ? "LIQUID" : "ILLIQUID"} HALF` : ""}`);
console.log(`    quintile mean ${HOLD}-session return, q0 = LOWEST issuance (buybacks) -> q${Q - 1} = HIGHEST (issuers):`);
for (let q = 0; q < Q; q++) console.log(`      q${q}  ${(mean(qRet[q]) * 100).toFixed(3)}%`);
const monotone = qRet.every((_, q) => q === 0 || mean(qRet[q]) <= mean(qRet[q - 1]));
console.log(`    monotone DECREASING in issuance (the prediction): ${monotone ? "YES" : "NO"}`);

console.log(`\n    ABSOLUTE DIAGNOSTIC (THE BENCHMARK LAW):`);
console.log(`      universe mean            ${(mean(uniRaw) * 100).toFixed(3)}% per ${HOLD} sessions`);
console.log(`      HIGH-issuance bucket raw ${(mean(hiRaw) * 100).toFixed(3)}%   negative in ${hiNeg}/${periods} periods (${(100 * hiNeg / periods).toFixed(0)}%)`);
console.log(`      HIGH-issuance EXCESS     ${(mean(excess) * 100).toFixed(3)}%   t ${tstat(excess).toFixed(2)}`);

const tSpread = tstat(spread);
console.log(`\n    BOOK long-low-issuance / short-high-issuance: ${pct(spread)}%/yr  PORTFOLIO t ${tSpread.toFixed(2)}`);

const g1 = tSpread >= 2.0;                     // long-low/short-high is POSITIVE if issuers underperform
const g2 = breadth / periods >= 200;
const g3 = hiNeg / periods > 0.5;
console.log(`\n    PRE-REGISTERED GATES:`);
console.log(`      (1) spread t >= 2.0 (issuers underperform) ... ${g1 ? "PASS" : "FAIL"}  (${tSpread.toFixed(2)})`);
console.log(`      (2) mean breadth >= 200 .................... ${g2 ? "PASS" : "FAIL"}  (${(breadth / periods).toFixed(0)})`);
console.log(`      (3) high bucket negative in >50% periods ... ${g3 ? "PASS" : "FAIL"}  (${(100 * hiNeg / periods).toFixed(0)}%)`);
console.log(`      (4) liquid half — run with LIQ_HALF=hi`);
console.log(`\n    ${!g2 ? `UNTESTED on breadth (${(breadth / periods).toFixed(0)} < 200) — a statement about our panel, not the market.`
  : !g1 ? `NOT SUPPORTED — spread t ${tSpread.toFixed(2)} does not reach 2.0.`
  : !g3 ? "RELATIVE ONLY — the high-issuance bucket does not fall, it rises more slowly. Pre-registered kill fires."
  : "SUPPORTED so far — run LIQ_HALF=hi and lo before believing it."}`);

await stampDataVersion(OWNED, hdr, { trd_fundamentals: "period_end", trd_bars_deep: "updated_at" });
