#!/usr/bin/env -S deno run --allow-net --allow-env
// turn-of-month-test.ts (D-962) — thread #3 of the forced-flow family: pension/rebalance calendar flow. PRE-SPECIFIED:
// literature TOM window = LONG from the last trading day of the month through the first 3 trading days of the next
// (Lakonishok-Smidt lineage); direction LONG, no flip permitted. Placeable instrument: index spread bet / ES micro.
// Windows {-1..+3} and {-1..+2} on USA500 and USATECH = 4 trials, spent. Net of 4bp per round trip (2 legs/month).
// Train = first 2/3 of months, test = last 1/3 (D-455). The BENCHMARK LAW applies: TOM must beat the SAME number of
// random long days per month, not zero — an always-up index makes any long window "profitable".
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("turn-of-month-test", [{ name: "FEE_BP", def: "4" }, { name: "RUN_ID", def: "D-962-turn-of-month" }, { name: "SEED", def: "962" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tom", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const FEE = +K.FEE_BP / 1e4;
let seed = +K.SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "turn-of-month", runId: K.RUN_ID, spent: 4 });
console.log(`\n==> D-962 TURN-OF-MONTH (forced rebalance flow) — trials 4 spent, ceiling ${T.ceiling.toFixed(3)} at N=${T.N.toLocaleString()}`);
for (const SYM of ["USA500IDXUSD", "USATECHIDXUSD"]) {
  const bars: { ts: number; c: number }[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${SYM}&select=ts,c&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; c: number }[]; for (const r of p) if (r.c > 0) bars.push(r); if (p.length < 50000) break; }
  const daily = new Map<string, number>(); for (const b of bars) daily.set(new Date(b.ts * 1000).toISOString().slice(0, 10), b.c);
  const days = [...daily.keys()].sort(); assertNonEmpty(`${SYM} days`, days, 1000);
  const rets = days.slice(1).map((d, i) => ({ d, r: Math.log(daily.get(d)! / daily.get(days[i])!) }));
  const monthOf = (d: string) => d.slice(0, 7);
  // position in month: negative = from month end (-1 = last trading day), positive = from start (+1 = first)
  const pos = new Map<string, number>(); { const byM = new Map<string, string[]>(); for (const { d } of rets) (byM.get(monthOf(d)) ?? byM.set(monthOf(d), []).get(monthOf(d))!).push(d); for (const [, ds] of byM) ds.forEach((d, i) => pos.set(d, i + 1)); for (const [, ds] of byM) ds.forEach((d, i) => { if (ds.length - i <= 3) pos.set(d + "|end", -(ds.length - i)); }); }
  const inWin = (d: string, endDays: number, startDays: number) => { const pe = pos.get(d + "|end"), ps = pos.get(d); return (pe !== undefined && pe >= -endDays) || (ps !== undefined && ps <= startDays); };
  for (const [wname, e, s] of [["[-1..+3]", 1, 3], ["[-1..+2]", 1, 2]] as [string, number, number][]) {
    const cut = Math.floor(rets.length * 2 / 3);
    const evalHalf = (rs: { d: string; r: number }[]) => {
      const win = rs.filter((x) => inWin(x.d, e, s)), out = rs.filter((x) => !inWin(x.d, e, s));
      const nWin = win.length / (rs.length / 21 || 1);                       // days held per month
      const feePerDay = FEE / Math.max(1, (e + s));                           // 1 round trip spread across the window
      const net = win.map((x) => x.r - feePerDay);
      // BENCHMARK: random same-size day sets per split, 200 draws
      const draws: number[] = []; for (let k = 0; k < 200; k++) { const sh = [...rs]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; } draws.push(mean(sh.slice(0, win.length).map((x) => x.r))); }
      const bmMean = mean(draws), bmSd = sd(draws);
      return { winM: mean(net), winT: tstat(net), n: win.length, outM: mean(out.map((x) => x.r)), z: (mean(win.map((x) => x.r)) - bmMean) / (bmSd || 1e-12), nWin };
    };
    const tr = evalHalf(rets.slice(0, cut)), te = evalHalf(rets.slice(cut));
    console.log(`  ${SYM.padEnd(14)} ${wname}  TRAIN in-win ${(1e4 * tr.winM).toFixed(1)}bp/d (out ${(1e4 * tr.outM).toFixed(1)}) z-vs-random ${tr.z.toFixed(2)}  ->  TEST in-win ${(1e4 * te.winM).toFixed(1)}bp/d (out ${(1e4 * te.outM).toFixed(1)}) z ${te.z.toFixed(2)} n ${te.n}${tr.z > 2 && te.z > 2 ? "  ** BOTH HALVES BEAT RANDOM **" : ""}`);
  }
}
console.log(`  READ: the decidable number is z vs random same-size day sets (BENCHMARK LAW) — in-window bp alone is drift. Net includes ${+K.FEE_BP}bp/round-trip spread over the window.`);
