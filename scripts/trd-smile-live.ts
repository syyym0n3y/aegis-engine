#!/usr/bin/env -S deno run --allow-net
// trd-smile-live — compute Yan (2011) SmileSlope + Bali-Hovakimian CPVolSpread for a real universe from FREE
// CBOE delayed chains, and sanity-check the cross-section against what theory says it should look like:
//   • slope should be POSITIVE for most equities (puts richer than calls — the crash-insurance premium)
//   • slope should be WIDER for high-beta / crash-prone names than for defensives
//   • index products (SPY/QQQ) should show the widest skew of all (index put demand)
// This is a MEASUREMENT check, not a backtest — no free historical chain exists, so the predictive test
// requires accumulating the series forward (or buying history). Stated plainly, not buried.
import { smileSlope, type OptQuote } from "../supabase/functions/_shared/trd-smile.ts";
const UNIVERSE = ["SPY","QQQ","IWM","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F","GLD","TLT","XLK","XLF","XLE","XLU","XLP","SMH","XBI","KRE"];
console.log(`SMILE SLOPE (Yan 2011) + CP VOL SPREAD (Bali-Hovakimian 2009) — live from free CBOE chains\n`);
console.log(`${"symbol".padEnd(8)} ${"spot".padStart(9)} ${"DTE".padStart(4)} ${"callIV".padStart(8)} ${"putIV".padStart(8)} ${"SmileSlope".padStart(11)} ${"CPVolSpread".padStart(12)} ${"contracts".padStart(9)}`);
const rows: { s: string; slope: number; call: number; put: number }[] = [];
for (const sym of UNIVERSE) {
  try {
    const r = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) { console.log(`${sym.padEnd(8)} HTTP ${r.status}`); continue; }
    const j = await r.json(); const d = j.data;
    const quotes: OptQuote[] = (d?.options ?? []).map((o: any) => ({ option: o.option, iv: o.iv, delta: o.delta }));
    const res = smileSlope(quotes);
    if (res.smileSlope == null) { console.log(`${sym.padEnd(8)} insufficient chain`); continue; }
    rows.push({ s: sym, slope: res.smileSlope, call: res.callIv!, put: res.putIv! });
    console.log(`${sym.padEnd(8)} ${String(d?.current_price ?? "").padStart(9)} ${String(res.dteUsed).padStart(4)} ${res.callIv!.toFixed(4).padStart(8)} ${res.putIv!.toFixed(4).padStart(8)} ${(res.smileSlope >= 0 ? "+" : "") + res.smileSlope.toFixed(4).padStart(10)} ${(res.cpVolSpread! >= 0 ? "+" : "") + res.cpVolSpread!.toFixed(4).padStart(11)} ${String(res.contracts).padStart(9)}`);
  } catch (e) { console.log(`${sym.padEnd(8)} ERR ${String(e).slice(0, 40)}`); }
}
if (rows.length) {
  const pos = rows.filter((r) => r.slope > 0).length;
  const mean = rows.reduce((s, r) => s + r.slope, 0) / rows.length;
  const sorted = [...rows].sort((a, b) => b.slope - a.slope);
  console.log(`\n══ CROSS-SECTION SANITY CHECK (${rows.length} instruments) ══`);
  console.log(`   positive slope (puts richer than calls): ${pos}/${rows.length} (${(pos / rows.length * 100).toFixed(0)}%)  ${pos / rows.length > 0.7 ? "✓ matches the crash-insurance premium" : "✗ unexpected"}`);
  console.log(`   mean slope: ${(mean >= 0 ? "+" : "") + mean.toFixed(4)}`);
  console.log(`   WIDEST skew (Yan: predicts LOWER forward returns): ${sorted.slice(0, 6).map((r) => `${r.s} ${r.slope >= 0 ? "+" : ""}${r.slope.toFixed(3)}`).join(", ")}`);
  console.log(`   NARROWEST/inverted (predicts HIGHER):              ${sorted.slice(-6).reverse().map((r) => `${r.s} ${r.slope >= 0 ? "+" : ""}${r.slope.toFixed(3)}`).join(", ")}`);
  console.log(`\n   HONEST STATUS: this is a live MEASUREMENT, not a verified edge. Yan's original t=8.168 (1996-2005)`);
  console.log(`   and it still cleared t>3 since 2015 in the OSAP data (D-159) — but WE have not tested it, because`);
  console.log(`   no free historical option-chain archive exists. Accumulate daily → test when N is sufficient.`);
}
