#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
report="$PWD/reports/memory-management-2026-11-08"
python3 "$report/resource-watch.py" "$$" "$report/build-resource-watch.json" &
guard_pid=$!
trap 'kill "$guard_pid" 2>/dev/null || true' EXIT
/usr/bin/time -v npm run build > "$report/build-low-memory.log" 2>&1
