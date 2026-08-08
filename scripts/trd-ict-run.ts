#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-ict-run — runs the mechanized 7-step ICT composition (trd-alpaca-ict) and gates each symbol vs random.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const SB = Deno.env.get("SB_URL") ?? "https://glzzoomuhnugsiichnub.supabase.co";
const KEY = Deno.env.get("SB_ANON") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SYMS = (Deno.args[0] ?? "GLD,SLV,SPY,QQQ").split(",");
console.log(`PRECISE 7-STEP ICT (sweep→FVG→inverse→BOS→enter) vs RANDOM — 5m, ${SYMS.join("/")}\n`);
console.log(`${"sym".padEnd(6)} ${"setups".padStart(6)} ${"tgt".padStart(4)} ${"setupR".padStart(8)} ${"randR".padStart(8)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
for (const sym of SYMS) {
  const r = await fetch(`${SB}/functions/v1/trd-alpaca-ict?symbol=${sym}&years=2`, { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await r.json().catch(() => null);
  if (!j || j.err || !j.sig2) { console.log(`${sym.padEnd(6)} ERR ${JSON.stringify(j).slice(0,80)}`); continue; }
  for (const [tag, s, c] of [["2R", j.sig2, j.ctrl2], ["3R", j.sig3, j.ctrl3]] as const) {
    if (!s.length) { console.log(`${sym.padEnd(6)} ${String(j.setups).padStart(6)} ${tag.padStart(4)}  (no trades)`); continue; }
    const g = edgeVsRandom(s, c); const ok = g.passes && g.setupMean > 0;
    console.log(`${sym.padEnd(6)} ${String(s.length).padStart(6)} ${tag.padStart(4)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(8)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${ok?"✓ beats random":g.setupMean>0?"pos, not sig":"✗ REJECT"}`);
  }
}
