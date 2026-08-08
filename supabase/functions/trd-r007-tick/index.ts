// trd-r007-tick — forward tracker for the pre-registered R-007 conditional directional candidates (D-145).
// Each candidate's spec + registered_at are FROZEN in trd_r007_state. This evaluates each on live free data
// (SPY 15m via Yahoo + ^VIX daily for the regime; BTCUSDT 15m via Binance for the own-vol candidate),
// and counts ONLY trades ENTERED AFTER registered_at → a single un-deflated forward trial per candidate.
// Idempotent: dedupes by entry timestamp. Applies the same realistic regime-cost model as the gate
// (calm .04 / norm .08 / stress .20 R) so forward is comparable to the frozen backtest_oos_net_r.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const HORIZON = 48, STOP_ATR = 2, ATRN = 14;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
interface Bar { t: number; o: number; h: number; l: number; c: number; day: string; }

async function yahoo15m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ t: t[i] * 1000, o, h, l, c, day: new Date(t[i] * 1000).toISOString().slice(0, 10) }); }
  return out;
}
async function binance15m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=1000`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const k = await r.json().catch(() => null); if (!Array.isArray(k)) return [];
  return k.map((c: any) => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], day: new Date(c[0]).toISOString().slice(0, 10) }));
}
async function vixDaily(): Promise<Map<string, number>> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>(); if (!res?.timestamp) return m;
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as number[]; for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i])) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]); return m;
}
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi2(cl: number[]) { const n = 2; const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }

// evaluate one candidate → list of {ts, r} trades (net of regime cost)
function evalCandidate(bars: Bar[], spec: any, vix: Map<string, number>): { ts: number; r: number }[] {
  if (bars.length < 260) return []; const cl = bars.map((x) => x.c); const at = atr(bars, ATRN); const r2 = rsi2(cl);
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of bars) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  const atrPct = (i: number) => { if (i < 200) return "mid"; const w = at.slice(Math.max(0, i - 200), i).filter((x) => x > 0).sort((a, c) => a - c); return w.length && at[i] <= w[Math.floor(w.length / 3)] ? "lo" : "hi"; };
  const out: { ts: number; r: number }[] = []; let i = 60;
  while (i < bars.length - HORIZON - 1) {
    if (!(at[i] > 0)) { i++; continue; }
    const v = vix.get(bars[i].day) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress"; const hl = dayHiLo.get(bars[i].day);
    let dir: 1 | -1 | null = null;
    const cond = spec.condition;
    if (spec.setup === "sweeprev" && hl) {
      if (spec.direction === "short" && bars[i].h > hl.hi && cl[i] < hl.hi) dir = -1;
      if (spec.direction === "long" && bars[i].l < hl.lo && cl[i] > hl.lo) dir = 1;
    } else if (spec.setup === "meanrev" && spec.direction === "long" && r2[i] < 5) dir = 1;
    if (!dir) { i++; continue; }
    // condition filter
    if (cond.dim === "vix" && !((cond.val.startsWith("stress") && vreg === "stress") || (cond.val.startsWith("calm") && vreg === "calm"))) { i++; continue; }
    if (cond.dim === "atr" && atrPct(i) !== "lo") { i++; continue; }
    const stopDist = STOP_ATR * at[i]; if (!(stopDist > bars[i].c * 1e-4)) { i++; continue; }
    const entry = bars[i + 1].o, stop = entry - dir * stopDist; let r: number | null = null, exitI = i + HORIZON;
    for (let k = i + 1; k <= i + HORIZON; k++) { if (dir === 1 ? bars[k].l <= stop : bars[k].h >= stop) { r = -1; exitI = k; break; } }
    if (r === null) r = dir * (bars[i + HORIZON].c - entry) / stopDist; r = Math.max(-1.5, Math.min(r, 15));
    out.push({ ts: bars[i + 1].t, r: r - RCOST[vreg] });
    i = exitI + 1;
  }
  return out;
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const rows = await fetch(`${SB}/rest/v1/trd_r007_state?select=*`, { headers: H }).then((r) => r.json());
    const vix = await vixDaily(); const report: any[] = [];
    for (const row of rows as any[]) {
      const bars = row.market === "BTCUSDT" ? await binance15m(row.market) : await yahoo15m(row.market);
      const all = evalCandidate(bars, row.spec, vix);
      const regMs = Date.parse(row.registered_at);
      const prior: { ts: number; r: number }[] = row.forward_trades ?? []; const seen = new Set(prior.map((x) => x.ts));
      const fresh = all.filter((t) => t.ts > regMs && !seen.has(t.ts));
      const merged = [...prior, ...fresh].sort((a, b) => a.ts - b.ts);
      const expR = merged.length ? merged.reduce((s, x) => s + x.r, 0) / merged.length : null;
      const lastTs = merged.length ? new Date(merged[merged.length - 1].ts).toISOString() : row.registered_at;
      await fetch(`${SB}/rest/v1/trd_r007_state?candidate=eq.${row.candidate}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ forward_trades: merged, forward_n: merged.length, forward_expectancy_r: expR, last_entry_ts: lastTs, updated_at: new Date().toISOString() }) });
      report.push({ candidate: row.candidate, market: row.market, backtest_oos_net_r: row.backtest_oos_net_r, forward_n: merged.length, forward_expectancy_r: expR != null ? +expR.toFixed(4) : null, newThisTick: fresh.length, verdict: merged.length < 30 ? `accumulating ${merged.length}/30 forward trades` : (expR ?? 0) > 0 ? "forward-POSITIVE — holds out of sample" : "forward-negative — does not hold" });
    }
    return new Response(JSON.stringify({ ok: true, registered: "2026-08-05", report }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
