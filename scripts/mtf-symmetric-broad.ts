#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-symmetric-broad.ts (D-771) — the symmetry test the program had not yet run. D-768 measured the DOWNSIDE
// PSL sweep + persist(real) → fade LONG at K24 (57.51bp t 2.59 5/5 crypto). If the market "fades structural breaks",
// the UPSIDE version should behave the same: PSH (prior-session HIGH) upside sweep + persist(real) → fade SHORT.
// If sign is symmetric the case for a real mean-reversion mechanism strengthens; if only the downside works, the
// finding is more likely a "buy the dip after capitulation" asymmetry, not a general fade of structure.
//
// Same setup, mirror. 5-crypto panel, taker-delta z persistence, K∈{4,12,24}, lag-1, RT 7bp/crypto. train<2023/test>=.
// A short position's net = -log(exit/entry) - rt.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-symmetric-broad", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
]);
const KSET = [4, 12, 24];
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), PERSIST = Number(K.PERSIST), DZ_HI = Number(K.DELTA_Z_HI);
const MIN_EVENTS = Number(K.MIN_EVENTS);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "msb2", exp: 4102444800 });
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

interface Evt { symbol: string; ts: number; train: boolean; net: Record<number, number>; side: "down" | "up" }
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  for (let i = CLIMAX_N; i < bars.length - Math.max(...KSET) - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;

    if (bars[i].c < lvl.low) {
      // downside sweep — FADE LONG (D-768 replication)
      const net: Record<number, number> = {};
      for (const k of KSET) net[k] = Math.log(bars[i + 1 + k].c / entry) - rt;
      events.push({ symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, net, side: "down" });
    } else if (bars[i].c > lvl.high) {
      // upside sweep — FADE SHORT (the mirror)
      const net: Record<number, number> = {};
      for (const k of KSET) net[k] = -Math.log(bars[i + 1 + k].c / entry) - rt;
      events.push({ symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, net, side: "up" });
    }
  }
}

const downN = events.filter((e) => e.side === "down").length;
const upN = events.filter((e) => e.side === "up").length;
console.log(`==> MTF SYMMETRIC SIDE — downside sweeps (fade LONG): ${downN}, upside sweeps (fade SHORT): ${upN}`);
console.log(`  POSITIVE CONTROL — both sides must produce events; expect similar magnitudes (~1:1) if PSH/PSL detectors are symmetric.`);
if (downN < 100 || upN < 100 || upN > 2 * downN || downN > 2 * upN) {
  console.error(`!! side count imbalance suggests a detector bug.`); Deno.exit(1);
}

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  return { n, mean: m, t: s2 > 0 ? m / (Math.sqrt(s2) / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

let TRIALS = 0;
console.log(`\n  === POOLED (train vs test) — each row a trial. Fade net is SIGNED WITH THE TRADE. ===`);
console.log(`    side   K    train: n / mean / t         test:  n / mean / t     test sign +/tested`);
for (const side of ["down", "up"] as const) {
  for (const k of KSET) {
    TRIALS += 2;
    const evs = events.filter((e) => e.side === side);
    const tr = stats(evs.filter((e) => e.train).map((e) => e.net[k]));
    const te = stats(evs.filter((e) => !e.train).map((e) => e.net[k]));
    let pos = 0, tested = 0;
    for (const s of CRYPTO) {
      const xs = evs.filter((e) => e.symbol === s && !e.train).map((e) => e.net[k]);
      if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
    }
    const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  +OOS" : (te.mean < 0 && te.t <= -2 ? "  -OOS" : "");
    console.log(`    ${side.padEnd(6)} ${String(k).padStart(2)}  ${String(tr.n).padStart(5)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(6)}     ${String(te.n).padStart(5)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}${flag}    ${pos}/${tested}`);
  }
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-symmetric-broad", runId: `mss|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  DOWN K24 baseline reproduces D-768; UP K24 tests the symmetry. If UP is comparable, the fade is a`);
console.log(`  general reversion; if UP is negative or flat, the D-768 finding is a "buy-the-dip after capitulation"`);
console.log(`  asymmetry, not a two-sided edge — a smaller universe of setups than the "fades structure" narrative.`);
console.log(`  Program ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()} (added ${TRIALS} trials).`);
