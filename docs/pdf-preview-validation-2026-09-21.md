# Reading positions and PDF validation (2026-09-21)

Baseline: `8033d9a32db68a8f44d36a19b10d21e1000bda15`, separate checkout `/tmp/setdown-pdf-base` with independently installed dependencies. Candidate: working tree with common reading history and the PDF reader. Electron 38.8.6 on both versions; same machine/display, alternating baseline/candidate order, five matched repetitions (80 fresh application launches).

**PASS: all 48 comparison buckets, zero regressions.** Default tolerances unchanged: a regression must exceed both 25% and 50 ms. All eight scenarios and latest-content captures passed validation.

The standard benchmark measures ordinary Markdown and Git review; PDF loading and restoration are covered by the separate Electron integration suite. Values below are baseline → candidate medians in milliseconds. First and second cycles remain separate; warm is the median of cycles 3–5 per launch, then across launches. Preparation means time spent in source before Escape (0 or 3000 ms).

## Escape to verified native capture

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 55 → 75 | 23 → 24 | 25 → 26 |
| Markdown | Yes | 0 | 446 → 447 | 85 → 92 | 83 → 86 |
| Markdown | No | 3000 | 70 → 71 | 33 → 37 | 30 → 25 |
| Markdown | Yes | 3000 | 122 → 125 | 101 → 97 | 101 → 98 |
| Git review | No | 0 | 1255 → 1287 | 26 → 23 | 29 → 29 |
| Git review | Yes | 0 | 1342 → 1351 | 1798 → 1798 | 219 → 224 |
| Git review | No | 3000 | 49 → 49 | 25 → 26 | 29 → 29 |
| Git review | Yes | 3000 | 236 → 231 | 228 → 227 | 179 → 180 |

## Double-click to editable source

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 36 → 33 | 54 → 36 | 22 → 21 |
| Markdown | Yes | 0 | 15 → 20 | 17 → 19 | 14 → 13 |
| Markdown | No | 3000 | 26 → 26 | 21 → 23 | 19 → 23 |
| Markdown | Yes | 3000 | 27 → 26 | 25 → 25 | 23 → 23 |
| Git review | No | 0 | 42 → 39 | 14 → 13 | 19 → 20 |
| Git review | Yes | 0 | 47 → 45 | 26 → 26 | 23 → 23 |
| Git review | No | 3000 | 40 → 43 | 12 → 12 | 17 → 18 |
| Git review | Yes | 3000 | 41 → 41 | 38 → 36 | 20 → 20 |

Capture latency includes input polling, IPC and capture readback; it is not a monitor presentation timestamp.

## Checks

- `npm test`: 68 files, 508 tests passed.
- `npm run test:preview-contract`: focused unit tests, comparator tests, build/typecheck, and all 10 real Electron/Chromium tests passed.
- `npx playwright test test/e2e/reading-positions.spec.ts`: all 4 tests passed. Covers PDF page coordinates, zoom and rotation, app restart, search, outline, read-only saving, a 100-page PDF beyond the initial byte range, Markdown/PDF tab switching, text cursor/scroll after tab closure and restart, and Markdown source-anchor restoration.
- The PDF range assembler additionally tests requests larger than the 4 MiB IPC bound and truncated responses.
- Actual application execution was tested on Linux. Windows/macOS execution and password-protected fixtures were not exercised here.

Implementation and storage format: [reading-positions-and-pdf.md](reading-positions-and-pdf.md). Benchmark samples, environment, identities, hashes and comparisons: [pdf-preview-benchmark-2026-09-21.json](pdf-preview-benchmark-2026-09-21.json). Full per-run measurements and logs remain in `/tmp/setdown-pdf-benchmark/`.
