#!/usr/bin/env -S deno run --allow-net
// trd-alpaca-minsweep-run — drive the free Alpaca minute-universe sweep across a basket and gate the aggregate.
// Closes D-181's minute ceiling for US stocks, $0, via Alpaca free IEX minute bars (edge fn does the pull+setup).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const FN = "https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-alpaca-minsweep";
const BASKET = ["SPY","QQQ","IWM","XLE","XLF","SMH","AAPL","NVDA","TSLA","AMD"];
const agg: Record<string, number[]> = { ripshort_sig: [], ripshort_ctrl: [], dipbuy_sig: [], dipbuy_ctrl: [] };
let totBars = 0, ok = 0;
for (const sym of BASKET) {
  try {
    const r = await fetch(`${FN}?symbol=${sym}&years=2`); const d = await r.json();
    if (d.err && !d.ripshort_sig) { console.log(`${sym}: ${d.err} (http ${d.http ?? "?"})`); continue; }
    totBars += d.nbars ?? 0; ok++;
    for (const k of Object.keys(agg)) if (Array.isArray(d[k])) agg[k].push(...d[k]);
    console.log(`${sym.padEnd(5)} bars=${String(d.nbars).padStart(7)}  ripS=${(d.ripshort_sig?.length ?? 0)}  dipB=${(d.dipbuy_sig?.length ?? 0)}`);
  } catch (e) { console.log(`${sym}: ${String(e).slice(0, 80)}`); }
}
console.log(`\nMINUTE-UNIVERSE VERDICT (Alpaca free IEX, ${ok}/${BASKET.length} names, ${(totBars/1e6).toFixed(1)}M bars, 2y, real cost + borrow):`);
const DEFL_T = 2.24; // Bonferroni 2 setups
for (const [name, sig, ctrl] of [["rip-short", agg.ripshort_sig, agg.ripshort_ctrl], ["dip-buy ", agg.dipbuy_sig, agg.dipbuy_ctrl]] as const) {
  const g = edgeVsRandom(sig, ctrl, DEFL_T);
  const ok2 = g.passes && g.setupMean > 0;
  console.log(`  ${name}  n=${String(sig.length).padStart(5)}  setupR=${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(4)}  vs random ${(g.controlMean>=0?"+":"")+g.controlMean.toFixed(4)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(4)}  t=${g.tStat.toFixed(2)}  ${ok2?"<<< SURVIVES (deflated)":"reject"}`);
}
console.log(`\nThis is the MINUTE timeframe for US equities — the one QC free could not finish (D-181) — now run FREE via Alpaca.`);
