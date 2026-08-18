// trd-insider-backfill (D-349) — backfills insider open-market BUYS from SEC EDGAR (keyless, years-not-weeks). Per run:
// take a trading date, pull its Form-4 daily index, fetch a bounded slice of filings, parse, keep code-P open-market buys
// (issuer ticker comes straight from the Form-4). Resumable via trd_insider_cursor (walks dates backward, offset within a
// date). Fire repeatedly / cron to accumulate thousands fast. SEC fair-access: descriptive UA + sequential (<=10 req/s).
import { parseDailyIndex, parseForm4, isOpenMarketBuy } from "../_shared/trd-edgar.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Aegis Research ona@revitalise.io", "Accept-Encoding": "gzip, deflate" };
const qtr = (m: number) => Math.floor(m / 3) + 1;

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const MAX = Math.min(90, Number(u.searchParams.get("max") || "70"));
    // cursor: which date + offset to process next (walk backward from cursor)
    const cur = (await fetch(`${SB}/rest/v1/trd_insider_cursor?id=eq.default&select=last_date,last_offset`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0] || {};
    let date = u.searchParams.get("date") || cur.last_date || new Date().toISOString().slice(0, 10);
    let offset = u.searchParams.get("date") ? Number(u.searchParams.get("offset") || "0") : (cur.last_offset || 0);
    // step back to a weekday if weekend
    const jsD = new Date(date + "T12:00:00Z");
    const y = jsD.getUTCFullYear(), mo = jsD.getUTCMonth(), d2 = String(jsD.getUTCDate()).padStart(2, "0"), mm = String(mo + 1).padStart(2, "0");
    const idxUrl = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${qtr(mo)}/form.${y}${mm}${d2}.idx`;
    const idxR = await fetch(idxUrl, { headers: UA });
    if (!idxR.ok) {
      // no index this day (weekend/holiday) → step to previous day, reset offset
      const prev = new Date(jsD.getTime() - 864e5).toISOString().slice(0, 10);
      await fetch(`${SB}/rest/v1/trd_insider_cursor?id=eq.default`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ last_date: prev, last_offset: 0, updated_at: new Date().toISOString() }) }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, date, no_index: true, stepped_to: prev }), { headers: cors });
    }
    const rows = parseDailyIndex(await idxR.text(), ["4", "4/A"]);
    const slice = rows.slice(offset, offset + MAX);
    const buys: Record<string, unknown>[] = [];
    for (const r of slice) {
      try {
        const txt = await fetch(`https://www.sec.gov/Archives/${r.path}`, { headers: UA }).then((x) => x.ok ? x.text() : "");
        if (!txt) continue;
        const f = parseForm4(txt); if (!f.issuerSymbol) continue;
        const bought = f.transactions.filter(isOpenMarketBuy);
        if (!bought.length) continue;
        const val = bought.reduce((s, t) => s + (t.shares ?? 0) * (t.price ?? 0), 0);
        const sh = bought.reduce((s, t) => s + (t.shares ?? 0), 0);
        buys.push({ ticker: f.issuerSymbol.toUpperCase(), accession: r.accession, disclosed_date: r.dateFiled, trade_date: bought[0].date, value_usd: +val.toFixed(0), shares: sh, price: bought[0].price, owner: f.ownerName, is_officer: !!f.officerTitle, updated_at: new Date().toISOString() });
      } catch { /* skip bad filing */ }
    }
    if (buys.length) await fetch(`${SB}/rest/v1/trd_insider?on_conflict=ticker,accession`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(buys) }).catch(() => {});
    // advance cursor: next offset, or step back a day when the date is exhausted
    const done = offset + MAX >= rows.length;
    const nextDate = done ? new Date(jsD.getTime() - 864e5).toISOString().slice(0, 10) : date;
    const nextOffset = done ? 0 : offset + MAX;
    if (!u.searchParams.get("date")) await fetch(`${SB}/rest/v1/trd_insider_cursor?id=eq.default`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ last_date: nextDate, last_offset: nextOffset, updated_at: new Date().toISOString() }) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-insider-backfill", p_outcome: `${date} off ${offset}: ${rows.length} form4, ${buys.length} buys` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, date, offset, form4_in_index: rows.length, filings_scanned: slice.length, buys_found: buys.length, next: { date: nextDate, offset: nextOffset } }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
