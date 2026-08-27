#!/usr/bin/env bash
# wait-for-job.sh (D-651) — wait for a background job WITHOUT a self-matching pgrep.
#
# THE DEFECT THIS REPLACES. Waiting on a job with
#
#     until ! pgrep -f "shortvol-surprise" >/dev/null; do sleep 15; done
#
# never terminates, because the waiting shell's OWN command line contains the string "shortvol-surprise" — it appears
# in the very grep that follows the loop. pgrep therefore matches the waiter itself, the condition is permanently
# false, and the loop spins forever. Six such shells accumulated in one session, running 9 to 14 hours each, long
# after the jobs they were watching had finished and their results had been read and recorded. One had survived from
# an earlier session and had been spinning for three and a half days.
#
# It is the same shape as the defects this programme spent the day cataloguing: a check that cannot fail (D-641's
# false-negative queries), a control that measures itself (D-603's circular selection), a detector carrying the
# defect it detects (D-650's agent-output guard). Here the observer is inside the set it observes.
#
# THE FIX IS TO WAIT ON AN IDENTITY, NOT A DESCRIPTION. A PID is unambiguous and cannot match the waiter.
#
#   PID=$(nohup deno run ... > /tmp/job.log 2>&1 & echo $!)
#   scripts/wait-for-job.sh "$PID" /tmp/job.log
#
# Exits when the process exits. Prints the log tail so the caller sees the result rather than having to poll again.
set -euo pipefail

PID="${1:?usage: wait-for-job.sh <pid> [logfile] [timeout_s]}"
LOG="${2:-}"
TIMEOUT="${3:-0}"          # 0 = no timeout
INTERVAL="${WAIT_INTERVAL:-15}"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "wait-for-job: pid $PID is not running (already finished, or never started)"
  [ -n "$LOG" ] && [ -f "$LOG" ] && tail -20 "$LOG"
  exit 0
fi

elapsed=0
while kill -0 "$PID" 2>/dev/null; do
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
  # A timeout is a REPORT, never a silent give-up: a waiter that exits quietly looks identical to a job that
  # finished, which is the ambiguity the whole file exists to remove.
  if [ "$TIMEOUT" -gt 0 ] && [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "wait-for-job: TIMEOUT after ${elapsed}s — pid $PID is STILL RUNNING (not finished)"
    [ -n "$LOG" ] && [ -f "$LOG" ] && tail -20 "$LOG"
    exit 2
  fi
done

echo "wait-for-job: pid $PID exited after ~${elapsed}s"
[ -n "$LOG" ] && [ -f "$LOG" ] && tail -20 "$LOG"
exit 0
