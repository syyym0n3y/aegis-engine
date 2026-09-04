#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-panel97-era.ts (D-782) — era stability of the D-781 three-cell 97-perp SF replication. D-777's warning:
// the rvol-hi t 7.86 sign-flipped in 2026. If any of these three sign-flips too, the registered forward clock
// is likely to kill. Run era decomposition BEFORE claiming anything about the D-781 headline t's.
import { Bar } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("mtf-panel97-era", [
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
]);
const KK = 6, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const RT = Number(K.CRYPTO_RT_BP) / 1e4;
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "m97e", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const sfMeta = await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
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
const CELLS = [
  { name: "utc01-sweepPDL-reclaim-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => h === 1 && b.l < pdl && b.c >= pdl, dir: 1 },
  { name: "utc09to10-belowPDL-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => (h === 9 || h === 10) && b.c < pdl, dir: 1 },
  { name: "utc16-abovePDH-LONG", check: (b: Bar, h: number, pdh: number, _pdl: number) => h === 16 && b.c > pdh, dir: 1 },
] as const;

// pool by cell+year
const pools = new Map<string, Map<number, number[]>>();
for (const c of CELLS) pools.set(c.name, new Map());

console.log(`==> MTF PANEL 97 ERA — D-782 era stability for the 3 registered clocks`);
let loaded = 0;
for (const m of sfMeta) {
  if (m.n_bars < 5000) continue;
  const bars = await load(m.symbol);
  if (bars.length < 5000) continue;
  const dl = dayLevels(bars);
  for (let i = 25; i < bars.length - KK - 1; i++) {
    const b = bars[i];
    if (b.ts < SPLIT_TS) continue;
    const pdk = prevDayKey(utcDayKey(b.ts));
    const pd = dl.get(pdk); if (!pd) continue;
    const hr = utcHour(b.ts);
    const yr = new Date(b.ts * 1000).getUTCFullYear();
    const fwd = Math.log(bars[i + KK].c / b.c);
    for (const c of CELLS) {
      if (!c.check(b, hr, pd.hi, pd.lo)) continue;
      const net = c.dir * fwd - RT;
      const m2 = pools.get(c.name)!;
      if (!m2.has(yr)) m2.set(yr, []);
      m2.get(yr)!.push(net);
    }
  }
  loaded++;
  if (loaded % 20 === 0) console.error(`  loaded ${loaded}`);
}

for (const c of CELLS) {
  console.log(`\n  ${c.name}`);
  console.log(`    year  n         mean bp     t`);
  const m = pools.get(c.name)!;
  for (const yr of [2023, 2024, 2025, 2026]) {
    const xs = m.get(yr) ?? [];
    const s = stats(xs);
    const flag = s.n >= 200 && s.t <= 0 ? " ** SIGN NEG" : (s.n >= 200 && s.t >= 2 ? " +" : "");
    console.log(`    ${yr}  ${String(s.n).padStart(6)}   ${bp(s.mean).padStart(8)}    ${s.t.toFixed(2).padStart(6)}${flag}`);
  }
}
console.log(`\n  D-777 pattern check: any year with n>=200 AND t <= 0 flags the SIGN NEG risk that killed D-776.`);
console.log(`  If 2026 (partial 8 months) is strongly negative, the registered clock is on kill trajectory.`);
