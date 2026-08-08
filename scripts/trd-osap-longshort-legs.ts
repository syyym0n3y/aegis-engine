#!/usr/bin/env -S deno run --allow-read
// trd-osap-longshort-legs — the final implementability test on the anomaly library. D-161 showed the whole
// library's OOS return is a microcap/equal-weight artifact (VW t=0.57). This decomposes it further using the
// per-DECILE portfolio file (port 01..10 + LS, with Nlong/Nshort stock counts):
//
//   Q: does the anomaly return come from the LONG leg (buyable, no borrow) or the SHORT leg (borrow costs,
//      hard-to-borrow microcaps, the leg retail and most funds cannot actually harvest)?
//
// The literature's known answer is "mostly the short leg" — which, if reproduced, means even a working
// anomaly is largely unharvestable. We test it directly, out-of-sample (2015+), on the whole library and on
// the 7 survivors. Long-only spread = extreme decile − middle decile (no shorting required).
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const F = "data/literature/PredictorPortsFull.bin";
const SURV = new Set(["SmileSlope", "dCPVolSpread", "EarningsStreak", "NetPayoutYield", "XFIN", "OrderBacklogChg", "RIO_Volatility"]);
interface Row { sig: string; port: string; date: string; ret: number; nl: number; ns: number }
const bySig = new Map<string, Row[]>();
const txt = await Deno.readTextFile(F);
const lines = txt.split("\n"); const hdr = lines[0].split(",");
const iSig = hdr.indexOf("signalname"), iPort = hdr.indexOf("port"), iDate = hdr.indexOf("date"), iRet = hdr.indexOf("ret"), iNl = hdr.indexOf("Nlong"), iNs = hdr.indexOf("Nshort");
for (let i = 1; i < lines.length; i++) {
  const p = lines[i].split(","); if (p.length <= iRet) continue;
  const ret = +p[iRet]; if (!Number.isFinite(ret)) continue;
  const sig = p[iSig];
  (bySig.get(sig) ?? bySig.set(sig, []).get(sig)!).push({ sig, port: p[iPort], date: p[iDate], ret, nl: +p[iNl] || 0, ns: +p[iNs] || 0 });
}
console.log(`DECILE-LEG DECOMPOSITION — ${bySig.size} signals, ${lines.length.toLocaleString()} portfolio-months\n`);
const CUT = "2015-01";
const tstat = (a: number[]) => { const v = a.filter(Number.isFinite); if (v.length < 24) return NaN; const s = sampleStd(v); return s > 0 ? mean(v) / (s / Math.sqrt(v.length)) : NaN; };
interface Res { sig: string; ls: number[]; longOnly: number[]; shortLeg: number[]; nLong: number; nShort: number }
const res: Res[] = [];
for (const [sig, rows] of bySig) {
  const oos = rows.filter((r) => r.date >= CUT);
  if (oos.length < 100) continue;
  const byDate = new Map<string, Map<string, Row>>();
  for (const r of oos) (byDate.get(r.date) ?? byDate.set(r.date, new Map()).get(r.date)!).set(r.port, r);
  // decile labels present
  const ports = [...new Set(oos.map((r) => r.port))].filter((p) => /^\d+$/.test(p)).sort();
  if (ports.length < 3) continue;
  const hi = ports[ports.length - 1], lo = ports[0];
  const mid = ports[Math.floor(ports.length / 2)];
  const ls: number[] = [], longOnly: number[] = [], shortLeg: number[] = [];
  let nL = 0, nS = 0, k = 0;
  for (const [, m] of byDate) {
    const L = m.get("LS"); if (L) ls.push(L.ret);
    const h = m.get(hi), l = m.get(lo), md = m.get(mid);
    if (h && md) longOnly.push(h.ret - md.ret);         // buy the top decile vs the middle — NO shorting
    if (l && md) shortLeg.push(md.ret - l.ret);          // the short leg's contribution
    if (L) { nL += L.nl; nS += L.ns; k++; }
  }
  res.push({ sig, ls, longOnly, shortLeg, nLong: k ? nL / k : 0, nShort: k ? nS / k : 0 });
}
const agg = (sel: Res[], pick: (r: Res) => number[], label: string) => {
  const L = Math.min(...sel.map((r) => pick(r).length).filter((x) => x > 0));
  if (!Number.isFinite(L) || L < 24) { console.log(`   ${label}: thin`); return; }
  const port: number[] = [];
  for (let i = 0; i < L; i++) { let s = 0, k = 0; for (const r of sel) { const a = pick(r); const v = a[a.length - L + i]; if (Number.isFinite(v)) { s += v; k++; } } if (k) port.push(s / k); }
  console.log(`   ${label.padEnd(34)} ${mean(port).toFixed(4).padStart(8)}%/mo  t=${tstat(port).toFixed(2).padStart(6)}  ${tstat(port) > 2 ? "✓" : "✗"}`);
};
console.log(`══ WHOLE LIBRARY (${res.length} signals), OUT-OF-SAMPLE 2015+ ══`);
agg(res, (r) => r.ls, "LONG-SHORT (needs shorting)");
agg(res, (r) => r.longOnly, "LONG-ONLY (top decile vs middle)");
agg(res, (r) => r.shortLeg, "SHORT LEG contribution");
const surv = res.filter((r) => SURV.has(r.sig));
console.log(`\n══ THE 7 SURVIVORS (${surv.length} found), OUT-OF-SAMPLE 2015+ ══`);
agg(surv, (r) => r.ls, "LONG-SHORT (needs shorting)");
agg(surv, (r) => r.longOnly, "LONG-ONLY (top decile vs middle)");
agg(surv, (r) => r.shortLeg, "SHORT LEG contribution");
console.log(`\n══ PORTFOLIO BREADTH — how many stocks per leg (microcap tell) ══`);
const avgL = mean(res.map((r) => r.nLong).filter((x) => x > 0)), avgS = mean(res.map((r) => r.nShort).filter((x) => x > 0));
console.log(`   library average: ${avgL.toFixed(0)} long / ${avgS.toFixed(0)} short stocks per portfolio`);
for (const r of surv) console.log(`   ${r.sig.padEnd(18)} ${r.nLong.toFixed(0).padStart(5)} long / ${r.nShort.toFixed(0).padStart(5)} short   LS t=${tstat(r.ls).toFixed(2).padStart(6)}  long-only t=${tstat(r.longOnly).toFixed(2).padStart(6)}`);
console.log(`\nREAD: if the return lives in the SHORT leg, it is largely unharvestable (borrow cost, hard-to-borrow`);
console.log(`microcaps). A LONG-ONLY spread that survives is the only version a normal account can actually trade.`);
