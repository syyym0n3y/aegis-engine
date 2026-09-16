// D-934 — target vs trailing vs hold exits, measured by RETURN PER CAPITAL-DAY (the operator's velocity thesis).
// Two entry types (trend breakout, mean-reversion fade) x three exits, on the placeable deep panel.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("exit-rules", [
  { name: "N", def: "21", note: "max holding bars (timeout)" }, { name: "ATR", def: "14" }, { name: "CH", def: "20", note: "breakout channel" },
  { name: "MR", def: "0.08", note: "mean-reversion 3d move threshold" }, { name: "K_TGT", def: "2", note: "target/stop = K*ATR" }, { name: "K_TRAIL", def: "2", note: "trailing = K*ATR" }, { name: "RUN_ID", def: "D-934-exit-rules-capital-velocity" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ex", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const COST: Record<string, number> = { fx: 2, index: 4, intl_index: 4, rate: 4, etf: 4, sector: 4, commodity: 6, crypto: 9 };
const N = +K.N, ATRn = +K.ATR, CH = +K.CH, Ktg = +K.K_TGT, Ktr = +K.K_TRAIL;
// bar = [ts, open, high, low, close, vol]
type Tr = { ret: number; days: number };
type Books = Record<string, Record<"HOLD" | "TARGET" | "TRAIL", Tr[]>>;
const books: Books = { trend: { HOLD: [], TARGET: [], TRAIL: [] }, meanrev: { HOLD: [], TARGET: [], TRAIL: [] } };
function simulate(b: number[][], i: number, dir: number, atr: number, cost: number) {
  const entry = b[i + 1]?.[1]; if (!entry || entry <= 0) return null; // lag-1 entry at next open
  const tgt = Ktg * atr, trl = Ktr * atr;
  const out: Record<string, Tr> = {};
  // HOLD: exit at close of entry+N
  { const xi = Math.min(i + 1 + N, b.length - 1); const px = b[xi][4]; out.HOLD = { ret: dir * (px / entry - 1) - cost, days: xi - (i + 1) || 1 }; }
  // TARGET / TRAIL: walk bars from entry+1
  let doneT = false, doneR = false, peak = entry;
  for (let k = i + 1; k <= Math.min(i + 1 + N, b.length - 1) && (!doneT || !doneR); k++) {
    const hi = b[k][2], lo = b[k][3];
    if (!doneT) { // TARGET: stop checked first (conservative)
      if (dir > 0) { if (lo <= entry - tgt) { out.TARGET = { ret: -tgt / entry - cost, days: k - (i + 1) || 1 }; doneT = true; } else if (hi >= entry + tgt) { out.TARGET = { ret: tgt / entry - cost, days: k - (i + 1) || 1 }; doneT = true; } }
      else { if (hi >= entry + tgt) { out.TARGET = { ret: -tgt / entry - cost, days: k - (i + 1) || 1 }; doneT = true; } else if (lo <= entry - tgt) { out.TARGET = { ret: tgt / entry - cost, days: k - (i + 1) || 1 }; doneT = true; } }
    }
    if (!doneR) { // TRAIL: update peak, exit on retrace
      if (dir > 0) { peak = Math.max(peak, hi); if (lo <= peak - trl) { out.TRAIL = { ret: dir * ((peak - trl) / entry - 1) - cost, days: k - (i + 1) || 1 }; doneR = true; } }
      else { peak = Math.min(peak, lo); if (hi >= peak + trl) { out.TRAIL = { ret: dir * ((peak + trl) / entry - 1) - cost, days: k - (i + 1) || 1 }; doneR = true; } }
    }
  }
  const xi = Math.min(i + 1 + N, b.length - 1); const px = b[xi][4]; const days = xi - (i + 1) || 1;
  if (!doneT) out.TARGET = { ret: dir * (px / entry - 1) - cost, days };
  if (!doneR) out.TRAIL = { ret: dir * (px / entry - 1) - cost, days };
  return out;
}
const meta = await q(`trd_bars_deep?asset_class=in.(etf,sector,index,intl_index,commodity,fx,rate,crypto)&select=symbol,asset_class,n_bars&order=n_bars.desc`) as { symbol: string; asset_class: string; n_bars: number }[];
const sel = meta.filter((m) => m.n_bars > 500);
for (let p = 0; p < sel.length; p += 30) { const page = sel.slice(p, p + 30);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.map((x) => encodeURIComponent(x.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[];
  for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0 && x[2] >= x[3]).sort((a, c) => a[0] - c[0]); if (b.length < 300) continue; const cost = (COST[r.asset_class] ?? 5) / 1e4;
    // ATR series
    const atr: number[] = new Array(b.length).fill(0);
    for (let i = 1; i < b.length; i++) { const tr = Math.max(b[i][2] - b[i][3], Math.abs(b[i][2] - b[i - 1][4]), Math.abs(b[i][3] - b[i - 1][4])); atr[i] = i <= ATRn ? tr : atr[i - 1] + (tr - atr[i - 1]) / ATRn; }
    let flatT = -999, flatM = -999; // last exit bar per book (non-overlap)
    for (let i = CH + ATRn; i + 2 + N < b.length; i++) {
      // channel + 3d move
      let hh = -Infinity, ll = Infinity; for (let k = i - CH; k < i; k++) { hh = Math.max(hh, b[k][2]); ll = Math.min(ll, b[k][3]); }
      const trendDir = b[i][4] > hh ? 1 : b[i][4] < ll ? -1 : 0;
      const m3 = b[i][4] / b[i - 3][4] - 1; const mrDir = m3 < -+K.MR ? 1 : m3 > +K.MR ? -1 : 0;
      if (trendDir && i > flatT) { const o = simulate(b, i, trendDir, atr[i], cost); if (o) { for (const rule of ["HOLD", "TARGET", "TRAIL"] as const) books.trend[rule].push(o[rule]); flatT = i + 1 + (o.TRAIL.days); } }
      if (mrDir && i > flatM) { const o = simulate(b, i, mrDir, atr[i], cost); if (o) { for (const rule of ["HOLD", "TARGET", "TRAIL"] as const) books.meanrev[rule].push(o[rule]); flatM = i + 1 + (o.TARGET.days); } }
    }
  }
}
assertNonEmpty("trend trades", books.trend.HOLD, 500); assertNonEmpty("meanrev trades", books.meanrev.HOLD, 500);
console.log(`==> D-934 EXIT RULES — return per CAPITAL-DAY (velocity), by entry-type x exit-rule\n`);
console.log(`  ${"entry".padEnd(9)} ${"exit".padEnd(7)} ${"n".padStart(6)} ${"net bp/tr".padStart(9)} ${"medbp".padStart(8)} ${"days".padStart(6)} ${"win%".padStart(6)} ${"ret/capital-day (ann%)".padStart(22)}`);
for (const et of ["trend", "meanrev"] as const) {
  let best = { rule: "", v: -1e9 };
  for (const rule of ["HOLD", "TARGET", "TRAIL"] as const) { const t = books[et][rule]; const rp = t.map((x) => x.ret), dp = t.map((x) => x.days);
    const netbp = mean(rp) * 1e4; const medbp = med(rp) * 1e4; const days = mean(dp); const win = 100 * rp.filter((x) => x > 0).length / rp.length;
    const perDay = rp.reduce((s, x) => s + x, 0) / Math.max(1, dp.reduce((s, x) => s + x, 0)) * 252 * 100;
    if (perDay > best.v) best = { rule, v: perDay };
    console.log(`  ${et.padEnd(9)} ${rule.padEnd(7)} ${String(t.length).padStart(6)} ${netbp.toFixed(1).padStart(9)} ${medbp.toFixed(1).padStart(8)} ${days.toFixed(1).padStart(6)} ${win.toFixed(0).padStart(6)} ${perDay.toFixed(1).padStart(22)}`);
  }
  console.log(`   -> BEST for ${et}: ${best.rule} (${best.v.toFixed(1)}%/yr per capital-day)\n`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "exit-rules", runId: K.RUN_ID, spent: 6 });
console.log(`  READ: return-per-capital-day annualizes sum(net)/sum(holding-days) -- it REWARDS exits that free capital fast IF the per-trade edge survives. Best rule per edge-type = what the recycling engine should attach.`);
