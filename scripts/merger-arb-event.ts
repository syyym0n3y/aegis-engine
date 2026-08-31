#!/usr/bin/env -S deno run --allow-net --allow-env
// merger-arb-event.ts (D-732 Phase 1) — event study on merger-agreement 8-Ks (D-732 ingest). Closes the merger-arb
// leg. For each filer of an "agreement and plan of merger" 8-K, measure the return around the filing:
//   ANNOUNCEMENT pop (T-1 -> T+1): the target's jump to near the deal price (already priced, NOT tradable — you
//     cannot buy before the announcement).
//   POST-ANNOUNCEMENT DRIFT (T+1 -> T+N): the merger-arb return proxy — the convergence of the target price to the
//     deal price after the announcement. This is the tradable window, and the honest question.
// Excess vs SPY over the same window (BENCHMARK), LIQUID tercile only (LIQUIDITY LAW), breadth reported.
//
// TWO CAVEATS BAKED IN: (1) the filer is usually the TARGET (item 1.01) but sometimes the ACQUIRER, so this is the
// AVERAGE drift of merger-8-K filers, not a pure target book — a mix that dilutes a target-only signal. (2) the deal
// PRICE is not held (would need parsing the 8-K text), so this measures DRIFT, not spread-to-deal; a genuine
// merger-arb book needs the deal terms and the deal-failure hazard, neither of which is in the filing metadata.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("merger-arb-event", [{ name: "FWD", def: "40", note: "post-announcement drift horizon (trading days)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mae", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

// Events: (ticker, filing_date) from the merger ingest. FTS stored the filer ticker in the ticker column.
async function pageAll(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) { const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr }); if (!r.ok) break; const j = await r.json(); if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break; }
  return out;
}
const events = (await pageAll("trd_raw_filings?filing_type=like.*merger*&ticker=not.is.null&select=ticker,disclosed_date&order=disclosed_date"))
  .map((r) => ({ ticker: r.ticker as string, d: r.disclosed_date as string }))
  .filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.d));
assertNonEmpty("merger events with tickers", events, 200);

// SPY benchmark (index by date) and a bars loader with a liquidity proxy.
async function bars(sym: string): Promise<number[][]> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
}
const spyBars = await bars("SPY");
const spy = new Map(spyBars.map((b) => [iso(b[0]), b[4]]));

const FWD = Number(K.FWD);
// group events by ticker to load each series once
const byTicker = new Map<string, string[]>();
for (const e of events) (byTicker.get(e.ticker) ?? byTicker.set(e.ticker, []).get(e.ticker)!).push(e.d);

interface Ev { pop: number; drift: number; dollarVol: number }
const evs: Ev[] = [];
let noPrice = 0, tooEarly = 0;
for (const [tk, ds] of byTicker) {
  const b = await bars(tk);
  if (b.length < 60) { noPrice += ds.length; continue; }
  const dates = b.map((x) => iso(x[0]));
  const close = new Map(dates.map((d, i) => [d, b[i][4]]));
  const dv = b.map((x) => x[4] * x[5]);
  const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  for (const d of ds) {
    let i = dates.findIndex((x) => x >= d); if (i < 5 || i + FWD >= dates.length) { tooEarly++; continue; }
    const pPre = close.get(dates[i - 1])!, pPost1 = close.get(dates[i + 1])!, pDrift = close.get(dates[i + FWD])!;
    const sPre = spy.get(dates[i - 1]), sPost1 = spy.get(dates[i + 1]), sDrift = spy.get(dates[i + FWD]);
    if (!(pPre > 0 && pPost1 > 0 && pDrift > 0 && sPre && sPost1 && sDrift)) continue;
    const pop = (pPost1 / pPre - 1) - (sPost1 / sPre - 1);                 // excess announcement pop
    const drift = (pDrift / pPost1 - 1) - (sDrift / sPost1 - 1);           // excess post-announcement drift (tradable window)
    evs.push({ pop: pop * 100, drift: drift * 100, dollarVol: medDV });
  }
}
assertNonEmpty("resolved merger events", evs, 100);

// LIQUIDITY LAW: split by median dollar volume; the tradable claim is the LIQUID tercile.
const sorted = [...evs].sort((a, b) => a.dollarVol - b.dollarVol);
const liq = sorted.slice(Math.floor(sorted.length * 2 / 3));   // top third by dollar volume
const report = (label: string, s: Ev[]) => {
  const pop = s.map((x) => x.pop), dr = s.map((x) => x.drift);
  console.log(`    ${label.padEnd(18)} n=${String(s.length).padStart(5)}  ann-pop excess ${mean(pop).toFixed(2)}% (t ${tstat(pop).toFixed(1)})  |  post-ann DRIFT excess ${mean(dr).toFixed(2)}% (t ${tstat(dr).toFixed(2)})`);
  return { drift: mean(dr), t: tstat(dr) };
};
console.log(`==> MERGER-ARB EVENT STUDY — ${evs.length} resolved events, forward drift ${FWD}d, excess vs SPY`);
console.log(`    (${events.length} merger-8-K events with tickers; ${noPrice} no price series, ${tooEarly} outside the panel window)\n`);
report("ALL", evs);
const liqRes = report("LIQUID tercile", liq);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "merger-arb-event", runId: `mae|drift${FWD}`, spent: 2 });
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`    The ANNOUNCEMENT pop is not tradable (pre-event). The tradable window is the POST-announcement DRIFT.`);
console.log(`    VERDICT: ${Math.abs(liqRes.t) > 3 && liqRes.drift > 0 ? `liquid post-announcement drift +${liqRes.drift.toFixed(2)}% t ${liqRes.t.toFixed(2)} — a candidate; needs deal-price + deal-failure hazard + costs before any claim.` : `no tradable post-announcement drift in the liquid tercile (excess ${liqRes.drift.toFixed(2)}%, t ${liqRes.t.toFixed(2)}) — the announcement is efficiently priced. NULL.`}`);
console.log(`    CAVEATS: filer is a TARGET/ACQUIRER mix (not a pure target book); deal PRICE not held so this is drift`);
console.log(`    not spread-to-deal; a real arb book needs the terms + failure hazard, neither in the filing metadata.`);
