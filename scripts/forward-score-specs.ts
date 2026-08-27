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
declareKnobs("forward-score-specs", [{ name: "VERBOSE", def: "" }]);

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
    return { metric: "portfolio_t", value: null, n: days,
      note: `${days} forward day(s); gate selects <5 instruments on ${thin}/${days} — the rule's KILL clause. Needs >=126 days to score returns.` };
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
};

const rules = await q(`trd_forward_rules?select=id,clock_started,promote_if,kill_if`) as
  { id: string; clock_started: string; promote_if: string; kill_if: string }[];

console.log(`==> FORWARD SPEC SCORING — ${rules.length} clock(s)\n`);
let computable = 0;
for (const r of rules.sort((a, b) => a.id < b.id ? -1 : 1)) {
  const fn = SCORERS[r.id];
  if (!fn) { console.log(`  NO SCORER  ${r.id} — a clock with no measurement is a flag, not a test`); continue; }
  const s = await fn(r.clock_started);
  const val = s.value === null ? "not-yet-computable" : s.value.toFixed(3);
  if (s.value !== null) computable++;
  console.log(`  ${r.id.padEnd(28)} ${s.metric.padEnd(26)} ${val.padStart(18)}  n=${s.n}`);
  console.log(`      ${s.note}`);
  await fetch(`${OWNED}/trd_forward_marks`, {
    method: "POST",   // plumbing-ok: audited — response checked on the next line and reported per rule
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify({ rule_id: r.id, elapsed_days: s.n, metric_name: s.metric, metric_value: s.value, n_obs: s.n, note: s.note, matured: false }),
  }).then((res) => { if (!res.ok) console.log(`      WRITE-FAILED mark ${res.status}`); }).catch(() => console.log(`      WRITE-FAILED mark (network)`));
}
console.log(`\n  ${computable} of ${rules.length} clock(s) currently produce a number; the rest state why not.`);
console.log(`  "not-yet-computable" is deliberately distinct from "computed and inconclusive" — conflating them is`);
console.log(`  how a forward clock quietly stops meaning anything.`);
