#!/usr/bin/env bash
# cockpit-open.sh (D-751) — open the owned cockpit. Renders it first if it is missing, so the command always shows
# something real rather than a stale file or a 404. Regenerate on demand: deno run -A scripts/cockpit-render.ts
cd "$(dirname "$0")/.."; set -a; . infra/.env 2>/dev/null; set +a; export OWNED_REST="http://localhost:${REST_PORT:-33000}"
[ -f data/cockpit.html ] || deno run --allow-net --allow-env --allow-read --allow-write --allow-run scripts/cockpit-render.ts || true
open data/cockpit.html
