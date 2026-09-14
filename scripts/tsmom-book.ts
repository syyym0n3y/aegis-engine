#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// tsmom-book.ts (D-863) — PREREG: D-863-tsmom-multiasset. The diversified time-series momentum book the record never
// had: sign of trailing 1/3/6/12-month returns (and their equal-weight combination), positions scaled to a target
// per-asset vol from trailing 60-day vol, rebalanced weekly, class costs, across the multi-asset DAILY panel (single
// equities excluded). In-sample 1990-2014 is the POSITIVE CONTROL (the literature's own era must reproduce); OOS is
// 2015-2026, after publication. Then the leverage table the operator's tenfold target is really asking about.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("tsmom-book", [
  { name: "OOS_FROM", def: "2015-01-01" }, { name: "IS_FROM", def: "1990-01-01" }, { name: "VOL_TARGET", def: "0.10", note: "per-asset ex-ante annualised vol" },
  { name: "REBAL_D", def: "5", note: "trading days between rebalances (weekly)" }, { name: "MIN_YEARS", def: "10" }, { name: "UNIV_DROP", def: "", note: "D-901: regex of symbols to EXCLUDE from the selected universe; empty = no change" }, { name: "UNIV_KEEP", def: "", note: "D-901: regex the symbol must MATCH to be kept; empty = no change" }, { name: "MAX_CRYPTO", def: "10" },
  { name: "PLACEABLE", def: "0", note: "1 = D-866: restrict to what a UK retail account can hold (ETFs, index/sector ETFs, commodity CFD proxies, major FX) and charge overnight FINANCING on CFD legs and ETF shorts" },
  { name: "FINANCING", def: "0.065", note: "D-866: annual financing rate on gross CFD/short notional (SOFR ~4% + 2.5%); 0 = the research number" },
  { name: "LONG_ONLY", def: "0", note: "1 = D-868: long-only trend timing — hold vol-scaled when the combo trend is positive, cash otherwise; no shorts, no financing; restricts to ISA-holdable ETFs and cash indices" },
  { name: "RF", def: "0.02", note: "D-868: cash yield while timed out, annual" },
  { name: "CLASS_PARITY", def: "0", note: "1 = D-870: weight the book across classes (equity / bond / precious / commodity) at equal ex-ante vol from trailing 60-day class-sleeve vol, instead of equal weight per asset" },
  { name: "CRYPTO_ONLY", def: "0", note: "1 = D-871: the crypto-with->=8y subset, long-only timed, 20bp spot cost" },
  { name: "ALWAYS_LONG", def: "0", note: "1 = timing OFF in LONG_ONLY mode (the untimed comparator for D-870)" },
  { name: "VOL_OVERLAY", def: "0", note: "1 = D-872: halve every position the day after a close where ^VIX is above its trailing 252-day 80th percentile (term-structure series not held; registered fallback), lag-1" },
  { name: "DUMP", def: "", note: "if set, write the combo book's daily OOS series {date: ret} to this JSON path (for D-873 blends)" },
  { name: "SOURCE_1DSF", def: "0", note: "1 = D-874: load the survivor-free Binance daily perp panel (trd_bars_intraday tf=1dSF, dead contracts included to their last bar) instead of trd_bars_deep" },
  { name: "SF_MIN_BARS", def: "400" },
  { name: "LOOKS", def: "21,63,126,252", note: "D-875: lookbacks (trading days) for the trend combination" }, { name: "VOL_N", def: "60", note: "D-875: trailing window for the per-asset vol scaling" }, { name: "SF_TF", def: "1dSF", note: "D-876: which daily panel the SOURCE_1DSF loader reads (1dSF Binance, 1dBYBIT Bybit)" },
  { name: "LEV", def: "1", note: "D-880: gross leverage on the (crypto) sleeve" }, { name: "FUNDING", def: "0", note: "D-880: 1 = pay realised 8h funding (trd_perp_oi interval=funding) on the full long notional while in position" },
  { name: "RUN_ID", def: "D-863-tsmom-multiasset" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tsm", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const COST: Record<string, number> = { fx: 2, index: 4, intl_index: 4, rate: 4, etf: 4, sector: 4, commodity: 6, crypto: 9 };
const CLASS4 = (c: string) => c === "crypto" ? "crypto" : c === "fx" ? "fx" : c === "commodity" ? "commodity" : "equity-idx/rates";
// ---- panel ----
const meta = await q(`trd_bars_deep?asset_class=in.(commodity,fx,index,intl_index,rate,etf,sector,crypto)&select=symbol,asset_class,first_date,last_date,n_bars&order=first_date.asc`) as { symbol: string; asset_class: string; first_date: string; n_bars: number }[];
const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - +K.MIN_YEARS);
let sel = meta.filter((m) => m.first_date <= cutoff.toISOString().slice(0, 10) && m.n_bars > 2000 && !/^\^VIX$|USDT|^\^IRX$/.test(m.symbol));
const cryptoSel = sel.filter((m) => m.asset_class === "crypto").slice(0, +K.MAX_CRYPTO); sel = [...sel.filter((m) => m.asset_class !== "crypto"), ...cryptoSel];
const PLACEABLE_RE = /^(SPY|QQQ|DIA|IWM|IWF|IWD|EFA|EEM|EWJ|EWZ|EWG|EWU|EWH|EWA|EWC|FXI|VGK|TLT|IEF|SHY|LQD|HYG|GLD|SLV|USO|UNG|XL[IEBFVPYKU]|ITB|KRE|XLRE|SMH|VNQ|GC=F|SI=F|CL=F|BZ=F|HG=F|NG=F|PL=F|EURUSD=X|GBPUSD=X|JPY=X|AUDUSD=X|CAD=X|CHF=X|NZDUSD=X|EURGBP=X|EURJPY=X|GBPJPY=X|AUDJPY=X|EURCHF=X|\^GSPC|\^IXIC|\^DJI|\^RUT|\^FTSE|\^GDAXI|\^FCHI|\^N225|\^HSI|\^AXJO|\^STOXX50E)$/;
const LONGONLY_RE = /^(SPY|QQQ|DIA|IWM|IWF|IWD|EFA|EEM|EWJ|EWZ|EWG|EWU|EWH|EWA|EWC|FXI|VGK|TLT|IEF|SHY|LQD|HYG|GLD|SLV|USO|UNG|XL[IEBFVPYKU]|ITB|KRE|XLRE|SMH|VNQ|\^GSPC|\^IXIC|\^DJI|\^RUT|\^FTSE|\^GDAXI|\^FCHI|\^N225|\^HSI|\^AXJO|\^STOXX50E|\^GSPTSE|\^SSMI|\^IBEX|\^KS11|\^BSESN|\^MXX|\^BVSP)$/;
if (K.CRYPTO_ONLY === "1") { const c8 = new Date(); c8.setUTCFullYear(c8.getUTCFullYear() - 8); sel = meta.filter((m) => m.asset_class === "crypto" && m.first_date <= c8.toISOString().slice(0, 10) && !/USDT|-EX$/.test(m.symbol)); COST.crypto = +(Deno.env.get("CRYPTO_COST_BP") ?? "20"); console.log(`  CRYPTO-ONLY subset: ${sel.length} spot crypto with >= 8y (${sel.map((m) => m.symbol).join(", ")}); spot cost 20bp`); }
else if (K.LONG_ONLY === "1") { sel = sel.filter((m) => LONGONLY_RE.test(m.symbol)); console.log(`  LONG-ONLY TIMING subset: ${sel.length} ETFs / cash indices an ISA can hold; cash at ${(100 * +K.RF).toFixed(1)}% when timed out; no shorts, no financing`); }
if (K.PLACEABLE === "1") { sel = sel.filter((m) => PLACEABLE_RE.test(m.symbol)); console.log(`  PLACEABLE subset: ${sel.length} assets a UK retail account can hold (ETF long / CFD both ways); financing ${(100 * +K.FINANCING).toFixed(1)}%/yr on gross CFD and short notional`); }
// D-901 universe sweep. Both default to empty and cannot alter the book's existing behaviour; they exist because the
// universe was a hardcoded regex with no way to vary it, which is why THE UNIVERSE LAW's own check had never been run
// on the book everything else rests on. The 40-name floor below still applies and turns an over-aggressive drop into
// an UNTESTED rather than a thin result.
if (K.UNIV_DROP) { const re = new RegExp(K.UNIV_DROP); const before = sel.length; sel = sel.filter((m) => !re.test(m.symbol)); console.log(`  UNIV_DROP ${K.UNIV_DROP}: ${before} -> ${sel.length} assets`); }
if (K.UNIV_KEEP) { const re = new RegExp(K.UNIV_KEEP); const before = sel.length; sel = sel.filter((m) => re.test(m.symbol)); console.log(`  UNIV_KEEP ${K.UNIV_KEEP}: ${before} -> ${sel.length} assets`); }
if (K.SOURCE_1DSF !== "1") assertNonEmpty("assets with >= MIN_YEARS", sel, K.CRYPTO_ONLY === "1" ? 2 : K.PLACEABLE === "1" || K.LONG_ONLY === "1" ? 40 : 60);
type Ser = { sym: string; cls: string; ts: number[]; c: number[] };
const S: Ser[] = [];
if (K.SOURCE_1DSF === "1") {
  const metaSF = (await q(`trd_bars_intraday?tf=eq.${K.SF_TF}&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => (r.n_bars ?? 0) >= +K.SF_MIN_BARS);
  COST.crypto = +(Deno.env.get("CRYPTO_COST_BP") ?? "20");
  for (let i = 0; i < metaSF.length; i += 20) { const page = metaSF.slice(i, i + 20); const rows = await q(`trd_bars_intraday?tf=eq.${K.SF_TF}&symbol=in.(${page.map((p) => p.symbol).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[]; for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0 && x[5] > 0).sort((a, z) => a[0] - z[0]); if (b.length < +K.SF_MIN_BARS) continue; S.push({ sym: r.symbol, cls: "crypto", ts: b.map((x) => x[0]), c: b.map((x) => x[4]) }); } }
  if (K.FUNDING === "1") { for (const a of S) { const rows = await q(`trd_perp_oi?symbol=eq.${a.sym}&venue=eq.binance&interval=eq.funding&select=ts,open_interest&order=ts.asc&limit=20000`) as { ts: number; open_interest: number }[]; const m = new Map<string, number>(); for (const r of rows) { const d = day(r.ts); m.set(d, (m.get(d) ?? 0) + r.open_interest); } (a as Ser & { fund?: Map<string, number> }).fund = m; } console.log(`  FUNDING joined for ${S.filter((a) => ((a as Ser & { fund?: Map<string, number> }).fund?.size ?? 0) > 100).length} of ${S.length} contracts (8h rates summed per day)`); }
  console.log(`  SURVIVOR-FREE ${K.SF_TF} panel: ${S.length} contracts with >= ${K.SF_MIN_BARS} daily bars (dead contracts held to their last bar); cost ${COST.crypto}bp`);
}
for (let i = 0; i < (K.SOURCE_1DSF === "1" ? 0 : sel.length); i += 5) { const page = sel.slice(i, i + 5); const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[]; for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); S.push({ sym: r.symbol, cls: r.asset_class, ts: b.map((x) => x[0]), c: b.map((x) => x[4]) }); } }
console.log(`\n==> D-863 DIVERSIFIED TSMOM BOOK — ${S.length} assets: ${Object.entries(S.reduce((a, s) => (a[s.cls] = (a[s.cls] ?? 0) + 1, a), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
// ---- per-asset daily strategy returns for each signal, vol-scaled, weekly rebalance, cost on position changes ----
const LOOK = K.LOOKS.split(",").map(Number); const SIGS = [...LOOK.map(String), "combo"]; const VN = +K.VOL_N;
type Daily = Map<string, number>; // day -> return
const bookRet: Record<string, Daily> = {}; for (const s of SIGS) bookRet[s] = new Map(); const longRet: Daily = new Map();
const GROUP = (a: { sym: string; cls: string }) => a.cls === "crypto" ? "crypto" : a.cls === "fx" ? "fx" : /^(TLT|IEF|SHY|LQD|HYG)$/.test(a.sym) || a.cls === "rate" ? "bond" : /^(GLD|SLV|GC=F|SI=F|PL=F|PA=F)$/.test(a.sym) ? "precious" : a.cls === "commodity" || /^(USO|UNG)$/.test(a.sym) ? "commodity" : "equity";
const grpRet: Record<string, Record<string, Daily>> = {}; const grpN: Record<string, Record<string, Daily>> = {}; const longGrp: Record<string, Daily> = {}; const longGrpN: Record<string, Daily> = {};
const perAsset: Record<string, Record<string, number[]>> = {}; const perAssetLong: Record<string, number[]> = {};
const isOOS = (ts: number) => day(ts) >= K.OOS_FROM, isIS = (ts: number) => day(ts) >= K.IS_FROM && day(ts) < K.OOS_FROM;
// D-872: VIX regime flag per date, from the PRIOR close (lag-1): 1 if VIX close > trailing 252-day 80th percentile
const vixFlag = new Map<string, number>();
if (K.VOL_OVERLAY === "1") { const vb = ((await q(`trd_bars_deep?symbol=eq.%5EVIX&select=bars`) as { bars: number[][] }[])[0]?.bars ?? []).sort((a, b) => a[0] - b[0]); const cl = vb.map((x) => x[4]);
  for (let i = 252; i < vb.length; i++) { const win = cl.slice(i - 252, i).sort((a, b) => a - b); const p80 = win[Math.floor(0.8 * win.length)]; vixFlag.set(day(vb[i][0]), cl[i] > p80 ? 1 : 0); }
  console.log(`  VOL OVERLAY: ${[...vixFlag.values()].filter((v) => v).length} of ${vixFlag.size} VIX days flagged (> trailing-252d 80th pct); positions halved the NEXT day`); }
const overlayMult = (dPrev: string) => K.VOL_OVERLAY === "1" && vixFlag.get(dPrev) === 1 ? 0.5 : 1;
const nDay = new Map<string, number>();
for (const a of S) {
  const n = a.c.length; if (n < 300) continue; const r = new Float64Array(n); for (let i = 1; i < n; i++) r[i] = Math.log(a.c[i] / a.c[i - 1]);
  const cost = COST[a.cls] / 1e4; perAsset[a.sym] = {}; perAssetLong[a.sym] = [];
  for (const sig of SIGS) {
    let pos = 0, lastReb = -1e9; const rets: number[] = [];
    for (let i = 260; i < n - 1; i++) {
      if (i - lastReb >= +K.REBAL_D) {
        lastReb = i; const vol = sd(Array.from(r.slice(i - VN, i))) * Math.sqrt(252); const scale = vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0;
        let sgn = 0; if (sig === "combo") { for (const L of LOOK) sgn += Math.sign(a.c[i] / a.c[i - L] - 1); sgn /= LOOK.length; } else sgn = Math.sign(a.c[i] / a.c[i - +sig] - 1);
        const newPos = K.LONG_ONLY === "1" ? (K.ALWAYS_LONG === "1" || sgn > 0 ? scale : 0) : sgn * scale; const turn = Math.abs(newPos - pos); pos = newPos; rets.push(-turn * cost / 2); // cost charged on the traded fraction (half a round trip per side)
      } else rets.push(0);
      const isEtf = a.cls === "etf" || a.cls === "sector"; const finDaily = (+K.FINANCING / 252) * (isEtf ? Math.max(0, -pos) : Math.abs(pos)) * (K.PLACEABLE === "1" ? 1 : 0);
      const cashD = K.LONG_ONLY === "1" && pos === 0 ? +K.RF / 252 * +K.VOL_TARGET / 0.10 : 0;
      const om = overlayMult(day(a.ts[i]));
      const L = +K.LEV; const fund = K.FUNDING === "1" && pos > 0 ? L * pos * ((a as Ser & { fund?: Map<string, number> }).fund?.get(day(a.ts[i + 1])) ?? 0) : 0;   // D-880: funding paid on the full long notional
      const v = L * om * pos * r[i + 1] + L * rets.pop()! - finDaily + cashD - fund; // next-day return on the position set at close i (lag-1), minus overnight financing on CFD/short notional
      rets.push(v); const d = day(a.ts[i + 1]); const m = bookRet[sig]; m.set(d, (m.get(d) ?? 0) + v); if (sig === "combo") nDay.set(d, (nDay.get(d) ?? 0) + 1);
      if (K.CLASS_PARITY === "1") { const g = GROUP(a); const gr = (grpRet[sig] ??= {}); const gm = (gr[g] ??= new Map()); gm.set(d, (gm.get(d) ?? 0) + v); const gn = (grpN[sig] ??= {}); const gnm = (gn[g] ??= new Map()); gnm.set(d, (gnm.get(d) ?? 0) + 1); }
      if (sig === "combo" && isOOS(a.ts[i + 1])) perAsset[a.sym][sig] = perAsset[a.sym][sig] ?? [], perAsset[a.sym][sig].push(v);
      if (sig === "combo") { const vol = sd(Array.from(r.slice(Math.max(0, i - 60), i))) * Math.sqrt(252); const lv = (vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0) * r[i + 1]; longRet.set(d, (longRet.get(d) ?? 0) + lv); if (isOOS(a.ts[i + 1])) perAssetLong[a.sym].push(lv); }
    }
  }
}
// book = equal-weight across assets active that day (divide by count), so the book's ex-ante vol ~ VOL_TARGET/sqrt(N_eff)
const seriesEW = (m: Daily, filt: (ts: number) => boolean) => [...m.entries()].filter(([d]) => filt(Date.parse(d + "T00:00:00Z") / 1000)).sort().map(([d, v]) => v / Math.max(1, nDay.get(d) ?? 1));
// D-870 class parity: each class's equal-weight sleeve, then classes combined at inverse trailing-60d class vol (no look-ahead: vol from prior days)
const seriesCP = (sig: string, filt: (ts: number) => boolean) => {
  const gr = grpRet[sig] ?? {}; const gn = grpN[sig] ?? {}; const groups = Object.keys(gr); const days = [...new Set(groups.flatMap((g) => [...gr[g].keys()]))].sort();
  const hist: Record<string, number[]> = {}; for (const g of groups) hist[g] = []; const out: number[] = [];
  for (const d of days) { const vals: Record<string, number> = {}; for (const g of groups) { const v = gr[g].get(d); if (v !== undefined) vals[g] = v / Math.max(1, gn[g].get(d) ?? 1); }
    const w: Record<string, number> = {}; let tot = 0; for (const g of Object.keys(vals)) { const h = hist[g]; const vol = h.length > 40 ? sd(h.slice(-60)) : 0; w[g] = vol > 0 ? 1 / vol : 0; tot += w[g]; }
    let v = 0; for (const g of Object.keys(vals)) v += (tot > 0 ? w[g] / tot : 1 / Object.keys(vals).length) * vals[g]; for (const g of Object.keys(vals)) hist[g].push(vals[g]);
    if (filt(Date.parse(d + "T00:00:00Z") / 1000)) out.push(v); }
  return out; };
const series = (m: Daily, filt: (ts: number) => boolean) => K.CLASS_PARITY === "1" && m === bookRet["combo"] ? seriesCP("combo", filt) : seriesEW(m, filt);
const stats = (x: number[]) => { const mu = mean(x) * 252, vol = sd(x) * Math.sqrt(252); let eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0; for (const v of x) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak); } return { mu, vol, sr: vol ? mu / vol : 0, t: tstat(x), mdd, uwDays: maxUw, n: x.length }; };
const ceilInfo = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
await spendTrials({ rest: OWNED, headers: hdr, family: "tsmom", runId: K.RUN_ID, spent: SIGS.length * 2 });
console.log(`\n  ${"signal".padEnd(8)} ${"IS 1990-2014 Sharpe".padStart(20)} ${"OOS 2015+ Sharpe".padStart(17)} ${"OOS t".padStart(7)} ${"OOS %/yr".padStart(9)} ${"vol".padStart(6)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)}`);
const res: Record<string, ReturnType<typeof stats>> = {};
for (const sig of SIGS) { if (K.LONG_ONLY === "1" && sig !== "combo") continue; const is = stats(series(bookRet[sig], isIS)), oos = stats(series(bookRet[sig], isOOS)); res[sig] = oos; console.log(`  ${sig.padEnd(8)} ${is.sr.toFixed(2).padStart(20)} ${oos.sr.toFixed(2).padStart(17)} ${oos.t.toFixed(2).padStart(7)} ${(100 * oos.mu).toFixed(1).padStart(8)}% ${(100 * oos.vol).toFixed(1).padStart(5)}% ${(100 * oos.mdd).toFixed(0).padStart(6)}% ${(oos.uwDays / 252).toFixed(1).padStart(9)}y   IS maxDD ${(100 * is.mdd).toFixed(0)}% IS underwater ${(is.uwDays / 252).toFixed(1)}y`); }
const lo = stats(series(longRet, isOOS)); const loIS = stats(series(longRet, isIS)); console.log(`  ${"long-only".padEnd(8)} ${loIS.sr.toFixed(2).padStart(20)} ${lo.sr.toFixed(2).padStart(17)} ${lo.t.toFixed(2).padStart(7)} ${(100 * lo.mu).toFixed(1).padStart(8)}% ${(100 * lo.vol).toFixed(1).padStart(5)}%   (vol-matched long basket, the benchmark)  IS maxDD ${(100 * loIS.mdd).toFixed(0)}% OOS maxDD ${(100 * lo.mdd).toFixed(0)}% OOS underwater ${(lo.uwDays / 252).toFixed(1)}y`);
const comboIS = stats(series(bookRet["combo"], isIS));
console.log(`\n  POSITIVE CONTROL: IS 1990-2014 combo Sharpe ${comboIS.sr.toFixed(2)} [needs > 0.4 — the literature's own era must reproduce]`);
// excess over the long basket, day by day
const co = bookRet["combo"]; const exd: number[] = []; for (const [d, v] of co) if (isOOS(Date.parse(d + "T00:00:00Z") / 1000) && longRet.has(d)) exd.push((v - longRet.get(d)!) / Math.max(1, nDay.get(d) ?? 1));
const ex = stats(exd);
// per class, per asset agreement (OOS, combo)
const byCls: Record<string, number[]> = {}; let posA = 0, nA = 0; const assetLines: string[] = [];
for (const a of S) { const v = perAsset[a.sym]?.combo; if (!v || v.length < 500) continue; nA++; const m = mean(v) * 252; if (m > 0) posA++; (byCls[CLASS4(a.cls)] ??= []).push(m); assetLines.push(`${a.sym}:${(100 * m).toFixed(1)}`); }
console.log(`\n  OOS BY CLASS (mean per-asset %/yr at ${(100 * +K.VOL_TARGET).toFixed(0)}% vol): ${Object.entries(byCls).map(([c, v]) => `${c} ${(100 * mean(v)).toFixed(1)}% (${v.filter((x) => x > 0).length}/${v.length} +)`).join(" | ")}`);
console.log(`  OOS asset agreement: ${posA}/${nA} positive; excess over vol-matched long basket ${(100 * ex.mu).toFixed(1)}%/yr t ${ex.t.toFixed(2)}`);
// leverage table for the combo book
const oosCombo = series(bookRet["combo"], isOOS); const baseVol = sd(oosCombo) * Math.sqrt(252);
console.log(`\n  LEVERAGE TABLE (combo book, OOS, scaled from its realised ${(100 * baseVol).toFixed(1)}% vol; costs scale with leverage):`);
console.log(`  ${"target vol".padEnd(11)} ${"%/yr".padStart(7)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)} ${"years to 10x".padStart(13)}`);
for (const tv of [0.10, 0.20, 0.40]) { const lev = tv / (baseVol || 1); const x = oosCombo.map((v) => v * lev); const st = stats(x); const g = st.mu - st.vol * st.vol / 2; console.log(`  ${(100 * tv).toFixed(0).padStart(9)}% ${(100 * st.mu).toFixed(1).padStart(6)}% ${(100 * st.mdd).toFixed(0).padStart(6)}% ${(st.uwDays / 252).toFixed(1).padStart(9)}y ${(g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never").padStart(13)}`); }
const R = res["combo"]; const classes = Object.values(byCls).filter((v) => mean(v) > 0).length;
const ok = comboIS.sr > 0.4 && R.sr >= 0.5 && R.t >= ceilInfo.ceiling && posA / Math.max(1, nA) >= 0.6 && classes >= 3 && ex.mu > 0 && ex.t >= 2;
console.log(`\n  ceiling for this id ${ceilInfo.ceiling.toFixed(3)}`);
console.log(`  VERDICT (D-863 rule): ${comboIS.sr <= 0.4 ? "UNTESTED — positive control failed (in-sample era does not reproduce)" : ok ? "SUPPORTED" : `NULL — ${[R.sr < 0.5 && `OOS Sharpe ${R.sr.toFixed(2)} < 0.5`, R.t < ceilInfo.ceiling && `t ${R.t.toFixed(2)} < ceiling`, posA / Math.max(1, nA) < 0.6 && "asset agreement < 60%", classes < 3 && "fewer than 3 classes positive", !(ex.mu > 0 && ex.t >= 2) && "excess over long basket fails"].filter(Boolean).join("; ")}`}`);
if (K.DUMP) { const m = bookRet["combo"]; const keys = [...m.keys()].filter((d) => isOOS(Date.parse(d + "T00:00:00Z") / 1000)).sort(); const ser = K.CLASS_PARITY === "1" ? seriesCP("combo", isOOS) : keys.map((d) => m.get(d)! / Math.max(1, nDay.get(d) ?? 1)); const obj: Record<string, number> = {}; keys.forEach((d, i) => obj[d] = ser[i]); await Deno.writeTextFile(new URL(`../${K.DUMP}`, import.meta.url).pathname, JSON.stringify({ run: K.RUN_ID, oos_from: K.OOS_FROM, series: obj })); console.log(`  dumped ${keys.length} OOS days to ${K.DUMP}`); }
await Deno.writeTextFile(new URL("../data/tsmom-oos-assets.json", import.meta.url).pathname, JSON.stringify({ prereg: K.RUN_ID, oos_from: K.OOS_FROM, assets: assetLines }, null, 1));
