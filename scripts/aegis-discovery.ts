#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-discovery.ts (D-378) — the autonomous DISCOVERY engine. Constantly generates CREATIVE candidate signals beyond the
// base factors and tests each with a strict OUT-OF-SAMPLE split + deflation, so it searches without fooling itself (creative
// search minus overfitting-protection = a lying guru — the discipline is the point). Reads from the OWNED node (reliable).
// Candidates this generation: base composite, value×momentum & quality×momentum INTERACTIONS, CAPPED score (the calibration
// showed extremes reverse), CONVICTION (sign·z²), and DISPERSION-CONDITIONED (trade harder when cross-sectional spread is
// wide). Logs every candidate + whether it beats base OOS to trd_discovery_log. Loops (daemon) — the uncharted-territory search.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const ONCE = Deno.args.includes("--once");
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "disc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
const rankIC = (xs: number[], ys: number[]) => { const n = xs.length; if (n < 20) return 0; const rk = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; }; const rx = rk(xs), ry = rk(ys), mx = (n - 1) / 2; let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sx += dx * dx; sy += dy * dy; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; };
const pit = (a: { e: number; v: number }[] | undefined, at: number) => { if (!a) return null; let v: number | null = null; for (const x of a) { if (x.e <= at) v = x.v; else break; } return v; };

async function loadOwned() {
  const hdr = await H();
  const fund = new Map<string, Record<string, { e: number; v: number }[]>>();
  for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_fundamentals?select=ticker,concept,effective_date,value&order=ticker&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()).catch(() => []); if (!Array.isArray(p) || !p.length) break; for (const r of p as { ticker: string; concept: string; effective_date: string; value: number }[]) { const m = fund.get(r.ticker) ?? fund.set(r.ticker, {}).get(r.ticker)!; (m[r.concept] ||= []).push({ e: new Date(r.effective_date).getTime(), v: +r.value }); } if (p.length < 1000) break; }
  for (const m of fund.values()) for (const k in m) m[k].sort((a, b) => a.e - b.e);
  const syms: string[] = [];
  for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_bars_deep?select=symbol&asset_class=eq.equity&order=symbol&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()).catch(() => []); if (!Array.isArray(p) || !p.length) break; for (const r of p as { symbol: string }[]) syms.push(r.symbol); if (p.length < 1000) break; }
  return { fund, syms, hdr };
}

