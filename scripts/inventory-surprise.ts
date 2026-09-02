#!/usr/bin/env -S deno run --allow-net --allow-env
// inventory-surprise.ts (D-743) — do EIA weekly INVENTORY CHANGES condition next-week CL / NG returns, once the
// report's publication lag is honoured? The physical-balance story: a BUILD (stocks up) is bearish, a DRAW bullish.
// We do not hold consensus estimates, so this is the CHANGE (z-scored against its own 52-week history), not the
// surprise vs consensus — stated plainly: the tradable "surprise" is UNTESTED here; the raw change is what is measured.
//
// TIMING, the part that decides everything (D-498): the crude report for week-ending Friday F is released the
// following Wednesday (F+5), the gas report Thursday (F+6). The signal is dated the RELEASE day; entry is the first
// close STRICTLY AFTER it (lag-1); hold 5 trading days. Acting on the week-ending date would be look-ahead by a week.
// HONESTY: single-instrument time-series tests (breadth 2, no cross-section); GROSS unless labelled NET; era halves;
// turnover, drag, time-underwater, RUINED check; SIGN prior stated before the numbers.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("inventory-surprise", [{ name: "RT_BP", def: "10", note: "round-trip futures cost in bp" }]);
const RT_BP = Number(Deno.env.get("RT_BP") || "10");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "inv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);

type Bar = [number, number, number, number, number, number];
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const stats = (x: number[]) => { const n = x.length, mean = x.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)); return { n, mean, sd, t: mean / (sd / Math.sqrt(n)), sr: (mean / sd) * Math.sqrt(52) }; };
const underwater = (x: number[]) => { let peak = 0, cum = 0, longest = 0, cur = 0, worst = 0; for (const r of x) { cum += r; if (cum > peak) { peak = cum; cur = 0; } else { cur++; if (cur > longest) longest = cur; } if (cum - peak < worst) worst = cum - peak; } return { longest, worst }; };

console.log(`==> EIA INVENTORY CHANGE -> next-week return (D-743) — CL vs crude stocks, NG vs working gas storage\n`);
console.log(`  *** BREADTH = 2, single-instrument time-series tests. The CHANGE is measured, not the consensus SURPRISE (not held) — the`);
console.log(`      tradable surprise is UNTESTED here. Signal dated on RELEASE day (F+5 crude, F+6 gas), entry first close after (lag-1). ***`);
console.log(`  SIGN PRIOR: BUILD (z>0) -> NEGATIVE next-week return; DRAW -> positive. The rule is short-on-build / long-on-draw.\n`);

