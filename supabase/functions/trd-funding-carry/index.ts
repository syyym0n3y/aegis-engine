// trd-funding-carry (D-316) — a POSITIONING signal class (not price, not relative-value). Perpetual-swap funding is
// paid every 8h; extreme funding = crowded leverage. FADE it: when funding is extreme-positive (longs crowded) go
// SHORT — you profit if the crowd unwinds AND you COLLECT the funding while short; mirror for extreme-negative.
// Total trade return = position·price-move + carry collected − fee. Low turnover (held across 8h periods), so it is
// cost-tolerant where D-315 cross-sectional was not. Pooled across 16 symbols (independent evidence + sample), tested
// vs a RANDOM-timing control (same holds, random entry times & sides) + split-half OOS. Keyless Binance fapi, $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT","XLMUSDT","BCHUSDT"];
const FEE_BPS = 10;          // Binance USDT-M taker per side (~4-5bp real; 10 is pessimistic); round trip = 2×
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const variance = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const mulberry = (s: number) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

interface Pt { t: number; price: number; f: number }
// aligned 8h series of {price, funding} for one perp (both keyless fapi, paginated)
async function series(sym: string): Promise<Pt[]> {
  const now = Date.now(), start = now - 2.5 * 365 * 864e5;
  // funding history (8h) → map fundingTime → rate
  const fMap = new Map<number, number>(); let cur = start, calls = 0;
  while (cur < now && calls < 12) {
    calls++;
    const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${cur}&limit=1000`).catch(() => null);
    if (!r || !r.ok) break; const j = await r.json().catch(() => null); if (!Array.isArray(j) || !j.length) break;
    for (const x of j) fMap.set(Math.round((x.fundingTime as number) / 36e5) * 36e5, +x.fundingRate);
    cur = (j[j.length - 1].fundingTime as number) + 1; if (j.length < 1000) break;
  }
  // 8h klines → close by closeTime; align to funding times
  const out: Pt[] = []; cur = start; calls = 0;
  while (cur < now && calls < 12) {
    calls++;
    const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&startTime=${cur}&limit=1000`).catch(() => null);
    if (!r || !r.ok) break; const j = await r.json().catch(() => null); if (!Array.isArray(j) || !j.length) break;
    for (const k of j) { const closeT = Math.round((k[6] as number) / 36e5) * 36e5; const f = fMap.get(closeT); if (f !== undefined) out.push({ t: closeT, price: +k[4], f }); }
    cur = (j[j.length - 1][6] as number) + 1; if (j.length < 1000) break;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const S = await Promise.all(SYMS.map(series)).catch(() => []);   // fapi is free/keyless; parallel fetch is fine here
    const goodIdx = (S as Pt[][]).map((s, i) => ({ s, i })).filter((x) => x.s.length > 200);
    const good = goodIdx.map((x) => x.s);
    if (good.length < 6) return new Response(JSON.stringify({ ok: false, err: `only ${good.length} symbols with data` }), { status: 500, headers: cors });

    // BREADTH mode: run ONE config and report the per-symbol edge (is it broad, or carried by 1-2 coins?)
    if (u.searchParams.get("breakdown") === "1") {
      const zWin = +(u.searchParams.get("z") || "84"), zThr = +(u.searchParams.get("thr") || "2"), hold = +(u.searchParams.get("h") || "9");
      const cost = 2 * (FEE_BPS / 1e4); const per: Record<string, unknown>[] = [];
      for (const gi of goodIdx) {
        const s = gi.s; const n = s.length; const rs: number[] = [];
        for (let i = zWin; i + hold < n; i++) {
          let sum = 0, sq = 0; for (let j = i - zWin; j < i; j++) { sum += s[j].f; sq += s[j].f * s[j].f; }
          const mu = sum / zWin, sd = Math.sqrt(Math.max(1e-12, sq / zWin - mu * mu)); const z = (s[i].f - mu) / sd;
          if (Math.abs(z) < zThr) continue; const dir = z > 0 ? -1 : 1;
          let carry = 0; for (let j = i + 1; j <= i + hold; j++) carry += -dir * s[j].f;
          rs.push(dir * (s[i + hold].price / s[i].price - 1) + carry - cost);
        }
        const m = mean(rs), t = rs.length > 2 ? m / (Math.sqrt(variance(rs) / rs.length)) : 0;
        per.push({ sym: SYMS[gi.i], n: rs.length, mean_r: +(m || 0).toFixed(5), t: +(t || 0).toFixed(2), pos: m > 0 });
      }
      return new Response(JSON.stringify({ ok: true, cfg: `fade|z${zWin}|thr${zThr}|h${hold}`, symbols_positive: per.filter((p) => p.pos).length, per_symbol: per.sort((a, b) => (b.mean_r as number) - (a.mean_r as number)) }, null, 2), { headers: cors });
    }

    const cost = 2 * (FEE_BPS / 1e4);
    const results: Record<string, unknown>[] = [], notable: Record<string, unknown>[] = [];
    for (const zWin of [21, 42, 84]) {           // z-score window in 8h periods (7d/14d/28d)
      for (const zThr of [1.0, 1.5, 2.0]) {
        for (const hold of [1, 3, 9]) {           // hold in 8h periods (8h/24h/3d)
          const setup: { r: number; half: number }[] = [], ctrl: number[] = [];
          for (let si = 0; si < good.length; si++) {
            const s = good[si]; const n = s.length; const half = Math.floor(n / 2);
            const rnd = mulberry(si * 7919 + zWin * 31 + Math.round(zThr * 10) * 7 + hold);
            for (let i = zWin; i + hold < n; i++) {
              // z-score of current funding vs trailing window
              let sum = 0, sq = 0; for (let j = i - zWin; j < i; j++) { sum += s[j].f; sq += s[j].f * s[j].f; }
              const mu = sum / zWin, sd = Math.sqrt(Math.max(1e-12, sq / zWin - mu * mu));
              const z = (s[i].f - mu) / sd;
              if (Math.abs(z) < zThr) continue;
              const dir = z > 0 ? -1 : 1;                                  // FADE crowded funding
              const priceRet = dir * (s[i + hold].price / s[i].price - 1);
              let carry = 0; for (let j = i + 1; j <= i + hold; j++) carry += -dir * s[j].f;   // collect while positioned
              setup.push({ r: priceRet + carry - cost, half: i < half ? 0 : 1 });
              // matched random-timing control: random entry, random side, same hold, same formula
              const ri = zWin + Math.floor(rnd() * (n - zWin - hold - 1)); const rdir = rnd() < 0.5 ? 1 : -1;
              let rc = 0; for (let j = ri + 1; j <= ri + hold; j++) rc += -rdir * s[j].f;
              ctrl.push(rdir * (s[ri + hold].price / s[ri].price - 1) + rc - cost);
            }
          }
          if (setup.length < 100) continue;
          const sr = setup.map((x) => x.r), grossR = mean(sr);
          const priceMean = 0, edge = grossR - mean(ctrl);
          const se = Math.sqrt(variance(sr) / sr.length + variance(ctrl) / ctrl.length), t = se > 0 ? edge / se : 0;
          const h1 = setup.filter((x) => x.half === 0).map((x) => x.r), h2 = setup.filter((x) => x.half === 1).map((x) => x.r);
          const c1 = ctrl.slice(0, h1.length), c2 = ctrl.slice(h1.length);
          const e1 = h1.length && c1.length ? mean(h1) - mean(c1) : NaN, e2 = h2.length && c2.length ? mean(h2) - mean(c2) : NaN;
          const holdsBoth = h1.length >= 30 && h2.length >= 30 && e1 > 0 && e2 > 0;
          const passes = t >= 2 && holdsBoth && grossR > 0;
          const cfg = `fade|z${zWin}|thr${zThr}|h${hold}`;
          results.push({ cfg, direction: "fade", z_win: zWin, z_thr: zThr, hold, n_signals: setup.length, gross_r: +grossR.toFixed(6), net_r: +grossR.toFixed(6), skill_edge: +edge.toFixed(6), skill_t: +t.toFixed(2), oos_h1: Number.isFinite(e1) ? +e1.toFixed(6) : null, oos_h2: Number.isFinite(e2) ? +e2.toFixed(6) : null, holds_both: holdsBoth, passes, run_at: new Date().toISOString() });
          if (t >= 2) notable.push({ cfg, n: setup.length, gross_r_per_trade: +grossR.toFixed(5), skill_t: +t.toFixed(2), holds_both: holdsBoth, PASSES: passes });
        }
      }
    }
    if (results.length) await fetch(`${SB}/rest/v1/trd_funding_results?on_conflict=cfg`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(results) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-funding-carry", p_outcome: `symbols ${good.length}, cfgs ${results.length}, ${results.filter((r) => r.passes).length} pass` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, symbols: good.length, configs_tested: results.length, passers: results.filter((r) => r.passes).length, notable: notable.sort((a, b) => (b.skill_t as number) - (a.skill_t as number)).slice(0, 10) }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
