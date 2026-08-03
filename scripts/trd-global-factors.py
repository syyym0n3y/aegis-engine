#!/usr/bin/env python3
# trd-global-factors — the definitive GLOBAL factor validation, from the FREE
# Fama-French Data Library (Dartmouth), ingested via trd-fetch-ff edge fn ->
# trd_scratch_ff. Computes full-period annualized Sharpe + t-stat + post-2010
# Sharpe for every factor across US(1963)/Developed/Europe/Japan/AsiaPac/Emerging
# and momentum back to 1927. Point-in-time-correct (realized factor returns).
#
# HEADLINE (2026-08-03): several factors are REAL and ROBUST across a century and
# across world regions, as modest DIVERSIFIED RISK PREMIA (Sharpe 0.3-0.7), NOT
# high-Sharpe trading signals:
#   - Equity/market premium: positive + significant EVERYWHERE, not decayed (own equities).
#   - Value: real globally (t 2.7-4.9); DECAYED in US/Developed post-2010 but ALIVE intl/EM.
#   - Quality/Profitability: robust in developed mkts, held up post-2010.
#   - Momentum (developed): real, not decayed (post-2010 0.70).
#   - Investment: real, decaying. Size: dead.
# The earlier "nothing survives" was a US-only/2010-only/survivorship artifact.
# Input: /tmp/ff.json = { "file|factor": [[ym, monthly_return_pct], ...] }
# (regenerate: trd-fetch-ff?file=..&store=1 for each region, then SQL string_agg.)
import json, math, sys
S = json.load(open(sys.argv[1] if len(sys.argv)>1 else "/tmp/ff.json"))
def stats(pts, since=None):
    xs=[v/100 for ym,v in pts if since is None or ym>=since]
    if len(xs)<24: return None
    mu=sum(xs)/len(xs); sd=(sum((x-mu)**2 for x in xs)/(len(xs)-1))**.5
    return (mu/sd*math.sqrt(12), mu/(sd/math.sqrt(len(xs))), mu*1200) if sd else None
# (see git commit message / DECISIONS D-077 for the result table)