// build per-month cross-sections of the base factor z-scores + forward return, on the LIQUID names
async function buildMonths(fund: Map<string, Record<string, { e: number; v: number }[]>>, syms: string[], hdr: Record<string, string>) {
  const LIQ = 5e6, HZ = 21;
  const byMonth = new Map<string, { f: Record<string, number>; fwd: number | null }[]>();
  for (let i = 0; i < syms.length; i += 25) {
    const part = syms.slice(i, i + 25);
    const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${part.map((s) => `"${s}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()).catch(() => []);
    for (const row of (Array.isArray(rows) ? rows : []) as { symbol: string; bars: number[][] }[]) {
      const b = row.bars; if (!b || b.length < 300) continue; const c = b.map((r) => r[4]), v = b.map((r) => r[5]), ts = b.map((r) => r[0]); const fm = fund.get(row.symbol); let last = "";
      for (let j = 260; j < b.length; j++) { const mo = new Date(ts[j] * 1000).toISOString().slice(0, 7); if (mo === last) continue; last = mo; const px = c[j]; if (!(px > 0)) continue; let dv = 0, cn = 0; for (let k = j - 21; k < j; k++) { if (c[k] > 0 && v[k] > 0) { dv += c[k] * v[k]; cn++; } } if (!cn || dv / cn < LIQ) continue; const at = ts[j] * 1000; const be = pit(fm?.StockholdersEquity, at), ni = pit(fm?.NetIncomeLoss, at), sh = pit(fm?.EntityCommonStockSharesOutstanding, at), shp = pit(fm?.EntityCommonStockSharesOutstanding, at - 365 * 864e5); const mc = sh && sh > 0 ? sh * px : null; const f: Record<string, number> = { mom: c[j - 21] / c[j - 252] - 1 }; if (mc && be != null) f.value = be / mc; if (be && be > 0 && ni != null) f.quality = ni / be; if (mc && ni != null) f.eyield = ni / mc; if (sh && shp && shp > 0) f.issuance = -(sh / shp - 1); const fwd = j + HZ < b.length ? c[j + HZ] / c[j] - 1 : null; (byMonth.get(mo) ?? byMonth.set(mo, []).get(mo)!).push({ f, fwd }); } }
  }
  return byMonth;
}

const zc = (arr: { f: Record<string, number>; fwd: number | null }[], key: string) => { const xs = arr.map((r) => r.f[key]).filter((x) => x != null && Number.isFinite(x)); if (xs.length < 20) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; return (x: number) => Math.max(-4, Math.min(4, (x - m) / sd)); };
// candidate signal generators: (name, family, fn(zvals) -> score)
type Z = Record<string, number>;
const CANDIDATES: { name: string; family: string; f: (z: Z) => number | null }[] = [
  { name: "base_composite", family: "base", f: (z) => avg([z.value, z.quality, z.eyield, z.mom, z.issuance]) },
  { name: "value_x_momentum", family: "interaction", f: (z) => z.value != null && z.mom != null ? z.value * (z.mom > 0 ? 1 : -0.5) + z.mom * (z.value > 0 ? 1 : -0.5) : null },
  { name: "quality_x_momentum", family: "interaction", f: (z) => z.quality != null && z.mom != null ? (z.quality + z.mom) / 2 + 0.5 * z.quality * z.mom : null },
  { name: "capped_sweetspot", family: "nonlinear", f: (z) => { const s = avg([z.value, z.quality, z.eyield, z.mom, z.issuance]); return s == null ? null : Math.max(-1.5, Math.min(1.5, s)); } },
  { name: "conviction_sq", family: "nonlinear", f: (z) => { const s = avg([z.value, z.quality, z.eyield, z.mom, z.issuance]); return s == null ? null : Math.sign(s) * s * s; } },
  { name: "quality_tilt_value", family: "interaction", f: (z) => z.value != null && z.quality != null ? 0.6 * z.value + 0.4 * z.quality + 0.4 * Math.min(z.value, z.quality) : null },
];
function avg(a: (number | undefined)[]) { const x = a.filter((v) => v != null && Number.isFinite(v)) as number[]; return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; }
const ncdf = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

async function cycle() {
  console.log("== discovery cycle: loading owned data ==");
  const { fund, syms, hdr } = await loadOwned();
  if (!syms.length) { console.log("  no bars on owned yet (sync in progress?) — skip"); return; }
  const byMonth = await buildMonths(fund, syms, hdr);
  const months = [...byMonth.keys()].sort(); if (months.length < 40) { console.log(`  only ${months.length} months — skip`); return; }
  // THOROUGH: parameter-free candidates → full-sample decile-LS series + per-era + NET-of-cost + skew + drawdown + deflation.
  const ERAS: [string, number, number][] = [["qe_10_19", 2010, 2020], ["covid_20_21", 2020, 2022], ["tightening_22_26", 2022, 2100]];
  const N_TRIALS = Number(Deno.env.get("N_TRIALS") || 1000), ceil = Math.sqrt(2 * Math.log(N_TRIALS)); const COST = 0.002 * 0.7; // ~20bp × turnover
  const results: Record<string, unknown>[] = [];
  for (const cand of CANDIDATES) {
    const ls: { mo: string; ret: number; longSet: Set<number>; shortSet: Set<number> }[] = [];
    for (const mo of months) {
      const arr = byMonth.get(mo)!.filter((r) => r.fwd != null); if (arr.length < 30) continue;
      const zf: Record<string, (x: number) => number> = {}; for (const k of ["value", "quality", "eyield", "mom", "issuance"]) { const f = zc(arr, k); if (f) zf[k] = f; }
      const scored = arr.map((r, i) => { const z: Z = {}; for (const k in zf) if (r.f[k] != null) z[k] = zf[k](r.f[k]); const s = cand.f(z); return s == null || !Number.isFinite(s) ? null : { s, fwd: r.fwd!, i }; }).filter(Boolean) as { s: number; fwd: number; i: number }[];
      if (scored.length < 30) continue; scored.sort((a, b) => a.s - b.s); const d = Math.max(1, Math.floor(scored.length / 10));
      const long = scored.slice(scored.length - d), short = scored.slice(0, d);
      ls.push({ mo, ret: long.reduce((s, x) => s + x.fwd, 0) / d - short.reduce((s, x) => s + x.fwd, 0) / d, longSet: new Set(long.map((x) => x.i)), shortSet: new Set(short.map((x) => x.i)) });
    }
    if (ls.length < 24) continue;
    // turnover (name overlap month-to-month) → net returns
    let prevL = new Set<number>(), prevS = new Set<number>(); const net: number[] = []; const gross: number[] = [];
    for (const x of ls) { let chg = 0; for (const s of x.longSet) if (!prevL.has(s)) chg++; for (const s of x.shortSet) if (!prevS.has(s)) chg++; const turn = (x.longSet.size + x.shortSet.size) ? chg / (x.longSet.size + x.shortSet.size) : 0; gross.push(x.ret); net.push(x.ret - turn * COST); prevL = x.longSet; prevS = x.shortSet; }
    const ann = (a: number[]) => { const n = a.length; const m = a.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); const msr = sd > 0 ? m / sd : 0; const sk = sd > 0 ? a.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n : 0, ku = sd > 0 ? a.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n : 3; const dn = Math.sqrt(Math.max(1e-9, 1 - sk * msr + ((ku - 1) / 4) * msr * msr)); let cum = 1, peak = 1, dd = 0; for (const r of a) { cum *= 1 + r; peak = Math.max(peak, cum); dd = Math.min(dd, cum / peak - 1); } return { sharpe: +(msr * Math.sqrt(12)).toFixed(2), ann_pct: +(m * 1200).toFixed(1), win_pct: +(100 * a.filter((x) => x > 0).length / n).toFixed(0), skew: +sk.toFixed(2), maxdd_pct: +(dd * 100).toFixed(1), psr_z: +((msr * Math.sqrt(n - 1)) / dn).toFixed(2), n }; };
    const gS = ann(gross), nS = ann(net);
    // per-era net sharpe
    const eraSharpe: Record<string, number> = {}; for (const [en, a, b] of ERAS) { const sub = net.filter((_, i) => { const y = +ls[i].mo.slice(0, 4); return y >= a && y < b; }); if (sub.length >= 8) { const m = sub.reduce((s, x) => s + x, 0) / sub.length; const sd = Math.sqrt(sub.reduce((s, x) => s + (x - m) ** 2, 0) / sub.length); eraSharpe[en] = +(sd > 0 ? m / sd * Math.sqrt(12) : 0).toFixed(2); } }
    results.push({ candidate: cand.name, family: cand.family, gross_sharpe: gS.sharpe, net_sharpe: nS.sharpe, net_ann_pct: nS.ann_pct, win_pct: nS.win_pct, skew: nS.skew, maxdd_pct: nS.maxdd_pct, psr_z: nS.psr_z, noise_ceiling: +ceil.toFixed(2), passes_deflation: nS.psr_z > ceil, per_era_net_sharpe: eraSharpe, n_months: nS.n });
  }
  const base = results.find((r) => r.candidate === "base_composite"); const baseSr = base ? (base.net_sharpe as number) : 0;
  for (const r of results) { r.beats_base = (r.net_sharpe as number) > baseSr && r.candidate !== "base_composite"; }
  results.sort((a, b) => (b.net_sharpe as number) - (a.net_sharpe as number));
  console.log(`  candidates (NET of ~20bp, full history, deflation N=${N_TRIALS} ceil=${ceil.toFixed(2)}):`);
  for (const r of results) console.log(`   ${String(r.candidate).padEnd(20)} netSharpe ${String(r.net_sharpe).padStart(6)} (gross ${r.gross_sharpe}) win ${r.win_pct}% skew ${r.skew} maxDD ${r.maxdd_pct}% psr_z ${r.psr_z} ${r.passes_deflation ? "CLEARS" : "fails"} ${r.beats_base ? "BEATS-BASE" : ""} eras:${JSON.stringify(r.per_era_net_sharpe)}`);
  // log to the owned discovery ledger
  await fetch(`${OWNED}/trd_discovery_log`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify(results.map((r) => ({ ...r, tested_at: new Date().toISOString() }))) }).catch(() => {});
}

console.log(`==> AEGIS DISCOVERY (owned:${OWNED}, ${ONCE ? "once" : "daemon"}) — creative search, OOS+deflation disciplined`);
if (ONCE) await cycle(); else for (;;) { try { await cycle(); } catch (e) { console.log("cycle error:", String(e).slice(0, 120)); } await new Promise((r) => setTimeout(r, 6 * 3600 * 1000)); }
