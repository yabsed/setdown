# Terminal integration validation (2026-09-21)

Baseline: `7ce821fa7be50dd7d55e249bd814a0423c6db1a7`, separate checkout `/tmp/setdown-terminal-base` with independently installed dependencies. Candidate: working tree with integrated terminal. Electron 38.8.6 for both. Same machine/display, alternating baseline/candidate order, five matched repetitions (80 fresh application launches).

**PASS: all 48 comparison buckets, zero regressions.** Default tolerances unchanged: a regression must exceed both 25% and 50 ms. All eight scenarios and latest-content captures were validated. Terminal is closed in this standard preview benchmark; terminal-open behavior is covered by its Electron integration test.

Values below are baseline → candidate medians in milliseconds. First and second cycles remain separate; warm is the median of cycles 3–5 per launch, then across launches. Preparation is time spent in source before Escape (0 or 3000 ms).

## Escape to verified native capture

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 59 → 85 | 28 → 26 | 26 → 23 |
| Markdown | Yes | 0 | 471 → 420 | 94 → 90 | 93 → 85 |
| Markdown | No | 3000 | 71 → 68 | 33 → 28 | 27 → 24 |
| Markdown | Yes | 3000 | 129 → 122 | 98 → 97 | 98 → 99 |
| Git review | No | 0 | 1254 → 1164 | 29 → 28 | 28 → 29 |
| Git review | Yes | 0 | 1320 → 1332 | 1779 → 1781 | 216 → 223 |
| Git review | No | 3000 | 47 → 50 | 23 → 25 | 22 → 30 |
| Git review | Yes | 3000 | 237 → 231 | 201 → 227 | 182 → 182 |

## Double-click to editable source

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 34 → 19 | 47 → 36 | 22 → 23 |
| Markdown | Yes | 0 | 24 → 20 | 18 → 16 | 15 → 14 |
| Markdown | No | 3000 | 26 → 26 | 23 → 22 | 20 → 20 |
| Markdown | Yes | 3000 | 29 → 30 | 21 → 23 | 21 → 20 |
| Git review | No | 0 | 39 → 45 | 13 → 18 | 19 → 21 |
| Git review | Yes | 0 | 45 → 47 | 24 → 25 | 22 → 23 |
| Git review | No | 3000 | 41 → 41 | 13 → 12 | 17 → 18 |
| Git review | Yes | 3000 | 40 → 43 | 39 → 36 | 19 → 20 |

Capture latency includes input polling, IPC and capture readback; it is not a monitor presentation timestamp.

## Checks

- `npm test`: 65 files, 501 tests passed.
- `npm run test:preview-contract`: focused unit tests, comparator tests, build/typecheck, and all 10 real Electron/Chromium tests passed.
- `npx playwright test test/e2e/terminal.spec.ts`: both Electron integration tests passed. Real shell, Markdown disk updates and editor save, session preservation, Ctrl+C/Escape routing, native reader bounds, panel resize, session exit, empty-window startup, project cwd, and PTY cleanup on reload were checked on Linux. Windows/macOS execution has not been validated here.

Benchmark bucket samples, environment, identities, hashes and comparisons: [terminal-preview-benchmark-2026-09-21.json](terminal-preview-benchmark-2026-09-21.json). Full per-run measurements and traces remain in `/tmp/setdown-terminal-benchmark/comparison.json`; all run logs are in the same directory.
