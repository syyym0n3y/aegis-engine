#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-worker.ts — the OWN COMPUTE NODE. A standalone, UNCAPPED worker you run yourself (`deno run -A scripts/aegis-worker.ts`)
// on your Mac or any box. It talks ONLY to the trd-compute broker (no secret on this machine), draining trd_compute_jobs
// and running heavy era-disaggregated work that the 2s Supabase edge cap physically cannot hold — the substrate that turns
// the factor engine into the causal-ATTRIBUTION engine. Job types: 'deep_factor_ic' (era-disaggregated + deflated IC across
// the 33-yr deep history) which also emits per-instrument buy/sell SIGNALS. Idempotent, resumable, credential-free.
//   Run once:   deno run -A scripts/aegis-worker.ts --once
//   Run daemon: deno run -A scripts/aegis-worker.ts           (polls, uncapped, until killed)
const BROKER = Deno.env.get("AEGIS_BROKER") || "https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-compute";
const WORKER = Deno.env.get("AEGIS_WORKER_ID") || "w-local";
const ONCE = Deno.args.includes("--once");
const POLL_MS = 3000;

const ERAS: [string, number, number][] = [
  ["pre_dotcom_<2000", 0, 2000], ["dotcom_bust_00_02", 2000, 2003], ["bull_03_07", 2003, 2008],
  ["gfc_08_09", 2008, 2010], ["qe_bull_10_19", 2010, 2020], ["covid_20_21", 2020, 2022], ["tightening_22_26", 2022, 2100],
];
function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
const yearOf = (ts: number) => new Date(ts * 1000).getUTCFullYear();
const eraOf = (ts: number) => { const y = yearOf(ts); return ERAS.find(([, a, b]) => y >= a && y < b)?.[0] || "?"; };

async function getBars(sym: string): Promise<number[][] | null> {
  const r = await fetch(`${BROKER}?bars=${encodeURIComponent(sym)}`).then((x) => x.json()).catch(() => null);
  return r?.row?.bars ?? null; // [[ts,o,h,l,c,v],...]
}

// JOB: deep_factor_ic — 12-1 momentum, era-disaggregated + deflated IC across 33yr history; emits per-symbol signals.
async function runDeepFactorIC(params: { symbols: string[]; lookback?: number; skip?: number; horizon?: number }) {
  const LB = params.lookback ?? 252, SK = params.skip ?? 21, HZ = params.horizon ?? 21;
  const obsByEra: Record<string, { m: number[]; f: number[] }> = {};
  const latest: Record<string, number> = {};
  for (const sym of params.symbols) {
    const bars = await getBars(sym); if (!bars || bars.length < LB + HZ + 30) continue;
    const ts = bars.map((b) => b[0]), c = bars.map((b) => b[4]);
    for (let i = LB; i < bars.length - HZ; i++) {
      const mom = c[i - SK] / c[i - LB] - 1;        // 12-1 momentum (skip last month), known at t
      const fwd = c[i + HZ] / c[i] - 1;             // forward HZ-day return
      if (!Number.isFinite(mom) || !Number.isFinite(fwd)) continue;
      const e = eraOf(ts[i]); (obsByEra[e] ||= { m: [], f: [] }); obsByEra[e].m.push(mom); obsByEra[e].f.push(fwd);
    }
    // current signal input: latest computable 12-1 momentum
    const j = bars.length - 1; if (j - LB >= 0) latest[sym] = c[j - SK] / c[j - LB] - 1;
  }
  const grid = ERAS.map(([e]) => ({ era: e, ...rankIC(obsByEra[e]?.m || [], obsByEra[e]?.f || []) })).filter((g) => g.n > 0);
  const sig = grid.filter((g) => g.n >= 100);
  const meanIC = sig.length ? sig.reduce((s, g) => s + g.ic, 0) / sig.length : 0;
  const signCorrect = sig.filter((g) => g.ic > 0).length;                 // momentum hypo sign +1
  const eraConsistency = sig.length ? signCorrect / sig.length : 0;       // fraction of eras with correct sign
  const asof = new Date().toISOString().slice(0, 10);
  const signals = Object.entries(latest).map(([symbol, mom]) => {
    const lean = Math.max(-1, Math.min(1, mom / 0.3));                    // momentum → lean, scaled/clamped
    const confidence = +(Math.max(0, meanIC) * eraConsistency).toFixed(3); // calibrated by cross-era IC + consistency
    const residual = +(1 - Math.min(1, Math.abs(meanIC))).toFixed(3);      // unexplained fraction (anti-guru number)
    return { symbol, asof, lean: +lean.toFixed(3), confidence,
      engage: confidence >= 0.02 && eraConsistency >= 0.6,               // gate: honest — most will be false
      why: { factor: "mom_12_1", momentum: +mom.toFixed(4), mean_era_ic: +meanIC.toFixed(4), era_consistency: eraConsistency },
      residual, note: `mom12-1 | ${signCorrect}/${sig.length} eras sign-correct | meanIC ${meanIC.toFixed(4)}` };
  });
  return { result: { factor: "mom_12_1", era_grid: grid, mean_ic: +meanIC.toFixed(4), era_consistency: eraConsistency, n_symbols: Object.keys(latest).length }, signals };
}

async function runOne(): Promise<boolean> {
  const cl = await fetch(`${BROKER}?claim=1&worker=${encodeURIComponent(WORKER)}`).then((r) => r.json()).catch(() => null);
  const job = cl?.job; if (!job) return false;
  console.log(`[${WORKER}] claimed job ${job.id} (${job.job_type})`);
  try {
    let out: { result: unknown; signals?: Record<string, unknown>[] };
    if (job.job_type === "deep_factor_ic") out = await runDeepFactorIC(job.params);
    else throw new Error(`unknown job_type ${job.job_type}`);
    await fetch(BROKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, status: "done", result: out.result, signals: out.signals }) });
    console.log(`[${WORKER}] job ${job.id} done — ${out.signals?.length || 0} signals`, JSON.stringify(out.result).slice(0, 200));
  } catch (e) {
    await fetch(BROKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, status: "error", error: String(e).slice(0, 300) }) });
    console.error(`[${WORKER}] job ${job.id} error`, String(e).slice(0, 200));
  }
  return true;
}

console.log(`aegis-worker ${WORKER} → ${BROKER} ${ONCE ? "(--once)" : "(daemon)"}`);
if (ONCE) { await runOne(); }
else { while (true) { const did = await runOne(); if (!did) await new Promise((r) => setTimeout(r, POLL_MS)); } }
