#!/usr/bin/env -S deno run --allow-net --allow-write --allow-read
// fetch-edgar-backlog — build the OrderBacklogChg panel from SEC EDGAR XBRL (FREE).
// Baik & Ahn (2007): normalized order backlog = ob / average total assets (t-1, t); signal = year-over-year
// CHANGE in that ratio; sign +1; EW decile long-short. It was the ONLY one of the 7 OSAP survivors with a
// long-only edge (long-only t=2.44 vs LS t=3.01, D-163).
// HONEST SUBSTITUTION (stated up front): Compustat's legacy `ob` item is not in XBRL, but ASC 606 (effective
// 2018) requires RevenueRemainingPerformanceObligation (RPO) — contractually committed revenue not yet
// recognised — which is the modern analogue of order backlog. It is NOT the identical variable, and only
// firms with contract-based revenue report it. Everything downstream inherits that caveat.
const UA = { "User-Agent": "Aegis Research ona@revitalise.io" };
await Deno.mkdir("data/edgar", { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function frame(tag: string, period: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  try {
    const r = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`, { headers: UA });
    if (!r.ok) return m;
    const j = await r.json();
    for (const d of j.data ?? []) if (Number.isFinite(d.val)) m.set(d.cik, d.val);
  } catch { /* */ }
  await sleep(140); // SEC fair-access: stay well under 10 req/s
  return m;
}
// CIK → ticker
const tickJson = await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA })).json();
const cik2tic = new Map<number, string>();
for (const k of Object.keys(tickJson)) { const e = tickJson[k]; if (e?.cik_str && e?.ticker) cik2tic.set(e.cik_str, e.ticker); }
console.log(`CIK→ticker map: ${cik2tic.size} companies\n`);
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const rpo = new Map<number, Map<number, number>>(); // year -> cik -> value
const ast = new Map<number, Map<number, number>>();
for (const y of YEARS) {
  const a = await frame("RevenueRemainingPerformanceObligation", `CY${y}Q4I`);
  const b = await frame("Assets", `CY${y}Q4I`);
  rpo.set(y, a); ast.set(y, b);
  console.log(`  CY${y}Q4I: RPO ${String(a.size).padStart(4)} companies | Assets ${String(b.size).padStart(5)}`);
}
// build panel: for each cik-year with RPO(t), RPO(t-1), Assets(t), Assets(t-1)
type Row = { cik: number; ticker: string; year: number; norm: number; normPrev: number; signal: number };
const rows: Row[] = [];
for (const y of YEARS.slice(1)) {
  const r1 = rpo.get(y)!, r0 = rpo.get(y - 1)!, a1 = ast.get(y)!, a0 = ast.get(y - 1)!;
  for (const [cik, v1] of r1) {
    const v0 = r0.get(cik), A1 = a1.get(cik), A0 = a0.get(cik);
    const tic = cik2tic.get(cik);
    if (v0 == null || A1 == null || A0 == null || !tic) continue;
    if (!(v1 > 0) || !(v0 > 0) || !(A1 > 0) || !(A0 > 0)) continue;
    const avgA = (A1 + A0) / 2;
    const norm = v1 / avgA, normPrev = v0 / avgA;   // both scaled by the same avg assets (Baik-Ahn style)
    rows.push({ cik, ticker: tic, year: y, norm, normPrev, signal: norm - normPrev });
  }
}
console.log(`\nPANEL: ${rows.length} company-years with a computable OrderBacklogChg signal`);
const byYear = new Map<number, number>(); for (const r of rows) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
for (const [y, n] of [...byYear].sort()) console.log(`   ${y}: ${n} companies`);
const tickers = [...new Set(rows.map((r) => r.ticker))];
console.log(`   distinct tickers: ${tickers.length}`);
await Deno.writeTextFile("data/edgar/backlog-panel.json", JSON.stringify(rows));
await Deno.writeTextFile("data/edgar/backlog-tickers.json", JSON.stringify(tickers));
console.log(`\nWritten → data/edgar/backlog-panel.json`);
