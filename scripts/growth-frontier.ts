// D-906 — the unlevered growth frontier: what is the highest GEOMETRIC growth an account that cannot borrow can hold?
// D-905 corrected the ladder to 149 years at the timed book's holdable size, and D-904 showed a passive basket of the
// same assets beats it because geometric growth, not Sharpe, sets time-to-target once leverage is unavailable. So the
// ladder's real question is a maximisation over HOLDABLE ASSETS, not over signals.
// THE SELECTION LAW GOVERNS THIS SCRIPT. Ranking instruments over the full window and quoting the winner is an
// in-sample maximum, which is D-455's exact failure. The pick is made on TRAIN ONLY, frozen, and measured on TEST, and
// the ex-post best is reported beside it so the gap between them is visible rather than hidden.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("growth-frontier", [
  { name: "TRAIN_TO", def: "2015-12-31", note: "fixed in advance in the D-906 registration, before any instrument was ranked" },
  { name: "FROM", def: "2005-01-01" }, { name: "RF", def: "0.04" }, { name: "MIN_BARS", def: "2500" },
  { name: "TARGET_X", def: "100000" }, { name: "DD_FLOOR", def: "-0.50", note: "worse than this is NOT HOLDABLE whatever its growth (D-565)" },
  { name: "RUN_ID", def: "D-906-unlevered-growth-frontier" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const M = Math.log(+K.TARGET_X), RF = +K.RF;
// the ISA-holdable set: the same regex tsmom-book uses for its long-only universe, so "holdable" means the same thing
const HOLDABLE = /^(SPY|QQQ|DIA|IWM|IWF|IWD|EFA|EEM|EWJ|EWZ|FXI|VGK|TLT|IEF|SHY|LQD|HYG|GLD|SLV|SMH|VNQ|XBI|MTUM|QUAL|VLUE|SIZE|USMV|QYLD|PBP|TIP|JNK|GDX|USD|UUP|NEAR|JETS)$/;
const meta = (await q(`trd_bars_deep?asset_class=in.(etf,sector,index)&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((m) => HOLDABLE.test(m.symbol) && m.n_bars >= +K.MIN_BARS);
assertNonEmpty("holdable instruments with enough history", meta, 10);
type Row = { sym: string; gTr: number; gTe: number; ddTe: number; uwTe: number; nTe: number };
const rows: Row[] = [];
const fromS = Date.parse(K.FROM + "T00:00:00Z") / 1000, splitS = Date.parse(K.TRAIN_TO + "T23:59:59Z") / 1000;
const stat = (r: number[]) => { if (r.length < 200) return null; const mu = mean(r) * 252, vol = sd(r) * Math.sqrt(252);
  let eq = 0, peak = 0, mdd = 0, uw = 0, mx = 0; for (const v of r) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; mx = Math.max(mx, uw); } mdd = Math.min(mdd, eq - peak); }
  return { g: RF + mu - vol * vol / 2, mu, vol, dd: Math.exp(mdd) - 1, uw: mx / 252 }; };
for (const m of meta) {
  const r = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(m.symbol)}&select=bars`) as { bars: number[][] }[])[0];
  const bars = ((r?.bars ?? []) as number[][]).filter((b) => b[4] > 0 && b[0] >= fromS).sort((a, b) => a[0] - b[0]);
  if (bars.length < +K.MIN_BARS) continue;
  const tr: number[] = [], te: number[] = [];
  for (let i = 1; i < bars.length; i++) { const x = Math.log(bars[i][4] / bars[i - 1][4]) - RF / 252; (bars[i][0] <= splitS ? tr : te).push(x); }
  const A = stat(tr), B = stat(te); if (!A || !B) continue;
  rows.push({ sym: m.symbol, gTr: A.g, gTe: B.g, ddTe: B.dd, uwTe: B.uw, nTe: te.length });
}
assertNonEmpty("instruments with both a train and a test leg", rows, 10);
const yrs = (g: number) => g > 0 ? M / g : Infinity;
console.log(`==> D-906 UNLEVERED GROWTH FRONTIER — ${rows.length} ISA-holdable instruments, train ${K.FROM}..${K.TRAIN_TO}, test ${K.TRAIN_TO}..now`);
console.log(`  Time-to-target is set by GEOMETRIC growth alone once leverage is unavailable (D-897/905). Sharpe is not the`);
console.log(`  objective here. Target ${(+K.TARGET_X).toLocaleString("en-US")}x. Drawdown and time underwater are reported beside every growth figure,`);
console.log(`  and anything worse than ${(100 * +K.DD_FLOOR).toFixed(0)}% drawdown is NOT HOLDABLE whatever its growth (D-565).\n`);
const byTr = [...rows].sort((a, b) => b.gTr - a.gTr), byTe = [...rows].sort((a, b) => b.gTe - a.gTe);
const pick = byTr[0];
console.log(`  ${"rank".padStart(4)} ${"TRAIN-chosen".padEnd(13)} ${"g(train)".padStart(9)} ${"g(TEST)".padStart(8)} ${"yrs(TEST)".padStart(10)} ${"maxDD".padStart(7)} ${"uw".padStart(6)}   |  ${"ex-post best on TEST".padEnd(21)} ${"g".padStart(7)} ${"yrs".padStart(6)}`);
for (let i = 0; i < 8; i++) {
  const a = byTr[i], b = byTe[i]; if (!a || !b) break;
  console.log(`  ${String(i + 1).padStart(4)} ${a.sym.padEnd(13)} ${(100 * a.gTr).toFixed(1).padStart(8)}% ${(100 * a.gTe).toFixed(1).padStart(7)}% ${(yrs(a.gTe) === Infinity ? "never" : yrs(a.gTe).toFixed(0) + "y").padStart(10)} ${(100 * a.ddTe).toFixed(0).padStart(6)}% ${a.uwTe.toFixed(1).padStart(5)}y   |  ${b.sym.padEnd(21)} ${(100 * b.gTe).toFixed(1).padStart(6)}% ${(yrs(b.gTe) === Infinity ? "never" : yrs(b.gTe).toFixed(0) + "y").padStart(6)}`);
}
const holdable = pick.ddTe > +K.DD_FLOOR;
await spendTrials({ rest: OWNED, headers: hdr, family: "growth-frontier", runId: K.RUN_ID, spent: rows.length });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  TRAIN-CHOSEN PICK: ${pick.sym} — g(test) ${(100 * pick.gTe).toFixed(1)}%/yr, ${yrs(pick.gTe) === Infinity ? "never" : yrs(pick.gTe).toFixed(0) + "y"} to target, maxDD ${(100 * pick.ddTe).toFixed(0)}%, underwater ${pick.uwTe.toFixed(1)}y — ${holdable ? "holdable" : "NOT HOLDABLE by the -50% clause"}`);
console.log(`  EX-POST BEST ON TEST: ${byTe[0].sym} at ${(100 * byTe[0].gTe).toFixed(1)}%/yr — the gap between this and the train-chosen pick is the SELECTION cost, and it is the number that says whether the frontier is real or hindsight.`);
console.log(`  ${rows.length} instruments counted; ceiling ${ceil.ceiling.toFixed(2)}.`);
console.log(`  SURVIVORSHIP: this panel holds instruments that EXIST TODAY, so the frontier is biased UPWARD by every fund that closed. The bias is stated, not corrected — this record cannot reconstruct the dead-ETF universe.`);
