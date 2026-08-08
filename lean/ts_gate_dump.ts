// ts_gate_dump.ts — emit the TS gate's outputs on fixed fixtures so the Python port can be checked for parity.
// Run from repo root: deno run --allow-read --allow-write lean/ts_gate_dump.ts > /tmp/ts_out.json
import * as S from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
function lcg(seed:number){ return ()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }; }
const r1=lcg(11), r2=lcg(22);
const setup = Array.from({length:400},()=> (r1()<0.3?3:-1) + (r1()-0.5)*0.2 );
const control = Array.from({length:800},()=> (r2()<0.27?3:-1) + (r2()-0.5)*0.2 );
const rets = Array.from({length:250},(_,i)=> Math.sin(i/9)*0.01 + (lcg(7+i)()-0.48)*0.02 );
const M:number[][]=[]; const rm=lcg(99); for(let i=0;i<120;i++){ const row:number[]=[]; for(let j=0;j<6;j++) row.push((rm()-0.5)*0.02 + j*0.0003); M.push(row); }
const sr = S.sharpe(rets), sk=S.skewness(rets), ku=S.kurtosis(rets);
const out = {
  erf:[S.erf(-1.3),S.erf(0.0),S.erf(0.77),S.erf(2.1)], normalCdf:[S.normalCdf(-2),S.normalCdf(0),S.normalCdf(1.64)],
  invNorm:[S.invNorm(0.01),S.invNorm(0.5),S.invNorm(0.95),S.invNorm(0.999)],
  mean:S.mean(rets), sampleStd:S.sampleStd(rets), popStd:S.popStd(rets), skewness:sk, kurtosis:ku,
  sharpe:sr, sortino:S.sortino(rets), maxDrawdown:S.maxDrawdown(rets), calmar:S.calmar(rets,252),
  psr:S.probabilisticSharpe(sr,0,rets.length,sk,ku), expMaxSharpe:S.expectedMaxSharpe(50,0.04),
  dsr:S.deflatedSharpe(sr,rets.length,sk,ku,50,0.04), minTRL:S.minTRL(0.12,0.03,sk,ku,0.95),
  pbo:S.pboCSCV(M,8), edge:edgeVsRandom(setup,control),
};
console.log(JSON.stringify(out));
await Deno.writeTextFile("/tmp/fixtures.json", JSON.stringify({setup, control, rets, M}));
