#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// fpi-liquid-impact.ts (D-747b) — how much of the LIQUID universe does the ADR defect actually touch?
//
// The question this answers is not "how many FPIs exist" but "how many of them are inside the universe the value
// and payout specs actually trade". The factory's equity panel keeps names above $10M average daily dollar volume
// (DV_MIN); a contaminated market cap on a name outside that filter changes no reported number. So the impact
// figure is FPI names inside the liquid set — and, separately, inside the top 1,000 by dollar volume.
import { loadFpiFlags } from "../supabase/functions/_shared/fpi-adr.ts";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fli", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const DV_MIN = 1e7;

const fpi = await loadFpiFlags();
if (!fpi.loaded) { console.error("data/fpi-flags.json missing — run scripts/fpi-flags.ts"); Deno.exit(1); }

const syms: { symbol: string }[] = [];
for (let off = 0;; off += 1000) {
  const p = await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()).catch(() => []);
  if (!Array.isArray(p) || !p.length) break;
  syms.push(...p); if (p.length < 1000) break;
}
const dv: { sym: string; dv: number }[] = [];
for (let i = 0; i < syms.length; i += 40) {
  const part = syms.slice(i, i + 40).map((m) => `"${m.symbol}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string; bars: number[][] }[];
  if (!Array.isArray(rows)) continue;
  for (const r of rows) {
    const b = r.bars; if (!b?.length) continue;
    let s = 0, n = 0;
    for (let k = Math.max(0, b.length - 21); k < b.length; k++) if (b[k][4] > 0 && b[k][5] > 0) { s += b[k][4] * b[k][5]; n++; }
    if (n) dv.push({ sym: r.symbol, dv: s / n });
  }
}
dv.sort((a, b) => b.dv - a.dv);
const isFpi = (s: string) => fpi.ratio.has(s) || fpi.exclude.has(s);
const top1000 = dv.slice(0, 1000);
const liquid = dv.filter((r) => r.dv >= DV_MIN);
const cnt = (a: typeof dv) => ({
  fpi: a.filter((r) => isFpi(r.sym)).length,
  corrected: a.filter((r) => fpi.ratio.has(r.sym)).length,
  excluded: a.filter((r) => fpi.exclude.has(r.sym)).length,
});
const t = cnt(top1000), l = cnt(liquid), a = cnt(dv);
console.log(`universe with bars+volume: ${dv.length.toLocaleString()} names`);
console.log(`  ALL          FPI ${a.fpi}  (corrected ${a.corrected}, excluded ${a.excluded})`);
console.log(`  liquid >=$${(DV_MIN / 1e6).toFixed(0)}M/d (${liquid.length.toLocaleString()} names)  FPI ${l.fpi}  (corrected ${l.corrected}, excluded ${l.excluded})`);
console.log(`  top-1000 by dollar volume            FPI ${t.fpi}  (corrected ${t.corrected}, excluded ${t.excluded})`);
console.log(`\n  the 25 largest-turnover FPIs in the top 1000:`);
for (const r of top1000.filter((x) => isFpi(x.sym)).slice(0, 25)) {
  console.log(`    ${r.sym.padEnd(8)} $${(r.dv / 1e6).toFixed(0)}M/d   ${fpi.ratio.has(r.sym) ? `ratio ${fpi.ratio.get(r.sym)} (CORRECTED)` : "no ratio (EXCLUDED, mc=null)"}`);
}
