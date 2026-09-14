// D-887 — the passive liquidity-provision return, at full breadth.
// D-886 killed the direction model's fill story with a coin-flip control, and the CONTROL itself printed +30 to +39bp per
// filled trade at t 3.3-4.0. That is not a signal result: it says that when the market moves N basis points against a
// resting limit inside an hour, buying that excursion and exiting at the hour's end pays. This script tests that object
// directly, at every hour of the 730-day 5m panel rather than at the 1h model's 1,301 conviction hours, on both sides,
// with a MAKER entry and a TAKER exit charged, and with the control that decides whether it is a real reversion or the
// classic limit-order backtest illusion: ENTRY=through re-prices every fill at the close of the bar that traded through,
// surrendering exactly the improvement the limit claimed. If the return survives ENTRY=through it is reversion; if it
// dies, the improvement was never obtainable and the whole thing is an artifact of measuring against an intra-bar low.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("passive-liquidity", [
  { name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT" },
  { name: "TF", def: "5m" }, { name: "BAR_S", def: "300" }, { name: "FILL_BARS", def: "12", note: "bars the limit rests for" },
  { name: "IMPROVE", def: "20,40,80", note: "bp of improvement demanded, swept" },
  { name: "ENTRY", def: "limit", note: "limit = filled at the limit price; through = re-priced at the close of the bar that traded through (the control)" },
  { name: "MAKER_BP", def: "2" }, { name: "TAKER_BP", def: "9" },
  { name: "SIDES", def: "both", note: "both | long | short" },
  { name: "RUN_ID", def: "D-887-passive-liquidity-provision" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function mkJwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await mkJwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const tstat = (a: number[]) => { if (a.length < 3) return 0; const m = mean(a); const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); return v > 0 ? m / Math.sqrt(v / a.length) : 0; };
const RT = (+K.MAKER_BP + +K.TAKER_BP) / 1e4;   // maker in, taker out — a resting limit entry and a market exit
const SIDES = K.SIDES === "both" ? [1, -1] : K.SIDES === "long" ? [1] : [-1];
let trials = 0; const lines: string[] = [];
console.log(`==> D-887 PASSIVE LIQUIDITY — ${K.TF} panel, limit rests ${K.FILL_BARS} bars, exit at the end of the window, entry=${K.ENTRY}, cost ${K.MAKER_BP}+${K.TAKER_BP}bp`);
console.log(`  ${"symbol".padEnd(9)} ${"imp".padStart(4)} ${"side".padStart(5)} ${"opps".padStart(7)} ${"fill%".padStart(6)} ${"bp/fill".padStart(8)} ${"bp/opp".padStart(7)} ${"day-t".padStart(6)} ${"yrs+".padStart(5)}`);
for (const sym of K.SYMBOLS.split(",")) {
  const rows = await q(`trd_bars_intraday?symbol=eq.${sym}&tf=like.${K.TF}-*&select=bars&order=tf`) as { bars: number[][] }[];
  const seen = new Set<number>(); const b = rows.flatMap((r) => (r.bars ?? []) as number[][]).filter((x) => x[4] > 0 && !seen.has(x[0]) && seen.add(x[0])).sort((x, y) => x[0] - y[0]);
  assertNonEmpty(`${sym} ${K.TF} bars`, b, 100000);
  const idx = new Map<number, number>(); b.forEach((x, i) => idx.set(x[0], i));
  const anchors: number[] = []; for (let i = 0; i < b.length; i++) if ((b[i][0] + +K.BAR_S) % 3600 === 0) anchors.push(i);   // the 5m bar that closes an hour
  for (const impS of K.IMPROVE.split(",")) {
    const imp = +impS / 1e4;
    for (const dir of SIDES) {
      const perFill: number[] = [], perOpp: number[] = [], day = new Map<number, number>(), yr = new Map<number, number[]>();
      let opps = 0, fills = 0;
      for (const a of anchors) {
        if (a + +K.FILL_BARS + 1 >= b.length) continue;
        const close = b[a][4], lim = close * (1 - dir * imp);
        opps++;
        let entry = 0;
        for (let k = 1; k <= +K.FILL_BARS; k++) { const c = b[a + k]; if (c[0] !== b[a][0] + +K.BAR_S * k) break;   // a gap breaks the window rather than silently skipping bars
          if (dir === 1 ? c[3] < lim : c[2] > lim) { entry = K.ENTRY === "through" ? c[4] : lim; break; } }
        const d = Math.floor(b[a][0] / 86400), y = new Date(b[a][0] * 1e3).getUTCFullYear();
        if (!entry) { perOpp.push(0); day.set(d, day.get(d) ?? 0); (yr.get(y) ?? yr.set(y, []).get(y)!).push(0); continue; }
        fills++;
        const exit = b[a + +K.FILL_BARS + 1][1];   // open of the bar after the window = the hour+2 open
        const r = dir * Math.log(exit / entry) - RT;
        perFill.push(r * 1e4); perOpp.push(r * 1e4); day.set(d, (day.get(d) ?? 0) + r * 1e4); (yr.get(y) ?? yr.set(y, []).get(y)!).push(r * 1e4);
      }
      trials++;
      const yrsPos = [...yr.values()].filter((v) => mean(v) > 0).length, yrsN = yr.size;
      const t = tstat([...day.values()]);
      console.log(`  ${sym.padEnd(9)} ${impS.padStart(4)} ${(dir === 1 ? "long" : "short").padStart(5)} ${String(opps).padStart(7)} ${(100 * fills / Math.max(1, opps)).toFixed(1).padStart(6)} ${mean(perFill).toFixed(2).padStart(8)} ${mean(perOpp).toFixed(2).padStart(7)} ${t.toFixed(2).padStart(6)} ${`${yrsPos}/${yrsN}`.padStart(5)}`);
      lines.push(`${sym} imp${impS} ${dir === 1 ? "L" : "S"} fill ${(100 * fills / Math.max(1, opps)).toFixed(0)}% bp/fill ${mean(perFill).toFixed(1)} bp/opp ${mean(perOpp).toFixed(2)} t ${t.toFixed(2)} yrs ${yrsPos}/${yrsN}`);
    }
  }
}
await spendTrials({ rest: OWNED, headers: hdr, family: "passive-liquidity", runId: `${K.RUN_ID}-${K.ENTRY}`, spent: trials });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  ${trials} cells counted; ceiling ${ceil.ceiling.toFixed(2)}; entry=${K.ENTRY}`);
console.log(`  SUMMARY ${lines.join(" | ")}`);
