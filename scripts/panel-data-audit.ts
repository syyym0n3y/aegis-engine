#!/usr/bin/env -S deno run --allow-net --allow-env
// panel-data-audit.ts (D-861) — data soundness for the 24-instrument hourly panel BEFORE the adaptive engine runs on it
// (operator: make sure the data set is sound before you begin). Per instrument: duplicate stamps, off-grid stamps,
// gaps outside the weekend close, zero-volume placeholders (D-858), OHLC consistency, absurd hourly moves. RED on any
// instrument whose placeholders are not droppable or whose lattice is broken; the perps come from a different feed
// (Binance klines) than the FX/index series (Dukascopy) so each is checked on its own terms.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("panel-data-audit", [{ name: "MIN_BARS", def: "10000" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pda", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
type B = { ts: number; o: number; h: number; l: number; c: number; v: number };
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
async function load(sym: string): Promise<B[]> {
  if (FX.includes(sym)) { const out: B[] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; if (!p.length) break; out.push(...p.map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }))); from = p.at(-1)!.ts; if (p.length < 20000) break; } return out; }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).map((b) => ({ ts: b.ts, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).sort((a, b) => a.ts - b.ts);
}
const perps = (await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > +K.MIN_BARS).map((r) => r.symbol);
const U = [...perps, ...FX]; assertNonEmpty("panel", U, 15);
console.log(`\n==> PANEL DATA AUDIT — ${U.length} instruments\n  ${"instrument".padEnd(14)} ${"bars".padStart(7)} ${"dup".padStart(4)} ${"offgrid".padStart(7)} ${"gaps>1h(non-wknd)".padStart(18)} ${"zero-vol%".padStart(9)} ${"badOHLC".padStart(7)} ${">5%/h".padStart(6)}  verdict`);
let red = 0; const usable: Record<string, number> = {};
for (const sym of U) {
  const b = await load(sym); if (b.length < +K.MIN_BARS) { console.log(`  ${sym.padEnd(14)} ${String(b.length).padStart(7)}  too short — excluded`); continue; }
  let dup = 0, off = 0, gaps = 0, zero = 0, bad = 0, big = 0;
  for (let i = 0; i < b.length; i++) { const r = b[i]; if (!(r.v > 0)) zero++; if (!(r.o > 0 && r.h >= Math.max(r.o, r.c) && r.l <= Math.min(r.o, r.c) && r.l > 0)) bad++; if (r.ts % 3600) off++; if (i) { const d = (r.ts - b[i - 1].ts) / 3600; if (d === 0) dup++; else if (d > 1) { const dow = new Date(b[i - 1].ts * 1000).getUTCDay(), hr = new Date(b[i - 1].ts * 1000).getUTCHours(); const wk = FX.includes(sym) && dow === 5 && hr >= 20 && d <= 52; if (!wk) gaps++; } if (b[i - 1].c > 0 && Math.abs(Math.log(r.c / b[i - 1].c)) > 0.05) big++; } }
  const live = b.filter((r) => r.v > 0 && r.h > r.l).length; usable[sym] = live;
  const ok = dup === 0 && off === 0 && bad === 0 && gaps < 0.005 * b.length && live > +K.MIN_BARS;
  if (!ok) red++;
  console.log(`  ${sym.padEnd(14)} ${String(b.length).padStart(7)} ${String(dup).padStart(4)} ${String(off).padStart(7)} ${String(gaps).padStart(18)} ${(100 * zero / b.length).toFixed(1).padStart(8)}% ${String(bad).padStart(7)} ${String(big).padStart(6)}  ${ok ? "ok (usable " + live + ")" : "RED"}`);
}
console.log(`\n  ${red === 0 ? "PANEL SOUND — with zero-volume placeholders dropped (D-858 rule), every instrument is usable." : `${red} instrument(s) RED — exclude or fix before the engine runs on them.`}`);
if (red) Deno.exit(1);
