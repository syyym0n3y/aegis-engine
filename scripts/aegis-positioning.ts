#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-positioning.ts (D-380, CORRECTED D-386) — the combined WATCHLIST. It emits (1) a diversified vol-scaled trend book
// across non-equity instruments and (2) an equity quality-value tilt, sized and dollar-neutral, to trd_positions, DORMANT.
// !! NEITHER LEG IS A VALIDATED EDGE. The trend "0.57 deflation-cleared" of D-379 was an ACCOUNTING ARTIFACT (levered returns
// but unlevered costs, free financing on cash instruments, 4 non-investable legs, and an equity-index-only pre-1993 window):
// honest net Sharpe is 0.22, psr_z 1.26, FAILS (D-384). The equity tilt is tail-driven: 0.30 ex-top-3-months and its psr_z is
// REFUSED (skew 8.5 is outside PSR validity) (D-386). This file therefore produces a research WATCHLIST, not a trade list.
import { adjSharesMs, loadSplits } from "../supabase/functions/_shared/shares-adj.ts";
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const TARGET_VOL = Number(Deno.env.get("TARGET_VOL") || 0.12); // 12% annualised portfolio target
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pos", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
// pitRec keeps the filing timestamp beside the value: a RAW share count is only restatable into today's share
// units by knowing which splits fell after ITS FILING (D-747). pit stays value-only, so no other caller changes.
const pitRec = (a: { e: number; v: number }[] | undefined, at: number) => { if (!a) return null; let r: { e: number; v: number } | null = null; for (const x of a) { if (x.e <= at) r = x; else break; } return r; };
const pit = (a: { e: number; v: number }[] | undefined, at: number) => pitRec(a, at)?.v ?? null;

const hdr = await H();
console.log("==> AEGIS POSITIONING — combining UNVALIDATED legs into a watchlist book, DORMANT/capital-safe");

