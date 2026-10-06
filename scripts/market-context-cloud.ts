#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// market-context-cloud.ts (D-977) — the regime tape, COMPUTED WITHOUT THE NODE so it can run anywhere.
//
// WHY. market-context.ts (D-976) derives the regime from the owned 10GB Postgres, so it only runs while the
// operator's iMac is awake — and that machine sleeps, reboots, and was off for whole days in the last fortnight.
// The result was a regime tape with HOLES over exactly the periods a forward clock most needs explaining.
// This computes the same shape from KEYLESS public endpoints only (Yahoo chart API), with NO database, NO secrets
// and NO local state, so a free GitHub Actions runner can keep the tape unbroken while the Mac is off. The local
// node remains authoritative and richer (full-universe breadth); this is the gap-filler, and it is labelled as one.
//
// Writes docs/market-context-cloud.json (machine) + docs/MARKET_CONTEXT.md (human) — both under docs/ because
// data/ is gitignored and a cloud runner must be able to COMMIT what it produces. Idempotent per day.
const SYMS: Record<string, string> = { spy: "SPY", btc: "BTC-USD", qqq: "QQQ", vix: "^VIX" };
const BREADTH = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","JPM","XOM","JNJ","PG","KO","PFE","CSCO","INTC","WMT","CVX","MRK","ABBV","BAC","T","HD","MCD","UNH","CAT","GS","IBM","BA","MMM","NKE","DIS"];
const chart = async (sym: string, range = "2y") => {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (aegis-research)" } });
  if (!r.ok) return null;
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) return null;
  const ts: number[] = res.timestamp ?? []; const c: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
  const out: { d: string; c: number }[] = [];
  for (let i = 0; i < ts.length; i++) if (c[i] != null && c[i]! > 0) out.push({ d: new Date(ts[i] * 1000).toISOString().slice(0, 10), c: c[i]! });
  return out.length ? out : null;
};
const sma = (a: number[], n: number) => a.length < n ? null : a.slice(-n).reduce((s, x) => s + x, 0) / n;
const ctx: Record<string, number | null> = {}; const asOf: Record<string, string> = {};
for (const [k, sym] of Object.entries(SYMS)) {
  const b = await chart(sym); if (!b) { ctx[`${k}_vs200_pct`] = null; continue; }
  const c = b.map((x) => x.c); const last = c[c.length - 1]; asOf[k] = b[b.length - 1].d;
  const m200 = sma(c, 200); ctx[`${k}_vs200_pct`] = m200 ? +(100 * (last / m200 - 1)).toFixed(4) : null;
  let s = 0, n = 0; for (let i = Math.max(1, c.length - 20); i < c.length; i++) { s += Math.log(c[i] / c[i - 1]) ** 2; n++; }
  ctx[`${k}_rvol20_pct`] = n > 5 ? +(100 * Math.sqrt(252 * s / n)).toFixed(4) : null;
  const hi = Math.max(...c.slice(-252)); ctx[`${k}_dd1y_pct`] = +(100 * (last / hi - 1)).toFixed(4);
  ctx[`${k}_last`] = +last.toFixed(4);
  await new Promise((r) => setTimeout(r, 400));   // sequential + paced: one public host, no key, no hammering
}
let above = 0, tot = 0;
for (const s of BREADTH) { const b = await chart(s, "1y"); await new Promise((r) => setTimeout(r, 300)); if (!b) continue;
  const c = b.map((x) => x.c); const m = sma(c, 50); if (!m) continue; tot++; if (c[c.length - 1] > m) above++; }
ctx["breadth_above50_pct"] = tot >= 15 ? +(100 * above / tot).toFixed(2) : null;   // positive control: refuse a thin sample
const stamp = new Date().toISOString();
if (ctx["spy_vs200_pct"] === null || ctx["breadth_above50_pct"] === null) { console.error("!! POSITIVE CONTROL FAILED: SPY or breadth unavailable — refusing to write a hollow tape."); Deno.exit(1); }
const payload = { written: stamp, source: "yahoo chart api (keyless, public)", breadth_sample: tot, note: "CLOUD gap-filler: no database, no secrets. The owned node's market-context.ts is authoritative and uses full-universe breadth; this keeps the tape unbroken while that machine is off.", asOf, ctx };
await Deno.writeTextFile(new URL("../docs/market-context-cloud.json", import.meta.url).pathname, JSON.stringify(payload, null, 1));
const L = [`# MARKET CONTEXT — cloud tape (keyless)\n`, `> Written ${stamp} from Yahoo's public chart API. **No database, no secrets, no local state** — this runs on a free`, `> GitHub Actions runner so the regime tape has no holes while the operator's machine is asleep. The owned node's`, `> \`market-context.ts\` stays authoritative (full-universe breadth); this is the gap-filler.\n`, `| metric | value | as of |`, `|---|---|---|`];
for (const [k, v] of Object.entries(ctx)) if (v !== null) L.push(`| ${k} | ${v} | ${asOf[k.split("_")[0]] ?? "—"} |`);
L.push(`\n> Breadth from a fixed ${tot}-name large-cap sample (stated, not the full universe). Daily-close resolution.`);
await Deno.writeTextFile(new URL("../docs/MARKET_CONTEXT.md", import.meta.url).pathname, L.join("\n") + "\n");
console.log(`==> D-977 CLOUD CONTEXT — spy vs200 ${ctx["spy_vs200_pct"]}% · rvol ${ctx["spy_rvol20_pct"]}% · dd ${ctx["spy_dd1y_pct"]}% · breadth ${ctx["breadth_above50_pct"]}% (${tot} names) · vix ${ctx["vix_last"] ?? "n/a"}`);
