#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-daily.ts (D-382) — the DAILY CONDITION ENGINE. Corrected doctrine: not "make money months later", but use ALL the
// data EVERY DAY to identify which instruments are in FAVOURABLE conditions to trade RIGHT NOW. For every instrument across the
// whole stack it reads the current state — MTF trend alignment (daily/weekly/monthly agree?), vol regime (calm=trend-friendly,
// turbulent=stand aside), trend strength scaled by vol — and flags today's favourable LONG/SHORT setups, ranked by edge, with
// the condition rationale. Runs daily on the owned node. DORMANT (surfaced, never auto-armed). Enter when conditions are
// favourable, hold while they remain, exit when they turn — condition-driven, not calendar-driven.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "daily", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
const hdr = await H();
console.log("==> AEGIS DAILY — favourable-condition scan across the whole stack (DORMANT)");

// F19: PAGINATE — the unpaged fetch silently capped at 1000 rows against any db-max-rows backend, so the scan would
// report a 1000-instrument "whole stack" without erroring.
const meta: { symbol: string; asset_class: string }[] = [];
for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_bars_deep?select=symbol,asset_class&order=symbol&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()).catch(() => []); if (!Array.isArray(p) || !p.length) break; meta.push(...p); if (p.length < 1000) break; }
const setups: { sym: string; cls: string; dir: string; align: number; regime: string; edge: number; size: number; dvol_m: number; vol_ann_pct: number; d21: number; d63: number; d252: number; volpct: number }[] = [];
for (let i = 0; i < meta.length; i += 25) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${meta.slice(i, i + 25).map((m) => `"${m.symbol}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) {
    const b = row.bars; if (!b || b.length < 300) continue; const c = b.map((r) => r[4]), v = b.map((r) => r[5]); const k = c.length - 1; const px = c[k]; if (!(px > 0)) continue;
    const cls = meta.find((m) => m.symbol === row.symbol)!.asset_class;
    // LIQUIDITY FLOOR (D-383): trailing-21d avg $volume ≥ $5M/day for equities (the fix — the old score surfaced quiet
    // micro-caps). Non-equity instruments (FX/index/commodity/crypto ETFs) are liquid by nature → exempt from the $ floor.
    let dv = 0, cn = 0; for (let j = k - 21; j < k; j++) { if (c[j] > 0 && v[j] > 0) { dv += c[j] * v[j]; cn++; } } dv = cn ? dv / cn : 0;
    if (cls === "equity" && dv < 5e6) continue;
    // MTF trend: daily(21) / weekly(63) / monthly(252) horizons — do they agree?
    const t21 = c[k] / c[k - 21] - 1, t63 = c[k] / c[k - 63] - 1, t252 = c[k] / c[k - 252] - 1;
    if (![t21, t63, t252].every(Number.isFinite)) continue;
    const signs = [Math.sign(t21), Math.sign(t63), Math.sign(t252)]; const up = signs.filter((s) => s > 0).length, dn = signs.filter((s) => s < 0).length;
    const align = Math.max(up, dn); if (align < 2) continue; const dir = up > dn ? "LONG" : "SHORT";
    // D-385 VALIDATION: the SHORT side is MEASURABLY HARMFUL — over 147k historical setups, short-side directional return
    // averaged −1.21%/21d (downtrends BOUNCE at this horizon, before borrow cost). Shorts are therefore NOT surfaced.
    if (dir === "SHORT") continue;
    // vol regime: current 21d realised vol vs its own 2yr history → percentile (relative, so high-vol classes aren't auto-excluded)
    const rets: number[] = []; for (let j = k - 504; j <= k; j++) if (j > 0 && c[j - 1] > 0) rets.push(c[j] / c[j - 1] - 1);
    const rvNow = Math.sqrt(rets.slice(-21).reduce((s, x) => s + x * x, 0) / 21);
    const win: number[] = []; for (let j = 21; j < rets.length; j++) win.push(Math.sqrt(rets.slice(j - 21, j).reduce((s, x) => s + x * x, 0) / 21));
    const volpct = win.length ? win.filter((v) => v <= rvNow).length / win.length : 0.5;
    const regime = volpct < 0.4 ? "calm" : volpct > 0.75 ? "turbulent" : "normal";
    if (regime === "turbulent") continue;
    const rvAnn = rvNow * Math.sqrt(252) || 0.1;
    // REFINED EDGE = CONVICTION only (NOT vol-scaled — that was the bug conflating edge with sizing): 3/3-alignment bonus ×
    // capped trend strength × acceleration (short trend stronger than long = fresh, not exhausted) × calm-regime bonus.
    // strength: RISK-ADJUSTED trend (trend ÷ its own vol = t-like consistency), squashed by tanh so extremes compress
    // smoothly instead of hitting a hard cap (the hard cap saturated every strong trender to an identical score — a real
    // ranking failure caught in review, D-383). tanh keeps it monotonic: bigger risk-adjusted trend always ranks higher.
    const strength = Math.tanh(Math.abs(t63) / (rvAnn * Math.sqrt(63 / 252) || 0.1));
    const p21 = Math.log1p(t21) / 21, p252 = Math.log1p(t252) / 252; // F16: LOG pace — simple returns don't scale linearly
    const accel = (dir === "LONG" ? p21 > p252 : p21 < p252) ? 1.2 : 1.0;
    const edge = +((align === 3 ? 1.5 : 1.0) * strength * accel * (regime === "calm" ? 1.15 : 1.0) * 100).toFixed(1);
    // SIZE = the vol-scaled risk-parity weight, reported SEPARATELY (target ~15% annualised per position, capped 2.5×)
    const size = +Math.min(2.5, 0.15 / rvAnn).toFixed(2);
    setups.push({ sym: row.symbol, cls, dir, align, regime, edge, size, dvol_m: +(dv / 1e6).toFixed(1), vol_ann_pct: +(rvAnn * 100).toFixed(0), d21: +(t21 * 100).toFixed(1), d63: +(t63 * 100).toFixed(1), d252: +(t252 * 100).toFixed(1), volpct: +volpct.toFixed(2) });
  }
}
setups.sort((a, b) => b.edge - a.edge);
const longs = setups.filter((s) => s.dir === "LONG"), shorts = setups.filter((s) => s.dir === "SHORT");
const day = { scanned_at: new Date().toISOString(), universe: meta.length, favourable: setups.length, dormant: true, validation: "D-385: edge-rank IC OOS ~0.000 (NOT predictive); long-setup return ~= market beta (SR~0.14, worse than owning the index); SHORT side removed (-1.21%/21d). Treat this as a FILTERED WATCHLIST, not an alpha ranking.",
  top_long_conditions: longs.slice(0, 15), top_short_conditions: shorts.slice(0, 10),
  by_class: Object.fromEntries([...new Set(setups.map((s) => s.cls))].map((cl) => [cl, { long: setups.filter((s) => s.cls === cl && s.dir === "LONG").length, short: setups.filter((s) => s.cls === cl && s.dir === "SHORT").length }])),
  note: "Favourable = liquid (equities >=$5M/day) AND >=2/3 timeframes aligned AND not turbulent AND LONG-only (shorts validated harmful). EDGE is a CONVICTION LABEL, NOT a validated predictor — D-385 measured its OOS IC at ~0.000 and found the long-setup return is essentially market beta at a WORSE Sharpe than owning an index. Use as a screen/watchlist; do not treat rank as expected return. SIZE reported separately (vol-scaled). DORMANT." };
{ const res = await fetch(`${OWNED}/trd_daily_conditions`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify([{ scanned_at: day.scanned_at, conditions: day }]) }).catch(() => null);
  if (!res || !res.ok) console.log(`WRITE-FAILED trd_daily_conditions ${res ? res.status : "network"}`); }
console.log(JSON.stringify({ favourable_today: setups.length, longs: longs.length, shorts: shorts.length, top_longs: longs.slice(0, 8).map((s) => `${s.sym}(${s.cls},edge${s.edge},${s.regime})`), top_shorts: shorts.slice(0, 6).map((s) => `${s.sym}(${s.cls})`), by_class: day.by_class }, null, 2));
