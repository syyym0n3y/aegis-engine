#!/usr/bin/env -S deno run --allow-net --allow-env
// noa-factor.ts (W2) — net operating assets, the LAST of the four gaps THE COVERAGE LAW was written about.
//
// The law's origin: "accruals, cash-flow-to-price, gross profitability and NOA were never tested because their
// inputs were never fetched, and that absence was narrated as a market property." Three are now closed — accruals
// (31 specs), gross profitability (31), cash-flow-to-price (cfo_yield). NOA sat at ZERO specs while its inputs had
// quietly become available.
//
// A COVERAGE NOTE WORTH KEEPING: the strict five-line-item construction (Assets, Cash, Liabilities, DebtCurrent,
// LongTermDebt) intersects to only 405 filers — below the pre-registered 500 floor, which would have made this
// UNTESTED. The algebraically equivalent form NOA = StockholdersEquity + TotalDebt - Cash needs fewer line items
// and yields a median 960 filers per quarter. The same quantity, computed differently, crosses the threshold. A
// coverage verdict is a property of the CONSTRUCTION as much as of the data.
//
// PRE-REGISTERED as W2-noa. Hirshleifer-Hou-Teoh-Zhang: high NOA (balance-sheet bloat) predicts LOW returns.
// Scaled by total assets, which is the standard normalisation.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("noa-factor", [
  { name: "QUINTILES", def: "5" },
  { name: "HOLD_D", def: "63", note: "sessions held, ~one quarter" },
  { name: "LAG_D", def: "90", note: "days after period_end before the filing is public — conservative" },
  { name: "COST_BP", def: "20" },
  { name: "MIN_NAMES", def: "200", note: "per rebalance" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "noa", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const plus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const CONCEPTS = ["StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebtNoncurrent", "DebtCurrent", "Assets"];
interface Fund { ticker: string; period: string; eq?: number; cash?: number; ltd?: number; cd?: number; assets?: number }
const fund = new Map<string, Fund>();   // key: cik|period
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_fundamentals?concept=in.(${CONCEPTS.map((c) => `"${c}"`).join(",")})&select=cik,ticker,concept,period_end,value&order=period_end&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { cik: string; ticker: string; concept: string; period_end: string; value: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    if (!r.ticker) continue;
    const key = `${r.cik}|${r.period_end}`;
    const e = fund.get(key) ?? fund.set(key, { ticker: r.ticker, period: r.period_end }).get(key)!;
    const v = Number(r.value); if (!Number.isFinite(v)) continue;
    if (r.concept === "StockholdersEquity") e.eq = v;
    else if (r.concept === "CashAndCashEquivalentsAtCarryingValue") e.cash = v;
    else if (r.concept === "LongTermDebtNoncurrent") e.ltd = v;
    else if (r.concept === "DebtCurrent") e.cd = v;
    else if (r.concept === "Assets") e.assets = v;
  }
  if (rows.length < 50000) break;
}
assertNonEmpty("filer-periods loaded", [...fund.keys()], 5000);

// NOA = StockholdersEquity + TotalDebt - Cash, scaled by Assets. A missing debt component is treated as zero only
// when the OTHER is present, so a filer with neither is excluded rather than silently scored as debt-free.
interface Obs { ticker: string; pubD: string; noa: number }
const obs: Obs[] = [];
for (const f of fund.values()) {
  if (f.eq === undefined || f.cash === undefined || f.assets === undefined) continue;
  if (f.ltd === undefined && f.cd === undefined) continue;
  if (!(f.assets > 0)) continue;
  const debt = (f.ltd ?? 0) + (f.cd ?? 0);
  obs.push({ ticker: f.ticker, pubD: plus(f.period, Number(K.LAG_D)), noa: (f.eq + debt - f.cash) / f.assets });
}
assertNonEmpty("NOA observations", obs, 5000);

