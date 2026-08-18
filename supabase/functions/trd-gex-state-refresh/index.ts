// trd-gex-state-refresh (D-352) — writes the current GEX vol-regime into trd_gex_state for the engagement gate to read.
// GEX→vol is proven (IC −0.49, every era), so it drives SIZING via vol-targeting: size_mult = target_vol / expected_vol,
// clamped. High-gamma (low expected vol) → size up; short-gamma (high vol) → size down. NOT a strategy-selection gate
// (measured: momentum isn't regime-dependent, D-352). Cron-refreshed so aegis-signals reads it cheaply. Keyless, $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const TARGET_VOL = 12; // %, vol-target for size normalization

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const g = await fetch(`${SB}/functions/v1/trd-gex?symbol=SPY`, { headers: H }).then((r) => r.json()).catch(() => null);
    const vr = g?.vol_regime; if (!vr) return new Response(JSON.stringify({ ok: false, err: "no gex regime" }), { status: 502, headers: cors });
    const expVol = Number(vr.expectedFwdVolPct) || 12;
    const sizeMult = +Math.max(0.4, Math.min(1.4, TARGET_VOL / expVol)).toFixed(3);
    const row = { id: "current", asof: vr.asof, gex_percentile: +Number(vr.percentile).toFixed(3), regime: vr.regime, expected_vol_pct: expVol, size_mult: sizeMult, updated_at: new Date().toISOString() };
    await fetch(`${SB}/rest/v1/trd_gex_state?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-gex-state-refresh", p_outcome: `${vr.regime} pct ${row.gex_percentile} vol ${expVol}% size×${sizeMult}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, ...row }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
