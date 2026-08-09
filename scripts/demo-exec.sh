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
  crypto)
    # 2nd edge (D-232): crypto MOMENTUM Donchian-20 breakout LONG on Alpaca crypto (24/7, paper). Same arm/killswitch.
    curl -s "${SB}/functions/v1/trd-crypto-exec" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  pairs)
    # 3rd edge (D-233): pairs/stat-arb, market-neutral. Fade |z|>2 on 24 verified pairs; entry+z-managed exit in one tick.
    curl -s "${SB}/functions/v1/trd-pairs-exec" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  vrp)
    # 4th edge (D-234): VRP short-vol PROXY (long SVXY) — contango-gated, 1R stop, term-structure thesis-exit.
    curl -s "${SB}/functions/v1/trd-vrp-exec" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  forward)
    need_srk
    echo "FORWARD-PAPER SCOREBOARD (virtual R, $0, no order path) — fwd_n / mean_r / verdict per candidate:"
    curl -s "${SB}/rest/v1/trd_forward_state?select=candidate,fwd_n,fwd_net_r_mean,verdict&order=fwd_n.desc" "${h_srk[@]}" \
      | python3 -c "import json,sys;[print(f\"  {r['candidate']:<26} n={r['fwd_n']:<4} meanR={str(r['fwd_net_r_mean']):<8} {r['verdict']}\") for r in json.load(sys.stdin)]" 2>/dev/null || echo "  (install python3 or query trd_forward_state directly)"
    echo "NOTE: 0 fires across rip-short/bbfade is EXPECTED in a bull tape — rip-short needs overbought-in-downtrend"
    echo "names (absent when most names are above their 200MA), bbfade needs SPY<200MA. Both edges are dormant-by-market."
    ;;
  pnl)
    echo "P&L + positions (via position manager):"
    curl -s "${SB}/functions/v1/trd-position-manager" -H "Authorization: Bearer ${ANON:-$SRK}" | python3 -m json.tool 2>/dev/null || echo "(needs python3)"
    ;;
  flat)
    read -p "FLATTEN ALL positions? type FLAT to confirm: " c; [ "$c" = "FLAT" ] || exit 1
    curl -s "${SB}/functions/v1/trd-position-manager?flat=1" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  manage)
    curl -s "${SB}/functions/v1/trd-position-manager" -H "Authorization: Bearer ${ANON:-$SRK}"; echo
    ;;
  *) echo "usage: $0 {status|arm|disarm|kill|tick|crypto|pairs|vrp|forward|pnl|flat|manage}"; exit 1;;
esac
