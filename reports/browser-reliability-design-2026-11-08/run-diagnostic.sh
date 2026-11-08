#!/usr/bin/env bash
set -euo pipefail
report=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$report/../.." && pwd)
cd "$root/apps/desktop"
python3 "$root/reports/memory-management-2026-11-08/resource-watch.py" "$$" "$report/resource-watch.json" &
guard_pid=$!
trap 'kill "$guard_pid" 2>/dev/null || true' EXIT
bash scripts/with-isolated-display.sh ../../node_modules/.bin/playwright test --config "$report/playwright.config.ts" "$@" > "$report/${SETDOWN_REPORT_LOG:-diagnostic.log}" 2>&1
