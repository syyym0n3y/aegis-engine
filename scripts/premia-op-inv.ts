#!/usr/bin/env -S deno run --allow-net --allow-env
// premia-op-inv.ts (D-805) — the two classic premia D-477 left UNTESTED: operating PROFITABILITY and INVESTMENT.
//
// D-477 ran French's pre-sorted extreme-decile long-shorts at maximum honest power (momentum t 4.84 over 1,192 months,
// still under the 5.34 ceiling) and left OP/INV UNTESTED because `pick()` could not resolve the multiple Lo_*/Hi_*
// column sets those files carry (Lo_10/Lo_20/Lo_30). That ambiguity is resolved here by NAMING the decile columns
// (`Hi_10`, `Lo_10`) instead of pattern-matching them. Literature sides, stated before the data: HIGH profitability
// outperforms (Novy-Marx 2013) and LOW investment outperforms (Fama-French 2015). 5bp/month implementation drag as in
// D-477. Momentum is recomputed as the REPRODUCTION control — it must land near D-477's t 4.84 or the loader is wrong.
//
// Laws: BENCHMARK — the long leg's excess over the MARKET is reported beside the spread (a spread says nothing about
// whether either leg earns anything). INSTRUMENT — French deciles are a RESEARCH PROXY; no placeable conversion is
// claimed, exactly as D-477. TURNOVER — OP/INV deciles are re-formed annually (June), momentum monthly; stated.
// SIGN — MATCHED/MISSED against the literature side is printed, never assumed. Trials: 2 (op, inv); momentum is a
// control of a number already on the ledger and is not re-spent.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("premia-op-inv", [
  { name: "DRAG_BP", def: "5", note: "implementation drag per month, bp (D-477 convention)" },
  { name: "RUN_ID", def: "D-805-op-inv", note: "trial ledger run key" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "opinv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const NAMES = ["op10:Hi_10", "op10:Lo_10", "inv10:Hi_10", "inv10:Lo_10", "mom10:Hi_PRIOR", "mom10:Lo_PRIOR", "Mkt-RF", "RF"];
const byF = new Map<string, Map<string, number>>();
for (let off = 0; ; off += 10000) {
  const url = `${OWNED}/trd_ff_factors?factor=in.(${NAMES.map((n) => `"${n}"`).join(",")})&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`;
  const r = await fetch(url, { headers: hdr }); if (!r.ok) throw new Error(`ff load ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const p = await r.json() as { month: string; factor: string; ret: number }[];
  for (const x of p) (byF.get(x.factor) ?? byF.set(x.factor, new Map()).get(x.factor)!).set(String(x.month).slice(0, 7), +x.ret);
  if (p.length < 10000) break;
}
for (const n of NAMES) if (!byF.get(n)?.size) { console.error(`  RED — factor ${n} loaded 0 months (positive control failed)`); Deno.exit(1); }
console.log(`  loaded: ${NAMES.map((n) => `${n} ${byF.get(n)!.size}mo`).join(" | ")}`);

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12);
const drag = Number(K.DRAG_BP) / 1e4;
const mkt = (m: string) => (byF.get("Mkt-RF")!.get(m) ?? NaN) + (byF.get("RF")!.get(m) ?? NaN);

function series(L: string, S: string) {
  const a = byF.get(L)!, b = byF.get(S)!;
  const mos = [...a.keys()].filter((m) => b.has(m)).sort();                         // full common span (D-477 used all 1,192)
  const mm = mos.filter((m) => Number.isFinite(mkt(m)));                            // market factor held from 1963-07 only
  return { mos, spread: mos.map((m) => a.get(m)! - b.get(m)! - drag), longEx: mm.map((m) => a.get(m)! - mkt(m)), shortEx: mm.map((m) => b.get(m)! - mkt(m)) };
}
function eras(mos: string[], v: number[], cuts: string[]) {
  const out: string[] = []; let lo = "0000";
  for (const c of [...cuts, "9999"]) { const idx = mos.map((m, i) => (m >= lo && m < c ? i : -1)).filter((i) => i >= 0); if (idx.length > 24) { const e = idx.map((i) => v[i]); out.push(`${lo.slice(0,4)}-${c === "9999" ? "now" : c.slice(0,4)}: ${(mean(e) * 12 * 100).toFixed(1)}%/yr t ${tstat(e).toFixed(2)}`); } lo = c; }
  return out.join(" | ");
}
const fmt = (v: number[]) => `${(mean(v) * 12 * 100).toFixed(2).padStart(7)}%/yr  t ${tstat(v).toFixed(2).padStart(6)}  n ${v.length}`;

const T = await spendTrials({ rest: OWNED, headers: hdr, family: "premia-classic-opinv", runId: K.RUN_ID, spent: 2 });
console.log(`\n==> CLASSIC PREMIA — OP and INV at maximum honest power (French extreme deciles, ${K.DRAG_BP}bp/mo drag). Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    INSTRUMENT: research proxy (French VW deciles), NO placeable conversion claimed. TURNOVER: OP/INV re-formed annually; momentum monthly.`);
const rows: { name: string; L: string; S: string; litSign: string; cuts: string[] }[] = [
  { name: "profitability (Hi OP − Lo OP)", L: "op10:Hi_10", S: "op10:Lo_10", litSign: "+", cuts: ["1988-01", "2013-01"] },
  { name: "investment (Lo INV − Hi INV)", L: "inv10:Lo_10", S: "inv10:Hi_10", litSign: "+", cuts: ["1988-01", "2013-01"] },
  { name: "momentum 12-2 (REPRODUCTION control, D-477 t 4.84)", L: "mom10:Hi_PRIOR", S: "mom10:Lo_PRIOR", litSign: "+", cuts: ["1952-01", "1977-01", "2002-01"] },
];
const out: Record<string, unknown> = {};
for (const r of rows) {
  const s = series(r.L, r.S);
  const t = tstat(s.spread), sign = mean(s.spread) > 0 ? "+" : "−";
  const matched = sign === r.litSign ? "MATCHED" : "MISSED";
  console.log(`\n  ${r.name}`);
  console.log(`    spread net of drag        ${fmt(s.spread)}   sign ${matched} vs literature   ${t >= T.ceiling ? "CLEARS" : "UNDER"} ceiling ${T.ceiling.toFixed(2)}`);
  console.log(`    BENCHMARK: long leg − market   ${fmt(s.longEx)}`);
  console.log(`               short leg − market  ${fmt(s.shortEx)}   (a positive short-leg excess means the short side RISES: the spread is not a short)`);
  console.log(`    eras: ${eras(s.mos, s.spread, r.cuts)}`);
  const neg = s.spread.filter((x) => x < 0).length / s.spread.length;
  console.log(`    months negative ${(neg * 100).toFixed(0)}%   span ${s.mos[0]}..${s.mos[s.mos.length - 1]}`);
  out[r.name] = { n: s.spread.length, netYr: mean(s.spread) * 12, t, matched, longExT: tstat(s.longEx), shortExT: tstat(s.shortEx) };
}
console.log(`\n  RESULT_JSON ${JSON.stringify(out)}`);
