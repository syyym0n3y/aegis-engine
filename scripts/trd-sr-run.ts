#!/usr/bin/env -S deno run --allow-net --allow-env
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const SB="https://glzzoomuhnugsiichnub.supabase.co";const KEY=Deno.env.get("SB_ANON")??"";
const SYMS=(Deno.args[0]??"GLD,SLV,USO,SPY,QQQ").split(",");const tf=Deno.args[1]??"240";
console.log(`tradesbysci S/R PRICE-ACTION (demand-zone bounce long + resistance-breakout long) vs RANDOM — ${tf}m bars\n`);
console.log(`${"sym".padEnd(6)} ${"variant".padEnd(9)} ${"n".padStart(5)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
for(const sym of SYMS){const r=await fetch(`${SB}/functions/v1/trd-alpaca-sr?symbol=${sym}&years=2&tf=${tf}`,{headers:{Authorization:`Bearer ${KEY}`}});const j=await r.json().catch(()=>null);
 if(!j||j.err||!j.bounce){console.log(`${sym.padEnd(6)} ERR ${JSON.stringify(j).slice(0,80)}`);continue;}
 for(const[tag,s]of[["bounce",j.bounce],["breakout",j.brk]] as const){
   if(!s.length){console.log(`${sym.padEnd(6)} ${tag.padEnd(9)} (0)`);continue;}
   const g=edgeVsRandom(s,j.ctrl);const ok=g.passes&&g.setupMean>0;
   console.log(`${sym.padEnd(6)} ${tag.padEnd(9)} ${String(s.length).padStart(5)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(7)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${ok?"✓ beats random":g.setupMean>0?"pos, not sig":"✗ REJECT"}`);
 }}
