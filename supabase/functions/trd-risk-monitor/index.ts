// trd-risk-monitor — the FREE, polled auto-sync risk daemon (no paid host, no websocket needed: ruin is
// a slow variable, so cron-polling the real book is enough). Reads the live Alpaca account READ-ONLY,
// runs the D-105 fat-tailed portfolio-ruin engine on the ACTUAL positions, writes a snapshot to
// trd_risk_state, and raises an alert on a ruinous reading. It NEVER places or closes an order. With
// ?enforce=1 a ruinous reading also trips our durable kill-switch (halts OUR paper executors only) —
// the monitor→intervention loop, kept strictly inside our own automation. Scheduled via pg_cron (free).
import { bootstrapRuin, effectiveBets, corrMatrix, type Position } from "../_shared/trd-portfolio-risk.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET };
const BROKER = "https://paper-api.alpaca.markets";
const RUIN_THRESH = 0.5, ALERT_AT = 0.15; // alert when P(50% DD) ≥ 15%

const YMAP: Record<string, string> = { "BTC/USD": "BTC-USD", "ETH/USD": "ETH-USD", "BTCUSD": "BTC-USD", "ETHUSD": "ETH-USD" };
async function ay(path: string) { const r = await fetch(`${BROKER}${path}`, { headers: AH }); return r.ok ? await r.json() : null; }
async function dailyReturns(symbol: string): Promise<number[]> {
  const sym = YMAP[symbol] ?? symbol;
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 800 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const adj = res.indicators?.adjclose?.[0]?.adjclose as number[] | undefined; const c = adj ?? res.indicators.quote[0].close as number[];
  const out: number[] = []; for (let i = 1; i < c.length; i++) if (c[i] > 0 && c[i - 1] > 0 && Number.isFinite(c[i]) && Number.isFinite(c[i - 1])) out.push(Math.log(c[i] / c[i - 1]));
  return out;
}

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-risk-monitor", p_outcome: o.slice(0, 180) }),
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
  const enforce = new URL(req.url).searchParams.get("enforce") === "1";
  try {
    if (!SECRET) throw new Error("no Alpaca secret");
    const acct = await ay("/v2/account"); if (!acct) throw new Error("account fetch failed");
    const equity = +acct.equity;
    const raw = (await ay("/v2/positions")) ?? [];
    let snapshot: any;
    if (!Array.isArray(raw) || raw.length === 0) {
      snapshot = { verdict: "FLAT", probRuin: 0, grossExposure: 0, effectiveBets: 0, nominalPositions: 0, equity, positions: [], plainEnglish: "No open positions — zero market risk." };
    } else {
      const syms: string[] = [], cols: number[][] = [], pos: Position[] = [], perSym: any[] = [], dropped: string[] = [];
      for (const p of raw) {
        const symbol = String(p.symbol); const side: 1 | -1 = p.side === "short" ? -1 : 1; const notional = Math.abs(+p.market_value);
        if (!(notional > 0)) continue;
        const rets = await dailyReturns(symbol);
        if (rets.length < 120) { dropped.push(symbol); continue; }
        syms.push(symbol); cols.push(rets); pos.push({ symbol, side, weight: notional / equity });
        perSym.push({ symbol, side: side === 1 ? "long" : "short", weight: +(notional / equity).toFixed(3), marketValue: +(+p.market_value).toFixed(2) });
      }
      if (!pos.length) {
        snapshot = { verdict: "UNKNOWN", probRuin: null, grossExposure: 0, effectiveBets: 0, nominalPositions: raw.length, equity, positions: [], dropped, plainEnglish: "Positions held but no price history resolved." };
      } else {
        const T = Math.min(...cols.map((c) => c.length)); const aligned = cols.map((c) => c.slice(c.length - T));
        const ruin = bootstrapRuin(aligned, pos, { horizonDays: 252, ruinThreshold: RUIN_THRESH, nSims: 3000, seed: 20260804 });
        const ebets = ruin.effectiveBets, nominal = pos.length, conc = ebets < nominal * 0.6;
        const verdict = ruin.pRuin >= 0.25 ? "RUINOUS" : ruin.pRuin >= ALERT_AT ? "OVER-SIZED" : ruin.pRuin >= 0.03 ? "AGGRESSIVE" : "SURVIVABLE";
        snapshot = {
          verdict, probRuin: ruin.pRuin, grossExposure: ruin.grossExposure, effectiveBets: ebets, nominalPositions: nominal,
          annualizedVol: ruin.annVol, horizonReturn: { median: ruin.medianReturn, p05: ruin.p05, p95: ruin.p95 }, equity,
          positions: perSym, correlation: { symbols: syms, matrix: corrMatrix(aligned) }, dropped, alignedDays: T,
          plainEnglish: `${nominal} position${nominal > 1 ? "s" : ""} = ~${ebets} real bet${ebets < 1.5 ? "" : "s"}${conc ? " (correlated → concentrated)" : ""}, ${(ruin.grossExposure * 100).toFixed(0)}% gross, ${(ruin.pRuin * 100).toFixed(1)}% chance of a 50%+ drawdown/yr.`,
        };
      }
    }
    const alert = typeof snapshot.probRuin === "number" && snapshot.probRuin >= ALERT_AT;
    await fetch(`${SB}/rest/v1/trd_risk_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "default", snapshot, verdict: snapshot.verdict, prob_ruin: snapshot.probRuin, gross_exposure: snapshot.grossExposure, effective_bets: snapshot.effectiveBets, alert, updated_at: new Date().toISOString() }) });

    let enforced = false;
    if (enforce && typeof snapshot.probRuin === "number" && snapshot.probRuin >= RUIN_THRESH) {
      await fetch(`${SB}/rest/v1/trd_killswitch?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "default", active: true, reason: `risk-monitor: P(ruin)=${(snapshot.probRuin * 100).toFixed(0)}% ≥ ${RUIN_THRESH * 100}%`, updated_at: new Date().toISOString() }) });
      enforced = true; // halts OUR paper executors only; never touches real/manual positions
    }
    return new Response(JSON.stringify({ ok: true, alert, enforced, snapshot }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
