// trd-stablecoin-tick — forward tracker for stablecoin-flow-v1 (the on-chain dry-powder lead, D-095).
// Weekly signal: USDT+USDC 7d supply growth vs trailing median → long BTC if above, short if below;
// record the resolved 7d forward return. ONLY weeks AFTER registration (un-deflated forward trial).
// No look-ahead (trailing median; only resolved weeks recorded). Keyless, $0, no orders.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

async function cg(id: string, key: string): Promise<Map<string, number>> {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const m = new Map<string, number>();
  for (const [ms, v] of (j[key] ?? [])) m.set(new Date(ms).toISOString().slice(0, 10), v);
  return m;
}
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-stablecoin-tick", p_outcome: o.slice(0, 180) }),
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
    const pre = await fetch(`${SB}/rest/v1/trd_prereg?id=eq.stablecoin-flow-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const h = (pre as any[])[0]; if (!h) throw new Error("stablecoin-flow-v1 not registered");
    const regDay = String(h.registered_at).slice(0, 10);
    const btc = await cg("bitcoin", "prices"), usdt = await cg("tether", "market_caps"), usdc = await cg("usd-coin", "market_caps");
    const dates = [...btc.keys()].filter((d) => usdt.has(d) && usdc.has(d)).sort();
    const stable = (d: string) => (usdt.get(d) || 0) + (usdc.get(d) || 0);
    const today = new Date().toISOString().slice(0, 10);
    // build weekly signals (every 7 days), trailing median, resolved 7d forward
    const growths: number[] = []; const sigs: { d: string; pos: number; r: number }[] = [];
    for (let i = 7; i + 7 < dates.length; i += 7) {
      const d = dates[i]; const g = stable(dates[i - 7]) > 0 ? stable(d) / stable(dates[i - 7]) - 1 : null; if (g === null) continue;
      const med = growths.length >= 4 ? median(growths) : 0; growths.push(g);
      if (dates[i + 7] > today) break;                    // not resolved yet
      const pos = Math.sign(g - med); const fwd = btc.get(dates[i + 7])! / btc.get(d)! - 1;
      sigs.push({ d, pos, r: +(pos * fwd).toFixed(4) });
    }
    const st = await fetch(`${SB}/rest/v1/trd_prereg_state?hyp_id=eq.stablecoin-flow-v1&select=*`, { headers: hdr }).then((r) => r.json());
    const prev = (st as any[])[0] ?? { forward_trades: [], last_entry_ts: null };
    const cutoff = prev.last_entry_ts && prev.last_entry_ts > regDay ? prev.last_entry_ts : regDay;
    const fresh = sigs.filter((x) => x.d > cutoff);       // forward-only, post-registration
    const merged = [...(prev.forward_trades ?? []), ...fresh.map((x) => ({ entryTs: x.d, side: x.pos > 0 ? "long" : "short", r: x.r }))];
    const rs = merged.map((t: any) => t.r); const exp = rs.length ? rs.reduce((a: number, b: number) => a + b, 0) / rs.length : 0; const tot = rs.reduce((a: number, b: number) => a + b, 0);
    const lastDay = merged.length ? merged[merged.length - 1].entryTs : prev.last_entry_ts;
    await fetch(`${SB}/rest/v1/trd_prereg_state?on_conflict=hyp_id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hyp_id: "stablecoin-flow-v1", forward_trades: merged, last_entry_ts: lastDay, fwd_n: merged.length, fwd_expectancy_r: +exp.toFixed(4), fwd_total_r: +tot.toFixed(3), updated_at: new Date().toISOString() }) });
    const baseline = sigs.filter((x) => x.d <= regDay).length;
    return new Response(JSON.stringify({ ok: true, hyp: "stablecoin-flow-v1", registeredDay: regDay, newWeeksThisTick: fresh.length, forwardN: merged.length, forwardExpectancyPerWk: +exp.toFixed(4), baseline_inSampleWeeks: baseline, verdict: merged.length < 20 ? `accumulating (${merged.length}/20 forward weeks)` : exp > 0 ? "forward-positive — dry-powder flow holds" : "forward-negative — did not hold" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
