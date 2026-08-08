// trd-intraday-equity — the gap I proxied with crypto: real 1-MINUTE SPY/QQQ (ES/NQ proxies) via Alpaca,
// backtesting the ACTUAL NY Time-Based-Range sweep-reversal the group trades — BOTH directions. Mark the
// 8:12-9:12 ET range → after the 9:30 open wait for a liquidity sweep → enter the reversal → target the
// opposing end, stop beyond the swept extreme. Server-side (Alpaca keys). ?probe=1 = data depth only.
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET };
const DATA = "https://data.alpaca.markets/v2/stocks";
const COST_R = 0.05;

async function minute(sym: string, days: number, maxPages: number): Promise<any[]> {
  const start = new Date(Date.now() - days * 86400000).toISOString();
  let token = ""; const out: any[] = [];
  for (let p = 0; p < maxPages; p++) {
    const url = `${DATA}/bars?symbols=${sym}&timeframe=1Min&start=${start}&limit=10000&feed=iex${token ? `&page_token=${token}` : ""}`;
    const r = await fetch(url, { headers: AH }); if (!r.ok) break;
    const j = await r.json(); const bars = j.bars?.[sym] ?? []; out.push(...bars); token = j.next_page_token ?? ""; if (!token) break;
  }
  // keep RTH-ish, tag ET minute-of-day (EDT = UTC-4)
  return out.map((b: any) => { const d = new Date(b.t); const etMin = ((d.getUTCHours() * 60 + d.getUTCMinutes()) - 4 * 60 + 1440) % 1440; return { t: b.t, day: new Date(d.getTime() - 4 * 3600000).toISOString().slice(0, 10), etMin, o: b.o, h: b.h, l: b.l, c: b.c }; });
}

// NY-TBR: range 8:12-9:12 ET (492-552 min), trade after 9:30 (570) until 16:00 (960); sweep→CISD→opposing end
function tbr(bars: any[]): { r: number; side: string }[] {
  const byDay = new Map<string, any[]>(); for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
  const trades: { r: number; side: string }[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const bs = byDay.get(day)!.sort((a, b) => a.t < b.t ? -1 : 1);
    const win = bs.filter((b) => b.etMin >= 492 && b.etMin < 552); if (win.length < 10) continue;
    const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
    const after = bs.filter((b) => b.etMin >= 570 && b.etMin < 960);
    let side: "long" | "short" | null = null, k = 0, ext = 0;
    for (; k < after.length; k++) { if (after[k].h > hi) { side = "short"; ext = after[k].h; break; } if (after[k].l < lo) { side = "long"; ext = after[k].l; break; } }
    if (!side) continue;
    let cisd = -1; for (let j = k + 1; j < after.length; j++) { if (side === "short" && after[j].c < hi) { cisd = j; break; } if (side === "long" && after[j].c > lo) { cisd = j; break; } }
    if (cisd < 0 || cisd + 1 >= after.length) continue;
    const entry = after[cisd + 1].o, dir = side === "long" ? 1 : -1, stop = ext, target = side === "long" ? hi : lo, risk = Math.abs(entry - stop);
    if (!(risk > 0) || (dir === 1 ? !(target > entry) : !(target < entry))) continue;
    let r: number | null = null;
    for (let j = cisd + 1; j < after.length; j++) { const b = after[j]; if (dir === 1 ? b.l <= stop : b.h >= stop) { r = -1; break; } if (dir === 1 ? b.h >= target : b.l <= target) { r = Math.abs(target - entry) / risk; break; } }
    if (r === null) { const last = after[after.length - 1].c; r = dir * (last - entry) / risk; }
    trades.push({ r: r - COST_R, side });
  }
  return trades;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const agg = (t: { r: number }[]) => t.length ? { n: t.length, exp: +mean(t.map((x) => x.r)).toFixed(3), win: +(t.filter((x) => x.r > 0).length / t.length).toFixed(2) } : { n: 0 };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const P = new URL(req.url).searchParams;
  try {
    if (!SECRET) throw new Error("no Alpaca secret");
    const days = Math.min(1200, +P.get("days")! || 550), pages = Math.min(30, +P.get("pages")! || 20);
    const spy = await minute("SPY", days, pages);
    if (P.get("probe") === "1") { const d = spy.map((b) => b.day); return new Response(JSON.stringify({ ok: true, spy_1min_bars: spy.length, from: d[0], to: d[d.length - 1], distinct_days: new Set(d).size }, null, 2), { headers: cors }); }
    const qqq = await minute("QQQ", days, pages);
    const out: any = { dataDepth: { spyBars: spy.length, qqqBars: qqq.length, from: spy[0]?.day, to: spy[spy.length - 1]?.day, days: new Set(spy.map((b) => b.day)).size } };
    for (const [name, bars] of [["SPY", spy], ["QQQ", qqq]] as const) {
      const t = tbr(bars); out[name] = { all: agg(t), short: agg(t.filter((x) => x.side === "short")), long: agg(t.filter((x) => x.side === "long")) };
    }
    out.note = "Real 1-min NY-TBR sweep-reversal (8:12-9:12 ET range, opposing-end target). Per ANALYSIS_CONTRACT: numbers only, N stated. IEX-free depth is the honest data limit.";
    return new Response(JSON.stringify(out, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
