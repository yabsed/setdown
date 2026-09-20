# Preview contract validation — 2026-09-21

Baseline: `d77e6526e89d009ef12842d133ac27a43b84d607`. Candidate: the working tree implementing the preview performance contract. Both used Electron 38.8.6 on the same Linux machine. Five repetitions per version, eight scenarios, five cycles per fresh app: **80 launches / 400 Esc cycles**.

All **48 comparison buckets passed** the default gate (regression requires both >25% and >50ms median increase). This is evidence of no detected regression under this workload, not a claim that every sample got faster or that hosted CI noise is calibrated.

[Machine, artifact hashes, thresholds and all samples used by the comparison](preview-contract-validation-2026-09-21.json). Raw traces/JSON and logs from this session remain at `/tmp/setdown-preview-contract-final`.

## Esc to latest-content capture

Numbers are baseline → candidate medians in milliseconds. Warm means the median of cycles 3–5 per app, then across apps. Source idle applies before the first Esc. These are native capture/readback timings including polling and IPC, not physical display presentation timestamps.

| Surface | Initial source idle | Edit each cycle | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| document | 0ms | no | 57 → 59 | 25 → 23 | 26 → 18 |
| document | 0ms | yes | 432 → 461 | 95 → 98 | 83 → 88 |
| document | 3000ms | no | 71 → 71 | 32 → 30 | 28 → 24 |
| document | 3000ms | yes | 115 → 121 | 95 → 93 | 93 → 89 |
| review | 0ms | no | 1177 → 1229 | 32 → 26 | 30 → 30 |
| review | 0ms | yes | 1344 → 1278 | 1777 → 1753 | 221 → 212 |
| review | 3000ms | no | 49 → 49 | 24 → 24 | 29 → 29 |
| review | 3000ms | yes | 238 → 231 | 222 → 194 | 187 → 173 |

## Double-click to editable source

A visible authored block is selected after Esc timing ends. Real CDP mouse events trigger the double-click; target selection is outside this metric.

| Surface | Initial source idle | Edit each cycle | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| document | 0ms | no | 46 → 20 | 54 → 52 | 22 → 24 |
| document | 0ms | yes | 20 → 21 | 17 → 20 | 15 → 17 |
| document | 3000ms | no | 26 → 28 | 23 → 21 | 19 → 20 |
| document | 3000ms | yes | 23 → 22 | 20 → 21 | 21 → 20 |
| review | 0ms | no | 40 → 42 | 13 → 12 | 20 → 19 |
| review | 0ms | yes | 41 → 45 | 27 → 23 | 24 → 19 |
| review | 3000ms | no | 43 → 39 | 12 → 13 | 18 → 19 |
| review | 3000ms | yes | 44 → 42 | 37 → 37 | 20 → 18 |

## Correctness and implementation verification

- `npm test`: **497 tests / 64 files passed**. The 18 source-control controller tests now obtain readiness through real public rendering responses and explicit final ACKs. The previous fixture fabricated a preview ID without the current readiness state; 13 tests failed before this update.
- `npm run typecheck`: no TypeScript/Svelte errors or warnings.
- `npm run test:preview-contract`: production build, focused unit/comparator tests and **10 actual Electron/Chromium E2E tests passed**. After including the updated source-control controller tests, the final focused unit command passed **98 tests / 13 files**, plus the three comparator tests.
- The final measurement harness and both built applications were hashed and verified unchanged throughout the comparison. The local baseline shared installed dependencies only because its lockfile and Electron version were identical; CI installs each checkout independently.
- A preliminary fixed-coordinate input run failed to return to source on a cold review cycle. It was rejected, not counted as a pass. The harness now targets a visible authored block and records input diagnostics. A fresh five-repetition run and the final five-repetition run both completed without regressions.
- Workflow YAML parsed locally. GitHub-hosted execution and the initial noise tolerances still need observation after publishing. At inspection, remote `main` had no branch protection and no `.github/workflows` directory. No remote writes have been made.

See [the maintained contract](preview-performance-contract.md) for the gates, baseline setup, limitations and required GitHub check names.
