#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// despac-event-506.ts (D-734c) — the de-SPAC underperformance study RE-DERIVED on the CORRECT completion dates.
// D-734b found the original event table was built from "consummation of the business combination", which also
// appears in a SPAC's IPO-closing 8-K, and despac-event.ts kept the FIRST such 8-K per ticker — so LCID's
// "completion" was 2020-08-04 (Churchill IV IPO close), SOFI's 2020-10-14, OPEN's 2020-04-30, and PSTH (never
// merged) carried a row. The corrected marker is 8-K Item 5.06 "Change in Shell Company Status" (the Super 8-K),
// re-derived into data/despac-506-events.json (ticker = the POST-merger ticker via the filer CIK). Same windows,
// same liquid-tercile, same benchmark, same survivorship handling as despac-event.ts — only the dates change.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("despac-event-506", [{ name: "WINDOWS", def: "60,250,500", note: "forward horizons (trading days)" }, { name: "BENCH", def: "IWM", note: "SPY or IWM" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dse506", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
async function bars(sym: string): Promise<number[][]> { const r = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }); if (!r.ok) throw new Error(`bars ${sym}: ${r.status}`); const raw = await r.json(); return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0); }

interface Ev { ticker: string | null; date: string; }
const doc = JSON.parse(await Deno.readTextFile("data/despac-506-events.json")) as { events: Ev[] };
const events = doc.events.filter((e) => e.ticker && /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.date)) as { ticker: string; date: string }[];
assertNonEmpty("resolved 506 de-SPAC events", events, 50);

// POSITIVE CONTROL ON THE EVENT TABLE ITSELF (the discipline D-734b was missing): the completion date for these
// known de-SPACs must be the MERGER, not the SPAC's IPO closing; PSTH (never merged) must be ABSENT. RED otherwise.
const byT = new Map<string, string>();
for (const e of events) { const c = byT.get(e.ticker); if (!c || e.date < c) byT.set(e.ticker, e.date); }
const CTL: [string, string][] = [["LCID", "2021-07-26"], ["SOFI", "2021-06-04"], ["OPEN", "2020-12-18"], ["DKNG", "2020-04-29"]];
let ctlOk = true;
for (const [tk, want] of CTL) { const got = byT.get(tk); const ok = got != null && Math.abs((Date.parse(got) - Date.parse(want)) / 86400000) <= 5; console.log(`  CONTROL ${tk}: got ${got ?? "ABSENT"} want ~${want} ${ok ? "OK" : "*** FAIL"}`); ctlOk &&= ok; }
const psth = byT.has("PSTH"); console.log(`  CONTROL PSTH (never merged): ${psth ? "*** PRESENT — FAIL" : "absent OK"}`); ctlOk &&= !psth;
if (!ctlOk) { console.error("!! EVENT-TABLE POSITIVE CONTROL FAILED — the dates are not merger completions. RED."); Deno.exit(1); }

const bench = new Map((await bars(K.BENCH)).map((b) => [iso(b[0]), b[4]]));
const WINS = K.WINDOWS.split(",").map(Number);
const results: { ex: number; dollarVol: number }[][] = WINS.map(() => []);
let captured = 0, noPrice = 0, noWindow = 0;
for (const [tk, d] of byT) {
  const b = await bars(tk); if (b.length < 40) { noPrice++; continue; }
  const dt = b.map((x) => iso(x[0]));
  const dv = b.map((x) => x[4] * x[5]); const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  const ci = dt.findIndex((x) => x >= d); if (ci < 0 || (ci + 20 >= b.length && dt[dt.length - 1] >= "2026-06-01")) { noWindow++; continue; }
  const lastDt = dt[dt.length - 1]; let any = false;
  for (let wi = 0; wi < WINS.length; wi++) {
    const w = WINS[wi]; let iT = ci + w;
    if (iT >= b.length) { if (lastDt >= "2026-06-01") continue; iT = b.length - 1; }   // delisters measured to last bar (captures failure)
    if (iT <= ci) continue;
    const p0 = b[ci][4], p1 = b[iT][4], s0 = bench.get(dt[ci]) ?? [...bench.entries()].find(([sd]) => sd >= dt[ci])?.[1], s1 = bench.get(dt[iT]) ?? [...bench.entries()].reverse().find(([sd]) => sd <= dt[iT])?.[1];
    if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
    results[wi].push({ ex: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dollarVol: medDV }); any = true;
  }
  if (any) captured++;
}
console.log(`\n==> DE-SPAC EVENT STUDY on CORRECTED 5.06 dates — ${captured} de-SPACs (${noPrice} no price, ${noWindow} no window), excess vs ${K.BENCH}`);
console.log(`    OLD (D-734, wrong dates): 500d ALL median -40.7% (t -3.63); LIQUID 500d flat (median -3.7%, t 0.08). Comparison below.\n`);
for (let wi = 0; wi < WINS.length; wi++) {
  const all = results[wi]; if (all.length < 20) { console.log(`    ${WINS[wi]}d: n=${all.length} (too few)`); continue; }
  const sorted = [...all].sort((a, b) => a.dollarVol - b.dollarVol);
  const liq = sorted.slice(Math.floor(sorted.length * 2 / 3)).map((x) => x.ex);
  const e = all.map((x) => x.ex);
  console.log(`    ${String(WINS[wi]).padStart(4)}d  ALL n=${String(all.length).padStart(4)} median ${med(e).toFixed(1)}% (mean ${mean(e).toFixed(1)}%, t ${tstat(e).toFixed(2)}, win ${(100 * e.filter((x) => x > 0).length / e.length).toFixed(0)}%)  |  LIQUID n=${String(liq.length).padStart(4)} median ${med(liq).toFixed(1)}% (mean ${mean(liq).toFixed(1)}%, t ${tstat(liq).toFixed(2)}, win ${(100 * liq.filter((x) => x > 0).length / liq.length).toFixed(0)}%)`);
}
console.log(`\n    NOTE: dates are the Item 5.06 change-in-shell-status filing (the true merger completion). The event-table`);
console.log(`    positive control (LCID/SOFI/OPEN merger dates, PSTH absent) passed — this is the D-734b discipline.`);
