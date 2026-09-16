// D-933 — explosive-upside / squeeze setups: do ex-ante conditions (high days-to-cover + FTD + low price) raise the
// right-tail of large forward up-moves, and is the EV positive? The honest test of "find instances of a 10x".
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("explosive-upside", [
  { name: "DC_MIN", def: "8", note: "days-to-cover threshold for a squeeze setup" }, { name: "PX_MAX", def: "10" }, { name: "FWD", def: "21" }, { name: "COST", def: "15", note: "round-trip % slippage+spread for px<10 microcaps" }, { name: "SPLIT", def: "2020-01-01" }, { name: "RUN_ID", def: "D-933-explosive-upside-squeeze" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eu", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const FWD = +K.FWD;
// 1) squeeze-setup events: high days-to-cover
const ev = await q(`trd_short_interest?days_cover=gte.${K.DC_MIN}&select=symbol,settlement,days_cover&order=settlement`) as { symbol: string; settlement: string; days_cover: number }[];
console.log(`high-days-to-cover events (dc>=${K.DC_MIN}): ${ev.length}`);
// restrict to panel equities
const panel = new Set((await q(`trd_bars_deep?asset_class=eq.equity&select=symbol`) as { symbol: string }[]).map((r) => r.symbol.toUpperCase()));
const evP = ev.filter((e) => panel.has(e.symbol.toUpperCase()));
assertNonEmpty("panel squeeze events", evP, 200);
const setupSyms = [...new Set(evP.map((e) => e.symbol.toUpperCase()))];
console.log(`  in panel: ${evP.length} events across ${setupSyms.length} names`);
// 2) FTD presence per symbol (any recent fails => borrow scarcity, a squeeze ingredient)
const ftdSyms = new Set<string>();
for (let i = 0; i < setupSyms.length; i += 80) { const rows = await q(`trd_ftd?symbol=in.(${setupSyms.slice(i, i + 80).map(encodeURIComponent).join(",")})&qty_fails=gt.0&select=symbol&limit=1000`) as { symbol: string }[]; for (const r of rows) ftdSyms.add(r.symbol.toUpperCase()); }
// 3) bars for setup names
async function barsOf(list: string[]) { const m = new Map<string, number[][]>(); for (let i = 0; i < list.length; i += 40) { const rows = await q(`trd_bars_deep?symbol=in.(${list.slice(i, i + 40).map(encodeURIComponent).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[]; for (const r of rows) m.set(r.symbol.toUpperCase(), (r.bars ?? []).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0])); } return m; }
const bars = await barsOf(setupSyms);
// per event: entry at first bar >= settlement, price<PX_MAX, FTD present; fwd close-return + max high-move over FWD bars
function stats(sym: string, settleDay: number) {
  const b = bars.get(sym); if (!b) return null; let i = 0; while (i < b.length && Math.floor(b[i][0] / 86400) < settleDay) i++; if (i >= b.length - 1) return null; // need an entry + at least one fwd bar
  const entry = b[i][4]; if (entry <= 0 || entry > +K.PX_MAX) return null;
  const end = Math.min(i + FWD, b.length - 1); // if delisted within FWD, use the LAST available bar (captures crash-to-delisting)
  const delisted = (i + FWD) >= b.length; // name had no full 21d forward -> likely delisted/halted
  let maxUp = -1; for (let k = i + 1; k <= end; k++) maxUp = Math.max(maxUp, b[k][2] / entry - 1);
  let fwdClose = b[end][4] / entry - 1;
  if (delisted) fwdClose = Math.max(fwdClose, -1) * 1; // last known price; if it crashed toward 0 this is ~ -1 (counted, not dropped)
  return { fwdClose, maxUp, delisted };
}
const setup: { fwdClose: number; maxUp: number; delisted?: boolean }[] = []; let delN = 0;
for (const e of evP) { if (!ftdSyms.has(e.symbol.toUpperCase())) continue; const s = stats(e.symbol.toUpperCase(), Math.floor(Date.parse(e.settlement + "T00:00:00Z") / 86400000)); if (s) { (s as any).day = Math.floor(Date.parse(e.settlement + "T00:00:00Z") / 86400000); setup.push(s); if (s.delisted) delN++; } }
assertNonEmpty("setup obs (dc+ftd+lowpx)", setup, 200);
console.log(`  of which delisted/halted within ${FWD}d (counted, not dropped): ${delN} (${(100*delN/setup.length).toFixed(0)}%)`);
// universe control: random panel equities at random dates, same forward stats
const uniSyms = [...panel].filter((s) => /^[A-Z]{1,5}$/.test(s)).slice(0, 500);
const ubars = await barsOf(uniSyms);
const uni: { fwdClose: number; maxUp: number }[] = [];
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (const sym of uniSyms) { const b = ubars.get(sym); if (!b || b.length < FWD + 5) continue; for (let n = 0; n < 6; n++) { const i = Math.floor(rnd() * (b.length - FWD - 1)); const entry = b[i][4]; if (entry <= 0) continue; let mx = -1; for (let k = i + 1; k <= i + FWD; k++) mx = Math.max(mx, b[k][2] / entry - 1); uni.push({ fwdClose: b[i + FWD][4] / entry - 1, maxUp: mx }); } }
const P = (a: { maxUp: number }[], th: number) => 100 * a.filter((x) => x.maxUp >= th).length / a.length;
console.log(`\n==> D-933 EXPLOSIVE UPSIDE — setup ${setup.length} events (dc>=${K.DC_MIN}+FTD+px<${K.PX_MAX}) vs universe ${uni.length} random equity-dates, ${FWD}d forward\n`);
console.log(`  ${"cohort".padEnd(10)} ${"mean fwd%".padStart(10)} ${"median%".padStart(9)} ${"P(max>=+50%)".padStart(13)} ${"P(>=+100%)".padStart(11)} ${"P(>=+300%)".padStart(11)}`);
for (const [nm, a] of [["SETUP", setup], ["universe", uni]] as [string, typeof setup][])
  console.log(`  ${nm.padEnd(10)} ${(mean(a.map(x=>x.fwdClose))*100).toFixed(1).padStart(10)} ${(med(a.map(x=>x.fwdClose))*100).toFixed(1).padStart(9)} ${P(a,0.5).toFixed(1).padStart(13)} ${P(a,1.0).toFixed(1).padStart(11)} ${P(a,3.0).toFixed(1).padStart(11)}`);
const cost = +K.COST / 100; const splitDay = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 86400000);
const net = (a: { fwdClose: number }[]) => a.map((x) => (1 + x.fwdClose) * (1 - cost) - 1); // one round-trip haircut
const tr = setup.filter((x: any) => x.day < splitDay), te = setup.filter((x: any) => x.day >= splitDay);
console.log(`\n  NET OF ${K.COST}% MICROCAP ROUND-TRIP: SETUP mean ${(mean(net(setup))*100).toFixed(1)}% (gross ${(mean(setup.map(x=>x.fwdClose))*100).toFixed(1)}%), median ${(med(net(setup))*100).toFixed(1)}%`);
console.log(`  TRAIN(<${K.SPLIT}) net mean ${(mean(net(tr))*100).toFixed(1)}% (n${tr.length}) -> TEST(>=${K.SPLIT}) net mean ${(mean(net(te))*100).toFixed(1)}% (n${te.length}), TEST median ${(med(net(te))*100).toFixed(1)}%`);
console.log(`  FRACTION of setups net-POSITIVE after cost: ${(100*net(setup).filter(x=>x>0).length/setup.length).toFixed(0)}% (if <50%, most bets lose; the mean rides a few winners)`);
await spendTrials({ rest: OWNED, headers: hdr, family: "explosive-upside", runId: K.RUN_ID, spent: 1 });
console.log(`\n  READ: mean-fwd% is the EV of buying-and-holding (close-to-close); P(max>=X) is the OPPORTUNITY tail (assumes a perfect exit at the peak).`);
console.log(`  A positive right tail with NEGATIVE mean = a negative-EV lottery: the spikes are real but the losers outweigh them. Positive mean + fat tail = a real small-stake sleeve.`);
