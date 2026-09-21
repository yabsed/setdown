# Zoom scope validation — 2026-09-21

Baseline: `2b04234aba3b4714921e42005de3b7c109350b7a`, installed separately at
`/tmp/setdown-zoom-base`. Candidate: the working tree on that commit.

## Behavior

- App zoom is shared across windows and persisted in `zoom-settings.json`.
  Ctrl+plus/minus, Ctrl+0 and the View menu use the same coordinator.
- Ctrl+wheel in ordinary/Git editors and Markdown readers changes common text
  zoom. Monaco scales font size/line height; native Markdown views use app ×
  text zoom. The shell and native DIP bounds use app zoom alone. Reset Text Size
  is separate from Reset App Zoom.
- PDF/image wheel zoom updates only that file's existing reading record.
  PDF.js receives container-relative origins; the image viewer preserves the
  image coordinate under the pointer by adjusting scroll after synchronous
  geometry installation. Scroll boundaries still clamp normally.
- Both media toolbars offer 100% and Fit width. PDF starts at fit width; fit
  modes respond to app/viewport resize. Image fit width is also durable.
- Warm PDF/image surface retention and PNG/JPEG/WebP/GIF/AVIF/SVG support remain
  covered by the existing media tests.

## Findings during validation

The initial unit run identified direct preload-global access outside the
desktop adapter. Text preferences now enter through the typed desktop port at
the renderer composition root.

Real input checks identified Chromium keyboard input that bypasses Electron's
`before-input-event`. Trusted preload key handling covers that path; native
input is prevented before reaching the page, avoiding a second application.

Git diff option updates regenerate Monaco's child accessibility labels.
Updating text zoom now preserves each side's current label and undo stack.

The multi-window test also exposed the New Window menu forwarding Electron's
click arguments into the window factory's optional position/document arguments.
The menu now calls the factory without those event arguments.

The first contract run failed its existing Markdown reading-position test:
the initial 180ms layout settlement overwrote a subsequent scroll. A separate
trace observed scrollY changing from 5000.25 back to 0 at the pending settlement.
Settlement now owns only its last installed offset; subsequent scroll or a new
position command supersedes it. Focused unit coverage was added without
changing the existing reading-position assertion or introducing retries.

## Checks

- Full unit suite: **71 files, 517 tests passed**.
- Final `npm run test:preview-contract`: **passed** — 17 focused unit files,
  111 tests; 3 comparator tests; production build/typecheck with no Svelte
  errors/warnings; **21 Electron/Chromium tests passed** (53.9s).
- All four zoom scenarios pass: Markdown, plain text, PDF/image cursor anchors
  and fit resizing, and Git undo/accessibility plus multi-window inheritance.
- `git diff --check`: passed.

One intermediate contract run observed an unexpected composition end in the
existing Korean IME test (expected end count 1, observed 2). That run failed and
was not counted as a pass. The isolated baseline IME comparison passed, and the
final full candidate contract passed, including IME. The cause of that single
failure remains undetermined; this does not establish that an intermittent IME
issue is fixed. No IME assertions, timeouts, retries or application behavior
were changed to obtain the final result. The final gate used the final image
toolbar wrapping change, which was also included in the benchmark build.

Logs: `/tmp/setdown-zoom-unit.log`,
`/tmp/setdown-zoom-contract-latest.log`, and
`/tmp/setdown-zoom-baseline-ime.log`. The intermediate IME failure is retained
in `/tmp/setdown-zoom-contract-complete.log`.


## Comparative latency

`DISPLAY=:97 npm run bench:preview -- --baseline /tmp/setdown-zoom-base --runs 5
--output /tmp/setdown-zoom-bench-20260921` passed: **0 regressions across 48 buckets**.
The runner alternated AB/BA on the same isolated Xvfb display, using independent
installed Electron executables. All 80 scenarios completed with latest-content
capture checks. No retries, tolerance changes or skipped scenarios.

Values below are median milliseconds, **baseline → candidate**. First and second
cycles are separate; warm is the median of cycles 3–5 per process, then across
five processes. Capture includes input, polling, IPC and native readback, not a
monitor presentation timestamp. These measure source/reader transitions, not
cold PDF load time.

### Escape → current preview capture

| Content | Edits | Preparation | First | Second | Warm |
| --- | --- | --- | --- | --- | --- |
| Markdown | No | 0 ms | 54 → 67 | 26 → 22 | 27 → 27 |
| Markdown | No | 3000 ms | 63 → 63 | 36 → 32 | 32 → 27 |
| Markdown | Yes | 0 ms | 403 → 393 | 88 → 100 | 87 → 85 |
| Markdown | Yes | 3000 ms | 134 → 117 | 107 → 110 | 98 → 99 |
| Git review | No | 0 ms | 1212 → 1202 | 28 → 30 | 28 → 29 |
| Git review | No | 3000 ms | 47 → 49 | 27 → 26 | 28 → 28 |
| Git review | Yes | 0 ms | 1296 → 1292 | 1824 → 1810 | 182 → 218 |
| Git review | Yes | 3000 ms | 236 → 237 | 226 → 230 | 180 → 180 |

### Double-click → editable source

| Content | Edits | Preparation | First | Second | Warm |
| --- | --- | --- | --- | --- | --- |
| Markdown | No | 0 ms | 37 → 35 | 56 → 50 | 22 → 23 |
| Markdown | No | 3000 ms | 29 → 29 | 25 → 24 | 24 → 23 |
| Markdown | Yes | 0 ms | 23 → 18 | 14 → 21 | 13 → 17 |
| Markdown | Yes | 3000 ms | 30 → 29 | 27 → 30 | 25 → 26 |
| Git review | No | 0 ms | 42 → 41 | 14 → 14 | 20 → 20 |
| Git review | No | 3000 ms | 44 → 44 | 14 → 13 | 20 → 19 |
| Git review | Yes | 0 ms | 45 → 44 | 22 → 25 | 22 → 21 |
| Git review | Yes | 3000 ms | 43 → 43 | 37 → 38 | 14 → 16 |

Raw samples, build/harness hashes, machine metadata and all comparisons:
`/tmp/setdown-zoom-bench-20260921/comparison.json`.
