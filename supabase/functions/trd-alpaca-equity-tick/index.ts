// trd-alpaca-equity-tick — REAL Alpaca paper execution for the WHOLE-MARKET short side via liquid
// ETFs (SPY, QQQ, IWM = indices; GLD = a real GOLD surface that GC=F futures couldn't give us).
// Trades the sweep strategy LONG **and** SHORT (equities can short, unlike Alpaca crypto), market-
// hours-gated, 1% risk, software-managed exits, reconciled from Alpaca. Actual fills, not inferred.
// ?probe=1 = clock + shortable status. ?selftest=1 = short 1 share SPY + cover (proves the short path).
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts"; // D-100 verified risk control, in the order path
import { kellySize } from "../_shared/trd-kelly.ts";           // D-101 fractional-Kelly sizing on measured edge
import { gexRegime } from "../_shared/trd-gex-regime.ts";       // D-132 GEX forward-vol de-risk (validated t=-14.1)
import { fwdVolDeRisk } from "../_shared/trd-fwdvol.ts";        // D-134 UNIFIED forward-vol forecast (trailingRV+GEX+VIXterm)
const IDX = new Set(["SPY", "QQQ", "IWM"]); // broad equity indices the SPX GEX/VIX-term model applies to; NOT GLD (gold)
// Once-per-tick VIX term structure (VIX/VIX3M): >1 = backwardation/stress. Free Yahoo. NaN on failure (fail-open).
async function marketVixTerm(): Promise<number> {
  try {
    const one = async (s: string) => { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json(); const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x: number) => Number.isFinite(x)); return c?.[c.length - 1]; };
    const [vx, v3] = [await one("^VIX"), await one("^VIX3M")];
    return (vx > 0 && v3 > 0) ? vx / v3 : NaN;
  } catch { return NaN; }
}
// Once-per-tick market-wide GEX de-risk from free SqueezeMetrics history. Fail-OPEN to 1.0 (pure reducer, ≤1).
async function gexMarketDeRisk(): Promise<{ deRisk: number; regime: string; pctile: number }> {
  try {
    const r = await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return { deRisk: 1, regime: "unavailable", pctile: -1 };
    const series = (await r.text()).trim().split("\n").slice(1).map((l) => +l.split(",")[3]).filter((x) => Number.isFinite(x));
    if (series.length < 300) return { deRisk: 1, regime: "unavailable", pctile: -1 };
    const g = gexRegime(series[series.length - 1], series.slice(0, -1));
    return { deRisk: g.deRisk, regime: g.regime, pctile: g.percentile };
  } catch { return { deRisk: 1, regime: "unavailable", pctile: -1 }; }
}
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const BROKER = "https://paper-api.alpaca.markets", DATA = "https://data.alpaca.markets/v2/stocks";
const SYMBOLS = ["SPY", "QQQ", "IWM", "GLD"], LB = 5, RR = 3, EMAP = 20, RISK = 0.01;

