#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-panel97.ts (D-781) — the 97-perp 1hSF (survivorship-free) BREADTH LAW test on the three
// D-780 forward-clock cells we just registered. If the pattern replicates on ~10x the breadth,
// it's not selection; if it collapses, the D-780 registration was fragile and the clock will kill.
import { Bar } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("mtf-panel97", [
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "MIN_INST_EVENTS", def: "20", note: "per-instrument event floor to count in sign map" },
]);
const KK = 6, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const RT = Number(K.CRYPTO_RT_BP) / 1e4;
const MIN_INST = Number(K.MIN_INST_EVENTS);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "m97", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// list the 97 symbols with 1hSF data
const sfMeta = await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
console.log(`==> MTF PANEL 97 — ${sfMeta.length} symbols with 1hSF bars (survivorship-free)`);
console.log(`  top 10 by n_bars: ${sfMeta.slice(0, 10).map((x) => `${x.symbol}(${x.n_bars})`).join(", ")}`);

async function load(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1hSF&select=bars`))[0];
  return ((row?.bars || []) as number[][])
    .filter((b) => Array.isArray(b) && b.length >= 6 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }))
    .sort((a, b) => a.ts - b.ts);
}

const utcDayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const utcHour = (ts: number) => new Date(ts * 1000).getUTCHours();
function prevDayKey(k: string): string { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function dayLevels(bars: Bar[]): Map<string, { hi: number; lo: number }> {
  const m = new Map<string, { hi: number; lo: number }>();
  for (const b of bars) {
    const k = utcDayKey(b.ts);
    const cur = m.get(k);
    if (!cur) m.set(k, { hi: b.h, lo: b.l }); else { cur.hi = Math.max(cur.hi, b.h); cur.lo = Math.min(cur.lo, b.l); }
  }
  return m;
}
function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// Three cell definitions matching the registered clocks
const CELLS = [
  { name: "utc01-sweepPDL-reclaim-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => h === 1 && b.l < pdl && b.c >= pdl, dir: 1 },
  { name: "utc09to10-belowPDL-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => (h === 9 || h === 10) && b.c < pdl, dir: 1 },
  { name: "utc16-abovePDH-LONG", check: (b: Bar, h: number, pdh: number, _pdl: number) => h === 16 && b.c > pdh, dir: 1 },
] as const;

// pool by cell
const pools = new Map<string, Map<string, number[]>>();
for (const c of CELLS) pools.set(c.name, new Map());

let loaded = 0, skipped = 0;
for (const m of sfMeta) {
  if (m.n_bars < 5000) { skipped++; continue; }
  const bars = await load(m.symbol);
  if (bars.length < 5000) { skipped++; continue; }
  const dl = dayLevels(bars);
  for (let i = 25; i < bars.length - KK - 1; i++) {
    const b = bars[i];
    if (b.ts < SPLIT_TS) continue;
    const pdk = prevDayKey(utcDayKey(b.ts));
    const pd = dl.get(pdk); if (!pd) continue;
    const hr = utcHour(b.ts);
    const fwd = Math.log(bars[i + KK].c / b.c);
    for (const c of CELLS) {
      if (!c.check(b, hr, pd.hi, pd.lo)) continue;
      const net = c.dir * fwd - RT;
      const m2 = pools.get(c.name)!;
      if (!m2.has(m.symbol)) m2.set(m.symbol, []);
      m2.get(m.symbol)!.push(net);
    }
  }
  loaded++;
  if (loaded % 10 === 0) console.error(`  loaded ${loaded}/${sfMeta.length}`);
}
console.log(`  ${loaded} instruments loaded (${skipped} skipped for <5000 bars)`);

console.log(`\n  === CROSS-PANEL RESULTS (${loaded}-instrument SF panel, OOS ${K.SPLIT}+, K=6h, cost ${(RT * 1e4).toFixed(0)}bp) ===`);
for (const c of CELLS) {
  const m = pools.get(c.name)!;
  const pool: number[] = [];
  let pos = 0, tested = 0;
  const perSymAll: Array<{ sym: string; n: number; mean: number; t: number }> = [];
  for (const [sym, xs] of m) {
    pool.push(...xs);
    const s = stats(xs);
    perSymAll.push({ sym, n: s.n, mean: s.mean, t: s.t });
    if (xs.length < MIN_INST) continue;
    tested++; if (s.mean > 0) pos++;
  }
  const s = stats(pool);
  console.log(`\n  ${c.name}`);
  console.log(`    POOLED  n ${s.n} / mean ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${pos}/${tested} (>= ${MIN_INST} evts)`);
  // top-5 winners
  const top = perSymAll.filter((p) => p.n >= MIN_INST).sort((a, b) => b.t - a.t).slice(0, 5);
  const bot = perSymAll.filter((p) => p.n >= MIN_INST).sort((a, b) => a.t - b.t).slice(0, 5);
  console.log(`    top 5:  ${top.map((p) => `${p.sym}(${bp(p.mean)}bp t${p.t.toFixed(1)})`).join(" ")}`);
  console.log(`    bot 5:  ${bot.map((p) => `${p.sym}(${bp(p.mean)}bp t${p.t.toFixed(1)})`).join(" ")}`);
}
console.log(`\n  D-780 reported (17-panel):`);
console.log(`    utc01-sweepPDL-reclaim: +15.44bp t 3.40 sign 13/17`);
console.log(`    utc09-10-belowPDL:      +8-11bp t 2.4-3.4 sign 12-13/17`);
console.log(`    utc16-abovePDH:         +7.31bp t 2.91 sign 11/17`);
