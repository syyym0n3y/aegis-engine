#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// market-context.ts (D-976) — THE REGIME TAPE. Every forward clock records a number; none recorded WHAT THE MARKET
// WAS DOING when it recorded it. That gap is not cosmetic: D-944/945 established that each sleeve is
// regime-SPECIALISED and that 2021 was pathological, so a forward Sharpe read without its regime is uninterpretable
// -- a clock that matures in one environment tells you nothing about the next unless you know which it ran through.
//
// DESIGN. Rather than stamping context into each mark's note (which would only help marks made from today, and
// would need every one of the several mark-writers changed), this computes a daily CONTEXT TIME SERIES that any
// clock, scorer or session can join BY DATE -- including retroactively, so the marks already on record gain context
// too. Stored as ctx_* scalars in trd_macro_series, the table that exists for exactly this shape (series, d, v), so
// there is NO schema change. Everything is derived from data already held: keyless, free, no new dependency.
//
// HONEST LIMITS, stated in the output: breadth is a bounded LIQUID SAMPLE (not the full 19.5k universe) and says so;
// every series is as-of the daily close, so intraday regime shifts are invisible at this resolution.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("market-context", [
  { name: "BREADTH_N", def: "400", note: "liquid sample size for breadth (bounded: the full universe is 19.5k symbols)" },
  { name: "BACKFILL_D", def: "4000", note: "days of history to compute (existing clock marks gain context retroactively)" },
  { name: "WRITE", def: "1", note: "0 = compute and print only, write nothing" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t };
const { q } = mkStrictRead(OWNED, hdr);
type Bar = [number, number, number, number, number, number];
const closes = (bars: Bar[]) => bars.filter((b) => b && b[4] > 0).sort((a, b) => a[0] - b[0]);
const dstr = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const sma = (a: number[], n: number, i: number) => { if (i + 1 < n) return null; let s = 0; for (let k = i + 1 - n; k <= i; k++) s += a[k]; return s / n; };

// --- 1. the index tape: trend, realized vol, drawdown (SPY) + crypto trend (BTC) ---
const one = async (sym: string) => { const r = await q(`trd_bars_deep?symbol=eq.${sym}&select=bars&limit=1`) as { bars: Bar[] }[]; return r[0]?.bars ? closes(r[0].bars) : []; };
const spy = await one("SPY"); assertNonEmpty("SPY bars", spy, 300);
const btc = await one("BTC-USD");
const ctx = new Map<string, Map<string, number>>();   // series -> day -> value
const put = (s: string, d: string, v: number) => { if (!isFinite(v)) return; (ctx.get(s) ?? ctx.set(s, new Map()).get(s)!).set(d, +v.toFixed(4)); };
const build = (bars: Bar[], prefix: string) => {
  const c = bars.map((b) => b[4]); const start = Math.max(252, c.length - +K.BACKFILL_D);
  for (let i = start; i < c.length; i++) {
    const d = dstr(bars[i][0]);
    const ma200 = sma(c, 200, i); if (ma200) put(`ctx_${prefix}_vs200_pct`, d, 100 * (c[i] / ma200 - 1));
    let s = 0, n = 0; for (let k = Math.max(1, i - 19); k <= i; k++) { s += Math.log(c[k] / c[k - 1]) ** 2; n++; }
    if (n > 5) put(`ctx_${prefix}_rvol20_pct`, d, 100 * Math.sqrt(252 * s / n));
    const hi = Math.max(...c.slice(Math.max(0, i - 251), i + 1)); put(`ctx_${prefix}_dd1y_pct`, d, 100 * (c[i] / hi - 1));
  }
};
build(spy, "spy"); if (btc.length > 300) build(btc, "btc");

// --- 2. breadth: share of a bounded LIQUID sample above its own 50d MA (stated as a sample, not the universe) ---
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars&order=n_bars.desc&limit=${K.BREADTH_N}`) as { symbol: string; n_bars: number }[]);
const above = new Map<string, { a: number; n: number }>();
for (let i = 0; i < meta.length; i += 40) {
  const page = meta.slice(i, i + 40);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,bars`) as { symbol: string; bars: Bar[] }[];
  for (const r of rows) { const b = closes(r.bars ?? []); if (b.length < 300) continue; const c = b.map((x) => x[4]);
    for (let j = Math.max(50, c.length - 400); j < c.length; j++) { const m = sma(c, 50, j); if (!m) continue; const d = dstr(b[j][0]);
      const e = above.get(d) ?? { a: 0, n: 0 }; e.n++; if (c[j] > m) e.a++; above.set(d, e); } }
}
for (const [d, e] of above) if (e.n >= 50) put("ctx_breadth_above50_pct", d, 100 * e.a / e.n);

// --- 3. write (upsert; the table is (series,d,v) scalars — no schema change) ---
const rows: { series: string; d: string; v: number }[] = [];
for (const [s, m] of ctx) for (const [d, v] of m) rows.push({ series: s, d, v });
assertNonEmpty("context rows", rows, 500);
const today = new Date().toISOString().slice(0, 10);
const latest = (s: string) => { const m = ctx.get(s); if (!m) return null; const k = [...m.keys()].sort(); return k.length ? { d: k[k.length - 1], v: m.get(k[k.length - 1])! } : null; };
console.log(`\n==> D-976 MARKET CONTEXT — ${rows.length} rows across ${ctx.size} series (breadth from a ${meta.length}-name LIQUID SAMPLE, not the 19.5k universe)`);
for (const s of [...ctx.keys()].sort()) { const l = latest(s); if (l) console.log(`  ${s.padEnd(28)} ${String(l.v).padStart(9)}   (as of ${l.d})`); }
if (K.WRITE !== "1") { console.log("  WRITE=0 — nothing written."); Deno.exit(0); }
for (let i = 0; i < rows.length; i += 2000) {
  const chunk = rows.slice(i, i + 2000);
  const res = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) }); // plumbing-ok: audited — status checked next line
  if (!res.ok) { console.error(`!! write FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`); Deno.exit(1); }
}
const back = await q(`trd_macro_series?series=eq.ctx_spy_vs200_pct&order=d.desc&limit=1`) as { d: string; v: number }[];
if (!back.length) { console.error("!! read-back FAILED — context not persisted"); Deno.exit(1); }
console.log(`  written + read back: ctx_spy_vs200_pct latest ${back[0].d} = ${back[0].v}`);
console.log(`  Clocks join this BY DATE, so marks already on record gain context retroactively. Daily close resolution: intraday shifts are invisible here, by construction.`);
