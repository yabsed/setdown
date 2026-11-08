#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
report="$root/reports/memory-management-2026-11-08"
baseline=/var/tmp/setdown-memory-baseline-4fc1637
python3 "$report/resource-watch.py" "$$" "$report/resource-watch.json" &
guard_pid=$!
trap 'kill "$guard_pid" 2>/dev/null || true' EXIT
npm run test:preview-contract > "$report/contract-complete.log" 2>&1
npm run bench:preview -- --baseline "$baseline" --runs 3 --output "$report/preview-benchmark" > "$report/preview-benchmark.log" 2>&1
# Both five-window measurements use one virtual display, sequentially.
cd "$root/apps/desktop"
bash scripts/with-isolated-display.sh bash -c '
  set -e
  node "$1/measure-mixed.mjs" "$2" "$1/mixed-baseline.json"
  node "$1/measure-mixed.mjs" "$3" "$1/mixed-candidate.json"
' _ "$report" "$baseline" "$root" > "$report/mixed.log" 2>&1
