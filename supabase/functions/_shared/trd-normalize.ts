// trd-normalize.ts — the broker-agnostic ingestion layer. The moat works on ONE
// universal primitive — a normalized trade/return series — so it runs on ANY account
// from ANY broker (each can export a CSV of closed trades). Parsers for the common
// retail/pro formats + a generic fallback; all collapse to `NormalizedAccount`.
// PURE, deterministic. No order-routing — analysis only (regulatory + moat by design).

export interface Trade { ts: string; pnl: number } // realized P&L in account currency
export interface NormalizedAccount {
  source: string;
  startEquity: number;
  trades: Trade[];
  /** per-trade returns (pnl / equity-before-trade) — the series VERIFY consumes */
  returns: number[];
  equityCurve: number[];
  winRate: number;
  /** avg win / avg |loss| (the payoff ratio PROTECT consumes) */
  winLossRatio: number;
  /** avg |losing trade| / startEquity — the effective risk-per-trade fraction */
  avgRiskFrac: number;
  tradesPerYear: number;
  spanDays: number;
}

function num(x: string): number { const v = Number(String(x).replace(/[$,%\s]/g, "").replace(/[()]/g, "-")); return Number.isFinite(v) ? v : NaN; }
function splitRows(text: string): string[][] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((c) => c.trim()));
}
function pickCol(header: string[], names: string[]): number {
  const low = header.map((h) => h.toLowerCase());
  for (const n of names) { const i = low.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
  return -1;
}

/** GENERIC CSV — the universal path. Auto-detects a date/time column and a P&L
 * column (profit / pnl / p&l / net). Works for essentially any broker export. */
export function fromGenericCsv(text: string, startEquity: number): NormalizedAccount {
  const rows = splitRows(text);
  if (rows.length < 2) return normalize("generic-csv", [], startEquity);
  const header = rows[0];
  const pnlCol = pickCol(header, ["profit", "pnl", "p&l", "p/l", "net", "realized", "gain"]);
  const dateCol = pickCol(header, ["close time", "date", "time", "closed", "exit"]);
  const trades: Trade[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const pnl = pnlCol >= 0 ? num(r[pnlCol]) : num(r[r.length - 1]);
    if (!Number.isFinite(pnl)) continue;
    const ts = dateCol >= 0 ? (r[dateCol] || `t${i}`) : `t${i}`;
    trades.push({ ts, pnl });
  }
  return normalize("generic-csv", trades, startEquity);
}

/** MT4/MT5 statement CSV/TSV (MetaTrader — the most common retail platform). Closed
 * positions have a Profit column and a Close-Time; balance/deposit rows are skipped. */
export function fromMetaTrader(text: string, startEquity: number): NormalizedAccount {
  const rows = splitRows(text);
  const trades: Trade[] = [];
  for (const r of rows) {
    // MT rows: Ticket, OpenTime, Type, ..., Profit(last). Skip non-trade types.
    const type = (r[2] ?? "").toLowerCase();
    if (["balance", "credit", "deposit", "withdrawal"].includes(type)) continue;
    const profit = num(r[r.length - 1]);
    if (!Number.isFinite(profit) || !["buy", "sell"].includes(type)) continue;
    trades.push({ ts: r[1] || r[0] || `t${trades.length}`, pnl: profit });
  }
  return normalize("metatrader", trades, startEquity);
}

/** Already a return series (decimals). For accounts that hand us returns directly. */
export function fromReturns(returns: number[], periodsPerYear = 252): NormalizedAccount {
  const trades: Trade[] = returns.map((r, i) => ({ ts: `p${i}`, pnl: r }));
  const acct = normalize("returns", trades, 1);
  acct.returns = returns.slice();
  acct.tradesPerYear = periodsPerYear;
  return acct;
}

/** Equity-curve values → per-step returns. */
export function fromEquityCurve(values: number[]): NormalizedAccount {
  const rets: number[] = []; const trades: Trade[] = [];
  for (let i = 1; i < values.length; i++) { if (values[i - 1] > 0) { const r = values[i] / values[i - 1] - 1; rets.push(r); trades.push({ ts: `p${i}`, pnl: values[i] - values[i - 1] }); } }
  const acct = normalize("equity-curve", trades, values[0] || 1);
  acct.returns = rets; acct.equityCurve = values.slice();
  return acct;
}

/** Core: from a trade list + starting equity, derive the canonical account. Returns
 * are pnl / equity-before-trade (compounding), which is what the engines consume. */
export function normalize(source: string, trades: Trade[], startEquity: number): NormalizedAccount {
  const eq = startEquity > 0 ? startEquity : 1;
  const returns: number[] = []; const equityCurve: number[] = [eq];
  let cur = eq;
  for (const t of trades) { const r = cur > 0 ? t.pnl / cur : 0; returns.push(r); cur += t.pnl; equityCurve.push(cur); }
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b.pnl, 0) / losses.length) : 0;
  const winRate = trades.length ? wins.length / trades.length : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);
  const avgRiskFrac = avgLoss > 0 ? avgLoss / eq : 0;
  // span from parseable timestamps
  const times = trades.map((t) => Date.parse(t.ts)).filter(Number.isFinite);
  const spanDays = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
  const tradesPerYear = spanDays > 5 ? trades.length / (spanDays / 365) : 252;
  return { source, startEquity: eq, trades, returns, equityCurve, winRate, winLossRatio, avgRiskFrac, tradesPerYear, spanDays };
}

/** One entry point: sniff the format and normalize. */
export function ingest(raw: string, opts: { startEquity?: number; format?: "auto" | "generic" | "mt" } = {}): NormalizedAccount {
  const startEquity = opts.startEquity ?? 10000;
  const fmt = opts.format ?? "auto";
  if (fmt === "mt") return fromMetaTrader(raw, startEquity);
  if (fmt === "generic") return fromGenericCsv(raw, startEquity);
  // auto: MetaTrader rows carry buy/sell in col 3 and many columns
  const first = splitRows(raw).find((r) => r.length > 5);
  if (first && /buy|sell|balance/i.test((first[2] ?? "") + (first[3] ?? ""))) return fromMetaTrader(raw, startEquity);
  return fromGenericCsv(raw, startEquity);
}
