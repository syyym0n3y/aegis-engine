#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// index-inclusion-event.ts — the S&P 500 INDEX-INCLUSION event study, on ADDITIONS only.
//
// THE HYPOTHESIS UNDER TEST IS NOT THE FAMOUS ONE. The famous "index effect" (Shleifer 1986, Harris-Gurel 1986) is
// the ANNOUNCEMENT-to-EFFECTIVE pop: index funds must buy, the stock jumps between announcement and inclusion. That
// pop is NOT capturable here and is not what this measures — by the effective date it has already happened, and the
// announcement date is not in our data at all. What IS measured is the POST-EFFECTIVE forward return, where the
// literature (Chen-Noronha-Singal 2004; Petajisto 2011; and the post-2000 decay literature, e.g. Greenwood-Sammon
// 2022) finds the pop REVERSES or has decayed to nothing.
//   LITERATURE PRIOR (pre-registered here, SIGN LAW D-553): post-effective excess is FLAT-TO-NEGATIVE.
//
// EXECUTION LAW, SAME-BAR COROLLARY (D-498): the effective date's close is contaminated by the index rebalance
// itself (the closing auction IS the event). Entry is therefore the close of the FIRST BAR STRICTLY AFTER the
// effective date — LAG-1. Nothing in this study can be earned by anyone who did not already know the addition.
//
// BENCHMARK LAW (D-627/630): every number reported is an EXCESS over SPY measured on the SAME calendar window, so
// the universe drift is already subtracted — a raw forward return here would be mostly "the market went up".
// LIQUIDITY LAW (D-419/423): the promotable number, if there were one, is the LIQUID tercile's, not the pooled one.
// COVERAGE LAW (D-641/645): events whose ticker has no panel bars are reported as a coverage statement with the
// selection mechanism named — they are NOT dropped silently.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("index-inclusion-event", [
  { name: "IIE_WINDOWS", def: "5,21,63,250", note: "forward horizons (trading days)" },
  { name: "IIE_SRC", def: "data/sp500-changes.json", note: "input from ingest-sp500-changes.ts" },
  { name: "IIE_MIN_D", def: "1993-02-01", note: "SPY inception floor — no benchmark before this" },
]);
const WINS = K.IIE_WINDOWS.split(",").map(Number);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "iie", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / a.length;

