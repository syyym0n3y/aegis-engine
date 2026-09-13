#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// data-stack-audit.ts (D-879) — the D-858 principles applied to the ENTIRE data stack, not one series: every price
// table, every timeframe, every macro series. Per series: duplicate stamps, off-grid stamps, zero-volume placeholders,
// OHLC inconsistency, absurd moves, staleness against the source's cadence. Equities are sampled (all metadata, full
// bars for a fixed random sample) because 19,531 bar arrays is a whole-panel read the D-812 rule forbids in one go.
// Writes data/data-stack-audit.json; guarded by data-stack-guard.ts (ratchet on RED count).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("data-stack-audit", [{ name: "EQ_SAMPLE", def: "300" }, { name: "SEED", def: "42" }, { name: "OUT", def: "data/data-stack-audit.json" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dsa", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
type F = { table: string; tf: string; symbol: string; bars: number; dup: number; offgrid: number; zeroVol: number; badOHLC: number; big: number; staleDays: number; verdict: string };
const findings: F[] = []; const todayS = Date.now() / 1000;
const check = (table: string, tf: string, symbol: string, b: number[][], step: number, staleBudgetDays: number, volMeaningful: boolean): F => {
  let dup = 0, off = 0, zero = 0, bad = 0, big = 0; b.sort((x, y) => x[0] - y[0]);
  for (let i = 0; i < b.length; i++) { const r = b[i]; const [t, o, h, l, c, v] = r; if (!(v > 0)) zero++; if (!(o > 0 && l > 0 && h >= l) || (step < 86400 && !(h >= Math.max(o, c) && l <= Math.min(o, c)))) bad++; else if (step >= 86400 && !(h >= Math.max(o, c) * 0.999 && l <= Math.min(o, c) * 1.001)) bad++; if (step === 3600 && t % 3600) off++; if (i) { if (t === b[i - 1][0]) dup++; if (b[i - 1][4] > 0 && c > 0 && Math.abs(Math.log(c / b[i - 1][4])) > (step >= 86400 ? 0.5 : 0.1)) big++; } }
  const staleDays = b.length ? (todayS - b[b.length - 1][0]) / 86400 : 999; const live = b.filter((r) => r[5] > 0).length;
  // zero volume is a PLACEHOLDER only where the source reports volume (hourly CFD/FX feed, perps); Yahoo daily FX / index / rate series carry vol 0 legitimately (the first run of this audit flagged all 20 FX dailies for that — an audit-rule defect, not a data one)
  const red = dup > 0 || off > 0 || bad > 0 || (staleDays > staleBudgetDays) || (volMeaningful && live < 0.5 * b.length);
  return { table, tf, symbol, bars: b.length, dup, offgrid: off, zeroVol: zero, badOHLC: bad, big, staleDays: +staleDays.toFixed(1), verdict: red ? "RED" : "ok" };
};
// 1. trd_bars_intraday, every tf, every symbol (paged 20)
const im = await q(`trd_bars_intraday?select=tf,symbol&order=tf,symbol`) as { tf: string; symbol: string }[];
// A survivor-free panel HOLDS dead contracts by design (D-645/844): a contract whose last bar is old is DEAD, not stale, as long as the
// PANEL itself is fresh. So per-contract staleness is judged against the panel's newest bar, and the panel's own freshness is the RED.
const panelNewest = new Map<string, number>();
for (const tf of [...new Set(im.map((r) => r.tf))]) { const syms = im.filter((r) => r.tf === tf).map((r) => r.symbol); const step = tf.startsWith("1h") ? 3600 : 86400;
  for (let i = 0; i < syms.length; i += 20) { const page = syms.slice(i, i + 20); const rows = await q(`trd_bars_intraday?tf=eq.${tf}&symbol=in.(${page.join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[]; for (const r of rows) { const b = ((r.bars ?? []) as number[][]).map((x) => { const d = decodeBar(x); return [d.ts, d.o, d.h, d.l, d.c, d.v]; }); const f = check("trd_bars_intraday", tf, r.symbol, b, step, tf === "1h" || tf === "1hSF" ? 3 : 4, true); if (b.length) panelNewest.set(tf, Math.max(panelNewest.get(tf) ?? 0, b[b.length - 1][0])); findings.push(f); } }
  const pn = panelNewest.get(tf) ?? 0; const panelStaleDays = (todayS - pn) / 86400; const budget = tf.startsWith("1h") ? 3 : 4;
  for (const f of findings) if (f.table === "trd_bars_intraday" && f.tf === tf && f.verdict === "RED" && f.dup === 0 && f.offgrid === 0 && f.badOHLC === 0) { if (panelStaleDays <= budget) f.verdict = "ok-delisted"; else f.verdict = "RED-PANEL-STALE"; }
  console.log(`  panel ${tf.padEnd(8)} newest bar ${new Date(pn * 1000).toISOString().slice(0, 10)} (${panelStaleDays.toFixed(1)}d; budget ${budget}d) ${panelStaleDays > budget ? "RED — the whole panel is not being refreshed" : "ok"}`); }
// 2. trd_fx_hourly, every symbol
// PostgREST has no DISTINCT and the first run read 100k rows of two symbols; enumerate by probing each known symbol (D-879 audit-of-the-audit).
const FX_BASE = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"]; const fxSyms: string[] = [];
for (const b of FX_BASE) for (const sfx of ["", ".yh1h"]) { const p = await q(`trd_fx_hourly?symbol=eq.${b}${sfx}&select=ts&limit=1`) as { ts: number }[]; if (p.length) fxSyms.push(b + sfx); }
for (const sym of fxSyms) { const out: number[][] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; if (!p.length) break; out.push(...p.map((r) => [r.ts, r.o, r.h, r.l, r.c, r.vol])); from = p.at(-1)!.ts; if (p.length < 20000) break; } findings.push(check("trd_fx_hourly", "1h", sym, out, 3600, sym.endsWith(".yh1h") ? 4 : 5, !(sym.endsWith(".yh1h") && /^(EURUSD|GBPUSD|USDJPY|AUDUSD)/.test(sym)))); }   // Yahoo 60m FX has no volume: h!=l is the liveness test there, not vol>0
// 3. trd_bars_deep: all non-equity fully; equities by a seeded sample
const dm = await q(`trd_bars_deep?select=symbol,asset_class,last_date,n_bars&limit=30000`) as { symbol: string; asset_class: string; last_date: string; n_bars: number }[];
const nonEq = dm.filter((r) => r.asset_class !== "equity").map((r) => r.symbol); const eq = dm.filter((r) => r.asset_class === "equity");
let seed = +K.SEED; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const eqSample = [...eq].sort(() => rnd() - 0.5).slice(0, +K.EQ_SAMPLE).map((r) => r.symbol);
const badOHLCSource: string[] = [];
for (const list of [nonEq, eqSample]) for (let i = 0; i < list.length; i += 10) { const page = list.slice(i, i + 10); const rows = await q(`trd_bars_deep?symbol=in.(${page.map(encodeURIComponent).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[]; for (const r of rows) { const f = check("trd_bars_deep", r.asset_class, r.symbol, (r.bars ?? []).map((x) => [x[0], x[1], x[2], x[3], x[4], x[5] ?? 1]), 86400, r.asset_class === "equity" ? 400 : 10, false); if (r.asset_class === "equity" && f.staleDays > 10 && f.dup === 0) f.verdict = "ok-delisted"; if (r.asset_class === "crypto_ex" && f.staleDays > 10) f.verdict = "ok-retired-source"; if (r.asset_class === "crypto" && f.staleDays > 100 && f.dup === 0) f.verdict = "ok-delisted"; /* a coin Yahoo stopped serving months ago is dead (MATIC renamed, FTM->S, APT/GRT/IMX dropped) — same class as a delisted equity */ /* D-879: the *-EX exchange series have no live source (Yahoo returns unavailable); retired, not stale, and no consumer reads them */ if (f.badOHLC > 0 && f.dup === 0 && f.staleDays <= 10) { f.verdict = "ok-badOHLC-source"; badOHLCSource.push(`${r.symbol}:${f.badOHLC}`); } findings.push(f); } }
// equity metadata staleness census (all 19k, metadata only)
const eqStale = eq.filter((r) => (Date.now() - Date.parse(r.last_date)) / 86400000 > 10).length;
// 4. macro series staleness against a generous weekly budget for daily-ish series, monthly for the rest
const ms = await q(`trd_macro_series?select=series,d&order=series,d.desc&limit=200000`) as { series: string; d: string }[];
const newest = new Map<string, string>(); for (const r of ms) if (!newest.has(r.series)) newest.set(r.series, r.d);
const macroStale = [...newest.entries()].filter(([s, d]) => !/^(split:|bls:|est_)/.test(s) && (Date.now() - Date.parse(d)) / 86400000 > 45).map(([s, d]) => `${s}@${d}`);
const red = findings.filter((f) => f.verdict.startsWith("RED"));
console.log(`\n==> DATA STACK AUDIT — ${findings.length} series checked (intraday ${findings.filter((f) => f.table === "trd_bars_intraday").length}, fx ${findings.filter((f) => f.table === "trd_fx_hourly").length}, deep non-equity ${nonEq.length}, equity sample ${eqSample.length} of ${eq.length})`);
console.log(`  RED ${red.length}; zero-volume placeholders present in ${findings.filter((f) => f.zeroVol > 0).length} series (droppable, the D-858 rule); delisted-looking equities in the full metadata census: ${eqStale} of ${eq.length} (${(100 * eqStale / eq.length).toFixed(1)}%) — the survivorship figure, not a defect`);
for (const f of red.filter((f) => !f.verdict.endsWith("PANEL-STALE")).slice(0, 40)) console.log(`    RED  ${f.table}/${f.tf} ${f.symbol.padEnd(16)} bars ${f.bars} dup ${f.dup} offgrid ${f.offgrid} badOHLC ${f.badOHLC} zeroVol ${f.zeroVol} stale ${f.staleDays}d`);
console.log(`  Yahoo daily bars with OHLC inconsistent with the ADJUSTED close (a SOURCE property: adjusted close vs raw O/H/L): ${badOHLCSource.length} series — ${badOHLCSource.slice(0, 8).join(", ")}${badOHLCSource.length > 8 ? " …" : ""}. RULE: no range or level rule on trd_bars_deep without an OHLC-consistency filter; close-only rules (D-863+) are unaffected.`);
console.log(`  macro series stale > 45d (excluding splits/bls/estimates): ${macroStale.length}${macroStale.length ? " — " + macroStale.slice(0, 12).join(", ") : ""}`);
await Deno.writeTextFile(new URL(`../${K.OUT}`, import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), red: red.length, series: findings.length, eqStale, eqTotal: eq.length, macroStale, findings: red }, null, 1));
