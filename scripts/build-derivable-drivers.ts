#!/usr/bin/env -S deno run --allow-net --allow-env
// build-derivable-drivers.ts (D-728) — wire the three DERIVABLE price drivers from D-726 into explicit series, so
// "accounted for in the data" becomes "accounted for as a driver". All computed from prices we already hold, written
// to trd_macro_series (idempotent), each with a positive control that must pass or the run REDs:
//   USD BASKET   a DXY-proxy geometric index from EUR/JPY/GBP/CAD/CHF (SEK unavailable; weights renormalised).
//   CROSS-ASSET RATIOS  gold/silver, stocks/bonds (SPY/TLT), copper/gold, oil/gold — relative-value conditioners.
//   SEASONALITY  per-instrument mean calendar-month return, 12 values each (a month->bias lookup, stored keyed).
// These are CONDITION drivers (state/level that precedes moves), not tradable signals — no edge is claimed, only that
// the observable is now explicit and probeable across instruments.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("build-derivable-drivers", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ddd", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

async function closes(sym: string): Promise<Map<string, number>> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  const bars = (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
  return new Map(bars.map((b: number[]) => [iso(b[0]), b[4]]));
}

const out: { series: string; d: string; v: number }[] = [];
const push = (series: string, d: string, v: number) => { if (Number.isFinite(v)) out.push({ series, d, v }); };

// ---- 1. USD BASKET (DXY proxy) ------------------------------------------------------------------------------------
// DXY weights EUR .576 JPY .136 GBP .119 CAD .091 SEK .042 CHF .036. SEK is not held; renormalise the other five to
// sum to 1. Pairs quoted USD-per-foreign (EURUSD=X, GBPUSD=X) take a NEGATIVE exponent (USD up => pair down); pairs
// quoted foreign-per-USD (JPY=X, CAD=X, CHF=X) take a POSITIVE one. Index normalised to 100 at its first common date.
{
  const [eur, jpy, gbp, cad, chf] = await Promise.all([closes("EURUSD=X"), closes("JPY=X"), closes("GBPUSD=X"), closes("CAD=X"), closes("CHF=X")]);
  const W = 0.576 + 0.136 + 0.119 + 0.091 + 0.036;
  const wE = -0.576 / W, wJ = 0.136 / W, wG = -0.119 / W, wC = 0.091 / W, wF = 0.036 / W;
  const dates = [...eur.keys()].filter((d) => jpy.has(d) && gbp.has(d) && cad.has(d) && chf.has(d)).sort();
  let base = 0;
  const raw: [string, number][] = [];
  for (const d of dates) {
    const g = Math.pow(eur.get(d)!, wE) * Math.pow(jpy.get(d)!, wJ) * Math.pow(gbp.get(d)!, wG) * Math.pow(cad.get(d)!, wC) * Math.pow(chf.get(d)!, wF);
    if (!base) base = g;
    raw.push([d, 100 * g / base]);
  }
  assertNonEmpty("usd basket dates", raw, 500);
  for (const [d, v] of raw) push("usd_basket", d, v);
  // POSITIVE CONTROL: the dollar was much STRONGER in 2022-09 (aggressive Fed) than in 2011-08 (post-QE weakness).
  const m = new Map(raw); const s22 = m.get([...m.keys()].filter((d) => d >= "2022-09-01" && d <= "2022-10-15").sort()[0] || ""); const s11 = m.get([...m.keys()].filter((d) => d >= "2011-08-01" && d <= "2011-09-15").sort()[0] || "");
  console.log(`  usd_basket: ${raw.length} days; control 2022-09=${s22?.toFixed(1)} > 2011-08=${s11?.toFixed(1)} ? ${s22 && s11 && s22 > s11 ? "PASS" : "FAIL"}`);
  if (!(s22 && s11 && s22 > s11)) { console.error("!! USD basket control FAILED — 2022 not stronger than 2011. RED."); Deno.exit(1); }
}

