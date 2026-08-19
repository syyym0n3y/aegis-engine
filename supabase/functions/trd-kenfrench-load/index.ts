// trd-kenfrench-load (D-364) — loads the Fama-French factor RETURNS (free/keyless, Dartmouth) — the 99-year sample the
// deflation demands. Fetches the 5-factor ZIP (Mkt-RF/SMB/HML/RMW/CMA/RF) + the Momentum ZIP, parses the MONTHLY section
// (lines "YYYYMM,..." in %), stores decimal returns into trd_ff_factors. Server-side fetch (no Bash allowlist concern).
//   GET (no args) → load both files. Idempotent (PK month,factor).
import { ZipReader, Uint8ArrayReader, TextWriter } from "jsr:@zip-js/zip-js@2.7.52";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp";
const monthEnd = (yyyymm: string) => { const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6); const d = new Date(Date.UTC(y, m, 0)); return d.toISOString().slice(0, 10); };

async function unzipCsv(url: string): Promise<string> {
  const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${r.status} ${url}`);
  const zr = new ZipReader(new Uint8ArrayReader(new Uint8Array(await r.arrayBuffer())));
  const entries = await zr.getEntries(); const e = entries.find((x) => /\.csv$/i.test(x.filename)); if (!e?.getData) throw new Error("no csv in zip");
  const txt = await e.getData(new TextWriter()); await zr.close(); return txt;
}
// parse the MONTHLY block: rows "YYYYMM, v1, v2, ..." until a blank line / annual section. cols map to `names`.
function parseMonthly(csv: string, names: string[]): { month: string; vals: number[] }[] {
  const out: { month: string; vals: number[] }[] = [];
  for (const raw of csv.split("\n")) {
    const line = raw.trim(); const m = line.match(/^(\d{6})\s*,(.+)$/); if (!m) continue;
    const vals = m[2].split(",").map((x) => +x.trim()).filter((x) => Number.isFinite(x));
    if (vals.length < names.length) continue;
    out.push({ month: monthEnd(m[1]), vals: vals.slice(0, names.length) });
  }
  return out;
}
async function store(rows: { month: string; factor: string; ret: number }[]) {
  for (let i = 0; i < rows.length; i += 1000) await fetch(`${SB}/rest/v1/trd_ff_factors?on_conflict=month,factor`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000).map((r) => ({ ...r, updated_at: new Date().toISOString() }))) }).catch(() => {});
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // 5-factor file: cols after YYYYMM are Mkt-RF, SMB, HML, RMW, CMA, RF (percent)
    const c5 = await unzipCsv(`${BASE}/F-F_Research_Data_5_Factors_2x3_CSV.zip`);
    const names5 = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"];
    const m5 = parseMonthly(c5, names5);
    const rows: { month: string; factor: string; ret: number }[] = [];
    for (const r of m5) names5.forEach((nm, j) => rows.push({ month: r.month, factor: nm, ret: r.vals[j] / 100 }));
    // momentum file: single col "Mom" (percent)
    const cM = await unzipCsv(`${BASE}/F-F_Momentum_Factor_CSV.zip`);
    for (const r of parseMonthly(cM, ["Mom"])) rows.push({ month: r.month, factor: "Mom", ret: r.vals[0] / 100 });
    await store(rows);
    const byF: Record<string, number> = {}; for (const r of rows) byF[r.factor] = (byF[r.factor] || 0) + 1;
    const months = [...new Set(m5.map((r) => r.month))].sort();
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-kenfrench-load", p_outcome: `${rows.length} rows, ${months.length} months ${months[0]}..${months[months.length - 1]}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, rows_stored: rows.length, by_factor: byF, months: months.length, span: [months[0], months[months.length - 1]] }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
