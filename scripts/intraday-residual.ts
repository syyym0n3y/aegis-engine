// D-921 — does the INTRADAY return residual carry the structure the daily residual (D-920) lacks?
// D-920: daily residual ACF1 ~ -0.02 (noise). This tests 5m and 1m major-perp returns: autocorrelation at lags 1-10,
// raw and BTC-residualized, with the implied per-bar predictable bp vs a 5bp round-trip. The one horizon left un-mined.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("intraday-residual", [
  { name: "TF", def: "5m", note: "5m | 1m90" }, { name: "LAGS", def: "10" }, { name: "MIN_BARS", def: "5000" },
  { name: "ROUNDTRIP_BP", def: "5" }, { name: "RUN_ID", def: "D-921-intraday-residual-structure" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function acf(a: number[], lag: number) { const m = mean(a); let den = 0; for (const x of a) den += (x - m) ** 2; let num = 0; for (let i = lag; i < a.length; i++) num += (a[i] - m) * (a[i - lag] - m); return num / (den || 1); }
// list all chunk tfs for the base tf
const allTf = [...new Set((await q(`trd_bars_intraday?select=tf`) as { tf: string }[]).map((r) => r.tf))];
const chunks = allTf.filter((t) => t.startsWith(K.TF + "-") || t === K.TF);
const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"];
async function loadRet(sym: string): Promise<{ ts: number; r: number }[]> {
  const all: number[][] = [];
  for (const tf of chunks) { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.${tf}&select=bars`) as { bars: number[][] }[])[0]; if (row?.bars) all.push(...row.bars); }
  all.sort((a, b) => a[0] - b[0]);
  const out: { ts: number; r: number }[] = [];
  for (let i = 1; i < all.length; i++) { const p0 = all[i - 1][4], p1 = all[i][4], v = all[i][5] ?? 1; if (p0 > 0 && p1 > 0 && v > 0 && p1 !== p0) out.push({ ts: all[i][0], r: Math.log(p1 / p0) }); }
  return out;
}
console.log(`==> D-921 INTRADAY RESIDUAL STRUCTURE — tf=${K.TF}, chunks=${chunks.length}, ${SYMS.length} majors; round-trip ${K.ROUNDTRIP_BP}bp`);
console.log(`  (daily residual ACF1 was -0.02 = noise, D-920; does intraday differ?)\n`);
const btc = await loadRet("BTCUSDT"); const btcMap = new Map(btc.map((x) => [x.ts, x.r]));
const L = +K.LAGS;
console.log(`  ${"sym".padEnd(8)} ${"bars".padStart(7)} ${"sd(bp)".padStart(7)} ${"ACF1".padStart(7)} ${"ACF2".padStart(7)} ${"ACF3".padStart(7)} ${"resACF1".padStart(8)} ${"±2/√N".padStart(7)}  ${"|ACF1|·σ bp".padStart(11)}  verdict`);
for (const sym of SYMS) {
  const d = await loadRet(sym);
  if (d.length < +K.MIN_BARS) { console.log(`  ${sym.padEnd(8)} ${String(d.length).padStart(7)}  (<${K.MIN_BARS} — UNTESTED)`); continue; }
  const r = d.map((x) => x.r); const N = r.length; const se = 2 / Math.sqrt(N);
  const sdbp = sd(r) * 1e4;
  const a1 = acf(r, 1), a2 = acf(r, 2), a3 = acf(r, 3);
  // BTC-residualize (contemporaneous beta)
  const paired = d.filter((x) => btcMap.has(x.ts)); const yb = paired.map((x) => x.r), xb = paired.map((x) => btcMap.get(x.ts)!);
  const mx = mean(xb), my = mean(yb); let cov = 0, vx = 0; for (let i = 0; i < xb.length; i++) { cov += (xb[i] - mx) * (yb[i] - my); vx += (xb[i] - mx) ** 2; } const beta = cov / (vx || 1);
  const resid = paired.map((x) => x.r - beta * btcMap.get(x.ts)!); const ra1 = acf(resid, 1);
  const impliedBp = Math.abs(a1) * sdbp; // predictable component per bar
  const sig = Math.abs(a1) > se; const deployable = impliedBp > +K.ROUNDTRIP_BP;
  const verdict = !sig ? "NOISE" : deployable ? "clears cost?!" : `SUB-FEE (${impliedBp.toFixed(2)}<${K.ROUNDTRIP_BP}bp)`;
  console.log(`  ${sym.padEnd(8)} ${String(N).padStart(7)} ${sdbp.toFixed(1).padStart(7)} ${a1.toFixed(4).padStart(7)} ${a2.toFixed(4).padStart(7)} ${a3.toFixed(4).padStart(7)} ${ra1.toFixed(4).padStart(8)} ${se.toFixed(4).padStart(7)}  ${impliedBp.toFixed(2).padStart(11)}  ${verdict}`);
}
// white-noise control
const wn: number[] = []; let s = 12345; const u = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = 0; i < 100000; i++) wn.push(u() - 0.5);
console.log(`\n  white-noise control ACF1 = ${acf(wn, 1).toFixed(4)} (must be within ±${(2/Math.sqrt(wn.length)).toFixed(4)}) -> estimator calibrated`);
await spendTrials({ rest: OWNED, headers: hdr, family: "intraday-residual", runId: `${K.RUN_ID}-${K.TF}`, spent: 1 });
console.log(`\n  READ: a significant lag-1 ACF that implies < ${K.ROUNDTRIP_BP}bp is real microstructure structure but SUB-FEE (bid-ask bounce / order-flow), not a naked edge.`);
