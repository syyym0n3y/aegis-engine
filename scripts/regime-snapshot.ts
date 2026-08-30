#!/usr/bin/env -S deno run --allow-net --allow-env
// regime-snapshot.ts (D-720) — the honest answer to "understand probability and confidence levels at a point in
// time". It reads every HELD CONDITIONING driver (D-716 register) at the latest date and reports WHERE it sits in
// its own history — the state of the tape, expressed as percentiles a human can read.
//
// WHAT THIS IS AND IS NOT. This is a description of the current regime built only from observables we actually hold.
// It is NOT a signal, a forecast, or a position. Every conditioning driver on this programme's board has been tested
// and none carries a tradable edge past the gates; the one pattern confirmed out-of-sample (the breadth U-shape,
// D-718b) is context, not a trade. So this snapshot deliberately reports STATE and STATE ONLY — a percentile and a
// plain-English label — and makes no claim that any reading implies a direction. Reading it as a signal would be the
// exact overclaim the whole guard stack exists to prevent.
//
// PERCENTILE = rank of the current value within its full available history. High/low are stated in the driver's own
// terms (e.g. breadth high = broad tape; VIX high = stressed). Survivorship applies to breadth (D-717): its level is
// biased, so its percentile is read within its own biased history, which is internally consistent but not the true
// market's absolute level.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("regime-snapshot", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rs", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const pct = (v: number, hist: number[]) => hist.length ? 100 * hist.filter((x) => x <= v).length / hist.length : NaN;

async function series(url: string): Promise<{ d: string; v: number }[]> {
  const r = await fetch(`${OWNED}/${url}`, { headers: hdr }).then((x) => x.ok ? x.json() : []).catch(() => []);
  return Array.isArray(r) ? r : [];
}
// Pull a bar series' closes with dates from trd_bars_deep.
async function closes(sym: string): Promise<{ d: string; v: number }[]> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  const bars = (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
  return bars.map((b: number[]) => ({ d: iso(b[0]), v: b[4] }));
}

interface Row { name: string; asof: string; val: number; pctile: number; state: string; note?: string }
const rows: Row[] = [];
function add(name: string, s: { d: string; v: number }[], label: (p: number, v: number) => string, note?: string) {
  if (!s.length) return;
  const last = s[s.length - 1];
  const p = pct(last.v, s.map((x) => x.v));
  rows.push({ name, asof: last.d, val: last.v, pctile: p, state: label(p, last.v), note });
}

// 1. BREADTH — % of names above their 200dma (D-717). High percentile = broad tape.
add("equity breadth (%>200dma)", await series("trd_macro_series?series=eq.breadth_pct_gt_200dma_surv&select=d,v&order=d&limit=100000"),
  (p) => p > 80 ? "very broad (extended)" : p > 55 ? "broad" : p > 45 ? "mixed" : p > 20 ? "narrow" : "very narrow (washout)",
  "D-718b: BOTH extremes have historically preceded higher forward returns than the mixed middle — context, not a signal");

// 2. VIX — equity implied vol. High percentile = stressed.
add("equity vol (VIX)", await closes("^VIX"),
  (p, v) => `${v.toFixed(1)} — ${p > 85 ? "stressed" : p > 60 ? "elevated" : p > 30 ? "normal" : "calm"}`);

// 3. VIX9D / VIX term structure. >1 = short-dated fear above longer (risk-off inversion, D-498).
{
  const v9 = await series("trd_perp_oi?venue=eq.cboe&interval=eq.index_close&symbol=eq.VIX9D&select=ts,open_interest&order=ts&limit=100000");
  const vix = await closes("^VIX");
  const vixMap = new Map(vix.map((x) => [x.d, x.v]));
  const ratio = v9.map((x) => ({ d: iso((x as unknown as { ts: number }).ts), r: (x as unknown as { open_interest: number }).open_interest / (vixMap.get(iso((x as unknown as { ts: number }).ts)) || NaN) }))
    .filter((x) => Number.isFinite(x.r)).map((x) => ({ d: x.d, v: x.r }));
  add("VIX term structure (VIX9D/VIX)", ratio, (_p, v) => `${v.toFixed(2)} — ${v > 1.0 ? "INVERTED (short-dated fear, risk-off)" : v > 0.95 ? "flat" : "normal (contango)"}`);
}

// 4. Yield-curve slope 10y-2y. Negative = inverted (recession signal historically).
{
  const yc = await series("trd_yield_curve?select=d,y10,y2&order=d&limit=100000") as unknown as { d: string; y10: number; y2: number }[];
  const slope = yc.filter((x) => x.y10 != null && x.y2 != null).map((x) => ({ d: x.d, v: x.y10 - x.y2 }));
  add("yield curve (10y-2y)", slope, (_p, v) => `${v.toFixed(2)}% — ${v < 0 ? "INVERTED" : v < 0.5 ? "flat" : "normal"}`);
}

// 5. Gold/silver ratio. High = silver cheap to gold / risk-off metals (the clip's driver #8).
{
  const g = await closes("GC=F"), s = await closes("SI=F");
  const sm = new Map(s.map((x) => [x.d, x.v]));
  const gsr = g.map((x) => ({ d: x.d, v: x.v / (sm.get(x.d) || NaN) })).filter((x) => Number.isFinite(x.v));
  add("gold/silver ratio", gsr, (p, v) => `${v.toFixed(1)} — ${p > 80 ? "stretched high (silver cheap)" : p > 20 ? "mid-range" : "stretched low"}`);
}

// 6. Credit spread proxy HYG/LQD. Low ratio = HY stress relative to IG.
{
  const hyg = await closes("HYG"), lqd = await closes("LQD");
  const lm = new Map(lqd.map((x) => [x.d, x.v]));
  const cr = hyg.map((x) => ({ d: x.d, v: x.v / (lm.get(x.d) || NaN) })).filter((x) => Number.isFinite(x.v));
  add("credit (HYG/LQD)", cr, (p) => p > 70 ? "risk-on" : p > 30 ? "neutral" : "risk-off (HY under stress)",
    "CAVEAT: raw PRICE ratio, not option-adjusted spread — its all-time percentile drifts with price levels and is NOT a clean credit read; use the direction of its short-term change, not this level");
}

assertNonEmpty("drivers read", rows, 3);
console.log(`==> REGIME SNAPSHOT — where each HELD conditioning driver sits in its own history\n`);
console.log(`    ${"driver".padEnd(30)}${"as of".padEnd(12)}${"value".padStart(10)}${"pctile".padStart(9)}   state`);
for (const r of rows) {
  console.log(`    ${r.name.padEnd(30)}${r.asof.padEnd(12)}${(Number.isFinite(r.val) ? r.val.toFixed(3) : "—").padStart(10)}${(Number.isFinite(r.pctile) ? r.pctile.toFixed(0) + "%" : "—").padStart(9)}   ${r.state}`);
  if (r.note) console.log(`    ${" ".repeat(30)}${r.note}`);
}
console.log(`\n    THIS IS STATE, NOT A SIGNAL. Every driver here is a CONDITIONING observable with no tradable edge past`);
console.log(`    the gates. The snapshot describes the current regime from what we hold; it does not tell you what to`);
console.log(`    do, and reading a percentile as a direction is the overclaim the guard stack exists to prevent.`);
console.log(`    Drivers we do NOT hold and so cannot place here: real yields/CPI, dealer gamma, ETF flows, GPR`);
console.log(`    (driver register D-716). Their absence is a fact about our data, not a market with nothing to say.`);
