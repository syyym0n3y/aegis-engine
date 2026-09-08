# NEXT — work queue (rewritten 2026-09-08, D-823: THE FIVE)

The research loop is FROZEN (decisions-guard: `GOLD: research` needs `ACTS-ON:` from D-823). The queue is now four things
that move money or the right to trade it, and nothing else:

1. **MICRO rung (operator):** set `MICRO_BUDGET`, read the hourly sheet (`data/micro-sheet.log` / cockpit), place the first
   fill by hand, record it with `scripts/micro-ledger.ts`. Review at 30 real fills (live vs model). Rule: micro-psl-fade-k24.
2. **Wealth ledger (operator):** three rows — deposit, wrapper, measured currency leak (`scripts/wealth-ledger.ts`).
3. **Prop route:** parked until 30 real micro fills; the clock stays registered and unpaid.
4. **Clocks:** 18 registered, scored daily; a matured verdict is the only thing that reopens research on a rule.

Standing: 30 guards; ceiling split (mined 5.4556 / pre-registered 2.89, admits nothing today); 0 promoted; nothing trades
until the operator places it. Full open list: [`docs/DEVIATION_REGISTER.md`](./docs/DEVIATION_REGISTER.md) §5.