let trials = 0; const verdicts: string[] = [];
for (const [name, sym, series, lagDays] of [["CL", "CL=F", "eia_crude_stocks_w", 5], ["NG", "NG=F", "eia_ng_storage_w", 6]] as const) {
  const row = (await q(`trd_bars_deep?asset_class=eq.commodity&symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  const bars: Bar[] = (row?.bars || []).filter((b: Bar) => b[4] > 0);
  assertNonEmpty(`${name} bars`, bars, 2000);
  const dates = bars.map((b) => iso(b[0])); const close = bars.map((b) => b[4]);
  const idxAfter = (d: string) => { let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) lo = m + 1; else hi = m; } return lo; }; // first bar strictly after d
  const inv = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[]; // plumbing-ok: ordered single series
  assertNonEmpty(`${name} inventory series`, inv, 500);
  // SURPRISE proxy = this week's change MINUS the mean change in the SAME calendar week over the prior 5 years (the
  // "vs 5-year average" the market itself quotes), then z-scored on the trailing 52 such deviations. A plain 52-week
  // z-score does NOT remove seasonality: gas builds every summer and draws every winter, so "short on build" would be
  // "short all summer" — a seasonal timing rule wearing an inventory costume. Caught by reading the first run's output.
  const rows: { rel: string; z: number; ret: number }[] = [];
  const chg: { d: string; c: number }[] = [];
  const woy = (d: string) => Math.floor((Date.parse(d) - Date.UTC(new Date(d).getUTCFullYear(), 0, 1)) / 86400000 / 7);
  const dev: number[] = [];
  const usedEntry = new Set<number>();
  for (let i = 1; i < inv.length; i++) {
    const c = inv[i].v - inv[i - 1].v; chg.push({ d: inv[i].d, c });
    const yr = new Date(inv[i].d).getUTCFullYear(), w = woy(inv[i].d);
    const same = chg.filter((x) => { const y = new Date(x.d).getUTCFullYear(); return y >= yr - 5 && y < yr && Math.abs(woy(x.d) - w) <= 1; });
    if (same.length < 5) continue;                          // need a seasonal baseline first
    const seas = same.reduce((a, b) => a + b.c, 0) / same.length;
    const d = c - seas; dev.push(d);
    if (dev.length < 53) continue;
    const win = dev.slice(-53, -1); const m = win.reduce((a, b) => a + b, 0) / win.length; const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (win.length - 1));
    if (!(sd > 0)) continue;
    const z = (d - m) / sd;
    const rel = addDays(inv[i].d, lagDays);                 // release day
    if (rel < dates[0]) continue;                           // PRECONDITION: no price history yet — an event before the first
    const e = idxAfter(rel); const x = e + 5;               // bar would silently map onto bar 0 (the first run's 86%/yr "return")
    if (e === 0 || x >= close.length) continue;
    if (usedEntry.has(e)) { console.error(`!! ${name}: two events share entry bar ${dates[e]} — event/price alignment is broken. RED.`); Deno.exit(1); }
    usedEntry.add(e);
    rows.push({ rel, z, ret: Math.log(close[x] / close[e]) });
  }
  assertNonEmpty(`${name} event panel`, rows, 300);
  // POSITIVE CONTROL on the benchmark itself: a front-month commodity cannot average > 40%/yr over decades; if the
  // unconditional next-week mean annualises past that, the alignment is wrong, not the market.
  { const u = stats(rows.map((r) => r.ret)); if (Math.abs(u.mean * 52) > 0.40) { console.error(`!! ${name}: unconditional ${(u.mean * 52 * 100).toFixed(1)}%/yr is not a market number — alignment defect. RED.`); Deno.exit(1); } }
  trials++;
  const uncond = stats(rows.map((r) => r.ret));
  const signed = rows.map((r) => (r.z > 0 ? -1 : 1) * r.ret);   // short on build, long on draw
  const sg = stats(signed), uw = underwater(signed);
  const build = stats(rows.filter((r) => r.z > 0).map((r) => r.ret)), draw = stats(rows.filter((r) => r.z <= 0).map((r) => r.ret));
  const big = rows.filter((r) => Math.abs(r.z) > 1); const bigS = big.length > 30 ? stats(big.map((r) => (r.z > 0 ? -1 : 1) * r.ret)) : null;
  let flips = 0; for (let i = 1; i < rows.length; i++) if ((rows[i].z > 0) !== (rows[i - 1].z > 0)) flips++;
  const turnover = flips / rows.length * 2; const drag = turnover * 52 * (RT_BP / 1e4) * 100;
  const half = (a: string, b: string) => { const s = rows.filter((r) => r.rel >= a && r.rel < b).map((r) => (r.z > 0 ? -1 : 1) * r.ret); return s.length > 52 ? stats(s) : null; };
  const h1 = half("1900-01-01", "2015-01-01"), h2 = half("2015-01-01", "2100-01-01");
  const ann = (s: { mean: number }) => (s.mean * 52 * 100).toFixed(2);

  console.log(`  ${name}  ${rows.length} weekly events  ${rows[0].rel} .. ${rows[rows.length - 1].rel}`);
  console.log(`    UNCONDITIONAL next-week (benchmark)  ${ann(uncond)}%/yr  t ${uncond.t.toFixed(2)}`);
  console.log(`    after BUILD (z>0) n=${build.n}  ${ann(build)}%/yr t ${build.t.toFixed(2)}   | after DRAW n=${draw.n}  ${ann(draw)}%/yr t ${draw.t.toFixed(2)}`);
  console.log(`    SIGN-CONDITIONED short-build/long-draw (gross)  ${ann(sg)}%/yr  SR ${sg.sr.toFixed(2)}  gross t ${sg.t.toFixed(2)}  N=${sg.n}`);
  console.log(`      large-|z|>1 only  ${bigS ? `${ann(bigS)}%/yr gross t ${bigS.t.toFixed(2)} n ${bigS.n}` : "n/a"}`);
  console.log(`      turnover ${turnover.toFixed(2)} one-way/wk -> drag @${RT_BP}bp ${drag.toFixed(2)}%/yr -> NET ${(sg.mean * 52 * 100 - drag).toFixed(2)}%/yr`);
  console.log(`      HALVES pre-2015: ${h1 ? `${ann(h1)}%/yr t ${h1.t.toFixed(2)} n ${h1.n}` : "n/a"}  |  post-2015 (OOS-style): ${h2 ? `${ann(h2)}%/yr t ${h2.t.toFixed(2)} n ${h2.n}` : "n/a"}`);
  console.log(`      HOLDABILITY  longest underwater ${uw.longest} weeks (${(uw.longest / 52).toFixed(1)}y)  worst DD ${(uw.worst * 100).toFixed(1)}%${uw.worst < -1 ? "  !! RUINED" : ""}`);
  const matched = draw.mean > build.mean;
  console.log(`    SIGN vs prior: ${matched ? "MATCHED" : "MISSED"} (draw weeks ${matched ? ">" : "<="} build weeks)`);
  const v = uw.worst < -1 ? `RUINED — log DD ${(uw.worst * 100).toFixed(0)}%`
    : Math.abs(sg.t) < 2 ? `NULL — sign-conditioned |t| ${Math.abs(sg.t).toFixed(2)} < 2`
    : (sg.mean * 52 * 100 - drag) <= 0 ? `SUB-COST — gross t ${sg.t.toFixed(2)}, net <= 0 (weekly turnover ${turnover.toFixed(2)} is the killer)`
    : !h2 || Math.abs(h2.t) < 2 ? `NULL OUT-OF-SAMPLE — full gross t ${sg.t.toFixed(2)} but post-2015 gross t ${h2?.t.toFixed(2)} < 2`
    : `CANDIDATE — gross t ${sg.t.toFixed(2)} full / ${h2.t.toFixed(2)} post-2015, net ${(sg.mean * 52 * 100 - drag).toFixed(2)}%/yr; single instrument, under the 5.46 ceiling`;
  verdicts.push(`${name}: ${v}`); console.log(`    VERDICT ${name}: ${v}\n`);
}
console.log(`  TRIALS THIS RUN: ${trials} (one per commodity; z-window and the zero threshold fixed before running).`);
console.log(`\n  VERDICT: ${verdicts.join(" | ")}`);
console.log(`  DESCRIPTIVE ONLY — the consensus SURPRISE is UNTESTED (not held); not a gate clearance; not on a forward clock.`);
