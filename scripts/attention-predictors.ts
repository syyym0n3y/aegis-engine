// D-929 — does Wikipedia public attention predict forward returns? (news/sentiment class)
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("attention-predictors", [{ name: "SPLIT", def: "2021-01-01" }, { name: "RUN_ID", def: "D-929-attention-predictors" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function corrT(x: number[], y: number[]) { const n = x.length; if (n < 30) return { r: 0, t: 0, n }; const mx = mean(x), my = mean(y); let c = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { c += (x[i]-mx)*(y[i]-my); vx += (x[i]-mx)**2; vy += (y[i]-my)**2; } const r = c/(Math.sqrt(vx*vy)||1); return { r, t: r*Math.sqrt(n-2)/Math.sqrt(Math.max(1e-9,1-r*r)), n }; }
async function ser(id: string): Promise<Map<number, number>> { const rows = await q(`trd_macro_series?series=eq.${id}&select=d,v&order=d`) as { d: string; v: number }[]; const m = new Map<number, number>(); for (const r of rows) { const day = Math.floor(Date.parse(r.d + "T00:00:00Z") / 86400000); if (r.v != null && isFinite(+r.v)) m.set(day, +r.v); } return m; }
async function px(sym: string): Promise<Map<number, number>> { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); const m = new Map<number, number>(); for (const x of b) m.set(Math.floor(x[0] / 86400), x[4]); return m; }
const BTC = await ser("onchain_btc_market_price");
const INSTR: Record<string, Map<number, number>> = { BTC, GSPC: await px("^GSPC"), GLD: await px("GLD"), SLV: await px("SLV") };
const PAIRS: [string, string][] = [["bitcoin","BTC"],["ethereum","BTC"],["cryptocurrency","BTC"],["stock_market","GSPC"],["s_p_500","GSPC"],["recession","GSPC"],["inflation","GSPC"],["federal_reserve","GSPC"],["gold","GLD"],["silver","SLV"]];
const SPLIT = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 86400000);
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`==> D-929 ATTENTION PREDICTORS (Wikipedia pageviews 2015-2026) — ceiling ${ceil.ceiling.toFixed(2)}\n`);
console.log(`  ${"article -> instr".padEnd(26)} ${"contemp|r|".padStart(10)} ${"fwd7 t".padStart(7)} ${"fwd30 t".padStart(8)} ${"Q5-Q1 30d bp".padStart(12)} ${"train->test 30d".padStart(16)}`);
let spent = 0;
for (const [art, ins] of PAIRS) {
  const A = await ser("attention_wiki_" + art); const P = INSTR[ins]; if (!A.size || !P.size) { console.log(`  ${art}->${ins}: missing`); continue; }
  const days = [...P.keys()].filter((d) => A.has(d)).sort((a, b) => a - b);
  // attention growth: log(views / MA28)
  const ma = (d: number) => { let s = 0, n = 0; for (let k = d - 27; k <= d; k++) { const v = A.get(k); if (v) { s += v; n++; } } return n > 15 ? s / n : null; };
  const fwd = (d: number, h: number) => { const p0 = P.get(d); let f = d + h; for (let k = 0; k < 5 && !P.has(f); k++) f++; const p1 = P.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
  const rec: { d: number; g: number; absr: number; f7: number | null; f30: number | null }[] = [];
  for (const d of days) { const m = ma(d), v = A.get(d); if (!m || !v) continue; const g = Math.log(v / m); const pm = P.get(d - 1); const absr = pm && P.get(d) ? Math.abs(Math.log(P.get(d)! / pm)) : 0; rec.push({ d, g, absr, f7: fwd(d, 7), f30: fwd(d, 30) }); }
  if (rec.length < 500) { console.log(`  ${(art+"->"+ins).padEnd(26)} (<500 — UNTESTED)`); continue; }
  const contemp = corrT(rec.map(r=>r.g), rec.map(r=>r.absr)); // attention vs |return| (control)
  const nonov = (h: number, key: "f7"|"f30", win: (d:number)=>boolean) => { const r = rec.filter(x=>x[key]!==null && win(x.d)); const idx:number[]=[]; for (let i=0;i<r.length;i+=h) idx.push(i); return corrT(idx.map(i=>r[i].g), idx.map(i=>r[i][key]!)); };
  const f7 = nonov(7,"f7",()=>true), f30 = nonov(30,"f30",()=>true);
  const r30 = rec.filter(x=>x.f30!==null); const idx:number[]=[]; for (let i=0;i<r30.length;i+=30) idx.push(i); const samp = idx.map(i=>r30[i]); const order=[...samp].sort((a,b)=>a.g-b.g); const kq=Math.max(1,Math.floor(order.length/5));
  const spread = (mean(order.slice(-kq).map(x=>x.f30!)) - mean(order.slice(0,kq).map(x=>x.f30!)))*1e4;
  const tr = nonov(30,"f30",d=>d<SPLIT), te = nonov(30,"f30",d=>d>=SPLIT); spent++;
  console.log(`  ${(art+"->"+ins).padEnd(26)} ${contemp.r.toFixed(3).padStart(10)} ${f7.t.toFixed(2).padStart(7)} ${f30.t.toFixed(2).padStart(8)} ${spread.toFixed(0).padStart(12)} ${(tr.t.toFixed(2)+"->"+te.t.toFixed(2)).padStart(16)}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "attention-predictors", runId: K.RUN_ID, spent });
console.log(`\n  READ: contemp |r| + = attention tracks big moves (control). fwd t past ${ceil.ceiling.toFixed(2)} + train->test same sign = candidate; else coincident/sub-cost.`);