const need = [...new Set(obs.map((o) => o.ticker))];
const px = new Map<string, { d: string[]; c: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
    const d: string[] = [], c: number[] = [];
    for (const b of raw) {
      const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(b[4]); if (cc > 0) { d.push(dd); c.push(cc); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c });
  }
}
assertNonEmpty("priced tickers", [...px.keys()], 200);

const HOLD = Number(K.HOLD_D), Q = Number(K.QUINTILES), COST = Number(K.COST_BP) / 1e4, MINN = Number(K.MIN_NAMES);
const idxAt = (s: string, d: string) => { const p = px.get(s)!; let lo = 0, hi = p.d.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { at = m; lo = m + 1; } else hi = m - 1; } return at; };

const byQ = new Map<string, Obs[]>();
for (const o of obs) { const q = o.pubD.slice(0, 7); (byQ.get(q) ?? byQ.set(q, []).get(q)!).push(o); }

const periodRets: number[] = [];
const qRets: number[][] = Array.from({ length: Q }, () => []);
let breadth = 0, periods = 0;
for (const [, group] of [...byQ.entries()].sort()) {
  const cands: { sig: number; ret: number }[] = [];
  const seen = new Set<string>();
  for (const o of group) {
    if (seen.has(o.ticker)) continue; seen.add(o.ticker);
    const p = px.get(o.ticker); if (!p) continue;
    const i0 = idxAt(o.ticker, o.pubD), i1 = i0 + HOLD;
    if (i0 < 20 || i1 >= p.d.length) continue;
    const r = p.c[i1] / p.c[i0] - 1;
    if (!Number.isFinite(r) || Math.abs(r) > 3) continue;
    cands.push({ sig: o.noa, ret: r });
  }
  if (cands.length < MINN) continue;
  cands.sort((a, b) => a.sig - b.sig);          // ascending: q0 = LOWEST NOA
  const per = Math.floor(cands.length / Q); if (per < 20) continue;
  for (let q = 0; q < Q; q++) qRets[q].push(mean(cands.slice(q * per, (q + 1) * per).map((x) => x.ret)));
  // Pre-registered direction: HIGH NOA underperforms, so the book is LONG LOW / SHORT HIGH.
  periodRets.push(mean(cands.slice(0, per).map((x) => x.ret)) - mean(cands.slice(-per).map((x) => x.ret)) - 2 * COST);
  breadth += cands.length; periods++;
}
assertNonEmpty("rebalance periods", periodRets, 20);

const m = mean(periodRets), s2 = sd(periodRets) || 1e-12;
const tPort = m / (s2 / Math.sqrt(periodRets.length));
const perYr = 252 / HOLD;
console.log(`\n==> NOA (net operating assets / total assets) — the last COVERAGE LAW gap`);
console.log(`    ${periodRets.length} rebalances of ${HOLD} sessions, mean breadth ${(breadth / periods).toFixed(0)} names, ${K.LAG_D}d publication lag`);
console.log(`    quintile mean ${HOLD}-session return, q0 = LOWEST NOA -> q${Q - 1} = HIGHEST:`);
for (let q = 0; q < Q; q++) console.log(`      q${q}  ${(mean(qRets[q]) * 100).toFixed(3)}%`);
const monotone = qRets.every((_, q) => q === 0 || mean(qRets[q]) <= mean(qRets[q - 1]));
console.log(`    monotone DECREASING in NOA (the prediction): ${monotone ? "YES" : "NO"}`);
console.log(`\n    BOOK long-low-NOA / short-high-NOA: ${(m * perYr * 100).toFixed(2)}%/yr  PORTFOLIO t ${tPort.toFixed(2)}`);
const supported = tPort >= 2.0 && monotone;
console.log(`\n    ${supported ? "SUPPORTED — high NOA underperforms, as Hirshleifer et al predict."
  : tPort <= -2.0 ? "SIGN MISS — high NOA OUTperforms, opposite to the documented prior."
  : `NOT SUPPORTED — portfolio |t| ${Math.abs(tPort).toFixed(2)}${monotone ? "" : ", and not monotone"}.`}`);
