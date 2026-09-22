#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// session-sweep-fade.ts (D-958) — the operator's Notes spec, measured on real NQ 1m: "London and Asia high-lows;
// wait for sweep on those levels; 1min look for reversal; take a 1-2R trim." This is a VARIANT INSIDE THE ONE
// ADMITTED INTRADAY FAMILY (micro-psl-fade-k24 = prior-session-low sweep fade; D-955 zone-FADE clears break-even
// OOS) — so the test is confirmatory of a family with standing evidence, not a fresh mine. PRE-SPECIFIED here,
// before running: FADE direction only (no post-hoc flip, SIGN LAW); entry LAG-1 at next 1m open (SAME-BAR
// COROLLARY); stop = the sweep extreme; targets R in {1, 1.5, 2} as a stated sensitivity; two readings of the
// note's "9AM" tested as named variants (9am LONDON = 04:00 ET, 9am NY = 09:00 ET) — every variant is a counted
// trial. Bar-interior ambiguity resolved AGAINST us (stop assumed hit first when both are inside one bar).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("session-sweep-fade", [
  { name: "COST_PT", def: "0.5", note: "round-trip cost in NQ points" },
  { name: "SWEEP_K", def: "5", note: "bars allowed between the breach and the close back inside (the 1m reversal)" },
  { name: "EXIT_AFTER_M", def: "240", note: "minutes before an open trade exits at market" },
  { name: "PT_VALUE", def: "20", note: "$/point NQ" },
]);
const CACHE = new URL("../data/databento/NQ-1m.csv", import.meta.url).pathname;
const raw = await Deno.readTextFile(CACHE); const lines = raw.split("\n").filter(Boolean); const head = lines[0].split(",");
const ci = (n: string) => head.indexOf(n); const iT = ci("ts_event"), iO = ci("open"), iH = ci("high"), iL = ci("low"), iC = ci("close");
type Bar = { o: number; h: number; l: number; c: number; etDay: string; etMin: number };
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const bars: Bar[] = [];
for (let i = 1; i < lines.length; i++) { const p = lines[i].split(","); const o = +p[iO], h = +p[iH], l = +p[iL], c = +p[iC]; if (!(o > 0 && c > 0)) continue; const parts = etFmt.formatToParts(new Date(p[iT])); const g = (t: string) => parts.find((x) => x.type === t)!.value; let hh = +g("hour"); if (hh === 24) hh = 0; bars.push({ o, h, l, c, etDay: `${g("year")}-${g("month")}-${g("day")}`, etMin: hh * 60 + +g("minute") }); }
// group by ET day; ASIA = prior day 19:00 -> this day 02:00, LONDON = this day 02:00 -> 08:00 (ET)
const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.etDay) ?? byDay.set(b.etDay, []).get(b.etDay)!).push(b);
const days = [...byDay.keys()].sort(); const COST = +K.COST_PT, SWK = +K.SWEEP_K, TOUT = +K.EXIT_AFTER_M;
type Trade = { pts: number; day: string };
const WINDOWS: Record<string, [number, number]> = { "9am-LONDON(04ET)": [4 * 60, 6 * 60], "9am-NY(09ET)": [9 * 60, 11 * 60] };
const RS = [1, 1.5, 2];
const cut = Math.floor(days.length * 2 / 3);
const results: Record<string, { train: Trade[]; test: Trade[] }> = {};
for (const wname of Object.keys(WINDOWS)) for (const R of RS) results[`${wname}|R${R}`] = { train: [], test: [] };
for (let di = 1; di < days.length; di++) {
  const d = days[di], prev = days[di - 1]; const cur = byDay.get(d)!.sort((a, b) => a.etMin - b.etMin); const pre = byDay.get(prev)!;
  const asia = [...pre.filter((b) => b.etMin >= 19 * 60), ...cur.filter((b) => b.etMin < 2 * 60)];
  const lon = cur.filter((b) => b.etMin >= 2 * 60 && b.etMin < 8 * 60);
  if (asia.length < 60 || lon.length < 60) continue;
  const levels: [string, number, "hi" | "lo"][] = [
    ["asiaH", Math.max(...asia.map((b) => b.h)), "hi"], ["asiaL", Math.min(...asia.map((b) => b.l)), "lo"],
    ["lonH", Math.max(...lon.map((b) => b.h)), "hi"], ["lonL", Math.min(...lon.map((b) => b.l)), "lo"],
  ];
  for (const [wname, [w0, w1]] of Object.entries(WINDOWS)) {
    const win = cur.filter((b) => b.etMin >= w0); if (win.length < 30) continue;
    const traded = new Set<string>();
    for (const [lname, lv, side] of levels) {
      if (traded.has(lname)) continue;
      // find a sweep inside [w0,w1]: breach beyond the level, then a 1m close back inside within SWK bars
      for (let i = 0; i < win.length && win[i].etMin < w1; i++) {
        const breach = side === "hi" ? win[i].h > lv : win[i].l < lv; if (!breach) continue;
        let ext = side === "hi" ? win[i].h : win[i].l; let sig = -1;
        for (let j = i; j < Math.min(i + SWK + 1, win.length); j++) {
          ext = side === "hi" ? Math.max(ext, win[j].h) : Math.min(ext, win[j].l);
          if (side === "hi" ? win[j].c < lv : win[j].c > lv) { sig = j; break; }
        }
        if (sig < 0 || sig + 1 >= win.length) break;                    // swept but never closed back -> no trade on this level
        const entry = win[sig + 1].o;                                    // LAG-1: next 1m open
        const risk = side === "hi" ? ext - entry : entry - ext; if (risk <= 0.5) break;
        for (const R of RS) {
          const tgt = side === "hi" ? entry - R * risk : entry + R * risk; const stop = ext;
          let pts = 0; let done = false;
          for (let j = sig + 1; j < win.length && win[j].etMin <= win[sig + 1].etMin + TOUT; j++) {
            const hitStop = side === "hi" ? win[j].h >= stop : win[j].l <= stop;
            const hitTgt = side === "hi" ? win[j].l <= tgt : win[j].h >= tgt;
            if (hitStop) { pts = -risk; done = true; break; }            // stop FIRST when both are inside one bar (against us)
            if (hitTgt) { pts = R * risk; done = true; break; }
          }
          if (!done) { const last = win.filter((b) => b.etMin <= win[sig + 1].etMin + TOUT); const px = last[last.length - 1].c; pts = side === "hi" ? entry - px : px - entry; }
          (di < cut ? results[`${wname}|R${R}`].train : results[`${wname}|R${R}`].test).push({ pts: pts - COST, day: d });
        }
        traded.add(lname); break;                                        // one trade per level per day
      }
    }
  }
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
console.log(`\n==> D-958 SESSION-SWEEP FADE (the operator's Notes spec) — NQ 1m, ${days.length} days, train ${cut}/test ${days.length - cut}, cost ${COST}pt, stop-first bar resolution`);
console.log(`    variant                      TRAIN  n    hit%   pt/tr    ->  TEST  n    hit%   pt/tr   t      $/mo/contract`);
for (const [k2, r] of Object.entries(results)) {
  const f = (a: Trade[]) => { const p = a.map((x) => x.pts); const hit = p.filter((x) => x > 0).length / Math.max(1, p.length); const m = mean(p); const t = p.length > 2 ? m / (sd(p) / Math.sqrt(p.length) || 1e-9) : 0; return { n: p.length, hit, m, t }; };
  const tr = f(r.train), te = f(r.test);
  const testDays = days.length - cut; const perMo = te.m * te.n / Math.max(1, testDays) * 21 * +K.PT_VALUE;
  console.log(`    ${k2.padEnd(26)} ${String(tr.n).padStart(6)}  ${(100 * tr.hit).toFixed(1).padStart(5)}  ${tr.m.toFixed(2).padStart(6)}      ${String(te.n).padStart(6)}  ${(100 * te.hit).toFixed(1).padStart(5)}  ${te.m.toFixed(2).padStart(6)}  ${te.t.toFixed(2).padStart(5)}  $${perMo.toFixed(0).padStart(6)} ${te.m > 0 && tr.m > 0 ? "  ** OOS POSITIVE **" : ""}`);
}
console.log(`\n  READ: expectancy is NET of ${COST}pt cost, per trade, with the stop assumed hit first inside any ambiguous bar.`);
console.log(`  Family context: micro-psl-fade-k24 (admitted, fwd-psl-fade clock live), D-955 zone-fade OOS 51.6% > 50.7% BE, D-825 placeable-index fade t 1.9-2.1 OOS.`);
console.log(`  6 variants tested = 6 trials (counted). One instrument, ${days.length} days — a positive here feeds the micro rung review, it does not skip the ladder.`);
