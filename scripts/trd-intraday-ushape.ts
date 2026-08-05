#!/usr/bin/env -S deno run --allow-read
// trd-intraday-ushape — WHEN is the tape favourable? Realized vol + typical move BY HOUR-OF-DAY (UTC), per
// instrument, on deep 1m data. The classic U-shape (open/close spikes, midday lull) tells a trader which
// hours are calm (favourable for mean-reversion / tight stops) vs active (breakout opportunity / stop-run
// danger). Indices: 15y Dukascopy. Crypto: full-history Binance bulk dumps (data/binance/*, from
// fetch-binance-1m.sh). Per ANALYSIS_CONTRACT: numbers, N, honest.
const DUKA = "data/duka", BIN = "data/binance";
interface Row { t: number; c: number; }
async function loadDuka(prefix: string): Promise<Row[]> {
  const out: Row[] = []; const seen = new Set<number>();
  try { for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, c: +p[4] }); } } } catch { /* */ }
  return out.sort((a, b) => a.t - b.t);
}
async function loadBin(sym: string): Promise<Row[]> {
  try { const txt = await Deno.readTextFile(`${BIN}/${sym}-1m.csv`); const out: Row[] = []; for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12) continue; out.push({ t, c: +p[4] }); } return out.sort((a, b) => a.t - b.t); } catch { return []; }
}
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const SESS = (h: number) => h < 7 ? "Asia " : h < 13 ? "London" : h < 21 ? "NY   " : "post ";

function ushape(name: string, bars: Row[], span: string) {
  if (bars.length < 5000) { console.log(`\n${name}: insufficient (${bars.length})`); return; }
  const sq: number[][] = Array.from({ length: 24 }, () => []); const mv: number[][] = Array.from({ length: 24 }, () => []);
  for (let i = 1; i < bars.length; i++) { if (bars[i].t - bars[i - 1].t > 120000) continue; const r = Math.log(bars[i].c / bars[i - 1].c); if (!Number.isFinite(r)) continue; const h = new Date(bars[i].t).getUTCHours(); sq[h].push(r * r); mv[h].push(Math.abs(r)); }
  const hourVol = sq.map((a) => a.length ? Math.sqrt(a.reduce((s, x) => s + x, 0) / a.length) * Math.sqrt(525600) * 100 : NaN);
  const hourMove = mv.map((a) => median(a) * 1e4); // bps per 1m bar
  const valid = hourVol.map((v, h) => ({ h, v, m: hourMove[h], n: sq[h].length })).filter((x) => Number.isFinite(x.v) && x.n > 500);
  const avg = valid.reduce((s, x) => s + x.v, 0) / valid.length;
  console.log(`\n════ ${name} — intraday U-shape by UTC hour (${span}) ════`);
  console.log(`hr  sess    ann-vol%   med-move(bps)   vs-avg   bar`);
  for (const x of valid) { const rel = x.v / avg; const bar = "█".repeat(Math.round(rel * 12)); console.log(`${String(x.h).padStart(2)}  ${SESS(x.h)}  ${x.v.toFixed(1).padStart(7)}   ${x.m.toFixed(1).padStart(9)}     ${(rel).toFixed(2)}×  ${bar}`); }
  const sorted = [...valid].sort((a, b) => a.v - b.v);
  const calm = sorted.slice(0, 3).map((x) => `${x.h}:00`).join(", ");
  const active = sorted.slice(-3).reverse().map((x) => `${x.h}:00`).join(", ");
  console.log(`  → CALMEST (favourable for mean-rev / tight stops): ${calm}`);
  console.log(`  → MOST ACTIVE (breakout opportunity / stop-run danger): ${active}`);
}

console.log(`INTRADAY U-SHAPE — hour-of-day vol & move, per instrument. "When is the tape favourable?"`);
ushape("S&P 500 (Dukascopy 15y)", await loadDuka("usa500idxusd"), "2011→2026");
ushape("Nasdaq 100 (Dukascopy 15y)", await loadDuka("usatechidxusd"), "2011→2026");
for (const s of ["BTCUSDT", "ETHUSDT"]) { const b = await loadBin(s); if (b.length) ushape(`${s} (Binance bulk, full 1m)`, b, `${new Date(b[0].t).toISOString().slice(0, 7)}→${new Date(b[b.length - 1].t).toISOString().slice(0, 7)}`); else console.log(`\n${s}: bulk dump not ready yet (fetch-binance-1m.sh still running)`); }