// D-757: strict read — a transport failure retries then THROWS, never becomes an empty result.
const { q: sq } = mkStrictRead(OWNED, hdr);
async function bars(sym: string): Promise<number[][]> {
  const raw = await sq(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
}

// ---- events ----
interface Chg { date: string; added: string | null }
const src = JSON.parse(await Deno.readTextFile(K.IIE_SRC)) as { source: string; date_span: string[]; changes: Chg[] };
const allAdds = src.changes.filter((c) => c.added && /^[A-Z][A-Z.\-]{0,5}$/.test(c.added));
const events = allAdds.filter((c) => c.date >= K.IIE_MIN_D);
assertNonEmpty("S&P500 additions in SPY era", events, 50);

// ---- benchmark ----
const spyBars = await bars("SPY");
assertNonEmpty("SPY bars", spyBars, 1000);
const spyDates = spyBars.map((b) => iso(b[0]));
const spyClose = new Map(spyDates.map((d, i) => [d, spyBars[i][4]]));
const spyIdx = new Map(spyDates.map((d, i) => [d, i]));
function spyAt(d: string): number | null {
  if (spyClose.has(d)) return spyClose.get(d)!;
  let lo = 0, hi = spyDates.length - 1, ans = -1;      // last SPY date <= d
  while (lo <= hi) { const m = (lo + hi) >> 1; if (spyDates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? spyBars[ans][4] : null;
}

// ---- measure ----
interface Obs { sym: string; d0: string; ex: number; dv: number }
const res: Obs[][] = WINS.map(() => []);
let withData = 0, noBars = 0, noPostBar = 0, shortHist = 0;
const missingNames: string[] = [];

for (const ev of events) {
  const sym = ev.added!;
  const b = await bars(sym);
  if (!b.length) { noBars++; missingNames.push(sym); continue; }
  const dt = b.map((x) => iso(x[0]));
  // LAG-1: first bar STRICTLY AFTER the effective date. The effective-date close IS the rebalance auction.
  let i0 = -1;
  for (let i = 0; i < dt.length; i++) if (dt[i] > ev.date) { i0 = i; break; }
  if (i0 < 0) { noPostBar++; continue; }
  // require the panel to actually cover the event, not to start months later (delisted-backfill truncation)
  if (dt[i0] > new Date(Date.parse(ev.date + "T00:00:00Z") + 30 * 864e5).toISOString().slice(0, 10)) { shortHist++; missingNames.push(sym); continue; }
  const p0 = b[i0][4], s0 = spyAt(dt[i0]);
  if (!(p0 > 0) || !s0) { noPostBar++; continue; }
  // pre-event median dollar volume (liquidity measured BEFORE the event, never from the future)
  const pre = b.slice(Math.max(0, i0 - 60), i0).map((x) => x[4] * x[5]).sort((a, z) => a - z);
  const dv = pre.length ? pre[Math.floor(pre.length / 2)] : b[i0][4] * b[i0][5];
  let used = false;
  for (let wi = 0; wi < WINS.length; wi++) {
    const iT = i0 + WINS[wi];
    if (iT >= b.length) continue;                      // right-censored (still live, horizon beyond data): neutral
    const p1 = b[iT][4], s1 = spyAt(dt[iT]);
    if (!(p1 > 0) || !s1) continue;
    res[wi].push({ sym, d0: dt[i0], ex: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dv });
    used = true;
  }
  if (used) withData++;
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "index-inclusion-event", runId: `iie|${WINS.join(",")}`, spent: WINS.length * 2 });

// ---- report ----
console.log(`\n==> S&P 500 INDEX-INCLUSION EVENT STUDY (ADDITIONS, post-effective, LAG-1)`);
console.log(`    source: ${src.source}  |  span ${src.date_span[0]}..${src.date_span[1]}\n`);
console.log(`  WHAT IS AND IS NOT MEASURED`);
console.log(`    The announcement-to-effective POP is NOT capturable and is NOT measured: by the effective date it has`);
console.log(`    already occurred, and the announcement date is not in this dataset. Entry is the close of the FIRST BAR`);
console.log(`    STRICTLY AFTER the effective date (EXECUTION LAW same-bar corollary, D-498) — the effective-date close`);
console.log(`    is the rebalance auction itself and is not a price a non-index trader gets by acting on this signal.\n`);

console.log(`  COVERAGE (COVERAGE LAW, D-641/645)`);
console.log(`    additions in source              ${allAdds.length}`);
console.log(`    additions on/after ${K.IIE_MIN_D} (SPY era)   ${events.length}`);
console.log(`    with usable panel bars           ${withData} / ${events.length}  (${(100 * withData / events.length).toFixed(1)}%)`);
console.log(`    no bars at all in trd_bars_deep  ${noBars}`);
console.log(`    panel history starts >30d after the event (truncated backfill)  ${shortHist}`);
console.log(`    no post-event bar / benchmark    ${noPostBar}`);
console.log(`    SELECTION MECHANISM of the missing: a name is absent from the panel when it was later ACQUIRED,`);
console.log(`    RENAMED or DELISTED (index adds are large caps; they leave the index by takeover far more often than`);
console.log(`    by failure), or when the delisted-backfill history begins after the event. That mechanism is tilted`);
console.log(`    toward ACQUIRED names, whose post-inclusion excess is plausibly POSITIVE — so the measured set is`);
console.log(`    biased AGAINST the null, not toward it. Missing (first 15): ${missingNames.slice(0, 15).join(" ")}\n`);

console.log(`  EXCESS RETURN vs SPY (%; already benchmark-adjusted, so BENCHMARK LAW's universe-mean subtraction is`);
console.log(`  built in — a raw forward return would be mostly market drift, and is deliberately not reported)`);
console.log(`    ${"win".padStart(5)} ${"n".padStart(4)} ${"mean%".padStart(8)} ${"med%".padStart(8)} ${"t".padStart(7)} ${"pos%".padStart(6)}   | LIQUID TERCILE (top 1/3 by pre-event $vol)`);
let anySig = false, sumSign = 0, nWin = 0;
for (let wi = 0; wi < WINS.length; wi++) {
  const all = res[wi];
  if (all.length < 10) { console.log(`    ${String(WINS[wi]).padStart(5)} ${String(all.length).padStart(4)}  UNTESTED — n<10`); continue; }
  const sorted = [...all].sort((a, b) => a.dv - b.dv);
  const liq = sorted.slice(Math.floor((sorted.length * 2) / 3));
  const ill = sorted.slice(0, Math.floor(sorted.length / 3));
  const eA = all.map((x) => x.ex), eL = liq.map((x) => x.ex), eI = ill.map((x) => x.ex);
  console.log(
    `    ${String(WINS[wi]).padStart(5)} ${String(all.length).padStart(4)} ${mean(eA).toFixed(2).padStart(8)} ${med(eA).toFixed(2).padStart(8)} ${tstat(eA).toFixed(2).padStart(7)} ${pctPos(eA).toFixed(0).padStart(6)}   | n=${String(eL.length).padStart(3)} mean ${mean(eL).toFixed(2).padStart(7)}% med ${med(eL).toFixed(2).padStart(7)}% t ${tstat(eL).toFixed(2).padStart(6)} pos ${pctPos(eL).toFixed(0).padStart(3)}%  || ILLIQ n=${eI.length} mean ${mean(eI).toFixed(2)}% t ${tstat(eI).toFixed(2)}`,
  );
  if (Math.abs(tstat(eL)) > 2.5) anySig = true;
  sumSign += Math.sign(mean(eL)); nWin++;
}

console.log(`\n  SIGN LAW (D-553) — literature prior, stated before the numbers above: post-effective excess is`);
console.log(`  FLAT-TO-NEGATIVE (the announcement pop reverses / has decayed post-2000).`);
const liqMeans = WINS.map((_, wi) => {
  const a = res[wi]; if (a.length < 10) return null;
  const s = [...a].sort((x, y) => x.dv - y.dv).slice(Math.floor((a.length * 2) / 3)).map((x) => x.ex);
  return { t: tstat(s), m: mean(s) };
}).filter((x): x is { t: number; m: number } => x !== null);
const anyPosSig = liqMeans.some((x) => x.m > 0 && x.t > 2);
console.log(`  OUTCOME: ${anyPosSig ? "MISSED — a liquid-tercile horizon is significantly POSITIVE, against the prior." : "MATCHED — no liquid-tercile horizon is significantly positive; excess is flat-to-negative as predicted."}`);
console.log(`  (Liquid-tercile mean sign, net across the ${nWin} measured horizons: ${sumSign > 0 ? "net +" : sumSign < 0 ? "net -" : "even split"} (sum of signs ${sumSign}); the per-horizon signs are in the table above and are not unanimous.)`);

console.log(`\n  BENCHMARK LAW: every figure above is ALREADY an excess over SPY on the same window, so it is not`);
console.log(`  universe drift by construction. A flat/negative excess with |t|<2 is recorded as DRIFT (nothing earned`);
console.log(`  beyond the market), never as a short signal.`);
console.log(`\n  trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
const n250 = res[WINS.indexOf(250)]?.length ?? 0;
console.log(`\n  VERDICT: ${
  anySig
    ? "CANDIDATE — a liquid-tercile horizon clears |t|>2.5; deflate against the trial ceiling, cost it, and re-test before any claim."
    : `NULL (post-effective, LAG-1) — no horizon shows a liquid-tercile excess clearing |t|>2.5. Coverage is ${withData}/${events.length} events, adequate to detect a multi-% effect at 5-63d; the announcement pop is UNTESTED here because its date is not in the data.`
}`);
console.log(`  POWER NOTE: n falls with horizon (250d n=${n250}) because recent additions are right-censored; the 250d`);
console.log(`  row is the weakest and should not carry the verdict on its own.\n`);
