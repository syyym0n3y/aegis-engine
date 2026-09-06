// fpi-adr.ts (D-747b) — THE ONE reader for the foreign-private-issuer / ADR-ratio correction.
//
// THE DEFECT, distinct from the split defect D-747 solved. A foreign private issuer files its cover-page count
// `EntityCommonStockSharesOutstanding` in ORDINARY shares, while `trd_bars_deep` carries the price of its ADR.
// One ADR represents `adr_ratio` ordinary shares, so
//     mc = px_adr * shares_ordinary                       is wrong by a factor of adr_ratio
//     mc = px_adr * shares_ordinary / adr_ratio           is the market cap
// No split ratio moves this: LTM priced out at $29.05T and BSAC at $6.63T with the split correction fully applied.
//
// WHEN THE RATIO IS UNKNOWN THE ANSWER IS NULL, NOT A GUESS. A missing input is not a zero (D-423) and an
// unmeasured conversion is not a measured one (THE INSTRUMENT LAW) — so an FPI with no usable ratio gets
// `mc = null` and every mc-derived yield built on it becomes null. That is a smaller universe, honestly stated,
// rather than a larger one silently wrong for exactly the names whose caps are most extreme.
//
// The flags come from `data/fpi-flags.json`, written by `scripts/fpi-flags.ts` (EDGAR submissions for the FPI
// classification, Yahoo `quoteSummary` for the measured ratio). This module exists so aegis-factory.ts and
// factory-forward-score.ts cannot drift apart — the seven scripts that each carried a private copy of the split
// loop is exactly how D-747 survived its first fix.

export interface FpiFlag {
  cik: string | null;
  ticker: string;
  fpi: boolean;
  forms_seen: string[];
  state_of_inc: string | null;
  adr_ratio: number | null;
  ratio_src: string | null;
  ordinary_shares: number | null;
  yahoo_shares: number | null;
}

export interface FpiTable {
  /** ticker -> ratio, only for FPIs with a MEASURED, usable ratio */
  ratio: Map<string, number>;
  /** tickers that are FPIs with NO usable ratio — their market cap is unknowable here and must be null */
  exclude: Set<string>;
  /** total FPIs seen, for the summary line */
  fpiCount: number;
  /** true when the file was actually read; false means the correction is a NO-OP and callers must say so */
  loaded: boolean;
}

export const EMPTY_FPI: FpiTable = { ratio: new Map(), exclude: new Set(), fpiCount: 0, loaded: false };

/** Read data/fpi-flags.json. Returns an EMPTY table (loaded:false) when the file is absent — never throws, but the
 * caller is expected to PRINT that the correction did nothing rather than let a silent no-op pass as a fix. */
// D-798: resolve a relative path against the REPO, never the cwd. Under launchd the runner's cwd is infra/, so the default
// "data/fpi-flags.json" became infra/data/… → NotFound → loaded:false → every consumer (factory, forward-score, market-cap
// guard) ran the ADR share-base correction as a silent NO-OP while the file sat 1 MB large at the repo root. Fourth cwd
// defect exposed tonight (registry-guard, refresh-bars, borrow adjacency, this) — all found because D-793 made the loop
// execute its own body. This file lives at supabase/functions/_shared/, three levels below the repo root.
const FPI_REPO = new URL("../../../", import.meta.url).pathname;
export async function loadFpiFlags(path = "data/fpi-flags.json"): Promise<FpiTable> {
  const p = path.startsWith("/") ? path : `${FPI_REPO}${path}`;
  let raw: string;
  // D-801: only a genuinely ABSENT file yields the documented empty table. Any other failure (PermissionDenied when a caller
  // forgot --allow-read, EISDIR, I/O) is rethrown — the runner invoked market-cap-guard without --allow-read for weeks,
  // this catch reported the file "MISSING", and the guard was RED in the loop while GREEN on the board (guard-status grants
  // read). A permission problem must never impersonate a data gap.
  try { raw = await Deno.readTextFile(p); }
  catch (e) { if (e instanceof Deno.errors.NotFound) return { ...EMPTY_FPI, ratio: new Map(), exclude: new Set() }; throw e; }
  let j: Record<string, FpiFlag>;
  try { j = JSON.parse(raw); } catch { return { ...EMPTY_FPI, ratio: new Map(), exclude: new Set() }; }
  const ratio = new Map<string, number>(), exclude = new Set<string>();
  let fpiCount = 0;
  for (const f of Object.values(j)) {
    if (!f?.fpi) continue;
    fpiCount++;
    if (f.adr_ratio != null && Number.isFinite(f.adr_ratio) && f.adr_ratio > 0) ratio.set(f.ticker, f.adr_ratio);
    else exclude.add(f.ticker);
  }
  return { ratio, exclude, fpiCount, loaded: true };
}

/**
 * Market cap in USD, or null when it cannot be honestly computed.
 * `sharesToday` must ALREADY be split-restated into today's share units (adjShares from shares-adj.ts) — this
 * function only applies the ADR conversion on top, so the two share-base corrections compose rather than compete.
 */
export function mcFpi(px: number, sharesToday: number | null, sym: string, t: FpiTable): number | null {
  if (sharesToday == null || !(sharesToday > 0) || !(px > 0)) return null;
  if (t.exclude.has(sym)) return null;                          // FPI, ratio unknown -> UNTESTED, not a number
  const r = t.ratio.get(sym);
  const mc = r ? px * sharesToday / r : px * sharesToday;
  return Number.isFinite(mc) && mc > 0 ? mc : null;
}
