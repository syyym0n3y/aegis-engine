// trd-value-area — LIVE Auction Market Theory context for the co-pilot: POC / Value Area (VAH/VAL) for the
// developing session, the prior session, and a multi-session composite — via the tested _shared/trd-auction.ts
// core. Crypto (…USDT) uses Binance klines (real volume, deep); equities/indices use Yahoo intraday. Context,
// not a signal. ?symbol=BTCUSDT|SPY  &tf=15m|30m|1h  &lookback=20
import { auctionContext, type PBar } from "../_shared/trd-auction.ts";

async function binance(sym: string, interval: string): Promise<PBar[]> {
  const out: PBar[] = []; let endTime = Date.now();
  for (let p = 0; p < 6; p++) { // ~6k bars is ample for 20+ sessions of 15m/30m/1h
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    for (const c of k) out.push({ h: +c[2], l: +c[3], c: +c[4], v: +c[5], day: new Date(c[0]).toISOString().slice(0, 10) });
    endTime = k[0][0] - 1; if (k.length < 1000) break;
  }
  return out.sort((a, b) => (a.day! < b.day! ? -1 : 1));
}
async function yahoo(sym: string, interval: string): Promise<PBar[]> {
  // Yahoo intraday: 1h→730d, 30m/15m→60d. Enough for prior + composite context.
  const range = interval === "1h" ? "60d" : "60d";
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: PBar[] = [];
  for (let i = 0; i < t.length; i++) { const h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i]; if ([h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ h, l, c, v: v ?? 0, day: new Date(t[i] * 1000).toISOString().slice(0, 10) }); }
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const P = new URL(req.url).searchParams;
    const symbol = (P.get("symbol") ?? "BTCUSDT").toUpperCase();
    const tf = P.get("tf") ?? (symbol.endsWith("USDT") ? "1h" : "1h");
    const lookback = Math.min(60, +P.get("lookback")! || 20);
    const bars = symbol.endsWith("USDT") ? await binance(symbol, tf) : await yahoo(symbol, tf);
    if (bars.length < 50) return new Response(JSON.stringify({ ok: false, err: "insufficient bars", got: bars.length }), { status: 502, headers: cors });
    const ctx = auctionContext(bars, lookback);
    const spot = bars[bars.length - 1].c;
    const rel = (va: typeof ctx.developing) => !va ? null : spot > va.vah ? "above value (acceptance higher / possible trend up)" : spot < va.val ? "below value (acceptance lower / possible trend down)" : "inside value (balanced / rotational, fade edges toward POC)";
    const out = {
      ok: true, symbol, tf, spot, sessions: ctx.sessions,
      developing: ctx.developing, prior: ctx.prior, composite: ctx.composite,
      location_vs_developing: rel(ctx.developing),
      location_vs_composite: rel(ctx.composite),
      read: "POC = fairest price (magnet). Inside value → rotational, fade toward POC. Outside value → acceptance/trend. Prior VAH/VAL + composite are the key S/R the auction references.",
      disclaimer: "AWARENESS context (auction market theory), not investment advice or a signal.",
    };
    return new Response(JSON.stringify(out, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
