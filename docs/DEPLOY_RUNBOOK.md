# DEPLOY_RUNBOOK.md — the manual-fill routine for the deployable book (D-954)

> The proven edge is the **5-sleeve blend** (`distress-ivol-blend-5`): trend + long + cryptomom +
> distress-short + IVOL long-short, risk-parity weighted, with the **D-947 squeeze de-gross** overlay.
> Leverageable **excess Sharpe ~2.08** (2.13 in-sample with the de-gross; honest forward ~2.0).
> **Claude never executes. This is a manual-fill runbook. Every order is placed by the operator.**

## 0. The one command

```bash
cd infra && set -a; . ./.env; set +a
CAPITAL=120000 deno run --v8-flags=--max-old-space-size=7168 --allow-net --allow-env --allow-read ../scripts/deploy-sheet.ts
```

Prints today's book: sleeve $ allocations, the current IVOL long/short names, the active distress
shorts, the **live de-gross status**, and this runbook's gates. Re-run it each rebalance.

## 1. Capital — why ~$100–150k is the floor

The name-level sleeves (distress 2.5%, IVOL 4%) are **low-weight** (risk-parity weights by vol; they
carry the edge through *diversification*, not size). So per-name dollars are small, and the bind is
**per-name fillability, not name count**:

| capital | IVOL per-name (66 names) | distress per-name (basket) | verdict |
|---|---|---|---|
| $30k | ~$76 | ~$11 | name-level shorts unfillable → only trend/long/crypto (excess ~0.89) |
| **$120k** | **~$300** | **~$45** | **name-level shorts fillable; full edge ~2.08** |

Below ~$100k you are running the **ETF-native subset** (trend + long + cryptomom, excess ~0.89), not
the full edge. The full name-level edge needs ~$100–150k.

## 2. The book, sleeve by sleeve (what to hold)

| sleeve | weight | instrument | fillability |
|---|---|---|---|
| **trend** | ~55% | 110-asset trend, or a managed-futures ETF (DBMF/KMLM) + micro futures | easy |
| **long** | ~24% | broad equity (SPY/VTI), vol-scaled | easy |
| **cryptomom** | ~15% | top coins by 3–12m momentum (or IBIT/spot) | easy |
| **IVOL** | ~4% | 33 lowest-idio-vol LONG / 33 highest-idio-vol SHORT (borrow-OK) — from the sheet | **hand-fillable (66 names)** |
| **distress** | ~2.5% | short the active flagged names — from the sheet | **breadth anomaly: use a BASKET order** |

**Distress is the one sleeve that resists hand-filling (D-954).** Concentration *hurts* it (Sharpe
1.63 → 1.12 → 0.50 as you cap to 50/20 names), because the edge is diversified across many flagged
names. So: short the **full active set via a basket/list order** if your broker supports one (keeps
excess 2.08); only if you must hand-fill, take the top-50 most-liquid for a measured **−0.29 haircut**
(blend 2.08 → 1.79). Never below ~50 names.

## 3. The de-gross overlay (squeeze protection — watch this daily)

The sheet prints the **10-day short-book bleed**. When it is **below −1.0%**, the rule fires:
**hold the distress + IVOL shorts FLAT (to cash)** until it recovers above −1.0%. Leave the long legs
(IVOL long, trend, long, crypto) on. This is the D-947 rule that turned the Jan-2021 squeeze from
−14% to −10% max drawdown. It is *insurance*: ~neutral on average, protects the acute tail.

## 4. Cadence

- **IVOL + distress:** rebalance **monthly** — re-run the sheet, adjust to the new name list.
- **trend:** weekly. **cryptomom:** weekly.
- **de-gross check:** every trading day (it only acts occasionally, but the trigger is daily).

## 5. Sizing

Run the sheet at your armed capital. Book vol target **20%** (quarter-Kelly-ish → ~40%/yr at excess
~2.0, max drawdown you must be able to hold **≈ −28%**). Do **not** run full-Kelly (empirically 12x,
−167% = ruin). If a −28% drawdown would make you abandon the book, size at 10% vol (~21%/yr, −14%).

## 6. The staged gates (LADDER.md) — do not skip a rung

| rung | capital | execution | advance when |
|---|---|---|---|
| **PAPER** (now) | $0 | forward clock `fwd-distress-ivol-blend-5` (marked daily, DORMANT) | clock matures: ≥30 OOS marks, forward Sharpe clears its pre-registered floor |
| **MICRO** | tiny (~$1–5k) | **you place every fill by hand** | ≥50 real fills, live within ~1 std of model, kill-switch never breached |
| **SMALL** | $10–50k (name-level edge partial until ~$100k) | first *deterministic* autonomous orders, quarter-Kelly ceiling | ≥100 live trades positive across ≥2 rebalances |
| **SCALED** | up to the ~$1–5M capacity ceiling | governed, kill-switch-bounded | — |

**MICRO is where you prove execution + discipline, not the edge** (the edge is proven on decades of
history). At MICRO's tiny size the name-level shorts aren't per-name-fillable, so run the **ETF-native
slice** (trend/long/crypto) to prove fills + kill-switch; the full name-level book comes online at
SMALL+/~$100k.

## 7. Kill-switch (non-negotiable)

- A **durable row** (survives restarts). If the book draws past your rung's drawdown limit, **flatten
  and step down a rung**. Do not re-enter until you have re-read why.
- **Claude never places an order at any rung below SMALL, and never places a name-level order.** Claude
  prints the sheet and marks the paper clock; you execute.

## 8. What is NOT yet done (honest open items)

1. **Distress full-breadth execution** needs a broker basket/list-order capability — confirm yours has it.
2. **Capacity ~$1–5M** (distress small-cap borrow binds first) — the book does not compound forever;
   above ~$1–5M the edge decays into the high-capacity sleeves.
3. **The forward clock is 3 days old** — the honest expectation is ~2.0 excess, but the PAPER→MICRO gate
   wants the clock to mature before real money. Do not front-run the clock.
