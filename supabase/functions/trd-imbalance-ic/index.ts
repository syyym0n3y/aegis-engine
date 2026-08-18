// trd-imbalance-ic (D-348) — does the closing-auction (MOC) imbalance predict the overnight close→next-open drift?
// Signed imbalance (z-scored per symbol) vs overnight return, pooled rank-IC + per-symbol breadth, hypothesis sign +1
// (buy imbalance → price gaps up). Forward returns from KEYLESS Yahoo daily O/C. Deflation-honest (bumps trial counter).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const imb = await fetch(`${SB}/rest/v1/trd_imbalance?select=symbol,date,imb_signed&order=symbol,date`, { headers: H }).then((r) => r.json()).catch(() => []);
    const bySym = new Map<string, { date: string; imb: number }[]>();
    for (const r of (Array.isArray(imb) ? imb : []) as { symbol: string; date: string; imb_signed: number }[]) { (bySym.get(r.symbol) ?? bySym.set(r.symbol, []).get(r.symbol)!).push({ date: r.date, imb: r.imb_signed }); }
    const allZ: number[] = [], allF: number[] = []; const per: Record<string, unknown>[] = []; let signCorrect = 0, measured = 0;
    for (const [sym, rows] of bySym) {
      // keyless Yahoo daily O/C
      const p2 = Math.floor(Date.now() / 1000);
      const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${p2 - 500 * 86400}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
      const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue;
      const q = res.indicators.quote[0]; const byDate = new Map<string, { o: number; c: number }>(); const dates: string[] = [];
      for (let i = 0; i < res.timestamp.length; i++) { const o = q.open[i], c = q.close[i]; if (o == null || c == null) continue; const d = new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10); byDate.set(d, { o, c }); dates.push(d); }
      // overnight fwd return: (open[next] − close[t]) / close[t]
      const nextOpen = new Map<string, number>(); for (let i = 0; i < dates.length - 1; i++) { const cur = byDate.get(dates[i])!, nxt = byDate.get(dates[i + 1])!; nextOpen.set(dates[i], (nxt.o - cur.c) / cur.c); }
      const zs = rows.map((r) => r.imb), m = zs.reduce((a, b) => a + b, 0) / zs.length, sd = Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, zs.length - 1)); if (!(sd > 0)) continue;
      const X: number[] = [], Y: number[] = [];
      for (const r of rows) { const f = nextOpen.get(r.date); if (f == null || !Number.isFinite(f)) continue; X.push((r.imb - m) / sd); Y.push(f); }
      const ic = rankIC(X, Y); if (ic.n >= 30) { measured++; if (ic.ic > 0) signCorrect++; }
      allZ.push(...X); allF.push(...Y); per.push({ sym, ...ic });
    }
    const pooled = rankIC(allZ, allF);
    await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, hypothesis: "+1 (buy imbalance → overnight gap up)", pooled_ic: pooled.ic, pooled_t: pooled.t, n: pooled.n, breadth_sign_correct: `${signCorrect}/${measured}`, per_symbol: per.sort((a, b) => (b.t as number) - (a.t as number)) }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
