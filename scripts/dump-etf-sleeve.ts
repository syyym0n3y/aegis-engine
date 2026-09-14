// D-894 — dump a buy-and-hold ETF as a sleeve series in the same shape scripts/sleeve-frontier.ts consumes.
// These are PASSIVE series, unlike the three timed books already in the blend, and that difference is stated in the
// output rather than left for the reader to infer. Returns are close-to-close on trd_bars_deep's adjusted closes.
// NOTE (D-846): trd_bars_deep's O/H/L are inconsistent with the adjusted close on 39 series, so ONLY the close is used.
// Drawdown and worst-day are reported ARITHMETICALLY (exp(x)-1) rather than as summed log returns: a -313% cumulative
// log drawdown is a -95.6% loss, and quoting the log figure makes a wipeout look like an impossible number.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("dump-etf-sleeve", [
  { name: "SYMBOL", def: "PBP" }, { name: "OUT", def: "" }, { name: "FROM", def: "1990-01-01" },
  { name: "RF_ANNUAL", def: "0.04", note: "cash rate subtracted so a buy-and-hold sleeve is an EXCESS return, comparable to the timed books" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "des", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
const rows = await q(`trd_bars_deep?symbol=eq.${K.SYMBOL}&select=bars`) as { bars: number[][] }[];
const bars = ((rows[0]?.bars ?? []) as number[][]).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
assertNonEmpty(`${K.SYMBOL} daily bars`, bars, 1000);
const fromS = Date.parse(K.FROM + "T00:00:00Z") / 1000;
const rfD = +K.RF_ANNUAL / 252;
const series: Record<string, number> = {};
let mn = 0, mx = 0, eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0;
for (let i = 1; i < bars.length; i++) {
  if (bars[i][0] < fromS) continue;
  const r = Math.log(bars[i][4] / bars[i - 1][4]) - rfD;
  const d = new Date(bars[i][0] * 1000).toISOString().slice(0, 10);
  series[d] = +r.toFixed(8); mn = Math.min(mn, r); mx = Math.max(mx, r);
  eq += r; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak);
}
const ks = Object.keys(series).sort(); const v = ks.map((d) => series[d]);
const mean = v.reduce((a, b) => a + b, 0) / v.length;
const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1));
// script-relative (D-903b): a cwd-relative state path silently forks under any runner that cds.
const outRel = K.OUT || `data/d894-${K.SYMBOL.toLowerCase()}.json`;
const out = outRel.startsWith("/") ? outRel : new URL(`../${outRel}`, import.meta.url).pathname;
await Deno.writeTextFile(out, JSON.stringify({ prereg: "D-894-placeable-vol-premium-sleeve", symbol: K.SYMBOL, passive: true, rf_annual: +K.RF_ANNUAL, series }));
console.log(`  ${K.SYMBOL.padEnd(6)} ${ks.length} days ${ks[0]}..${ks.at(-1)}  Sharpe(excess) ${(mean / sd * Math.sqrt(252)).toFixed(2).padStart(6)}  vol ${(100 * sd * Math.sqrt(252)).toFixed(1).padStart(5)}%  maxDD ${(100 * (Math.exp(mdd) - 1)).toFixed(1).padStart(6)}%  worst day ${(100 * (Math.exp(mn) - 1)).toFixed(1)}%  underwater ${(maxUw / 252).toFixed(1)}y  -> ${out}`);
console.log(`         PASSIVE buy-and-hold, excess of a ${(100 * +K.RF_ANNUAL).toFixed(0)}% cash rate. Not a timed book — stated because the other sleeves are.`);
