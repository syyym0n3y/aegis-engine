#!/usr/bin/env -S deno run --allow-net
// trd-macro-refresh — fetch the FREE FRED series, classify the current US macro regime with the
// tested trd-macro engine, and PRINT the state JSON (+ upsert if SUPABASE_SERVICE_ROLE_KEY is set).
// Runs from any network that can reach FRED (the Supabase edge datacenter is blocked by FRED's CDN;
// this laptop is not). Macro shifts slowly, so a periodic run keeps trd_macro_state fresh enough.
//
//   deno run --allow-net scripts/trd-macro-refresh.ts            # prints JSON
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net scripts/trd-macro-refresh.ts  # + upsert

import { blendDeRisk, classifyRegime, type MacroIndicators } from "../supabase/functions/_shared/trd-macro.ts";

const IDS = ["T10Y3M", "DBAA", "DAAA", "UNRATE", "CPIAUCSL", "VIXCLS"];
type Obs = { date: string; val: number };

async function fetchFredCsv(url: string, tries = 8): Promise<string> {
  let lastErr = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (aegis-macro)", "Accept": "text/csv,*/*" } });
      if (r.ok) { const csv = await r.text(); if (csv.includes(",") && csv.split("\n").length > 5) return csv; lastErr = "empty"; }
      else lastErr = `HTTP ${r.status}`;
    } catch (e) { lastErr = String(e).slice(0, 100); }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error(`FRED unreachable after ${tries}: ${lastErr}`);
}
function parse(csv: string): Record<string, Obs[]> {
  const lines = csv.trim().split("\n"), cols = lines[0].split(","), out: Record<string, Obs[]> = {};
  for (let c = 1; c < cols.length; c++) out[cols[c].trim()] = [];
  for (let i = 1; i < lines.length; i++) { const f = lines[i].split(","); for (let c = 1; c < cols.length; c++) { const raw = (f[c] ?? "").trim(); if (raw === "" || raw === ".") continue; const v = Number(raw); if (Number.isFinite(v)) out[cols[c].trim()].push({ date: f[0], val: v }); } }
  return out;
}
const last = (a: Obs[]) => a.length ? a[a.length - 1] : null;
const nth = (a: Obs[], k: number) => a.length > k ? a[a.length - 1 - k] : null;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs: number[], v: number) => xs.length ? xs.filter((x) => x <= v).length / xs.length : NaN;

const csv = await fetchFredCsv(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${IDS.join(",")}`);
const s = parse(csv);
const curve = last(s.T10Y3M ?? []);
const aaa = new Map((s.DAAA ?? []).map((o) => [o.date, o.val]));
const spread: Obs[] = [];
for (const o of s.DBAA ?? []) { const a = aaa.get(o.date); if (a !== undefined) spread.push({ date: o.date, val: o.val - a }); }
const spNow = last(spread), un = s.UNRATE ?? [], unNow = last(un), cpi = s.CPIAUCSL ?? [];
const cpiNow = last(cpi), cpi12 = nth(cpi, 12), cpi3 = nth(cpi, 3), cpi15 = nth(cpi, 15);
const vix = s.VIXCLS ?? [], vixNow = last(vix), vixWin = vix.slice(-1260).map((o) => o.val);
const ind: MacroIndicators = {
  economy: "US", asOf: curve?.date ?? unNow?.date ?? new Date().toISOString().slice(0, 10),
  yieldCurve10y3m: curve?.val, creditSpread: spNow?.val,
  creditSpreadMedian12m: spread.length ? median(spread.slice(-252).map((o) => o.val)) : undefined,
  unemploymentRate: unNow?.val, unemploymentMin12m: un.length ? Math.min(...un.slice(-12).map((o) => o.val)) : undefined,
  cpiYoY: cpiNow && cpi12 ? (cpiNow.val / cpi12.val - 1) * 100 : undefined,
  cpiYoYPrior3m: cpi3 && cpi15 ? (cpi3.val / cpi15.val - 1) * 100 : undefined,
  volPercentile: vixNow && vixWin.length ? pct(vixWin, vixNow.val) : undefined,
};
const us = classifyRegime(ind);
const { deRiskFactor, drivers } = blendDeRisk([us]);
const state = { id: "default", economies: [us], blended_de_risk: deRiskFactor, drivers, as_of: us.asOf, updated_at: new Date().toISOString() };
console.log(JSON.stringify({ indicators: ind, state }, null, 2));

const SB = Deno.env.get("SUPABASE_URL"), SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (SB && SRK) {
  const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
  await fetch(`${SB}/rest/v1/trd_macro_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(state) });
  await fetch(`${SB}/rest/v1/trd_macro_history`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({ economy: "US", as_of: us.asOf, phase: us.phase, fragility: us.fragility, de_risk: us.deRiskFactor, regime: us }) });
  console.error("upserted to trd_macro_state");
}
