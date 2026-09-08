# _self-restart.sh (D-824) — sourced by every RESIDENT shell daemon. Makes source drift self-correcting instead of
# merely detectable.
#
# THE DEFECT. bash parses a `while … done` body ONCE. A launchd daemon started on 08-21 keeps executing the 08-21
# body no matter how the file grows, so every block added later never runs and every fix committed later never takes.
# This programme has now paid for it three times: D-793 (eight refresher blocks added over two days, NONE of them ever
# executed under launchd, while the loop cycled "successfully"), D-798 (the FPI/ADR flag path fixed repo-relative in
# the source while the running loop still resolved it against cwd=infra and reported the correction as a no-op), and
# again 2026-09-08 — `coverage-guard-up.sh` up 1.2h on pre-commit source was writing THREE separate REDs per cycle
# (registry-guard "only 0 guard script(s) found", the fpi-flags no-op, and a broken micro-sheet/perp-refresh path)
# into a log nobody reads. All three vanished on a restart; not one was a real finding.
#
# WHY THE EXISTING GUARD IS NOT ENOUGH. `daemon-drift-guard.ts` compares process start time to the newest commit and
# goes RED — that is DETECTION, and it only helps on the cycle a human reads the board. Between the commit and that
# read, the daemon writes fresh logs full of already-fixed failures, which is precisely the hour D-719/719b lost. The
# durable form is for the loop to notice its own file changed and exec the current source. Detection stays (the guard
# still catches a daemon whose *import closure* moved, and any daemon that forgets to call this).
#
# USAGE — resolve $0 to an absolute path BEFORE any `cd`, source this, then call the function as the FIRST statement
# inside the loop body:
#   SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"; . "$(dirname "$SELF")/_self-restart.sh"
#   while true; do self_restart_if_changed; …; done
# The check is one shasum of one file per cycle. exec replaces the process image, so the pid, the launchd job and the
# StandardOut/StandardError paths are all preserved — the daemon does not "restart" from launchd's point of view.
SELF_SHA0="$(shasum -a 256 "$SELF" | cut -d' ' -f1)"
self_restart_if_changed() {
  local now=""
  now="$(shasum -a 256 "$SELF" 2>/dev/null | cut -d' ' -f1)" || return 0
  # An unreadable or mid-write file yields an empty hash. Do NOT exec on that — a transient read failure must not
  # turn into a restart loop; the next cycle re-checks and the drift guard still covers a genuinely stuck daemon.
  [ -n "$now" ] || return 0
  if [ "$now" != "$SELF_SHA0" ]; then
    echo "$(date -u +%FT%TZ) SELF-RESTART: $SELF changed on disk — exec'ing the current source (D-824)"
    exec /bin/bash "$SELF"
  fi
}
