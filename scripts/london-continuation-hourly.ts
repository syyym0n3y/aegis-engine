#!/usr/bin/env -S deno run --allow-net --allow-env
// london-continuation-hourly.ts (D-960 corroboration leg) — the pre-registration D-960-london-session-continuation
// names an optional corroboration "on the 12-instrument HOURLY panel (untouched by D-958) with the same rule at
// hourly resolution, same thresholds, counted as its own trial". This is that leg, exactly as registered:
// CONTINUATION direction on a breach of the ASIA session extreme inside the London window (04:00-06:00 ET), entry
// LAG-1 at the next hourly open, stop = hourly close back across the level, target 1.5R (R = |entry - level|),
// timeout 6 bars to market. Thresholds from the prereg: PROMOTE-to-review at t >= 2.0 with n >= 150; KILL at
// t <= 0 with n >= 150. One counted trial. Net fee 4bp per round trip.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("london-continuation-hourly", [
  { name: "FEE_BP", def: "4" }, { name: "RUN_ID", def: "D-960-london-cont-hourly" }, { name: "R_MULT", def: "1.5" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lch", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const hdr = { Authorization: `Bearer ${t}`, apikey: t }; const { q } = mkStrictRead(OWNED, hdr);
const FEE = +K.FEE_BP / 1e4, RM = +K.R_MULT;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const syms = (await q(`trd_fx_hourly?select=symbol&limit=1000`) as { symbol: string }[]).map((r) => r.symbol);
const uniq = [...new Set(syms)];
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
const et = (ts: number) => { const p = fmt.formatToParts(new Date(ts * 1000)); const g = (x: string) => p.find((y) => y.type === x)!.value; let hh = +g("hour"); if (hh === 24) hh = 0; return { d: `${g("year")}-${g("month")}-${g("day")}`, h: hh }; };
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "london-continuation", runId: K.RUN_ID, spent: 1 });
const all: number[] = []; const perSym: [string, number, number][] = [];
for (const sym of uniq) {
  const bars: { ts: number; o: number; h: number; l: number; c: number }[] = [];
  for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c&order=ts.asc&offset=${off}&limit=50000`) as typeof bars; for (const r of p) if (r.c > 0) bars.push(r); if (p.length < 50000) break; }
  if (bars.length < 2000) continue;
  const pnl: number[] = [];
  // walk days: asia = 19:00 prior ET .. 02:00 ET; london window 04-06 ET
  let asiaH = -Infinity, asiaL = Infinity, curD = "";
  for (let i = 0; i < bars.length - 8; i++) {
    const e = et(bars[i].ts);
    if (e.h === 19) { asiaH = bars[i].h; asiaL = bars[i].l; curD = ""; }                      // asia session restarts
    else if (e.h >= 20 || e.h < 2) { asiaH = Math.max(asiaH, bars[i].h); asiaL = Math.min(asiaL, bars[i].l); }
    if (e.h >= 4 && e.h < 6 && isFinite(asiaH) && asiaH > 0 && curD !== e.d) {
      const up = bars[i].h > asiaH, dn = bars[i].l < asiaL; if (!up && !dn) continue;
      curD = e.d;                                                                              // one trade per day per instrument
      const lv = up ? asiaH : asiaL, dir = up ? 1 : -1; const entry = bars[i + 1].o;
      const R = Math.abs(entry - lv); if (R <= 0 || R / entry > 0.05) continue;
      const tgt = entry + dir * RM * R; let out = 0, done = false;
      for (let j = i + 1; j < Math.min(i + 7, bars.length); j++) {
        const hitT = dir > 0 ? bars[j].h >= tgt : bars[j].l <= tgt;
        const stopped = dir > 0 ? bars[j].c < lv : bars[j].c > lv;                             // close back across the level
        if (hitT) { out = dir * (tgt - entry) / entry; done = true; break; }
        if (stopped) { out = dir * (bars[j].c - entry) / entry; done = true; break; }
      }
      if (!done) { const j = Math.min(i + 6, bars.length - 1); out = dir * (bars[j].c - entry) / entry; }
      pnl.push(out - FEE);
    }
  }
  if (pnl.length >= 20) { perSym.push([sym, mean(pnl) * 1e4, pnl.length]); all.push(...pnl); }
}
const tt = all.length > 2 ? mean(all) / (sd(all) / Math.sqrt(all.length) || 1e-12) : 0;
console.log(`\n==> D-960 HOURLY CORROBORATION — ${perSym.length} instruments, ${all.length} trades. Trial 1 spent; ceiling ${T.ceiling.toFixed(3)}.`);
for (const [s, bp, n] of perSym.sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(14)} ${bp >= 0 ? "+" : ""}${bp.toFixed(1)}bp/trade  n ${n}`);
console.log(`  POOLED: ${(1e4 * mean(all)).toFixed(1)}bp/trade net, t ${tt.toFixed(2)}, n ${all.length}`);
console.log(`  PREREG THRESHOLDS: promote-to-review t>=2.0 & n>=150; kill t<=0 & n>=150 -> VERDICT: ${all.length >= 150 ? (tt >= 2 ? "PROMOTE TO REVIEW" : tt <= 0 ? "KILLED on the corroboration leg" : "INCONCLUSIVE (0<t<2) — the NQ forward clock continues") : "UNDERPOWERED"}`);
console.log(`  NOTE: this is the corroboration leg only; the primary clock (NQ 1m, data strictly after 2026-09-22) runs regardless and is scored on its own rule.`);
