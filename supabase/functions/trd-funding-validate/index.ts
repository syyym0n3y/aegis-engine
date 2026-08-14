// trd-funding-validate (D-317) — pre-registered ALT-GATED validation of the funding-carry lead (D-316). The edge
// is alt-specific (majors invert), so the STRUCTURAL gate excludes the top-K crypto by market cap (institutional
// majors: BTC,ETH,BNB,XRP in cap order). On the resulting ALT basket, run the funding-fade (z84|h9 family) through
// the full gauntlet: skill vs random-timing control, DSR deflated by the funding trial count, K-fold walk-forward,
// and per-alt breadth (majority of alts net-positive). K∈{2,3,4} each counts as a trial. Keyless fapi, $0.
// HONEST: the gate is informed by prior per-symbol results → confirmatory, not truly OOS. Forward paper is the real test.
import { scoreEdge, type HarnessTrade } from "../_shared/trd-harness.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
// a-priori market-cap order (institutional majors first). Gate excludes the top-K of THIS list.
const CAP_ORDER = ["BTCUSDT","ETHUSDT","BNBUSDT","XRPUSDT"];
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT","XLMUSDT","BCHUSDT"];
const FEE_BPS = 10;
const FUNDING_TRIALS = 36;   // ~27 initial configs + gate×config choices — deflation N for this pre-registered class
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const variance = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const mulberry = (s: number) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

interface Pt { t: number; price: number; f: number }
async function series(sym: string): Promise<Pt[]> {
  const now = Date.now(), start = now - 2.5 * 365 * 864e5;
  const fMap = new Map<number, number>(); let cur = start, calls = 0;
  while (cur < now && calls < 12) { calls++; const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${cur}&limit=1000`).catch(() => null); if (!r || !r.ok) break; const j = await r.json().catch(() => null); if (!Array.isArray(j) || !j.length) break; for (const x of j) fMap.set(Math.round((x.fundingTime as number) / 36e5) * 36e5, +x.fundingRate); cur = (j[j.length - 1].fundingTime as number) + 1; if (j.length < 1000) break; }
  const out: Pt[] = []; cur = start; calls = 0;
  while (cur < now && calls < 12) { calls++; const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&startTime=${cur}&limit=1000`).catch(() => null); if (!r || !r.ok) break; const j = await r.json().catch(() => null); if (!Array.isArray(j) || !j.length) break; for (const k of j) { const closeT = Math.round((k[6] as number) / 36e5) * 36e5; const f = fMap.get(closeT); if (f !== undefined) out.push({ t: closeT, price: +k[4], f }); } cur = (j[j.length - 1][6] as number) + 1; if (j.length < 1000) break; }
  out.sort((a, b) => a.t - b.t); return out;
}

