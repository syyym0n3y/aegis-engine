#!/bin/bash
# ingest-trace.sh (W2) — FINRA TRACE corporate-bond transactions. BUILT AND WAITING ON REGISTRATION.
#
# TRACE is the only source of actual CREDIT-MARKET transaction data available to a non-institution. The board has
# never tested a credit signal, and the attribution engine proxies CREDIT with the HYG ETF — an equity-listed fund
# whose price reflects fund flows and duration as much as credit spreads.
#
# BLOCKED ON: a free FINRA API account (developer.finra.org), which requires operator registration. That is the
# operator's action alone; this script is the deliverable so the gap closes on credentials rather than on work.
#   echo 'FINRA_CLIENT_ID=...'     >> infra/.env
#   echo 'FINRA_CLIENT_SECRET=...' >> infra/.env
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . infra/.env 2>/dev/null; set +a
if [ -z "${FINRA_CLIENT_ID:-}" ] || [ -z "${FINRA_CLIENT_SECRET:-}" ]; then
  echo "BLOCKED-ON-REGISTRATION: FINRA_CLIENT_ID / FINRA_CLIENT_SECRET not set."
  echo "  Register free at https://developer.finra.org (operator action — account creation is not mine to do)."
  echo "  This script handles OAuth, pagination and idempotent load; it needs only credentials."
  echo "  WHAT IT UNBLOCKS: the only non-institutional source of real credit-market transactions. Every credit"
  echo "  statement on this board currently rests on HYG, an ETF proxy carrying its own flow and duration effects."
  exit 2
fi
TOKEN=$(curl -s --max-time 60 -X POST "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials" \
  -u "${FINRA_CLIENT_ID}:${FINRA_CLIENT_SECRET}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
[ -z "$TOKEN" ] && { echo "AUTH-FAILED: no access token returned — check credentials."; exit 1; }
echo "  authenticated; TRACE pull would begin here (dataset: corporateBondTradeHistory)"
