// trd-point-in-time.ts — the structural anti-look-ahead guarantee.
//
// DOCTRINE: look-ahead bias is the #1 way a backtest lies. We make it
// STRUCTURALLY impossible rather than a code-review hope: every feature carries
// the `effectiveDate` it would have been LEGALLY knowable (for a congressional
// PTR that is the DISCLOSED date, never the trade date — the 45-day STOCK Act
// lag is baked in here and can never be silently engineered away). A backtest
// as-of date D may only ever read records with effectiveDate <= D.
//
// FAIL CLOSED: a record without a parseable effectiveDate is not "probably
// fine" — it is a hole through which the future leaks. We throw.

export interface PitRecord {
  /** ISO date/timestamp the value was legally knowable (disclosed/filed). */
  effectiveDate: string;
  [k: string]: unknown;
}

function parse(d: string, ctx: string): number {
  const t = Date.parse(d);
  if (!Number.isFinite(t)) {
    throw new Error(`point-in-time violation: unparseable effectiveDate ${JSON.stringify(d)} (${ctx})`);
  }
  return t;
}

/** Throws if ANY record lacks a parseable effectiveDate. Fail-closed. */
export function assertHasEffectiveDate(records: PitRecord[]): void {
  records.forEach((r, i) => {
    if (r.effectiveDate === undefined || r.effectiveDate === null) {
      throw new Error(`point-in-time violation: record[${i}] has no effectiveDate`);
    }
    parse(r.effectiveDate, `record[${i}]`);
  });
}

/** Returns ONLY the records knowable on/before asOfDate. The single function a
 * backtest is allowed to use to read features at a simulated point in time. */
export function asOf<T extends PitRecord>(records: T[], asOfDate: string): T[] {
  const cutoff = parse(asOfDate, "asOfDate");
  assertHasEffectiveDate(records);
  return records.filter((r) => parse(r.effectiveDate, "record") <= cutoff);
}

/** The records a NAIVE (look-ahead) query would wrongly include at asOfDate —
 * i.e. effectiveDate strictly after the cutoff. The self-test asserts this is
 * non-empty for a future-dated record and that asOf() excludes exactly these. */
export function lookaheadViolations<T extends PitRecord>(records: T[], asOfDate: string): T[] {
  const cutoff = parse(asOfDate, "asOfDate");
  assertHasEffectiveDate(records);
  return records.filter((r) => parse(r.effectiveDate, "record") > cutoff);
}

/** Convenience: the disclosure lag (days) of a filing, the first-class quantity
 * the whole congressional thesis lives or dies on. Positive = disclosed after
 * the trade (the normal, edge-eroding case). */
export function disclosureLagDays(tradeDate: string, disclosedDate: string): number {
  const t0 = parse(tradeDate, "tradeDate");
  const t1 = parse(disclosedDate, "disclosedDate");
  return (t1 - t0) / 86_400_000;
}
