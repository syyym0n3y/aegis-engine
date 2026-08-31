#!/usr/bin/env -S deno run --allow-net --allow-env
// despac-event.ts (D-734 Phase 2) — the de-SPAC underperformance anomaly. Companies that go public via a SPAC merger
// historically UNDERPERFORM the market in the year+ after the combination completes. Test on the de-SPAC completion
// 8-Ks ("consummation of the business combination", D-734 ingest): the filer CIK's ticker is the POST-merger ticker,
// the filing date is the completion date. Measure forward excess vs SPY AND size-matched IWM, in the liquid tercile,
// survivorship-corrected (delisters — and de-SPACs delist a lot — measured to their last bar, which captures the
// failure rather than hiding it). Judged on the MEDIAN + win-rate, per the spin-off lesson.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("despac-event", [{ name: "WINDOWS", def: "60,250,500", note: "forward horizons (trading days)" }, { name: "BENCH", def: "IWM", note: "SPY or IWM (size-matched)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dse", exp: 4102444800 });
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

async function pageAll(path: string) { if (!/order=/.test(path)) throw new Error(`pageAll requires order=: ${path}`); /* plumbing-ok: audited */ const out: Record<string, unknown>[] = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr }); if (!r.ok) break; const j = await r.json(); if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break; } return out; }
async function bars(sym: string): Promise<number[][]> { const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []); return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0); }

const events = (await pageAll("trd_raw_filings?filing_type=like.%25despac%25&ticker=not.is.null&select=ticker,disclosed_date&order=disclosed_date"))
  .map((r) => ({ ticker: r.ticker as string, d: r.disclosed_date as string })).filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.d));
assertNonEmpty("resolved de-SPAC events", events, 50);
const bench = new Map((await bars(K.BENCH)).map((b) => [iso(b[0]), b[4]]));
const WINS = K.WINDOWS.split(",").map(Number);

// dedupe per (ticker, date) — a completion often files multiple 8-Ks; keep the FIRST completion date per ticker.
const firstByTicker = new Map<string, string>();
for (const e of events) { const cur = firstByTicker.get(e.ticker); if (!cur || e.d < cur) firstByTicker.set(e.ticker, e.d); }

const results: { ex: number; dollarVol: number }[][] = WINS.map(() => []);
let captured = 0, noPrice = 0, noWindow = 0;
for (const [tk, d] of firstByTicker) {
  const b = await bars(tk); if (b.length < 40) { noPrice++; continue; }
  const dt = b.map((x) => iso(x[0]));
  const dv = b.map((x) => x[4] * x[5]); const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  // completion index: first trading day on/after the completion 8-K date
  const ci = dt.findIndex((x) => x >= d); if (ci < 0 || ci + 20 >= b.length && dt[dt.length - 1] >= "2026-06-01") { noWindow++; continue; }
  const lastDt = dt[dt.length - 1];
  let any = false;
  for (let wi = 0; wi < WINS.length; wi++) {
    const w = WINS[wi]; let iT = ci + w;
    if (iT >= b.length) { if (lastDt >= "2026-06-01") continue; iT = b.length - 1; }   // survivorship: delisters to last bar
    if (iT <= ci) continue;
    const p0 = b[ci][4], p1 = b[iT][4], s0 = bench.get(dt[ci]) ?? [...bench.entries()].find(([sd]) => sd >= dt[ci])?.[1], s1 = bench.get(dt[iT]) ?? [...bench.entries()].reverse().find(([sd]) => sd <= dt[iT])?.[1];
    if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
    results[wi].push({ ex: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dollarVol: medDV }); any = true;
  }
  if (any) captured++;
}
console.log(`==> DE-SPAC EVENT STUDY — ${captured} de-SPACs (${noPrice} no price, ${noWindow} no window), excess vs ${K.BENCH}`);
console.log(`    documented: de-SPACs UNDERPERFORM post-combination. Judged on median + win-rate.\n`);
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "despac-event", runId: `dse|${K.BENCH}|${WINS.join(",")}`, spent: WINS.length });
for (let wi = 0; wi < WINS.length; wi++) {
  const all = results[wi]; if (all.length < 20) { console.log(`    ${WINS[wi]}d: n=${all.length} (too few)`); continue; }
  const sorted = [...all].sort((a, b) => a.dollarVol - b.dollarVol);
  const liq = sorted.slice(Math.floor(sorted.length * 2 / 3)).map((x) => x.ex);
  const e = all.map((x) => x.ex);
  console.log(`    ${String(WINS[wi]).padStart(4)}d  ALL n=${String(all.length).padStart(4)} median ${med(e).toFixed(1)}% (mean ${mean(e).toFixed(1)}%, t ${tstat(e).toFixed(2)})  |  LIQUID n=${String(liq.length).padStart(4)} median ${med(liq).toFixed(1)}% (mean ${mean(liq).toFixed(1)}%, t ${tstat(liq).toFixed(2)}, win ${(100 * liq.filter((x) => x > 0).length / liq.length).toFixed(0)}%)`);
}
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`    A negative liquid median confirms the documented de-SPAC underperformance. Shorting it needs borrow`);
console.log(`    (paid, de-SPACs are hard-to-borrow) so a confirmed underperformance is a finding, not a free trade.`);
