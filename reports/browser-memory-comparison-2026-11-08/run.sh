#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
report="$root/reports/browser-memory-comparison-2026-11-08"
python3 "$root/reports/memory-management-2026-11-08/resource-watch.py" "$$" "$report/resource-watch.json" &
guard_pid=$!
trap 'kill "$guard_pid" 2>/dev/null || true' EXIT
bash "$root/apps/desktop/scripts/with-isolated-display.sh" bash -c '
  set -euo pipefail
  for product in chrome firefox setdown; do
    node "$1/measure.mjs" "$product" "$1/$product.json"
  done
' _ "$report" > "$report/run.log" 2>&1
