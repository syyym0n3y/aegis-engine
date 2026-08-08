#!/usr/bin/env -S deno run --allow-net
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const FN="https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-alpaca-vwap";
const BASKET=["GLD","SLV","USO","SPY","QQQ","IWM","AAPL","NVDA","TSLA","AMD"]; // gold-led (creators trade gold) + liquids
const agg:Record<string,number[]>={short_sig:[],short_ctrl:[],long_sig:[],long_ctrl:[]};let ok=0,bars=0;
for(const s of BASKET){try{const d=await(await fetch(`${FN}?symbol=${s}&years=2`)).json();if(d.err&&!d.short_sig){console.log(`${s}: ${d.err}`);continue;}ok++;bars+=d.nbars??0;for(const k of Object.keys(agg))if(Array.isArray(d[k]))agg[k].push(...d[k]);console.log(`${s.padEnd(5)} bars=${String(d.nbars).padStart(7)} shortFades=${d.short_sig?.length??0} longFades=${d.long_sig?.length??0}`);}catch(e){console.log(`${s}: ${String(e).slice(0,60)}`);}}
console.log(`\nSTRATEGY 2 — Anchored-VWAP 2SD MEAN-REVERSION (fade to VWAP), Alpaca free IEX 1-min, ${ok}/${BASKET.length} names, ${(bars/1e6).toFixed(1)}M bars, 2y, vs random (Bonferroni t>=2.24 for 2 sides):`);
for(const [nm,sig,ctrl] of [["short-fade (@+2SD)",agg.short_sig,agg.short_ctrl],["long-fade  (@-2SD)",agg.long_sig,agg.long_ctrl]] as const){const g=edgeVsRandom(sig,ctrl,2.24);const okk=g.passes&&g.setupMean>0;console.log(`  ${nm}  n=${String(sig.length).padStart(5)}  setupR ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(4)}  vs random ${(g.controlMean>=0?"+":"")+g.controlMean.toFixed(4)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(4)}  t=${g.tStat.toFixed(2)}  ${okk?"<<< SURVIVES":"reject"}`);}
