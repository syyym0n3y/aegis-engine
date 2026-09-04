#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-d768-era.ts (D-778) — D-777 revealed 2026 SIGN-FLIPPED on the rvol-hi cell. The registered forward
// clock `fwd-persist-real-K24` is on the D-768/773 baseline (persist(real) + PSL downside sweep + K24 on 10
// crypto). Question: has THAT signal also weakened in 2026? If yes, the clock is likely to inconclusive-mature
// or kill; if no, the D-773 finding is more robust than the rvol-hi decomposition would suggest.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-d768-era", [
  { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" }, { name: "DELTA_Z_HI", def: "1.0" },
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), DZ_HI = Number(K.DELTA_Z_HI);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mde", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
interface RichBar extends Bar { delta: number; deltaZ: number }
async function loadCrypto(sym: string): Promise<RichBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = (row?.bars || []);
  const arr = raw.filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], delta: b[7] - 0.5 * b[5], deltaZ: 0 } as RichBar))
    .sort((a, b) => a.ts - b.ts);
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}
interface Evt { symbol: string; ts: number; train: boolean; net: number; year: number }
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const sym of CRYPTO) {
  const bars = await loadCrypto(sym);
  assertNonEmpty(`bars ${sym}`, bars, 5000);
  const psl = priorSessionLevels(bars);
  for (let i = CLIMAX_N; i < bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;
    const net = Math.log(bars[i + 1 + KK].c / entry) - rt;
    events.push({ symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, net, year: new Date(bars[i].ts * 1000).getUTCFullYear() });
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
console.log(`==> D-768/773 BASELINE ERA STABILITY — is 2026 also negative for the registered forward clock?`);
console.log(`  events: ${events.length}   (D-773 R1 reported OOS n 913)`);
for (const yr of [2023, 2024, 2025, 2026]) {
  const te = events.filter((e) => !e.train && e.year === yr);
  const s = stats(te.map((e) => e.net));
  let pos = 0, tested = 0;
  for (const sym of CRYPTO) {
    const xs = te.filter((e) => e.symbol === sym).map((e) => e.net);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  console.log(`  ${yr}  n ${String(s.n).padStart(4)} / mean ${bp(s.mean).padStart(7)}bp / t ${s.t.toFixed(2).padStart(6)}   sign ${pos}/${tested}`);
}
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-d768-era", runId: `mde|${K.SPLIT}`, spent: 4 });
console.log(`\n  ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()}.`);
