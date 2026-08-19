#!/usr/bin/env -S deno run --allow-net --allow-env
// owned-loop-proof.ts (D-368) — proves the FULL Aegis value loop runs on OWNED infrastructure, zero rented dependency:
//   fetch real Fama-French data (free) → write into the OWNED Postgres via the OWNED PostgREST API → read it back →
//   compute the Deflated Sharpe verdict from owned data. If the DSR reproduces the rented run, ownership is complete.
// Env: OWNED_REST (default http://localhost:33000), JWT_SECRET (must match the owned node's PGRST_JWT_SECRET).
import { ZipReader, Uint8ArrayReader, TextWriter } from "jsr:@zip-js/zip-js@2.7.52";
const REST = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;

// mint an HS256 service_role JWT signed with the owned node's secret (the same auth model Supabase uses)
async function serviceJWT(): Promise<string> {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const head = b64({ alg: "HS256", typ: "JWT" }), body = b64({ role: "service_role", iss: "aegis-owned", exp: 4102444800 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const monthEnd = (yyyymm: string) => { const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
async function unzipCsv(url: string): Promise<string> {
  const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${r.status}`);
  const zr = new ZipReader(new Uint8ArrayReader(new Uint8Array(await r.arrayBuffer())));
  const e = (await zr.getEntries()).find((x) => /\.csv$/i.test(x.filename))!; const t = await e.getData!(new TextWriter()); await zr.close(); return t;
}
function parseMonthly(csv: string, n: number) { const out: { m: string; v: number[] }[] = []; for (const raw of csv.split("\n")) { const mm = raw.trim().match(/^(\d{6})\s*,(.+)$/); if (!mm) continue; const v = mm[2].split(",").map((x) => +x.trim()).filter(Number.isFinite); if (v.length >= n) out.push({ m: monthEnd(mm[1]), v: v.slice(0, n) }); } return out; }
// Deflated Sharpe (Bailey-LdP), identical math to the worker's dsrStats
const ncdf = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function dsr(monthly: number[], nTrials: number) {
  const n = monthly.length; const m = monthly.reduce((a, x) => a + x, 0) / n; const sd = Math.sqrt(monthly.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)); const msr = m / sd;
  const sk = monthly.reduce((a, x) => a + ((x - m) / sd) ** 3, 0) / n, ku = monthly.reduce((a, x) => a + ((x - m) / sd) ** 4, 0) / n;
  const denom = Math.sqrt(Math.max(1e-9, 1 - sk * msr + ((ku - 1) / 4) * msr * msr)); const psrZ = (msr * Math.sqrt(n - 1)) / denom;
  const ceil = Math.sqrt(2 * Math.log(nTrials));
  return { n, sharpe: +(msr * Math.sqrt(12)).toFixed(2), psr_z: +psrZ.toFixed(2), ceil: +ceil.toFixed(2), dsr: +ncdf(psrZ - ceil).toFixed(3), passes: psrZ > ceil };
}

const H = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await serviceJWT()}`, apikey: await serviceJWT() });

console.log(`==> OWNED LOOP PROOF against ${REST}`);
console.log("1/4  fetch Fama-French (free, Dartmouth)");
const c5 = await unzipCsv("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip");
const names = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"];
const rows: { month: string; factor: string; ret: number }[] = [];
for (const r of parseMonthly(c5, 6)) names.forEach((nm, j) => rows.push({ month: r.m, factor: nm, ret: r.v[j] / 100 }));
const cM = await unzipCsv("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_CSV.zip");
for (const r of parseMonthly(cM, 1)) rows.push({ month: r.m, factor: "Mom", ret: r.v[0] / 100 });

console.log(`2/4  write ${rows.length} rows into OWNED Postgres via OWNED API`);
const hdr = await H();
for (let i = 0; i < rows.length; i += 1000) {
  const resp = await fetch(`${REST}/trd_ff_factors?on_conflict=month,factor`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) });
  if (!resp.ok) throw new Error(`write failed ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
}

console.log("3/4  read back from OWNED API + compute Deflated Sharpe (N=1000)");
const back = await fetch(`${REST}/trd_ff_factors?select=month,factor,ret&order=month&limit=100000`, { headers: hdr }).then((r) => r.json()) as { month: string; factor: string; ret: number }[];
const byF = new Map<string, number[]>(); for (const r of back) (byF.get(r.factor) ?? byF.set(r.factor, []).get(r.factor)!).push(+r.ret);

console.log("4/4  VERDICT from owned data:");
const verdict: Record<string, unknown>[] = [];
for (const [f, r] of [...byF].sort()) if (r.length >= 24) verdict.push({ factor: f, ...dsr(r, 1000) });
verdict.sort((a, b) => (b.psr_z as number) - (a.psr_z as number));
for (const v of verdict) console.log(`   ${String(v.factor).padEnd(7)} sharpe ${String(v.sharpe).padStart(5)}  psr_z ${String(v.psr_z).padStart(5)}  ceil ${v.ceil}  DSR ${String(v.dsr).padStart(5)}  ${v.passes ? "CLEARS" : "fails"}`);
console.log(`\n==> rows in owned DB: ${back.length}. This ran entirely on owned infra — fetch(free) → owned DB → owned compute.`);
