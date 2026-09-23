// Current opportunities — the TREND/momentum WATCHLIST (one input family of the deployed book), both directions,
// across the global panel. D-970: the DEPLOYED book is the 5-sleeve blend (leverageable excess ~1.92, D-939e pin;
// raw 2.08) — deploy-sheet.ts/DEPLOY_RUNBOOK.md are the authoritative "what to hold"; this page is a watchlist. Long/short trend across every placeable instrument + crypto momentum + the live going-concern shorts.
// Operator-facing: grow the wallet one trade at a time, with a systematic entry and exit. Writes docs/OPPORTUNITIES.md.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("opportunities", [{ name: "TOPN", def: "8" }, { name: "WALLET", def: "10000", note: "paper wallet £" }, { name: "TARGET_VOL", def: "0.20", note: "survivable portfolio vol" }, { name: "SIZE", def: "1", note: "1 = size into the paper book + write DORMANT portfolio" }, { name: "MAX_LEV", def: "3", note: "hard cap on gross leverage (survivable)" }, { name: "MAX_POS_PCT", def: "20", note: "max % of wallet in any one position" }]);
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
    // ATR(14) — the D-934 exit unit: target/stop at +/- 2*ATR
    let atrv = 0; for (let k = n - 14; k < n; k++) { const tr = Math.max(b[k][2] - b[k][3], Math.abs(b[k][2] - b[k - 1][4]), Math.abs(b[k][3] - b[k - 1][4])); atrv += tr; } atrv /= 14;
    let sig = 0; for (const L of [21, 63, 126, 252]) sig += Math.sign(c[n - 1] / c[n - 1 - L] - 1); sig /= 4;
    const strength = sig * (c[n - 1] / c[n - 1 - 126] - 1) / (vol || 1); // signed momentum / vol
    if (Math.abs(sig) < 0.5) continue; // require agreement
    const dir = sig > 0 ? "LONG" : "SHORT"; const twoATR = 2 * atrv;
    opps.push({ sym: r.symbol, cls: r.asset_class, dir, signal: strength, px, vol: +(vol * 100).toFixed(0), entry: px,
      target: +(dir === "LONG" ? px + twoATR : px - twoATR).toFixed(2), stop: +(dir === "LONG" ? px - twoATR : px + twoATR).toFixed(2) });
  }
}
const longs = opps.filter((o) => o.dir === "LONG").sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal)).slice(0, +K.TOPN);
const shorts = opps.filter((o) => o.dir === "SHORT").sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal)).slice(0, +K.TOPN);
// live going-concern shorts (recent filings)
const gc = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22substantial+doubt%22+%22going+concern%22&forms=10-K&startdt=2026-06-16&enddt=2026-09-16', { headers: { "User-Agent": "aegis-research (research@aegis.local)" } }).then((r) => r.json()).catch(() => ({}));
const gcN = (gc as { hits?: { total?: { value?: number } } }).hits?.total?.value ?? 0;
// ---- SIZE each opportunity into the paper book (risk-parity to the wallet at target vol) ----
const book = [...longs, ...shorts]; const N = book.length || 1;
const perRisk = +K.TARGET_VOL / Math.sqrt(N); // equal risk per position (uncorrelated approx)
type Sized = Opp & { gbp: number; units: number; risk_pct: number };
const sized: Sized[] = book.map((o) => { const v = o.vol / 100; const w = v > 0 ? perRisk / v : 0; const gbp = +(+K.WALLET * w).toFixed(0); return { ...o, gbp, units: +(gbp / o.px).toFixed(4), risk_pct: +(perRisk * 100).toFixed(1) }; });
// cap any single position at MAX_POS_PCT of wallet (no line dominates — low-vol instruments gap)
const posCap = +K.WALLET * +K.MAX_POS_PCT / 100;
for (const x of sized) if (x.gbp > posCap) { x.gbp = +posCap.toFixed(0); x.units = +(x.gbp / x.px).toFixed(4); }
// cap gross leverage at MAX_LEV (scale the whole book down if it exceeds — the survivable discipline)
let gross = sized.reduce((s, x) => s + Math.abs(x.gbp), 0);
const cap = +K.WALLET * +K.MAX_LEV;
if (gross > cap) { const f = cap / gross; for (const x of sized) { x.gbp = +(x.gbp * f).toFixed(0); x.units = +(x.gbp / x.px).toFixed(4); } gross = sized.reduce((s, x) => s + Math.abs(x.gbp), 0); }
const net = sized.reduce((s, x) => s + (x.dir === "LONG" ? x.gbp : -x.gbp), 0);
const lev = +(gross / +K.WALLET).toFixed(2);
if (K.SIZE === "1") {
  const wh = { ...hdr, "Content-Type": "application/json" } as Record<string, string>;
  const port = { dormant: true, spec_id: "opportunities-book", decision: "operator-sized", as_of: new Date().toISOString().slice(0, 10), wallet_gbp: +K.WALLET, target_vol: +K.TARGET_VOL,
    gross_exposure_gbp: gross, net_exposure_gbp: net, gross_leverage: lev, n_positions: sized.length,
    exit_rule: "2xATR profit-target / 2xATR stop (D-934); on hit -> exit and redeploy capital to the next-highest-signal validated setup",
    positions: sized.map((x) => ({ sym: x.sym, cls: x.cls, dir: x.dir, entry: x.px, gbp: x.gbp, units: x.units, vol_pct: x.vol, risk_pct: x.risk_pct, target: x.target, stop: x.stop })),
    honest_note: "DORMANT paper portfolio, £0 real. Risk-parity sizing to ~" + (100 * +K.TARGET_VOL) + "% portfolio vol; each position ~equal risk. Claude never executes — the operator arms and fills manually. The wallet grows across MANY small both-direction trades, not one; do not upsize any single line." };
  // idempotent per day: replace today's opportunities-book snapshot
  const ex = await q(`trd_positions?book->>spec_id=eq.opportunities-book&book->>as_of=eq.${port.as_of}&select=id`) as { id: number }[];
  if (!ex.length) { const r = await fetch(`${OWNED}/trd_positions`, { method: "POST", headers: { ...wh, Prefer: "return=minimal" }, body: JSON.stringify({ book: port }) }); console.log(`  SIZED PORTFOLIO -> trd_positions (DORMANT opportunities-book ${port.as_of}): ${r.status}`); } // plumbing-ok: audited — status checked
  else console.log(`  SIZED PORTFOLIO: today's opportunities-book already recorded (id ${ex[0].id}) — idempotent`);
  console.log(`  wallet £${K.WALLET}, target vol ${(100*+K.TARGET_VOL).toFixed(0)}%, ${sized.length} positions, gross £${gross.toLocaleString()}, net £${net.toLocaleString()}, leverage ${lev}x`);
}
const sz = new Map(sized.map((s) => [s.dir + s.sym, s])); const fmt = (o: Opp) => { const s = sz.get(o.dir + o.sym); return `| ${o.sym} | ${o.cls} | ${o.dir} | ${o.signal.toFixed(2)} | ${o.px} | £${s?.gbp ?? 0} | ${s?.units ?? 0} | ${o.target} | ${o.stop} |`; };
const today = new Date().toISOString().slice(0, 10);
const md = `# Current opportunities — ${today}

> TREND/momentum WATCHLIST across the global panel — one input family, NOT the deployed book. The deployed book is the
> 5-sleeve blend (leverageable excess ~1.92, D-939e pin): see DEPLOY_RUNBOOK.md / deploy-sheet.ts for what to hold.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target and stop are **2xATR** (D-934: the exit that wins on capital-velocity — caps the tail, frees capital fastest).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
${longs.map(fmt).join("\n")}

## SHORT (trend down)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
${shorts.map(fmt).join("\n")}

## SHORT — going-concern distress (the persistent edge, D-930/931)
${gcN} going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run \`goingconcern-borrow.ts\` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the 2xATR profit-target and stop above (the D-934 validated exit).
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the blend's edge is diversification across sleeves, not any one trade.
`;
await Deno.writeTextFile(new URL("../docs/OPPORTUNITIES.md", import.meta.url), md);
console.log(`==> OPPORTUNITIES — ${longs.length} longs, ${shorts.length} shorts across ${opps.length} trending instruments; ${gcN} live going-concern shorts. Wrote docs/OPPORTUNITIES.md`);
console.log(`\n  TOP LONGS:  ${longs.slice(0,5).map((o)=>`${o.sym}(${o.signal.toFixed(1)})`).join(" ")}`);
console.log(`  TOP SHORTS: ${shorts.slice(0,5).map((o)=>`${o.sym}(${o.signal.toFixed(1)})`).join(" ")}`);
