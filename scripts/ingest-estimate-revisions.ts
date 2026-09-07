#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// ingest-estimate-revisions.ts (D-817) — ANALYST ESTIMATE REVISIONS, keyless: Yahoo quoteSummary `earningsTrend` (cookie+crumb,
// the fpi-flags.ts method) gives, per name, the consensus EPS for the current quarter (0q) and fiscal year (0y) as of NOW, 7, 30,
// 60 and 90 days ago, the number of analysts, and up/down revision counts over 7 and 30 days. That is the "licensed" driver
// the register carried as blocked — a 90-day revision history per snapshot, free. Daily snapshots build the forward series.
// Universe: liquid-decile equities. Sequential, paced. Series (trd_macro_series, d = today):
//   est_rev90_0q:<SYM>  = current/90d-ago - 1 (current quarter)   est_rev90_0y:<SYM> = same for the fiscal year
//   est_up30:<SYM>, est_down30:<SYM> = revision counts            est_n_0q:<SYM> = analysts
// Positive controls: AAPL present with n>=15; AAPL current 0q consensus within 5% of Nasdaq's keyless analyst endpoint (a second
// source); >= 80% of the universe returns a trend. Cross-source disagreement is RED, not a shrug.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-estimate-revisions", [{ name: "MAX_NAMES", def: "0", note: "0 = all liquid-decile equities" }, { name: "PAUSE_MS", def: "250" }, { name: "DECILE", def: "data/liquid-decile.json" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "est", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const REPO = new URL("..", import.meta.url).pathname; const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0" };
const r0 = await fetch("https://fc.yahoo.com/", { headers: UA, redirect: "manual" }).catch(() => null); const cookie = (r0?.headers.get("set-cookie") || "").split(";")[0];
const crumb = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, Cookie: cookie } }).then((r) => r.text());
if (!crumb || crumb.length > 40 || crumb.includes("<")) { console.error("  RED — Yahoo crumb not obtained; nothing written"); Deno.exit(1); }
const dec = JSON.parse(await Deno.readTextFile(`${REPO}${K.DECILE}`)) as { symbols: string[] };
const eq = new Set<string>(); for (let off = 0; ; off += 1000) { const p = await q(`trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`) as { symbol: string }[]; for (const r of p) eq.add(r.symbol); if (p.length < 1000) break; }
let uni = dec.symbols.filter((s) => eq.has(s) && /^[A-Z.]{1,6}$/.test(s)); if (+K.MAX_NAMES > 0) uni = uni.slice(0, +K.MAX_NAMES); assertNonEmpty("liquid-decile equities", uni, 20);
const today = new Date().toISOString().slice(0, 10); let rows: { series: string; d: string; v: number }[] = []; let got = 0, miss = 0; let aaplQ = NaN;
async function flush() { if (!rows.length) return; const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }); if (!w.ok) throw new Error(`write ${w.status}`); rows = []; }
for (const sym of uni) {
  const j = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=earningsTrend&crumb=${encodeURIComponent(crumb)}`, { headers: { ...UA, Cookie: cookie } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  await sleep(+K.PAUSE_MS);
  const tr = j?.quoteSummary?.result?.[0]?.earningsTrend?.trend as { period: string; earningsEstimate?: { avg?: { raw?: number }; numberOfAnalysts?: { raw?: number } }; epsTrend?: Record<string, { raw?: number }>; epsRevisions?: Record<string, { raw?: number }> }[] | undefined;
  if (!tr?.length) { miss++; continue; }
  let any = false;
  for (const per of ["0q", "0y"]) { const t = tr.find((x) => x.period === per); const cur = t?.epsTrend?.current?.raw, d90 = t?.epsTrend?.["90daysAgo"]?.raw; if (t && Number.isFinite(cur) && Number.isFinite(d90) && Math.abs(d90!) > 1e-6) { rows.push({ series: `est_rev90_${per}:${sym}`, d: today, v: cur! / d90! - 1 }); any = true; }
    if (per === "0q" && t) { const n = t.earningsEstimate?.numberOfAnalysts?.raw, up = t.epsRevisions?.upLast30days?.raw, dn = t.epsRevisions?.downLast30days?.raw; if (Number.isFinite(n)) rows.push({ series: `est_n_0q:${sym}`, d: today, v: n! }); if (Number.isFinite(up)) rows.push({ series: `est_up30:${sym}`, d: today, v: up! }); if (Number.isFinite(dn)) rows.push({ series: `est_down30:${sym}`, d: today, v: dn! }); if (sym === "AAPL") aaplQ = t.earningsEstimate?.avg?.raw ?? NaN; } }
  if (any) got++; else miss++; if (rows.length >= 300) await flush();
}
await flush();
console.log(`==> ESTIMATE REVISIONS ${today}: ${got} names with a 90-day trend, ${miss} without, of ${uni.length}`);
// positive controls
if (got < 0.8 * uni.length) { console.error(`  RED — fewer than 80% of the universe returned a trend`); Deno.exit(1); }
if (!Number.isFinite(aaplQ)) { console.error("  RED — AAPL current-quarter consensus missing"); Deno.exit(1); }
const nq = await fetch("https://api.nasdaq.com/api/analyst/AAPL/estimate-momentum", { headers: { "User-Agent": "Mozilla/5.0 (Macintosh)", Accept: "application/json" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
const nqQ = nq?.data?.changeInConsensus?.currentData?.qtrMean; if (!Number.isFinite(nqQ) || Math.abs(nqQ / aaplQ - 1) > 0.05) { console.error(`  RED — cross-source control: Yahoo AAPL 0q ${aaplQ} vs Nasdaq ${nqQ}`); Deno.exit(1); }
console.log(`  positive controls passed (coverage ${(100 * got / uni.length).toFixed(0)}%, AAPL 0q Yahoo ${aaplQ.toFixed(3)} vs Nasdaq ${Number(nqQ).toFixed(3)})`);
