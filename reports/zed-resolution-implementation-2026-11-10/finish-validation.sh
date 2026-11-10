#!/usr/bin/env bash
set -euo pipefail
task_root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
artifacts="$task_root/target/validation/zed-resolution-2026-11-10"
cd "$task_root"
export SETDOWN_BUILD_SOURCEMAP=0 CARGO_BUILD_JOBS=1
export CARGO_TARGET_DIR="$task_root/target/language-host"
case "${1:-}" in
  '') npm run test:preview-contract > "$artifacts/contract.log" 2>&1 ;;
  --after-contract) test -f "$artifacts/contract.log" ;;
  *) echo "Usage: $0 [--after-contract]" >&2; exit 2 ;;
esac
node tooling/language-host/test/resolution.mjs > "$artifacts/real-zed-resolution-final.log" 2>&1
npm run bench:preview -- --baseline "$artifacts/baseline" --output "$artifacts/benchmark" > "$artifacts/benchmark.log" 2>&1
cd "$task_root/apps/desktop"
SETDOWN_RUST_ANALYZER_PATH="$task_root/target/validation/language-global-settings-2026-11-10/rust-analyzer" bash scripts/with-isolated-display.sh ../../node_modules/.bin/playwright test --config playwright.language-servers.config.ts --output "$artifacts/real-language-servers" > "$artifacts/real-language-servers.log" 2>&1
../../node_modules/.bin/electron-builder --linux dir --publish never --config.directories.output=release/zed-resolution-2026-11-10 > "$artifacts/package.log" 2>&1
cd "$task_root"
bash apps/desktop/scripts/with-isolated-display.sh node reports/zed-resolution-implementation-2026-11-10/check-packaged-settings.mjs > "$artifacts/packaged-settings.log" 2>&1