// EARNING METER (D-381): before emitting a new book, score the PRIOR book's realised PAPER return since it was generated.
// This accrues a live-forward track record with NO capital — the honest evidence that will "earn" the owned box. The Mac Mini
// is justified only when this paper track record crosses the operator's threshold (e.g. N months, positive, in-line Sharpe).
async function scorePrior() {
  const prior = await fetch(`${OWNED}/trd_positions?select=id,generated_at,book&order=generated_at.desc&limit=1`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { id: number; generated_at: string; book: Record<string, unknown> }[];
  if (!Array.isArray(prior) || !prior.length || !prior[0].book) return;
  const b = prior[0].book as { core_trend?: { top_positions?: { sym: string; weight: number }[] }; satellite_equity_quality_value?: { longs?: { sym: string; px: number }[]; shorts?: { sym: string; px: number }[] } };
  const priced: { sym: string; w: number; px0: number }[] = [];
  for (const p of b.satellite_equity_quality_value?.longs ?? []) priced.push({ sym: p.sym, w: 1, px0: p.px });
  for (const p of b.satellite_equity_quality_value?.shorts ?? []) priced.push({ sym: p.sym, w: -1, px0: p.px });
  if (!priced.length) return;
  // F13 FIX: the old meter weighted 12 longs at +1 and 6 shorts at -1 then divided by 18 — a +33% net-long book whose paper
  // return is dominated by market BETA (guaranteed to look good in an up market with zero edge). Make the spread dollar-neutral
  // and report the long side separately so beta is never mistaken for alpha.
  const nL = priced.filter((p) => p.w > 0).length || 1, nSh = priced.filter((p) => p.w < 0).length || 1;
  let pnl = 0, n = 0, longAvg = 0, shortAvg = 0;
  for (const p of priced) { const r = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(p.sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []); const bars = Array.isArray(r) && r.length ? r[0].bars : null; if (!bars?.length) continue; const pxNow = bars[bars.length - 1][4]; if (!(pxNow > 0) || !(p.px0 > 0)) continue; const rr = pxNow / p.px0 - 1; if (p.w > 0) { pnl += 0.5 * rr / nL; longAvg += rr / nL; } else { pnl -= 0.5 * rr / nSh; shortAvg += rr / nSh; } n++; }
  if (n) { const ret = pnl; { const res = await fetch(`${OWNED}/trd_positions?id=eq.${prior[0].id}`, { method: "PATCH", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({ forward_return: +ret.toFixed(4), forward_scored_at: new Date().toISOString() }) }).catch(() => null);
      if (!res || !res.ok) console.log(`WRITE-FAILED trd_positions(patch) ${res ? res.status : "network"}`); } console.log(`   earning-meter (dollar-neutral SPREAD = alpha proxy): ${(ret * 100).toFixed(2)}% | long-side ${(longAvg * 100).toFixed(2)}% (mostly beta) short-side ${(shortAvg * 100).toFixed(2)}% over ${n} names, no capital`); }
}
await scorePrior();

// ---- CORE: diversified trend book (current signals across non-equity instruments) ----
const meta = await fetch(`${OWNED}/trd_bars_deep?asset_class=neq.equity&select=symbol,asset_class`, { headers: hdr }).then((r) => r.json()) as { symbol: string; asset_class: string }[];
const trend: { sym: string; cls: string; dir: string; weight: number; trend12: number }[] = [];
for (let i = 0; i < meta.length; i += 15) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${meta.slice(i, i + 15).map((m) => `"${m.symbol}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) { const b = row.bars; if (!b || b.length < 300) continue; const mc: number[] = []; let last = ""; for (const bar of b) { const mo = new Date(bar[0] * 1000).toISOString().slice(0, 7); if (mo !== last) { mc.push(bar[4]); last = mo; } else mc[mc.length - 1] = bar[4]; } if (mc.length < 13) continue; const k = mc.length - 1; const t12 = mc[k] / mc[k - 12] - 1; const rets: number[] = []; for (let j = Math.max(1, k - 12); j <= k; j++) rets.push(mc[j] / mc[j - 1] - 1); const vol = Math.sqrt(rets.reduce((s, x) => s + x * x, 0) / rets.length) || 0.05; const scale = Math.min(3, (TARGET_VOL / Math.sqrt(12)) / vol); if (Number.isFinite(t12) && Math.abs(t12) > 0.001) trend.push({ sym: row.symbol, cls: meta.find((m) => m.symbol === row.symbol)!.asset_class, dir: t12 > 0 ? "LONG" : "SHORT", weight: +(Math.sign(t12) * scale).toFixed(3), trend12: +(t12 * 100).toFixed(1) }); }
}
// F11 FIX: |weight| is proportional to 1/vol, so sorting on it emitted the LOWEST-VOL instruments (rates/FX), not the highest
// conviction — the identical edge/size conflation fixed in aegis-daily. Rank by trend conviction; keep weight as SIZE only.
trend.sort((a, b) => Math.abs(b.trend12) - Math.abs(a.trend12));

// ---- SATELLITE: equity quality-value tilt (current top/bottom) ----
const fund = new Map<string, Record<string, { e: number; v: number }[]>>();
// D-512: 1000-row pages over 4.1M rows = 4,100 requests; one dropped connection killed the agent (stderr 2026-08-23).
// 50k pages + 3-try retry — the owned REST has no row cap and a transient close must not kill the run.
const fetchRetry=async(url:string)=>{for(let a=0;a<3;a++){try{const r=await fetch(url,{headers:hdr});if(r.ok)return await r.json();}catch(_e){/*retry*/}await new Promise(res=>setTimeout(res,2000*(a+1)));}return null;};
for (let off = 0; ; off += 50000) { const p = await fetchRetry(`${OWNED}/trd_fundamentals?select=ticker,concept,effective_date,value&order=ticker&offset=${off}&limit=50000`); if (!Array.isArray(p) || !p.length) break; for (const r of p as { ticker: string; concept: string; effective_date: string; value: number }[]) { const m = fund.get(r.ticker) ?? fund.set(r.ticker, {}).get(r.ticker)!; (m[r.concept] ||= []).push({ e: new Date(r.effective_date).getTime(), v: +r.value }); } if (p.length < 50000) break; }
for (const m of fund.values()) for (const k in m) m[k].sort((a, b) => a.e - b.e);
// trd_bars_deep closes are SPLIT-ADJUSTED; EntityCommonStockSharesOutstanding is RAW AS FILED (D-747).
const splits = await loadSplits(OWNED, hdr);
console.log(`  splits: ${[...splits.values()].reduce((n, a) => n + a.length, 0)} events across ${splits.size} symbols`);
const esyms: string[] = [];
for (let off = 0; ; off += 1000) { const p = await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`, { headers: hdr }).then((r) => r.json()); if (!Array.isArray(p) || !p.length) break; for (const r of p as { symbol: string }[]) esyms.push(r.symbol); if (p.length < 1000) break; }
const eq: { sym: string; value: number; quality: number; px: number; dvol: number }[] = [];
for (let i = 0; i < esyms.length; i += 25) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${esyms.slice(i, i + 25).map((s) => `"${s}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) { const b = row.bars; if (!b || b.length < 60) continue; const j = b.length - 1; const px = b[j][4]; if (!(px > 0)) continue; let dv = 0, cn = 0; for (let k = Math.max(0, j - 21); k < j; k++) { if (b[k][4] > 0 && b[k][5] > 0) { dv += b[k][4] * b[k][5]; cn++; } } dv = cn ? dv / cn : 0; if (dv < 5e6) continue; const fm = fund.get(row.symbol); const at = b[j][0] * 1000; const be = pit(fm?.StockholdersEquity, at), ni = pit(fm?.NetIncomeLoss, at); const shR = pitRec(fm?.EntityCommonStockSharesOutstanding, at); const sh = shR?.v ?? null; const mc = sh && sh > 0 && shR ? adjSharesMs(sh, splits.get(row.symbol), shR.e) * px : null; if (!mc || be == null || ni == null || !(be > 0)) continue; eq.push({ sym: row.symbol, value: be / mc, quality: ni / be, px: +px.toFixed(2), dvol: dv }); }
}
// cross-sectional z + quality_tilt_value composite
const zc = (k: "value" | "quality") => { const xs = eq.map((r) => r[k]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; return (x: number) => Math.max(-4, Math.min(4, (x - m) / sd)); };
const zv = zc("value"), zq = zc("quality");
const eqScored = eq.map((r) => { const v = zv(r.value), q = zq(r.quality); return { sym: r.sym, px: r.px, score: +(0.6 * v + 0.4 * q + 0.4 * Math.min(v, q)).toFixed(3) }; }).sort((a, b) => b.score - a.score);

// ---- combine + report ----
// F10 FIX + D-384/386 RETRACTION. Old formula sqrt(S1^2+S2^2+2*rho*S1*S2) is a vector norm, not a Sharpe combination: it
// INCREASES with correlation (at rho=1 it returned 1.09 for two identical strategies). Correct equal-risk combination is
// (S1+S2)/sqrt(2+2*rho). Inputs also corrected: trend 0.57 was an accounting artifact (honest 0.22); equity 0.52 is tail-driven
// (0.30 ex-top-3-months, psr_z INVALID at skew 8.5). rho is set conservatively until MEASURED from the two live return series.
const St = Number(Deno.env.get("ST_HONEST") || 0.22);
const Se = Number(Deno.env.get("SE_HONEST") || 0.30);
const rho = Number(Deno.env.get("RHO_MEASURED") || 0.30);
const combined = +((St + Se) / Math.sqrt(2 + 2 * rho)).toFixed(2);
// F12 FIX: every leg was independently scaled to TARGET_VOL, so with ~52 legs and ~5-7 effective independent bets the true
// portfolio vol was ~29%, not the 12% the book advertised. Report gross notional and the effective-bet estimate explicitly.
const grossNotional = trend.reduce((s, t) => s + Math.abs(t.weight), 0);
const effBets = 6;
const est_portfolio_vol = +(TARGET_VOL * Math.sqrt(effBets)).toFixed(3);
const book = { generated_at: new Date().toISOString(), per_leg_target_vol: TARGET_VOL, est_portfolio_vol_UNSCALED: est_portfolio_vol, gross_notional_x: +grossNotional.toFixed(1), effective_bets: effBets, dormant: true,
  core_trend: { n: trend.length, expected_sharpe: St, top_positions: trend.slice(0, 15) },
  satellite_equity_quality_value: { n: eqScored.length, expected_sharpe: Se, longs: eqScored.slice(0, 12).map((r) => ({ ...r, dir: "LONG" })), shorts: eqScored.slice(-6).map((r) => ({ ...r, dir: "SHORT" })) },
  combined_expected_sharpe: combined,
  honest_note: `UNVALIDATED / RETRACTED (D-384, D-386). NEITHER leg is a validated edge: the trend 0.57 was an accounting artifact (honest 0.22 after levered costs + financing + dropping non-investable legs) and the equity tilt is tail-driven (0.30 ex-top-3-months; psr_z REFUSED at skew 8.5). F14: this 12-long/6-short book is NOT the ~150-name decile that was measured, so realised Sharpe will be materially lower (idiosyncratic vol scales as 1/sqrt(n)), and the engine's own calibration found the EXTREME deciles REVERSE. Combined estimate ${combined} uses the corrected formula on honest inputs at rho=${rho}. WATCHLIST ONLY - DORMANT, never auto-armed.` };
{ const res = await fetch(`${OWNED}/trd_positions`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify([{ book, generated_at: book.generated_at }]) }).catch(() => {}).catch(() => null);
  if (!res || !res.ok) console.log(`WRITE-FAILED trd_positions ${res ? res.status : "network"}`); }
console.log(JSON.stringify({ core_trend_n: trend.length, top_trend: trend.slice(0, 8).map((t) => `${t.sym}:${t.dir}`), equity_longs: eqScored.slice(0, 8).map((r) => r.sym), combined_expected_sharpe: combined }, null, 2));
// The stored honest_note has always said NEITHER leg is validated (D-384/D-386 retractions), but this console line — the
// part a human actually reads — called them "two decorrelated edges". Fixed 2026-08-22 (D-457): the summary line must not
// contradict the caveat stored beside it.
console.log(`\n==> BOOK written to trd_positions (DORMANT). Combined expected Sharpe ≈ ${combined} from two UNVALIDATED legs`);
console.log(`    (D-384 trend = accounting artifact; D-386 equity tilt = tail-driven). WATCHLIST ONLY — not edges, never armed.`);
