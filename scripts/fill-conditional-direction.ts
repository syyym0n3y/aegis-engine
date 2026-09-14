// D-883 — THE EXECUTION LAW applied to the D-881 direction model.
// The model's high-conviction signals (p >= P_HI or <= 1-P_HI at 1h) carry +10-13bp per trade at MAKER cost, and a
// maker fee is a hypothesis about fills. Here every such signal is a limit order at the signal bar's close; it FILLS
// if the following 60 one-minute bars trade through that price (long: low <= limit; short: high >= limit). Exit is the
// model's own exit (open of the hour after next). We report the fill RATE, the return on FILLED signals, the return on
// ALL signals (market entry at next open) and on UNFILLED ones — the D-447 shape is filled-loses / unfilled-carries.
// Inputs: data/direction-signals-1h.json (written by direction-model.ts DUMP=1) and the 1m90-* chunks in trd_bars_intraday.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("fill-conditional-direction", [{ name: "P_HI", def: "0.65" }, { name: "MAKER_BP", def: "2" }, { name: "TAKER_BP", def: "9" }, { name: "MIN_TF", def: "1m90", note: "fill medium: 1m90 (90d) or 5m (730d)" }, { name: "FILL_BARS", def: "60", note: "bars of the medium the limit rests for; 60 x 1m = 12 x 5m = one hour" }, { name: "BAR_S", def: "60", note: "seconds per bar of the medium" }, { name: "MIN_COVER_D", def: "60" }, { name: "RUN_ID", def: "D-883-direction-model-fill-conditional" }, { name: "TAG", def: "", note: "label for the medium in the printed verdict" }, { name: "IMPROVE_BP", def: "0", note: "price improvement demanded of the limit vs the signal close; 0 = join at the close (touch test)" }, { name: "CONTROL", def: "off", note: "shuffle = replace the model's direction with a deterministic coin flip, same signals, same limits — isolates the dip-buy effect from the model" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function mkJwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fcd", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await mkJwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const dump = JSON.parse(await Deno.readTextFile("data/direction-signals-1h.json")) as { signals: Record<string, number[][]> };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const tstat = (a: number[]) => { if (a.length < 3) return 0; const m = mean(a); const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); return v > 0 ? m / Math.sqrt(v / a.length) : 0; };
let supported = 0, tested = 0; const rows: string[] = [];
console.log(`==> D-883 FILL-CONDITIONAL — limit at signal close, fill window ${K.FILL_BARS} x ${K.MIN_TF}, exit = model exit, P_HI ${K.P_HI}`);
console.log(`  ${"symbol".padEnd(9)} ${"signals".padStart(8)} ${"in1m".padStart(6)} ${"fillRate".padStart(9)} ${"all bp".padStart(8)} ${"filled bp".padStart(10)} ${"unfilled bp".padStart(12)} ${"filled@maker".padStart(13)} ${"day-t".padStart(6)} ${"all@taker".padStart(10)} ${"verdict".padStart(9)}`);
for (const [sym, sigs] of Object.entries(dump.signals)) {
  const rows1m = await q(`trd_bars_intraday?symbol=eq.${sym}&tf=like.${K.MIN_TF}-*&select=bars&order=tf`) as { bars: number[][] }[];
  const m1 = new Map<number, number[]>(); for (const r of rows1m) for (const b of r.bars ?? []) if (b[4] > 0) m1.set(b[0], b);
  if (m1.size < +K.MIN_COVER_D * 24 * (3600 / +K.BAR_S)) { console.log(`  ${sym.padEnd(9)} coverage ${(m1.size / (24 * 3600 / +K.BAR_S)).toFixed(0)} days < 60 — UNTESTED`); continue; }
  let t0 = Infinity, t1 = -Infinity; for (const k of m1.keys()) { if (k < t0) t0 = k; if (k > t1) t1 = k; }   // spread over 130k keys blows the call stack
  const conv = sigs.filter((s) => (s[1] >= +K.P_HI || s[1] <= 1 - +K.P_HI)); const inWin = conv.filter((s) => s[0] >= t0 && s[0] + 7200 <= t1);
  if (inWin.length < 100) { console.log(`  ${sym.padEnd(9)} ${String(conv.length).padStart(8)} ${String(inWin.length).padStart(6)} — fewer than 100 signals inside the fill window — UNTESTED`); continue; }
  const all: number[] = [], filled: number[] = [], unfilled: number[] = [], dayF = new Map<number, number>(); let nFill = 0, nChecked = 0;
  let ctlSeed = 20260913;
  const coin = () => ((ctlSeed = (ctlSeed * 1103515245 + 12345) % 2147483648) / 2147483648 < 0.5 ? 1 : -1);
  for (const [ts, p, close, nextOpen, exitOpen] of inWin) {
    // CONTROL (D-886): demanding price improvement means the market must move AGAINST you before you are filled, and then
    // exiting an hour later is a dip-buy whether or not any model spoke. With CONTROL=shuffle the direction is a coin flip
    // on the identical signal times and limits, so any filled-return advantage that survives is the dip, not the model.
    const dir = K.CONTROL === "shuffle" ? coin() : p >= +K.P_HI ? 1 : -1;
    // POSITIVE-CONTROL FIX (D-641): a limit resting AT the signal close is "touched" by the very next bar's open, which
    // reported a 100% fill rate on all five perps — a broken question, not a result. Two corrections: the fill requires a
    // STRICT trade-through (touching your price does not fill you when you are behind the queue, and bar data cannot see
    // queue position), and IMPROVE_BP demands the price improvement that is the only reason to post passively at all.
    const lim = close * (1 - dir * +K.IMPROVE_BP / 1e4);
    // PRECONDITION FIX (D-598 class): coverage of the fill window must be counted INDEPENDENTLY of the fill scan. The first
    // version incremented `seen` inside the scan and broke on the fill, so a signal filled on bar 1 had seen=1 and was
    // dropped by the coverage floor — the study was silently discarding exactly its fastest fills.
    let seen = 0; for (let k = 1; k <= +K.FILL_BARS; k++) if (m1.get(ts + +K.BAR_S * k)) seen++;
    if (seen < +K.FILL_BARS / 2) continue; nChecked++;
    let hit = false;
    for (let k = 1; k <= +K.FILL_BARS; k++) { const b = m1.get(ts + +K.BAR_S * k); if (!b) continue; if (dir === 1 ? b[3] < lim : b[2] > lim) { hit = true; break; } }
    const rAll = dir * Math.log(exitOpen / nextOpen); all.push(rAll);
    if (hit) { nFill++; const r = dir * Math.log(exitOpen / lim); filled.push(r); const d = Math.floor(ts / 86400); dayF.set(d, (dayF.get(d) ?? 0) + r - +K.MAKER_BP / 1e4); } else unfilled.push(rAll);
  }
  assertNonEmpty(`${sym} checked signals`, all);
  const fr = nFill / nChecked, aBp = mean(all) * 1e4, fBp = mean(filled) * 1e4, uBp = mean(unfilled) * 1e4, fNet = fBp - +K.MAKER_BP, tF = tstat([...dayF.values()]), aTaker = aBp - +K.TAKER_BP;
  // CONTROL: the study can only detect the D-447 shape (filled loses, unfilled carries) if BOTH sets are non-empty. A
  // fill rate of 0% or 100% makes filled-vs-unfilled undefined, and the row is UNTESTED rather than a pass.
  if (filled.length < 20 || unfilled.length < 20) { console.log(`  ${sym.padEnd(9)} ${String(conv.length).padStart(8)} ${String(nChecked).padStart(6)} ${(100 * fr).toFixed(1).padStart(8)}% — filled ${filled.length} / unfilled ${unfilled.length}: no contrast, UNTESTED`); continue; }
  tested++; const ok = fr >= 0.7 && fNet > 0 && tF >= 2 && (fBp - aBp) >= -5; if (ok) supported++;
  console.log(`  ${sym.padEnd(9)} ${String(conv.length).padStart(8)} ${String(nChecked).padStart(6)} ${(100 * fr).toFixed(1).padStart(8)}% ${aBp.toFixed(2).padStart(8)} ${fBp.toFixed(2).padStart(10)} ${(uBp.toFixed(2) + "/" + unfilled.length).padStart(12)} ${fNet.toFixed(2).padStart(13)} ${tF.toFixed(2).padStart(6)} ${aTaker.toFixed(2).padStart(10)} ${(ok ? "clears" : "fails").padStart(9)}`);
  rows.push(`${sym} fill ${(100 * fr).toFixed(0)}% all ${aBp.toFixed(1)} filled ${fBp.toFixed(1)} unfilled ${uBp.toFixed(1)} (n ${unfilled.length}) filled@maker ${fNet.toFixed(1)} t ${tF.toFixed(2)}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "fill-conditional-direction", runId: K.RUN_ID, spent: Math.max(1, tested) }); const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  ${supported}/${tested} perps clear the registered rule (fill >= 70%, filled@maker > 0, day-t >= 2, filled - all >= -5bp); ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`  SUMMARY ${rows.join(" | ")}`);
