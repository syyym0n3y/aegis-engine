#!/usr/bin/env -S deno run --allow-net --allow-env
// gld-flow.ts (D-745) — does GOLD ETF FLOW (the change in GLD's tonnes held) condition next-week gold returns, or does
// flow merely FOLLOW price? Both stories are told loudly; neither is measured on this stack until now. The flow
// driver was the register's last research debt; this is its first test.
//
// Construction: weekly change in gld_tonnes (Fri-to-Fri), z-scored on the trailing 52 weekly changes (the LEVEL is a
// decade-long trend and would be a D-730 trap). Signal known at the Friday close (the issuer publishes holdings the
// same day, after the close); entry the first close STRICTLY AFTER (lag-1, D-498); hold 5 bars; instrument GC=F.
// Reported both ways: (a) does flow PREDICT next-week return (the tradable question); (b) does last week's RETURN
// predict this week's flow (the flow-follows-price question, descriptive). HONESTY: single instrument, GROSS unless
// NET labelled, turnover/drag, time underwater, RUINED check, era halves, SIGN prior stated first, 2 trials.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("gld-flow", [{ name: "RT_BP", def: "5", note: "round-trip GC futures cost in bp" }]);
const RT_BP = Number(Deno.env.get("RT_BP") || "5");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gldflow", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);

type Bar = [number, number, number, number, number, number];
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const stats = (x: number[]) => { const n = x.length, mean = x.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)); return { n, mean, sd, t: mean / (sd / Math.sqrt(n)), sr: (mean / sd) * Math.sqrt(52) }; };
const underwater = (x: number[]) => { let peak = 0, cum = 0, longest = 0, cur = 0, worst = 0; for (const r of x) { cum += r; if (cum > peak) { peak = cum; cur = 0; } else { cur++; if (cur > longest) longest = cur; } if (cum - peak < worst) worst = cum - peak; } return { longest, worst }; };
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } const r = sab / Math.sqrt(saa * sbb); return { r, t: r * Math.sqrt((n - 2) / (1 - r * r)), n }; };

const gc = (await q(`trd_bars_deep?symbol=eq.GC%3DF&select=bars`))[0];
const bars: Bar[] = (gc?.bars || []).filter((b: Bar) => b[4] > 0);
assertNonEmpty("GC=F bars", bars, 3000);
const dates = bars.map((b) => iso(b[0])), close = bars.map((b) => b[4]);
const idxAfter = (d: string) => { let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) lo = m + 1; else hi = m; } return lo; };
const idxAtOrBefore = (d: string) => idxAfter(d) - 1;
const ton = (await q(`trd_macro_series?series=eq.gld_tonnes&select=d,v&order=d.asc`)) as { d: string; v: number }[]; // plumbing-ok: ordered single series
assertNonEmpty("gld_tonnes", ton, 3000);
// Friday (week-end) observations: last obs of each ISO week
const wk = new Map<string, { d: string; v: number }>();
for (const r of ton) { const dt = new Date(r.d); const thu = new Date(dt); thu.setUTCDate(dt.getUTCDate() + 3 - ((dt.getUTCDay() + 6) % 7)); const key = `${thu.getUTCFullYear()}-${String(Math.ceil(((thu.getTime() - Date.UTC(thu.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`; wk.set(key, r); }
const weeks = [...wk.values()].sort((a, b) => a.d < b.d ? -1 : 1);

console.log(`==> GLD FLOW -> GOLD (D-745) — weekly change in GLD tonnes vs next-week GC=F, ${weeks[0].d} .. ${weeks[weeks.length - 1].d}\n`);
console.log(`  SIGN PRIOR (stated first): INFLOW (z>0) -> POSITIVE next-week gold return (the "flows drive price" story). The alternative`);
console.log(`  story, "flow follows price", is measured separately below and is DESCRIPTIVE. Single instrument; 2 trials.\n`);

const rows: { d: string; z: number; retFwd: number; retPrev: number }[] = [];
const chg: number[] = [];
for (let i = 1; i < weeks.length; i++) {
  const c = weeks[i].v - weeks[i - 1].v; chg.push(c);
  if (chg.length < 53) continue;
  const win = chg.slice(-53, -1); const m = win.reduce((a, b) => a + b, 0) / win.length; const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (win.length - 1));
  if (!(sd > 0)) continue;
  const e = idxAfter(weeks[i].d), x = e + 5, p0 = idxAtOrBefore(weeks[i - 1].d), p1 = idxAtOrBefore(weeks[i].d);
  if (e === 0 || x >= close.length || p0 < 0) continue;
  rows.push({ d: weeks[i].d, z: (c - m) / sd, retFwd: Math.log(close[x] / close[e]), retPrev: Math.log(close[p1] / close[p0]) });
}
assertNonEmpty("flow panel", rows, 300);
{ const u = stats(rows.map((r) => r.retFwd)); if (Math.abs(u.mean * 52) > 0.40) { console.error(`!! unconditional ${(u.mean * 52 * 100).toFixed(1)}%/yr is not a market number — alignment defect. RED.`); Deno.exit(1); } }

