// D-931 — borrow-cost measurement on the 297 liquid going-concern names. Is the short live, or avoid-filter-only?
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("goingconcern-borrow", [{ name: "EDGE_ANN", def: "45.8", note: "annualized gross short excess %/yr (D-930 126d -22.9% x2)" }, { name: "RUN_ID", def: "D-931-goingconcern-borrow-cost" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gb", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const names: { sym: string; avg_excess_126d: number }[] = JSON.parse(await Deno.readTextFile(new URL("../data/d930-liquid-names.json", import.meta.url)));
const syms = names.map((n) => n.sym);
const inList = (a: string[]) => `(${a.map((s) => encodeURIComponent(s)).join(",")})`;
// 1) direct borrow_fee (latest per name) — chunk the series query
const feeSeries = new Map<string, number>();
for (let i = 0; i < syms.length; i += 60) { const chunk = syms.slice(i, i + 60).map((s) => "borrow_fee:" + s); const rows = await q(`trd_macro_series?series=in.${inList(chunk)}&select=series,d,v&order=d.desc`) as { series: string; d: string; v: number }[]; for (const r of rows) { const s = r.series.split(":", 2)[1]; if (!feeSeries.has(s)) feeSeries.set(s, +r.v); } }
// 2) short interest: latest days_cover + short_qty per name
const si = new Map<string, { dc: number; sq: number }>();
for (let i = 0; i < syms.length; i += 60) { const rows = await q(`trd_short_interest?symbol=in.${inList(syms.slice(i, i + 60))}&select=symbol,settlement,days_cover,short_qty&order=settlement.desc`) as { symbol: string; days_cover: number; short_qty: number }[]; for (const r of rows) if (!si.has(r.symbol)) si.set(r.symbol, { dc: +r.days_cover, sq: +r.short_qty }); }
// 3) FTD: recent total fails per name (last ~1y)
const ftd = new Map<string, number>();
for (let i = 0; i < syms.length; i += 60) { const rows = await q(`trd_ftd?symbol=in.${inList(syms.slice(i, i + 60))}&settle_date=gte.2025-09-01&select=symbol,qty_fails`) as { symbol: string; qty_fails: number }[]; for (const r of rows) ftd.set(r.symbol, (ftd.get(r.symbol) ?? 0) + +r.qty_fails); }
console.log(`==> D-931 BORROW COST on ${syms.length} liquid going-concern names — gross short edge ${K.EDGE_ANN}%/yr, break-even borrow = ${K.EDGE_ANN}%/yr\n`);
console.log(`  coverage: direct borrow_fee ${feeSeries.size}/${syms.length}; short-interest ${si.size}/${syms.length}; recent FTD ${ftd.size}/${syms.length}`);
assertNonEmpty("borrow signal coverage", [...new Set([...feeSeries.keys(), ...si.keys()])], 50);
// direct-fee distribution + net edge on the covered names
const fees = [...feeSeries.values()];
if (fees.length) { const net = fees.map((f) => +K.EDGE_ANN - f); const clr = net.filter((x) => x > 0).length;
  console.log(`\n  DIRECT FEES (${fees.length} names): median ${med(fees).toFixed(2)}%/yr, p25 ${[...fees].sort((a,b)=>a-b)[Math.floor(fees.length*.25)].toFixed(2)}, p75 ${[...fees].sort((a,b)=>a-b)[Math.floor(fees.length*.75)].toFixed(2)}, max ${Math.max(...fees).toFixed(1)}`);
  console.log(`  NET short edge on directly-priced names: median ${med(net).toFixed(1)}%/yr; ${clr}/${fees.length} clear (borrow < ${K.EDGE_ANN}%/yr break-even)`);
}
// hardness classification for ALL via SI days_cover + FTD (borrow scarcity proxies)
let hardSI = 0, ftdFlag = 0, noSignal = 0;
const dcs: number[] = [];
for (const s of syms) { const d = si.get(s); if (d) dcs.push(d.dc); if (d && d.dc >= 5) hardSI++; if ((ftd.get(s) ?? 0) > 0) ftdFlag++; if (!feeSeries.has(s) && !si.has(s)) noSignal++; }
console.log(`\n  BORROW-SCARCITY (all 297): median days-to-cover ${med(dcs).toFixed(1)}; ${hardSI} names days-cover>=5 (crowded short = pricey borrow); ${ftdFlag} names with recent fails-to-deliver (borrow scarcity); ${noSignal} with NO borrow/SI signal (likely delisted -> unshortable now)`);
// positive control: distress names' short-crowding vs a random equity sample
const rnd = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol&limit=400`) as { symbol: string }[]).map((r) => r.symbol);
const rdc: number[] = [];
for (let i = 0; i < rnd.length; i += 60) { const rows = await q(`trd_short_interest?symbol=in.${inList(rnd.slice(i, i + 60))}&select=symbol,days_cover&order=settlement.desc`) as { symbol: string; days_cover: number }[]; const seen = new Set<string>(); for (const r of rows) if (!seen.has(r.symbol)) { seen.add(r.symbol); rdc.push(+r.days_cover); } }
console.log(`\n  POSITIVE CONTROL: going-concern median days-cover ${med(dcs).toFixed(2)} vs random-equity median ${med(rdc).toFixed(2)} (distress should be >= random)`);
await spendTrials({ rest: OWNED, headers: hdr, family: "goingconcern-borrow", runId: K.RUN_ID, spent: 2 });
console.log(`\n  READ: if median direct fee << ${K.EDGE_ANN}%/yr and most names clear, the short is LIVE on the borrowable subset; if fees/FTD show most are hard/no-borrow, it is AVOID-FILTER-ONLY.`);