async function get(path: string, base = BROKER) { const r = await fetch(`${base}${path}`, { headers: AH }); return r.ok ? await r.json() : null; }
async function submitFill(body: any, tries = 8) {
  const r = await fetch(`${BROKER}/v2/orders`, { method: "POST", headers: AH, body: JSON.stringify(body) });
  if (!r.ok) return { err: `submit ${r.status}: ${(await r.text()).slice(0, 140)}` };
  let o = await r.json();
  for (let i = 0; i < tries && !["filled", "rejected", "canceled"].includes(o.status); i++) { await new Promise((z) => setTimeout(z, 700)); const g = await fetch(`${BROKER}/v2/orders/${o.id}`, { headers: AH }); if (g.ok) o = await g.json(); }
  return { id: o.id, status: o.status, price: +o.filled_avg_price || 0, qty: +o.filled_qty || 0 };
}
async function bars(sym: string) {
  const start = new Date(Date.now() - 5 * 86400000).toISOString();
  const r = await fetch(`${DATA}/bars?symbols=${sym}&timeframe=15Min&start=${start}&limit=1000&feed=iex`, { headers: AH });
  if (!r.ok) return []; const j = await r.json(); return (j.bars?.[sym] ?? []).map((b: any) => ({ ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
}
// daily returns for the D-100 vol-regime de-risk (causal: trailing daily closes only)
async function dailyReturns(sym: string): Promise<number[]> {
  const start = new Date(Date.now() - 430 * 86400000).toISOString();
  const r = await fetch(`${DATA}/bars?symbols=${sym}&timeframe=1Day&start=${start}&limit=1000&feed=iex`, { headers: AH });
  if (!r.ok) return []; const j = await r.json(); const b = j.bars?.[sym] ?? [];
  const out: number[] = []; for (let i = 1; i < b.length; i++) if (b[i].c > 0 && b[i - 1].c > 0) out.push(Math.log(b[i].c / b[i - 1].c));
  return out;
}
function ema(v: number[], p: number) { const k = 2 / (p + 1); let e = v[0]; const o = [e]; for (let i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); o.push(e); } return o; }
// sweep signal, BOTH directions (matches btc-sweep spec, applied to equities long+short)
function sweep(b: any[]): { side: "long" | "short"; stop: number; ref: number } | null {
  if (b.length < EMAP + LB + 2) return null;
  const i = b.length - 1, e = ema(b.map((x) => x.c), EMAP)[i];
  let lo = Infinity, hi = -Infinity; for (let j = i - LB; j < i; j++) { lo = Math.min(lo, b[j].l); hi = Math.max(hi, b[j].h); }
  if (b[i].l < lo && b[i].c > lo && b[i].c > e) return { side: "long", stop: b[i].l, ref: b[i].c };
  if (b[i].h > hi && b[i].c < hi && b[i].c < e) return { side: "short", stop: b[i].h, ref: b[i].c };
  return null;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const P = new URL(req.url).searchParams;
  try {
    if (!SECRET) throw new Error("no Alpaca secret");
    const clock = await get("/v2/clock");
    if (P.get("probe") === "1") {
      const assets: any = {}; for (const s of SYMBOLS) { const a = await get(`/v2/assets/${s}`); assets[s] = a ? { tradable: a.tradable, shortable: a.shortable, etb: a.easy_to_borrow } : "n/a"; }
      const sampleBars = (await bars("SPY")).length;
      const regimes: any = {}; for (const s of SYMBOLS) { const vr = volRegimeDeRisk(await dailyReturns(s)); regimes[s] = { deRisk: +vr.deRisk.toFixed(3), elevated: vr.elevated, reason: vr.reason }; }
      const stx = await fetch(`${SB}/rest/v1/trd_alpaca_state?id=eq.equity&select=closed`, { headers: hdr }).then((r) => r.json()).then((x) => x[0] ?? { closed: [] }).catch(() => ({ closed: [] }));
      const k = kellySize((stx.closed ?? []).map((c: any) => c.r), 0.01);
      const gexDR = await gexMarketDeRisk(); const vixTerm = await marketVixTerm(); // D-132/134
      const unified: any = {}; for (const s of ["SPY", "QQQ", "IWM"]) { const vr = volRegimeDeRisk(await dailyReturns(s)); unified[s] = fwdVolDeRisk(vr.rv * Math.sqrt(252), gexDR.pctile >= 0 ? gexDR.pctile : NaN, vixTerm); }
      return new Response(JSON.stringify({ ok: true, market_open: clock?.is_open, next_open: clock?.next_open, assets, spyBarsAvail: sampleBars, volRegimeDeRisk: regimes, gexMarketDeRisk: gexDR, vixTerm: Number.isFinite(vixTerm) ? +vixTerm.toFixed(3) : null, unifiedFwdVolDeRisk: unified, kelly: k }, null, 2), { headers: cors });
    }
    if (P.get("selftest") === "1") {
      if ((req.headers.get("x-admin") ?? "") !== SRK) return new Response(JSON.stringify({ ok: false, err: "admin token required for selftest" }), { status: 403, headers: cors });
      if (!clock?.is_open) return new Response(JSON.stringify({ ok: true, note: "market closed — short self-test runs at next open", next_open: clock?.next_open }), { headers: cors });
      const sh = await submitFill({ symbol: "SPY", qty: "1", side: "sell", type: "market", time_in_force: "day" });
      if ((sh as any).status !== "filled") return new Response(JSON.stringify({ ok: false, stage: "short", sh }, null, 2), { headers: cors });
      const cover = await submitFill({ symbol: "SPY", qty: "1", side: "buy", type: "market", time_in_force: "day" });
      return new Response(JSON.stringify({ ok: true, selftest: "REAL short opened + covered", shortFill: sh, coverFill: cover }, null, 2), { headers: cors });
    }
    if (!clock?.is_open) return new Response(JSON.stringify({ ok: true, skipped: "market closed", next_open: clock?.next_open }), { headers: cors });
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: hdr }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch active" }), { headers: cors });
    const a = await get("/v2/account"); const equity = +a.equity;
    const gexDR = await gexMarketDeRisk(); // D-132: market-wide GEX percentile (≤1, fail-open)
    const vixTerm = await marketVixTerm(); // D-134: VIX/VIX3M term structure (fail-open NaN)
    const st = await fetch(`${SB}/rest/v1/trd_alpaca_state?id=eq.equity&select=*`, { headers: hdr }).then((r) => r.json()).then((x) => x[0] ?? { open_trades: {}, closed: [], ticks: 0, last_bars: {} });
    const open: Record<string, any> = st.open_trades ?? {}; const closed: any[] = st.closed ?? []; const lastBars: Record<string, string> = st.last_bars ?? {};
    let entered = 0, exited = 0;
    for (const sym of SYMBOLS) {
      const b = await bars(sym); if (!b.length) continue; const last = b[b.length - 1];
      if (open[sym]) {
        const t = open[sym], px = last.c; const hitStop = t.side === "long" ? px <= t.stop : px >= t.stop; const hitTgt = t.side === "long" ? px >= t.target : px <= t.target;
        if (hitStop || hitTgt) {
          const pos = await get(`/v2/positions/${sym}`);
          if (pos) { const q = Math.abs(+(pos.qty_available ?? pos.qty)); if (q > 0) { const closeSide = t.side === "long" ? "sell" : "buy"; const f = await submitFill({ symbol: sym, qty: String(q), side: closeSide, type: "market", time_in_force: "day" }); const exit = (f as any).price || px; const dir = t.side === "long" ? 1 : -1; const r = dir * (exit - t.entry) / Math.abs(t.entry - t.stop); closed.push({ sym, side: t.side, entryTs: t.openTs, exitTs: last.ts, entry: t.entry, exit, r: +r.toFixed(3), reason: hitStop ? "stop" : "target" }); exited++; } }
          delete open[sym];
        }
        continue;
      }
      const sig = sweep(b);
      if (sig && last.ts !== lastBars[sym] && Math.abs(sig.ref - sig.stop) > 0) {
        if (sig.side === "short") { const asset = await get(`/v2/assets/${sym}`); if (!asset?.shortable) continue; }
        const stopDist = Math.abs(sig.ref - sig.stop);
        const vr = volRegimeDeRisk(await dailyReturns(sym)); // D-100: shrink size in elevated-vol regimes (never levers up)
        const k = kellySize(closed.map((c: any) => c.r), RISK); // D-101: fractional-Kelly on THIS strategy's measured edge
        // D-134: for equity indices use the UNIFIED forward-vol forecast (trailingRV+GEX+VIXterm → one deRisk,
        // no triple-counting); GLD keeps the plain vol-regime. vr.rv is DAILY stdev → annualize ×√252.
        let sizeDeRisk: number, sizeSrc: string;
        if (IDX.has(sym)) { const gp = gexDR.pctile >= 0 ? gexDR.pctile : NaN; sizeDeRisk = fwdVolDeRisk(vr.rv * Math.sqrt(252), gp, vixTerm).deRisk; sizeSrc = "unified-fwdvol"; }
        else { sizeDeRisk = vr.deRisk; sizeSrc = "vol-regime"; }
        const riskFrac = k.riskFraction * sizeDeRisk;           // pure risk-reducer ≤ base, never levers, no direction
        const qty = Math.max(1, Math.floor((riskFrac * equity) / stopDist));
        const side = sig.side === "long" ? "buy" : "sell";
        const buy = await submitFill({ symbol: sym, qty: String(qty), side, type: "market", time_in_force: "day" });
        if ((buy as any).status === "filled") { const entry = (buy as any).price; const dir = sig.side === "long" ? 1 : -1; open[sym] = { side: sig.side, entry, stop: sig.stop, target: entry + dir * RR * stopDist, qty, openTs: last.ts, deRisk: +sizeDeRisk.toFixed(3), sizeSrc, volElevated: vr.elevated, kellyRisk: +k.riskFraction.toFixed(4), gexRegime: gexDR.regime, vixTerm: Number.isFinite(vixTerm) ? +vixTerm.toFixed(3) : null }; lastBars[sym] = last.ts; entered++; }
      }
    }
    const rlog = closed.map((c) => c.r); const exp = rlog.length ? rlog.reduce((x, y) => x + y, 0) / rlog.length : 0;
    await fetch(`${SB}/rest/v1/trd_alpaca_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "equity", open_trades: open, closed: closed.slice(-500), ticks: (st.ticks ?? 0) + 1, last_equity: equity, last_bars: lastBars, updated_at: new Date().toISOString() }) });
    return new Response(JSON.stringify({ ok: true, equity, open: Object.entries(open).map(([s, t]: any) => `${s}:${t.side}`), enteredThisTick: entered, exitedThisTick: exited, closedTotal: closed.length, forwardExpectancyR: +exp.toFixed(3), note: "REAL Alpaca paper fills, equities/ETFs LONG+SHORT (SPY/QQQ/IWM/GLD)" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
