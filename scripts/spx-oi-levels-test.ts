#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// spx-oi-levels-test.ts (D-820) — levels defined by POSITIONING: per-strike SPXW open interest (Databento, ~5 months) vs SPX
// (USA500IDXUSD hourly CFD as the price series). PREREG D-820-spx-oi-levels.
//  (i) PINNING: on each expiry day, |close - maxOI strike| vs |close - random listed strike| (same distance distribution),
//      OI taken at the PRIOR close (competing b); toward-pin trade entered at the 15:00 ET bar close (19:00 UTC in EDT,
//      20:00 in EST — DST-aware), held to the 16:00 close, net 4bp. Round-strike control: max-OI vs nearest 25-point round.
//  (ii) GAMMA WALLS: first hourly touch of the top-3 call-OI strikes above the day's open / top-3 put-OI strikes below it,
//      K=1h reversal vs random strikes at the same distance. Trials 4.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("spx-oi-levels-test", [{ name: "OI", def: "data/databento/spxw-oi.jsonl" }, { name: "SYM", def: "USA500IDXUSD" }, { name: "FEE_BP", def: "4" }, { name: "SEED", def: "820" }, { name: "RUN_ID", def: "D-820-spx-oi-levels" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sol", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const REPO = new URL("..", import.meta.url).pathname; const FEE = +K.FEE_BP / 1e4;
let seed = +K.SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }; const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
// OI by day
const oiDays = (await Deno.readTextFile(`${REPO}${K.OI}`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)) as { d: string; rows: [string, string, number, number][] }[]; assertNonEmpty("OI days", oiDays, 60);
const oiByDay = new Map(oiDays.map((x) => [x.d, x.rows])); const oiDates = oiDays.map((x) => x.d).sort();
// OI rows are published ~10:30Z on day d and reflect the PRIOR close (ts_ref is empty; the day is ts_event) — so the row dated d IS the
// pre-session, prior-close snapshot the pre-registration names; fall back to the latest earlier day if d has none.
const priorOI = (d: string) => { let lo = 0, hi = oiDates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (oiDates[m] <= d) lo = m + 1; else hi = m; } return lo ? oiByDay.get(oiDates[lo - 1])! : null; };
// price: hourly CFD, ET hour via Intl
const bars: { ts: number; o: number; h: number; l: number; c: number }[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${K.SYM}&select=ts,o,h,l,c&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; h: number; l: number; c: number }[]; for (const r of p) if (r.c > 0) bars.push(r); if (p.length < 50000) break; }
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }); const etHour = (ts: number) => Number(fmt.format(new Date(ts * 1000)));
const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10); const byDay = new Map<string, number[]>(); bars.forEach((b, i) => { const k = dayOf(b.ts); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(i); });
// (i) pinning
const pinRatio: number[] = [], roundRatio: number[] = [], towardPin: number[] = []; let expiries = 0;
for (const d of oiDates) {
  const prior = priorOI(d); if (!prior) continue; const todayRows = prior.filter((r) => r[0] === d); if (todayRows.length < 20) continue;   // expiry today, OI as of the prior close
  const byStrike = new Map<number, number>(); for (const r of todayRows) byStrike.set(r[2], (byStrike.get(r[2]) ?? 0) + r[3]); const strikes = [...byStrike.keys()]; const maxOI = [...byStrike.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const idx = byDay.get(d); if (!idx) continue; const closeBar = idx.filter((i) => etHour(bars[i].ts) === 16)[0]; const entryBar = idx.filter((i) => etHour(bars[i].ts) === 15)[0]; if (closeBar == null || entryBar == null) continue;
  const close = bars[closeBar].c, entry = bars[entryBar].c; const dPin = Math.abs(close - maxOI); const rs = strikes[Math.floor(rnd() * strikes.length)]; const dRnd = Math.abs(close - rs); if (dRnd > 0) pinRatio.push(dPin / dRnd);
  const round = Math.round(close / 25) * 25; roundRatio.push(dPin / Math.max(0.01, Math.abs(close - round)));
  const side = maxOI > entry ? 1 : -1; towardPin.push(side * Math.log(close / entry) - FEE); expiries++;
}
// (ii) gamma walls
const wallRev: number[] = [], rndRev: number[] = [];
for (const [d, idx] of byDay) { const prior = priorOI(d); if (!prior) continue; const open = bars[idx[0]].o; const calls = new Map<number, number>(), puts = new Map<number, number>(); for (const r of prior) { if (r[0] < d) continue; (r[1] === "C" ? calls : puts).set(r[2], ((r[1] === "C" ? calls : puts).get(r[2]) ?? 0) + r[3]); }
  const top = (m: Map<number, number>, f: (k: number) => boolean) => [...m.entries()].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const walls = [...top(calls, (k) => k > open).map((k) => ({ px: k, side: -1 })), ...top(puts, (k) => k < open).map((k) => ({ px: k, side: 1 }))];
  const rands = walls.map((w) => { const dist = Math.abs(w.px - open); return { px: open + (w.side === -1 ? 1 : -1) * dist * (0.5 + rnd()), side: w.side }; });
  for (const [lv, sink] of [[walls, wallRev], [rands, rndRev]] as [{ px: number; side: number }[], number[]][]) for (const L of lv) { let prev = bars[idx[0] - 1]?.c ?? open; for (const i of idx) { const b = bars[i]; if (i + 1 >= bars.length) break; const touched = L.side === -1 ? (prev < L.px && b.h >= L.px) : (prev > L.px && b.l <= L.px); if (touched) { sink.push(L.side * Math.log(bars[i + 1].c / b.c) - FEE); break; } prev = b.c; } }
}
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "spx-oi-levels", runId: K.RUN_ID, spent: 4 });
console.log(`\n==> SPX OI-DEFINED LEVELS (D-820): ${oiDates.length} OI days, ${expiries} expiries with a 15:00/16:00 ET bar. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`  (i) PIN: |close - maxOI| / |close - random strike| median ${median(pinRatio).toFixed(2)}, mean ${mean(pinRatio).toFixed(2)} (t vs 1.0: ${((mean(pinRatio) - 1) / ((sd(pinRatio) / Math.sqrt(pinRatio.length)) || 1e-12)).toFixed(2)}); vs nearest 25-pt round strike ratio median ${median(roundRatio).toFixed(2)}`);
console.log(`      toward-pin trade 15:00->close net: ${(mean(towardPin) * 1e4).toFixed(2)}bp/day t ${tstat(towardPin).toFixed(2)} n ${towardPin.length}, win ${(towardPin.filter((x) => x > 0).length / towardPin.length * 100).toFixed(0)}%`);
console.log(`  (ii) WALLS: first-touch K=1h reversal at top-3 OI strikes ${(mean(wallRev) * 1e4).toFixed(2)}bp t ${tstat(wallRev).toFixed(2)} n ${wallRev.length} | random strikes ${(mean(rndRev) * 1e4).toFixed(2)}bp t ${tstat(rndRev).toFixed(2)} n ${rndRev.length} | excess ${((mean(wallRev) - mean(rndRev)) * 1e4).toFixed(2)}bp`);
function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
const pinT = (mean(pinRatio) - 1) / ((sd(pinRatio) / Math.sqrt(pinRatio.length)) || 1e-12); const tp = tstat(towardPin); const ex = wallRev.map((x, i) => x - mean(rndRev)); const exT = tstat(ex);
const supPin = mean(pinRatio) < 0.8 && pinT <= -2.5 && pinRatio.length >= 90 && mean(towardPin) * 1e4 >= 5 && tp >= 2.5; const supWall = exT >= 2.5 && wallRev.length >= 200;
console.log(`\n  VERDICT pin: ${supPin ? "SUPPORTED" : (tp <= -2.5 ? "SIGN MISSED" : "NULL")} | walls: ${supWall ? "SUPPORTED" : (exT <= -2.5 ? "SIGN MISSED" : "NULL")} (n expiries ${pinRatio.length}, touches ${wallRev.length})`);
console.log(`  RESULT_JSON ${JSON.stringify({ expiries: pinRatio.length, pinRatioMean: mean(pinRatio), pinT, roundRatio: median(roundRatio), towardPinBp: mean(towardPin) * 1e4, tp, walls: wallRev.length, wallBp: mean(wallRev) * 1e4, rndBp: mean(rndRev) * 1e4, exT })}`);
