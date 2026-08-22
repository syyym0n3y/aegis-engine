#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-autopilot.ts (D-369) — the AUTONOMOUS control loop. Runs itself on an interval, on OWNED infra, and each cycle:
//   1. self-heals (verifies the owned node answers; skips gracefully if not)   2. ensures the evidence base (loads free
//   Fama-French once if empty)   3. re-computes the DEFLATED verdict on the latest data   4. scores the statistical
//   position (best deflation-adjusted z − noise ceiling) and the DELTA vs last cycle   5. records it to trd_autopilot_log
//   6. SURFACES anything that clears — but NEVER arms, trades, or spends (DORMANT invariant; arming is the operator's act).
// This is "autonomously succeeding" within the safety law: the engine grades itself against reality forever, improves its
// position as data accrues, and stays capital-safe. Persistent: launchd/systemd (see infra/RUNBOOK). Env: OWNED_REST, JWT_SECRET.
//   Run once:   deno run -A scripts/aegis-autopilot.ts --once
//   Daemon:     deno run -A scripts/aegis-autopilot.ts            (CYCLE_SEC interval, default 21600 = 6h)
import { ZipReader, Uint8ArrayReader, TextWriter } from "jsr:@zip-js/zip-js@2.7.52";
const REST = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const CYCLE_SEC = Number(Deno.env.get("CYCLE_SEC") || 21600);
const ONCE = Deno.args.includes("--once");
const ARMED = false; // INVARIANT: autopilot never arms/trades/spends. Arming is a separate, operator-only action.

async function jwt(): Promise<string> {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "aegis-autopilot", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
const ncdf = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function dsr(m: number[], N: number) { const n = m.length; if (n < 24) return null; const mu = m.reduce((a, x) => a + x, 0) / n; const sd = Math.sqrt(m.reduce((a, x) => a + (x - mu) ** 2, 0) / (n - 1)); const sr = mu / sd; const sk = m.reduce((a, x) => a + ((x - mu) / sd) ** 3, 0) / n, ku = m.reduce((a, x) => a + ((x - mu) / sd) ** 4, 0) / n; const dn = Math.sqrt(Math.max(1e-9, 1 - sk * sr + ((ku - 1) / 4) * sr * sr)); return { psr_z: (sr * Math.sqrt(n - 1)) / dn, sharpe: sr * Math.sqrt(12) }; }
const monthEnd = (s: string) => { const y = +s.slice(0, 4), mo = +s.slice(4, 6); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
async function unzip(u: string) { const r = await fetch(u); const zr = new ZipReader(new Uint8ArrayReader(new Uint8Array(await r.arrayBuffer()))); const e = (await zr.getEntries()).find((x) => /\.csv$/i.test(x.filename))!; const t = await e.getData!(new TextWriter()); await zr.close(); return t; }

async function ensureData(hdr: Record<string, string>) {
  const have = await fetch(`${REST}/trd_ff_factors?select=month&limit=1`, { headers: hdr }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(have) && have.length) return; // evidence base already present
  const csv = await unzip("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip");
  const names = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"], rows: { month: string; factor: string; ret: number }[] = [];
  for (const raw of csv.split("\n")) { const mm = raw.trim().match(/^(\d{6})\s*,(.+)$/); if (!mm) continue; const v = mm[2].split(",").map((x) => +x.trim()); if (v.length >= 6) names.forEach((nm, j) => rows.push({ month: monthEnd(mm[1]), factor: nm, ret: v[j] / 100 })); }
  const mom = await unzip("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_CSV.zip");
  for (const raw of mom.split("\n")) { const mm = raw.trim().match(/^(\d{6})\s*,\s*(-?[\d.]+)/); if (mm) rows.push({ month: monthEnd(mm[1]), factor: "Mom", ret: +mm[2] / 100 }); }
  for (let i = 0; i < rows.length; i += 1000) await fetch(`${REST}/trd_ff_factors?on_conflict=month,factor`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) });
}

