#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// equity-depth-flow-test.ts (D-816) — the equity twin of depth-flow-test.ts on Databento TBBO 5-minute bars: top-of-book
// size imbalance, aggressor delta and the footprint proxy -> next regular-session hour. PREREG D-816-equity-depth-flow.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("equity-depth-flow-test", [{ name: "DIR", def: "data/databento" }, { name: "Z_WIN", def: "250" }, { name: "FEE_BP", def: "5" }, { name: "RUN_ID", def: "D-816-equity-depth-flow" }, { name: "EXCLUDE_AUCTION_HOURS", def: "0", note: "1 = drop the 09:30 and 15:00 ET hours (competing b)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "edf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const REPO = new URL("..", import.meta.url).pathname; const DIR = `${REPO}${K.DIR}`; const FEE = +K.FEE_BP, W = +K.Z_WIN;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function ols(x: number[], y: number[]) { const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); let sse = 0; for (let i = 0; i < n; i++) sse += (y[i] - my - b * (x[i] - mx)) ** 2; return { b, t: b / (Math.sqrt(sse / Math.max(1, n - 2) / (sxx || 1e-12)) || 1e-12), n }; }
function rankIC(x: number[], y: number[]) { const r = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const out = new Array(a.length); idx.forEach(([, i], k) => out[i] = k); return out as number[]; }; const rx = r(x), ry = r(y), mx = mean(rx), my = mean(ry); let s = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { s += (rx[i] - mx) * (ry[i] - my); sx += (rx[i] - mx) ** 2; sy += (ry[i] - my) ** 2; } return s / Math.sqrt(sx * sy || 1e-12); }
function zs(x: number[], Wn: number) { const out = new Array(x.length).fill(NaN); let s = 0, s2 = 0; for (let i = 0; i < x.length; i++) { s += x[i]; s2 += x[i] * x[i]; if (i >= Wn) { s -= x[i - Wn]; s2 -= x[i - Wn] ** 2; const m = s / Wn, v = Math.max(0, s2 / Wn - m * m); out[i] = v > 0 ? (x[i] - m) / Math.sqrt(v) : NaN; } } return out; }
const files: string[] = []; for await (const e of Deno.readDir(DIR)) if (e.name.endsWith("-5m.jsonl")) files.push(e.name.replace("-5m.jsonl", "")); files.sort(); assertNonEmpty("symbols with TBBO bars", files, 5);
type Res = { sym: string; sig: string; bpPerSd: number; t: number; ic: number; n: number }; const res: Res[] = [];
for (const sym of files) {
  const recs = (await Deno.readTextFile(`${DIR}/${sym}-5m.jsonl`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)) as { d: string; bars: number[][] }[];
  const bars = recs.flatMap((r) => r.bars).sort((a, b) => a[0] - b[0]);
  // regular session hours in ET: 09:30-16:00; hour buckets by ET hour (DST-aware via Intl)
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  const byH = new Map<number, number[][]>(); for (const b of bars) { const [hh, mm] = fmt.format(new Date(b[0] * 1000)).split(":").map(Number); const mins = hh * 60 + mm; if (mins < 570 || mins >= 960) continue; const ht = Math.floor(b[0] / 3600) * 3600; (byH.get(ht) ?? byH.set(ht, []).get(ht)!).push(b); }
  const hours = new Map<number, { c: number; delta: number; fp: number; imb: number; et: number }>();
  for (const [ht, bs] of byH) { if (bs.length < 6) continue; const h = Math.max(...bs.map((b) => b[2])), l = Math.min(...bs.map((b) => b[3])); let v = 0, dl = 0, top = 0, bot = 0, im = 0; const t1 = l + (h - l) / 3, t2 = l + 2 * (h - l) / 3; for (const b of bs) { v += b[5]; dl += b[6]; im += b[7]; const mid = (b[2] + b[3]) / 2; if (mid >= t2) top += b[6]; else if (mid < t1) bot += b[6]; } const et = Number(fmt.format(new Date(ht * 1000)).split(":")[0]); hours.set(ht, { c: bs[bs.length - 1][4], delta: v > 0 ? dl / v : 0, fp: v > 0 ? (top - bot) / v : 0, imb: im / bs.length, et }); }
  const ts = [...hours.keys()].sort((a, b) => a - b); const ret = new Map<number, number>(); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] === 3600) ret.set(ts[i - 1], Math.log(hours.get(ts[i])!.c / hours.get(ts[i - 1])!.c) * 1e4);
  for (const [name, f] of [["top-of-book imbalance", (t: number) => hours.get(t)!.imb], ["aggressor delta", (t: number) => hours.get(t)!.delta], ["footprint proxy (top-bottom third)", (t: number) => hours.get(t)!.fp]] as [string, (t: number) => number][]) {
    const xs = ts.map(f), z = zs(xs, W); const X: number[] = [], Y: number[] = []; for (let i = 0; i < ts.length; i++) { const y = ret.get(ts[i]); if (y == null || !Number.isFinite(z[i])) continue; if (K.EXCLUDE_AUCTION_HOURS === "1") { const et = hours.get(ts[i])!.et; if (et === 9 || et === 15) continue; } X.push(z[i]); Y.push(y); }
    if (X.length < 300) { console.log(`  ${sym} ${name}: UNTESTED (n ${X.length})`); continue; } /* floor 300: 5-month cap-fitted span, ~700 session hours minus the 250h z warm-up */ const o = ols(X, Y); res.push({ sym, sig: name, bpPerSd: o.b, t: o.t, ic: rankIC(X, Y), n: o.n });
  }
}
assertNonEmpty("results", res, 5);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "equity-depth-flow", runId: K.RUN_ID, spent: 3 * files.length });
console.log(`\n==> EQUITY ORDER FLOW (Nasdaq TotalView TBBO) -> next regular-session hour, ${files.length} names, fee ${FEE}bp. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
for (const sig of ["top-of-book imbalance", "aggressor delta", "footprint proxy (top-bottom third)"]) {
  const g = res.filter((r) => r.sig === sig); const clears = g.filter((r) => r.bpPerSd >= FEE && r.t >= 2.5).length, neg = g.filter((r) => r.t <= -2.5).length;
  console.log(`  ${sig}: median ${median(g.map((r) => r.bpPerSd)).toFixed(2)}bp/sd (${(median(g.map((r) => r.bpPerSd)) / FEE).toFixed(2)}x fee), median t ${median(g.map((r) => r.t)).toFixed(2)}, median rankIC ${median(g.map((r) => r.ic)).toFixed(3)}; names clearing 1x fee at t>=2.5: ${clears}/${g.length}; negative at t<=-2.5: ${neg}/${g.length}`);
  for (const r of g) console.log(`      ${r.sym.padEnd(6)} ${r.bpPerSd.toFixed(2).padStart(7)}bp/sd t ${r.t.toFixed(2).padStart(6)} ic ${r.ic.toFixed(3)} n ${r.n}`);
}
function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
const sup = ["top-of-book imbalance", "aggressor delta", "footprint proxy (top-bottom third)"].some((sig) => res.filter((r) => r.sig === sig && r.bpPerSd >= FEE && r.t >= 2.5).length >= 14);
const missed = ["top-of-book imbalance", "aggressor delta", "footprint proxy (top-bottom third)"].some((sig) => res.filter((r) => r.sig === sig && r.t <= -2.5).length >= 14);
console.log(`\n  VERDICT: ${sup ? "SUPPORTED" : missed ? "SIGN MISSED" : "SUB-FEE / NULL"}`); console.log(`  RESULT_JSON ${JSON.stringify(res)}`);
