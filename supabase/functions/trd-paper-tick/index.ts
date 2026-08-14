// trd-paper-tick — autonomous live paper loop, MULTI-MARKET + MULTI-SESSION. Trades a basket
// of 24h crypto majors (so it spans Asia/London/NY entry sessions worldwide), tags each setup
// by session (fvg:london, sweep:asia…) so the adaptive allocator learns WHICH session an edge
// lives in. Firewall caps total 'crypto' correlated exposure. Keyless, $0, no order path.
//
// MACRO OVERLAY (trd-macro): before firing, every order's risk fraction is multiplied by the live
// macro de-risk factor from trd_macro_state (1.0 = benign, <1 = fragile regime → shrink size). The
// overlay can only ever REDUCE size; it never predicts direction and never levers up.
import { detectSetups } from "./trd-setups.ts";
import { allocate, proposeOrder } from "./trd-bot.ts";
import { evaluateOrder } from "./trd-firewall.ts";
import { newAccount, onBar, openPosition, toFirewallState } from "./trd-paper-broker.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMBOLS = ["BTC/USD", "ETH/USD", "LTC/USD", "BCH/USD", "SOL/USD", "DOGE/USD", "AVAX/USD", "LINK/USD", "UNI/USD", "AAVE/USD"];
const POLICY = { maxRiskPerTradeFrac: 0.01, maxDailyLossFrac: 0.04, maxDrawdownFrac: 0.25, maxConcurrentPositions: 4, maxCorrelatedRiskFrac: 0.03, maxTradesPerDay: 12, cooldownAfterLosses: 4, cooldownMinutes: 120, requireStopLoss: true, maxLeverage: 10, noTradeHoursUtc: [] as number[] };
const BOT = { portfolioTargetVolAnnual: 0.20, maxRiskPerTradeFrac: 0.01, minTradesToTrust: 30, tradesPerYear: 35040, kellyFraction: 0.5 };
function sess(h: number) { return h >= 0 && h < 7 ? "asia" : h < 13 ? "london" : h < 21 ? "ny" : "asia"; }
async function fetchBars() { const start = new Date(Date.now() - 4 * 86400000).toISOString(); const u = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(SYMBOLS.join(","))}&timeframe=15Min&start=${start}&limit=10000`; const r = await fetch(u); const j = await r.json(); const out: Record<string, any[]> = {}; for (const s of SYMBOLS) out[s] = (j.bars?.[s] ?? []).map((b: any) => ({ ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c })); return out; }
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-paper-tick", p_outcome: o.slice(0, 180) }),
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

SERVE(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const sr = await fetch(`${SB}/rest/v1/trd_paper_state?id=eq.default&select=*`, { headers: hdr }); const rows = await sr.json(); const st = rows[0] ?? null;
    // MACRO OVERLAY: read the live de-risk multiplier (defaults to 1.0 = no-op if the pump hasn't run).
    let deRisk = 1, macroPhase = "UNKNOWN";
    try { const mr = await fetch(`${SB}/rest/v1/trd_macro_state?id=eq.default&select=blended_de_risk,economies`, { headers: hdr }); const mrows = await mr.json(); const v = Number(mrows?.[0]?.blended_de_risk); if (Number.isFinite(v) && v > 0) deRisk = Math.min(1, v); macroPhase = mrows?.[0]?.economies?.[0]?.phase ?? "UNKNOWN"; } catch { /* fail open to 1.0 */ }
    // deno-lint-ignore no-explicit-any
    let acct: any = st ? st.account : newAccount(5000);
    let recent: Record<string, any[]> = st ? st.recent_bars : {}; let lastTs: Record<string, string> = st ? st.last_ts : {}; let ticks = st ? st.ticks : 0;
    if (Array.isArray(recent)) recent = {}; if (typeof lastTs === "string" || lastTs === null) lastTs = {};
    const barsMap = await fetchBars();
    const stream: any[] = []; for (const s of SYMBOLS) for (const b of barsMap[s]) stream.push({ sym: s, ...b }); stream.sort((a, b) => a.ts.localeCompare(b.ts));
    let processed = 0, fired = 0, blocked = 0;
    for (const bar of stream) {
      const s = bar.sym;
      if (lastTs[s] && bar.ts <= lastTs[s]) continue;
      onBar(acct, s, bar);
      (recent[s] ??= []).push(bar); if (recent[s].length > 30) recent[s].shift();
      if (recent[s].length >= 22) {
        const session = sess(new Date(bar.ts).getUTCHours());
        const trig = detectSetups(recent[s], { lookback: 20, rMult: 2 }).filter((x) => x.ts === bar.ts);
        for (const stp of trig) {
          const key = `${stp.kind}:${session}`;
          const metrics = allocate(Object.entries(acct.perSetupR).map(([k, rH]) => ({ key: k, rHistory: rH as number[] })), BOT);
          let m = metrics.find((x) => x.key === key) ?? { key, trades: 0, expectancyR: 0, winRate: 0, volR: 1, confidence: 0, weight: 0 };
          if (m.trades < BOT.minTradesToTrust) m = { ...m, weight: Math.max(m.weight, 0.3), expectancyR: Math.max(m.expectancyR, 0.05), confidence: Math.max(m.confidence, 0.2) };
          const order = proposeOrder({ key, side: stp.side, symbol: s, corrGroup: "crypto", hasStopLoss: true, hasTakeProfit: true }, m, BOT.portfolioTargetVolAnnual, BOT);
          order.riskFrac *= deRisk; // ← MACRO OVERLAY: shrink size in a fragile regime (no-op at 1.0)
          const fw = evaluateOrder(order, toFirewallState(acct, new Date(bar.ts).getUTCHours()), POLICY);
          if (fw.decision === "BLOCK") { blocked++; continue; }
          const entry = bar.close, dir = stp.side === "long" ? 1 : -1, risk = Math.abs(entry - stp.stop);
          if (!(risk > 0)) continue; if (stp.side === "long" && stp.stop >= entry) continue; if (stp.side === "short" && stp.stop <= entry) continue;
          if (openPosition(acct, { setupKey: key, symbol: s, side: stp.side, corrGroup: "crypto", entry, stop: stp.stop, target: entry + dir * 2 * risk }, fw.approvedRiskFrac, bar.ts)) fired++;
        }
      }
      lastTs[s] = bar.ts; processed++;
    }
    if (acct.equityCurve.length > 500) acct.equityCurve = acct.equityCurve.slice(-500);
    if (acct.closed.length > 1000) acct.closed = acct.closed.slice(-1000);
    ticks++;
    await fetch(`${SB}/rest/v1/trd_paper_state?on_conflict=id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "default", account: acct, recent_bars: recent, last_ts: lastTs, ticks, updated_at: new Date().toISOString() }) });
    const peak = acct.peakEquity || acct.startEquity; const dd = peak > 0 ? (peak - acct.equity) / peak : 0;
    const perSetup = Object.fromEntries(Object.entries(acct.perSetupR).map(([k, r]) => { const a = r as number[]; return [k, { n: a.length, expectancyR: +(a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0).toFixed(3) }]; }));
    return new Response(JSON.stringify({ ok: true, ticks, markets: SYMBOLS.length, macroPhase, macroDeRisk: +deRisk.toFixed(3), barsProcessedThisTick: processed, firedThisTick: fired, blockedThisTick: blocked, equity: Math.round(acct.equity), startEquity: acct.startEquity, multiple: +(acct.equity / acct.startEquity).toFixed(3), maxDrawdownPct: +(dd * 100).toFixed(1), openPositions: acct.positions.length, totalClosed: acct.closed.length, survived: acct.equity > acct.startEquity * 0.5, perSessionSetup: perSetup }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
