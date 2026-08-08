#!/usr/bin/env bash
# trd-forward-status — read the live forward-paper verdict for every registered candidate. Operator-owned,
# no auth needed (the tick fn is public-read cron). Runs the tracker once (idempotent) then prints the rollup.
# Usage: ./scripts/trd-forward-status.sh
set -euo pipefail
FN="https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-forward-tick"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
echo "== forcing a tick (idempotent — appends only new post-registration trades) =="
curl -s -X POST "$FN" -H "Content-Type: application/json" -o "$TMP"
python3 - "$TMP" <<'PY'
import sys, json
d = json.load(open(sys.argv[1]))
if not d.get("ok"):
    print("ERROR:", d); sys.exit(1)
print("tick @ " + d.get("ts", "?") + "\n")
print("{:<20} {:>6} {:>9}  verdict".format("candidate", "fwd N", "fwd meanR"))
for c in d["candidates"]:
    print("{:<20} {:>6} {:>+9.3f}  {}".format(
        c["candidate"], c.get("forwardN", 0), c.get("forwardMeanR", 0.0), c.get("verdict", "")))
print("\nGATE: a candidate is only promotable after >=30 forward trades with a positive mean")
print("consistent with its in-sample edge. Everything is PAPER ($0) — no order path exists.")
PY
