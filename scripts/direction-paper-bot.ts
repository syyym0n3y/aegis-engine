// Paper bot for clock fwd-direction-4h-xrp-bnb-makerin-takerout (D-890/891).
// Runs hourly. Refits the D-881 model on the trailing TRAIN_D days of live hourly bars, predicts the latest CLOSED bar,
// and keeps a paper book with a 4-hour hold: a maker entry at the next open, a TAKER exit four hours later. The taker
// exit is not a convenience — D-891 measured that a passive exit converts a bounded gain into an unbounded loss tail,
// so this book pays to get out, by design, and the clock's kill_if watches the ENTRY fill rate instead.
// NO BROKER PATH. Paper only. Claude never executes.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("direction-paper-bot", [
  { name: "SYMBOLS", def: "XRPUSDT,BNBUSDT", note: "the two names the clock registers; not a tunable" },
  { name: "TRAIN_D", def: "180" }, { name: "H", def: "4" }, { name: "P_HI", def: "0.55" }, { name: "LAMBDA", def: "1.0" },
  { name: "MAKER_BP", def: "2" }, { name: "TAKER_BP", def: "5" , note: "Binance USDT-M VIP0 legs; round trip 7bp" },
  { name: "LEDGER", def: "data/direction-paper-ledger.json" },
  { name: "CLOCK", def: "fwd-direction-4h-xrp-bnb-makerin-takerout" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dpb", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const NF = 17;
function features(b: number[][], i: number): number[] | null {
  if (i < 48) return null;
  const r = (n: number) => Math.log(b[i][4] / b[i - n][4]);
  const lr: number[] = []; for (let k = i - 47; k <= i; k++) lr.push(Math.log(b[k][4] / b[k - 1][4]));
  const v = (n: number) => sd(lr.slice(48 - n));
  const rng = b[i][2] > b[i][3] ? (b[i][4] - b[i][3]) / (b[i][2] - b[i][3]) : 0.5;
  const vols = b.slice(i - 24, i).map((x) => x[5]); const vz = sd(vols) > 0 ? (b[i][5] - mean(vols)) / sd(vols) : 0;
  const tb = b[i][5] > 0 && b[i][7] ? b[i][7] / b[i][5] - 0.5 : 0;
  const hr = new Date(b[i][0] * 1000).getUTCHours(), dw = new Date(b[i][0] * 1000).getUTCDay();
  const hb = new Array(8).fill(0); hb[Math.floor(hr / 3)] = 1;
  return [r(1), r(2), r(3), r(6), r(12), r(24), v(12), v(48), rng, vz, tb, ...hb.slice(0, 6)];
}
// Features are standardised on the TRAINING window and the same mu/sg are applied at predict time — exactly as
// scripts/direction-model.ts does. The first version of this bot omitted it and every probability saturated at 0 or 1,
// which would have produced a confident signal from an unfitted model. Raw log-returns and volatilities differ by
// orders of magnitude, so an unscaled ridge is not a milder version of the model, it is a different one.
type Model = { w: number[]; mu: number[]; sg: number[] };
// Standardise on the TRAINING window and apply the same mu/sg at predict time. This is the SAME optimiser as
// scripts/direction-model.ts on purpose: two earlier versions of this bot diverged — first with no standardisation at
// all, then with a diagonal-Newton step that overshoots on correlated features — and both printed probabilities
// saturated at 0.0000 and 1.0000, i.e. a maximally confident signal from an unfitted model. A paper bot whose optimiser
// differs from the backtest's is not testing the backtest (D-860: a backtest that does not match the bot is not a
// backtest of the bot), so the research implementation is mirrored rather than re-derived.
function fit(X: number[][], y: number[], lambda: number): Model {
  const p = X[0].length, n = X.length; const mu = Array(p).fill(0), sg = Array(p).fill(1);
  for (let j = 0; j < p; j++) { const col = X.map((r) => r[j]); mu[j] = mean(col); sg[j] = sd(col) || 1; }
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sg[j])); const w = Array(p + 1).fill(0); const lr = 0.05;
  for (let it = 0; it < 300; it++) { const g = Array(p + 1).fill(0);
    for (let i = 0; i < n; i++) { let z = w[p]; for (let j = 0; j < p; j++) z += w[j] * Z[i][j]; const pr = 1 / (1 + Math.exp(-z)); const e = pr - y[i]; for (let j = 0; j < p; j++) g[j] += e * Z[i][j]; g[p] += e; }
    for (let j = 0; j < p; j++) w[j] -= lr * (g[j] / n + lambda * w[j] / n); w[p] -= lr * g[p] / n; }
  return { w, mu, sg };
}
const predict = (m: Model, x: number[]) => { let z = m.w[m.w.length - 1]; for (let j = 0; j < x.length; j++) z += m.w[j] * (x[j] - m.mu[j]) / m.sg[j]; return 1 / (1 + Math.exp(-z)); };

