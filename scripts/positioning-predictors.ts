// D-923 — do options-positioning / sentiment variables PREDICT forward returns? The one measurable-variable class
// D-920 never tested as a lagged predictor: CBOE skew, put/call, VVIX, Deribit DVOL. Completes the accounting.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("positioning-predictors", [
  { name: "HORIZONS", def: "1,5,21" }, { name: "MIN_OBS", def: "500" }, { name: "RUN_ID", def: "D-923-positioning-predictors" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
async function series(id: string): Promise<Map<number, number>> { const rows = await q(`trd_macro_series?series=eq.${id}&select=d,v&order=d`) as { d: string; v: number }[]; const m = new Map<number, number>(); for (const r of rows) { const day = Math.floor(Date.parse(r.d + "T00:00:00Z") / 86400000); if (r.v != null && isFinite(+r.v)) m.set(day, +r.v); } return m; }
async function px(sym: string): Promise<Map<number, number>> { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); const m = new Map<number, number>(); for (const x of b) m.set(Math.floor(x[0] / 86400), x[4]); return m; }
const HOR = K.HORIZONS.split(",").map(Number);
// day-clustered / non-overlapping t: use non-overlapping windows for the horizon
function predTest(px: Map<number, number>, sig: Map<number, number>, h: number) {
  const days = [...px.keys()].filter((d) => sig.has(d) && px.has(d + h) || (sig.has(d) && [...px.keys()].includes(d))).sort((a, b) => a - b);
  // build aligned arrays: signal today, forward h-day log return; require px at d and a px within [d+h, d+h+3]
  const pxDays = [...px.keys()].sort((a, b) => a - b); const pxSet = new Set(pxDays);
  const X: number[] = [], Y: number[] = [], TS: number[] = [];
  for (const d of [...sig.keys()].sort((a, b) => a - b)) { if (!pxSet.has(d)) continue; let f = d + h; for (let k = 0; k < 4 && !pxSet.has(f); k++) f++; if (!pxSet.has(f)) continue; X.push(sig.get(d)!); Y.push(Math.log(px.get(f)! / px.get(d)!)); TS.push(d); }
  if (X.length < +K.MIN_OBS) return null;
  // standardize signal
  const mx = mean(X), sx = sd(X) || 1; const xs = X.map((v) => (v - mx) / sx);
  // univariate slope + non-overlapping t (sample every h-th obs to kill overlap)
  const idx: number[] = []; for (let i = 0; i < xs.length; i += h) idx.push(i);
  const xn = idx.map((i) => xs[i]), yn = idx.map((i) => Y[i]);
  const mxn = mean(xn), myn = mean(yn); let cov = 0, vx = 0, vy = 0; for (let i = 0; i < xn.length; i++) { cov += (xn[i] - mxn) * (yn[i] - myn); vx += (xn[i] - mxn) ** 2; vy += (yn[i] - myn) ** 2; }
  const beta = cov / (vx || 1); const r = cov / (Math.sqrt(vx * vy) || 1); const tt = r * Math.sqrt(Math.max(1, xn.length - 2)) / Math.sqrt(Math.max(1e-9, 1 - r * r));
  // quintile spread (bp/day): top vs bottom quintile of signal, forward return per day
  const order = [...Array(xs.length).keys()].sort((a, b) => xs[a] - xs[b]); const kq = Math.floor(xs.length / 5);
  const bot = order.slice(0, kq).map((i) => Y[i] / h), top = order.slice(-kq).map((i) => Y[i] / h);
  const spread = (mean(top) - mean(bot)) * 1e4;
  return { n: xn.length, beta: beta * 1e4, t: tt, spreadBpDay: spread, slopeBpPerSd: beta * 1e4 / h };
}
const spx = await px("^GSPC"), btc = await px("BTC-USD");
const EQ = ["cboe_skew", "cboe_pc_equity", "cboe_pc_total", "cboe_pc_index", "cboe_vvix"];
const CR = ["deribit_btc_dvol", "deribit_eth_dvol"];
console.log(`==> D-923 POSITIONING PREDICTORS — do skew/put-call/VVIX/DVOL predict forward returns? (cost: SPX ~2bp, BTC ~9bp round-trip)\n`);
console.log(`  ${"predictor".padEnd(18)} ${"tgt".padEnd(5)} ${"h".padStart(3)} ${"nNonOv".padStart(6)} ${"slope bp/sd/d".padStart(13)} ${"nonov-t".padStart(8)} ${"Q5-Q1 bp/day".padStart(13)}  verdict`);
async function run(preds: string[], tgt: Map<number, number>, tgtName: string, costBp: number) {
  for (const p of preds) { const sig = await series(p); if (sig.size < +K.MIN_OBS) { console.log(`  ${p.padEnd(18)} ${tgtName.padEnd(5)} — series too short`); continue; }
    for (const h of HOR) { const r = predTest(tgt, sig, h); if (!r) { console.log(`  ${p.padEnd(18)} ${tgtName.padEnd(5)} ${String(h).padStart(3)}  (<${K.MIN_OBS} — UNTESTED)`); continue; }
      const sig2 = Math.abs(r.t) > 2; const clears = Math.abs(r.spreadBpDay) * h > costBp; // spread over the hold vs round-trip
      const verdict = !sig2 ? "NULL (|t|<2)" : clears ? "CLEARS?!" : `SUB-COST (|Q5-Q1|·h=${(Math.abs(r.spreadBpDay)*h).toFixed(1)}<${costBp}bp)`;
      console.log(`  ${p.padEnd(18)} ${tgtName.padEnd(5)} ${String(h).padStart(3)} ${String(r.n).padStart(6)} ${r.slopeBpPerSd.toFixed(2).padStart(13)} ${r.t.toFixed(2).padStart(8)} ${r.spreadBpDay.toFixed(2).padStart(13)}  ${verdict}`);
    } }
}
await run(EQ, spx, "SPX", 2);
await run(CR, btc, "BTC", 9);
await spendTrials({ rest: OWNED, headers: hdr, family: "positioning-predictors", runId: K.RUN_ID, spent: (EQ.length + CR.length) * HOR.length });
console.log(`\n  READ: a |t|>2 with a Q5-Q1 spread whose per-hold magnitude is below the round-trip cost is a real sentiment variable that is NOT a deployable timing edge.`);
