// D-935 — late-filing (NT 10-K / NT 10-Q) distress short. Extends D-930 going-concern to an earlier distress event.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("latefiling-test", [{ name: "FROM_Y", def: "2016" }, { name: "TO_Y", def: "2024" }, { name: "UA", def: "aegis-research (research@aegis.local)" }, { name: "RUN_ID", def: "D-935-latefiling-distress-short" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
const UA = { "User-Agent": K.UA };
const ct = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA }).then((r) => r.json());
const cikT = new Map<string, string>(); for (const k in ct) cikT.set(String(ct[k].cik_str).padStart(10, "0"), String(ct[k].ticker).toUpperCase());
const QS = ["01-01", "04-01", "07-01", "10-01"], QE = ["03-31", "06-30", "09-30", "12-31"];
type Hit = { ticker: string; date: string };
const hits: Hit[] = [];
for (let y = +K.FROM_Y; y <= +K.TO_Y; y++) for (let qi = 0; qi < 4; qi++) for (const form of ["NT+10-K", "NT+10-Q"]) {
  for (let from = 0; from < 200; from += 100) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=&forms=${form}&startdt=${y}-${QS[qi]}&enddt=${y}-${QE[qi]}&from=${from}`;
    const j = await fetch(url, { headers: UA }).then((r) => r.json()).catch(() => ({} as Record<string, never>));
    const arr = (j as { hits?: { hits?: { _source?: { ciks?: string[]; file_date?: string } }[]; total?: { value?: number } } }).hits?.hits ?? []; if (!arr.length) break;
    for (const x of arr) { const cik = String(x._source?.ciks?.[0] ?? "").padStart(10, "0"); const t = cikT.get(cik); const d = x._source?.file_date; if (t && d) hits.push({ ticker: t, date: d }); }
    if (((j as { hits?: { total?: { value?: number } } }).hits?.total?.value ?? 0) <= from + 100) break;
  }
}
console.log(`NT late-filing hits with a mapped ticker: ${hits.length} (${new Set(hits.map((h) => h.ticker)).size} unique)`);
assertNonEmpty("mapped hits", hits, 100);
async function bars(sym: string) { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); }
const iwm = await bars("IWM"); const iwmC = new Map<number, number>(); for (const b of iwm) iwmC.set(Math.floor(b[0] / 86400), b[4]);
const iwmFwd = (d: number, h: number) => { let a = d; for (let k = 0; k < 6 && !iwmC.has(a); k++) a++; let f = d + h; for (let k = 0; k < 6 && !iwmC.has(f); k++) f++; const p0 = iwmC.get(a), p1 = iwmC.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
const panel = new Set((await q(`trd_bars_deep?asset_class=eq.equity&select=symbol`) as { symbol: string }[]).map((r) => r.symbol.toUpperCase()));
const wanted = [...new Set(hits.filter((h) => panel.has(h.ticker)).map((h) => h.ticker))];
assertNonEmpty("panel-matched", wanted, 30);
const px = new Map<string, Map<number, number>>(); const vol = new Map<string, number>();
for (const tk of wanted) { const b = await bars(tk); if (b.length < 100) continue; const m = new Map<number, number>(); let vs = 0; for (const x of b) { m.set(Math.floor(x[0] / 86400), x[4]); vs += x[4] * x[5]; } px.set(tk, m); vol.set(tk, vs / b.length); }
const volMed = [...vol.values()].sort((a, b) => a - b)[Math.floor(vol.size / 2)];
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const byName126 = new Map<string, number[]>(); const byNameLiq = new Map<string, boolean>();
let liqEx: number[] = [], illEx: number[] = [];
for (const h of hits) { const m = px.get(h.ticker); if (!m) continue; const d = Math.floor(Date.parse(h.date + "T00:00:00Z") / 86400000);
  const fwd = (hh: number) => { let a = d; for (let k = 0; k < 6 && !m.has(a); k++) a++; let f = d + hh; for (let k = 0; k < 6 && !m.has(f); k++) f++; const p0 = m.get(a), p1 = m.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
  const r = fwd(126); const bm = iwmFwd(d, 126); if (r === null || bm === null) continue; const ex = r - bm;
  (byName126.get(h.ticker) ?? byName126.set(h.ticker, []).get(h.ticker)!).push(ex);
  const liq = (vol.get(h.ticker) ?? 0) >= volMed; byNameLiq.set(h.ticker, liq); (liq ? liqEx : illEx).push(ex);
}
const nameAvg = [...byName126.values()].map(mean);
const nameAvgLiq = [...byName126.entries()].filter(([k]) => byNameLiq.get(k)).map(([, v]) => mean(v));
const nameAvgIll = [...byName126.entries()].filter(([k]) => !byNameLiq.get(k)).map(([, v]) => mean(v));
// overlap with going-concern liquid names
let gcOverlap = 0, gcSet = new Set<string>();
try { gcSet = new Set((JSON.parse(await Deno.readTextFile(new URL("../data/d930-liquid-names.json", import.meta.url))) as { sym: string }[]).map((x) => x.sym)); gcOverlap = wanted.filter((t) => gcSet.has(t)).length; } catch { /* */ }
console.log(`\n==> D-935 LATE-FILING (NT 10-K/10-Q) DISTRESS — ${wanted.length} panel names, ceiling ${ceil.ceiling.toFixed(2)}\n`);
console.log(`  126d forward EXCESS vs IWM (name-clustered):`);
console.log(`    ALL:      ${(mean(nameAvg)*100).toFixed(1)}%  t ${tstat(nameAvg).toFixed(2)}  (${nameAvg.length} names)`);
console.log(`    LIQUID:   ${(mean(nameAvgLiq)*100).toFixed(1)}%  t ${tstat(nameAvgLiq).toFixed(2)}  (${nameAvgLiq.length})`);
console.log(`    ILLIQUID: ${(mean(nameAvgIll)*100).toFixed(1)}%  t ${tstat(nameAvgIll).toFixed(2)}  (${nameAvgIll.length})`);
console.log(`  OVERLAP with going-concern liquid names: ${gcOverlap}/${wanted.length} (${(100*gcOverlap/wanted.length).toFixed(0)}%) -> ${gcOverlap/wanted.length < 0.6 ? "ADDITIVE population" : "REDUNDANT with going-concern"}`);
await spendTrials({ rest: OWNED, headers: hdr, family: "latefiling", runId: K.RUN_ID, spent: 3 });
console.log(`\n  READ: significant-negative liquid excess past the ceiling + <60% overlap = an additive/earlier distress sleeve; else weaker or redundant.`);
