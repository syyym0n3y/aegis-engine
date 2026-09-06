# YGS Finance — Episode 01 script
## "I ran a trading research engine for eight months. It promoted zero edges. Here's why that's the win."

> TEN_TO_SEVEN_LEVER.md Action 1, first artifact. Every number below is from DECISIONS.md and is reproducible from the
> repo. Target length 11–12 min. Voice: the honest-advisor register, no hype, no "secret". Production: YGS pipeline
> (script → voice-align → storyboard → clips → render → upload, ~$33 per D-050), once the CC Supabase project is restored.
> Disclosure: research, not advice; nobody here is a licensed adviser; no signals are published (D-070 invariant).

### COLD OPEN (0:00–0:45)
**VO:** Eight months. Two point nine million backtests. Eighteen forward-registered strategies with kill rules written
before their data existed. Number promoted to real money: zero.
**ON SCREEN:** the immutable `trd_forward_rules` table scrolling; the line `-- 1 of 27 guards RED`.
**VO:** If you've watched trading content, you've been told the opposite of what I'm about to show you. So let me show
you the receipts instead of the claims.

### THE BASE RATE (0:45–2:00)
**VO:** Roughly 97% of retail traders lose money. Under 1% beat fees over fifteen years. Every "ten-second setup"
video is made by someone drawn from that distribution — and the ones you see are the survivors of it.
**ON SCREEN:** the two prior-work figures; then the screenshot wall from 2026-09-06 (blurred handles): "wait for
manipulation at 10AM", "POV: you mastered trade management", "90% chance we stay in the IV range — $100/mo".
**VO:** I didn't argue with these. I measured them.

### THE ENGINE, IN ONE MINUTE (2:00–3:15)
**VO:** Twenty-seven machine guards. Each one exists because I got something wrong and wrote a rule that would have
caught it. Coverage: a null is only a finding if the data could have detected it. Breadth: fourteen names is not a
factor. Execution: a limit order is a hypothesis about fills. Pre-commitment: a forward test without a written kill
rule is an option to rationalise later. And the one that matters most tonight — every guard is verified by making it
fail on purpose before it's trusted.
**ON SCREEN:** `guard-status.sh` output, 27 rows.

### RECEIPT 1 — the 10AM "manipulation" trade (3:15–4:30)
**VO:** The claim: at 10AM New York, wait for the sweep of yesterday's high or low, then fade it. I marked every 10AM
bar on the Nasdaq for ten years — 2,620 of them — with yesterday's high and low and the Asian range as context.
**ON SCREEN:** D-779 table.
**VO:** Fading the sweep of the high: minus eight basis points a trade after costs, forty percent win rate. Fading the
sweep of the low: minus ten, forty-five percent. Both lose. The only thing that survived at 10AM was the opposite —
a close *above* yesterday's high kept going: plus six and a half, sixty percent, on 739 events. Continuation, not
manipulation. Ten years of data disagreed with the reel.

### RECEIPT 2 — the trade I almost believed (4:30–6:30)
**VO:** This is the one that matters, because it's the one that fooled me. Liquid US stocks that close below their
twenty-day low, bought and held five days. On the top decile by volume: plus thirty-seven basis points a trade,
t-statistic of ten, two years out of sample, 62,000 events. That is a number that makes you reach for a broker.
**ON SCREEN:** D-784 table; then the D-785 skepticism block.
**VO:** So the protocol ran. Per-symbol sign: sixty-nine percent positive — passes. Survivorship: 2,642 dead stocks
in the sample — passes. Then the one that mattered: those 62,000 events happened on 948 days. Market-wide sell-offs
fire hundreds of stocks at once. The honest sample is days, not events. t-stat of ten became t-stat of two point five.
Still real — but a modest edge that only works above about a hundred thousand in a book, because below that the
commission per trade eats it.
**VO:** It's now forward clock number eighteen, with a kill rule. And the next morning I found something else.
**ON SCREEN:** D-791 VIX3M table.
**VO:** The whole edge lives when volatility is elevated. In calm markets — more than half the sample — it's
negative after costs. The clock stands. My optimism about it got corrected on the record, by me, the same night.

### RECEIPT 3 — the number that "cleared the ceiling" (6:30–8:00)
**VO:** Relative volume, first touch below yesterday's low, seventeen instruments across crypto, indices and FX:
t-stat seven point eight six. Above the programme's deflation ceiling for the first time in its history. I wrote the
four tests it had to pass before I would register it — wrote them first, then ran them.
**ON SCREEN:** D-776 → D-777.
**VO:** Per asset class: the effect was crypto. FX was significantly negative. Per year: 2023, 2024, 2025 strongly
positive — 2026, minus forty-four basis points, sign-flipped. Retracted, two commits after it was found.
**VO:** And here's the pattern. Four different "buy the intraday dip" constructions — different entries, same
asset — all flipped negative in 2026. Something changed in crypto microstructure this year. I don't know what yet.
I know that four independent measurements agree, and that the equity version didn't break.

### RECEIPT 4 — "mastered trade management" (8:00–9:15)
**VO:** The reel shows pyramiding into winners and trailing runners. I took my own strongest live setup — 989 forward
trades — and ran six exit policies over it.
**ON SCREEN:** D-794 (g) table.
**VO:** Hold a fixed time: plus fifteen. Move to break-even after one ATR: plus seventeen. Take half off early:
plus eleven, smoother. Trail the stop: plus zero point one. Pyramid: plus zero point eight. The two techniques
marketed as mastery destroyed the edge. Not weakened — destroyed. The move you're fading trips the trailing stop
before it completes.

### THE PART NOBODY MONETISES (9:15–10:30)
**VO:** So what actually compounds? I replayed thirty-four years of a boring index fund with a hundred and fifty a
month, and then every "know when to get out" overlay I could build. Buy-and-hold: nine times the money. Every
overlay finished a hundred and sixty to two hundred thousand poorer. The tax wrapper alone — the ISA — is worth
more per year than any edge this engine has ever promoted. Zero point six to one point four percent, forecast-free.
**ON SCREEN:** WEALTH_PATH §1 table; D-758 line.
**VO:** At a small budget the arithmetic is brutal and simple: terminal wealth is deposits, times time, times one
minus leakage, plus alpha. Alpha is zero. The next deposit beats a three percent edge that nobody has.

### CLOSE (10:30–11:30)
**VO:** This engine's job isn't to find you a trade. Its job is to say no — loudly, on the record, with the numbers
attached — until something actually survives. Eighteen clocks are running. Most will die. That's what they're for.
**VO:** Next episode: the coverage law — how I nearly closed the whole programme on a null result that was really a
missing dataset.
**ON SCREEN:** repo, DECISIONS.md scrolling, end card. No CTA to a paid product. Ever.

---
### Series outline (six episodes, one law each, every case study a real D-number)
1. **This episode** — pre-commitment & the retract-on-the-record protocol (D-571, D-776/777, D-785/791).
2. **Coverage** — a null is only evidence if the data could detect it (the five missing EDGAR concepts; D-641 false zeros).
3. **Breadth & universe** — fourteen names is not a factor (D-443, D-535, D-773 R2 retraction).
4. **Execution** — a limit order is a hypothesis about fills (D-445/447: the 20:00 UTC window; D-794 C.E. vs edge).
5. **Instrument & turnover** — the edge and the vehicle are not the same object (D-575 4-of-4; D-654 EM momentum).
6. **The structural engine** — deposits × time × (1−leakage): D-735, D-744, D-746, D-758, the wealth ledger.
