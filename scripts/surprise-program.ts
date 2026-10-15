#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// surprise-program.ts (D-987) — THE SURPRISE-EFFECT PROGRAMME: register -> run -> record, nightly.
//
// SP_MODE=register  inserts every row of surprise-registry.ts into trd_prereg (append-only, immutable). If a row with the
//                same id already exists its text must match EXACTLY, else RED: the registration cannot drift.
// SP_MODE=run    (default) for each registration: is its data present and its floor met? If yes, compute the
//                registered statistic, spend trials under the prereg id, and — only when the rule is DECISIVE — write
//                the outcome ONCE (trd_prereg outcome is write-once by trigger). Writes research/surprise-ledger.json and
//                docs/SURPRISE_EFFECTS.md every run, so accruing tests are re-checked every night shift and the moment a
//                floor is met it is scored without anyone remembering to.
//
// Laws applied in code, not prose: POSITIVE CONTROL before any null (an unpriced proxy is UNTESTED); SIGN stated and
// checked; smaller-|t| decides; BENCHMARK = intercept-absorbed drift (slope test) + excess vs universe for x-sec;
// EFFECT in bp per 1sd vs the stated round trip; DSR/MinTRL/PBO on the net trading expression; the D-823 split
// ceiling paid for through spendTrials/preregCeiling. Survivors become a trd_forward_rules clock — never capital.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { preregCeiling, spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { deflatedSharpe, kurtosis, minTRL, pboCSCV, skewness } from "../supabase/functions/_shared/trd-stats.ts";
import { SURPRISE_PREREGS } from "./surprise-registry.ts";

