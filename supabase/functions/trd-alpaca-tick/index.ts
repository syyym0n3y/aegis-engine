// trd-alpaca-tick — REAL Alpaca paper execution for the long side of the BTC/ETH sweep hypothesis.
// Not our simulator — actual paper orders + actual fills on Alpaca's engine (the operator's point:
// we want ACTUAL edges, not inferred). Alpaca crypto is LONG-ONLY + no gold (those go to other
// surfaces). Sizing = 1% risk/trade. Idempotent per bar. ?selftest=1 places+closes a tiny real order
// to prove the path. Crypto market orders fill instantly, so entry/exit are polled synchronously.
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts"; // D-100 verified risk control, in the order path
import { assetFwdVolDeRisk } from "../_shared/trd-asset-vol.ts"; // D-135b: crypto sized by Deribit DVOL (dominant)
// Latest Deribit DVOL (crypto implied vol) as a FRACTION. NaN on failure (caller falls back to vol-regime).
async function dvolLevel(cur: string): Promise<number> {
  try { const end = Date.now(), start = end - 5 * 86400000; const r = await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&start_timestamp=${start}&end_timestamp=${end}&resolution=43200`); const j = await r.json(); const d = j?.result?.data; return d?.length ? d[d.length - 1][4] / 100 : NaN; } catch { return NaN; }
}
import { kellySize } from "../_shared/trd-kelly.ts";           // D-101 fractional-Kelly sizing on measured edge
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const BROKER = "https://paper-api.alpaca.markets", DATA = "https://data.alpaca.markets/v1beta3/crypto/us";
const SYMBOLS = ["BTC/USD", "ETH/USD"], LB = 5, RR = 3, EMAP = 20, RISK = 0.01;

async function acct() { const r = await fetch(`${BROKER}/v2/account`, { headers: AH }); return r.ok ? await r.json() : null; }
async function position(sym: string) { const r = await fetch(`${BROKER}/v2/positions/${encodeURIComponent(sym)}`, { headers: AH }); return r.ok ? await r.json() : null; }
async function submitFill(body: any, tries = 8) {
  const r = await fetch(`${BROKER}/v2/orders`, { method: "POST", headers: AH, body: JSON.stringify(body) });
  if (!r.ok) return { err: `submit ${r.status}: ${(await r.text()).slice(0, 120)}` };
  let o = await r.json();
  for (let i = 0; i < tries && o.status !== "filled"; i++) { await new Promise((z) => setTimeout(z, 700)); const g = await fetch(`${BROKER}/v2/orders/${o.id}`, { headers: AH }); if (g.ok) o = await g.json(); }
  return { id: o.id, status: o.status, price: +o.filled_avg_price || 0, qty: +o.filled_qty || 0 };
}
async function bars(sym: string) {
  const start = new Date(Date.now() - 3 * 86400000).toISOString();
  const r = await fetch(`${DATA}/bars?symbols=${encodeURIComponent(sym)}&timeframe=15Min&start=${start}&limit=1000`, { headers: AH });
  const j = await r.json(); return (j.bars?.[sym] ?? []).map((b: any) => ({ ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
}
// daily returns for the D-100 vol-regime de-risk (causal: trailing daily closes only)
async function dailyReturns(sym: string): Promise<number[]> {
  const start = new Date(Date.now() - 430 * 86400000).toISOString();
  const r = await fetch(`${DATA}/bars?symbols=${encodeURIComponent(sym)}&timeframe=1Day&start=${start}&limit=1000`, { headers: AH });
  if (!r.ok) return []; const j = await r.json(); const b = j.bars?.[sym] ?? [];
  const out: number[] = []; for (let i = 1; i < b.length; i++) if (b[i].c > 0 && b[i - 1].c > 0) out.push(Math.log(b[i].c / b[i - 1].c));
  return out;
}
function ema(v: number[], p: number) { const k = 2 / (p + 1); let e = v[0]; const out = [e]; for (let i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); out.push(e); } return out; }
// sweep-long signal on the LAST closed bar (matches btc-sweep-rr3-v1, long side, ema20 trend filter)
function sweepLong(b: any[]) {
  if (b.length < EMAP + LB + 2) return null;
  const i = b.length - 1, e = ema(b.map((x) => x.c), EMAP)[i];
  let lo = Infinity; for (let j = i - LB; j < i; j++) lo = Math.min(lo, b[j].l);
  if (b[i].l < lo && b[i].c > lo && b[i].c > e) { const stop = b[i].l; return { ts: b[i].ts, entryRef: b[i].c, stop }; }
  return null;
}

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-alpaca-tick", p_outcome: o.slice(0, 180) }),
  }).catch(() => {});
const SERVE = (h: (r: Request) => Response | Promise<Response>) =>
  Deno.serve(async (r: Request) => {
    let res: Response;
    try { res = await h(r); } catch (e) { await __beat("THREW " + String(e).slice(0, 150)); throw e; }
    let body = "";
    try { body = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch { /* unreadable body */ }
    await __beat(`${res.status} ${body}`);
    return res;
  });

SERVE(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const params = new URL(req.url).searchParams; const selftest = params.get("selftest") === "1"; const flatten = params.get("flatten") === "1";
  try {
    if (!SECRET) throw new Error("no Alpaca secret resolved");
    if (params.get("volprobe") === "1") { const regimes: any = {}; for (const s of SYMBOLS) { const vr = volRegimeDeRisk(await dailyReturns(s)); const cur = s.split("/")[0]; const dv = await dvolLevel(cur); const av = assetFwdVolDeRisk(cur, vr.rv * Math.sqrt(365), dv); regimes[s] = { volRegimeDeRisk: +vr.deRisk.toFixed(3), dvol: Number.isFinite(dv) ? +(dv * 100).toFixed(1) : null, dvolDeRisk: av.deRisk, forecastVolPct: av.forecastVolPct, applied: av.model !== "none" ? "dvol" : "vol-regime" }; } const stx = await fetch(`${SB}/rest/v1/trd_alpaca_state?id=eq.default&select=closed`, { headers: hdr }).then((r) => r.json()).then((x) => x[0] ?? { closed: [] }).catch(() => ({ closed: [] })); const k = kellySize((stx.closed ?? []).map((c: any) => c.r), 0.01); return new Response(JSON.stringify({ ok: true, sizing: regimes, kelly: k }, null, 2), { headers: cors }); }
    // SECURITY: flatten/selftest are dangerous (mutate real paper positions) — gate behind the
    // service-role key so a public caller can't disrupt the forward test or spam orders.
    if ((selftest || flatten) && (req.headers.get("x-admin") ?? "") !== SRK) return new Response(JSON.stringify({ ok: false, err: "admin token required for selftest/flatten" }), { status: 403, headers: cors });
    if (flatten) { const r = await fetch(`${BROKER}/v2/positions`, { method: "DELETE", headers: AH }); await fetch(`${SB}/rest/v1/trd_alpaca_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "default", open_trades: {}, updated_at: new Date().toISOString() }) }); return new Response(JSON.stringify({ ok: true, flattened: r.status, msg: "all positions closed, state reset" }), { headers: cors }); }
    if (selftest) { // prove the real order path: buy $15 BTC, then close it
      const buy = await submitFill({ symbol: "BTC/USD", notional: "15", side: "buy", type: "market", time_in_force: "gtc" });
      if ((buy as any).err || (buy as any).status !== "filled") return new Response(JSON.stringify({ ok: false, stage: "buy", buy }, null, 2), { headers: cors });
      const pos0 = await position("BTC/USD"); const q = pos0 ? (pos0.qty_available ?? pos0.qty) : (buy as any).qty; const sell = await submitFill({ symbol: "BTC/USD", qty: String(q), side: "sell", type: "market", time_in_force: "gtc" });
      const roundTripCostPct = (buy as any).price && (sell as any).price ? (((sell as any).price - (buy as any).price) / (buy as any).price * 100) : null;
      return new Response(JSON.stringify({ ok: true, selftest: "REAL paper order placed + closed", buyFill: buy, sellFill: sell, realRoundTripCostPct: roundTripCostPct }, null, 2), { headers: cors });
    }
    // KILL-SWITCH: durable circuit breaker (trd_killswitch row) — halts live trading, survives restarts.
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: hdr }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch active" }), { headers: cors });
    const a = await acct(); if (!a) throw new Error("account fetch failed");
    const equity = +a.equity;
    const st = await fetch(`${SB}/rest/v1/trd_alpaca_state?id=eq.default&select=*`, { headers: hdr }).then((r) => r.json()).then((x) => x[0] ?? { open_trades: {}, closed: [], ticks: 0 });
    const open: Record<string, any> = st.open_trades ?? {}; const closed: any[] = st.closed ?? []; const lastBars: Record<string,string> = st.last_bars ?? {};
    let entered = 0, exited = 0;
    for (const sym of SYMBOLS) {
      const b = await bars(sym); if (!b.length) continue; const last = b[b.length - 1];
      // manage an open trade for this symbol
      if (open[sym]) {
        const t = open[sym]; const px = last.c;
        if (px <= t.stop || px >= t.target) {
          const pos = await position(sym);
          if (pos && +(pos.qty_available ?? pos.qty) > 0) { const sell = await submitFill({ symbol: sym, qty: String(pos.qty_available ?? pos.qty), side: "sell", type: "market", time_in_force: "gtc" }); const exit = (sell as any).price || px; const r = (exit - t.entry) / (t.entry - t.stop); closed.push({ sym, entryTs: t.openTs, exitTs: last.ts, entry: t.entry, exit, r: +r.toFixed(3), reason: px <= t.stop ? "stop" : "target" }); exited++; }
          delete open[sym];
        }
        continue; // one position per symbol
      }
      // look for a fresh long sweep on the latest bar (dedupe by bar ts)
      const sig = sweepLong(b);
      if (sig && sig.ts !== lastBars[sym] && sig.entryRef > sig.stop) {
        const stopFrac = (sig.entryRef - sig.stop) / sig.entryRef; if (stopFrac <= 0) continue;
        const vr = volRegimeDeRisk(await dailyReturns(sym)); // D-100: shrink size in elevated-vol regimes (never levers up)
        const cur = sym.split("/")[0]; // BTC/USD → BTC
        const dv = await dvolLevel(cur); // D-135b: Deribit DVOL for BTC/ETH (fail-open NaN)
        const av = assetFwdVolDeRisk(cur, vr.rv * Math.sqrt(365), dv); // crypto annualizes by √365 (units!)
        const sizeDeRisk = av.model !== "none" ? av.deRisk : vr.deRisk; // DVOL model if available, else vol-regime
        const k = kellySize(closed.map((c: any) => c.r), RISK); // D-101: fractional-Kelly on THIS strategy's measured edge
        const riskFrac = k.riskFraction * sizeDeRisk;           // D-135b: DVOL-based (or vol-regime) reducer, ≤ base
        const notional = Math.min(equity * 0.3, (riskFrac * equity) / stopFrac);
        if (notional >= 5) {
          const buy = await submitFill({ symbol: sym, notional: notional.toFixed(2), side: "buy", type: "market", time_in_force: "gtc" });
          if ((buy as any).status === "filled") { const entry = (buy as any).price; open[sym] = { entry, stop: sig.stop, target: entry + RR * (entry - sig.stop), qty: (buy as any).qty, openTs: sig.ts, deRisk: +sizeDeRisk.toFixed(3), sizeSrc: av.model !== "none" ? "dvol" : "vol-regime", volElevated: vr.elevated, kellyRisk: +k.riskFraction.toFixed(4) }; lastBars[sym] = sig.ts; entered++; }
        }
      }
    }
    const rlog = closed.map((c) => c.r); const exp = rlog.length ? rlog.reduce((x, y) => x + y, 0) / rlog.length : 0;
    await fetch(`${SB}/rest/v1/trd_alpaca_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "default", open_trades: open, closed: closed.slice(-500), ticks: (st.ticks ?? 0) + 1, last_equity: equity, last_bars: lastBars, updated_at: new Date().toISOString() }) });
    return new Response(JSON.stringify({ ok: true, alpacaEquity: equity, openPositions: Object.keys(open), enteredThisTick: entered, exitedThisTick: exited, closedTotal: closed.length, forwardExpectancyR: +exp.toFixed(3), note: "REAL Alpaca paper fills, long-crypto only (shorts+gold on other surfaces)" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
