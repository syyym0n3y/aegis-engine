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
// F3 (audit): DROP NON-INVESTABLE legs. ^TNX/^TYX/^IRX are YIELDS IN PERCENT — mc[k+1]/mc[k]−1 on a yield is not a return
// anyone can earn (and near the ZLB ^IRX produced explosive fake "returns"); ^VIX has no instrument that delivers its return.
// Under risk parity these 4 carried ~7.7% of book risk on fictional P&L. Rate exposure belongs via TLT/IEF/SHY total returns.
const NON_INVESTABLE = new Set(["^TNX", "^TYX", "^IRX", "^VIX"]);
const metaAll = await fetch(`${OWNED}/trd_bars_deep?asset_class=neq.equity&select=symbol,asset_class`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string; asset_class: string }[];
const meta = metaAll.filter((m) => !NON_INVESTABLE.has(m.symbol));
console.log(`excluded non-investable: ${metaAll.length - meta.length} (${[...NON_INVESTABLE].join(",")})`);
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
// F4 (audit): BREADTH FLOOR. Pre-1993 the book held only equity-index levels (~41% of the sample) — that is levered equity
// index timing across the most flattering trend window ever, NOT a diversified cross-asset book. Require >=MIN_BREADTH
// instruments in a month for it to count, and report the breadth path so the claim matches what was actually held.
const MIN_BREADTH = Number(Deno.env.get("MIN_BREADTH") || 8);
const allMonths = [...port.keys()].sort();
const months = allMonths.filter((mo) => (port.get(mo)?.length ?? 0) >= MIN_BREADTH);
console.log(`breadth floor >=${MIN_BREADTH}: ${months.length} of ${allMonths.length} months qualify (${months[0]} .. ${months[months.length - 1]})`);
const rpBook = months.map((mo) => { const a = port.get(mo)!; const W = a.reduce((s, x) => s + x.w, 0); return W > 0 ? a.reduce((s, x) => s + x.r, 0) / W : 0; }); // risk-weighted
const plainBook = months.map((mo) => { const a = portPlain.get(mo)!; return a.reduce((s, x) => s + x, 0) / a.length; });

console.log("\n=== DIVERSIFIED cross-asset time-series momentum (monthly rebal) ===");
console.log("  risk-parity vol-scaled book, GROSS:", JSON.stringify(stat(rpBook, 12)));
console.log("  risk-parity vol-scaled book, NET ~15bp:", JSON.stringify(stat(rpBook, 12, 0.0015)));
console.log("  sign-only equal-weight book, NET:", JSON.stringify(stat(plainBook, 12, 0.0015)));
// per-era + regime overlay (trade lighter when the book's own recent vol is high)
const ERAS: [string, number, number][] = [["pre15", 0, 2015], ["15_19", 2015, 2020], ["covid_20_21", 2020, 2022], ["22_26", 2022, 2100]];
console.log("  per-era NET Sharpe:"); for (const [en, a, b] of ERAS) { const sub = rpBook.filter((_, i) => { const y = +months[i].slice(0, 4); return y >= a && y < b; }); const s = stat(sub, 12, 0.0015); if (s) console.log(`    ${en}: Sharpe ${s.sharpe} (n=${s.n})`); }
// vol-regime overlay — AUDIT-CORRECTED (D-384). Bugs found by adversarial audit and fixed here:
//  F1: cost must be LEVERED too — old code did L·r − c (phantom (L−1)·c gain); correct is L·(r − c).
//  F2: leverage above 1× must pay FINANCING — these are cash instruments (ETFs/spot FX/crypto), not futures, so the
//      excess notional costs margin interest (~4%/yr). Ignoring it manufactured Sharpe out of thin air.
const RF_M = Number(Deno.env.get("RF_ANNUAL") || 0.04) / 12; const COST_M = 0.0015;
const regime: number[] = []; const levs: number[] = [];
for (let i = 6; i < rpBook.length; i++) {
  const w = rpBook.slice(i - 6, i); const v = Math.sqrt(w.reduce((s, x) => s + x * x, 0) / 6) || 0.05;
  const L = Math.min(2, 0.04 / v); levs.push(L);
  regime.push(L * (rpBook[i] - COST_M) - Math.max(0, L - 1) * RF_M); // levered net + financing on the excess notional
}
const meanL = levs.reduce((s, x) => s + x, 0) / levs.length;
console.log(`  + vol-REGIME overlay, HONEST NET (levered cost + ${(RF_M * 12 * 100).toFixed(0)}% financing, mean leverage ${meanL.toFixed(2)}x):`, JSON.stringify(stat(regime, 12, 0)));
console.log("\n(honest: this is the century-documented trend edge measured on OUR stack — believe the NET Sharpe + per-era, not the gross)");
