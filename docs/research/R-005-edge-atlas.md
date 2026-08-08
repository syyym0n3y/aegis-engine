# R-005 — The Edge Atlas: every documented return source, classified (proactive, not reactive)

> Written to answer the operator's question: "if I can stumble on real low-risk edges, why can't you
> identify them across the data?" Answer: because (a) I searched directional/timing edges depth-first
> (the front-run region), and (b) the durable edges are STRUCTURAL PREMIA that don't live in free OHLCV.
> This atlas enumerates the WHOLE space up front so we stop stumbling. Verdicts reference DECISIONS.md.

## The core reframe
There are only ~4 ways to make money in markets. Retail obsesses over #1 (where it's hardest); the money
with reasonable R:R is in #2. #3–4 are structural seats retail can't buy.

| # | Source | What you're paid for | Retail-accessible? |
|---|---|---|---|
| 1 | **Directional / timing** | Predicting price direction | Yes — but crowded/front-run to zero |
| 2 | **Structural risk premia** | Bearing a risk others avoid | **Yes — this is the durable retail edge** |
| 3 | **Microstructure / flow** | Speed, liquidity provision | No — latency/capital gated |
| 4 | **Information / event** | Knowing/analysing first | Partly — analysis-gated |

## The atlas — every branch, honest verdict, and the DATA it needs

### 1. Directional / timing  (FRONT-RUN — tested exhaustively, dead)
| Edge | Data needed | Verdict |
|---|---|---|
| Chart patterns / TA / sweeps / TBR | free OHLCV | **DEAD** — 1M+ configs, daily+intraday, 10× tests → thin-to-noise (D-083, D-108, D-114/115) |
| Short-term mean-reversion | free OHLCV + VIX | **THIN/prop-shaped** — high win, +0.11R in high-VIX, needs frequency (D-111) |
| Cross-sectional / trend rotation | free OHLCV | **Uncorrelated diversifier, thin OOS** (D-108) |

### 2. STRUCTURAL RISK PREMIA  (the real retail edges — mostly NEED non-price data)
| Edge | You're paid to bear… | Data needed | Verdict |
|---|---|---|---|
| **Volatility risk premium** (sell options/covered-call/put-write) | tail/vol risk | **options chains + IV** | ★ **REAL, 84% positive** (D-116). Best found. Data gap: options. |
| **Equity risk premium** (buy & hold) | equity drawdowns | free | **REAL, biggest of all** — beats every timing strategy (D-071) |
| **Factor premia** (value, momentum, quality, size, low-vol) | factor drawdowns | **fundamentals** | **REAL** — the diversified factor book, Sharpe ~1 (D-071). Data gap: fundamentals. |
| **Carry** (FX carry, futures term, funding) | crash/convergence risk | **futures curves / funding** | **REAL but crypto-funding arbitraged to ~0 now** (D-107). FX/commodity carry untested. |
| **Credit risk premium** (HY/IG bonds) | default risk | **bond/credit data** | **REAL, untested** — HYG/LQD accessible, harvestable |
| **Term premium** (long duration) | rate risk | free (TLT) | **REAL, regime-dependent, untested standalone** |
| **Illiquidity premium** | lock-up | n/a | REAL but requires locking capital — not our lane |

### 3. Microstructure / flow  (STRUCTURALLY INACCESSIBLE)
Market-making, HFT, latency arb, order-flow internalisation. **Banks/MMs own these seats** — latency +
capital + exchange rebates. Retail cannot buy in. (D-092: order-flow free-proxy pre-falsified.)

### 4. Information / event  (ANALYSIS-GATED, untested)
Merger arb, post-earnings-drift, index-rebalance, IPO, activist/13F follow. **REAL but need event data +
analysis + sometimes capacity.** Congressional/Form-4/13F: crowded+lagged (the original thesis, D-070).

### 5. The meta-edge — RISK MANAGEMENT  (not a return source; the MULTIPLIER)
Kelly sizing, ruin-avoidance, tail-de-risk, survival. **The only near-certain +EV component** (D-070).
Turns any real edge into compounding; can't create an edge but multiplies one. **Already built + shipped.**

## What this atlas reveals (the answer to "what do we lack")
1. **Almost every REAL, accessible edge is a structural premium (row 2) — and most need data we don't have
   yet** (options/IV, fundamentals, curves, credit). Free OHLCV structurally contains only row 1 (the
   front-run stuff). **The bottleneck is DATA, not method.**
2. **The edges we've confirmed on free data are the exceptions**: ERP (buy&hold), factor book (needs some
   fundamentals but proxied via ETFs), mean-reversion (thin), and VRP (measurable via VIX, harvestable
   only with options data).
3. **The untested REAL branches** (worth the data spend, in order): **VRP/option-selling (options data),
   credit premium (bond data), FX/commodity carry (curve data), event-driven (event data).**

## How to serve ALL traders regardless of background (the product framing)
Match the trader to the edge that fits their constraints — the risk engine is universal underneath:

| Trader profile | Best-fit edge(s) | Vehicle |
|---|---|---|
| No time, any capital | ERP + factor book + covered-call VRP | index ETFs + monthly call-writing |
| Small account, active | mean-reversion (prop-shaped) + prop-farming | micros + our sizing engine |
| Options-comfortable | VRP: put-write / covered-call / wheel, tail-managed | options + D-100 tail engine |
| Sophisticated / more capital | full structural-premia stack + credit + carry | multi-asset, diversified |
| **Everyone** | **risk management (the multiplier)** | **portfolio-risk X-ray + ruin engine (shipped)** |

## The process fix (so we stop stumbling)
Search **breadth-first across families, data-aware**: for each row-2/row-4 branch, (1) name the premium,
(2) name the data it needs, (3) acquire minimal data, (4) test with the honest core, (5) rank. Proactive,
not reactive. Next data acquisitions ranked by edge-value: **options/IV (VRP) → credit → curves (carry).**
