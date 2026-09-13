#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// trend-paper.ts (D-867) — the DAILY PAPER BOOK for the two trend clocks (fwd-tsmom-110, fwd-trend-long-parity).
// LADDER stage 1: no broker path. Recomputes the D-863 trend positions and the vol-matched long basket on the 110-asset
// daily panel from the clock start, at 10% per-asset vol, weekly rebalance, lag-1, class costs, and appends one row
// per completed day to data/trend-paper.json: {date, trend, long, parity}. The forward scorer reads it. Idempotent —
// a date already present is never rewritten.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("trend-paper", [{ name: "CLOCK_START", def: "2026-09-13" }, { name: "VOL_TARGET", def: "0.10" }, { name: "REBAL_D", def: "5" }, { name: "MIN_YEARS", def: "10" }, { name: "MAX_CRYPTO", def: "10" }, { name: "LEDGER", def: "data/trend-paper.json" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const COST: Record<string, number> = { fx: 2, index: 4, intl_index: 4, rate: 4, etf: 4, sector: 4, commodity: 6, crypto: 9 };
const ks = await q(`trd_kill_switch?account=eq.paper&select=state`) as { state: string }[]; if (ks[0]?.state !== "armed") { console.log(`paper kill-switch '${ks[0]?.state}' — nothing written.`); Deno.exit(0); }
const meta = await q(`trd_bars_deep?asset_class=in.(commodity,fx,index,intl_index,rate,etf,sector,crypto)&select=symbol,asset_class,first_date,n_bars&order=first_date.asc`) as { symbol: string; asset_class: string; first_date: string; n_bars: number }[];
const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - +K.MIN_YEARS);
let sel = meta.filter((m) => m.first_date <= cutoff.toISOString().slice(0, 10) && m.n_bars > 2000 && !/^\^VIX$|USDT|^\^IRX$/.test(m.symbol));
sel = [...sel.filter((m) => m.asset_class !== "crypto"), ...sel.filter((m) => m.asset_class === "crypto").slice(0, +K.MAX_CRYPTO)];
assertNonEmpty("assets", sel, 60);
const LOOK = [21, 63, 126, 252]; const tr: Map<string, number> = new Map(), lg: Map<string, number> = new Map(), nAct: Map<string, number> = new Map();
// D-868: the ISA-holdable long-only subset, timed vs held
const ISA_RE = /^(SPY|QQQ|DIA|IWM|IWF|IWD|EFA|EEM|EWJ|EWZ|EWG|EWU|EWH|EWA|EWC|FXI|VGK|TLT|IEF|SHY|LQD|HYG|GLD|SLV|USO|UNG|XL[IEBFVPYKU]|ITB|KRE|XLRE|SMH|VNQ|\^GSPC|\^IXIC|\^DJI|\^RUT|\^FTSE|\^GDAXI|\^FCHI|\^N225|\^HSI|\^AXJO|\^STOXX50E|\^GSPTSE|\^SSMI|\^IBEX|\^KS11|\^BSESN|\^MXX|\^BVSP)$/;
const tm: Map<string, number> = new Map(), hd: Map<string, number> = new Map(), nIsa: Map<string, number> = new Map(); const RF = 0.02;
for (let i = 0; i < sel.length; i += 5) { const page = sel.slice(i, i + 5); const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[];
  for (const a of rows) { const b = (a.bars ?? []).filter((x) => x[4] > 0).sort((p, z) => p[0] - z[0]); const c = b.map((x) => x[4]), ts = b.map((x) => x[0]); const n = c.length; if (n < 300) continue; const r = new Float64Array(n); for (let j = 1; j < n; j++) r[j] = Math.log(c[j] / c[j - 1]); const cost = COST[a.asset_class] / 1e4; let posT = 0, posL = 0, lastReb = -1e9;
    for (let j = 260; j < n - 1; j++) { const d1 = day(ts[j + 1]); const vol = sd(Array.from(r.slice(j - 60, j))) * Math.sqrt(252); const scale = vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0; let tc = 0, lc = 0;
      if (j - lastReb >= +K.REBAL_D) { lastReb = j; let sgn = 0; for (const L of LOOK) sgn += Math.sign(c[j] / c[j - L] - 1); sgn /= LOOK.length; const nt = sgn * scale; tc = Math.abs(nt - posT) * cost / 2; posT = nt; lc = Math.abs(scale - posL) * cost / 2; posL = scale; }
      if (d1 < K.CLOCK_START) continue; tr.set(d1, (tr.get(d1) ?? 0) + posT * r[j + 1] - tc); lg.set(d1, (lg.get(d1) ?? 0) + posL * r[j + 1] - lc); nAct.set(d1, (nAct.get(d1) ?? 0) + 1);
      if (ISA_RE.test(a.symbol)) { const timedPos = posT > 0 ? posL : 0; tm.set(d1, (tm.get(d1) ?? 0) + timedPos * r[j + 1] - (posT > 0 ? tc : 0) + (timedPos === 0 ? RF / 252 : 0)); hd.set(d1, (hd.get(d1) ?? 0) + posL * r[j + 1] - lc); nIsa.set(d1, (nIsa.get(d1) ?? 0) + 1); } } } }
const LP = new URL(`../${K.LEDGER}`, import.meta.url).pathname; let ledger: { date: string; trend: number; long: number; parity: number; timed?: number; hold?: number; n: number }[] = []; try { ledger = JSON.parse(await Deno.readTextFile(LP)); } catch { /* first run */ }
const have = new Set(ledger.map((x) => x.date)); const today = new Date().toISOString().slice(0, 10); let added = 0;
for (const d of [...tr.keys()].sort()) { if (have.has(d) || d >= today) continue; const n = nAct.get(d) ?? 1; const t = tr.get(d)! / n, l = lg.get(d)! / n;
  // risk parity from the ledger's own trailing 60 days of each sleeve (falls back to equal weight until 20 days exist)
  const hist = ledger.slice(-60); const vt = hist.length > 20 ? sd(hist.map((x) => x.trend)) : 0, vl = hist.length > 20 ? sd(hist.map((x) => x.long)) : 0; const wt = vt > 0 && vl > 0 ? (1 / vt) / (1 / vt + 1 / vl) : 0.5;
  const ni = nIsa.get(d) ?? 1; ledger.push({ date: d, trend: +t.toFixed(8), long: +l.toFixed(8), parity: +(wt * t + (1 - wt) * l).toFixed(8), timed: +((tm.get(d) ?? 0) / ni).toFixed(8), hold: +((hd.get(d) ?? 0) / ni).toFixed(8), n }); added++; }
await Deno.writeTextFile(LP, JSON.stringify(ledger, null, 0));
const cum = (k: "trend" | "long" | "parity") => ledger.reduce((s, x) => s + x[k], 0);
console.log(`==> TREND PAPER BOOK — ${sel.length} assets, clock start ${K.CLOCK_START}: ${added} day(s) added, ledger ${ledger.length} day(s); cumulative trend ${(100 * cum("trend")).toFixed(2)}% long ${(100 * cum("long")).toFixed(2)}% parity ${(100 * cum("parity")).toFixed(2)}%`);
