#!/usr/bin/env -S deno run --allow-net --allow-env
// placeable-subset-test.ts (D-825) — PREREG D-825-placeable-subset-psl-fade.
// The micro rule measured ONLY where a UK retail operator can legally place it: XAUUSD, USA500IDXUSD, USATECHIDXUSD.
// The subset is fixed by an EXTERNAL criterion (FCA COBS 22.6 bans the crypto perps; IG's FX CFD minimum is ~100x the
// intended size so the product is a spread bet) plus one PRIOR registered measurement (D-764: the FX majors flat OOS).
// Construction is D-763/764/767's exactly: hourly bars, prior-SESSION low, a close below it with the prior close above
// is the sweep, entry lag-1 at the NEXT bar's open, exit at the close 24 bars later. Reported per instrument (never
// pooled-only, D-590), gross beside net (D-661/662), at BOTH the measured venue cost and the model 4bp, against the
// unconditional 24h forward return as the benchmark (D-627/630). Trials 12.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("placeable-subset-test", [
  { name: "RUN_ID", def: "D-825-placeable-subset-psl-fade" },
  { name: "SPLIT", def: "2023-01-01", note: "train/test boundary, frozen D-455" },
  { name: "KK", def: "24", note: "holding period in hourly bars (the D-767 survivor horizon)" },
  { name: "RVOL_HI", def: "1.5", note: "same-UTC-hour relative volume threshold (D-767)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pst", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) || 1e-9) / Math.sqrt(a.length)) : NaN;
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
/* measured venue cost per K24 hold (D-823d: IG published spread + overnight funding once per 22:00 UK crossing, benchmark assumed 4%/yr) */
const VENUE_BP: Record<string, number> = { XAUUSD: 2.2, USA500IDXUSD: 2.4, USATECHIDXUSD: 2.2 };
const MODEL_BP = 4;
const KK = +K.KK, SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
const DAY_T: Record<string, number> = {}, EX_T: Record<string, number> = {}, DAY_N: Record<string, number> = {}, DAY_M: Record<string, number> = {}, EX_M: Record<string, number> = {};
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "placeable-subset", runId: K.RUN_ID, spent: 12 });
console.log(`\n==> D-825 THE RULE WHERE IT CAN BE PLACED — XAUUSD / USA500IDXUSD / USATECHIDXUSD, K${KK} fade, split ${K.SPLIT}. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()} (mined); the pre-registered bar is scripts/prereg-ceiling.ts.`);
interface Ev { ts: number; gross: number; rvol: number; }
const per: Record<string, { train: Ev[]; test: Ev[]; uncond: number[] }> = {};
for (const sym of Object.keys(VENUE_BP)) {
  const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  assertNonEmpty(`${sym} hourly bars`, rows, 20000);
  const b: Bar[] = rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
  const psl = priorSessionLevels(b);
  const train: Ev[] = [], test: Ev[] = [], uncond: number[] = [];
  const hourVol = new Map<number, number[]>();
  for (const x of b) { const h = new Date(x.ts * 1000).getUTCHours(); (hourVol.get(h) ?? hourVol.set(h, []).get(h)!).push(x.v); }
  let firedAt: number | undefined;
  for (let i = 1; i < b.length - KK - 1; i++) {
    /* BENCHMARK: the unconditional K-bar forward return from every bar, the universe mean this rule must beat */
    uncond.push(Math.log(b[i + 1 + KK].c / b[i + 1].o));
    const lvl = psl[i]?.low; if (lvl === undefined) continue;
    if (!(b[i - 1].c >= lvl && b[i].c < lvl) || firedAt === lvl) continue;
    firedAt = lvl;
    const gross = Math.log(b[i + 1 + KK].c / b[i + 1].o);     /* lag-1: enter at the NEXT bar's open */
    const sameHour = b.slice(Math.max(0, i - 24 * 60), i).filter((x) => new Date(x.ts * 1000).getUTCHours() === new Date(b[i].ts * 1000).getUTCHours()).slice(-30).map((x) => x.v);
    const rvol = sameHour.length >= 10 ? b[i].v / (median(sameHour) || 1e-9) : NaN;
    (b[i].ts < SPLIT ? train : test).push({ ts: b[i].ts, gross, rvol });
  }
  per[sym] = { train, test, uncond };
}
const bp = (x: number) => (x * 1e4).toFixed(2);
for (const [label, cost] of [["MEASURED VENUE COST (D-823d)", "venue"], ["MODEL 4bp (as registered in D-767)", "model"]] as const) {
  console.log(`\n  === ${label} ===`);
  console.log(`  ${"instrument".padEnd(15)} ${"cond".padEnd(8)} ${"n(test)".padStart(7)} ${"net bp".padStart(8)} ${"t".padStart(6)} ${"gross bp".padStart(9)} ${"gross t".padStart(8)} ${"uncond bp".padStart(10)} ${"excess bp".padStart(10)}`);
  const pooled: Record<string, number[]> = { base: [], rvol: [] };
  const signs: Record<string, { pos: number; tested: number }> = { base: { pos: 0, tested: 0 }, rvol: { pos: 0, tested: 0 } };
  for (const sym of Object.keys(VENUE_BP)) {
    const rt = (cost === "venue" ? VENUE_BP[sym] : MODEL_BP) / 1e4;
    const u = mean(per[sym].uncond);
    for (const cond of ["base", "rvol"] as const) {
      const evs = per[sym].test.filter((e) => cond === "base" ? true : (Number.isFinite(e.rvol) && e.rvol >= +K.RVOL_HI));
      const g = evs.map((e) => e.gross), n = evs.map((e) => e.gross - rt);
      pooled[cond].push(...n);
      if (n.length >= 20) { signs[cond].tested++; if (mean(n) > 0) signs[cond].pos++; }
      console.log(`  ${sym.padEnd(15)} ${cond.padEnd(8)} ${String(n.length).padStart(7)} ${bp(mean(n)).padStart(8)} ${tstat(n).toFixed(2).padStart(6)} ${bp(mean(g)).padStart(9)} ${tstat(g).toFixed(2).padStart(8)} ${bp(u).padStart(10)} ${bp(mean(g) - u).padStart(10)}`);
    }
  }
  for (const cond of ["base", "rvol"] as const) {
    const p = pooled[cond];
    console.log(`  POOLED ${cond.padEnd(8)} n ${p.length}  net ${bp(mean(p))}bp  t ${tstat(p).toFixed(2)} (EVENT t - treats correlated instruments as independent; see the day-clustered line)  sign ${signs[cond].pos}/${signs[cond].tested} instruments positive at n>=20`);
    /* ADVERSARIAL PASS, added before any verdict was reported. S&P and Nasdaq move together, so events on the same day
       are not independent draws and an event-level t can overstate precision. Day-clustering averages the net across
       every event that day and takes t on the daily series (n = days). The excess over the unconditional 24h return
       gets the same treatment, because an excess with no t is the D-630 shape.
       WHAT THIS TURNED OUT TO BE, AND THE LABEL I HAD TO CORRECT. I first called the day-level line "stricter". It is
       NOT: its mean is ~3x the event mean (19bp vs 6bp) and its t is HIGHER (5.8 vs 3.0). The cause is real structure,
       measured below - days carrying FEW simultaneous sweeps return strongly positive and days carrying many return
       negative - so equal-weighting days upweights the quiet days where the fade works, which is a SIZING CHOICE, not a
       neutral statistic. The event-level number is the one that describes taking every signal at a fixed size per
       position, and it stays the headline. The day-level number is reported beside it as what an equal-capital-per-day
       book would have done, and never as a more conservative version of the same thing. */
    const byDay = new Map<string, number[]>(), exDay = new Map<string, number[]>();
    for (const sym of Object.keys(VENUE_BP)) {
      const rt = (cost === "venue" ? VENUE_BP[sym] : MODEL_BP) / 1e4;
      const u = mean(per[sym].uncond);
      for (const e of per[sym].test) {
        if (cond === "rvol" && !(Number.isFinite(e.rvol) && e.rvol >= +K.RVOL_HI)) continue;
        const d = new Date(e.ts * 1000).toISOString().slice(0, 10);
        (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e.gross - rt);
        (exDay.get(d) ?? exDay.set(d, []).get(d)!).push(e.gross - u);
      }
    }
    const daily = [...byDay.values()].map(mean), exDaily = [...exDay.values()].map(mean);
    console.log(`  ${"".padEnd(7)}${cond.padEnd(8)} DAY-CLUSTERED: ${daily.length} day(s)  net ${bp(mean(daily))}bp  portfolio t ${tstat(daily).toFixed(2)}  |  EXCESS over the unconditional 24h return ${bp(mean(exDaily))}bp  t ${tstat(exDaily).toFixed(2)}`);
    if (cond === "base") { DAY_T[cost] = tstat(daily); EX_T[cost] = tstat(exDaily); DAY_N[cost] = daily.length; DAY_M[cost] = mean(daily); EX_M[cost] = mean(exDaily); }
  }
  if (cost === "venue") {
    /* the registered clauses, computed mechanically on the venue-cost table */
    const p = pooled.base, tt = tstat(p);
    const uAll = mean(Object.keys(VENUE_BP).flatMap((s) => per[s].uncond));
    const grossAll = mean(Object.keys(VENUE_BP).flatMap((s) => per[s].test.map((e) => e.gross)));
    let verdict: string;
    if (p.length < 150) verdict = `UNDERPOWERED — pooled OOS n ${p.length} < 150`;
    else if (mean(p) <= 0 || tt < 2.0) verdict = `NULL — pooled net ${bp(mean(p))}bp at t ${tt.toFixed(2)} (rule needs > 0 and t >= 2.0)`;
    else if (signs.base.pos < 2) verdict = `NULL — only ${signs.base.pos}/${signs.base.tested} instruments positive (rule needs >= 2)`;
    else if (grossAll - uAll <= 0) verdict = `NULL — excess over the unconditional 24h return is ${bp(grossAll - uAll)}bp (rule needs > 0)`;
    else verdict = `SUPPORTED ON THE LETTER OF THE RULE — pooled net ${bp(mean(p))}bp, event t ${tt.toFixed(2)}, ${signs.base.pos}/${signs.base.tested} positive, excess ${bp(grossAll - uAll)}bp`;
    console.log(`\n  VERDICT (base, measured venue cost, AS REGISTERED): ${verdict}`);
    /* The rule was written with an EVENT-level t and an excess with no t. Both are weaker than this programme's own
       standard, and the honest reading is the stricter one - stated beside the registered verdict, never instead of it. */
    console.log(`  DAY-LEVEL (equal capital per trading day, NOT a stricter version of the above): net ${bp(DAY_M.venue)}bp/day, t ${DAY_T.venue?.toFixed(2)} on ${DAY_N.venue} days; excess over drift t ${EX_T.venue?.toFixed(2)}. Higher than the event number because it equal-weights days — a sizing choice, see the breadth table.`);
    console.log(`  CAVEAT THAT SURVIVES EITHER READING: gross ${bp(grossAll)}bp against an unconditional 24h return of ${bp(uAll)}bp — roughly ${(100 * uAll / Math.max(1e-9, grossAll)).toFixed(0)}% of the gross is drift the instruments deliver anyway, and only ${bp(grossAll - uAll)}bp is the signal.`);
    /* DESCRIPTIVE ONLY (MECHANISM LAW): the breadth relationship below was seen AFTER the fact. It is not claimable and
       is not used by any rule here; acting on it needs its own pre-registration and held-out data (D-511b/D-553). */
    const byDayAll = new Map<string, number[]>();
    for (const sym of Object.keys(VENUE_BP)) for (const e of per[sym].test) { const d = new Date(e.ts * 1000).toISOString().slice(0, 10); (byDayAll.get(d) ?? byDayAll.set(d, []).get(d)!).push(e.gross - VENUE_BP[sym] / 1e4); }
    const buckets = new Map<number, number[]>();
    for (const v of byDayAll.values()) { const k = Math.min(6, v.length); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(mean(v)); }
    /* HOLDABILITY LAW: a deployment candidate states its longest TIME UNDERWATER, not just a drawdown depth. */
    const days = [...byDayAll.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
    let cum = 0, peak = 0, peakAt = days[0]?.[0] ?? "", worstD = 0, worstFrom = "", worstTo = "", depth = 0;
    const dayMs = 86400000;
    for (const [d, v] of days) {
      cum += mean(v);
      if (cum >= peak) { peak = cum; peakAt = d; } else {
        const dd = (Date.parse(d) - Date.parse(peakAt)) / dayMs;
        if (dd > worstD) { worstD = dd; worstFrom = peakAt; worstTo = d; }
        depth = Math.min(depth, cum - peak);
      }
    }
    console.log(`  HOLDABILITY: longest time underwater ${worstD.toFixed(0)} calendar days (${worstFrom} -> ${worstTo}); deepest drawdown ${bp(depth)}bp of cumulative day-level return. Depth is not the risk, duration is (D-565/566).`);
    console.log(`  DESCRIPTIVE ONLY, post-hoc, NOT claimable — net by number of simultaneous sweeps that day: ` +
      [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k === 6 ? "6+" : k}: ${bp(mean(v))}bp (${v.length}d)`).join("  "));
    console.log(`  SIGN: pre-registered direction POSITIVE — ${mean(p) > 0 ? "MATCHED" : "MISSED"} on the pooled OOS mean.`);
  }
}
console.log(`\n  TRAIN (context only, never the decision): ` + Object.keys(VENUE_BP).map((s) => `${s} n ${per[s].train.length}`).join(" | "));