// funding-fade trades for one symbol at a config → {net-R, month} per trade + per-symbol mean
function fadeTrades(s: Pt[], zWin: number, zThr: number, hold: number, cost: number): { r: number; period: string }[] {
  const out: { r: number; period: string }[] = []; const n = s.length;
  for (let i = zWin; i + hold < n; i++) {
    let sum = 0, sq = 0; for (let j = i - zWin; j < i; j++) { sum += s[j].f; sq += s[j].f * s[j].f; }
    const mu = sum / zWin, sd = Math.sqrt(Math.max(1e-12, sq / zWin - mu * mu)); const z = (s[i].f - mu) / sd;
    if (Math.abs(z) < zThr) continue; const dir = z > 0 ? -1 : 1;
    let carry = 0; for (let j = i + 1; j <= i + hold; j++) carry += -dir * s[j].f;
    out.push({ r: dir * (s[i + hold].price / s[i].price - 1) + carry - cost, period: new Date(s[i].t).toISOString().slice(0, 7) });
  }
  return out;
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const data = new Map<string, Pt[]>();
    await Promise.all(SYMS.map(async (sy) => { const s = await series(sy); if (s.length > 200) data.set(sy, s); }));
    const cost = 2 * (FEE_BPS / 1e4);
    const rows: Record<string, unknown>[] = [], out: Record<string, unknown>[] = [];
    for (const K of [2, 3, 4]) {
      const majors = new Set(CAP_ORDER.slice(0, K));
      const alts = SYMS.filter((s) => data.has(s) && !majors.has(s));
      for (const [zWin, zThr, hold] of [[84, 1.0, 9], [84, 1.5, 9], [84, 2.0, 9]] as [number, number, number][]) {
        const pooled: HarnessTrade[] = [], ctrl: HarnessTrade[] = []; let altsPos = 0;
        for (let ai = 0; ai < alts.length; ai++) {
          const s = data.get(alts[ai])!; const tr = fadeTrades(s, zWin, zThr, hold, cost);
          if (mean(tr.map((x) => x.r)) > 0) altsPos++;
          for (const x of tr) pooled.push({ r: x.r, stopFrac: 1, period: x.period });
          // random-timing control, same count
          const rnd = mulberry(ai * 7919 + zWin + Math.round(zThr * 10) + hold); const n = s.length;
          for (let c = 0; c < tr.length; c++) { const ri = zWin + Math.floor(rnd() * (n - zWin - hold - 1)); const rd = rnd() < 0.5 ? 1 : -1; let rc = 0; for (let j = ri + 1; j <= ri + hold; j++) rc += -rd * s[j].f; ctrl.push({ r: rd * (s[ri + hold].price / s[ri].price - 1) + rc - cost, stopFrac: 1 }); }
        }
        if (pooled.length < 200) continue;
        const grossR = mean(pooled.map((t) => t.r));
        const sc = scoreEdge(`fund`, pooled, ctrl, { costBps: 0, nTrials: FUNDING_TRIALS });
        // walk-forward: 5 time-ordered folds, count net-positive
        const ord = [...pooled].sort((a, b) => (a.period || "").localeCompare(b.period || "")).map((t) => t.r);
        const fs = Math.floor(ord.length / 5); let wf = 0;
        for (let k = 0; k < 5; k++) { const seg = ord.slice(k * fs, k === 4 ? ord.length : (k + 1) * fs); if (seg.length && mean(seg) > 0) wf++; }
        const breadth = altsPos >= Math.ceil(alts.length * 0.6);
        const survive = sc.gatePassed && sc.vsRandomT >= 2 && grossR > 0 && wf >= 3 && breadth;
        const kb = survive ? null : [!sc.gatePassed ? `DSR(${sc.gateFailing.join(",")})` : "", sc.vsRandomT < 2 ? "skill<2" : "", grossR <= 0 ? "unprofitable" : "", wf < 3 ? `WF${wf}/5` : "", !breadth ? `breadth ${altsPos}/${alts.length}` : ""].filter(Boolean).join(";");
        const id = `top${K}|z${zWin}|thr${zThr}|h${hold}`;
        rows.push({ id, gate: `exclude top-${K} cap`, n_majors_excluded: K, cfg: `z${zWin}|thr${zThr}|h${hold}`, n_alts: alts.length, alts_positive: altsPos, n_signals: pooled.length, gross_r: +grossR.toFixed(6), skill_t: +sc.vsRandomT.toFixed(2), deflated_sharpe: sc.deflatedSharpe, gate_passed: sc.gatePassed, wf_folds: 5, wf_folds_pos: wf, verdict: survive ? "funding-survivor" : "funding-killed", killed_by: kb, run_at: new Date().toISOString() });
        out.push({ id, n: pooled.length, alts_pos: `${altsPos}/${alts.length}`, gross_r: +grossR.toFixed(5), skill_t: +sc.vsRandomT.toFixed(2), dsr: sc.deflatedSharpe, wf: `${wf}/5`, SURVIVOR: survive });
      }
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_funding_validate?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
    // survivors → forward paper + lineage
    const surv = rows.filter((r) => r.verdict === "funding-survivor");
    if (surv.length) {
      await fetch(`${SB}/rest/v1/trd_forward_candidates?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(surv.map((r) => ({ edge: `funding:${r.id}`, spec_key: r.id, market: "ALT-BASKET", spec: { class: "funding-carry", gate: r.gate, cfg: r.cfg }, net_r_pess: r.gross_r, deflated_sharpe: r.deflated_sharpe, wf_folds_pos: r.wf_folds_pos, status: "promoted" }))) }).catch(() => {});
      await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(surv.map((r) => ({ id: `funding:${r.id}`, name: `funding-carry ${r.id}`, family: "funding-carry", hypothesis: `alt-gated funding fade (${r.gate}, ${r.cfg})`, test_method: "pre-registered alt gate + DSR(n_eff=funding trials) + walk-forward + per-alt breadth", key_metric: `n ${r.n_signals}, gross ${r.gross_r}, skill t=${r.skill_t}, DSR ${r.deflated_sharpe}, alts+ ${r.alts_positive}/${r.n_alts}`, verdict: "survivor-confirmatory", status: "forward-pending", decision_refs: ["D-317"] }))) }).catch(() => {});
    }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-funding-validate", p_outcome: `tested ${rows.length}, survivors ${surv.length}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, tested: rows.length, survivors: surv.length, note: "CONFIRMATORY — gate is data-informed; forward paper is the only true OOS test", results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
