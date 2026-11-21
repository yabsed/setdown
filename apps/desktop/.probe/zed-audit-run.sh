#!/usr/bin/env bash
# Runs the audit for the named languages one after another on the isolated display.
# usage: zed-audit-run.sh <pass> <name>...
set -u
cd "$(dirname "$0")/.."
export AUDIT_DIR="$(cd ../.. && pwd)/target/validation/zed-languages-ui-audit-2026-11-21"
export AUDIT_PASS="$1"; shift
for name in "$@"; do
  echo "=== $name ($AUDIT_PASS) $(date +%H:%M:%S) avail=$(free -m | awk 'NR==2{print $7}')M"
  systemd-run --user --scope -q -p MemoryMax=5500M -p MemorySwapMax=0 bash scripts/with-isolated-display.sh npx playwright test --config .probe/playwright.config.ts zed-audit -g "audit $name\$" 2>&1 | grep -v "dbus\|xdg-desktop\|MESA\|^$" | grep "passed\|failed\|Error\|STEP FAILED" | cut -c1-300
done
echo "=== done $(date +%H:%M:%S)"
