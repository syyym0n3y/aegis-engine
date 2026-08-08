// trd-alpaca-minsweep — the free minute-universe sweep (closes D-181's ceiling for US stocks). Pulls Alpaca FREE
// IEX 1-minute bars for one symbol (server-side, using the stored APCA key), runs the two mean-reversion survivors
// — rip-short (RSI>70 & <200MA, short) and dip-buy (RSI<30 & >200MA, long) — with 2×ATR stop / 3R target / 20-bar
// hold, real cost (2bp spread + 8%/yr borrow per hold-day on shorts), plus a matched RANDOM control (D-146), and
// returns the per-symbol R-multiple arrays. The caller aggregates across the basket and runs the gate locally.
// Chunked per-symbol to fit edge limits; NO breakout setups (they explode at minute resolution). $0, no orders.
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET };
const ATRN = 14, RSIN = 14, MALEN = 200, STOP_ATR = 2, TP = 3, MAXHOLD = 20, NCTRL = 2;
const SPREAD_BPS = 2, BORROW_ANNUAL = 0.08, BAR_DAYS = 1 / 390;   // 1-min bar ≈ 1/390 of a trading day
let seed = 20260808; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface Bar { o: number; h: number; l: number; c: number }

async function bars(symbol: string, startISO: string): Promise<Bar[]> {
  const out: Bar[] = []; let token = "";
  for (let page = 0; page < 200; page++) {
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Min&start=${startISO}&feed=iex&limit=10000&adjustment=raw${token ? `&page_token=${token}` : ""}`;
    const r = await fetch(url, { headers: AH }); if (!r.ok) break;
    const j = await r.json(); const bs = j?.bars ?? [];
    for (const b of bs) out.push({ o: b.o, h: b.h, l: b.l, c: b.c });
    token = j?.next_page_token ?? ""; if (!token) break;
  }
  return out;
}
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function sma(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

function simulate(b: Bar[], i: number, dir: 1 | -1): number | null {
  const sd = STOP_ATR * atrArr[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
  const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP;
  let g: number | null = null, held = 0;
  for (let k = i + 1; k < Math.min(i + 1 + MAXHOLD, b.length); k++) { held = k - i; if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { g = -1; break; } if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { g = TP; break; } }
  if (g === null) { const last = Math.min(i + MAXHOLD, b.length - 1); held = last - i; g = dir * (b[last].c - entry) / sd; }
  let cost = (entry * (SPREAD_BPS / 10000) * 2) / sd;
  if (dir === -1) cost += (entry * BORROW_ANNUAL * (held * BAR_DAYS / 365)) / sd;
  return g - cost;
}
let atrArr: number[] = [];

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const symbol = (u.searchParams.get("symbol") ?? "AAPL").toUpperCase();
    const years = Math.min(4, Math.max(1, Number(u.searchParams.get("years") ?? 2)));
    const start = new Date(Date.now() - years * 365 * 864e5).toISOString().slice(0, 10);
    const b = await bars(symbol, start);
    if (b.length < MALEN + 100) return new Response(JSON.stringify({ symbol, nbars: b.length, err: "too few bars" }), { headers: cors });
    const cl = b.map((x) => x.c); atrArr = atr(b, ATRN); const r14 = rsi(cl, RSIN), ma = sma(cl, MALEN);
    const pool: number[] = []; for (let i = MALEN + 1; i < b.length - MAXHOLD - 1; i++) if (atrArr[i] > 0 && ma[i] > 0) pool.push(i);
    const rs: Record<string, number[]> = { ripshort_sig: [], ripshort_ctrl: [], dipbuy_sig: [], dipbuy_ctrl: [] };
    for (const i of pool) {
      if (r14[i] > 70 && cl[i] < ma[i]) { const t = simulate(b, i, -1); if (t !== null) { rs.ripshort_sig.push(+t.toFixed(4)); for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = simulate(b, j, -1); if (rc !== null) rs.ripshort_ctrl.push(+rc.toFixed(4)); } } }
      if (r14[i] < 30 && cl[i] > ma[i]) { const t = simulate(b, i, 1); if (t !== null) { rs.dipbuy_sig.push(+t.toFixed(4)); for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = simulate(b, j, 1); if (rc !== null) rs.dipbuy_ctrl.push(+rc.toFixed(4)); } } }
    }
    return new Response(JSON.stringify({ symbol, nbars: b.length, years, ...rs }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
