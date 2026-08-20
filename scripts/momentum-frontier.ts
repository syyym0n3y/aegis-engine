#!/usr/bin/env -S deno run --allow-net --allow-env
// momentum-frontier.ts (D-379) — the DIVERSIFIED cross-asset trend-following frontier. The multiclass map flagged crypto/ETF
// momentum; the deeper truth is that a VOL-SCALED, DIVERSIFIED time-series-momentum portfolio (managed-futures / "A Century of
// Evidence on Trend-Following", Hurst-Ooi-Pedersen) is a documented, decades-OOS edge — the most likely place a NON-marginal,
// deflation-surviving strategy exists in our stack. Reads owned. Builds the risk-parity tsmom book across every non-equity
// class, thoroughly: net-of-cost, per-era, skew, drawdown, deflation — AND a vol-REGIME overlay (trade harder in low-vol,
// lighter in high-vol) to test frontier #2. Honest: measured, not promised.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; };

const stat = (a: number[], ann: number, cost = 0) => {
  const x = a.map((r) => r - cost).filter(Number.isFinite); const n = x.length; if (n < 12) return null;
  const m = x.reduce((s, y) => s + y, 0) / n; const sd = Math.sqrt(x.reduce((s, y) => s + (y - m) ** 2, 0) / (n - 1)); const msr = sd > 0 ? m / sd : 0;
  const sk = sd > 0 ? x.reduce((s, y) => s + ((y - m) / sd) ** 3, 0) / n : 0, ku = sd > 0 ? x.reduce((s, y) => s + ((y - m) / sd) ** 4, 0) / n : 3;
  const dn = Math.sqrt(Math.max(1e-9, 1 - sk * msr + ((ku - 1) / 4) * msr * msr)); const psrZ = (msr * Math.sqrt(n - 1)) / dn;
  let cum = 1, peak = 1, dd = 0; for (const r of x) { cum *= 1 + r; peak = Math.max(peak, cum); dd = Math.min(dd, cum / peak - 1); }
  return { sharpe: +(msr * Math.sqrt(ann)).toFixed(2), ann_pct: +(m * ann * 100).toFixed(1), win_pct: +(100 * x.filter((y) => y > 0).length / n).toFixed(0), skew: +sk.toFixed(2), maxdd_pct: +(dd * 100).toFixed(1), psr_z: +psrZ.toFixed(2), n };
};

console.log(`==> MOMENTUM FRONTIER (owned:${OWNED})`);
const hdr = await H();
// non-equity instruments (the trending classes) + their bars
const meta = await fetch(`${OWNED}/trd_bars_deep?asset_class=neq.equity&select=symbol,asset_class`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string; asset_class: string }[];
console.log(`instruments: ${meta.length} (${[...new Set(meta.map((m) => m.asset_class))].join(",")})`);
// pull bars, resample monthly, build per-instrument monthly close series
const inst: { sym: string; cls: string; mc: number[]; mt: string[] }[] = [];
for (let i = 0; i < meta.length; i += 15) {
  const part = meta.slice(i, i + 15);
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${part.map((m) => `"${m.symbol}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string; bars: number[][] }[];
  for (const row of rows) { const b = row.bars; if (!b || b.length < 400) continue; const mc: number[] = [], mt: string[] = []; let last = ""; for (const bar of b) { const mo = new Date(bar[0] * 1000).toISOString().slice(0, 7); if (mo !== last) { mc.push(bar[4]); mt.push(mo); last = mo; } else { mc[mc.length - 1] = bar[4]; } } const cls = meta.find((m) => m.symbol === row.symbol)!.asset_class; inst.push({ sym: row.symbol, cls, mc, mt }); }
}
console.log(`loaded ${inst.length} instruments with ≥400 daily bars`);

// build the risk-parity time-series-momentum book: each month, each instrument → sign(12mo trend) × (targetVol/realizedVol)
const LB = 12, TGT = 0.10 / Math.sqrt(12); // 10% annual target per leg
const port = new Map<string, { r: number; w: number }[]>(); // month → contributions
const portPlain = new Map<string, number[]>(); // unscaled sign-only (for comparison)
for (const it of inst) {
  const rets: number[] = []; for (let k = 1; k < it.mc.length; k++) rets.push(it.mc[k] / it.mc[k - 1] - 1);
  for (let k = LB; k < it.mc.length - 1; k++) {
    const trend = it.mc[k] / it.mc[k - LB] - 1; const win = rets.slice(Math.max(0, k - LB), k); const vol = Math.sqrt(win.reduce((s, x) => s + x * x, 0) / (win.length || 1)) || 0.05;
    const fwd = it.mc[k + 1] / it.mc[k] - 1; if (!Number.isFinite(trend) || !Number.isFinite(fwd)) continue;
    const scale = Math.min(3, TGT / vol); const contrib = Math.sign(trend) * scale * fwd; const mo = it.mt[k];
    (port.get(mo) ?? port.set(mo, []).get(mo)!).push({ r: contrib, w: scale }); (portPlain.get(mo) ?? portPlain.set(mo, []).get(mo)!).push(Math.sign(trend) * fwd);
  }
}
const months = [...port.keys()].sort();
const rpBook = months.map((mo) => { const a = port.get(mo)!; const W = a.reduce((s, x) => s + x.w, 0); return W > 0 ? a.reduce((s, x) => s + x.r, 0) / W : 0; }); // risk-weighted
const plainBook = months.map((mo) => { const a = portPlain.get(mo)!; return a.reduce((s, x) => s + x, 0) / a.length; });

console.log("\n=== DIVERSIFIED cross-asset time-series momentum (monthly rebal) ===");
console.log("  risk-parity vol-scaled book, GROSS:", JSON.stringify(stat(rpBook, 12)));
console.log("  risk-parity vol-scaled book, NET ~15bp:", JSON.stringify(stat(rpBook, 12, 0.0015)));
console.log("  sign-only equal-weight book, NET:", JSON.stringify(stat(plainBook, 12, 0.0015)));
// per-era + regime overlay (trade lighter when the book's own recent vol is high)
const ERAS: [string, number, number][] = [["pre15", 0, 2015], ["15_19", 2015, 2020], ["covid_20_21", 2020, 2022], ["22_26", 2022, 2100]];
console.log("  per-era NET Sharpe:"); for (const [en, a, b] of ERAS) { const sub = rpBook.filter((_, i) => { const y = +months[i].slice(0, 4); return y >= a && y < b; }); const s = stat(sub, 12, 0.0015); if (s) console.log(`    ${en}: Sharpe ${s.sharpe} (n=${s.n})`); }
// vol-regime overlay: scale exposure inversely to trailing-6mo book vol
const regime: number[] = []; for (let i = 6; i < rpBook.length; i++) { const w = rpBook.slice(i - 6, i); const v = Math.sqrt(w.reduce((s, x) => s + x * x, 0) / 6) || 0.05; regime.push(rpBook[i] * Math.min(2, 0.04 / v)); }
console.log("  + vol-REGIME overlay (lighter in high-vol), NET:", JSON.stringify(stat(regime, 12, 0.0015)));
console.log("\n(honest: this is the century-documented trend edge measured on OUR stack — believe the NET Sharpe + per-era, not the gross)");