async function cycle(n: number) {
  const hdr = await H();
  // 1. self-heal check
  const ping = await fetch(`${REST}/`, { headers: hdr }).then((r) => r.ok).catch(() => false);
  if (!ping) { console.log(`[cycle ${n}] owned node not answering — skip, retry next cycle`); return; }
  // 2. ensure evidence base
  await ensureData(hdr);
  // 3. re-compute the deflated verdict on the latest data
  const rows = await fetch(`${REST}/trd_ff_factors?select=factor,ret&order=month,factor&limit=100000`, { headers: hdr }).then((r) => r.json()) as { factor: string; ret: number }[];
  const byF = new Map<string, number[]>(); for (const r of rows) (byF.get(r.factor) ?? byF.set(r.factor, []).get(r.factor)!).push(+r.ret);
  // TRIAL COUNT (fixed 2026-08-22, D-457). This used a hardcoded N=1000, giving a noise ceiling of sqrt(2 ln 1000) = 3.72.
  // That is NOT this program's trial count: D-363/364 established ~1.53M trials, whose ceiling is 5.34. Under the wrong
  // ceiling the agent had been reporting Ken French momentum (psr_z 3.73) as CLEARING — by 0.01 — and SURFACING it for
  // nine consecutive cycles. Under the correct ceiling nothing clears. A deflation bar is only as honest as the N in it.
  // Reads the live counter when populated, else falls back to the documented figure rather than to a flattering default.
  // counter is an append-only event log — count rows, add the documented baseline (~1.53M, D-363/364). The previous read
  // queried a `trials` column that never existed (D-467).
  const cntR = await fetch(`${REST}/trd_trial_counter?select=id&limit=1`, { headers: { ...hdr, Prefer: "count=exact" } }).catch(() => null);
  const liveN = cntR ? +((cntR.headers.get("content-range") || "").split("/")[1] || 0) : 0;
  const N = 1_530_000 + liveN, ceil = Math.sqrt(2 * Math.log(N));
  const verdict: Record<string, number>[] = [];
  for (const [f, r] of byF) { if (f === "RF") continue; const d = dsr(r, N); if (d) verdict.push({ factor: f as unknown as number, psr_z: +d.psr_z.toFixed(2), sharpe: +d.sharpe.toFixed(2) } as unknown as Record<string, number>); }
  verdict.sort((a, b) => (b.psr_z as number) - (a.psr_z as number));
  const best = verdict[0] || { factor: "none" as unknown as number, psr_z: 0 };
  const n_clearing = verdict.filter((v) => (v.psr_z as number) > ceil).length;
  const position_score = +((best.psr_z as number) - ceil).toFixed(3);
  // 4. delta vs last cycle
  const prev = await fetch(`${REST}/trd_autopilot_log?select=position_score&order=cycle_at.desc&limit=1`, { headers: hdr }).then((r) => r.json()).catch(() => []);
  const prevScore = Array.isArray(prev) && prev.length ? Number(prev[0].position_score) : null;
  const delta = prevScore == null ? null : +(position_score - prevScore).toFixed(3);
  // 5. SURFACE (never arm) — honest: a marginal clear (DSR≈0.5) is a coin-flip, not armable
  const surfaced = position_score > 0 ? `${best.factor} clears by ${position_score} (DSR≈${ncdf(position_score).toFixed(2)}) — MARGINAL, operator review; NOT auto-armed` : null;
  // 6. record
  const _logRes = await fetch(`${REST}/trd_autopilot_log`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({
    cycle_n: n, data_rows: rows.length, best_factor: best.factor, best_psr_z: best.psr_z, noise_ceiling: +ceil.toFixed(2), trials_n: N,
    n_clearing, position_score, delta_vs_prev: delta, armed: ARMED, surfaced, verdict,
  }) });
  console.log(`[cycle ${n}] rows=${rows.length} best=${best.factor}(z${best.psr_z}) ceil=${ceil.toFixed(2)} (N=${N.toLocaleString()}) clearing=${n_clearing} score=${position_score} delta=${delta ?? "—"}${surfaced ? " | SURFACED" : ""}`);
}

console.log(`==> AEGIS AUTOPILOT (owned:${REST}, ${ONCE ? "once" : `daemon ${CYCLE_SEC}s`}, DORMANT/no-capital)`);
let n = 1;
if (ONCE) { await cycle(n); } else { for (;;) { try { await cycle(n++); } catch (e) { console.log(`[cycle ${n}] error (self-heal, continue): ${String(e).slice(0, 120)}`); } await new Promise((r) => setTimeout(r, CYCLE_SEC * 1000)); } }