const K = declareKnobs("surprise-program", [
  { name: "SP_MODE", def: "run", note: "register | run (named SP_MODE: macOS sets COMMAND_MODE, a near-miss of MODE)" },
  { name: "WRITE_OUTCOME", def: "1", note: "1 = write decisive outcomes to trd_prereg (write-once); 0 = dry" },
  { name: "LEDGER_OUT", def: "research/surprise-ledger.json" },
  { name: "DOC_OUT", def: "docs/SURPRISE_EFFECTS.md" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const REPO = new URL("..", import.meta.url).pathname;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "srp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const tok = await jwt();
const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);

type PreregRow = { id: string; claim: string; competing: string; rule: string; kill_condition: string; registered_at: string; outcome: string | null; outcome_note: string | null };

// ------------------------------------------------------------------------------------------------- MODE=register
if (K.SP_MODE === "register") {
  let inserted = 0, matched = 0;
  for (const p of SURPRISE_PREREGS) {
    const have = await q(`trd_prereg?id=eq.${encodeURIComponent(p.id)}&select=id,claim,competing,rule,kill_condition`) as PreregRow[];
    if (have.length) {
      const h = have[0];
      if (h.claim !== p.claim || h.competing !== p.competing || h.rule !== p.rule || h.kill_condition !== p.kill_condition) {
        console.error(`!! RED ${p.id}: a registration with this id exists and its text DIFFERS from surprise-registry.ts — the`);
        console.error(`   registry was edited after registering. trd_prereg is the authority; restore the registry text.`);
        Deno.exit(1);
      }
      matched++; console.log(`  = ${p.id} already registered, text identical`); continue;
    }
    const r = await fetch(`${OWNED}/trd_prereg`, { method: "POST", headers: { ...hdr, Prefer: "return=representation" }, // plumbing-ok: status checked next line
      body: JSON.stringify({ id: p.id, claim: p.claim, competing: p.competing, rule: p.rule, kill_condition: p.kill_condition }) });
    if (!r.ok) { console.error(`!! RED insert ${p.id}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); Deno.exit(1); }
    const back = await r.json() as PreregRow[];
    console.log(`  + ${p.id} registered_at ${back[0]?.registered_at}`); inserted++;
  }
  // POSITIVE CONTROL: every registry id must now read back.
  const ids = SURPRISE_PREREGS.map((p) => p.id);
  const got = await q(`trd_prereg?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id`) as { id: string }[];
  if (got.length !== ids.length) { console.error(`!! RED read-back ${got.length}/${ids.length}`); Deno.exit(1); }
  console.log(`==> registered ${inserted} new, ${matched} already present; ${got.length}/${ids.length} read back.`);
  Deno.exit(0);
}

// ------------------------------------------------------------------------------------------------- helpers
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
interface Ols { b: number; t: number; tNW1: number; n: number }
function ols(x: number[], y: number[]): Ols {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxy / (sxx || 1e-18); const a = my - b * mx;
  const e = y.map((v, i) => v - a - b * x[i]);
  const s2 = e.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2);
  const t = b / Math.sqrt(s2 / (sxx || 1e-18));
  // Newey-West(1) on the slope: S = sum u_i^2 + 2*w1*sum u_i u_{i-1}, u_i = (x_i - mx) e_i
  const u = x.map((v, i) => (v - mx) * e[i]);
  let S = u.reduce((s, v) => s + v * v, 0); let c1 = 0; for (let i = 1; i < n; i++) c1 += u[i] * u[i - 1]; S += 2 * 0.5 * c1;
  const tNW1 = b / Math.sqrt(Math.max(1e-30, S) / (sxx * sxx));
  return { b, t, tNW1, n };
}
const smallerT = (o: Ols) => Math.abs(o.t) <= Math.abs(o.tNW1) ? o.t : o.tNW1;
async function bars(sym: string): Promise<number[][]> {
  const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[];
  return ((raw?.[0]?.bars || []) as number[][]).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
}
async function series(name: string): Promise<{ d: string; v: number }[]> {
  const out: { d: string; v: number }[] = [];
  for (let off = 0; ; off += 5000) {
    const p = await q(`trd_macro_series?series=eq.${encodeURIComponent(name)}&select=d,v&order=d.asc&offset=${off}&limit=5000`) as { d: string; v: number }[];
    out.push(...p); if (p.length < 5000) break;
  }
  return out;
}

interface Verdict {
  id: string; status: "UNTESTED" | "ACCRUING" | "REJECTED" | "BELOW-BAR" | "UNDERPOWERED" | "SURVIVED";
  decisive: boolean; summary: string; numbers: Record<string, unknown>;
}

// Generic weekly/monthly release test (T1 claims, T2 CPI). events: entry index into the price series + z per variant.
interface Ev { d: string; i: number; z: number[] }
function releaseTest(id: string, events: Ev[], px: number[][], variants: string[], costBp: number, ceiling: number, splitFrac = 2 / 3) {
  const c = px.map((b) => b[4]);
  const day0 = (e: Ev) => c[e.i] / c[e.i - 1] - 1;
  const fwd5 = (e: Ev) => c[e.i + 5] / c[e.i] - 1;
  const ok = events.filter((e) => e.i >= 1 && e.i + 5 < c.length && e.z.every(Number.isFinite));
  const z0 = ok.map((e) => e.z[0]);
  const ctrl = ols(z0, ok.map(day0));
  const prim = ols(z0, ok.map(fwd5));
  const cut = Math.floor(ok.length * splitFrac);
  const h1 = ols(z0.slice(0, cut), ok.slice(0, cut).map(fwd5)), h2 = ols(z0.slice(cut), ok.slice(cut).map(fwd5));
  // eras by decade (descriptive)
  const eras: Record<string, { n: number; bBp: number; t: number }> = {};
  for (const dec of [...new Set(ok.map((e) => e.d.slice(0, 3)))]) {
    const sub = ok.filter((e) => e.d.slice(0, 3) === dec); if (sub.length < 30) continue;
    const o = ols(sub.map((e) => e.z[0]), sub.map(fwd5)); eras[`${dec}0s`] = { n: o.n, bBp: +(o.b * 1e4).toFixed(2), t: +o.t.toFixed(2) };
  }
  // trading expression per variant: p = -clip(z,-2,2)/2, net = p*r5 - |p|*cost
  const netOf = (k: number) => ok.map((e) => { const p = -Math.max(-2, Math.min(2, e.z[k])) / 2; return p * fwd5(e) - Math.abs(p) * costBp / 1e4; });
  const grossOf = (k: number) => ok.map((e) => -Math.max(-2, Math.min(2, e.z[k])) / 2 * fwd5(e));
  const nets = variants.map((_, k) => netOf(k));
  const net = nets[0], gross = grossOf(0);
  const sr = mean(net) / (sd(net) || 1e-18);
  const sk = skewness(net), ku = kurtosis(net);
  const nTrialsForDsr = Math.max(2, Math.round(Math.exp(ceiling * ceiling / 2)));
  const dsr = deflatedSharpe(sr, net.length, sk, ku, nTrialsForDsr, 1 / Math.max(1, net.length - 1));
  const mtrl = minTRL(sr, 0, sk, ku, 0.95);
  const M = net.map((_, r) => nets.map((s) => s[r]));
  const pbo = variants.length >= 2 ? pboCSCV(M, 8).pbo : NaN;
  const effBp = Math.abs(prim.b) * 1e4;
  const decT = smallerT(prim);
  const nums = {
    n_events: ok.length, span: `${ok[0]?.d}..${ok.at(-1)?.d}`,
    control_day0: { slope_bp_per_sd: +(ctrl.b * 1e4).toFixed(2), t: +ctrl.t.toFixed(2), tNW1: +ctrl.tNW1.toFixed(2) },
    primary_fwd5: { slope_bp_per_sd: +(prim.b * 1e4).toFixed(2), t: +prim.t.toFixed(2), tNW1: +prim.tNW1.toFixed(2), deciding_t: +decT.toFixed(2) },
    half1: { n: h1.n, slope_bp: +(h1.b * 1e4).toFixed(2), t: +h1.t.toFixed(2) }, half2: { n: h2.n, slope_bp: +(h2.b * 1e4).toFixed(2), t: +h2.t.toFixed(2) },
    eras, effect_x_cost: +(effBp / costBp).toFixed(2), cost_bp_round_trip: costBp, ceiling: +ceiling.toFixed(3),
    trading_expression: { gross_mean_bp: +(mean(gross) * 1e4).toFixed(2), net_mean_bp: +(mean(net) * 1e4).toFixed(2), net_sr_per_event: +sr.toFixed(4), dsr: +dsr.toFixed(3), minTRL: Number.isFinite(mtrl) ? Math.ceil(mtrl) : "Infinity", pbo: Number.isFinite(pbo) ? +pbo.toFixed(3) : null, variants },
  };
  let status: Verdict["status"]; let summary: string;
  const signMatched = prim.b < 0, halvesAgree = h1.b < 0 && h2.b < 0;
  if (Math.abs(ctrl.t) < 2.0 && Math.abs(ctrl.tNW1) < 2.0) {
    status = "UNTESTED"; summary = `POSITIVE CONTROL FAILED: day-0 slope ${(ctrl.b * 1e4).toFixed(2)}bp/sd t ${ctrl.t.toFixed(2)} — the statistical surprise carries no priced information on release day, so a forward null would be about the PROXY, not the market.`;
  } else if (!signMatched) {
    status = "REJECTED"; summary = `SIGN MISSED: fwd-5 slope ${(prim.b * 1e4).toFixed(2)}bp/sd (t ${decT.toFixed(2)}) is not negative; a positive slope is an unregistered flip and not claimable.`;
  } else if (Math.abs(decT) < 2.0) {
    // UNDERPOWERED only where the registration allows it (CPI): n needed for |t|=2 at the observed effect
    const nNeed = Math.ceil(ok.length * (2.0 / Math.max(1e-9, Math.abs(decT))) ** 2);
    if (id === "D-987-cpi-surprise-spx" && effBp >= costBp && nNeed > ok.length) { status = "UNDERPOWERED"; summary = `sign matched, |t| ${Math.abs(decT).toFixed(2)} < 2.0 at n ${ok.length}; at this effect (${effBp.toFixed(1)}bp/sd) |t| 2.0 needs n ~${nNeed}.`; (nums as Record<string, unknown>).n_required_for_t2 = nNeed; }
    else { status = "REJECTED"; summary = `sign matched but |t| ${Math.abs(decT).toFixed(2)} < 2.0 (effect ${effBp.toFixed(1)}bp/sd = ${(effBp / costBp).toFixed(2)}x cost).`; }
  } else if (effBp < costBp) { status = "REJECTED"; summary = `SUB-FEE: |t| ${Math.abs(decT).toFixed(2)} but effect ${effBp.toFixed(1)}bp/sd = ${(effBp / costBp).toFixed(2)}x the ${costBp}bp round trip.`; }
  else if (!halvesAgree) { status = "REJECTED"; summary = `halves disagree in sign (H1 ${(h1.b * 1e4).toFixed(1)}bp t ${h1.t.toFixed(2)}, H2 ${(h2.b * 1e4).toFixed(1)}bp t ${h2.t.toFixed(2)}).`; }
  else if (Math.abs(decT) < ceiling) { status = "BELOW-BAR"; summary = `sign matched in full and both halves, |t| ${Math.abs(decT).toFixed(2)} below the pre-registered ceiling ${ceiling.toFixed(2)}.`; }
  else if (dsr >= 0.95 && Number.isFinite(mtrl) && mtrl <= net.length && (!Number.isFinite(pbo) || pbo < 0.5)) { status = "SURVIVED"; summary = `cleared every registered gate: t ${decT.toFixed(2)} >= ${ceiling.toFixed(2)}, DSR ${dsr.toFixed(3)}, MinTRL ${Math.ceil(mtrl)} <= n ${net.length}, PBO ${pbo.toFixed(2)} — forward clock, never capital.`; }
  else { status = "REJECTED"; summary = `t clears but the trading expression fails: DSR ${dsr.toFixed(3)}, MinTRL ${Number.isFinite(mtrl) ? Math.ceil(mtrl) : "Inf"} vs n ${net.length}, PBO ${Number.isFinite(pbo) ? pbo.toFixed(2) : "n/a"}.`; }
  return { status, summary, nums };
}

// trading-day index: first bar whose date >= d
function firstOnOrAfter(px: number[][], d: string): number {
  let lo = 0, hi = px.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (iso(px[m][0]) >= d) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------- run
const preregs = await q(`trd_prereg?id=in.(${SURPRISE_PREREGS.map((p) => encodeURIComponent(p.id)).join(",")})&select=id,registered_at,outcome,outcome_note&order=id.asc`) as PreregRow[];
const byId = new Map(preregs.map((p) => [p.id, p]));
for (const p of SURPRISE_PREREGS) if (!byId.has(p.id)) { console.error(`!! RED ${p.id} is not registered — run SP_MODE=register first; no test runs unregistered.`); Deno.exit(1); }
const verdicts: Verdict[] = [];
const gspc = await bars("^GSPC"); assertNonEmpty("^GSPC bars", gspc, 10000);
const today = new Date().toISOString().slice(0, 10);

// ---- T1 claims
{
  const id = "D-987-claims-surprise-spx";
  const icsa = await series("claims_initial_sa");
  if (icsa.length < 2000) verdicts.push({ id, status: "UNTESTED", decisive: false, summary: `claims_initial_sa holds ${icsa.length} rows (< 2000) — ingest-fred-macro has not landed ICSA; input absent (COVERAGE LAW).`, numbers: {} });
  else {
    const v = icsa.map((r) => r.v);
    const dev = (i: number, L: number) => v[i] - mean(v.slice(i - L, i));
    const evs: Ev[] = [];
    for (let i = 13 + 52; i < icsa.length; i++) {
      const zs = [4, 8, 13].map((L) => {
        const hist: number[] = []; for (let j = i - 52; j < i; j++) hist.push(dev(j, L));
        const s = sd(hist); return s > 0 ? Math.max(-4, Math.min(4, dev(i, L) / s)) : NaN;
      });
      const rel = addDays(icsa[i].d, 5); if (rel > today) continue;
      const ix = firstOnOrAfter(gspc, rel); if (ix < 1) continue;
      evs.push({ d: rel, i: ix, z: zs });
    }
    const c = await preregCeiling({ rest: OWNED, headers: hdr, preregId: id });
    const sp = await spendTrials({ rest: OWNED, headers: hdr, family: "surprise-program", runId: id, spent: 4 });
    const c2 = await preregCeiling({ rest: OWNED, headers: hdr, preregId: id });
    const r = releaseTest(id, evs, gspc, ["4wk", "8wk", "13wk"], 6, c2.ceiling);
    // INSTRUMENT conversion: weekly ^GSPC vs SPY on the 1993+ overlap
    const spy = await bars("SPY"); const sm = new Map(spy.map((b) => [iso(b[0]), b[4]]));
    const wk: [number, number][] = []; let prev: [number, number] | null = null;
    for (let k = 0; k < gspc.length; k += 5) { const d = iso(gspc[k][0]); const s = sm.get(d); if (s == null) continue; if (prev) wk.push([gspc[k][4] / prev[0] - 1, s / prev[1] - 1]); prev = [gspc[k][4], s]; }
    const conv = ols(wk.map((x) => x[0]), wk.map((x) => x[1]));
    const corr = (() => { const a = wk.map((x) => x[0]), b = wk.map((x) => x[1]); const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); })();
    verdicts.push({ id, status: r.status, decisive: true, summary: r.summary, numbers: { ...r.nums, ceiling_before_spend: +c.ceiling.toFixed(3), trials_spent_now: sp.written, instrument_conversion_spy_on_gspc_weekly: { n_weeks: wk.length, beta: +conv.b.toFixed(3), corr: +corr.toFixed(4) } } });
  }
}

// ---- T2 CPI
{
  const id = "D-987-cpi-surprise-spx";
  const cpi = await series("cpi"); const rel = await series("bls:consumer-price-index");
  const cm = new Map(cpi.map((r) => [r.d.slice(0, 7), r.v]));
  const mo = (ym: string, k: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + k, 1)); return t.toISOString().slice(0, 7); };
  const mom = (ym: string) => { const a = cm.get(ym), b = cm.get(mo(ym, -1)); return a != null && b != null ? a / b - 1 : NaN; };
  const evs: Ev[] = [];
  for (const r of rel) {
    if (r.d > today) continue;
    const ref = mo(r.d.slice(0, 7), -1);           // CPI released in month M+1 refers to month M
    const x = mom(ref); if (!Number.isFinite(x)) continue;
    // MISSING MONTHS (found by reading the first dry run, PRECONDITION LAW): October 2025 CPI was never published (US
    // federal shutdown), so FRED holds no 2025-10 value. Requiring all 24 prior months finite silently dropped EVERY
    // release after 2025-10 — the 2026 sample vanished with no error. The registered rule names a 24-month sd and a
    // 3-month mean; it does not say "discard the event if one month is missing", so the faithful implementation uses
    // the finite months present, with floors (>= 20 of 24 for the sd, >= 2 of L for the mean). Disclosed in D-987.
    const hist24: number[] = []; for (let k = 1; k <= 24; k++) { const m = mom(mo(ref, -k)); if (Number.isFinite(m)) hist24.push(m); }
    if (hist24.length < 20) continue;
    const s = sd(hist24); if (!(s > 0)) continue;
    const zs = [3, 6].map((L) => { const pr: number[] = []; for (let k = 1; k <= L; k++) { const m = mom(mo(ref, -k)); if (Number.isFinite(m)) pr.push(m); } return pr.length >= Math.min(2, L) ? Math.max(-4, Math.min(4, (x - mean(pr)) / s)) : NaN; });
    const ix = firstOnOrAfter(gspc, r.d); if (ix < 1 || iso(gspc[ix][0]) !== r.d) continue;   // release day must be a session
    evs.push({ d: r.d, i: ix, z: zs });
  }
  if (evs.length < 60) verdicts.push({ id, status: "UNTESTED", decisive: false, summary: `only ${evs.length} CPI releases join to sessions (< 60) — input inadequate (COVERAGE LAW).`, numbers: { n: evs.length } });
  else {
    await spendTrials({ rest: OWNED, headers: hdr, family: "surprise-program", runId: id, spent: 3 });
    const c2 = await preregCeiling({ rest: OWNED, headers: hdr, preregId: id });
    const r = releaseTest(id, evs, gspc, ["3m", "6m"], 6, c2.ceiling);
    verdicts.push({ id, status: r.status, decisive: true, summary: r.summary, numbers: r.nums });
  }
}

// ---- T7 UK CPI -> gilt 5y yield (D-989). Yield CHANGES, not price ratios, so it has its own small harness; the gates
// are the same as releaseTest's. Effect in price terms = slope x 4.5 (approx. modified duration of a 5y zero).
{
  const id = "D-989-uk-cpi-surprise-gilts";
  const yoy = await series("ons_cpi_yoy"); const rel = await series("ons_release:cpi"); const y5 = await series("gilt_nom_zc_5y");
  const ym = new Map(yoy.map((r) => [r.d.slice(0, 7), r.v]));
  const mo = (ym0: string, k: number) => { const [y, m] = ym0.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };
  const chg = (m: string) => { const a = ym.get(m), b = ym.get(mo(m, -1)); return a != null && b != null ? a - b : NaN; };
  const yd = y5.map((r) => r.d); const yv = y5.map((r) => r.v);
  const idxOn = (d: string) => { let lo = 0, hi = yd.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (yd[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  const evs: { d: string; z: number[]; d0: number; f5: number }[] = [];
  for (const r of rel) {
    if (r.d > today) continue;
    const ref = `${String(Math.floor(r.v / 100))}-${String(r.v % 100).padStart(2, "0")}`;
    const x = chg(ref); if (!Number.isFinite(x)) continue;
    const zs = [24, 36].map((L) => { const h: number[] = []; for (let k = 1; k <= L; k++) { const c = chg(mo(ref, -k)); if (Number.isFinite(c)) h.push(c); } const sd0 = sd(h); return h.length >= L - 4 && sd0 > 0 ? Math.max(-4, Math.min(4, x / sd0)) : NaN; });
    const i = idxOn(r.d); if (i < 1 || yd[i] !== r.d || i + 5 >= yd.length) continue;   // release day must carry a fitted-curve value
    evs.push({ d: r.d, z: zs, d0: (yv[i] - yv[i - 1]) * 100, f5: (yv[i + 5] - yv[i]) * 100 });   // bp of yield
  }
  const ok = evs.filter((e) => e.z.every(Number.isFinite));
  if (ok.length < 60) verdicts.push({ id, status: "UNTESTED", decisive: false, summary: `only ${ok.length} UK CPI releases join to the gilt curve (< 60) — input inadequate (COVERAGE LAW).`, numbers: { n: ok.length } });
  else {
    await spendTrials({ rest: OWNED, headers: hdr, family: "surprise-program", runId: id, spent: 3 });
    const ceil = (await preregCeiling({ rest: OWNED, headers: hdr, preregId: id })).ceiling;
    const z0 = ok.map((e) => e.z[0]);
    const ctrl = ols(z0, ok.map((e) => e.d0)), prim = ols(z0, ok.map((e) => e.f5));
    const cut = Math.floor(ok.length * 2 / 3);
    const h1 = ols(z0.slice(0, cut), ok.slice(0, cut).map((e) => e.f5)), h2 = ols(z0.slice(cut), ok.slice(cut).map((e) => e.f5));
    const DUR = 4.5, COST = 10;
    const netK = (k: number) => ok.map((e) => { const p = Math.max(-2, Math.min(2, e.z[k])) / 2; return (-p * DUR * e.f5 - COST * Math.abs(p)) / 1e4; });
    const nets = [netK(0), netK(1)], net = nets[0];
    const sr = mean(net) / (sd(net) || 1e-18), sk = skewness(net), ku = kurtosis(net);
    const dsr = deflatedSharpe(sr, net.length, sk, ku, Math.max(2, Math.round(Math.exp(ceil * ceil / 2))), 1 / Math.max(1, net.length - 1));
    const mtrl = minTRL(sr, 0, sk, ku, 0.95); const pbo = pboCSCV(net.map((_, r) => nets.map((x) => x[r])), 8).pbo;
    const effBp = Math.abs(prim.b) * DUR;
    const nums = { n_events: ok.length, span: `${ok[0].d}..${ok.at(-1)!.d}`,
      control_day0: { slope_bp_per_sd: +ctrl.b.toFixed(2), t: +ctrl.t.toFixed(2), tNW1: +ctrl.tNW1.toFixed(2) },
      primary_fwd5: { slope_bp_per_sd: +prim.b.toFixed(2), t: +prim.t.toFixed(2), tNW1: +prim.tNW1.toFixed(2), deciding_t: +prim.t.toFixed(2) },
      half1: { n: h1.n, slope_bp: +h1.b.toFixed(2), t: +h1.t.toFixed(2) }, half2: { n: h2.n, slope_bp: +h2.b.toFixed(2), t: +h2.t.toFixed(2) },
      effect_x_cost: +(effBp / COST).toFixed(2), cost_bp_round_trip: COST, ceiling: +ceil.toFixed(3), units: "slopes in bp of 5y gilt YIELD per 1sd; effect = slope x 4.5 duration in bp of price",
      trading_expression: { gross_mean_bp: +(mean(ok.map((e) => -Math.max(-2, Math.min(2, e.z[0])) / 2 * DUR * e.f5))).toFixed(2), net_mean_bp: +(mean(net) * 1e4).toFixed(2), net_sr_per_event: +sr.toFixed(4), dsr: +dsr.toFixed(3), minTRL: Number.isFinite(mtrl) ? Math.ceil(mtrl) : "Infinity", pbo: +pbo.toFixed(3), variants: ["24m", "36m"] } };
    let status: Verdict["status"], summary: string;
    if (Math.abs(ctrl.t) < 2 && Math.abs(ctrl.tNW1) < 2) { status = "UNTESTED"; summary = `POSITIVE CONTROL FAILED: day-0 5y gilt yield move ${ctrl.b.toFixed(2)}bp/sd t ${ctrl.t.toFixed(2)} — the naive UK CPI surprise is not what gilts price on release day.`; }
    else if (!(prim.b > 0)) { status = "REJECTED"; summary = `SIGN MISSED: R->R+5 yield slope ${prim.b.toFixed(2)}bp/sd (t ${prim.t.toFixed(2)}), registered positive.`; }
    else if (Math.abs(prim.t) < 2) {
      const nNeed = Math.ceil(ok.length * (2 / Math.max(1e-9, Math.abs(prim.t))) ** 2);
      if (effBp >= COST && nNeed > ok.length) { status = "UNDERPOWERED"; summary = `sign matched, t ${prim.t.toFixed(2)} < 2.0 at n ${ok.length}; effect ${effBp.toFixed(1)}bp of price per 1sd needs n ~${nNeed} for t 2.0.`; (nums as Record<string, unknown>).n_required_for_t2 = nNeed; }
      else { status = "REJECTED"; summary = `sign matched but t ${prim.t.toFixed(2)} < 2.0; effect ${effBp.toFixed(1)}bp of price per 1sd = ${(effBp / COST).toFixed(2)}x the ${COST}bp round trip.`; }
    } else if (effBp < COST) { status = "REJECTED"; summary = `SUB-FEE: t ${prim.t.toFixed(2)}, effect ${effBp.toFixed(1)}bp = ${(effBp / COST).toFixed(2)}x cost.`; }
    else if (!(h1.b > 0 && h2.b > 0)) { status = "REJECTED"; summary = `halves disagree (${h1.b.toFixed(2)} / ${h2.b.toFixed(2)}bp/sd).`; }
    else if (Math.abs(prim.t) < ceil) { status = "BELOW-BAR"; summary = `sign matched in full and both halves; t ${prim.t.toFixed(2)} below ceiling ${ceil.toFixed(2)}.`; }
    else if (dsr >= 0.95 && Number.isFinite(mtrl) && mtrl <= net.length && pbo < 0.5) { status = "SURVIVED"; summary = `cleared every registered gate (t ${prim.t.toFixed(2)}, DSR ${dsr.toFixed(3)}, MinTRL ${Math.ceil(mtrl)}, PBO ${pbo.toFixed(2)}) — forward clock, never capital.`; }
    else { status = "REJECTED"; summary = `t clears but the expression fails: DSR ${dsr.toFixed(3)}, MinTRL ${Number.isFinite(mtrl) ? Math.ceil(mtrl) : "Inf"}, PBO ${pbo.toFixed(2)}.`; }
    verdicts.push({ id, status, decisive: true, summary, numbers: nums });
  }
}

// ---- T3..T6 accruing. THE FLOOR CHECK (an UPPER BOUND on progress except T5, which counts exactly) (raw counts before the liquidity / IV-validity
// filters), so it can only fire EARLY, never late. When a floor is (possibly) met, no scorer for that statistic exists
// yet — the run then exits RED ("FLOOR MET — SCORER REQUIRED") after writing its outputs, so a maturing registration can
// never lapse silently into the same decide-afterwards discretion it was written to remove (CONTINUITY LAW, D-613).
const floorMet: string[] = [];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
{
  const id = "D-987-pead-holdout";
  const ev = await q(`trd_earnings?report_date=gte.2026-08-24&eps=not.is.null&surprise_pct=not.is.null&select=report_date`) as { report_date: string }[];
  const months = new Map<string, number>(); for (const e of ev) months.set(e.report_date.slice(0, 7), (months.get(e.report_date.slice(0, 7)) ?? 0) + 1);
  const complete = [...months.entries()].filter(([m, n]) => n >= 50 && `${m}-28` <= daysAgo(31)).length;
  if (complete >= 6) floorMet.push(id);
  verdicts.push({ id, status: "ACCRUING", decisive: false, summary: `${ev.length} holdout events with a reported surprise across ${months.size} month(s); ${complete}/6 months have >= 50 raw events and a complete 20-session window (upper bound before the liquidity filter).`, numbers: { holdout_events_raw: ev.length, by_month: Object.fromEntries(months), floor_months_upper_bound: complete, floor_months_required: 6 } });
}
{
  const id = "D-987-revision-surprise";
  const first = await q(`trd_macro_series?series=eq.est_rev90_0q:AAPL&select=d&order=d.asc&limit=1`) as { d: string }[];
  const f = first[0]?.d;
  if (!f) verdicts.push({ id, status: "UNTESTED", decisive: false, summary: "positive control FAILED: est_rev90_0q:AAPL absent — the revisions feed is not landing (COVERAGE LAW).", numbers: {} });
  else {
    const months: string[] = []; let m = f.slice(0, 7);
    while (`${m}-01` <= daysAgo(31)) { months.push(m); const [y, mm] = m.split("-").map(Number); m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7); }
    const complete = Math.max(0, months.length - (f.slice(8, 10) > "05" ? 1 : 0));   // the first month counts only if the feed started by its 5th
    if (complete >= 12) floorMet.push(id);
    verdicts.push({ id, status: "ACCRUING", decisive: false, summary: `revision snapshots since ${f}; ${complete}/12 monthly cross-sections have a complete 21-session forward window.`, numbers: { first_snapshot: f, floor_months_upper_bound: complete, floor_months_required: 12 } });
  }
}
{
  // THE ONE ACCRUING SCORER BUILT AT REGISTRATION (its upper-bound floor would otherwise fire ~2026-11 once the Q4
  // season matures). Implementation choices fixed HERE, before any of its outcome data was computed:
  //  * timing: 588 of 594 realised holdout events carry when_='not-supplied', so "day-0" is the two-session reaction
  //    window close(R-1) -> close(R+1), which contains the reaction whether the report was pre- or post-market; the
  //    implied move is scaled to the same window, IV x sqrt(2/252) (S is only ever RANKED, so the scale is immaterial).
  //  * IV: the latest snapshot stamped <= R. The collector stamps a date with quotes collected that morning before the
  //    US open (updated_at ~05:00-10:40 UTC), i.e. the PREVIOUS session's close — strictly pre-report for both timings.
  //  * terciles of S are POOLED over all scored events ("the TOP tercile of S"); a month contributes only if it holds
  //    >= 5 top and >= 5 bottom events. Drift = sessions +1..+20 after close(R+1), excess vs SPY over the same window.
  //  * nothing about the statistic is computed or printed until the floor is met — below it the run COUNTS ONLY.
  const id = "D-987-implied-move-surprise";
  const iv0 = await q(`trd_perp_oi?venue=eq.cboe&interval=eq.atm_iv_near&symbol=eq.AAPL&select=ts&order=ts.asc&limit=1`) as { ts: number }[];
  if (!iv0[0]) verdicts.push({ id, status: "UNTESTED", decisive: false, summary: "positive control FAILED: no CBOE atm_iv_near for AAPL — the options snapshot is not landing.", numbers: {} });
  else {
    const ivFirst = iso(iv0[0].ts);
    const ev = await q(`trd_earnings?report_date=gt.${ivFirst}&report_date=lte.${daysAgo(31)}&eps=not.is.null&select=symbol,report_date&order=report_date.asc`) as { symbol: string; report_date: string }[];
    const bySym = new Map<string, string[]>(); for (const e of ev) (bySym.get(e.symbol) ?? bySym.set(e.symbol, []).get(e.symbol)!).push(e.report_date);
    const valid: { sym: string; R: string; iv: number }[] = [];
    for (const [sym, dates] of bySym) {
      const ivs = await q(`trd_perp_oi?venue=eq.cboe&interval=eq.atm_iv_near&symbol=eq.${encodeURIComponent(sym)}&select=ts,open_interest&order=ts.asc`) as { ts: number; open_interest: number }[];
      if (!ivs.length) continue;
      for (const R of dates) {
        let best: { ts: number; open_interest: number } | null = null;
        for (const x of ivs) { if (iso(x.ts) <= R) best = x; else break; }
        if (best && iso(best.ts) >= addDays(R, -5) && best.open_interest > 1 && best.open_interest < 400) valid.push({ sym, R, iv: best.open_interest });
      }
    }
    const seasons = new Set(valid.map((e) => `${e.R.slice(0, 4)}Q${Math.floor((Number(e.R.slice(5, 7)) - 1) / 3) + 1}`)).size;
    const met = valid.length >= 300 && seasons >= 2;
    if (!met) verdicts.push({ id, status: "ACCRUING", decisive: false, summary: `${valid.length}/300 events with a valid pre-report IV (<= 5 days old) and a matured 20-session window, across ${seasons}/2 earnings quarter(s); ${ev.length} reported events in the window before the IV filter. Count only — no statistic computed below the floor.`, numbers: { iv_first: ivFirst, events_valid_iv: valid.length, events_reported: ev.length, seasons } });
    else {
      const spy = await bars("SPY"); const spyIx = new Map(spy.map((b, i) => [iso(b[0]), i]));
      const scored: { R: string; S: number; signed: number }[] = [];
      for (const sym of [...new Set(valid.map((v) => v.sym))]) {
        const b = await bars(sym); if (b.length < 60) continue;
        for (const v of valid.filter((x) => x.sym === sym)) {
          const i0 = firstOnOrAfter(b, v.R); if (i0 < 1 || i0 + 21 >= b.length) continue;   // i0 = R (or next session)
          const pre = b[i0 - 1][4], d0 = b[i0 + 1][4];
          const r0 = d0 / pre - 1, ex = b[i0 + 21][4] / d0 - 1;
          const s0 = spyIx.get(iso(b[i0 + 1][0])), s1 = spyIx.get(iso(b[i0 + 21][0])); if (s0 == null || s1 == null) continue;
          const excess = ex - (spy[s1][4] / spy[s0][4] - 1);
          scored.push({ R: v.R, S: Math.abs(r0) / (v.iv / 100 * Math.sqrt(2 / 252)), signed: Math.sign(r0) * excess });
        }
      }
      const sortedS = scored.map((x) => x.S).sort((a, b) => a - b);
      const t1 = sortedS[Math.floor(sortedS.length / 3)], t2 = sortedS[Math.floor(2 * sortedS.length / 3)];
      const months = new Map<string, { top: number[]; bot: number[] }>();
      for (const x of scored) { const m = months.get(x.R.slice(0, 7)) ?? months.set(x.R.slice(0, 7), { top: [], bot: [] }).get(x.R.slice(0, 7))!; if (x.S >= t2) m.top.push(x.signed); else if (x.S < t1) m.bot.push(x.signed); }
      const diffs: number[] = [], tops: number[] = [];
      for (const m of months.values()) if (m.top.length >= 5 && m.bot.length >= 5) { diffs.push(mean(m.top) - mean(m.bot)); tops.push(mean(m.top)); }
      await spendTrials({ rest: OWNED, headers: hdr, family: "surprise-program", runId: id, spent: 1 });
      const c = await preregCeiling({ rest: OWNED, headers: hdr, preregId: id });
      const tm = diffs.length > 2 ? mean(diffs) / (sd(diffs) / Math.sqrt(diffs.length)) : NaN;
      const topBp = mean(tops) * 1e4, diffBp = mean(diffs) * 1e4;
      const nums = { n_scored: scored.length, months_contributing: diffs.length, top_minus_bottom_bp: +diffBp.toFixed(1), monthly_t: +tm.toFixed(2), top_tercile_signed_excess_bp: +topBp.toFixed(1), cost_bp: 25, ceiling: +c.ceiling.toFixed(3) };
      let status: Verdict["status"], summary: string;
      if (!(diffs.length >= 3)) { status = "UNTESTED"; summary = `only ${diffs.length} month(s) hold >= 5 top and >= 5 bottom events — the portfolio statistic is not computable.`; }
      else if (!(diffBp > 0) || !(tm >= 1.0)) { status = "REJECTED"; summary = `top-minus-bottom ${diffBp.toFixed(1)}bp, monthly t ${tm.toFixed(2)} (needs > 0 and >= 1.0).`; }
      else if (tm < c.ceiling || topBp < 25) { status = "BELOW-BAR"; summary = `top-minus-bottom ${diffBp.toFixed(1)}bp, t ${tm.toFixed(2)} vs ceiling ${c.ceiling.toFixed(2)}; top signed excess ${topBp.toFixed(1)}bp vs 25bp.`; }
      else { status = "SURVIVED"; summary = `top-minus-bottom ${diffBp.toFixed(1)}bp at monthly t ${tm.toFixed(2)} >= ${c.ceiling.toFixed(2)}; top signed excess ${topBp.toFixed(1)}bp >= 25bp — forward clock, never capital.`; }
      verdicts.push({ id, status, decisive: status !== "UNTESTED", summary, numbers: nums });
    }
  }
}
{
  const id = "D-987-release-reversal-forward";
  let n = 0; for (const s of ["bls:consumer-price-index", "bls:employment-situation", "bls:producer-price-index", "bls:job-openings-and-labor-turnover-survey"]) {
    const r = await q(`trd_macro_series?series=eq.${encodeURIComponent(s)}&d=gt.2026-09-13&d=lte.${today}&select=d`) as { d: string }[]; n += r.length; }
  if (n >= 40) floorMet.push(id);
  verdicts.push({ id, status: "ACCRUING", decisive: false, summary: `${n}/40 qualifying calendar releases since 2026-09-13 (upper bound before the hourly-bar completeness check).`, numbers: { releases_upper_bound: n, floor_required: 40 } });
}

// ------------------------------------------------------------------------------------------------- record
for (const v of verdicts) {
  const p = byId.get(v.id)!;
  if (!v.decisive || K.WRITE_OUTCOME !== "1" || p.outcome) continue;
  const label = v.status === "SURVIVED" ? "supported" : v.status === "REJECTED" ? "rejected" : v.status === "BELOW-BAR" ? "inconclusive" : v.status === "UNDERPOWERED" ? "inconclusive" : v.status === "UNTESTED" ? "untested" : null;
  if (!label) continue;
  const note = `${new Date().toISOString().slice(0, 10)} ${v.status}: ${v.summary} Numbers: ${JSON.stringify(v.numbers)}`;
  const r = await fetch(`${OWNED}/trd_prereg?id=eq.${encodeURIComponent(v.id)}&outcome=is.null`, { method: "PATCH", headers: { ...hdr, Prefer: "return=representation" }, body: JSON.stringify({ outcome: label, outcome_note: note }) }); // plumbing-ok: status checked next line
  if (!r.ok) { console.error(`!! outcome write ${v.id}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); Deno.exit(1); }
  const touched = (await r.json() as unknown[]).length; if (touched !== 1) { console.error(`!! outcome write ${v.id} touched ${touched} rows`); Deno.exit(1); }
  p.outcome = label; p.outcome_note = note;
  console.log(`  outcome recorded ${v.id}: ${label}`);
}

const reg = SURPRISE_PREREGS.map((p) => {
  const v = verdicts.find((x) => x.id === p.id)!; const row = byId.get(p.id)!;
  return { id: p.id, sign: p.meta.sign ?? "NEGATIVE", variable: p.meta.variable, instruments: p.meta.instruments, data: p.meta.data, registered_at: row.registered_at, cost_bp_round_trip: p.meta.cost_bp, trials_declared: p.meta.trials, status: v.status, recorded_outcome: row.outcome, summary: v.summary, numbers: v.numbers };
});
const ledger = {
  generated_at: new Date().toISOString(), generator: "scripts/surprise-program.ts (D-987)",
  counts: { preregistered: reg.length, tested: reg.filter((r) => !["ACCRUING"].includes(r.status)).length, survived: reg.filter((r) => r.status === "SURVIVED").length, accruing: reg.filter((r) => r.status === "ACCRUING").length },
  tests: reg,
};
await Deno.writeTextFile(K.LEDGER_OUT.startsWith("/") ? K.LEDGER_OUT : `${REPO}${K.LEDGER_OUT}`, JSON.stringify(ledger, null, 2) + "\n");
console.log(`==> SURPRISE PROGRAMME: ${ledger.counts.preregistered} pre-registered, ${ledger.counts.tested} tested, ${ledger.counts.survived} survived, ${ledger.counts.accruing} accruing`);
for (const r of reg) console.log(`  ${r.status.padEnd(12)} ${r.id.padEnd(34)} ${r.summary.slice(0, 150)}`);

// ------------------------------------------------------------------------------------------------- the document
// Families already measured on this record are listed with their verdicts so the programme is COMPLETE without being
// re-mined (D-823), and the surprise variables we cannot yet measure are named with their exact barrier (COVERAGE LAW:
// an unmeasured surprise is a fact about our data, not about the market).
const PRIOR: [string, string, string][] = [
  ["earnings surprise / PEAD", "D-225, D-393, D-489, D-612", "real 1996-2012 (t 3.89), decayed post-2012 (t 0.24); best real-surprise spec t 2.83 below ceiling; analyst-coverage cut not supported, event-level t inflated 4x vs portfolio. Re-entered ONLY as the post-2026-08-24 holdout D-987-pead-holdout."],
  ["short-interest surprise", "D-805 (prereg D-805-si-surprise-K12)", "rejected."],
  ["settlement-fails / short-volume surprise", "D-621..D-626", "independent of each other, both significant — in the UNREGISTERED direction; the registered direction lost (SIGN LAW: not claimable)."],
  ["EIA inventory change (vs 5-yr seasonal)", "D-743", "null (CL t -0.62 sign missed, NG t 0.16); the analyst-consensus inventory surprise is not held."],
  ["macro release-hour reaction", "D-877, D-877b", "continuation null (1 of 7); index REVERSAL above cost but sign registered the other way -> re-registered forward-only as D-987-release-reversal-forward."],
  ["index inclusion / deletion", "D-740, D-963, D-965", "footprint real (adds +1.54% t 3.65 into effective date) but consumed at the announcement; lag-1 entrant funds the pop (-142bp/event)."],
  ["spin-offs", "D-733 (clock fwd-spinoff-premium)", "forward clock running; latest mark liq median excess vs IWM +45.5pp at n 54 — not a promote until its own floor."],
  ["dealer gamma (options flow)", "D-961, D-967, D-968, D-970", "vol-damping validated in 3 regimes (pooled t -17.3); direction dead; sizing gain +6.7% OOS awaiting free-feed calibration (D-970-gex-sizing-calibration)."],
  ["implied vs realised (VIX / VRP / fear)", "D-276, D-498, D-830, D-817", "fear-reversion near-miss; the first 'survivors' were same-bar phantoms (sign-flipped at lag 1); implied is a priced insurance premium, not a forecast; BTC VRP measured, null by rule."],
  ["ETF flow surprise (gold)", "D-745", "refuted — flow follows price."],
  ["crypto funding / positioning / order-flow surprise", "D-415, D-426, D-553/554, D-808/809", "pooling artefact retracted; order-flow surprise 0.02-0.18x the fee; the profitable funding direction is an unregistered flip."],
  ["crypto on-chain surprise", "D-928 clock, D-972 prereg", "single-chain fee-momentum clock running; cross-chain breadth consumer registered with a feed-removal kill."],
  ["real-yield change", "D-730", "null forward (t 0.16/-0.27/-0.13)."],
];
const GAPS: [string, string][] = [
  ["macro surprise vs CONSENSUS (CPI, payrolls, claims, ISM)", "no free keyless consensus HISTORY is held; the statistical surprises tested here are a proxy (and the claims proxy failed its positive control). Candidate forward-accrual source: the ForexFactory weekly calendar JSON (forecast + previous) — not on the endpoint allowlist, NOT probed; one operator allowlist line would start a consensus feed whose first test could be registered at birth."],
  ["FOMC / policy-rate surprise", "fed-funds futures and OIS are not held (CME data is paid); a daily 2y-yield proxy exists in trd_yield_curve but no FOMC timestamp series is ingested."],
  ["Treasury auction surprise (tail vs when-issued)", "auction results are free and keyless at api.fiscaldata.treasury.gov and the host IS allowlisted (D-989 corrects D-987) — not yet ingested; when-issued yields are not free."],
  ["UK release surprise vs CONSENSUS (CPI, labour, BoE decisions)", "D-989 holds ONS CPI first-release dates (130, 2015+) and the BoE curves: the NAIVE UK CPI surprise failed its day-0 control on gilts (D-989-uk-cpi-surprise-gilts UNTESTED). UK consensus is not held; ONS labour series are latest-vintage only (no first-release values), so a labour surprise is not testable point-in-time; no MPC decision-date series is ingested."],
  ["crypto spot-ETF flow surprise", "no free daily flow history is held."],
  ["intraday earnings / announcement-timestamp reaction", "intraday single-name equity history is a PAID gap (D-965); the daily expression is what D-987-pead-holdout and D-987-implied-move-surprise test."],
];
const md: string[] = [];
md.push(`# SURPRISE EFFECTS — what the market demonstrably rewards for being surprised, tested only as pre-registered (D-987)`);
md.push(``);
md.push(`> Regenerated every daily coverage-runner cycle by \`scripts/surprise-program.ts\`. Generated ${ledger.generated_at}. Every test below was written into the append-only \`trd_prereg\` table (rows \`D-987-*\`, text in \`scripts/surprise-registry.ts\`, verified identical on every run) BEFORE its outcome was computed. Machine-readable: \`research/surprise-ledger.json\`.`);
md.push(``);
md.push(`**${ledger.counts.preregistered} pre-registered · ${ledger.counts.tested} tested · ${ledger.counts.survived} survived · ${ledger.counts.accruing} accruing.** Accruing floors are re-checked every night as an UPPER BOUND on progress; the night one may be met the run exits RED (\"FLOOR MET — SCORER REQUIRED\") until the registered statistic is computed and its outcome written once — maturity cannot pass silently. A survivor becomes a \`trd_forward_rules\` clock — never capital.`);
md.push(``);
md.push(`Gates for every row: the D-823 pre-registered ceiling sqrt(2 ln(trials under the id + all registrations)); SIGN stated before the data; a POSITIVE CONTROL that must show the surprise measure moves price on release day before any forward null is believed; effect in bp per 1sd vs the round-trip cost; DSR >= 0.95, MinTRL <= n and PBO < 0.5 on the net trading expression.`);
md.push(``);
md.push(`## The registered tests`);
md.push(``);
md.push(`| id | surprise variable | instrument | status | outcome recorded | result |`);
md.push(`|---|---|---|---|---|---|`);
for (const r of reg) md.push(`| \`${r.id}\` | ${r.variable} | ${r.instruments} | **${r.status}** | ${r.recorded_outcome ?? "—"} | ${r.summary.replace(/\|/g, "/")} |`);
md.push(``);
for (const r of reg.filter((x) => !["ACCRUING"].includes(x.status))) {
  const n = r.numbers as Record<string, any>;
  if (!n.primary_fwd5) continue;
  md.push(`### ${r.id} — ${r.status}`);
  md.push(``);
  md.push(`| measure | value |`);
  md.push(`|---|---|`);
  md.push(`| events | ${n.n_events} (${n.span}) |`);
  md.push(`| POSITIVE CONTROL: day-0 slope | ${n.control_day0.slope_bp_per_sd}bp per 1sd, t ${n.control_day0.t} (NW1 ${n.control_day0.tNW1}) — needs abs(t) >= 2 |`);
  md.push(`| PRIMARY: next-5-session slope | ${n.primary_fwd5.slope_bp_per_sd}bp per 1sd, t ${n.primary_fwd5.t} (NW1 ${n.primary_fwd5.tNW1}); deciding t ${n.primary_fwd5.deciding_t}; registered sign ${r.sign} |`);
  if (n.units) md.push(`| units | ${n.units} |`);
  md.push(`| halves (first 2/3, last 1/3) | ${n.half1.slope_bp}bp t ${n.half1.t} (n ${n.half1.n}) / ${n.half2.slope_bp}bp t ${n.half2.t} (n ${n.half2.n}) |`);
  md.push(`| effect vs ${n.cost_bp_round_trip}bp round trip | ${n.effect_x_cost}x |`);
  md.push(`| trading expression (p = -clip(z,-2,2)/2) | gross ${n.trading_expression.gross_mean_bp}bp, net ${n.trading_expression.net_mean_bp}bp per release; DSR ${n.trading_expression.dsr}; MinTRL ${n.trading_expression.minTRL}; PBO ${n.trading_expression.pbo} over ${n.trading_expression.variants.join("/")} |`);
  md.push(`| pre-registered ceiling | ${n.ceiling} |`);
  if (n.eras) md.push(`| eras (descriptive) | ${Object.entries(n.eras).map(([k, v]: [string, any]) => `${k} ${v.bBp}bp t ${v.t}`).join(" · ")} |`);
  if (n.instrument_conversion_spy_on_gspc_weekly) md.push(`| INSTRUMENT conversion (SPY on ^GSPC, weekly) | beta ${n.instrument_conversion_spy_on_gspc_weekly.beta}, corr ${n.instrument_conversion_spy_on_gspc_weekly.corr} over ${n.instrument_conversion_spy_on_gspc_weekly.n_weeks} weeks |`);
  md.push(``);
}
md.push(`## Surprise families already measured on this record (not re-registered — D-823 forbids re-mining)`);
md.push(``);
md.push(`| family | decisions | verdict on record |`);
md.push(`|---|---|---|`);
for (const [f, d, v] of PRIOR) md.push(`| ${f} | ${d} | ${v} |`);
md.push(``);
md.push(`## Surprise variables the market rewards that we cannot yet measure (named barrier, not a market finding)`);
md.push(``);
md.push(`| variable | barrier |`);
md.push(`|---|---|`);
for (const [v, b] of GAPS) md.push(`| ${v} | ${b} |`);
md.push(``);
md.push(`## How to read this page`);
md.push(``);
md.push(`- **UNTESTED** = the input was present but failed its positive control, or the input is absent: a statement about our data, never about the market.`);
md.push(`- **REJECTED** = the registered kill condition fired. It cannot be re-opened by a variant; only a fresh registration on data that did not exist when this one was scored.`);
md.push(`- **ACCRUING** = the data is arriving through an existing nightly feed and the floor is re-checked every night; reaching it turns the nightly run RED until the statistic is computed, so nobody has to remember — but for three of the four a session must still build that scorer. D-987-implied-move-surprise already carries its scorer: it only COUNTS below its floor and scores itself, once, the night the floor is met.`);
md.push(`- A pre-registered UNTESTED/REJECTED is the engine working: the operator's money is protected by exactly these rows.`);
await Deno.writeTextFile(K.DOC_OUT.startsWith("/") ? K.DOC_OUT : `${REPO}${K.DOC_OUT}`, md.join("\n") + "\n");
console.log(`  wrote ${K.LEDGER_OUT} and ${K.DOC_OUT}`);
// A SURVIVOR is not finished until it is a forward clock (never capital). Writing a trd_forward_rules row is a
// pre-commitment with numeric two-sided floors that must be authored deliberately, so it is not auto-generated here —
// instead the run stays RED until a clock named fwd-<prereg id> exists.
for (const v of verdicts.filter((x) => x.status === "SURVIVED")) {
  const clk = await q(`trd_forward_rules?id=eq.fwd-${encodeURIComponent(v.id)}&select=id`) as { id: string }[];
  if (!clk.length) floorMet.push(`${v.id} SURVIVED — register forward clock fwd-${v.id}`);
}
if (floorMet.length) {
  console.error(`!! SURPRISE FLOOR MET — SCORER REQUIRED: ${floorMet.join(", ")}. The registered statistic must now be computed and its`);
  console.error(`   outcome written once; until then this run stays RED so maturity cannot pass silently (CONTINUITY LAW).`);
  Deno.exit(2);
}
