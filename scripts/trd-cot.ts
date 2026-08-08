#!/usr/bin/env -S deno run --allow-net
// trd-cot — the FLOW/POSITIONING lens (R-003 #10) via free CFTC Commitment of Traders. Classic
// hypothesis: commercials (hedgers) are "smart money", large speculators are trend-following "dumb
// money" — so extreme positioning predicts reversals. Tests whether commercial net positioning (and
// its 3y percentile "COT index") predicts forward returns, with a RELEASE LAG (COT surveyed Tue,
// released Fri → act the following week; no look-ahead) + shuffle null + OOS. Honest on n.

const MKTS: [string, string, string][] = [
  ["Gold", "GC=F", "GOLD - COMMODITY EXCHANGE INC."],
  ["S&P500", "^GSPC", "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"],
  ["Crude", "CL=F", "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE"],
  ["10Y-Note", "^TNX", "10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE"],
];
async function cot(name: string) {
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=market_and_exchange_names='${encodeURIComponent(name).replace(/'/g, "''")}'&$order=report_date_as_yyyy_mm_dd ASC&$limit=800`;
  const r = await fetch(url.replace(/ /g, "%20"), { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json() as any[]; if (!Array.isArray(j)) return [];
  return j.map((x) => { const oi = +x.open_interest_all || 1; const commNet = (+x.comm_positions_long_all - +x.comm_positions_short_all) / oi; const specNet = (+x.noncomm_positions_long_all - +x.noncomm_positions_short_all) / oi; return { d: (x.report_date_as_yyyy_mm_dd as string).slice(0, 10), commNet, specNet }; }).filter((x) => Number.isFinite(x.commNet));
}
async function weekly(sym: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [] as { t: number; px: number }[];
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as (number | null)[]; const out: { t: number; px: number }[] = [];
  for (let i = 0; i < t.length; i++) if (c[i] != null && Number.isFinite(c[i])) out.push({ t: t[i] * 1000, px: c[i]! });
  return out; // sorted ascending
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) { const n = Math.min(x.length, y.length); if (n < 5) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; }
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function priceAt(arr: { t: number; px: number }[], dateISO: string): number | null { const target = Date.parse(dateISO); const win = 8 * 86400000; for (const b of arr) if (b.t >= target && b.t <= target + win) return b.px; return null; }

for (const [name, sym, cotName] of MKTS) {
  const c = await cot(cotName); const px = await weekly(sym);
  if (c.length < 100 || px.length < 100) { console.log(`\n${name}: COT ${c.length} / px ${px.length} — thin/unmatched`); continue; }
  // COT index = 3y percentile of commNet
  const rows: { commNet: number; specNet: number; cotIdx: number; fwd: number }[] = [];
  for (let i = 156; i < c.length - 2; i++) {
    const hist = c.slice(i - 156, i + 1).map((x) => x.commNet).sort((a, b) => a - b);
    const cotIdx = hist.filter((v) => v <= c[i].commNet).length / hist.length;
    // release lag: act ~1.5 weeks after survey date; forward 2-week return
    const lagDate = new Date(Date.parse(c[i].d) + 10 * 86400000).toISOString().slice(0, 10);
    const futDate = new Date(Date.parse(c[i].d) + 24 * 86400000).toISOString().slice(0, 10);
    const p0 = priceAt(px, lagDate), p1 = priceAt(px, futDate);
    if (p0 && p1 && p0 > 0) rows.push({ commNet: c[i].commNet, specNet: c[i].specNet, cotIdx, fwd: p1 / p0 - 1 });
  }
  if (rows.length < 60) { console.log(`\n${name}: only ${rows.length} aligned COT weeks`); continue; }
  const commArr = rows.map((r) => r.commNet), idxArr = rows.map((r) => r.cotIdx), fwd = rows.map((r) => r.fwd);
  const cComm = corr(commArr, fwd), cIdx = corr(idxArr, fwd);
  // tradeable: long when commercials above-median long (smart-money follow), forward 2wk return
  const trade = rows.map((r) => (Math.sign(r.cotIdx - 0.5)) * r.fwd);
  const mu = mean(trade), sd = std(trade) || 1, t = mu / (sd / Math.sqrt(trade.length)), sh = (mu / sd) * Math.sqrt(26);
  const mid = Math.floor(trade.length * 0.6); const sh2 = (a: number[]) => (mean(a) / (std(a) || 1)) * Math.sqrt(26);
  const rnd = mulberry32(3); let beat = 0; const N = 1000; for (let k = 0; k < N; k++) { const rr = trade.map((x) => (rnd() < 0.5 ? x : -x)); if (sh2(rr) >= sh) beat++; }
  console.log(`\n══ ${name} — ${rows.length} COT weeks ══`);
  console.log(`  corr(commercialNet, fwd2w)=${cComm.toFixed(3)} | corr(COT-index, fwd2w)=${cIdx.toFixed(3)}`);
  console.log(`  TRADE (follow commercial extreme): annSharpe ${sh.toFixed(2)} t=${t.toFixed(2)} | OOS ${sh2(trade.slice(0, mid)).toFixed(2)}/${sh2(trade.slice(mid)).toFixed(2)} | shuffleP ${(beat / N).toFixed(3)} ${mu > 0 && t > 2 && sh2(trade.slice(0, mid)) > 0 && sh2(trade.slice(mid)) > 0 ? "*** REAL" : ""}`);
}
console.log(`\nRead: COT is weekly + heavily lagged, so any edge is slow. Commercials-as-smart-money is folklore unless`);
console.log(`the predictive corr beats the shuffle null AND holds out-of-sample after the release lag.`);
