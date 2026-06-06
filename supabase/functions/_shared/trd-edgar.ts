// trd-edgar.ts — SEC EDGAR Form-4 (insider transaction) parsing. PURE + offline.
//
// Legal, free, no auth (just a descriptive User-Agent + <=10 req/s). The daily
// index lists every filing; we filter Form 4 / 4/A and parse the ownership XML
// embedded in the full submission .txt. Form-4 cluster-buys (multiple distinct
// insiders buying open-market, code 'P', within a window) are the more credible
// legal signal per the research — but still must clear the falsification gate.
//
// Transaction codes that matter: P = open-market PURCHASE (the bullish signal),
// S = open-market sale, A = grant/award (NOT a conviction buy — must be excluded).

export interface IndexRow {
  form: string;
  company: string;
  cik: string;
  dateFiled: string; // YYYYMMDD
  path: string; // edgar/data/CIK/ACCESSION.txt
  accession: string; // 0000939167-26-000004
}

/** Parse a daily form index (.idx). Returns only Form 4 / 4/A rows by default. */
export function parseDailyIndex(idx: string, forms: string[] = ["4", "4/A"]): IndexRow[] {
  const want = new Set(forms);
  const rows: IndexRow[] = [];
  for (const line of idx.split("\n")) {
    // Form Type | Company (may contain spaces) | CIK | YYYYMMDD | path
    const m = line.match(/^(\S+)\s{2,}(.+?)\s+(\d{1,10})\s+(\d{8})\s+(\S+)\s*$/);
    if (!m) continue;
    const [, form, company, cik, dateFiled, path] = m;
    if (!want.has(form)) continue;
    const base = path.split("/").pop() ?? "";
    const accession = base.replace(/\.txt$/i, "");
    rows.push({ form, company: company.trim(), cik, dateFiled, path, accession });
  }
  return rows;
}

export interface Form4Transaction {
  code: string; // P / S / A / ...
  date: string | null; // YYYY-MM-DD
  shares: number | null;
  price: number | null;
  acquiredDisposed: string | null; // A (acquired) / D (disposed)
}

export interface Form4 {
  issuerSymbol: string | null;
  ownerName: string | null;
  isDirector: boolean;
  officerTitle: string | null;
  transactions: Form4Transaction[];
}

function tag(src: string, name: string): string | null {
  const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : null;
}

/** The Form-4 XML wraps scalars in <value>…</value> inside a named element. */
function valued(src: string, name: string): string | null {
  const block = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  if (!block) return null;
  const v = block[1].match(/<value>([\s\S]*?)<\/value>/i);
  return v ? v[1].trim() : block[1].trim();
}

function num(s: string | null): number | null {
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse the ownership document out of a full-submission .txt (or raw XML). */
export function parseForm4(txt: string): Form4 {
  const issuerSymbol = tag(txt, "issuerTradingSymbol");
  const ownerName = tag(txt, "rptOwnerName");
  const isDirector = (tag(txt, "isDirector") ?? "0").trim() === "1";
  const officerTitle = tag(txt, "officerTitle");

  const transactions: Form4Transaction[] = [];
  const blocks = txt.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) ?? [];
  for (const b of blocks) {
    transactions.push({
      code: (tag(b, "transactionCode") ?? "").trim().toUpperCase(),
      date: valued(b, "transactionDate"),
      shares: num(valued(b, "transactionShares")),
      price: num(valued(b, "transactionPricePerShare")),
      acquiredDisposed: valued(b, "transactionAcquiredDisposedCode"),
    });
  }
  return { issuerSymbol, ownerName, isDirector, officerTitle, transactions };
}

/** Is this an open-market PURCHASE (the bullish conviction signal)? Code 'P' +
 * acquired. Awards (A), gifts (G), and option exercises (M) are NOT this. */
export function isOpenMarketBuy(t: Form4Transaction): boolean {
  return t.code === "P" && t.acquiredDisposed === "A" && (t.shares ?? 0) > 0;
}

/** Build the canonical trd_raw_filings row payload for one Form-4. The
 * disclosed_date is the index dateFiled (legally-knowable); trade_date is the
 * transaction date. The 45-day-style lag is therefore first-class. */
export interface FilingRow {
  source: "edgar";
  source_id: string; // accession
  filing_type: string;
  ticker: string | null;
  person: string | null;
  trade_date: string | null;
  disclosed_date: string; // YYYY-MM-DD
  amount_low: number | null;
  amount_high: number | null;
  raw: Record<string, unknown>;
}

export function toFilingRow(idx: IndexRow, f4: Form4): FilingRow {
  const buys = f4.transactions.filter(isOpenMarketBuy);
  const notional = buys.reduce((s, t) => s + (t.shares ?? 0) * (t.price ?? 0), 0);
  const disclosed = `${idx.dateFiled.slice(0, 4)}-${idx.dateFiled.slice(4, 6)}-${idx.dateFiled.slice(6, 8)}`;
  const tradeDate = f4.transactions.map((t) => t.date).filter(Boolean).sort()[0] ?? null;
  return {
    source: "edgar",
    source_id: idx.accession,
    filing_type: idx.form,
    ticker: f4.issuerSymbol,
    person: f4.ownerName,
    trade_date: tradeDate,
    disclosed_date: disclosed,
    amount_low: notional || null,
    amount_high: notional || null,
    raw: { isDirector: f4.isDirector, officerTitle: f4.officerTitle, transactions: f4.transactions, openMarketBuys: buys.length },
  };
}
