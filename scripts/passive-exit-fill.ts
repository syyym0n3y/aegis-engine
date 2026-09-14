// D-891 — the passive EXIT, the last condition standing between the direction model and a claim.
// D-890 showed that at a zero round trip (both legs maker) XRP reaches day-t 4.02 and BNB 4.65 against a 3.67 ceiling on
// the 4-hour hold. D-885 already measured the passive ENTRY fills 100% of the time within an hour. The exit never has
// been. THE EXECUTION LAW's failure shape lives on this leg: you are filled on the exit when price comes back through
// your level, which is when the move you were holding has stopped, so the filled exits can be the worse ones.
// Construction: enter at the next hourly open (assumed, per the entry study), rest a closing limit at the price four
// hours later, and let it work for one hour of 5-minute bars. Where it fills, the exit is that limit. Where it does not,
// the position is closed at TAKER at the end of the wait — the tail is reported separately because a small unfilled
// fraction can carry a disproportionate loss, which is competing hypothesis (2).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("passive-exit-fill", [
  { name: "SIGNALS", def: "data/direction-signals-1h-H4.json" },
  { name: "P_HI", def: "0.55", note: "the REGISTERED threshold; 0.65 was chosen post-hoc and is deliberately not used" },
  { name: "TF", def: "5m" }, { name: "BAR_S", def: "300" }, { name: "WAIT_BARS", def: "12", note: "one hour of work for the closing limit" },
  { name: "MAKER_BP", def: "0", note: "per leg; 0 = the deepest real maker tier, which is the condition D-890 isolated" },
  { name: "TAKER_BP", def: "1.7", note: "per leg, VIP9, charged on exits that do not fill passively" },
  { name: "RUN_ID", def: "D-891-passive-exit-fill" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function mkJwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pxf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await mkJwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const tstat = (a: number[]) => { if (a.length < 3) return 0; const m = mean(a); const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); return v > 0 ? m / Math.sqrt(v / a.length) : 0; };
const dump = JSON.parse(await Deno.readTextFile(K.SIGNALS)) as { signals: Record<string, number[][]> };
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`==> D-891 PASSIVE EXIT FILL — closing limit rests ${K.WAIT_BARS} x ${K.TF}; maker ${K.MAKER_BP}bp/leg, taker ${K.TAKER_BP}bp/leg on the unfilled tail. Ceiling ${ceil.ceiling.toFixed(2)}.`);
console.log(`  ${"symbol".padEnd(9)} ${"sigs".padStart(6)} ${"exitFill%".padStart(9)} ${"assumed bp".padStart(11)} ${"executed bp".padStart(12)} ${"diff".padStart(7)} ${"tail bp/n".padStart(12)} ${"exec day-t".padStart(10)} ${"verdict".padStart(10)}`);
let tested = 0, ok = 0; const lines: string[] = [];
for (const [sym, sigs] of Object.entries(dump.signals)) {
  const rows = await q(`trd_bars_intraday?symbol=eq.${sym}&tf=like.${K.TF}-*&select=bars&order=tf`) as { bars: number[][] }[];
  const m5 = new Map<number, number[]>(); for (const r of rows) for (const b of r.bars ?? []) if (b[4] > 0) m5.set(b[0], b);
  if (m5.size < 0.95 * 730 * 288) { console.log(`  ${sym.padEnd(9)} 5m coverage ${(100 * m5.size / (730 * 288)).toFixed(1)}% of grid — UNTESTED`); continue; }
  let t0 = Infinity, t1 = -Infinity; for (const k of m5.keys()) { if (k < t0) t0 = k; if (k > t1) t1 = k; }
  const conv = sigs.filter((s) => s[1] > +K.P_HI || s[1] < 1 - +K.P_HI);
  const inWin = conv.filter((s) => s[5] >= t0 && s[5] + +K.BAR_S * (+K.WAIT_BARS + 1) <= t1);
  if (inWin.length < 200) { console.log(`  ${sym.padEnd(9)} ${String(inWin.length).padStart(6)} signals inside the 5m window — UNTESTED (floor 200)`); continue; }
  const assumed: number[] = [], executed: number[] = [], tail: number[] = [], dayE = new Map<number, number>(); let fills = 0, n = 0;
  for (const [, p, , nextOpen, exitOpen, exitTs] of inWin) {
    const dir = p > +K.P_HI ? 1 : -1;
    let seen = 0; for (let k = 1; k <= +K.WAIT_BARS; k++) if (m5.get(exitTs + +K.BAR_S * k)) seen++;
    if (seen < +K.WAIT_BARS / 2) continue;   // coverage counted independently of the scan (the D-886 defect, not repeated)
    n++;
    // closing a LONG means selling: the limit rests at exitOpen and fills when price trades strictly ABOVE it.
    let hit = 0;
    for (let k = 1; k <= +K.WAIT_BARS; k++) { const b = m5.get(exitTs + +K.BAR_S * k); if (!b) continue; if (dir === 1 ? b[2] > exitOpen : b[3] < exitOpen) { hit = exitOpen; break; } }
    const lastBar = (() => { for (let k = +K.WAIT_BARS; k >= 1; k--) { const b = m5.get(exitTs + +K.BAR_S * k); if (b) return b[4]; } return exitOpen; })();
    const aR = dir * Math.log(exitOpen / nextOpen) - 2 * +K.MAKER_BP / 1e4;
    let eR: number;
    if (hit) { fills++; eR = dir * Math.log(hit / nextOpen) - 2 * +K.MAKER_BP / 1e4; }
    else { eR = dir * Math.log(lastBar / nextOpen) - (+K.MAKER_BP + +K.TAKER_BP) / 1e4; tail.push(eR * 1e4); }
    assumed.push(aR * 1e4); executed.push(eR * 1e4);
    const d = Math.floor(exitTs / 86400); dayE.set(d, (dayE.get(d) ?? 0) + eR * 1e4);
  }
  assertNonEmpty(`${sym} usable signals`, assumed, 200);
  const fr = fills / n, aM = mean(assumed), eM = mean(executed), tE = tstat([...dayE.values()]), diff = eM - aM;
  tested++; const pass = fr >= 0.9 && tE >= ceil.ceiling && diff >= -2; if (pass) ok++;
  console.log(`  ${sym.padEnd(9)} ${String(n).padStart(6)} ${(100 * fr).toFixed(1).padStart(8)}% ${aM.toFixed(2).padStart(11)} ${eM.toFixed(2).padStart(12)} ${diff.toFixed(2).padStart(7)} ${`${tail.length ? mean(tail).toFixed(1) : "–"}/${tail.length}`.padStart(12)} ${tE.toFixed(2).padStart(10)} ${(pass ? "clears" : "fails").padStart(10)}`);
  lines.push(`${sym} fill ${(100 * fr).toFixed(0)}% assumed ${aM.toFixed(1)} executed ${eM.toFixed(1)} diff ${diff.toFixed(1)} tail ${tail.length ? mean(tail).toFixed(1) : "-"}/${tail.length} t ${tE.toFixed(2)}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "passive-exit-fill", runId: K.RUN_ID, spent: Math.max(1, tested) });
console.log(`\n  ${ok}/${tested} perps clear the registered rule (exit fill >= 90%, executed day-t >= ${ceil.ceiling.toFixed(2)}, executed-minus-assumed >= -2bp)`);
console.log(`  SUMMARY ${lines.join(" | ")}`);
