#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// trd-market-scan-xl — the INEFFICIENT-TAIL scan. Where a retail edge could plausibly still live:
// altcoins (top ~200 by mcap, live from CoinGecko), small-cap/meme/retail equities, EM equity ETFs,
// EM FX. HONEST higher cost (0.10R/side — illiquid = wider spreads) + deflation across all trials +
// survivorship caveat. Tests the operator's hypothesis that more (and less-arbitraged) instruments
// prove an edge. Prediction: higher in-sample positive rate, still ~0 certified (more trials = higher
// bar; illiquid costs + survivorship inflate the rest). Output JSON for cataloging.

import { type Bar, runComponentTrades } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, sampleStd, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";
const OUT = Deno.env.get("OUT_FILE") ?? "/tmp/market-scan-xl.json";
const COST = 0.10; // illiquid-realistic per side

const STABLE = new Set(["USDT","USDC","DAI","USDS","USDE","PYUSD","TUSD","FDUSD","USDD","RLUSD","USD1","USDG","USDF","USD0","GUSD","EURC","EURS","FRAX","GHO","CRVUSD","AUSD","USTB","BUIDL","USYC","JAAA","JTRSY","USX","USDY","USDGO","USDTB","BFUSD","SKY","USDAI","APYUSD","YLDS","STABLE","EUTBL","EURSAFO","JPYSC","THBILL","VBILL","USTBL","AVUSD","REUSD","APXUSD","USAT","EURCV","LEO","WBT","OKB","BGB","GT","KCS","MNT","NEXO","CRO","HTX","DGB"]);
async function cryptoList(): Promise<string[]> {
  try { const r = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1", { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json();
    return (Array.isArray(j) ? j : []).map((c: any) => String(c.symbol).toUpperCase()).filter((s: string) => /^[A-Z0-9]{2,6}$/.test(s) && !STABLE.has(s)).map((s: string) => s + "-USD");
  } catch { return []; }
}
const SMALLCAP_EQ = ["GME","AMC","BB","PLTR","SOFI","LCID","RIVN","NIO","RIOT","MARA","COIN","HOOD","DKNG","RBLX","U","AFRM","UPST","FUBO","CLOV","SPCE","DNA","OPEN","CVNA","CHPT","PLUG","FCEL","BLNK","QS","NKLA","WKHS","GOEV","LAZR","SKLZ","WISH","ROOT","BYND","PTON","W","CHWY","ETSY","ROKU","SNAP","PINS","LYFT","DASH","ABNB","PATH","GTLB","BILL","DOCN","FSLY","NET","DDOG","CRWD","ZS","OKTA","TWLO","PLTR","SMCI","IONQ","RGTI","QBTS","SOUN","BBAI","LUNR","RKLB","ASTS","ACHR","JOBY","ENVX","AMSC","VRT","POWL"];
const EM_ETF = ["EWZ","EWW","EZA","INDA","FXI","EWY","EWT","EWJ","TUR","EPOL","EIDO","THD","EWM","VNM","ARGT","ILF","GXG","EPU","ECH","KSA","UAE","QAT","EGPT","NGE","FM","EEM","VWO","IEMG","MCHI","KWEB","EWH","EWS","EWA","EWC","EWG","EWU","EWQ","EWI","EWP","EWL","EWD","EWN"];
const LEV_THEMATIC = ["SOXL","SOXS","TQQQ","SQQQ","TNA","TZA","SPXL","SPXS","LABU","LABD","TECL","FNGU","BOIL","KOLD","UNG","UVXY","VXX","UVIX","YINN","YANG","BITX","ETHU","MSTR","GBTC","SMH","XBI","JETS","TAN","LIT","URA","XOP","GDX","GDXJ","SIL","COPX","WEAT","CORN","DBA","UUP","FXE"];
const EM_FX = ["USDTRY=X","USDBRL=X","USDINR=X","USDIDR=X","USDPHP=X","USDTHB=X","USDPLN=X","USDHUF=X","USDCLP=X","USDCOP=X","USDSGD=X","USDHKD=X","USDCNH=X","USDKRW=X","USDTWD=X","USDNOK=X","USDSEK=X","EURTRY=X","GBPZAR=X","EURPLN=X"];