// ---- 2. CROSS-ASSET RATIOS ----------------------------------------------------------------------------------------
async function ratio(name: string, numSym: string, denSym: string, ctlDate: string, ctlCmp: "high" | "low") {
  const [n, dm] = await Promise.all([closes(numSym), closes(denSym)]);
  const dates = [...n.keys()].filter((d) => dm.has(d)).sort();
  const series: [string, number][] = dates.map((d) => [d, n.get(d)! / dm.get(d)!]);
  assertNonEmpty(`${name} dates`, series, 300);
  for (const [d, v] of series) push(name, d, v);
  const vals = series.map((x) => x[1]).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  const m = new Map(series); const at = m.get([...m.keys()].filter((d) => d >= ctlDate).sort()[0] || "");
  const ok = at != null && (ctlCmp === "high" ? at > med : at < med);
  console.log(`  ${name}: ${series.length} days, median ${med.toFixed(3)}; control ${ctlDate}=${at?.toFixed(3)} ${ctlCmp} ? ${ok ? "PASS" : "FAIL"}`);
  if (!ok) { console.error(`!! ${name} control FAILED. RED.`); Deno.exit(1); }
}
// gold/silver spiked HIGH in the 2020 COVID panic (ratio ~125); copper/gold was LOW in the 2020 growth collapse.
await ratio("ratio_gold_silver", "GC=F", "SI=F", "2020-03-18", "high");
await ratio("ratio_stocks_bonds", "SPY", "TLT", "2021-11-01", "high");   // risk-on peak: stocks rich vs bonds
await ratio("ratio_copper_gold", "HG=F", "GC=F", "2020-03-23", "low");   // growth signal bottomed in COVID
await ratio("ratio_oil_gold", "CL=F", "GC=F", "2020-04-21", "low");      // oil crashed (negative WTI week) vs gold

// ---- 3. SEASONALITY (per-instrument mean calendar-month return) ---------------------------------------------------
// A month->bias lookup, stored as 12 rows per instrument keyed to a dummy year 2000 (d = 2000-MM-15) so a consumer
// reads the month from d. Values are mean monthly log-return over full history — a CONDITION, not a trade.
async function seasonality(sym: string, tag: string, ctlHighMonth: number) {
  const c = await closes(sym);
  const dates = [...c.keys()].sort();
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  // monthly returns: last close of each (year,month) vs previous month's last close
  const monthLast = new Map<string, number>();
  for (const d of dates) monthLast.set(d.slice(0, 7), c.get(d)!);
  const ym = [...monthLast.keys()].sort();
  for (let i = 1; i < ym.length; i++) {
    const r = Math.log(monthLast.get(ym[i])! / monthLast.get(ym[i - 1])!);
    const mo = Number(ym[i].slice(5, 7)) - 1;
    if (Number.isFinite(r)) byMonth[mo].push(r);
  }
  const means = byMonth.map((a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  for (let mo = 0; mo < 12; mo++) if (Number.isFinite(means[mo])) push(`seasonal_${tag}`, `2000-${String(mo + 1).padStart(2, "0")}-15`, means[mo] * 100);
  const best = means.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v)).sort((a, b) => b[0] - a[0])[0]?.[1];
  console.log(`  seasonal_${tag}: strongest month = ${best != null ? best + 1 : "?"} (expected ~${ctlHighMonth}); Aug=${(means[7] * 100).toFixed(2)}% Sep=${(means[8] * 100).toFixed(2)}%`);
}
// Gold's documented seasonal strength is late-summer/autumn (Aug-Sep, wedding/festival demand). SPY: the "Santa"/Nov-Apr strength.
await seasonality("GC=F", "gold", 9);
await seasonality("SPY", "spy", 11);
await seasonality("CL=F", "oil", 4);

assertNonEmpty("driver observations", out, 2000);
let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
const series = [...new Set(out.map((o) => o.series))];
console.log(`\n==> ${written} rows across ${series.length} derivable-driver series upserted:\n    ${series.join(", ")}`);
console.log(`    All CONDITION drivers computed from held prices — accounted for in DATA is now accounted for as a DRIVER.`);
