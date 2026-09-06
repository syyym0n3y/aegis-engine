#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// insider-sells-test.ts (D-805) — the insider SELL side in the TRADABLE slice (pre-registered D-805-insider-sells-3m).
//
// D-476 swept 272,958 open-market Form-4 BUYS and found the tradable slice carries ~no information (ins3m t 0.64);
// sells were filtered at the original backfill and never held. `ingest-form345-sells.ts` now holds them in
// data/insider-sells.jsonl. Construction (the only registered one): month-end, signal = 3-month sum of open-market
// sell value / (21-day mean dollar volume x 21), within the LIQUID DECILE of US equities (the clock-#18 universe,
// equities only), top quintile among names with any sell vs the decile universe mean over the next 21 sessions,
// entry the session AFTER month-end (lag-1). Second registered trial: any-sell vs no-sell. Laws: BENCHMARK (excess
// vs universe), liquidity halves BOTH sides, a 1-month prior-return control (competing explanation b), breadth per
// month, SIGN stated (negative). Coverage statement: the liquid decile is 1,230 names built on the pre-2023 MDV
// definition; delisted names are absent (D-639: 27.3% of the FTD universe) — a survivorship-biased LONG universe
// biases a short signal's excess toward zero or positive, stated rather than corrected. Trials: 2.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("insider-sells-test", [
  { name: "SELLS", def: "data/insider-sells.jsonl" },
  { name: "DECILE", def: "data/liquid-decile.json" },
  { name: "WIN_D", def: "91", note: "calendar days of sells summed" },
  { name: "HOLD", def: "21", note: "sessions held from the session after month-end" },
  { name: "MIN_NAMES", def: "50", note: "names with a sell per month" },
  { name: "RUN_ID", def: "D-805-insider-sells-3m" },
  { name: "PAGE_SLEEP_MS", def: "80" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const REPO = new URL("..", import.meta.url).pathname;
const abs = (p: string) => p.startsWith("/") ? p : `${REPO}${p}`;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ist", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
async function get<T>(path: string): Promise<T> { const r = await fetch(`${OWNED}${path}`, { headers: hdr }); if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 80)}: ${(await r.text()).slice(0, 160)}`); return await r.json() as T; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOLD = +K.HOLD, WIN = +K.WIN_D, MIN_NAMES = +K.MIN_NAMES;

// 1. sells
type Sell = { ticker: string; disclosed_date: string; value_usd: number };
const sells = new Map<string, { d: string; v: number }[]>(); let nSell = 0;
for (const ln of (await Deno.readTextFile(abs(K.SELLS))).split("\n")) { if (!ln) continue; const s = JSON.parse(ln) as Sell; if (!s.disclosed_date || !(s.value_usd > 0)) continue; (sells.get(s.ticker) ?? sells.set(s.ticker, []).get(s.ticker)!).push({ d: s.disclosed_date, v: s.value_usd }); nSell++; }
if (nSell < 100_000) { console.error(`  RED — positive control: ${nSell} sells loaded, expected >= 100k`); Deno.exit(1); }
if (!sells.has("AAPL")) { console.error("  RED — positive control: AAPL has no sells"); Deno.exit(1); }
for (const a of sells.values()) a.sort((x, y) => x.d < y.d ? -1 : 1);
console.log(`  sells: ${nSell.toLocaleString()} ticker x filing rows, ${sells.size.toLocaleString()} tickers`);

// 2. universe: liquid decile ∩ equities held (indices/crypto/FX excluded by asset_class + pattern; ETFs may remain — stated)
const dec = JSON.parse(await Deno.readTextFile(abs(K.DECILE))) as { symbols: string[] };
const eq = new Set<string>();
for (let off = 0; ; off += 1000) { const p = await get<{ symbol: string }[]>(`/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`); for (const r of p) eq.add(r.symbol); if (p.length < 1000) break; }
const uni = dec.symbols.filter((s) => eq.has(s) && !/-USD$|^\^|=X$|=F$/.test(s)).sort();
assertNonEmpty("liquid-decile equities", uni, 500);
console.log(`  universe: ${uni.length} liquid-decile equities (of ${dec.symbols.length} decile members); ${uni.filter((s) => sells.has(s)).length} with any sell on record`);

// 3. bars
type Bars = { day: string[]; c: Float64Array; dv: Float64Array };
const bars = new Map<string, Bars>();
for (let i = 0; i < uni.length; i += 25) {
  const rows = await get<{ symbol: string; bars: number[][] }[]>(`/trd_bars_deep?symbol=in.(${uni.slice(i, i + 25).map((s) => `"${s}"`).join(",")})&select=symbol,bars`);
  for (const r of rows) { const b = r.bars; if (!b || b.length < 300) continue; bars.set(r.symbol, { day: b.map((x) => new Date(x[0] * 1000).toISOString().slice(0, 10)), c: Float64Array.from(b.map((x) => x[4])), dv: Float64Array.from(b.map((x) => x[4] * x[5])) }); }
  await sleep(+K.PAGE_SLEEP_MS);
}
console.log(`  bars: ${bars.size} symbols`);

// 4. month-ends from 2010-04 (first full 3-month window) to the last complete hold
const idxAtOrBefore = (day: string[], d: string) => { let lo = 0, hi = day.length; while (lo < hi) { const m = (lo + hi) >> 1; if (day[m] <= d) lo = m + 1; else hi = m; } return lo - 1; };
const minus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
type Ob = { s: string; sig: number; any: number; mdv: number; prior: number; ret: number };
const months: string[] = []; for (let y = 2010; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
type Rec = { m: string; nSell: number; uni: number; topEx: number; anyEx: number; noneEx: number; topLiq: number; topIll: number; topPrior: number; uniPrior: number };
const recs: Rec[] = [];
for (const me of months) {
  if (me < "2010-04-01") continue;
  const obs: Ob[] = [];
  for (const s of uni) {
    const b = bars.get(s); if (!b) continue;
    const i = idxAtOrBefore(b.day, me); if (i < 42 || i + 1 + HOLD >= b.day.length) continue;
    if (b.day[i] < minus(me, 7)) continue;                       // not trading around this month-end
    const e = i + 1, x = e + HOLD; if (!(b.c[e] > 0 && b.c[x] > 0 && b.c[i - 21] > 0)) continue;
    let mdv = 0, n = 0; for (let k = i - 20; k <= i; k++) if (b.dv[k] > 0) { mdv += b.dv[k]; n++; } if (!n) continue; mdv /= n;
    const from = minus(me, WIN); let v = 0; const arr = sells.get(s); if (arr) for (const q of arr) { if (q.d > from && q.d <= me) v += q.v; }
    obs.push({ s, sig: v / (mdv * 21), any: v > 0 ? 1 : 0, mdv, prior: b.c[i] / b.c[i - 21] - 1, ret: b.c[x] / b.c[e] - 1 });
  }
  const withSell = obs.filter((o) => o.any); if (withSell.length < MIN_NAMES || obs.length < 200) continue;
  const u = mean(obs.map((o) => o.ret));
  const sorted = [...withSell].sort((a, b) => a.sig - b.sig); const q = Math.floor(sorted.length / 5); const top = sorted.slice(sorted.length - q);
  const medM = median(obs.map((o) => o.mdv));
  const half = (h: Ob[]) => { const ws = h.filter((o) => o.any).sort((a, b) => a.sig - b.sig); if (ws.length < 20) return NaN; const qq = Math.floor(ws.length / 5); return mean(ws.slice(ws.length - qq).map((o) => o.ret)) - mean(h.map((o) => o.ret)); };
  recs.push({ m: me.slice(0, 7), nSell: withSell.length, uni: u, topEx: mean(top.map((o) => o.ret)) - u, anyEx: mean(withSell.map((o) => o.ret)) - u, noneEx: mean(obs.filter((o) => !o.any).map((o) => o.ret)) - u, topLiq: half(obs.filter((o) => o.mdv >= medM)), topIll: half(obs.filter((o) => o.mdv < medM)), topPrior: mean(top.map((o) => o.prior)), uniPrior: mean(obs.map((o) => o.prior)) });
}
assertNonEmpty("monthly periods", recs, 60);
const col = (f: (r: Rec) => number) => recs.map(f).filter(Number.isFinite);
const line = (name: string, v: number[]) => console.log(`    ${name.padEnd(46)} ${(mean(v) * 100).toFixed(3).padStart(8)}% /mo   ${(mean(v) * 12 * 100).toFixed(2).padStart(7)}%/yr   t ${tstat(v).toFixed(2).padStart(6)}   n ${v.length}`);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "insider-sells", runId: K.RUN_ID, spent: 2 });
console.log(`\n==> INSIDER SELLS, tradable slice (liquid decile, ${WIN}d window, hold ${HOLD}s lag-1). Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    BENCHMARK LAW: every line is an EXCESS vs the same-month decile universe. Pre-registered sign: NEGATIVE.`);
console.log(`    periods ${recs.length} (${recs[0].m}..${recs[recs.length - 1].m})   mean names with a sell/month ${mean(recs.map((r) => r.nSell)).toFixed(0)}`);
line("universe mean", col((r) => r.uni));
line("TOP-quintile sell intensity EXCESS", col((r) => r.topEx));
line("ANY-sell EXCESS", col((r) => r.anyEx));
line("NO-sell EXCESS", col((r) => r.noneEx));
line("TOP-quintile EXCESS, LIQUID half", col((r) => r.topLiq));
line("TOP-quintile EXCESS, ILLIQUID half", col((r) => r.topIll));
console.log(`    control (competing b): TOP-quintile prior-month return ${(mean(col((r) => r.topPrior)) * 100).toFixed(2)}% vs universe ${(mean(col((r) => r.uniPrior)) * 100).toFixed(2)}% — sells follow run-ups if the first is higher`);
const eraLine = (cut: string) => { const a = recs.filter((r) => r.m < cut).map((r) => r.topEx), b = recs.filter((r) => r.m >= cut).map((r) => r.topEx); console.log(`    eras: <${cut} ${(mean(a) * 12 * 100).toFixed(2)}%/yr t ${tstat(a).toFixed(2)} n ${a.length} | >=${cut} ${(mean(b) * 12 * 100).toFixed(2)}%/yr t ${tstat(b).toFixed(2)} n ${b.length}`); };
eraLine("2018-01");
const top = col((r) => r.topEx), t = tstat(top), liq = col((r) => r.topLiq), ill = col((r) => r.topIll);
const sign = mean(top) < 0 ? "NEGATIVE (MATCHED)" : "POSITIVE (MISSED)";
let verdict: string;
if (t <= -2 && mean(liq) < 0 && mean(ill) < 0) verdict = `SUPPORTED in research space (t ${t.toFixed(2)}, both halves negative) — instrument + turnover before anything else`;
else if (t >= 2) verdict = `SIGN MISSED (t ${t.toFixed(2)}) — recorded, not claimable`;
else verdict = `NULL (t ${t.toFixed(2)}; |t| 2.0 at this effect would need ~${Math.ceil(top.length * (2 / Math.max(1e-6, Math.abs(t))) ** 2)} months)`;
console.log(`    sign ${sign}   liquid-half t ${tstat(liq).toFixed(2)}   illiquid-half t ${tstat(ill).toFixed(2)}   any-sell t ${tstat(col((r) => r.anyEx)).toFixed(2)}`);
console.log(`\n  VERDICT: ${verdict}`);
console.log(`  RESULT_JSON ${JSON.stringify({ periods: top.length, topEx: mean(top), t, liqT: tstat(liq), illT: tstat(ill), anyT: tstat(col((r) => r.anyEx)), sign, ceiling: T.ceiling })}`);
