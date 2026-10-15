# _night-window.sh (D-989) — sourced by the RESIDENT night-shift loops so they HOLD their launchd slot.
#
# THE DEFECT (measured in infra/data/coverage.log). The resident loops end every cycle with `sleep 86400`, so each new
# cycle starts "previous start + cycle duration + 24h". The coverage cycle takes ~2h, so its start walked ~2h later every
# day: 2026-10-07 21:33Z -> 10-08 23:34 -> 10-10 01:38 -> 10-11 03:28 -> 10-12 05:23 -> 10-13 07:20 -> 10-14 09:57. The
# StartCalendarInterval (02:40) only matters at the FIRST launch: launchd never re-fires a job that is still running.
# Second, any reload (boot-triage / launchctl at 2026-10-14 19:33-20:16Z, host up 10 days — not a reboot) starts the
# loop and the cycle runs IMMEDIATELY, wherever the clock is: that is the 20:16Z (21:16 BST) cycle — heavy work in the
# operator's evening, against the host-budget rule. Third, `sleep N` counts monotonic time that stops while the Mac
# sleeps, so a long sleep lands late by however long the lid was shut.
#
# THE FIX. (1) At the top of every cycle, if local time is outside [START, START+WINDOW_MIN) wait for the next START.
# (2) At the end of a cycle wait for the next START strictly in the future (never `sleep 86400`). (3) Wait in chunks of
# at most 300s against the WALL clock, so sleep/wake cannot skew the target. Targets are computed from tomorrow's DATE
# (not +86400s), so a DST change cannot shift the slot by an hour.
#   . "$(dirname "$SELF")/_night-window.sh"; NW_START=02:40
#   while true; do self_restart_if_changed; nw_wait_for_window; …cycle…; nw_wait_next_start; done
NW_WINDOW_MIN="${NW_WINDOW_MIN:-90}"
_nw_epoch_at() { date -j -f "%Y-%m-%d %H:%M:%S" "$1 $2:00" +%s; }   # $1 = YYYY-MM-DD, $2 = HH:MM (local)
_nw_next_start() {   # next local NW_START strictly later than now + 60s
  local today tomorrow t now
  now=$(date +%s); today=$(date +%Y-%m-%d); tomorrow=$(date -j -v+1d +%Y-%m-%d)
  t=$(_nw_epoch_at "$today" "$NW_START")
  [ "$t" -gt $((now + 60)) ] || t=$(_nw_epoch_at "$tomorrow" "$NW_START")
  echo "$t"
}
_nw_sleep_until() {
  local target="$1" now left
  echo "$(date -u +%FT%TZ) NIGHT-WINDOW: holding until $(date -r "$target" '+%F %H:%M %Z') (D-989)"
  [ "${NW_DRY:-0}" = "1" ] && return 0
  while :; do now=$(date +%s); left=$((target - now)); [ "$left" -le 0 ] && break; sleep $(( left < 300 ? left : 300 )); done
}
nw_in_window() {
  local now s; now=$(date +%s); s=$(_nw_epoch_at "$(date +%Y-%m-%d)" "$NW_START")
  [ "$now" -ge "$s" ] && [ "$now" -lt $((s + NW_WINDOW_MIN * 60)) ]
}
nw_wait_for_window() { nw_in_window || _nw_sleep_until "$(_nw_next_start)"; }
nw_wait_next_start() { _nw_sleep_until "$(_nw_next_start)"; }
