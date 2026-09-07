#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// export-feature-stack.ts (D-814) — ONE hourly feature stack per instrument, to CSV, for the model-class tests (additive
// shrunk combination, HAR-RV, regime, gradient boosting, meta-labeling). Every model reads the same file, so a difference
// between models is a difference in the model. One symbol per read (D-812). Sources: crypto — Binance mirror files
// (5m klines -> hourly OHLCV + taker delta + footprint proxy; bookDepth hourly imbalance; metrics top-trader L/S + taker ratio)
// + funding from trd_perp_oi; FX/index — trd_fx_hourly OHLCV(+tick volume). Columns are documented in the header row.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("export-feature-stack", [{ name: "CRYPTO", def: "BTCUSDT,ETHUSDT,SOLUSDT" }, { name: "FXIDX", def: "EURUSD,GBPUSD,USDJPY,AUDUSD,XAUUSD,USA500IDXUSD,USATECHIDXUSD,BRENTCMDUSD" }, { name: "OUT", def: "data/features" }, { name: "MIRROR", def: "data/binance-mirror" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "efs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const REPO = new URL("..", import.meta.url).pathname; const OUT = `${REPO}${K.OUT}`, MIR = `${REPO}${K.MIRROR}`;
async function jsonl<T>(p: string): Promise<T[]> { try { return (await Deno.readTextFile(p)).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.missing) as T[]; } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; } }
const hourTs = (d: string, hr: number) => Math.floor(Date.parse(d + "T00:00:00Z") / 1000) + hr * 3600;
const HEAD = "ts,o,h,l,c,v,delta,fp,imb1,imb5,topls,takerls,funding,hour,dow";
let written = 0;
for (const sym of K.CRYPTO.split(",")) {
  const k5 = await jsonl<{ d: string; bars: number[][] }>(`${MIR}/klines5m/${sym}.jsonl`); assertNonEmpty(`${sym} 5m`, k5, 12);
  const byH = new Map<number, number[][]>(); for (const r of k5) for (const b of r.bars) { const ht = Math.floor(b[0] / 3600) * 3600; (byH.get(ht) ?? byH.set(ht, []).get(ht)!).push(b); }
  const dep = await jsonl<{ d: string; hours: { hr: number; n: number; imb1: number; imb5: number }[] }>(`${MIR}/bookDepth/${sym}.jsonl`);
  const imb = new Map<number, [number, number]>(); for (const d of dep) for (const h of d.hours) if (h.n >= 30) imb.set(hourTs(d.d, h.hr), [h.imb1, h.imb5]);
  const met = await jsonl<{ d: string; rows: (string | number)[][] }>(`${MIR}/metrics/${sym}.jsonl`);
  const top = new Map<number, number>(), tk = new Map<number, number[]>(); for (const d of met) for (const r of d.rows) { const t0 = Math.floor(Date.parse(String(r[0]).replace(" ", "T") + "Z") / 1000); if (!Number.isFinite(t0)) continue; const ht = Math.floor(t0 / 3600) * 3600; if (+r[3] > 0) top.set(ht, +r[3]); if (+r[6] > 0) (tk.get(ht) ?? tk.set(ht, []).get(ht)!).push(+r[6]); }
  const fr = await q(`trd_perp_oi?symbol=eq.${sym}&interval=eq.funding&select=ts,open_interest&order=ts.asc&limit=20000`) as { ts: number; open_interest: number }[];
  const fund = (t: number) => { let lo = 0, hi = fr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].ts <= t) lo = m + 1; else hi = m; } return lo ? fr[lo - 1].open_interest : NaN; };
  const lines = [HEAD]; const ts = [...byH.keys()].sort((a, b) => a - b);
  for (const t of ts) { const bs = byH.get(t)!; if (bs.length < 10) continue; bs.sort((a, b) => a[0] - b[0]); const o = bs[0][1], c = bs[bs.length - 1][4], h = Math.max(...bs.map((b) => b[2])), l = Math.min(...bs.map((b) => b[3])); let v = 0, dl = 0, tp = 0, bt = 0; const t1 = l + (h - l) / 3, t2 = l + 2 * (h - l) / 3; for (const b of bs) { const d = 2 * b[6] - b[5]; v += b[5]; dl += d; const mid = (b[2] + b[3]) / 2; if (mid >= t2) tp += d; else if (mid < t1) bt += d; } const im = imb.get(t) ?? [NaN, NaN]; const tl = tk.get(t); const dt = new Date(t * 1000);
    lines.push([t, o, h, l, c, v, v > 0 ? dl / v : 0, v > 0 ? (tp - bt) / v : 0, im[0], im[1], top.get(t) ?? NaN, tl?.length ? Math.log(tl.reduce((s, x) => s + x, 0) / tl.length) : NaN, fund(t), dt.getUTCHours(), dt.getUTCDay()].join(",")); }
  await Deno.writeTextFile(`${OUT}/${sym}-1h.csv`, lines.join("\n") + "\n"); console.log(`  ${sym}: ${lines.length - 1} hours`); written++;
}
for (const sym of K.FXIDX.split(",")) {
  const lines = [HEAD]; let n = 0;
  for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; for (const r of p) { if (!(r.c > 0)) continue; const dt = new Date(r.ts * 1000); lines.push([r.ts, r.o, r.h, r.l, r.c, r.vol || 0, "", "", "", "", "", "", "", dt.getUTCHours(), dt.getUTCDay()].join(",")); n++; } if (p.length < 50000) break; }
  assertNonEmpty(`${sym} hourly`, lines, 5000); await Deno.writeTextFile(`${OUT}/${sym}-1h.csv`, lines.join("\n") + "\n"); console.log(`  ${sym}: ${n} hours`); written++;
}
console.log(`==> feature stack: ${written} instruments -> ${OUT}`);
