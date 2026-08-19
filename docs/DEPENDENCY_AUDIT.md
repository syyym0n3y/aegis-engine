# DEPENDENCY_AUDIT.md — is any subscription MANDATORY for scale + dominance?

> Operator question (2026-08): ensure there is no subscription I *must* pay to scale and dominate. Honest, item-by-item audit
> of every paid dependency across Aegis + YGS/CC. Verdict per item: **OWNABLE** (replace with owned/free — no subscription
> needed), **CAPEX-TO-OWN** (own it, but it costs hardware not a subscription), or **EXTERNAL** (irreducible, but NOT a
> subscription). No item is a mandatory subscription.

## Bottom line

**No — there is no subscription you are forced to pay to scale or dominate.** Every *infrastructure* rental is replaceable
with owned/free and this is proven, not asserted (D-368: the full Aegis loop ran on an owned Postgres this session with the
identical result). The only things you cannot "own" are a **broker** (regulated — needed for real-money execution) and a
**distribution platform** (YouTube) — and **neither is a subscription** (commission-free per-trade; free to publish). The only
place ownership costs money is **capex** (a box; GPUs if you self-host AI) + **utilities** (power, internet) — that is
ownership replacing rent, not a subscription.

## The audit

| Dependency | What it is | Subscription? | Verdict | How you own / avoid it |
|---|---|---|---|---|
| **Supabase** | Postgres + API + auth + edge | 2 paid projects (~$10/mo ea) | **OWNABLE** ✅ proven | Self-host Postgres + PostgREST on owned box (`infra/`, D-368). Identical API, owned data. |
| **Vercel** | Frontend hosting | free/~$20 | **OWNABLE** ✅ | Serve static bundles from owned Caddy/nginx (`infra/caddy`). |
| **Shotstack** | Video compose (~$0.40/render) | pay-per-use | **OWNABLE** ✅ | Shotstack *is* FFmpeg-as-a-service. Run **FFmpeg** yourself — free, full control. |
| **Databento** | Market data (metered) | pay-per-use, optional | **OWNABLE** ✅ | Already optional; the free/keyless sources cover the mission (Yahoo, SEC, Ken French, Binance). |
| **KIE.ai** | Video generation (Kling/Veo/Luma/Runway) | pay-per-use | **CAPEX-TO-OWN** ⚠️ | Self-host open video models on owned GPUs (eliminates the per-use rent; current open models trail Kling/Veo in quality — a quality-vs-ownership tradeoff at the frontier). Not a subscription either way — scales with output. |
| **ElevenLabs** | Text-to-speech | pay-per-use | **CAPEX-TO-OWN** ⚠️ | Self-host open TTS (XTTS-v2, Piper, StyleTTS2) on owned GPU — free after hardware. ElevenLabs is higher quality today; gap is closing. |
| **OpenRouter / KIE LLM** | LLM inference (strategy reasoning, script-gen) | pay-per-use | **CAPEX-TO-OWN** ⚠️ | Self-host open LLMs (Llama/Qwen/DeepSeek) on owned GPU. NOT in the order path (invariant). Pay-per-use, not a subscription. |
| **Alpaca** | Brokerage (paper now; real later) | per-trade, commission-FREE | **EXTERNAL** 🔒 | You cannot own a regulated broker (exchange membership + regulatory capital). Commission-free equities → ~$0 at scale. Not a subscription. |
| **YouTube Data API** | Publish + distribution | free (quota-limited) | **EXTERNAL** 🔒 | You cannot own YouTube. Free to publish. The *channel/audience* you build is YOUR asset on top of it. Not a subscription. |
| **Free data (SEC, Yahoo, Ken French, Binance)** | Research inputs | free/keyless | **EXTERNAL** 🔒 | Free. At extreme scale they rate-limit — mitigate with owned IPs (the worker already runs on your IP), caching to owned DB, and only paying for data when ROI-positive. Not a subscription. |

## The three things you genuinely cannot "own" — and why none is a subscription

1. **A broker (execution).** Real-money trading requires a regulated broker with exchange membership — a legal/capital moat, not a subscription. Alpaca is commission-free, so at scale this trends to ~$0 per trade. You rent *access to the exchange*, not a service plan.
2. **A distribution platform (YouTube).** You publish for free; you cannot own YouTube. The durable asset is the **channel, the audience relationship, and the owned production data** — all of which you keep. (True independence from YouTube = build owned distribution, a separate massive undertaking, not required to start.)
3. **The frontier AI models (video/voice/LLM), if you want the current SOTA quality.** These are the one real pull toward paying — but it's **pay-per-use that scales with output, not a subscription**, and it's **capex-to-own**: buy GPUs, self-host open models, pay $0 per generation forever after (accepting today's open-model quality gap, which narrows monthly).

## The true "cost of ownership" that replaces subscriptions

Owning does not mean $0 — it means **capex + utilities instead of rent**, and those you own:
- **A machine** (one-time: a server/Mac Studio, ~$1–3k) + a cheap replica. Runs Postgres, API, FFmpeg, the control plane.
- **GPUs** (one-time, only if you self-host AI inference to kill the per-use spend) — the biggest capex, optional, ROI-driven.
- **Power + internet** (utility you already pay).

That is ownership: assets on the balance sheet + utilities, not a landlord's recurring subscription that produces nothing you own.

## The path to zero-mandatory-subscription dominance

1. **Own the infra** (proven): Postgres + PostgREST + Caddy + FFmpeg on an owned box → kills Supabase, Vercel, Shotstack rent.
2. **Own the AI compute when the volume justifies it**: when monthly KIE/ElevenLabs/LLM spend exceeds the amortized cost of a
   GPU box, self-host open models — pay-per-use → owned capex. Until then, per-use is not a subscription and scales with revenue.
3. **Keep the two EXTERNAL touchpoints** (broker + YouTube) — neither is a subscription; both are free/commission-free access
   to markets and audiences you could never replicate cheaper by owning.
4. **Own every byte of data** throughout (already the discipline) — so the companies have real, evaluable, transferable assets.

**Conclusion:** scale and dominance require **zero mandatory subscriptions.** The rent is all ownable/free (infra), the AI
spend is pay-per-use convertible to owned capex, and the only irreducible externals (broker, distribution) charge no
subscription at all. You can own the entire stack that matters and rent nothing you're forced to.
