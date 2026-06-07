# AI-SMB Venture Playbook — research synthesis (2026-06-08)

> Output of a 8-stream research workflow + 2 adversarial verifiers (both: "sound-with-fixes",
> "unusually honest — closer to a falsification engine than guru-bait"). The honest answer to
> "which AI-leverage SMB niches can I exploit, vertically integrated with my CC/YGS substrate,
> globally". NONE of this is legal/tax advice — the visa/tax steps need a regulated adviser.

## The uncomfortable truth first

- **The generic "AI automation agency" is the #1 guru-poisoned trap.** `[Certain]` 90% of AI-agent
  businesses fail in 2026; 60% of 2025-launched agencies have <5 client projects; course-sellers
  out-earn operators. The build is trivial (that's the whole pitch), so **building is NOT the moat.**
- **Your two scarce assets are DISTRIBUTION and an OPERATOR position** (owning where the business
  runs). You already half-own both via YGS (content) + CC (orchestration). Everything hinges on that.
- **The single load-bearing UNPROVEN assumption** (the skeptic's #1 catch): *does YGS-style content
  actually reach + convert B2B trade OWNERS?* They live on referrals / Google / Checkatrade, not
  YouTube. If that transfer fails, the moat is fictional. **Falsify this FIRST, cheaply, in the
  visa-safe window — before building any delivery.**

## The shape that works (not an agency)

A **vertical, distribution-led, ops-embedded RECURRING service in ONE niche, fed by owned content,
that hardens into software.** You don't sell a website — you become a piece of their operations
(missed-call recovery + AI receptionist + booking follow-up + review-gen), a monthly utility with
real switching costs.

## Top niches (ranked) — but the wedge is already saturated; the moat is distribution + embedding

| # | Niche | Model | Honest caveat |
|---|---|---|---|
| 1 | UK trades — ONE trade (electricians/HVAC, **NOT plumbers** = guru template) | recurring "revenue-recovery operating layer" £120–350/mo | **Already saturated** (UK competitors live at £497–997/mo). The "not plumbers" swap doesn't escape it. Only content-led acquisition + ops-embedding keep it off the race-to-zero — both unproven for you. |
| 2 | Solo law firms / accountants — intake & retention | outcome/flat retainer £200–500/mo | Highest revenue-per-event (~£8k/recovered client) BUT highest liability — keep AI on intake only, never advice; PI insurance + GDPR DPA required. |
| 3 | Dental / vet — no-show recovery + recall + reputation | retainer £200–450/mo/location | Best recurring/low-churn fit; PMS integration is the real work; patient-data (UK GDPR) liability. |
| 4 | White-label / wholesale to existing agencies (B2B2C) | platform economics, near-zero labour | Bypasses acquisition + selling (visa-safe-ish) BUT surrenders YOUR distribution moat; inherits GoHighLevel's moat, not yours. A de-risk cashflow lane, NOT the main play. |

## The vertical-integration architecture (real vs romantic — honestly split)

- **DEMAND layer — reuse YGS as-is (~100% transfer, REAL):** point YGS at the trade's owner-intent
  search; content/SEO is the #1 B2B channel. This is your *only true unfair advantage* — wire it as
  the PRIMARY channel.
- **OPS/telemetry layer — reuse the CC spine (REAL):** generalize `channel_id → client_id`. CC's
  tables (demand_signals, cost_events, generation_jobs, win_scores, funnel_events, draft_trust_tiers)
  + cost-governance (estimate-confirm, Sonnet→Haiku→Local-35B) + idempotency generalize cleanly —
  CC was always "register/monitor/grow businesses across verticals". **Do NOT revive the dead agency
  multi-tenant tables.**
- **DELIVERY layer — build NEW but small (the conflation trap):** YGS's script→voice→video pipeline
  does **NOT** transfer to web/automation builds. Build a small new delivery agent-track under the
  existing 7-agent factory pattern; it inherits governance, not the video code.
- **THE COMPOUNDING RULE:** add streams as **ROWS** (new project row + niche config), never new
  codebases or new daily-attention surfaces. The moment a stream needs its own codebase/orchestrator/
  attention → it's over-extension cosplaying as leverage. Fold it back or kill it.
- **THE MOAT (Thiel anti-scale triple):** audience + niche workflow + orchestration + cross-vertical
  proprietary data (call-transcript patterns, no-show predictors, review-sentiment-by-trade). No
  depth-locked giant or course-buyer owns all three at once.

## Visa-safe structure (Stream 7 — `[Certain]`, but get a solicitor)

- **The test is WHERE WORK IS PHYSICALLY PERFORMED, not where incorporated.** Active business work
  while physically in the UK = prohibited self-employment — even for a foreign company, even at £0
  revenue. **The "US LLC / Estonia e-Residency" workaround is a MYTH.**
- **LEGAL NOW (current phase):** incorporate a UK Ltd **dormant/non-trading**; hold shares passively;
  unlimited **pre-trading R&D** (build substrate + content + prototypes). Zero clients pay, no
  director role. (The 10% rule blocks "employ myself via my own company".)
- **THE CLOCK:** apply for the **Graduate Route before 31 Dec 2026** (full 2yr unrestricted; 18mo if
  after) — submission date, not decision date.
- **TRANSITION:** Build (Student, now) → Monetise (Graduate Route, switch Ltd to trading) → Scale +
  settle (**Innovator Founder** — the only path to settlement; the CC/YGS substrate IS the
  "innovative + scalable" evidence the endorser demands). The visa path and the product path are the
  same path.
- **BRIDGE (if revenue must start sooner):** a *genuine* co-founder/operator with UK right-to-work
  runs revenue-facing ops + signs contracts; you stay sub-10% passive non-director. Fragile,
  substance-over-form — needs solicitor sign-off.
- **NON-NEGOTIABLE:** one paid consult with an SRA-regulated immigration solicitor + a SA/UK
  cross-border tax adviser (SARS worldwide-income; **deemed-disposal CGT exit charge** on ceasing SA
  residency — time it vs when equity has value). Update `SOLICITOR_REVIEW_BRIEF.md`.

## Honest economics (no guru hype)

- Generic solo AI-agency base rate = **failure** (0–2 unprofitable clients, quit <12mo). You beat it
  ONLY via owned distribution — *if* the content→trade-owner transfer works.
- Realistic: **£5–20k MRR** if churn controlled; **£20–50k MRR over 2–3 years** via cloning. NOT
  £100k/mo (~70% of micro-SaaS make <£1k/mo).
- Margins ~52% (AI "token tax"; inference ~23% of revenue) → push to 55–65% via outcome-pricing +
  routing routine work to the local 35B model. Price on OUTCOMES, never per-token.
- **Churn is the silent killer — model 5%/mo, not 2%** (voice/AI agencies run 15–25%/mo in year 1).
  Only defences: operational embedding / system-of-record (4+ integrations = 73% lower churn),
  <7-day time-to-first-value, annual-default billing.
- **2–3 year compounding asset, not a 90-day hack.** If the wedge can't beat the base rates WITH the
  distribution advantage (target <5%/mo churn, >50% margin, inbound-led, 3 pilots) → kill + re-pick.

## The first move (ordered, with the verifier fixes folded in)

0. **VISA GATE** — book the SRA-regulated solicitor consult; diarise 31 Dec 2026. Everything below
   stays strictly pre-trading until it clears.
1. **LOCK ONE NICHE** YGS can credibly create owner-facing content for (electricians/HVAC) — treat as
   re-pickable.
2. **FALSIFY DISTRIBUTION FIRST (the load-bearing test):** publish 5–10 niche-authority pieces aimed
   at trade OWNERS; measure whether *owners* (not consumers, not agencies) inbound. Free to fail in
   the visa-safe window. **If owners don't inbound, the moat is fictional → re-pick the niche.**
3. **FIRST 1–3 CLIENTS via warm outreach + one hand-built case study** — NOT "inbound from a channel
   that doesn't exist yet" (both verifiers flagged this gap).
4. **DELIVERY TEMPLATE (small):** one productized operating-layer under the 7-agent factory; embed
   into their stack (calendar/GBP/payments, 4+ integrations); <7-day time-to-value; **with RUNTIME QC
   for live client-facing AI** (an AI receptionist mishandling a call = liability + churn — the actual
   hard engineering, and the actual moat).
5. **WIRE CC TELEMETRY** (channel→client) so per-niche data accrues = the LLM-proof flywheel.
6. **SELF-SERVE "register a new client/project" CC action** (already on NEXT.md) so stream N costs
   config-time, not code-time.
7. **30-DAY FALSIFICATION TEST** before scaling: reach 20–50 owners via content; do 3 pre-commit to a
   paid pilot? Measure CAC, margin, 90-day retention vs the base rates. Distribution doesn't prove out
   → kill or re-pick fast.

## Global scaling

Clone the PLAYBOOK, not unrelated verticals. Dominate ONE trade in ONE region until it runs without
daily attention → then stream 2 = SAME engine cloned to the next geography (UK→SA→US/Commonwealth,
where the content travels) or an adjacent trade. Each clone = a new row. Later: a self-serve white-
label SaaS tier for the long tail. The content + per-niche data compound across every clone; that
cross-geo/cross-vertical synthesis lives in CC where no depth-locked incumbent can reach.

## Open forks (operator-only)

- **Which ONE niche** can you most credibly build owner-facing content authority for?
- **Co-founder/operator** with UK right-to-work — or plan on no-revenue-until-Graduate-Route (honest default)?
- **Revenue timing:** wait for Graduate Route (clean) vs genuine co-founder bridge (faster, fragile).
- **The owned outcome** you price on (recovered calls? booked jobs? recovered no-shows?).
- **White-label lane** in parallel for early cashflow + visa-buffer, or stay pure content-led?
