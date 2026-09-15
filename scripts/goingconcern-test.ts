// D-930 — going-concern (EDGAR full-text) as a distress signal. Closes the W4 coverage gap.
// Fetch 10-K filings with 'substantial doubt' + 'going concern' via efts.sec.gov, map to our panel, test forward
// UNDERPERFORMANCE with BENCHMARK LAW (excess vs small-cap universe) + LIQUIDITY LAW (liquid vs illiquid tercile).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("goingconcern-test", [
  { name: "FROM_Y", def: "2016" }, { name: "TO_Y", def: "2023" }, { name: "UA", def: "aegis-research (research@aegis.local)" }, { name: "RUN_ID", def: "D-930-goingconcern-edgar" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
const SEC_UA = { "User-Agent": K.UA };
// 1) CIK -> ticker map
const ctRaw = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_UA }).then((r) => r.json());
const cikTicker = new Map<string, string>(); for (const k in ctRaw) { const o = ctRaw[k]; cikTicker.set(String(o.cik_str).padStart(10, "0"), String(o.ticker).toUpperCase()); }
console.log(`CIK->ticker map: ${cikTicker.size}`);
// 2) efts full-text search, going-concern 10-K, by quarter, paginated
const QS = ["01-01","04-01","07-01","10-01"]; const QE = ["03-31","06-30","09-30","12-31"];
type Hit = { ticker: string; date: string };
const hits: Hit[] = [];
for (let y = +K.FROM_Y; y <= +K.TO_Y; y++) for (let qi = 0; qi < 4; qi++) {
  const sdt = `${y}-${QS[qi]}`, edt = `${y}-${QE[qi]}`;
  for (let from = 0; from < 300; from += 100) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22substantial+doubt%22+%22going+concern%22&forms=10-K&startdt=${sdt}&enddt=${edt}&from=${from}`;
    const j = await fetch(url, { headers: SEC_UA }).then((r) => r.json()).catch(() => ({} as Record<string, never>));
    const hh = (j as { hits?: { hits?: { _source?: { ciks?: string[]; file_date?: string } }[]; total?: { value?: number } } }).hits;
    const arr = hh?.hits ?? []; if (!arr.length) break;
    for (const x of arr) { const cik = String(x._source?.ciks?.[0] ?? "").padStart(10, "0"); const t = cikTicker.get(cik); const d = x._source?.file_date; if (t && d) hits.push({ ticker: t, date: d }); }
    if ((hh?.total?.value ?? 0) <= from + 100) break;
  }
}
console.log(`going-concern 10-K hits with a mapped ticker: ${hits.length} (${new Set(hits.map(h=>h.ticker)).size} unique tickers)`);
assertNonEmpty("mapped hits", hits, 100);
// 3) load benchmark + matched panel tickers
async function bars(sym: string) { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); }
const iwm = await bars("IWM"); const iwmC = new Map<number, number>(); for (const b of iwm) iwmC.set(Math.floor(b[0] / 86400), b[4]);
const iwmFwd = (d: number, h: number) => { let a = d; for (let k = 0; k < 6 && !iwmC.has(a); k++) a++; let f = d + h; for (let k = 0; k < 6 && !iwmC.has(f); k++) f++; const p0 = iwmC.get(a), p1 = iwmC.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
const meta = new Set((await q(`trd_bars_deep?asset_class=eq.equity&select=symbol`) as { symbol: string }[]).map((r) => r.symbol.toUpperCase()));
const wanted = [...new Set(hits.filter((h) => meta.has(h.ticker)).map((h) => h.ticker))];
console.log(`going-concern tickers present in our equity panel: ${wanted.length}`);
assertNonEmpty("panel-matched tickers", wanted, 30);
const px = new Map<string, Map<number, number>>(); const vol = new Map<string, number>();
for (const t of wanted) { const b = await bars(t); if (b.length < 100) continue; const m = new Map<number, number>(); let vs = 0; for (const x of b) { m.set(Math.floor(x[0] / 86400), x[4]); vs += x[4] * x[5]; } px.set(t, m); vol.set(t, vs / b.length); }
// 4) per filing: forward excess vs IWM at 21/63/126d
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const volMed = [...vol.values()].sort((a, b) => a - b)[Math.floor(vol.size / 2)];
type Row = { t: string; liq: boolean; e21: number|null; e63: number|null; e126: number|null };
const rows: Row[] = [];
for (const h of hits) { const m = px.get(h.ticker); if (!m) continue; const d = Math.floor(Date.parse(h.date + "T00:00:00Z") / 86400000);
  const fwd = (hh: number) => { let a = d; for (let k = 0; k < 6 && !m.has(a); k++) a++; let f = d + hh; for (let k = 0; k < 6 && !m.has(f); k++) f++; const p0 = m.get(a), p1 = m.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
  const ex = (r: number|null, hh: number) => { if (r === null) return null; const bm = iwmFwd(d, hh); return bm === null ? null : r - bm; };
  rows.push({ t: h.ticker, liq: (vol.get(h.ticker) ?? 0) >= volMed, e21: ex(fwd(21),21), e63: ex(fwd(63),63), e126: ex(fwd(126),126) });
}
function rep(sub: Row[], key: "e21"|"e63"|"e126") { const a = sub.map((r) => r[key]).filter((x): x is number => x !== null); return { n: a.length, meanPct: mean(a) * 100, t: tstat(a) }; }
console.log(`\n==> D-930 GOING-CONCERN (EDGAR) — ${rows.length} filing-events, ${wanted.length} names; excess vs IWM (small-cap); ceiling ${ceil.ceiling.toFixed(2)}\n`);
console.log(`  ${"cohort".padEnd(16)} ${"h".padStart(4)} ${"n".padStart(5)} ${"fwd excess %".padStart(12)} ${"name-t".padStart(7)}`);
for (const [nm, sub] of [["ALL", rows], ["LIQUID half", rows.filter(r=>r.liq)], ["ILLIQUID half", rows.filter(r=>!r.liq)]] as [string, Row[]][])
  for (const h of ["e21","e63","e126"] as const) { const r = rep(sub, h); const hd = {e21:21,e63:63,e126:126}[h]; console.log(`  ${nm.padEnd(16)} ${String(hd).padStart(4)} ${String(r.n).padStart(5)} ${r.meanPct.toFixed(2).padStart(12)} ${r.t.toFixed(2).padStart(7)}`); }
// name-clustered: one observation per ticker (avg 126d excess), then t across names — kills within-name correlation
const byName = new Map<string, number[]>(); for (const r of rows) if (r.e126 !== null) (byName.get(r.t) ?? byName.set(r.t, []).get(r.t)!).push(r.e126);
const nameAvgAll = [...byName.values()].map(mean); const nameAvgLiq = [...byName.entries()].filter(([k]) => (vol.get(k) ?? 0) >= volMed).map(([, v]) => mean(v));
console.log(`  NAME-CLUSTERED 126d: ALL ${(mean(nameAvgAll)*100).toFixed(1)}% t ${tstat(nameAvgAll).toFixed(2)} over ${nameAvgAll.length} names; LIQUID ${(mean(nameAvgLiq)*100).toFixed(1)}% t ${tstat(nameAvgLiq).toFixed(2)} over ${nameAvgLiq.length} names`);
await spendTrials({ rest: OWNED, headers: hdr, family: "goingconcern", runId: K.RUN_ID, spent: 6 });
// D-931: dump the liquid going-concern names (per-name avg 126d excess + $vol) for the borrow-cost measurement
const dumpRows = [...byName.entries()].map(([sym, v]) => ({ sym, avg_excess_126d: +mean(v).toFixed(4), n: v.length, dollar_vol: Math.round(vol.get(sym) ?? 0), liquid: (vol.get(sym) ?? 0) >= volMed }));
await Deno.writeTextFile(new URL("../data/d930-liquid-names.json", import.meta.url), JSON.stringify(dumpRows.filter(r => r.liquid), null, 0));
console.log(`  dumped ${dumpRows.filter(r=>r.liquid).length} liquid names -> data/d930-liquid-names.json`);
console.log(`\n  READ: negative fwd-excess with |name-t| past ${ceil.ceiling.toFixed(2)} = distress underperformance. Deployable SHORT only if the LIQUID half clears it; else capacity-bound (illiquid-only) = untradeable, at most an AVOID filter.`);
