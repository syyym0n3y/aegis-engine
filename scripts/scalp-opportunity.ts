// scalp-opportunity.ts (D-955) — the operator's question, answered honestly: across EVERY trading day, on real NQ 1m,
// (a) how much money is AVAILABLE to a zone scalper (perfect foresight ceiling), (b) what DIRECTION ACCURACY at zones is
// needed to bank it (analytic break-even from the real leg/stop sizes — the key point: when legs >> fees the bar is LOW),
// (c) what a REAL MTF-trend signal actually achieves (its measured hit rate + net P&L — is it above break-even?), and
// (d) the accuracy->P&L curve, so "a machine that gets better over time" can be priced. NO assumed edge: the ceiling is
// measured, the break-even is analytic, the real signal's accuracy is empirical. This corrects the flat "can't prove
// direction" (that was whole-day rules); zone scalps with tight stops and big legs are a different economics.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("scalp-opportunity", [
  { name: "ZONE_PTS", def: "50", note: "round-number zone spacing in NQ points (+ prior-day & overnight levels)" },
  { name: "PT_VALUE", def: "20", note: "$/point NQ" }, { name: "COST_PT", def: "0.5", note: "round-trip cost in points (~1 tick + comm)" },
  { name: "MTF_MIN", def: "60", note: "trailing minutes for the MTF-trend direction signal" },
]);
const CACHE = new URL("../data/databento/NQ-1m.csv", import.meta.url).pathname;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const raw = await Deno.readTextFile(CACHE); const lines = raw.split("\n").filter(Boolean); const head = lines[0].split(",");
const ci = (n: string) => head.indexOf(n); const iT = ci("ts_event"), iO = ci("open"), iH = ci("high"), iL = ci("low"), iC = ci("close");
type Bar = { t: number; o: number; h: number; l: number; c: number; etDay: string; etMin: number };
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const bars: Bar[] = [];
for (let i = 1; i < lines.length; i++) { const p = lines[i].split(","); const o = +p[iO], h = +p[iH], l = +p[iL], c = +p[iC]; if (!(o > 0 && c > 0)) continue; const d = new Date(p[iT]); const parts = etFmt.formatToParts(d); const g = (t: string) => parts.find((x) => x.type === t)!.value; const etDay = `${g("year")}-${g("month")}-${g("day")}`; let hh = +g("hour"); if (hh === 24) hh = 0; bars.push({ t: d.getTime(), o, h, l, c, etDay, etMin: hh * 60 + +g("minute") }); }
const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.etDay) ?? byDay.set(b.etDay, []).get(b.etDay)!).push(b);
const days = [...byDay.keys()].sort(); const RTH_O = 570, RTH_C = 960, ZP = +K.ZONE_PTS, PT = +K.PT_VALUE, COST = +K.COST_PT;
// per-day zones: round levels within the day's RTH range + prior-day H/L/C + overnight H/L
type Leg = { size: number; up: boolean; sigUp: boolean; train: boolean };  // a zone-to-zone move + the MTF call + train/test flag
const legs: Leg[] = []; const perfDayPts: number[] = []; let nDays = 0, nTrainDays = 0, nTestDays = 0;
const cutDi = Math.floor(days.length * 2 / 3);                        // train = first 2/3 of days, test = last 1/3 (D-455)
for (let di = 1; di < days.length; di++) { const inTrain = di < cutDi;
  const d = days[di], prev = days[di - 1]; const all = byDay.get(d)!.sort((a, b) => a.etMin - b.etMin);
  const rth = all.filter((b) => b.etMin >= RTH_O && b.etMin < RTH_C); if (rth.length < 60) continue;
  const pAll = byDay.get(prev)!, pRth = pAll.filter((b) => b.etMin >= RTH_O && b.etMin < RTH_C); if (pRth.length < 30) continue;
  const pdH = Math.max(...pRth.map((b) => b.h)), pdL = Math.min(...pRth.map((b) => b.l)), pdC = pRth[pRth.length - 1].c;
  const on = all.filter((b) => b.etMin < RTH_O); const onH = on.length ? Math.max(...on.map((b) => b.h)) : pdH, onL = on.length ? Math.min(...on.map((b) => b.l)) : pdL;
  const rH = Math.max(...rth.map((b) => b.h)), rL = Math.min(...rth.map((b) => b.l));
  const zoneSet = new Set<number>([pdH, pdL, pdC, onH, onL]); for (let z = Math.ceil(rL / ZP) * ZP; z <= rH; z += ZP) zoneSet.add(z);
  const zones = [...zoneSet].filter((z) => z >= rL - ZP && z <= rH + ZP).sort((a, b) => a - b); if (zones.length < 3) continue;
  nDays++; if (inTrain) nTrainDays++; else nTestDays++;
  // walk the 1m path: each time price closes across into a NEW nearest-zone bracket, record the leg from the last touched zone
  const nearest = (px: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < zones.length; i++) { const dd = Math.abs(px - zones[i]); if (dd < bd) { bd = dd; bi = i; } } return bi; };
  let lastZ = nearest(rth[0].c); let lastZbar = 0; let perfDay = 0;
  for (let k = 1; k < rth.length; k++) { const zi = nearest(rth[k].c); if (zi === lastZ) continue;
    const dir = zi > lastZ ? 1 : -1;
    // MTF-trend signal at the START of the leg (when price was last AT lastZ, bar lastZbar) using ONLY prior data — no
    // look-ahead. Momentum/continuation call: sign of the trailing MTF_MIN return into the zone predicts the next leg.
    const start = rth[lastZbar]; let past: Bar | undefined; for (let j = lastZbar; j >= 0; j--) { if (rth[j].etMin <= start.etMin - +K.MTF_MIN) { past = rth[j]; break; } }
    const sigUp = past ? (start.c - past.c) >= 0 : true;
    for (let z = lastZ; z !== zi; z += dir) { const size = Math.abs(zones[z + dir] - zones[z]); if (size < 1 || size > 400) continue; legs.push({ size, up: dir > 0, sigUp, train: inTrain }); perfDay += size; }
    lastZ = zi; lastZbar = k;
  }
  perfDayPts.push(perfDay);
}
// (a) AVAILABLE MONEY (perfect foresight): capture every leg, net of fee
const nLegs = legs.length, avgLeg = mean(legs.map((l) => l.size)); const perfNetDay = mean(perfDayPts) - COST * (nLegs / nDays);
console.log(`\n==> D-955 SCALP OPPORTUNITY — NQ 1m, ${nDays} days, ${nLegs} zone-legs (${(nLegs / nDays).toFixed(1)}/day), avg leg ${avgLeg.toFixed(1)}pt, zone spacing ${ZP}pt`);
console.log(`  (a) AVAILABLE (perfect foresight): ${perfNetDay.toFixed(0)}pt/day = $${(perfNetDay * PT).toFixed(0)}/day/contract net -> ~$${(perfNetDay * PT * 252).toLocaleString()}/yr. The market DOES move; the money is real IF you call direction.`);
// (b) BREAK-EVEN ACCURACY (analytic): win = +leg-cost, loss = -stop-cost with stop=leg (symmetric adjacent zone). E = p*leg-(1-p)*leg-cost => break-even p* = 0.5 + cost/(2*leg)
const bep = 0.5 + COST / (2 * avgLeg);
console.log(`  (b) BREAK-EVEN DIRECTION ACCURACY: ${(100 * bep).toFixed(1)}% (symmetric stop). LOW because legs (${avgLeg.toFixed(0)}pt) >> cost (${COST}pt) — this is why zone scalps differ from whole-day rules: a SMALL directional edge banks the big legs.`);
// (c) REAL signals, TRAIN/TEST (D-455). TREND = continuation into the zone; FADE = reversion at the zone. Direction is
// PRE-SPECIFIED per hypothesis (not flipped post-hoc): trend from momentum-continuation, fade from mean-reversion-at-levels.
const evalSig = (fade: boolean, train: boolean) => { const sub = legs.filter((l) => l.train === train); const nd = train ? nTrainDays : nTestDays;
  const hits = sub.filter((l) => (fade ? !l.sigUp : l.sigUp) === l.up).length; const net = sub.reduce((s, l) => s + (((fade ? !l.sigUp : l.sigUp) === l.up ? l.size : -l.size) - COST), 0);
  return { hit: hits / Math.max(1, sub.length), day: net / Math.max(1, nd), n: sub.length }; };
