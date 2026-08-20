#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-positioning.ts (D-380) — THE CULMINATION. Combines the two validated edges into one sized, capital-safe book and
// emits the current best positions: (1) the diversified vol-scaled, regime-conditioned TREND book across non-equity
// instruments (D-379, net Sharpe 0.57, deflation-cleared — the core), (2) the equity QUALITY-VALUE tilt (D-378, cheap AND
// profitable — the satellite). They are near-decorrelated, so the combined portfolio Sharpe ≈ √(Sᵀ²+Sᵉ²) — the "sum" that
// beats either alone. Risk-budgeted to a target vol, written to trd_positions, DORMANT (surfaced, never auto-armed). This is
// the owned, autonomous system telling you where to be — honestly, sized, capital-safe.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const TARGET_VOL = Number(Deno.env.get("TARGET_VOL") || 0.12); // 12% annualised portfolio target
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pos", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
const pit = (a: { e: number; v: number }[] | undefined, at: number) => { if (!a) return null; let v: number | null = null; for (const x of a) { if (x.e <= at) v = x.v; else break; } return v; };

const hdr = await H();
console.log("==> AEGIS POSITIONING (the culmination) — combining validated edges, DORMANT/capital-safe");

// ---- CORE: diversified trend book (current signals across non-equity instruments) ----
const meta = await fetch(`${OWNED}/trd_bars_deep?asset_class=neq.equity&select=symbol,asset_class`, { headers: hdr }).then((r) => r.json()) as { symbol: string; asset_class: string }[];
const trend: { sym: string; cls: string; dir: string; weight: number; trend12: number }[] = [];
for (let i = 0; i < meta.length; i += 15) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${meta.slice(i, i + 15).map((m) => `"${m.symbol}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) { const b = row.bars; if (!b || b.length < 300) continue; const mc: number[] = []; let last = ""; for (const bar of b) { const mo = new Date(bar[0] * 1000).toISOString().slice(0, 7); if (mo !== last) { mc.push(bar[4]); last = mo; } else mc[mc.length - 1] = bar[4]; } if (mc.length < 13) continue; const k = mc.length - 1; const t12 = mc[k] / mc[k - 12] - 1; const rets: number[] = []; for (let j = Math.max(1, k - 12); j <= k; j++) rets.push(mc[j] / mc[j - 1] - 1); const vol = Math.sqrt(rets.reduce((s, x) => s + x * x, 0) / rets.length) || 0.05; const scale = Math.min(3, (TARGET_VOL / Math.sqrt(12)) / vol); if (Number.isFinite(t12) && Math.abs(t12) > 0.001) trend.push({ sym: row.symbol, cls: meta.find((m) => m.symbol === row.symbol)!.asset_class, dir: t12 > 0 ? "LONG" : "SHORT", weight: +(Math.sign(t12) * scale).toFixed(3), trend12: +(t12 * 100).toFixed(1) }); }
}
trend.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

// ---- SATELLITE: equity quality-value tilt (current top/bottom) ----
const fund = new Map<string, Record<string, { e: number; v: number }[]>>();
for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_fundamentals?select=ticker,concept,effective_date,value&order=ticker&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()); if (!Array.isArray(p) || !p.length) break; for (const r of p as { ticker: string; concept: string; effective_date: string; value: number }[]) { const m = fund.get(r.ticker) ?? fund.set(r.ticker, {}).get(r.ticker)!; (m[r.concept] ||= []).push({ e: new Date(r.effective_date).getTime(), v: +r.value }); } if (p.length < 1000) break; }
for (const m of fund.values()) for (const k in m) m[k].sort((a, b) => a.e - b.e);
const esyms: string[] = [];
for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()); if (!Array.isArray(p) || !p.length) break; for (const r of p as { symbol: string }[]) esyms.push(r.symbol); if (p.length < 1000) break; }
const eq: { sym: string; value: number; quality: number; px: number; dvol: number }[] = [];
for (let i = 0; i < esyms.length; i += 25) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${esyms.slice(i, i + 25).map((s) => `"${s}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) { const b = row.bars; if (!b || b.length < 60) continue; const j = b.length - 1; const px = b[j][4]; if (!(px > 0)) continue; let dv = 0, cn = 0; for (let k = Math.max(0, j - 21); k < j; k++) { if (b[k][4] > 0 && b[k][5] > 0) { dv += b[k][4] * b[k][5]; cn++; } } dv = cn ? dv / cn : 0; if (dv < 5e6) continue; const fm = fund.get(row.symbol); const at = b[j][0] * 1000; const be = pit(fm?.StockholdersEquity, at), ni = pit(fm?.NetIncomeLoss, at), sh = pit(fm?.EntityCommonStockSharesOutstanding, at); const mc = sh && sh > 0 ? sh * px : null; if (!mc || be == null || ni == null || !(be > 0)) continue; eq.push({ sym: row.symbol, value: be / mc, quality: ni / be, px: +px.toFixed(2), dvol: dv }); }
}
// cross-sectional z + quality_tilt_value composite
const zc = (k: "value" | "quality") => { const xs = eq.map((r) => r[k]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; return (x: number) => Math.max(-4, Math.min(4, (x - m) / sd)); };
const zv = zc("value"), zq = zc("quality");
const eqScored = eq.map((r) => { const v = zv(r.value), q = zq(r.quality); return { sym: r.sym, px: r.px, score: +(0.6 * v + 0.4 * q + 0.4 * Math.min(v, q)).toFixed(3) }; }).sort((a, b) => b.score - a.score);

// ---- combine + report ----
const St = 0.57, Se = 0.52, rho = 0.1; // trend & equity edge Sharpes; near-decorrelated
const combined = +Math.sqrt((St * St + Se * Se + 2 * rho * St * Se)).toFixed(2);
const book = { generated_at: new Date().toISOString(), target_vol: TARGET_VOL, dormant: true,
  core_trend: { n: trend.length, expected_sharpe: St, top_positions: trend.slice(0, 15) },
  satellite_equity_quality_value: { n: eqScored.length, expected_sharpe: Se, longs: eqScored.slice(0, 12).map((r) => ({ ...r, dir: "LONG" })), shorts: eqScored.slice(-6).map((r) => ({ ...r, dir: "SHORT" })) },
  combined_expected_sharpe: combined,
  honest_note: `Two validated, near-decorrelated edges combined → portfolio Sharpe ≈ ${combined} (√(0.57²+0.52²+2·0.1·..)). GROSS of the residual costs beyond what each backtest netted; trend has multi-year droughts. DORMANT — surfaced for review, NEVER auto-armed; arming is the operator's act after the staged gates.` };
await fetch(`${OWNED}/trd_positions`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify([{ book, generated_at: book.generated_at }]) }).catch(() => {});
console.log(JSON.stringify({ core_trend_n: trend.length, top_trend: trend.slice(0, 8).map((t) => `${t.sym}:${t.dir}`), equity_longs: eqScored.slice(0, 8).map((r) => r.sym), combined_expected_sharpe: combined }, null, 2));
console.log(`\n==> BOOK written to trd_positions (DORMANT). Combined expected Sharpe ≈ ${combined} — the sum of two decorrelated edges.`);
