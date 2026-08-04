// trd-squeeze-tick — autonomous forward tracker for btc-squeeze-v1 (the vol-regime lead, D-092).
// Runs the EXACT squeeze-breakout on fresh BTC daily data and records ONLY setups AFTER registration
// → a single un-deflated forward trial. Keyless, $0, no orders. Antifragile: whether the lead holds
// becomes owned knowledge either way.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const W = 20, COST_R = 0.1, HOLD = 15;

interface Bar { d: string; h: number; l: number; c: number; ret: number; }
async function btcDaily(): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=1y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: Bar[] = []; let p: number | null = null;
  for (let i = 0; i < t.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if ([c, h, l].some((x: any) => x == null || !Number.isFinite(x))) continue; const d = new Date(t[i] * 1000).toISOString().slice(0, 10); if (p != null) o.push({ d, h, l, c, ret: c / p - 1 }); p = c; }
  return o;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function runSqueeze(b: Bar[]): { day: string; side: string; r: number }[] {
  const vol: number[] = []; for (let i = W; i < b.length; i++) vol.push(std(b.slice(i - W, i).map((x) => x.ret)));
  const sorted = [...vol].sort((a, z) => a - z); const loT = sorted[Math.floor(vol.length / 3)] ?? 0;
  const out: { day: string; side: string; r: number }[] = [];
  for (let i = W; i + 1 < b.length; i++) {
    const vi = vol[i - W]; if (vi === undefined || vi > loT) continue;
    const win = b.slice(i - W, i); const hh = Math.max(...win.map((x) => x.h)), ll = Math.min(...win.map((x) => x.l)); const rng = hh - ll; if (!(rng > 0)) continue;
    const nx = b[i]; let side = 0; if (nx.c > hh) side = 1; else if (nx.c < ll) side = -1; if (!side) continue;
    const entry = nx.c, target = entry + side * 0.45 * rng, stop = entry - side * 0.225 * rng, risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    let r: number | null = null;
    for (let m = i + 1; m < Math.min(i + HOLD, b.length); m++) { if (side === 1) { if (b[m].l <= stop) { r = -1; break; } if (b[m].h >= target) { r = (target - entry) / risk; break; } } else { if (b[m].h >= stop) { r = -1; break; } if (b[m].l <= target) { r = (entry - target) / risk; break; } } }
    if (r === null) { const last = b[Math.min(i + HOLD - 1, b.length - 1)].c; r = (side === 1 ? last - entry : entry - last) / risk; }
    out.push({ day: nx.d, side: side === 1 ? "long" : "short", r: +(r - COST_R).toFixed(4) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const pre = await fetch(`${SB}/rest/v1/trd_prereg?id=eq.btc-squeeze-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const h = (pre as any[])[0]; if (!h) throw new Error("btc-squeeze-v1 not registered");
    const regDay = String(h.registered_at).slice(0, 10);
    const bars = await btcDaily(); if (bars.length < 60) throw new Error(`only ${bars.length} bars`);
    const all = runSqueeze(bars);
    const st = await fetch(`${SB}/rest/v1/trd_prereg_state?hyp_id=eq.btc-squeeze-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const prev = (st as any[])[0] ?? { forward_trades: [], last_entry_ts: null };
    const cutoff = prev.last_entry_ts && prev.last_entry_ts > regDay ? prev.last_entry_ts : regDay;
    const fresh = all.filter((t) => t.day > cutoff);
    const merged = [...(prev.forward_trades ?? []), ...fresh.map((t) => ({ entryTs: t.day, side: t.side, r: t.r }))];
    const rs = merged.map((t: any) => t.r); const exp = mean(rs), tot = rs.reduce((a: number, b: number) => a + b, 0);
    const lastDay = merged.length ? merged[merged.length - 1].entryTs : prev.last_entry_ts;
    await fetch(`${SB}/rest/v1/trd_prereg_state?on_conflict=hyp_id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hyp_id: "btc-squeeze-v1", forward_trades: merged, last_entry_ts: lastDay, fwd_n: merged.length, fwd_expectancy_r: +exp.toFixed(4), fwd_total_r: +tot.toFixed(3), updated_at: new Date().toISOString() }) });
    const baseline = all.filter((t) => t.day <= regDay).map((t) => t.r);
    return new Response(JSON.stringify({ ok: true, hyp: "btc-squeeze-v1", registeredDay: regDay, newSetupsThisTick: fresh.length, forwardN: merged.length, forwardExpectancyR: +exp.toFixed(4), forwardTotalR: +tot.toFixed(3), baseline_inSampleN: baseline.length, baseline_inSampleExpR: +mean(baseline).toFixed(4), verdict: merged.length < 20 ? `accumulating (${merged.length}/20 forward setups)` : exp > 0 ? "forward-positive — squeeze lead holds" : "forward-negative — lead did not hold" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
