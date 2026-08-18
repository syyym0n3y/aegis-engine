// trd-insider-bulk (D-355) — pulls DECADES of insider buys from SEC's bulk Form-345 quarterly datasets (keyless), not the
// slow day-crawl. Downloads {year}q{q}_form345.zip, unzips SUBMISSION.tsv (accession→issuer ticker) + NONDERIV_TRANS.tsv
// (code/shares/price), filters to open-market PURCHASES (code P, acquired), stores into trd_insider. One quarter/invocation.
import { ZipReader, Uint8ArrayReader, TextWriter } from "jsr:@zip-js/zip-js@2.7.52";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Aegis Research ona@revitalise.io" };

async function readEntry(entries: { filename: string; getData?: (w: TextWriter) => Promise<string> }[], name: string): Promise<string> {
  const e = entries.find((x) => x.filename.toUpperCase().endsWith(name)); if (!e?.getData) return "";
  return await e.getData(new TextWriter());
}
// SEC DERA dates are "DD-MON-YYYY" (e.g. 31-MAR-2025); also handle ISO / YYYYMMDD / MM-DD-YYYY.
const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
function pdate(s: string): string | null {
  if (!s) return null; s = s.trim(); let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/))) { const mo = MON[m[2].toUpperCase()]; return mo ? `${m[3]}-${mo}-${m[1].padStart(2, "0")}` : null; }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
// tab-separated with a header row → array of records keyed by header
function tsv(txt: string): { hdr: string[]; rows: string[][] } {
  const lines = txt.split("\n"); const hdr = (lines[0] || "").split("\t").map((s) => s.trim());
  const rows: string[][] = []; for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; rows.push(lines[i].split("\t")); }
  return { hdr, rows };
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url); const year = u.searchParams.get("year") || "2025", q = u.searchParams.get("q") || "1";
    const url = `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${year}q${q}_form345.zip`;
    const r = await fetch(url, { headers: UA }); if (!r.ok) return new Response(JSON.stringify({ ok: false, err: `zip ${r.status}`, url }), { headers: cors });
    const buf = new Uint8Array(await r.arrayBuffer());
    const zr = new ZipReader(new Uint8ArrayReader(buf));
    const entries = await zr.getEntries();
    const subTxt = await readEntry(entries, "SUBMISSION.TSV"), ndTxt = await readEntry(entries, "NONDERIV_TRANS.TSV");
    await zr.close();
    if (!subTxt || !ndTxt) return new Response(JSON.stringify({ ok: false, err: "missing tsv", files: entries.map((e) => e.filename) }), { headers: cors });
    // accession → {ticker, filing_date}
    const sub = tsv(subTxt); const ci = (h: string) => sub.hdr.indexOf(h);
    const acc2 = new Map<string, { tk: string; fd: string }>();
    for (const row of sub.rows) { const acc = row[ci("ACCESSION_NUMBER")]; const tk = (row[ci("ISSUERTRADINGSYMBOL")] || "").trim().toUpperCase(); const fd = row[ci("FILING_DATE")]; if (acc && tk && tk !== "NONE") acc2.set(acc, { tk, fd }); }
    // non-deriv transactions → open-market buys
    const nd = tsv(ndTxt); const ni = (h: string) => nd.hdr.indexOf(h);
    const iAcc = ni("ACCESSION_NUMBER"), iCode = ni("TRANS_CODE"), iAcq = ni("TRANS_ACQUIRED_DISP_CD"), iSh = ni("TRANS_SHARES"), iPx = ni("TRANS_PRICEPERSHARE"), iDt = ni("TRANS_DATE");
    const byKey = new Map<string, { ticker: string; accession: string; disclosed_date: string; trade_date: string; shares: number; price: number }>();
    for (const row of nd.rows) {
      if ((row[iCode] || "").trim().toUpperCase() !== "P") continue; if ((row[iAcq] || "").trim().toUpperCase() !== "A") continue;
      const acc = row[iAcc]; const meta = acc2.get(acc); if (!meta) continue;
      const sh = +(row[iSh] || "0"), px = +(row[iPx] || "0"); if (!(sh > 0)) continue;
      const key = meta.tk + "|" + acc; const cur = byKey.get(key);
      if (cur) { cur.shares += sh; } else byKey.set(key, { ticker: meta.tk, accession: acc, disclosed_date: meta.fd || "", trade_date: row[iDt] || "", shares: sh, price: px });
    }
    const rows = [...byKey.values()].map((b) => ({ ticker: b.ticker, accession: b.accession, disclosed_date: pdate(b.disclosed_date), trade_date: pdate(b.trade_date), value_usd: +(b.shares * b.price).toFixed(0), shares: b.shares, price: b.price, owner: null, is_officer: null, updated_at: new Date().toISOString() }));
    let stored = 0;
    for (let i = 0; i < rows.length; i += 1000) { await fetch(`${SB}/rest/v1/trd_insider?on_conflict=ticker,accession`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }).catch(() => {}); stored += Math.min(1000, rows.length - i); }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-insider-bulk", p_outcome: `${year}q${q}: ${stored} buys from ${nd.rows.length} txns` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, quarter: `${year}q${q}`, submissions: sub.rows.length, nonderiv_txns: nd.rows.length, buys_stored: stored }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
