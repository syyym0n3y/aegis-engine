// Current opportunities — what the validated 4-sleeve book (D-932) says to trade NOW, both directions, across the
// global panel. Long/short trend across every placeable instrument + crypto momentum + the live going-concern shorts.
// Operator-facing: grow the wallet one trade at a time, with a systematic entry and exit. Writes docs/OPPORTUNITIES.md.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("opportunities", [{ name: "TOPN", def: "8" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "op", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const CLASSES = ["etf", "sector", "index", "intl_index", "commodity", "fx", "rate", "crypto"];
const meta = (await q(`trd_bars_deep?asset_class=in.(${CLASSES.join(",")})&select=symbol,asset_class,n_bars&order=n_bars.desc`) as { symbol: string; asset_class: string; n_bars: number }[]).filter((m) => m.n_bars > 300);
type Opp = { sym: string; cls: string; dir: string; signal: number; px: number; vol: number; entry: number; target: number; stop: number };
const opps: Opp[] = [];
for (let i = 0; i < meta.length; i += 40) { const page = meta.slice(i, i + 40);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[];
  for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); if (b.length < 260) continue;
    const c = b.map((x) => x[4]); const n = c.length; const px = c[n - 1];
    // TSMOM: blended sign over 21/63/126/252d, strength normalised by trailing vol
    const rets: number[] = []; for (let k = n - 63; k < n; k++) rets.push(Math.log(c[k] / c[k - 1])); const vol = sd(rets) * Math.sqrt(252);
    let sig = 0; for (const L of [21, 63, 126, 252]) sig += Math.sign(c[n - 1] / c[n - 1 - L] - 1); sig /= 4;
    const strength = sig * (c[n - 1] / c[n - 1 - 126] - 1) / (vol || 1); // signed momentum / vol
    if (Math.abs(sig) < 0.5) continue; // require agreement
    const dir = sig > 0 ? "LONG" : "SHORT"; const atr = vol / Math.sqrt(252) * px; // ~daily $ move
    opps.push({ sym: r.symbol, cls: r.asset_class, dir, signal: strength, px, vol: +(vol * 100).toFixed(0), entry: px, target: +(px * (dir === "LONG" ? 1 + 2 * vol / Math.sqrt(252) * Math.sqrt(21) : 1 - 2 * vol / Math.sqrt(252) * Math.sqrt(21))).toFixed(2), stop: +(px * (dir === "LONG" ? 1 - vol / Math.sqrt(252) * Math.sqrt(21) : 1 + vol / Math.sqrt(252) * Math.sqrt(21))).toFixed(2) });
  }
}
const longs = opps.filter((o) => o.dir === "LONG").sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal)).slice(0, +K.TOPN);
const shorts = opps.filter((o) => o.dir === "SHORT").sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal)).slice(0, +K.TOPN);
// live going-concern shorts (recent filings)
const gc = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22substantial+doubt%22+%22going+concern%22&forms=10-K&startdt=2026-06-16&enddt=2026-09-16', { headers: { "User-Agent": "aegis-research (research@aegis.local)" } }).then((r) => r.json()).catch(() => ({}));
const gcN = (gc as { hits?: { total?: { value?: number } } }).hits?.total?.value ?? 0;
const fmt = (o: Opp) => `| ${o.sym} | ${o.cls} | ${o.dir} | ${o.signal.toFixed(2)} | ${o.px} | ${o.vol}% | ${o.target} | ${o.stop} |`;
const today = new Date().toISOString().slice(0, 10);
const md = `# Current opportunities — ${today}

> What the validated 4-sleeve book (D-932, Sharpe 1.60) says to trade NOW, both directions, across the global panel.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target/stop are volatility-scaled (2σ/1σ over ~21 trading days).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | vol | profit-target | stop |
|---|---|---|---|---|---|---|---|
${longs.map(fmt).join("\n")}

## SHORT (trend down)
| symbol | class | dir | signal | px | vol | profit-target | stop |
|---|---|---|---|---|---|---|---|
${shorts.map(fmt).join("\n")}

## SHORT — going-concern distress (the persistent edge, D-930/931)
${gcN} going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run \`goingconcern-borrow.ts\` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the volatility-scaled profit-target and stop above.
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the 4-sleeve book's edge is diversification.
`;
await Deno.writeTextFile(new URL("../docs/OPPORTUNITIES.md", import.meta.url), md);
console.log(`==> OPPORTUNITIES — ${longs.length} longs, ${shorts.length} shorts across ${opps.length} trending instruments; ${gcN} live going-concern shorts. Wrote docs/OPPORTUNITIES.md`);
console.log(`\n  TOP LONGS:  ${longs.slice(0,5).map((o)=>`${o.sym}(${o.signal.toFixed(1)})`).join(" ")}`);
console.log(`  TOP SHORTS: ${shorts.slice(0,5).map((o)=>`${o.sym}(${o.signal.toFixed(1)})`).join(" ")}`);