console.log(`  (c) REAL SIGNALS, TRAIN/TEST (train ${nTrainDays}d / test ${nTestDays}d; break-even ${(100 * bep).toFixed(1)}%):`);
for (const [nm, fade] of [["TREND (continuation)", false], ["FADE (reversion at zone)", true]] as [string, boolean][]) {
  const tr = evalSig(fade, true), te = evalSig(fade, false);
  console.log(`      ${nm.padEnd(24)} TRAIN hit ${(100 * tr.hit).toFixed(1)}% ($${(tr.day * PT).toFixed(0)}/day)  ->  TEST hit ${(100 * te.hit).toFixed(1)}% ($${(te.day * PT).toFixed(0)}/day) ${te.hit > bep ? "*** OOS PROFITABLE ***" : "OOS loses"}`);
}
// (d) ACCURACY -> P&L curve (what a machine that "gets better over time" earns at each accuracy)
console.log(`  (d) ACCURACY -> P&L curve ($/day/contract; a learning machine moves UP this curve):`);
for (const p of [bep, 0.52, 0.54, 0.56, 0.60]) { const perDay = legs.reduce((s, l) => s + (p * l.size - (1 - p) * l.size - COST), 0) / nDays; console.log(`      ${(100 * p).toFixed(1).padStart(6)}%  $${(perDay * PT).toFixed(0).padStart(6)}/day  $${(perDay * PT * 252 / 1000).toFixed(0)}k/yr${Math.abs(p - bep) < 1e-6 ? "  <- break-even" : ""}`); }
console.log(`\n  READ: the money is real and break-even is LOW (${(100 * bep).toFixed(1)}%) — the whole game is achievable OOS accuracy. The naive`);
console.log(`  trend call reverses at zones; whether FADE clears break-even OUT OF SAMPLE (above) is the honest test of a fast-path edge.`);
console.log(`  CAVEAT: this ignores (i) whipsaw — the ${(nLegs / nDays).toFixed(0)} legs/day is path length, you cannot enter every one; (ii) slippage beyond the ${COST}pt; (iii) the unbounded-loss tail when a zone breaks (a real stop is not the adjacent zone). A live measurement layer (trade-journal.ts) settles those.`);
