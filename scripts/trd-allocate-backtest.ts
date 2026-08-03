#!/usr/bin/env -S deno run --allow-read
// trd-allocate-backtest — the LIVE ALLOCATE book on real Fama-French factor data.
// Combines documented risk premia (global value + quality + momentum) via the shipped
// buildFactorBook() engine (inverse-vol, vol-targeted) and shows the diversification
// payoff: the blended multi-factor Sharpe vs the best single factor. This is the
// deployable "harvest" layer, validated on the free global data (D-077).
// Input: /tmp/ff.json = { "file|factor": [[ym, monthly_pct], ...] }

import { buildFactorBook } from "../supabase/functions/_shared/trd-allocate.ts";
import { annualizedSharpe, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile("/tmp/ff.json")) as Record<string, [string, number][]>;
const get = (file: string, factor: string): [string, number][] | null => raw[`${file}|${factor}`] ?? null;

// the premia we validated as real + robust, chosen to be low-correlation:
const picks: Record<string, [string, string]> = {
  "value-US": ["us5", "HML"], "value-Dev": ["dev5", "HML"], "value-EM": ["em5", "HML"],
  "quality-US": ["us5", "RMW"], "quality-Dev": ["dev5", "RMW"], "momentum-Dev": ["devmom", "WML"],
};
// align all streams to a common month set (intersection), returns as decimals
const seriesByName: Record<string, Map<string, number>> = {};
for (const [name, [f, fac]] of Object.entries(picks)) { const s = get(f, fac); if (s) seriesByName[name] = new Map(s.map(([ym, v]) => [ym, v / 100])); }
const names = Object.keys(seriesByName);
let common: string[] | null = null;
for (const n of names) { const ks = new Set(seriesByName[n].keys()); common = common ? common.filter((m) => ks.has(m)) : [...ks]; }
common = (common ?? []).sort();
const streams: Record<string, number[]> = {};
for (const n of names) streams[n] = common.map((m) => seriesByName[n].get(m)!);

const single = (n: string) => { const r = streams[n]; return { sh: annualizedSharpe(r, 12), ret: mean(r) * 1200, dd: 0 }; };
console.log(`\n[ALLOCATE live] ${names.length} global risk-premia streams, ${common[0]}..${common.at(-1)} (${common.length} months).`);
console.log(`  single-factor annualized Sharpe (each on its own):`);
for (const n of names) { const s = single(n); console.log(`    ${n.padEnd(13)} Sharpe=${s.sh.toFixed(2)}  ${s.ret.toFixed(1)}%/yr`); }

const rep = buildFactorBook({ streams, periodsPerYear: 12, targetAnnualVol: 0.10, volLookback: 24 });
console.log(`\n  COMBINED multi-factor book (inverse-vol, 10% vol target):`);
console.log(`    Sharpe=${rep.annualSharpe.toFixed(2)}  ${rep.annualReturnPct.toFixed(1)}%/yr  maxDD=${rep.maxDrawdownPct.toFixed(0)}%`);
console.log(`    weights: ${Object.entries(rep.weights).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join("  ")}`);
const bestSingle = Math.max(...names.map((n) => single(n).sh));
console.log(`\n  DIVERSIFICATION PAYOFF: combined Sharpe ${rep.annualSharpe.toFixed(2)} vs best single ${bestSingle.toFixed(2)}  => ${(rep.annualSharpe > bestSingle ? "+" : "")}${(rep.annualSharpe - bestSingle).toFixed(2)} from blending uncorrelated premia.`);

// regime breakdown of the combined book
const port = rep.portfolio; const pm = common.slice(-port.length);
const regimes: [string, string, string][] = [["1990s", "1990-01", "1999-12"], ["dot-com+GFC 2000-09", "2000-01", "2009-12"], ["QE 2010-19", "2010-01", "2019-12"], ["2020-26", "2020-01", "2026-12"]];
console.log(`\n  combined book by regime:`);
for (const [nm, lo, hi] of regimes) { const xs = port.filter((_, i) => pm[i] >= lo && pm[i] <= hi); if (xs.length < 6) continue; console.log(`    ${nm.padEnd(20)} Sharpe=${annualizedSharpe(xs, 12).toFixed(2)}  ${(mean(xs) * 1200).toFixed(1)}%/yr`); }
console.log(`\n  ${rep.plainEnglish}`);
