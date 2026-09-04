#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-chart-patterns.ts (D-775) — the "did-not-recommend" audit item. I had characterised chart patterns
// (pinbar / bullish engulfing / hammer / doji / marubozu) as "already covered by the 10-setup finding" without
// actually measuring them. Doing that honestly now. Every pattern tested as a CONDITIONER on the D-768 baseline
// (persist(real) + downside PSL sweep + K24) on the D-773 10-crypto panel — same event population, sub-selection
// by pattern. If any lifts the sign or t materially it's a real finding; if not the earlier dismissal earns
// evidence.
//
// Patterns tested (definitions locked before running, no post-hoc thresholds):
//   PINBAR (hammer)     lower wick >= 60% of bar range AND body <= 30% of range
//   ENGULF (bullish)    bar[i-1] bearish (c<o) AND bar[i] bullish (c>o) AND bar[i] body encloses bar[i-1] body
//   MARUBOZU (green)    bar closes at or near high (upper wick <= 10% of range) AND green
//   DOJI                body <= 10% of range
//   INSIDE              bar[i-1].h >= bar[i].h AND bar[i-1].l <= bar[i].l (range contraction)
//   OUTSIDE             bar[i].h > bar[i-1].h AND bar[i].l < bar[i-1].l (range expansion)
// Each is a SUB-SELECTION on the D-768 base event set, K24, lag-1, RT 7bp. Trials counted (SELECTION LAW).
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-chart-patterns", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), DZ_HI = Number(K.DELTA_Z_HI), MIN_EVENTS = Number(K.MIN_EVENTS);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mcp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
interface RichBar extends Bar { taker: number; delta: number; deltaZ: number }
async function loadCrypto(sym: string): Promise<RichBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = (row?.bars || []);
  const arr = raw.filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7], delta: b[7] - 0.5 * b[5], deltaZ: 0 } as RichBar))
    .sort((a, b) => a.ts - b.ts);
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}
const CBARS = new Map<string, RichBar[]>();
for (const s of CRYPTO) CBARS.set(s, await loadCrypto(s));
for (const s of CRYPTO) assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000);

interface Evt {
  symbol: string; ts: number; train: boolean; net: number;
  pinbar: boolean; engulf: boolean; marubozu: boolean; doji: boolean; inside: boolean; outside: boolean;
}
function detectPatterns(b: RichBar, prev: RichBar): { pinbar: boolean; engulf: boolean; marubozu: boolean; doji: boolean; inside: boolean; outside: boolean } {
  const range = b.h - b.l;
  if (range <= 0) return { pinbar: false, engulf: false, marubozu: false, doji: false, inside: false, outside: false };
  const body = Math.abs(b.c - b.o);
  const lowerWick = Math.min(b.o, b.c) - b.l;
  const upperWick = b.h - Math.max(b.o, b.c);
  return {
    pinbar: lowerWick / range >= 0.6 && body / range <= 0.3,
    engulf: prev.c < prev.o && b.c > b.o && b.o <= prev.c && b.c >= prev.o,
    marubozu: b.c > b.o && upperWick / range <= 0.1,
    doji: body / range <= 0.1,
    inside: prev.h >= b.h && prev.l <= b.l,
    outside: b.h > prev.h && b.l < prev.l,
  };
}

const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  for (let i = CLIMAX_N; i < bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;
    const net = Math.log(bars[i + 1 + KK].c / entry) - rt;
    const p = detectPatterns(bars[i], bars[i - 1]);
    events.push({ symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, net, ...p });
  }
}

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

const baseTe = stats(events.filter((e) => !e.train).map((e) => e.net));
console.log(`==> MTF CHART PATTERNS — did-not-recommend audit on D-768 base, 10-crypto panel`);
console.log(`  base OOS (D-773 R1 reproduction): n ${baseTe.n} / ${bp(baseTe.mean)}bp / t ${baseTe.t.toFixed(2)}`);

const PATS: Array<[string, (e: Evt) => boolean]> = [
  ["pinbar", (e) => e.pinbar], ["engulf", (e) => e.engulf], ["marubozu", (e) => e.marubozu],
  ["doji", (e) => e.doji], ["inside", (e) => e.inside], ["outside", (e) => e.outside],
];
let TRIALS = 0;
console.log(`\n  cell         test n / mean / t     lift bp vs base    sign +/tested`);
for (const [name, fn] of PATS) {
  TRIALS++;
  const te = events.filter((e) => !e.train && fn(e));
  const s = stats(te.map((e) => e.net));
  let pos = 0, tested = 0;
  for (const sym of CRYPTO) {
    const xs = te.filter((e) => e.symbol === sym).map((e) => e.net);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  const lift = s.mean - baseTe.mean;
  const flag = s.n >= MIN_EVENTS && s.mean > 0 && s.t >= 2 && tested >= 5 && pos >= Math.ceil(tested / 2) ? "  +OOS" : "";
  console.log(`  ${name.padEnd(10)}  ${String(s.n).padStart(4)} / ${bp(s.mean).padStart(7)} / ${s.t.toFixed(2).padStart(6)}     ${(lift * 1e4).toFixed(2).padStart(7)}bp        ${pos}/${tested}${flag}`);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-chart-patterns", runId: `mcp|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  VERDICT: pattern-family conditioners tested honestly against the D-768 base on the 10-crypto panel.`);
console.log(`  Program ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()} (+${TRIALS} trials).`);
