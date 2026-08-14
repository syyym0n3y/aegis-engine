// trd-tbr-tick — autonomous forward tracker for the pre-registered NY Time Based Range sweep-reversal
// on Gold (gold-tbr-v1). Runs the EXACT method on fresh GC=F 5m data and records ONLY setups whose
// NY date is AFTER registration → a single, un-deflated forward trial. Keyless, $0, no orders.
// Instruments an uncontrollable (does the Gold-TBR lead hold?) so it resolves into owned knowledge.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const NY_OFF = 4, TBR_START = 8 * 60 + 12, TBR_END = 9 * 60 + 12, OPEN = 9 * 60 + 30, DAY_END = 16 * 60, COST_R = 0.05;

interface Bar { t: number; o: number; h: number; l: number; c: number; d: string; m: number; }
async function gold5m(): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=5m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; const ny = new Date((t[i] - NY_OFF * 3600) * 1000); out.push({ t: t[i], o, h, l, c, d: ny.toISOString().slice(0, 10), m: ny.getUTCHours() * 60 + ny.getUTCMinutes() }); }
  return out;
}
function runTBR(bars: Bar[]): { day: string; side: string; r: number }[] {
  const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.d) ?? byDay.set(b.d, []).get(b.d)!).push(b);
  const out: { day: string; side: string; r: number }[] = [];
  for (const [day, bs] of byDay) {
    bs.sort((a, b) => a.t - b.t);
    const win = bs.filter((b) => b.m >= TBR_START && b.m < TBR_END); if (win.length < 3) continue;
    const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
    const after = bs.filter((b) => b.m >= OPEN && b.m < DAY_END);
    let swept: "hi" | "lo" | null = null, ext = 0, k = 0;
    for (; k < after.length; k++) { if (after[k].h > hi) { swept = "hi"; ext = after[k].h; break; } if (after[k].l < lo) { swept = "lo"; ext = after[k].l; break; } }
    if (!swept) continue;
    let cisd = -1; for (let m = k + 1; m < after.length; m++) { if (swept === "lo" && after[m].c > lo) { cisd = m; break; } if (swept === "hi" && after[m].c < hi) { cisd = m; break; } }
    if (cisd < 0 || cisd + 1 >= after.length) continue;
    const entry = after[cisd + 1].o, side = swept === "lo" ? "long" : "short", stop = ext, target = swept === "lo" ? hi : lo, risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;
    if (side === "long" && !(target > entry && stop < entry)) continue;
    if (side === "short" && !(target < entry && stop > entry)) continue;
    let r: number | null = null;
    for (let m = cisd + 1; m < after.length; m++) { const b = after[m]; if (side === "long") { if (b.l <= stop) { r = -1; break; } if (b.h >= target) { r = (target - entry) / risk; break; } } else { if (b.h >= stop) { r = -1; break; } if (b.l <= target) { r = (entry - target) / risk; break; } } }
    if (r === null) { const last = after[after.length - 1].c; r = (side === "long" ? last - entry : entry - last) / risk; }
    out.push({ day, side, r: +(r - 2 * COST_R).toFixed(4) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-tbr-tick", p_outcome: o.slice(0, 180) }),
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
    const pre = await fetch(`${SB}/rest/v1/trd_prereg?id=eq.gold-tbr-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const h = (pre as any[])[0]; if (!h) throw new Error("gold-tbr-v1 not registered");
    const regDay = String(h.registered_at).slice(0, 10);
    const bars = await gold5m(); if (bars.length < 200) throw new Error(`only ${bars.length} bars`);
    const all = runTBR(bars);
    const st = await fetch(`${SB}/rest/v1/trd_prereg_state?hyp_id=eq.gold-tbr-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const prev = (st as any[])[0] ?? { forward_trades: [], last_entry_ts: null };
    const cutoff = prev.last_entry_ts && prev.last_entry_ts > regDay ? prev.last_entry_ts : regDay;
    const fresh = all.filter((t) => t.day > cutoff); // forward-only: NY date strictly after registration/last
    const merged = [...(prev.forward_trades ?? []), ...fresh.map((t) => ({ entryTs: t.day, side: t.side, r: t.r }))];
    const rs = merged.map((t: any) => t.r); const exp = mean(rs), tot = rs.reduce((a: number, b: number) => a + b, 0);
    const lastDay = merged.length ? merged[merged.length - 1].entryTs : prev.last_entry_ts;
    await fetch(`${SB}/rest/v1/trd_prereg_state?on_conflict=hyp_id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hyp_id: "gold-tbr-v1", forward_trades: merged, last_entry_ts: lastDay, fwd_n: merged.length, fwd_expectancy_r: +exp.toFixed(4), fwd_total_r: +tot.toFixed(3), updated_at: new Date().toISOString() }) });
    const baseline = all.filter((t) => t.day <= regDay).map((t) => t.r);
    return new Response(JSON.stringify({ ok: true, hyp: "gold-tbr-v1", registeredDay: regDay, newSetupsThisTick: fresh.length, forwardN: merged.length, forwardExpectancyR: +exp.toFixed(4), forwardTotalR: +tot.toFixed(3), baseline_inSampleN: baseline.length, baseline_inSampleExpR: +mean(baseline).toFixed(4), verdict: merged.length < 30 ? `accumulating (${merged.length}/30 forward setups)` : exp > 0 ? "forward-positive — the Gold-TBR lead holds" : "forward-negative — the lead did not hold" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
