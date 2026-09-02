#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run
// forward-score-specs.ts (W3) — spec-specific scoring, so a matured clock produces a NUMBER rather than a flag.
//
// D-613 built the clock tracker: it records elapsed days and goes RED when a rule matures without a verdict. That
// closes the "nobody scored it" gap but leaves the harder one — when maturity arrives, SOMETHING must compute the
// realised statistic each rule names. Otherwise the red just sits there and a human decides what the data meant,
// which is the discretion the pre-registration existed to remove.
//
// Each rule gets a measurement that returns its own promote/kill statistic. Where the forward window is too short
// to compute anything, the scorer says so explicitly — "not yet computable" is a different state from "computed and
// inconclusive", and conflating them is how a clock quietly stops meaning anything.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("forward-score-specs", [{ name: "VERBOSE", def: "" }, { name: "BACKDATE", def: "", note: "D-658: score a clock from this date instead of its registered start, to EXERCISE scorer paths that real elapsed time has not yet reached. Verification only — never a way to restate a live clock." }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fss", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const q = async (path: string) => await fetch(`${OWNED}/${path}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);

interface Score { metric: string; value: number | null; n: number; note: string }

// Each scorer returns the statistic ITS OWN RULE names. Returning null with a reason is a valid outcome and is
// deliberately distinguished from returning a number.
const SCORERS: Record<string, (started: string) => Promise<Score>> = {
  // Rule: >=30 marked months, realised Sharpe >= 0.40, maxDD < 6%.
  "fwd-book-p2-paper": async () => {
    const rows = await q(`trd_paper_book?select=mo,managed_ret&order=mo`) as { mo: string; managed_ret: number }[];
    if (!rows.length) return { metric: "monthly_sharpe", value: null, n: 0, note: "trd_paper_book holds ZERO marks; the French panel ends 2026-06 so the first markable month has not occurred" };
    const r = rows.map((x) => +x.managed_ret).filter(Number.isFinite);
    if (r.length < 6) return { metric: "monthly_sharpe", value: null, n: r.length, note: `only ${r.length} marks; rule requires 30` };
    return { metric: "monthly_sharpe", value: (mean(r) / (sd(r) || 1e-9)) * Math.sqrt(12), n: r.length, note: `rule needs >=30 months and Sharpe >= 0.40` };
  },
  // Rule: positive net over >=126 forward days, portfolio t >= 2.0, gate selects >=5 instruments on most days.
  "fwd-residual-follow": async (started) => {
    const rows = await q(`trd_attribution?asof=gt.${started}&select=asof,symbol,adj_r2,era_stability,residual&limit=50000`) as
      { asof: string; symbol: string; adj_r2: number; era_stability: number; residual: number }[];
    if (!rows.length) {
      const newest = await q(`trd_attribution?select=asof&order=asof.desc&limit=1`) as { asof: string }[];
      const na = newest[0]?.asof ?? "none";
      // The engine stamps asof = last AVAILABLE PRICE DATE, which lags the calendar by several days. A clock
      // registered while that stamp was already behind its start date cannot accrue until prices catch up, so its
      // EFFECTIVE start is later than its registered one. Saying "no rows" without this reads as a broken engine.
      return { metric: "portfolio_t", value: null, n: 0,
        note: `no rows after ${started}; newest attribution asof is ${na}, which LAGS the clock start because the engine stamps asof = last available price date. Effective clock start is later than registered — not a stalled engine.` };
    }
    const byD = new Map<string, number>();
    const gated = new Map<string, number>();
    for (const r of rows) {
      const ok = +r.adj_r2 >= 0.15 && +r.adj_r2 <= 0.95 && +r.era_stability >= 0.4;
      gated.set(r.asof, (gated.get(r.asof) ?? 0) + (ok ? 1 : 0));
    }
    const days = [...gated.keys()].length;
    const thin = [...gated.values()].filter((n) => n < 5).length;
    // D-658 POWER FLOOR. The registered rule asks for ">=126 forward days" with a portfolio t, but the attribution
    // engine stamps at a MEDIAN 31-DAY CADENCE (264 stamps over 22 years) — so 126 days is FOUR observations, and a
    // t-statistic on four points is not a statistic. The rule is immutable by design and cannot be corrected; what
    // CAN be corrected is this scorer reporting a number the rule would accept and no one should believe. Below 20
    // observations it returns UNDERPOWERED rather than a t, and says how long the rule's own horizon really needs.
    const MIN_OBS = 20;
    if (days < MIN_OBS) {
      return { metric: "portfolio_t", value: null, n: days,
        note: `${days} attribution stamp(s) since the clock start. UNDERPOWERED BY CONSTRUCTION, not merely early: the rule asks for >=126 forward DAYS, but attribution stamps at a ~31-day cadence, so the rule's own horizon yields ~4 observations. ${MIN_OBS} stamps (~${Math.round(MIN_OBS * 31 / 30.44)} months) are needed before a portfolio t means anything. Gate selects <5 instruments on ${thin}/${days} day(s) — the rule's KILL clause.` };
    }
    return { metric: "portfolio_t", value: null, n: days,
      note: `${days} attribution stamp(s); gate selects <5 instruments on ${thin}/${days} — the rule's KILL clause.` };
  },
  // Rule: >=250 forward trading days, realised Sharpe >= 0.60.
  "fwd-crypto-lit5": async (started) => {
    const rows = await q(`trd_crypto_forward?select=d&order=d.desc&limit=1`) as { d: string }[];
    const el = Math.floor((Date.now() - Date.parse(started + "T00:00:00Z")) / 86400000);
    return { metric: "realised_sharpe", value: null, n: el,
      note: `${el} calendar day(s) elapsed of the 250 TRADING days the rule requires${rows.length ? "" : "; no forward table rows yet"}` };
  },
  // Rule: forward t >= 2.04 over >=12 scored months.
  "fwd-payout-8": async (started) => {
    const el = Math.floor((Date.now() - Date.parse(started + "T00:00:00Z")) / 86400000);
    return { metric: "forward_t", value: null, n: el, note: `${el} day(s) elapsed; rule needs >=12 scored months (~365d)` };
  },
  // Rule: t >= 2.0 over >=104 weeks in BOTH universes, same sign.
  "fwd-hedging-pressure-flip": async (started) => {
    const el = Math.floor((Date.now() - Date.parse(started + "T00:00:00Z")) / 86400000);
    return { metric: "portfolio_t_both_universes", value: null, n: el,
      note: `${el} day(s) of the 728 required. Scored by scripts/cot-crosssectional.ts and tff-crosssectional.ts with FROM_D set to the clock start.` };
  },
  // Rule: t <= -2.0 over >=104 weeks, effect present in the liquid half.
  "fwd-ftd-persistence-short": async (started) => {
    const el = Math.floor((Date.now() - Date.parse(started + "T00:00:00Z")) / 86400000);
    return { metric: "portfolio_t", value: null, n: el,
      note: `${el} day(s) of the 728 required. Scored by scripts/ftd-persistence.ts with FROM_D=${started} and LIQUID_ONLY=1.` };
  },
  // Rule (D-733): >=20 NEW liquid spincos with 500d; 500d liquid MEDIAN excess vs IWM >= +10pp; win>55%; top-5<40%.
  // This scorer computes exactly that statistic on spincos from 10-12B filings AFTER the clock start — self-contained,
  // reusing the spinoff-event.ts logic (inception discipline, survivorship-corrected, size-matched vs IWM, liquid
  // tercile, judged on the MEDIAN). Returns null with a count while <20 accrue (the honest not-yet-computable state).
  "fwd-spinoff-premium": async (started) => {
    const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    const addCal = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const bars = async (sym: string): Promise<number[][]> => { const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`); return ((raw?.[0]?.bars) || []).filter((b: number[]) => b[4] > 0); };
    const evts = (await q(`trd_raw_filings?filing_type=like.10-12B%25&ticker=not.is.null&disclosed_date=gt.${started}&select=ticker,disclosed_date&order=disclosed_date`) as { ticker: string; disclosed_date: string }[])
      .filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.disclosed_date));
    const iwm = new Map((await bars("IWM")).map((b) => [iso(b[0]), b[4]]));
    const rows: { ex: number; dv: number }[] = [];
    for (const e of evts) {
      const b = await bars(e.ticker); if (b.length < 60) continue;
      const dt = b.map((x) => iso(x[0])); const first = dt[0];
      if (!(first >= e.disclosed_date && first <= addCal(e.disclosed_date, 150))) continue;   // inception discipline
      let iT = 500;
      if (iT >= b.length) { if (dt[dt.length - 1] >= "2026-06-01") continue; iT = b.length - 1; }   // survivorship: delisters to last bar
      const p0 = b[0][4], p1 = b[iT][4], s0 = iwm.get(dt[0]), s1 = iwm.get(dt[iT]);
      if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
      const dv = b.map((x) => x[4] * x[5]); const medDV = [...dv].sort((a, z) => a - z)[dv.length >> 1];
      rows.push({ ex: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dv: medDV });
    }
    const liq = rows.sort((a, b) => a.dv - b.dv).slice(Math.floor(rows.length * 2 / 3)).map((x) => x.ex);
    if (liq.length < 20) return { metric: "liq_median_excess_vs_iwm_500d_pp", value: null, n: liq.length, note: `${liq.length} new liquid spincos with full 500d forward data since ${started}; rule needs >=20 (~3-4y to accrue). not-yet-computable.` };
    const med = [...liq].sort((a, b) => a - b)[liq.length >> 1];
    const win = 100 * liq.filter((x) => x > 0).length / liq.length;
    const s = [...liq].sort((a, b) => b - a); const tot = liq.reduce((p, x) => p + x, 0); const top5 = tot ? 100 * s.slice(0, 5).reduce((p, x) => p + x, 0) / tot : 0;
    return { metric: "liq_median_excess_vs_iwm_500d_pp", value: med, n: liq.length,
      note: `${liq.length} new liquid spincos: median ${med.toFixed(1)}pp, win-rate ${win.toFixed(0)}%, top-5 ${top5.toFixed(0)}%. PROMOTE if median>=+10 & win>55 & top5<40; KILL if median<=0 / win<50 / top5>60.` };
  },
  // Rule (D-734): >=15 NEW de-SPACs with 500d; FULL-universe 500d MEDIAN excess vs IWM <= -10pp; win<45% -> persists.
  // Tests whether the -40.7pp in-sample de-SPAC underperformance is structural or a 2020-21 boom artifact. Full
  // universe (the effect is in illiquid names), from the completion 8-K date, survivorship-corrected.
  "fwd-despac-underperf": async (started) => {
    const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    const barsOf = async (sym: string): Promise<number[][]> => { const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`); return ((raw?.[0]?.bars) || []).filter((b: number[]) => b[4] > 0); };
    const evts = (await q(`trd_raw_filings?filing_type=like.%25despac%25&ticker=not.is.null&disclosed_date=gt.${started}&select=ticker,disclosed_date&order=disclosed_date`) as { ticker: string; disclosed_date: string }[])
      .filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.disclosed_date));
    const first = new Map<string, string>();
    for (const e of evts) { const c = first.get(e.ticker); if (!c || e.disclosed_date < c) first.set(e.ticker, e.disclosed_date); }
    const iwm = new Map((await barsOf("IWM")).map((b) => [iso(b[0]), b[4]]));
    const exs: number[] = [];
    for (const [tk, d] of first) {
      const b = await barsOf(tk); if (b.length < 40) continue;
      const dt = b.map((x) => iso(x[0])); const ci = dt.findIndex((x) => x >= d); if (ci < 0) continue;
      let iT = ci + 500; if (iT >= b.length) { if (dt[dt.length - 1] >= "2026-06-01") continue; iT = b.length - 1; }
      if (iT <= ci) continue;
      const p0 = b[ci][4], p1 = b[iT][4], s0 = iwm.get(dt[ci]), s1 = iwm.get(dt[iT]);
      if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
      exs.push(((p1 / p0 - 1) - (s1 / s0 - 1)) * 100);
    }
    if (exs.length < 15) return { metric: "median_excess_vs_iwm_500d_pp", value: null, n: exs.length, note: `${exs.length} new de-SPACs with 500d since ${started}; rule needs >=15. Post-boom de-SPAC volume is low — may stay inconclusive. not-yet-computable.` };
    const m = [...exs].sort((a, b) => a - b)[exs.length >> 1];
    const win = 100 * exs.filter((x) => x > 0).length / exs.length;
    return { metric: "median_excess_vs_iwm_500d_pp", value: m, n: exs.length, note: `${exs.length} new de-SPACs: median ${m.toFixed(1)}pp, win-rate ${win.toFixed(0)}%. PERSISTS if median<=-10 & win<45; BOOM-ARTIFACT if median>=0 / win>55.` };
  },
  // D-734c: identical mechanism to v1, but reads the CORRECT completion source — 8-K Item 5.06 (filing_type
  // despac-506, ingest-despac-506.ts) instead of the IPO-closing 8-Ks v1 matched. v1 is superseded (immutable, left
  // in place); this is the clock that should be READ.
  "fwd-despac-underperf-v2": async (started) => {
    const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    const barsOf = async (sym: string): Promise<number[][]> => { const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`); return ((raw?.[0]?.bars) || []).filter((b: number[]) => b[4] > 0); };
    const evts = (await q(`trd_raw_filings?filing_type=like.%25despac-506%25&ticker=not.is.null&disclosed_date=gt.${started}&select=ticker,disclosed_date&order=disclosed_date`) as { ticker: string; disclosed_date: string }[])
      .filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.disclosed_date));
    const first = new Map<string, string>();
    for (const e of evts) { const c = first.get(e.ticker); if (!c || e.disclosed_date < c) first.set(e.ticker, e.disclosed_date); }
    const iwm = new Map((await barsOf("IWM")).map((b) => [iso(b[0]), b[4]]));
    const exs: number[] = [];
    for (const [tk, d] of first) {
      const b = await barsOf(tk); if (b.length < 40) continue;
      const dt = b.map((x) => iso(x[0])); const ci = dt.findIndex((x) => x >= d); if (ci < 0) continue;
      let iT = ci + 500; if (iT >= b.length) { if (dt[dt.length - 1] >= "2026-06-01") continue; iT = b.length - 1; }
      if (iT <= ci) continue;
      const p0 = b[ci][4], p1 = b[iT][4], s0 = iwm.get(dt[ci]), s1 = iwm.get(dt[iT]);
      if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
      exs.push(((p1 / p0 - 1) - (s1 / s0 - 1)) * 100);
    }
    if (exs.length < 15) return { metric: "median_excess_vs_iwm_500d_pp", value: null, n: exs.length, note: `${exs.length} new de-SPACs (5.06 dated) with 500d since ${started}; rule needs >=15. First possible read ~2028-09; post-boom volume is low. not-yet-computable.` };
    const m = [...exs].sort((a, b) => a - b)[exs.length >> 1];
    const win = 100 * exs.filter((x) => x > 0).length / exs.length;
    return { metric: "median_excess_vs_iwm_500d_pp", value: m, n: exs.length, note: `${exs.length} new de-SPACs (5.06): median ${m.toFixed(1)}pp, win-rate ${win.toFixed(0)}%. PERSISTS if median<=-10 & win<45; BOOM-ARTIFACT if median>=0 / win>55.` };
  },
  // Rule (D-750): widest-discount tercile of the LIQUID ($vol > $1m/day) CEF universe, monthly, lag-1, equal-weight,
  // scored as the EXCESS over the equal-weight LIQUID CEF universe (BENCHMARK LAW — never the wide-minus-narrow
  // spread). PROMOTE at >=24 scored months with excess >= 2.5%/yr AND t >= 2.0; KILL at >=24 months with excess <= 0
  // or t <= 0, OR AT ANY n on a single month worse than -8%.
  //
  // It reads data/cef-panel.json, the compact monthly panel written by scripts/refresh-cef.ts (wired into the daily
  // runner) rather than the 160MB bar cache — a scorer that needs 7GB of heap every morning is a scorer that gets
  // commented out. Universe membership therefore refreshes monthly with the panel, so a fund counts until it stops
  // trading and the forward window does not inherit the in-sample survivorship hole.
  "fwd-cef-discount": async (started) => {
    const M = "excess_ann_pct_vs_liquid_universe";
    let panel: { rows: { t: string; m: string; apx: number; disc: number; dv: number }[]; built: string };
    try { panel = JSON.parse(await Deno.readTextFile(new URL("../data/cef-panel.json", import.meta.url).pathname)); }
    catch { return { metric: M, value: null, n: 0, note: `data/cef-panel.json is ABSENT — scripts/refresh-cef.ts has not run. This is a BROKEN QUESTION, not an accruing clock (D-641): a missing panel and a zero-month clock both report nothing.` }; }
    const fromM = started.slice(0, 7);
    const nowM = new Date().toISOString().slice(0, 7);
    const byT = new Map<string, typeof panel.rows>();
    for (const r of panel.rows) { const a = byT.get(r.t) ?? []; a.push(r); byT.set(r.t, a); }
    // forward observations: signal at month-end t, return t -> t+1, consecutive calendar months only
    const per = new Map<string, { disc: number; dv: number; ret: number }[]>();
    for (const a of byT.values()) {
      a.sort((x, y) => x.m < y.m ? -1 : 1);
      for (let i = 0; i < a.length - 1; i++) {
        const c = a[i], n = a[i + 1];
        const dm = (+n.m.slice(0, 4) - +c.m.slice(0, 4)) * 12 + (+n.m.slice(5) - +c.m.slice(5));
        if (dm !== 1) continue;
        if (c.m < fromM) continue;              // strictly after the clock start
        if (n.m >= nowM) continue;              // the RETURN month must be complete; the running month is partial
        const ret = n.apx / c.apx - 1;
        if (!Number.isFinite(ret) || Math.abs(ret) > 0.6) continue;
        const g = per.get(c.m) ?? []; g.push({ disc: c.disc, dv: c.dv, ret }); per.set(c.m, g);
      }
    }
    const ex: number[] = []; const breaches: string[] = [];
    for (const m of [...per.keys()].sort()) {
      const liq = per.get(m)!.filter((o) => o.dv > 1_000_000);
      if (liq.length < 9) continue;             // too thin to form a tercile; the month is not scored, not zero
      const s = [...liq].sort((x, y) => x.disc - y.disc);
      const k = Math.floor(s.length / 3);
      const e = mean(s.slice(0, k).map((o) => o.ret)) - mean(liq.map((o) => o.ret));
      ex.push(e);
      if (e < -0.08) breaches.push(`${m} ${(100 * e).toFixed(1)}%`);
    }
    const ann = ex.length ? mean(ex) * 12 * 100 : 0;
    const t = ex.length >= 3 ? mean(ex) / ((sd(ex) || 1e-12) / Math.sqrt(ex.length)) : 0;
    // The one condition that fires before the horizon: a single month worse than -8% kills regardless of n.
    if (breaches.length) {
      return { metric: M, value: ann, n: ex.length,
        note: `IMMEDIATE KILL CONDITION MET at n=${ex.length} scored month(s): single-month excess below -8% in ${breaches.join(", ")}. Annualised excess so far ${ann.toFixed(2)}%/yr, t ${t.toFixed(2)}. The rule kills on this at ANY n; it does not wait for 24 months.` };
    }
    if (ex.length < 24) {
      return { metric: M, value: null, n: ex.length,
        note: `${ex.length} scored month(s) since ${fromM}; the rule permits a magnitude decision only at >=24 (~2028-08). ACCRUING — not-yet-computable, NOT inconclusive. Panel built ${panel.built.slice(0, 10)}, ${byT.size} funds. ${ex.length ? `Running excess ${ann.toFixed(2)}%/yr, t ${t.toFixed(2)} — reported for visibility and DECIDES NOTHING; the rule's inconclusive clause forbids reading a short window as evidence either way.` : "No completed forward month yet."}` };
    }
    return { metric: M, value: ann, n: ex.length,
      note: `${ex.length} scored months from ${fromM}: excess ${ann.toFixed(2)}%/yr over the equal-weight liquid CEF universe, portfolio t ${t.toFixed(2)}. PROMOTE if >=2.5%/yr AND t>=2.0; KILL if <=0%/yr OR t<=0; otherwise INCONCLUSIVE. In-sample was +5.54%/yr (t 8.09) and survivorship-inflated, so the bar is deliberately below it.` };
  },
};

const rules = await q(`trd_forward_rules?select=id,clock_started,promote_if,kill_if`) as
  { id: string; clock_started: string; promote_if: string; kill_if: string }[];

console.log(`==> FORWARD SPEC SCORING — ${rules.length} clock(s)\n`);
let computable = 0;
for (const r of rules.sort((a, b) => a.id < b.id ? -1 : 1)) {
  const fn = SCORERS[r.id];
  if (!fn) { console.log(`  NO SCORER  ${r.id} — a clock with no measurement is a flag, not a test`); continue; }
  // D-658: a scorer path that has never executed is unverified (D-613). BACKDATE exercises the paths real time has
  // not yet reached. It changes what is SCORED, never what was REGISTERED — the rule itself remains immutable.
  const started = Deno.env.get("BACKDATE") || r.clock_started;
  const s = await fn(started);
  const val = s.value === null ? "not-yet-computable" : s.value.toFixed(3);
  if (s.value !== null) computable++;
  console.log(`  ${r.id.padEnd(28)} ${s.metric.padEnd(26)} ${val.padStart(18)}  n=${s.n}`);
  console.log(`      ${s.note}`);
  // A BACKDATE run VERIFIES the scorer path (D-613) — it must NOT write a mark, or a backdated in-sample value lands
  // in the append-only forward record looking like a real forward observation (it did, once, for fwd-spinoff-premium
  // — corrected by an appended note). trd_forward_marks is the immutable record of REAL forward readings only.
  if (Deno.env.get("BACKDATE")) { console.log(`      (BACKDATE verification — no mark written)`); continue; }
  await fetch(`${OWNED}/trd_forward_marks`, {
    method: "POST",   // plumbing-ok: audited — response checked on the next line and reported per rule
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify({ rule_id: r.id, elapsed_days: s.n, metric_name: s.metric, metric_value: s.value, n_obs: s.n, note: s.note, matured: false }),
  }).then((res) => { if (!res.ok) console.log(`      WRITE-FAILED mark ${res.status}`); }).catch(() => console.log(`      WRITE-FAILED mark (network)`));
}
console.log(`\n  ${computable} of ${rules.length} clock(s) currently produce a number; the rest state why not.`);
console.log(`  "not-yet-computable" is deliberately distinct from "computed and inconclusive" — conflating them is`);
console.log(`  how a forward clock quietly stops meaning anything.`);
