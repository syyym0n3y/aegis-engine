# THE INEFFICIENCY MAP — where and WHEN this record says the market is exploitable (2026-10-14)

> Operator ask: hone in on what matters for every trade and instrument; find where the market is inefficient and
> **when**. This is the half that can be evidenced from our own measurements today. The attached lecture PDFs (L1–L3)
> were **not readable** — macOS privacy blocks this process from iCloud Drive — so the literature cross-reference is
> explicitly OUTSTANDING, not silently skipped. Every row below cites the decision that measured it.

## 1. The one structure that survived everything

**Visible constraint → forced flow → take the other side with patience.** Every survivor in ~980 decisions fits it;
every failure lacked a forced counterparty. We do not predict prices — we predict **who must trade**, because
constraints are public before the flow is.

## 2. WHERE it is inefficient (measured, with the mechanism)

| Where | The constraint | Status |
|---|---|---|
| **Distress short** (going-concern, late filings) | short-sale constrained; correction is slow, ~369d median lead | DEPLOYED (D-930/935/936) |
| **IVOL short leg** (highest idio-vol) | lottery demand + borrow limits block arbitrage; strongest in the extremes | DEPLOYED, concentration *strengthens* it (D-939/953) |
| **Crowded-short avoidance** | days-to-cover ≥5 names are squeeze fuel | ADOPTED by registered rule — sleeve 1.63→1.74 (D-971) |
| **Dealer gamma** | hedging flow must damp realized vol | VALIDATED in 3 regimes, pooled t −17.3 — **vol-sizing only, never direction** (D-961/967/968) |
| **Session-level sweeps** | stop clusters sit at public levels | the one admitted intraday family; fade, not continuation (D-767/825/955) |
| **Index add/delete** | trackers *must* buy/sell | footprint REAL (adds +1.54%, dels −2.11%) but **fully consumed at the announcement** (D-963/965) |
| **Tax wrappers / deposits** | the rule book itself | the only *certain* edge (D-735/746/758) |

## 3. WHEN — the dimension that decides whether the above pays

- **Regimes are specialised, the blend is not.** trend+cryptomom carried 2015–20 and are dead recently; distress+ivol+long
  carry 2021–26. The *blend* holds Sharpe ≥1.3 in all five eras — diversification across regimes, not within one (D-944).
- **2021 is the pathological year**, not "the rally": distress and IVOL reverse *together* in a junk squeeze, because both
  are short the same overpriced names. Their 0.07–0.14 body-correlation breaks exactly when it matters (D-945).
- **The acute squeeze is un-hedgeable with trailing signals** — a long hedge loses in the squeeze (D-946). The only
  defence that worked is *stepping aside*: the conditional de-gross (D-947/953b).
- **Intraday windows decay.** fwd-utc09to10 fell 64.96bp → **1.20bp** as n grew to 188; fwd-utc16 34.09 → 11.46bp (D-981).
  Treat any young intraday window as noise until n is large.
- **Announcement windows close within hours.** The index-effect pop is gone by the next open; a lag-1 buyer *funds* it
  at −142bp/event (D-965).

## 4. WHERE IT IS *NOT* INEFFICIENT (measured, so we stop paying to relearn it)

Order flow / tape reading (sub-fee **5 separate ways**: D-816/925/921/948/949) · intraday drift (overnight owns the
return) · ORB (full-sample 0.90 → OOS **−0.39**, selection artifact) · turn-of-month (drift wearing a calendar, killed
by its own benchmark, D-962) · London 04:00–06:00 ET (a **two-sided** cost sink: fade loses, continuation loses at
t −17.6, D-958/960) · retail HFT (latency-gated, R-001) · memecoin sniping (surviving cohort median **−92% from ATH**,
D-964/966).

## 5. What this says about tokenisation positioning

The premise needs correcting first: **$114T is the DTCC's existing custody figure, not a tokenisation forecast.**
Tokenised real-world assets are **~$32–39bn today**, with 2030 estimates of $2T (McKinsey) to $16T base / $68T bull
(BCG). So the honest framing is not "the entire market is tokenising" but "a fast-growing, still-small slice is."
**What actually transfers:** our edge class is *structural constraint*, not venue. Tokenisation does not remove
short-sale constraints, lottery demand, forced index flows or dealer hedging — it changes *where* they are expressed,
and early/illiquid venues historically widen the very frictions we harvest. **What does not transfer:** anything
latency-bound (already dead for us) and anything requiring borrow infrastructure that tokenised venues lack.
**The position that cannot be worse than before is the one we already hold** — owned data, owned compute, a measured
edge, and a verification machine — because those are venue-agnostic. The concrete readiness step is not to chase the
venue; it is to keep the constraint-detection engine fed and to have capital armed when a venue's frictions become
measurable.

## 6. OUTSTANDING — the literature cross-reference

L1, L2-a/b, L3-a/b could not be read (macOS TCC blocks iCloud Drive for this process; `cp` returns *Operation not
permitted*). Once copied to `docs/lectures/`, the specific job is to map each lecture's stated anomaly/efficiency
result onto §2 and §4 above, and to flag **any claim the lectures make that this record has already falsified** —
that disagreement is the most valuable output, in either direction.