// (a) PREDICTIVE: sign-conditioned long-on-inflow / short-on-outflow
const uncond = stats(rows.map((r) => r.retFwd));
const signed = rows.map((r) => (r.z > 0 ? 1 : -1) * r.retFwd); const sg = stats(signed), uw = underwater(signed);
const inflow = stats(rows.filter((r) => r.z > 0).map((r) => r.retFwd)), outflow = stats(rows.filter((r) => r.z <= 0).map((r) => r.retFwd));
const big = rows.filter((r) => Math.abs(r.z) > 1); const bigS = big.length > 30 ? stats(big.map((r) => (r.z > 0 ? 1 : -1) * r.retFwd)) : null;
let flips = 0; for (let i = 1; i < rows.length; i++) if ((rows[i].z > 0) !== (rows[i - 1].z > 0)) flips++;
const turnover = flips / rows.length * 2, drag = turnover * 52 * (RT_BP / 1e4) * 100;
const half = (a: string, b: string) => { const s = rows.filter((r) => r.d >= a && r.d < b).map((r) => (r.z > 0 ? 1 : -1) * r.retFwd); return s.length > 52 ? stats(s) : null; };
const h1 = half("1900-01-01", "2016-01-01"), h2 = half("2016-01-01", "2100-01-01");
const ann = (s: { mean: number }) => (s.mean * 52 * 100).toFixed(2);
console.log(`  (a) FLOW -> NEXT-WEEK RETURN   ${rows.length} weeks`);
console.log(`    UNCONDITIONAL (benchmark)  ${ann(uncond)}%/yr  t ${uncond.t.toFixed(2)}`);
console.log(`    after INFLOW n=${inflow.n}  ${ann(inflow)}%/yr t ${inflow.t.toFixed(2)}   | after OUTFLOW n=${outflow.n}  ${ann(outflow)}%/yr t ${outflow.t.toFixed(2)}`);
console.log(`    SIGN-CONDITIONED (gross)  ${ann(sg)}%/yr  SR ${sg.sr.toFixed(2)}  gross t ${sg.t.toFixed(2)}   | large-|z|>1: ${bigS ? `${ann(bigS)}%/yr gross t ${bigS.t.toFixed(2)} n ${bigS.n}` : "n/a"}`);
console.log(`      turnover ${turnover.toFixed(2)} one-way/wk -> drag ${drag.toFixed(2)}%/yr -> NET ${(sg.mean * 52 * 100 - drag).toFixed(2)}%/yr`);
console.log(`      HALVES pre-2016 ${h1 ? `${ann(h1)}%/yr t ${h1.t.toFixed(2)}` : "n/a"} | post-2016 ${h2 ? `${ann(h2)}%/yr t ${h2.t.toFixed(2)}` : "n/a"}`);
console.log(`      HOLDABILITY  longest underwater ${uw.longest} wks (${(uw.longest / 52).toFixed(1)}y)  worst DD ${(uw.worst * 100).toFixed(1)}%${uw.worst < -1 ? "  !! RUINED" : ""}`);
console.log(`    SIGN vs prior: ${inflow.mean > outflow.mean ? "MATCHED" : "MISSED"}`);
const va = uw.worst < -1 ? `RUINED (log DD ${(uw.worst * 100).toFixed(0)}%)` : Math.abs(sg.t) < 2 ? `NULL — |t| ${Math.abs(sg.t).toFixed(2)} < 2` : (sg.mean * 52 * 100 - drag) <= 0 ? `SUB-COST` : !h2 || Math.abs(h2.t) < 2 ? `NULL OUT-OF-SAMPLE (post-2016 t ${h2?.t.toFixed(2)})` : `CANDIDATE — gross t ${sg.t.toFixed(2)} / post-2016 ${h2.t.toFixed(2)}, under the 5.46 ceiling`;
console.log(`    VERDICT (a): ${va}\n`);

// (b) DESCRIPTIVE: does last week's return predict this week's flow? (contemporaneous and one-week-lagged correlation)
const cb = corr(rows.map((r) => r.retPrev), rows.map((r) => r.z));
console.log(`  (b) FLOW FOLLOWS PRICE? corr(last-week GC return, this-week flow z) = ${cb.r.toFixed(3)}  t ${cb.t.toFixed(2)}  n ${cb.n}   [DESCRIPTIVE ONLY]`);
console.log(`\n  TRIALS THIS RUN: 2. VERDICT: (a) ${va}; (b) descriptive.`);
console.log(`  DESCRIPTIVE ONLY — no mechanism registered; not a gate clearance; not on a forward clock.`);
