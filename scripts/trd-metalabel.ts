#!/usr/bin/env -S deno run --allow-net
// trd-metalabel — the HONEST ML build (López de Prado meta-labeling). ML does NOT predict price
// direction (we proved that's a graveyard). Instead a logistic-regression model learns, from the
// CONTEXT of each sweep signal (vol regime, trend strength, session, stop size, recent quality),
// whether THAT signal is likely a winner — so we TAKE the good ones and SKIP the noise. Success =
// filtering by the model improves OUT-OF-SAMPLE expectancy vs taking every signal. Edge-deployable
// (linear weights). If it doesn't beat all-signals OOS, meta-labeling adds nothing — reported honestly.

interface Bar { ts: string; o: number; h: number; l: number; c: number; }
async function bars15m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null)) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), o, h, l, c }); }
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 1; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) || 1; };
function ema(v: number[], p: number) { const k = 2 / (p + 1); let e = v[0]; const o = [e]; for (let i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); o.push(e); } return o; }
function atr(b: Bar[], p = 14) { const tr = [0]; for (let i = 1; i < b.length; i++) tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const out = new Array(b.length).fill(0); let a = 0; for (let i = 1; i < b.length; i++) { a = i <= p ? (a * (i - 1) + tr[i]) / i : (a * (p - 1) + tr[i]) / p; out[i] = a; } return out; }
const sess = (h: number) => h < 7 ? 0 : h < 13 ? 1 : h < 21 ? 2 : 0; // asia/london/ny

// build sweep trades (long) with FEATURES at entry + label (win=1/loss=0), rr=3
function dataset(b: Bar[]) {
  const c = b.map((x) => x.c), e = ema(c, 20), a = atr(b, 14), amed = [...a].filter((x) => x > 0).sort((x, y) => x - y)[a.length >> 1] || 1;
  const rows: { f: number[]; y: number; r: number; i: number }[] = [];
  const recent: number[] = [];
  for (let i = 25; i < b.length - 1; i++) {
    let lo = Infinity; for (let j = i - 5; j < i; j++) lo = Math.min(lo, b[j].l);
    if (!(b[i].l < lo && b[i].c > lo && b[i].c > e[i])) continue;
    const entry = b[i + 1].o, stop = b[i].l, risk = entry - stop; if (!(risk > 0)) continue;
    const target = entry + 3 * risk;
    // simulate outcome
    let y = -1; for (let m = i + 1; m < Math.min(i + 40, b.length); m++) { if (b[m].l <= stop) { y = 0; break; } if (b[m].h >= target) { y = 1; break; } }
    if (y < 0) continue;
    // FEATURES (context, not price prediction): vol regime, trend strength, ema slope, stop size, session, recent quality
    const volPct = a[i] / amed;
    const trendStr = (b[i].c - e[i]) / (a[i] || 1);
    const emaSlope = (e[i] - e[i - 10]) / (a[i] || 1);
    const stopFrac = risk / entry;
    const s = sess(new Date(b[i].ts).getUTCHours());
    const recentWR = recent.length >= 5 ? mean(recent.slice(-10)) : 0.3;
    rows.push({ f: [volPct, trendStr, emaSlope, stopFrac * 100, s === 1 ? 1 : 0, s === 2 ? 1 : 0, recentWR], y, r: y === 1 ? 3 : -1, i });
    recent.push(y);
  }
  return rows;
}
// standardize + logistic regression via gradient descent
function trainLogit(X: number[][], Y: number[], iters = 4000, lr = 0.1) {
  const n = X.length, d = X[0].length;
  const mu = Array(d).fill(0).map((_, j) => mean(X.map((r) => r[j])));
  const sd = Array(d).fill(0).map((_, j) => std(X.map((r) => r[j])));
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const w = Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = Array(d).fill(0); let gb = 0;
    for (let k = 0; k < n; k++) { const z = w.reduce((s, wj, j) => s + wj * Z[k][j], b); const p = 1 / (1 + Math.exp(-z)); const err = p - Y[k]; for (let j = 0; j < d; j++) gw[j] += err * Z[k][j]; gb += err; }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + 0.01 * w[j]); b -= lr * gb / n;
  }
  const predict = (r: number[]) => { const z = w.reduce((s, wj, j) => s + wj * (r[j] - mu[j]) / sd[j], b); return 1 / (1 + Math.exp(-z)); };
  return { predict, w, b, mu, sd };
}

for (const sym of ["BTC-USD", "ETH-USD"]) {
  const b = await bars15m(sym); if (b.length < 500) { console.log(`\n${sym}: thin`); continue; }
  const rows = dataset(b); if (rows.length < 80) { console.log(`\n${sym}: only ${rows.length} sweep trades`); continue; }
  const mid = Math.floor(rows.length * 0.6);
  const tr = rows.slice(0, mid), te = rows.slice(mid);
  const model = trainLogit(tr.map((r) => r.f), tr.map((r) => r.y));
  // baseline: take ALL signals (test). meta: take only where model P(win) > threshold (tuned on train)
  const allExpTe = mean(te.map((r) => r.r));
  // pick threshold on TRAIN that maximizes train expectancy
  let bestThr = 0.5, bestTrExp = -9; for (let thr = 0.2; thr <= 0.6; thr += 0.02) { const kept = tr.filter((r) => model.predict(r.f) > thr); if (kept.length >= 10) { const ex = mean(kept.map((r) => r.r)); if (ex > bestTrExp) { bestTrExp = ex; bestThr = thr; } } }
  const keptTe = te.filter((r) => model.predict(r.f) > bestThr);
  const metaExpTe = keptTe.length ? mean(keptTe.map((r) => r.r)) : 0;
  console.log(`\n══ ${sym} meta-labeling — ${rows.length} sweep trades (train ${tr.length} / test ${te.length}) ══`);
  console.log(`  OUT-OF-SAMPLE: take ALL signals exp=${allExpTe.toFixed(3)}R (n=${te.length}) | META (P>${bestThr.toFixed(2)}) exp=${metaExpTe.toFixed(3)}R (n=${keptTe.length}, took ${(keptTe.length / te.length * 100).toFixed(0)}%)`);
  console.log(`  => ${metaExpTe > allExpTe + 0.02 && keptTe.length >= 8 ? "*** META-LABEL ADDS VALUE (filters noise, higher OOS expectancy)" : "no OOS improvement — meta-label adds nothing here (honest)"}`);
  console.log(`  feature weights [vol,trend,slope,stop%,london,ny,recentWR]: ${model.w.map((x) => x.toFixed(2)).join(", ")}`);
}
console.log(`\nRead: ML here is a SIGNAL-QUALITY FILTER (meta-labeling), not a price predictor. It earns its keep ONLY`);
console.log(`if it raises out-of-sample expectancy vs taking every signal. Linear weights = edge-deployable if it does.`);
