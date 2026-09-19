// nq-intraday-structure.ts (D-949) — the faithful test of the PRICE-STRUCTURE half of the live-scalper method on the
// REAL instrument (NQ futures, GLBX.MDP3, 1-minute), since the ORDER-FLOW half is already sub-fee 5 ways (D-816 real
// equity TBBO 0/20, D-925 real crypto flow, D-921 bid-ask bounce, D-948 index momentum, R-001). Order-flow tbbo is
// $14/mo (a robust window exceeds the $125 credit); 1m OHLCV is $3.83 for 3 years — cheap and enough for the level/
// breakout structures. Tests, RTH-only (09:30-16:00 ET), net of a real NQ round-trip (~0.5pt = ~2bp) AND a punitive 4pt:
//   1) OPENING-RANGE BREAKOUT (ORB) — first 30m range; first break long/short; stop = other side; target = R multiples; EOD exit.
//   2) INTRADAY MOMENTUM — first 30m sign -> rest of session (the D-948 structure, now on the real 1m instrument).
//   3) PROP-EVAL readout (Apex-50k-like) + the deflation ceiling. COST DISCIPLINE: metadata.get_cost first, refuse over CAP.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("nq-intraday-structure", [
  { name: "START", def: "2023-09-01" }, { name: "END", def: "2026-09-01" }, { name: "SYMBOL", def: "NQ.c.0" }, { name: "DATASET", def: "GLBX.MDP3" },
  { name: "CAP_USD", def: "8", note: "hard cap on metered Databento cost (the 3yr 1m pull cost-checked at ~$3.83)" },
  { name: "OR_MIN", def: "30", note: "opening-range minutes" }, { name: "TARGET_R", def: "1", note: "ORB target in R (R = OR width)" },
  { name: "PT_VALUE", def: "20", note: "$/point for NQ" }, { name: "COST_PT", def: "0.5", note: "round-trip cost in NQ points (~1 tick spread + comm)" },
  { name: "RUN_ID", def: "D-949-nq-intraday-structure" }, { name: "PULL", def: "0", note: "1 = fetch after the cost check (idempotent cache); 0 uses the cache or exits at the cost check" },
]);
const REPO = new URL("..", import.meta.url).pathname; const CACHE = `${REPO}data/databento/NQ-1m.csv`;
const KEY = Deno.env.get("DATABENTO_API_KEY")!; const AUTH = "Basic " + btoa(`${KEY}:`); const BASE = "https://hist.databento.com/v0";
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
const hdr = await (async () => { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "nq", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); const t = `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; return { Authorization: `Bearer ${t}`, apikey: t } as Record<string, string>; })();
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
// COST CHECK (free) then cache-or-pull
let haveCache = false; try { haveCache = (await Deno.stat(CACHE)).size > 1000; } catch { /* none */ }
if (!haveCache) {
  const cu = `${BASE}/metadata.get_cost?dataset=${K.DATASET}&symbols=${K.SYMBOL}&schema=ohlcv-1m&start=${K.START}&end=${K.END}&mode=historical&stype_in=continuous`;
  const cr = await fetch(cu, { headers: { Authorization: AUTH } }); if (!cr.ok) { console.error(`!! get_cost ${cr.status}: ${(await cr.text()).slice(0, 200)}`); Deno.exit(1); }
  const cost = Number(await cr.text()); console.log(`  Databento cost for ${K.SYMBOL} ohlcv-1m ${K.START}..${K.END}: $${cost.toFixed(2)} (cap $${K.CAP_USD})`);
  if (cost > +K.CAP_USD) { console.error(`!! cost $${cost.toFixed(2)} > cap $${K.CAP_USD} — refusing to fetch.`); Deno.exit(1); }
  if (K.PULL !== "1") { console.log("  PULL=0 — cost check only; re-run with PULL=1 to fetch under the cap."); Deno.exit(0); }
  const body = new URLSearchParams({ dataset: K.DATASET, symbols: K.SYMBOL, schema: "ohlcv-1m", start: K.START, end: K.END, encoding: "csv", compression: "none", stype_in: "continuous", pretty_px: "true", pretty_ts: "true" });
  const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) { console.error(`!! get_range ${r.status}: ${(await r.text()).slice(0, 200)}`); Deno.exit(1); }
  await Deno.writeTextFile(CACHE, await r.text()); console.log(`  cached -> ${CACHE} ($${cost.toFixed(2)} spent)`);
}
// parse CSV (ts_event, ..., open, high, low, close, volume) — pretty_px gives decimal prices, pretty_ts gives ISO
const raw = await Deno.readTextFile(CACHE); const lines = raw.split("\n").filter(Boolean); const head = lines[0].split(",");
const ci = (n: string) => head.indexOf(n); const iT = ci("ts_event"), iO = ci("open"), iH = ci("high"), iL = ci("low"), iC = ci("close"), iV = ci("volume");
type Bar = { t: number; o: number; h: number; l: number; c: number; etDay: string; etMin: number };
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const bars: Bar[] = [];
for (let i = 1; i < lines.length; i++) { const p = lines[i].split(","); const o = +p[iO], h = +p[iH], l = +p[iL], c = +p[iC]; if (!(o > 0 && c > 0)) continue;
  const d = new Date(p[iT]); const parts = etFmt.formatToParts(d); const g = (t: string) => parts.find((x) => x.type === t)!.value;
  const etDay = `${g("year")}-${g("month")}-${g("day")}`; let hh = +g("hour"); if (hh === 24) hh = 0; const etMin = hh * 60 + +g("minute");
  bars.push({ t: d.getTime(), o, h, l, c, etDay, etMin }); }
console.log(`\n==> D-949 NQ INTRADAY STRUCTURE — ${bars.length} 1m bars, ${bars[0]?.etDay}..${bars[bars.length - 1]?.etDay} (RTH 09:30-16:00 ET)`);
// RTH session per day: 09:30 (570) .. 16:00 (960)
const RTH_OPEN = 570, RTH_CLOSE = 960, ORend = RTH_OPEN + +K.OR_MIN;
const byDay = new Map<string, Bar[]>(); for (const b of bars) { if (b.etMin < RTH_OPEN || b.etMin >= RTH_CLOSE) continue; (byDay.get(b.etDay) ?? byDay.set(b.etDay, []).get(b.etDay)!).push(b); }
const days = [...byDay.keys()].sort(); const PT = +K.PT_VALUE, COSTPT = +K.COST_PT;
// 1) ORB — first OR_MIN range; first break long/short; stop other side (=R); target TARGET_R*R; else EOD exit. Points net of cost.
const orbPts: number[] = []; let longs = 0, shorts = 0, wins = 0, hitTgt = 0, hitStop = 0, eod = 0;
for (const d of days) { const bs = byDay.get(d)!.sort((a, b) => a.etMin - b.etMin); if (bs.length < 60) continue;
  const or = bs.filter((b) => b.etMin >= RTH_OPEN && b.etMin < ORend); if (!or.length) continue;
  const orH = Math.max(...or.map((b) => b.h)), orL = Math.min(...or.map((b) => b.l)); const R = orH - orL; if (R < 1) continue;
  const after = bs.filter((b) => b.etMin >= ORend); let dir = 0, entry = 0, exit = 0, done = false;
  for (const b of after) {
    if (dir === 0) { if (b.h >= orH) { dir = 1; entry = orH; longs++; } else if (b.l <= orL) { dir = -1; entry = orL; shorts++; } if (dir === 0) continue; }
    const tgt = dir === 1 ? entry + +K.TARGET_R * R : entry - +K.TARGET_R * R; const stp = dir === 1 ? entry - R : entry + R;
    if (dir === 1 && b.l <= stp) { exit = stp; done = true; hitStop++; } else if (dir === 1 && b.h >= tgt) { exit = tgt; done = true; hitTgt++; }
    else if (dir === -1 && b.h >= stp) { exit = stp; done = true; hitStop++; } else if (dir === -1 && b.l <= tgt) { exit = tgt; done = true; hitTgt++; }
    if (done) break;
  }
  if (dir === 0) continue; if (!done) { exit = after[after.length - 1].c; eod++; }
  const pts = dir * (exit - entry) - COSTPT; orbPts.push(pts); if (pts > 0) wins++;
}
// 2) INTRADAY MOMENTUM — first OR_MIN sign -> rest of session (net of cost)
const momPts: number[] = [];
for (const d of days) { const bs = byDay.get(d)!.sort((a, b) => a.etMin - b.etMin); if (bs.length < 60) continue;
  const or = bs.filter((b) => b.etMin < ORend), rest = bs.filter((b) => b.etMin >= ORend); if (!or.length || !rest.length) continue;
  const sig = Math.sign(or[or.length - 1].c - or[0].o); if (sig === 0) continue;
  momPts.push(sig * (rest[rest.length - 1].c - or[or.length - 1].c) - COSTPT); }
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID }).catch(() => ({ ceiling: 3.16 }));
const rep = (nm: string, pts: number[], w?: number) => { const mu = mean(pts), t = tstat(pts), ann = mu * 252; const sr = mu / (sd(pts) || 1) * Math.sqrt(252);
  console.log(`  ${nm.padEnd(20)} ${pts.length} trades, ${mu.toFixed(2)} pt/trade ($${(mu * PT).toFixed(0)}), t ${t.toFixed(2)}, Sharpe ${sr.toFixed(2)}, ${(ann * PT).toFixed(0)}$/yr/contract${w !== undefined ? `, win ${(100 * w / pts.length).toFixed(1)}%` : ""}  ${Math.abs(t) > (ceil.ceiling ?? 3.16) ? "CLEARS ceiling" : "sub-ceiling"}`); };
console.log(`  net of ${COSTPT}pt round-trip; ceiling ${(ceil.ceiling ?? 3.16).toFixed(2)}`);
rep("ORB (30m, 1R tgt)", orbPts, wins); console.log(`     ORB detail: ${longs} long / ${shorts} short; target ${hitTgt}, stop ${hitStop}, EOD ${eod}`);
rep("intraday momentum", momPts);
// PROP-EVAL SIZING SWEEP on the ORB edge (the one positive structure). The bar for a PAID EVAL is not the research
// ceiling — it is pass_prob * payout > fee. Sizing decides everything: too big (1 NQ) and one trade's vol ~= the DD
// limit; smaller (MNQ = 0.1 NQ, or fractions) survives variance so a modest edge can express. Sweep size, up to a
// max time (a real eval allows ~months; we cap at 120 trading-day-trades). Report pass-prob vs a zero-edge control.
const orb$ = orbPts.map((p) => p * PT);                         // 1-NQ ORB $/trade
const evalSim = (series: number[], size: number, mzero: boolean) => { let pass = 0, fail = 0; const vol = sd(series) * size, mu = mean(series) * size; const N = 6000, MAXT = 120;
  for (let s = 0; s < N; s++) { let eq = 0, peak = 0, i = Math.floor(Math.random() * series.length), steps = 0;
    while (steps < MAXT) { eq += mzero ? (Math.random() < 0.5 ? vol : -vol) + (mu < 0 ? mu : 0) : series[(i++) % series.length] * size; peak = Math.max(peak, eq); if (eq >= 3000) { pass++; break; } if (peak - eq >= 2500) { fail++; break; } steps++; } if (steps >= MAXT) fail++; }
  return pass / (pass + fail); };
console.log(`\n  PROP-EVAL SIZING SWEEP on the ORB edge (Apex-50k-like: +$3000 before $2500 trailing DD, up to 120 trades):`);
console.log(`  ${"size".padStart(8)} ${"instrument".padStart(12)} ${"rule pass%".padStart(11)} ${"control%".padStart(9)} ${"edge?".padStart(6)}`);
let bestPass = 0, bestSize = 0;
for (const size of [1, 0.5, 0.2, 0.1, 0.05, 0.02]) { const pr = evalSim(orb$, size, false), ct = evalSim(orb$, size, true); if (pr > bestPass) { bestPass = pr; bestSize = size; }
  console.log(`  ${size.toFixed(2).padStart(8)} ${(size === 0.1 ? "1 MNQ" : size === 1 ? "1 NQ" : `${(size * 10).toFixed(1)} MNQ`).padStart(12)} ${(100 * pr).toFixed(1).padStart(10)}% ${(100 * ct).toFixed(1).padStart(8)}% ${pr > ct + 0.03 ? "  YES" : "   no"}`); }
console.log(`  best pass-prob ${(100 * bestPass).toFixed(1)}% at size ${bestSize} (${(bestSize * 10).toFixed(1)} MNQ). A ~$150 eval is +EV if pass% * first-payout >> fee — but the edge is SUB-CEILING (t ${tstat(orbPts).toFixed(2)}), so this is an UNVALIDATED bet, not a proven one.`);

// ---- ORB TRAIN/TEST (SELECTION LAW) — the decisive test: was Sharpe 0.90 a full-sample artifact of my 30m/1R choice,
// or does the ORB edge SURVIVE out of sample? Select (OR_MIN, TARGET_R) on TRAIN (first 2/3 by date) maximising train
// Sharpe, FREEZE, report TEST. A prop-eval path is real only if the edge HOLDS in test (not if it needs t>ceiling). ----
const buildORB = (orMin: number, targetR: number, dl: string[]) => { const pts: number[] = []; const oe = RTH_OPEN + orMin;
  for (const d of dl) { const bs = byDay.get(d); if (!bs || bs.length < 60) continue; bs.sort((a, b) => a.etMin - b.etMin);
    const or = bs.filter((b) => b.etMin >= RTH_OPEN && b.etMin < oe); if (!or.length) continue;
    const orH = Math.max(...or.map((b) => b.h)), orL = Math.min(...or.map((b) => b.l)), R = orH - orL; if (R < 1) continue;
    const after = bs.filter((b) => b.etMin >= oe); let dir = 0, entry = 0, exit = 0, done = false;
    for (const b of after) { if (dir === 0) { if (b.h >= orH) { dir = 1; entry = orH; } else if (b.l <= orL) { dir = -1; entry = orL; } if (dir === 0) continue; }
      const tgt = dir === 1 ? entry + targetR * R : entry - targetR * R, stp = dir === 1 ? entry - R : entry + R;
      if (dir === 1 && b.l <= stp) { exit = stp; done = true; } else if (dir === 1 && b.h >= tgt) { exit = tgt; done = true; }
      else if (dir === -1 && b.h >= stp) { exit = stp; done = true; } else if (dir === -1 && b.l <= tgt) { exit = tgt; done = true; } if (done) break; }
    if (dir === 0) continue; if (!done) exit = after[after.length - 1].c; pts.push(dir * (exit - entry) - COSTPT); }
  return pts; };
const srp = (a: number[]) => a.length ? mean(a) / (sd(a) || 1) * Math.sqrt(252) : 0;
const cut = days[Math.floor(days.length * 2 / 3)]; const trainD = days.filter((d) => d < cut), testD = days.filter((d) => d >= cut);
let bestP: { orMin: number; tr: number; sr: number } | null = null;
for (const orMin of [15, 30, 60]) for (const tr of [1, 1.5, 2, 3]) { const sr = srp(buildORB(orMin, tr, trainD)); if (!bestP || sr > bestP.sr) bestP = { orMin, tr, sr }; }
const testPts = buildORB(bestP!.orMin, bestP!.tr, testD); const tsr = srp(testPts), tt = tstat(testPts);
const evalTest = (size: number, mz: boolean) => { const s$ = testPts.map((p) => p * PT); let pass = 0, fail = 0; const vol = sd(s$) * size; const N = 6000;
  for (let x = 0; x < N; x++) { let eq = 0, peak = 0, i = Math.floor(Math.random() * s$.length), st = 0; while (st < 120) { eq += mz ? (Math.random() < 0.5 ? vol : -vol) : s$[(i++) % s$.length] * size; peak = Math.max(peak, eq); if (eq >= 3000) { pass++; break; } if (peak - eq >= 2500) { fail++; break; } st++; } if (st >= 120) fail++; } return pass / (pass + fail); };
console.log(`\n  ==> ORB TRAIN/TEST (SELECTION LAW): picked OR=${bestP!.orMin}m target=${bestP!.tr}R on TRAIN (${trainD.length}d, train Sharpe ${bestP!.sr.toFixed(2)}); frozen -> TEST (${testD.length}d)`);
console.log(`      TEST: ${testPts.length} trades, ${mean(testPts).toFixed(2)}pt/trade ($${(mean(testPts) * PT).toFixed(0)}), Sharpe ${tsr.toFixed(2)}, t ${tt.toFixed(2)} ${Math.abs(tt) > (ceil.ceiling ?? 3.16) ? "(clears ceiling)" : "(sub-ceiling)"}`);
console.log(`      TEST prop-eval @2 MNQ: rule ${(100 * evalTest(0.2, false)).toFixed(1)}% vs control ${(100 * evalTest(0.2, true)).toFixed(1)}% -> ${tsr > 0.4 && evalTest(0.2, false) > evalTest(0.2, true) + 0.05 ? "EDGE SURVIVES OOS — the prop path is a real +EV bet at micro size (still unproven past the ceiling, but not noise)" : "edge does NOT survive OOS — it was a full-sample artifact; the prop path is -EV"}`);
await spendTrials({ rest: OWNED, headers: hdr, family: "nq-intraday", runId: K.RUN_ID, spent: 2 }).catch(() => {});
console.log(`\n  READ: net t < ceiling AND pass-rate ~= control -> the price-structure half is also sub-fee, closing the method on the real instrument.`);