async function daily(sym: string): Promise<Bar[]> {
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return []; const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
    const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: Bar[] = [];
    for (let i = 0; i < t.length; i++) { const a = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([a, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ ts: new Date(t[i] * 1000).toISOString(), open: a, high: h, low: l, close: c }); }
    return o;
  } catch { return []; }
}
function squeeze(b: Bar[]): number[] {
  const W = 20; const ret = b.slice(1).map((x, i) => x.close / b[i].close - 1); const vol: number[] = [];
  for (let i = W; i < b.length; i++) vol.push(sampleStd(ret.slice(i - W, i)));
  const sorted = [...vol].sort((a, z) => a - z); const loT = sorted[Math.floor(vol.length / 3)] ?? 0; const rs: number[] = [];
  for (let i = W; i + 1 < b.length; i++) { const vi = vol[i - W]; if (vi === undefined || vi > loT) continue; const win = b.slice(i - W, i); const hh = Math.max(...win.map((x) => x.high)), ll = Math.min(...win.map((x) => x.low)); const rng = hh - ll; if (!(rng > 0)) continue; const nx = b[i]; let side = 0; if (nx.close > hh) side = 1; else if (nx.close < ll) side = -1; if (!side) continue; const entry = nx.close, target = entry + side * 0.45 * rng, stop = entry - side * 0.225 * rng, risk = Math.abs(entry - stop); let r: number | null = null; for (let m = i + 1; m < Math.min(i + 15, b.length); m++) { if (side === 1) { if (b[m].low <= stop) { r = -1; break; } if (b[m].high >= target) { r = (target - entry) / risk; break; } } else { if (b[m].high >= stop) { r = -1; break; } if (b[m].low <= target) { r = (entry - target) / risk; break; } } } if (r === null) { const last = b[Math.min(i + 14, b.length - 1)].close; r = (side === 1 ? last - entry : entry - last) / risk; } rs.push(r - 2 * COST); }
  return rs;
}

const crypto = await cryptoList();
const UNIVERSE: Record<string, string[]> = { "altcoin": crypto, "small/meme eq": SMALLCAP_EQ, "EM ETF": EM_ETF, "lev/thematic": LEV_THEMATIC, "EM FX": EM_FX };
interface Row { market: string; cls: string; strat: string; n: number; exp: number; sh: number; rs: number[]; }
const rows: Row[] = []; const allSh: number[] = []; let scanned = 0, totalBars = 0;
for (const [cls, syms] of Object.entries(UNIVERSE)) {
  let ok = 0;
  for (const sym of syms) {
    const b = await daily(sym); if (b.length < 250) continue; scanned++; ok++; totalBars += b.length;
    const sweep = runComponentTrades(b, { trigger: "sweep", emaPeriod: 20, trendMode: "with", stopLookback: 5, rr: 3, session: "all" }, { costRPerSide: COST }).map((t) => t.r);
    const sq = squeeze(b);
    for (const [strat, rs] of [["sweep-rr3", sweep], ["squeeze", sq]] as [string, number[]][]) { if (rs.length < 25) continue; const sh = sharpe(rs); allSh.push(sh); rows.push({ market: sym, cls, strat, n: rs.length, exp: mean(rs), sh, rs }); }
  }
  console.log(`  ${cls}: ${ok}/${syms.length} had data (total scanned ${scanned})`);
}
const nTrials = Math.max(1, allSh.length); const vm = mean(allSh); const varT = allSh.length > 1 ? mean(allSh.map((x) => (x - vm) ** 2)) : 0;
for (const r of rows) (r as any).dsr = deflatedSharpe(r.sh, r.n, skewness(r.rs), kurtosis(r.rs), nTrials, varT);
const posIS = rows.filter((r) => r.exp > 0).length; const cleared = rows.filter((r) => (r as any).dsr > 0.95);
rows.sort((a, b) => (b as any).dsr - (a as any).dsr);
const byClass: Record<string, { n: number; pos: number }> = {};
for (const r of rows) { (byClass[r.cls] ??= { n: 0, pos: 0 }); byClass[r.cls].n++; if (r.exp > 0) byClass[r.cls].pos++; }
console.log(`\n═══ INEFFICIENT-TAIL SCAN (cost ${COST}R/side) ═══`);
console.log(`instruments: ${scanned} | ${totalBars.toLocaleString()} bars | ${rows.length} trials | positive IS ${posIS}/${rows.length} (${(posIS / rows.length * 100).toFixed(0)}%) | cleared DSR ${cleared.length}`);
for (const [c, v] of Object.entries(byClass)) console.log(`  ${c.padEnd(15)} positive ${v.pos}/${v.n} (${(v.pos / v.n * 100).toFixed(0)}%)`);
console.log(`top 15 by deflated Sharpe:`);
for (const r of rows.slice(0, 15)) console.log(`  ${r.market.padEnd(12)} ${r.cls.padEnd(14)} ${r.strat.padEnd(10)} n=${String(r.n).padStart(4)} exp=${r.exp >= 0 ? "+" : ""}${r.exp.toFixed(3)}R dsr=${((r as any).dsr * 100).toFixed(1)}% ${(r as any).dsr > 0.95 ? "*** CLEARS" : ""}`);
await Deno.writeTextFile(OUT, JSON.stringify({ scanned, totalBars, trials: rows.length, positiveInSample: posIS, clearedDSR: cleared.length, byClass, top: rows.slice(0, 40).map((r) => ({ market: r.market, cls: r.cls, strat: r.strat, n: r.n, exp: +r.exp.toFixed(3), dsr: +(r as any).dsr.toFixed(4) })) }, null, 2));
console.log(`\nVERDICT: ${cleared.length === 0 ? "even the inefficient tail confirms the law — 0 clear deflation at honest cost. More instruments raised the bar, did not create edge." : cleared.length + " clear — investigate (watch for survivorship/illiquidity)"}. -> ${OUT}`);
