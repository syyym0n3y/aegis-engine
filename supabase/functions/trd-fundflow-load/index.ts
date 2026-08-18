// trd-fundflow-load (D-361) — the FUNDING-FLOW ingester (free/keyless SEC Form D). Detects public tickers raising capital
// (PIPEs/private placements) EARLY — Form D is filed within 15 days of first sale and carries a STRUCTURED dollar amount.
//   ?date=YYYYMMDD  → process that day's EDGAR daily index: filter form 'D'/'D/A', for each CIK we can map to a ticker,
//                     fetch primary_doc.xml, parse totalOfferingAmount / totalAmountSold / debt-type, store trd_fundflow.
//   ?back=N         → process the last N calendar days in-process (weekends/holidays 404 harmlessly).
//   (no arg)        → yesterday (the cron's autonomous forward-capture mode).
// Point-in-time: effective_date = filed_date. Paced to respect SEC's 10 req/s. Idempotent (PK ticker,accession).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Aegis Research ona@revitalise.io" };
const num = (s: string | undefined) => { if (!s) return null; const n = +s.replace(/[^0-9.]/g, ""); return Number.isFinite(n) && n > 0 ? n : null; };
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`, "i")); return m ? m[1].trim() : undefined; };

async function loadCikMap(): Promise<Map<string, string>> {
  const c2t = new Map<string, string>(); // paginate — PostgREST caps at 1000/req; a single fetch silently truncates the ~7k map
  for (let off = 0; ; off += 1000) {
    const page = await fetch(`${SB}/rest/v1/trd_cik_ticker?select=cik,ticker&order=cik&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(page) || !page.length) break;
    for (const r of page as { cik: string; ticker: string }[]) if (r.ticker) c2t.set(String(+r.cik), r.ticker); // normalize leading zeros
    if (page.length < 1000) break;
  }
  return c2t;
}

async function processDay(date: string, c2t: Map<string, string>): Promise<{ candidates: number; stored: number; sample: Record<string, unknown>[] }> {
  const y = date.slice(0, 4), mo = +date.slice(4, 6), q = Math.floor((mo - 1) / 3) + 1, fd = `${y}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const ir = await fetch(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${date}.idx`, { headers: UA });
  if (!ir.ok) return { candidates: 0, stored: 0, sample: [] }; // weekend/holiday/no-index → 404, skip
  const lines = (await ir.text()).split("\n");
  const cand: { cik: string; accession: string; form: string }[] = [];
  for (const ln of lines) {
    if (!/^D(\/A)?\s/.test(ln)) continue;                                  // fixed-column .idx, Form D / D/A only
    const form = ln.slice(0, 12).trim();
    const fn = ln.trim().split(/\s+/).pop() || "";                          // edgar/data/CIK/ACCESSION.txt
    const m = fn.match(/edgar\/data\/(\d+)\/([0-9-]+)\.txt/i); if (!m) continue;
    const cik = String(+m[1]); if (!c2t.has(cik)) continue;                 // only issuers we can map to a public ticker
    cand.push({ cik, accession: m[2], form });
  }
  let stored = 0; const sample: Record<string, unknown>[] = [];
  for (const c of cand) {
    await new Promise((r) => setTimeout(r, 130));                           // SEC 10 req/s pace
    const xr = await fetch(`https://www.sec.gov/Archives/edgar/data/${c.cik}/${c.accession.replace(/-/g, "")}/primary_doc.xml`, { headers: UA });
    if (!xr.ok) continue; const xml = await xr.text();
    const off = num(tag(xml, "totalOfferingAmount")), sold = num(tag(xml, "totalAmountSold"));
    const row = { ticker: c2t.get(c.cik)!, cik: c.cik, accession: c.accession, form_type: c.form, filed_date: fd, effective_date: fd, total_offering_amount: off, total_amount_sold: sold, is_debt: /<isDebtType>\s*true\s*<\/isDebtType>/i.test(xml), industry: tag(xml, "industryGroupType") ?? null, updated_at: new Date().toISOString() };
    await fetch(`${SB}/rest/v1/trd_fundflow?on_conflict=ticker,accession`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) }).catch(() => {});
    stored++; if (sample.length < 15) sample.push({ ticker: row.ticker, off, sold, debt: row.is_debt });
  }
  return { candidates: cand.length, stored, sample };
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const c2t = await loadCikMap();
    const back = Number(u.searchParams.get("back")) || 0;
    if (back > 0) {
      const base = u.searchParams.get("date") ? new Date(u.searchParams.get("date")!) : new Date();
      let total = 0; const per: Record<string, number> = {};
      for (let i = 1; i <= Math.min(back, 90); i++) {
        const d = new Date(base); d.setUTCDate(d.getUTCDate() - i); const dd = d.toISOString().slice(0, 10).replace(/-/g, "");
        const r = await processDay(dd, c2t); if (r.stored) { total += r.stored; per[dd] = r.stored; }
      }
      await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-fundflow-load", p_outcome: `backfill ${back}d: ${total} Form-D stored` }) }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, backfill_days: Math.min(back, 90), total_stored: total, per_day: per }, null, 2), { headers: cors });
    }
    let date = (u.searchParams.get("date") || "").replace(/-/g, "");
    if (!date) { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); date = d.toISOString().slice(0, 10).replace(/-/g, ""); }
    if (!/^\d{8}$/.test(date)) return new Response(JSON.stringify({ ok: false, err: "bad date" }), { status: 400, headers: cors });
    const r = await processDay(date, c2t);
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-fundflow-load", p_outcome: `${date}: ${r.stored} Form-D w/ ticker of ${r.candidates}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, date, form_d_with_ticker: r.candidates, stored: r.stored, sample: r.sample }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