type Pos = { sym: string; dir: number; entryTs: number; entry: number; exitDueTs: number };
type Fill = { sym: string; dir: number; entryTs: number; entry: number; exitTs: number; exit: number; grossBp: number; netBp: number };
type Pending = { sym: string; dir: number; entryTs: number; signalledAt: string };
type Ledger = { clock: string; pending: Pending[]; opened: Pos[]; fills: Fill[]; marks: { at: string; note: string }[] };
let L: Ledger = { clock: K.CLOCK, pending: [], opened: [], fills: [], marks: [] };
// THE LEDGER PATH MUST BE SCRIPT-RELATIVE, NOT CWD-RELATIVE. The hourly runner does `cd "$(dirname "$0")/.."`, so its
// working directory is infra/ — and the first version of this bot resolved "data/direction-paper-ledger.json" against
// that, writing to infra/data/ while scripts/forward-score-specs.ts read the repo root. The clock accumulated four real
// fills into a file its own scorer would never open: a forward clock nobody scores is indistinguishable from no forward
// clock (D-613). scripts/gold-paper-bot.ts already did this correctly; this now matches it.
const LP = new URL(`../${K.LEDGER}`, import.meta.url).pathname;
try { L = JSON.parse(await Deno.readTextFile(LP)); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
L.pending ??= [];
if (L.clock !== K.CLOCK) { console.error(`!! ledger belongs to clock ${L.clock}, not ${K.CLOCK} — refusing to mix two books`); Deno.exit(1); }

const RT = (+K.MAKER_BP + +K.TAKER_BP) / 1e4;
let opened = 0, closed = 0, pended = 0, missed = 0;
for (const sym of K.SYMBOLS.split(",")) {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((x, y) => x[0] - y[0]);
  if (b.length < +K.TRAIN_D * 24 + 100) { console.log(`  ${sym}: only ${b.length} hourly bars — skipped`); continue; }
  const byTs = new Map<number, number[]>(); for (const x of b) byTs.set(x[0], x);
  // 0. price any pending intent whose entry bar has now printed
  for (const pd of [...L.pending]) {
    if (pd.sym !== sym) continue;
    const eb = byTs.get(pd.entryTs);
    if (eb) { L.opened.push({ sym, dir: pd.dir, entryTs: pd.entryTs, entry: eb[1], exitDueTs: pd.entryTs + +K.H * 3600 }); L.pending = L.pending.filter((x) => x !== pd); opened++; }
    else if (b[b.length - 1][0] > pd.entryTs + 7200) { L.pending = L.pending.filter((x) => x !== pd); missed++; }
  }
  // 1. close anything due, at the OPEN of its due hour, taker
  for (const p of [...L.opened]) {
    if (p.sym !== sym) continue;
    const bar = byTs.get(p.exitDueTs); if (!bar) continue;
    const g = p.dir * Math.log(bar[1] / p.entry);
    L.fills.push({ sym, dir: p.dir, entryTs: p.entryTs, entry: p.entry, exitTs: p.exitDueTs, exit: bar[1], grossBp: g * 1e4, netBp: (g - RT) * 1e4 });
    L.opened = L.opened.filter((x) => x !== p); closed++;
  }
  // 2. fit on the trailing window and read the latest CLOSED bar
  const H = +K.H, T = +K.TRAIN_D * 24;
  const last = b.length - 1;                       // most recent completed hourly bar
  const trStart = Math.max(48, last - T);
  const X: number[][] = [], y: number[] = [];
  for (let i = trStart; i < last - H; i++) { const f = features(b, i); if (!f) continue; X.push(f); y.push(b[i + H][4] > b[i][4] ? 1 : 0); }
  if (X.length < 500) { console.log(`  ${sym}: ${X.length} training rows — skipped`); continue; }
  const w = fit(X, y, +K.LAMBDA);
  const f = features(b, last); if (!f) continue;
  const p = predict(w, f);
  const dir = p > +K.P_HI ? 1 : p < 1 - +K.P_HI ? -1 : 0;
  const entryTs = b[last][0] + 3600;
  // A signal read from the close of the latest COMPLETE bar implies an entry at the open of the NEXT bar, which has not
  // printed yet. Taking the open of a bar that already closed would be back-dating by up to an hour — the same-bar
  // violation D-498 exists to stop. So the intent is recorded as PENDING and is priced on the following run, at the
  // real open of the bar it was always meant to enter. An intent older than 2 hours is abandoned, not filled late.
  if (dir && !L.pending.some((x) => x.sym === sym) && !L.opened.some((x) => x.sym === sym) && !L.fills.some((x) => x.entryTs === entryTs && x.sym === sym)) {
    L.pending.push({ sym, dir, entryTs, signalledAt: new Date().toISOString() }); pended++;
  }
  console.log(`  ${sym}: p ${p.toFixed(4)} -> ${dir === 0 ? "flat" : dir > 0 ? "long" : "short"}; pending ${L.pending.filter((x) => x.sym === sym).length}; open ${L.opened.filter((x) => x.sym === sym).length}; fills ${L.fills.filter((x) => x.sym === sym).length}`);
}
const net = L.fills.map((f) => f.netBp), acc = L.fills.filter((f) => f.grossBp > 0).length;
L.marks.push({ at: new Date().toISOString(), note: `${L.fills.length} fills, ${L.opened.length} open, ${L.pending.length} pending; mean net ${net.length ? mean(net).toFixed(2) : "–"}bp; win rate ${L.fills.length ? (100 * acc / L.fills.length).toFixed(1) : "–"}%` });
if (L.marks.length > 2000) L.marks = L.marks.slice(-2000);
await Deno.writeTextFile(LP, JSON.stringify(L, null, 1));
console.log(`  DIRECTION PAPER BOT: pended ${pended}, opened ${opened}, closed ${closed}, missed ${missed}; book ${L.fills.length} fills, mean net ${net.length ? mean(net).toFixed(2) : "–"}bp, ${L.opened.length} open, ${L.pending.length} pending. NO BROKER PATH — paper only.`);
