#!/usr/bin/env bash
# demo-exec.sh — OWNER-run control for the Alpaca PAPER (demo) rip-short executor (trd-alpaca-paper-exec).
# Arming an order path is the operator's deliberate act — Claude deploys it DORMANT and never arms it. This is the
# single-command surface you own to go live on the DEMO account (fake money, $0) and to halt it.
#
#   ./scripts/demo-exec.sh status     # show killswitch + arm flag + would-fire regime
#   ./scripts/demo-exec.sh arm         # set trd_exec_arm.paper.armed = true  (starts placing PAPER orders on the next tick/cron)
#   ./scripts/demo-exec.sh disarm      # set it false (dormant again)
#   ./scripts/demo-exec.sh kill        # trip the durable kill-switch (halts BOTH the executor and forward accrual)
#   ./scripts/demo-exec.sh tick        # invoke the executor once now (no-op unless armed + bull regime)
#
# Requires: SB_SERVICE_KEY (service-role, for the arm/kill writes) in your env. The demo account is Alpaca PAPER.
set -euo pipefail
SB="${SB_URL:-https://glzzoomuhnugsiichnub.supabase.co}"
ANON="${SB_ANON:-}"; SRK="${SB_SERVICE_KEY:-}"
h_srk=(-H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" -H "Content-Type: application/json")
cmd="${1:-status}"
need_srk(){ [ -n "$SRK" ] || { echo "ERROR: export SB_SERVICE_KEY=<service-role> first (arming needs service-role)"; exit 1; }; }
case "$cmd" in
  status)
    need_srk
    echo "kill-switch : $(curl -s "${SB}/rest/v1/trd_killswitch?id=eq.default&select=active" "${h_srk[@]}")"
    echo "arm.paper   : $(curl -s "${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed" "${h_srk[@]}")   (false/absent = DORMANT)"
    echo "rip-short legs active: $(curl -s "${SB}/rest/v1/trd_forward?candidate=like.ripshort-1d-*&active=eq.true&select=symbol" "${h_srk[@]}" | grep -o symbol | wc -l | tr -d ' ')"
    ;;
  arm)
    need_srk
    echo "ARMING demo executor (PAPER orders only, $0). Ctrl-C to abort."; read -p "type ARM to confirm: " c; [ "$c" = "ARM" ] || exit 1
    curl -s "${SB}/rest/v1/trd_exec_arm?on_conflict=id" -X POST "${h_srk[@]}" -H "Prefer: resolution=merge-duplicates" -d '{"id":"paper","armed":true}' >/dev/null
    echo "armed. It will place bracketed PAPER shorts on the next tick IF SPY>200MA and a rip-short signal fires."
    ;;
  disarm)
    need_srk
    curl -s "${SB}/rest/v1/trd_exec_arm?on_conflict=id" -X POST "${h_srk[@]}" -H "Prefer: resolution=merge-duplicates" -d '{"id":"paper","armed":false}' >/dev/null
    echo "disarmed — dormant."
    ;;
  kill)
    need_srk
    curl -s "${SB}/rest/v1/trd_killswitch?on_conflict=id" -X POST "${h_srk[@]}" -H "Prefer: resolution=merge-duplicates" -d '{"id":"default","active":true}' >/dev/null
    echo "KILL-SWITCH TRIPPED — executor + forward accrual halted. Re-enable by setting active=false."
    ;;
  tick)
    curl -s "${SB}/functions/v1/trd-alpaca-paper-exec" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  *) echo "usage: $0 {status|arm|disarm|kill|tick}"; exit 1;;
esac
