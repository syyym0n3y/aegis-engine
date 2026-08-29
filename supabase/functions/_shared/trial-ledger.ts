// trial-ledger.ts (W4, D-628) — the deflation ceiling can only be obtained by PAYING for it.
//
// THE DEFECT THIS EXISTS TO KILL. `scripts/grammar-search-deep.ts` spent 734,400 trials, READ the persistent counter,
// added its own spend IN MEMORY, and printed an honest ceiling of 5.410 — then exited without writing those trials
// anywhere. The persistent counter stayed at 1,531,401. Every run afterwards computed 5.337 and believed it.
//
// The error is silent, cumulative, and ALWAYS IN THE PERMISSIVE DIRECTION: a sweep that spends trials without
// recording them makes the NEXT sweep's bar too low, forever. Thirteen scripts read the counter this way and none
// wrote back. It is D-457 in a subtler form — there the N was hardcoded wrong and surfaced Ken French momentum as
// "clearing" for nine consecutive cycles; here the N is read correctly and then quietly not paid.
//
// Nothing was falsely cleared by it (max psr_z ever recorded is 3.73, far below either ceiling) — but a control that
// only holds while no result is close is not a control.
//
// THE FIX IS STRUCTURAL, not a reminder to be careful. There is now ONE function that returns a ceiling, and it
// writes the spend before it returns. Reading the counter without paying is still possible, but it no longer gets you
// a ceiling, and `scripts/trial-ledger-guard.ts` REDs on any script that prints one without calling this.
//
// Idempotent: run_key is UNIQUE, so a re-run of the same sweep inserts nothing and the count does not inflate. A
// sweep that legitimately re-spends trials passes a fresh `runId`.

export interface TrialSpend {
  /** trials counted BEFORE this spend (the persistent figure) */
  before: number;
  /** trials this run paid for */
  spent: number;
  /** total counted trials, i.e. before + spent */
  N: number;
  /** sqrt(2 ln N) — the deflation ceiling this run must clear */
  ceiling: number;
  /** rows actually inserted; < spent means some run_keys already existed (a re-run) */
  written: number;
}

/**
 * Record `spent` trials and return the ceiling that includes them.
 *
 * The documented pre-counter baseline (D-363/364, ~1.53M trials from the era before the counter table existed) is
 * added here rather than at each call site, so a caller cannot quietly omit it and get a flattering N.
 */
export async function spendTrials(
  opts: {
    rest: string;
    headers: Record<string, string>;
    family: string;
    runId: string;
    spent: number;
    /** documented pre-counter baseline; override only with a DECISIONS.md reference */
    baseline?: number;
    chunk?: number;
    /** set true to compute without writing — ONLY for a dry run that reports no ceiling */
    dryRun?: boolean;
  },
): Promise<TrialSpend> {
  const BASELINE = opts.baseline ?? 1_530_000;
  const CHUNK = opts.chunk ?? 10_000;
  if (!Number.isFinite(opts.spent) || opts.spent < 0) {
    throw new Error(`spendTrials: spent must be a non-negative number, got ${opts.spent}`);
  }
  if (!opts.runId || !opts.family) throw new Error("spendTrials: family and runId are required — an unattributed trial cannot be audited");

  const countRows = async (): Promise<number> => {
    const r = await fetch(`${opts.rest}/trd_trial_counter?select=id`, {
      headers: { ...opts.headers, Prefer: "count=exact", Range: "0-0" },
    });
    if (!r.ok) throw new Error(`spendTrials: cannot read trd_trial_counter (HTTP ${r.status}) — refusing to invent a ceiling`);
    const n = Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
    if (!Number.isFinite(n)) throw new Error("spendTrials: counter returned no total — refusing to invent a ceiling");
    return n;
  };

  const before = BASELINE + await countRows();
  let written = 0;

  if (!opts.dryRun && opts.spent > 0) {
    for (let i = 0; i < opts.spent; i += CHUNK) {
      const rows = [];
      for (let j = i; j < Math.min(i + CHUNK, opts.spent); j++) {
        rows.push({ family: opts.family, run_key: `${opts.runId}|${j}` });
      }
      // D-710 FIX: `resolution=ignore-duplicates` is INERT WITHOUT AN on_conflict TARGET. PostgREST needs to be told
      // which constraint the resolution applies to; without it the insert 409s on the unique run_key. The effect was
      // that this module THREW on any legitimate re-run — contradicting its own header, which states "a re-run of the
      // same sweep inserts nothing and the count does not inflate". It had never been exercised: every caller until
      // now used a fresh runId each time, so the idempotency it advertises had never once been tested.
      const res = await fetch(`${opts.rest}/trd_trial_counter?on_conflict=run_key`, {
        method: "POST",   // plumbing-ok: audited — status checked on the next line and thrown on
        headers: { ...opts.headers, "Content-Type": "application/json", Prefer: "return=minimal,resolution=ignore-duplicates" },
        body: JSON.stringify(rows),
      });
      // A failed write must NOT degrade to a smaller N. That would reproduce the exact defect this file exists to kill.
      // A 409 is now a real failure rather than the expected result of running the same sweep twice.
      if (!res.ok) throw new Error(`spendTrials: failed to record trials (HTTP ${res.status}) — refusing to report a ceiling that was not paid for`);
      written += rows.length;
    }
  }

  // Re-read rather than trusting arithmetic: idempotent re-runs insert fewer rows than requested, and the honest N is
  // whatever the table actually holds.
  const after = opts.dryRun ? before + opts.spent : BASELINE + await countRows();
  return { before, spent: opts.spent, N: after, ceiling: Math.sqrt(2 * Math.log(Math.max(2, after))), written };
}

/** Read-only: the ceiling implied by what has actually been paid for. Use when a script spends no new trials. */
export async function currentCeiling(rest: string, headers: Record<string, string>, baseline = 1_530_000): Promise<{ N: number; ceiling: number }> {
  const r = await fetch(`${rest}/trd_trial_counter?select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) throw new Error(`currentCeiling: cannot read trd_trial_counter (HTTP ${r.status})`);
  const n = Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
  if (!Number.isFinite(n)) throw new Error("currentCeiling: counter returned no total");
  const N = baseline + n;
  return { N, ceiling: Math.sqrt(2 * Math.log(Math.max(2, N))) };
}
