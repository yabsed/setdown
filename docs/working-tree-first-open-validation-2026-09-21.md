# First Working Tree open: validation and preview performance

The first open of a Markdown Working Tree change now binds its live document
without showing or waiting for the ordinary rendered document. The Git review
opens in the Monaco source diff; rendering remains available when explicitly
requested. Closing the last review prepares the ordinary document if it has
not yet been rendered.

The new `git-review-first-open.spec.ts` exercises a cold, unopened Markdown
change in real Electron. It records native preview show requests while opening
the review and asserts that none target the ordinary document. It then edits
the review, closes it, verifies the ordinary Viewer becomes visible, opens the
ordinary editor, and checks the shared text, Undo/Redo, save, and review reopen.
Unit tests cover skipping ordinary preview preparation, preserving existing
document state, first ordinary editor load, and inactive review restoration.

Validation on a 1440 × 1000, 24-bit isolated Xvfb display:

- Full unit suite: 71 files, 521 tests passed.
- Preview contract: 124 focused unit tests, three comparator tests, build and
  typecheck, and 22 Electron/Chromium tests passed without retries.
- Related Git review, shared history, and text workspace E2E: 8 tests passed.
- `git diff --check` passed.

The comparative run used the candidate harness and fixture for both separate
checkouts at commit `4f53403c1a170b186fe8ea85e3ea1ec35cf1e74f`.
The baseline is the unmodified commit with its own copied same-lockfile
dependency tree and Electron executable. The candidate is the working tree
with this change. Each version was built separately. Three matched repetitions
alternated baseline/candidate order on the same display; each of the eight
scenarios launched a fresh app and executed five Esc/double-click cycles.
The run finished with all scenarios present and current edited content visible.
No comparison exceeded both the 25% and 50 ms regression thresholds.

The numbers below are median milliseconds across the three matched runs.
`B → C` means baseline → candidate. First and second are separate cycles;
warm is the median of cycles 3–5 within each app, then across apps.
Capture includes polling, IPC, and native readback; it is not a monitor
presentation timestamp. Double-click measures mouse input to editable source.
Preparation means the benchmark leaves source open for 3000 ms before Esc.

| Surface | Edit | Preparation | Capture first | Capture second | Capture warm | Double-click first | Double-click second | Double-click warm |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Document | No | 0 ms | 64 → 84 | 26 → 25 | 26 → 23 | 42 → 34 | 57 → 38 | 23 → 22 |
| Document | Yes | 0 ms | 422 → 406 | 102 → 101 | 84 → 83 | 20 → 27 | 17 → 17 | 15 → 16 |
| Document | No | 3000 ms | 78 → 84 | 37 → 36 | 25 → 26 | 34 → 33 | 25 → 27 | 23 → 23 |
| Document | Yes | 3000 ms | 126 → 141 | 103 → 101 | 99 → 86 | 34 → 32 | 30 → 29 | 23 → 25 |
| Review | No | 0 ms | 1304 → 1227 | 25 → 26 | 28 → 29 | 47 → 45 | 13 → 14 | 13 → 20 |
| Review | Yes | 0 ms | 1332 → 1334 | 1797 → 1800 | 220 → 208 | 52 → 47 | 27 → 27 | 15 → 23 |
| Review | No | 3000 ms | 49 → 47 | 27 → 26 | 27 → 27 | 47 → 48 | 13 → 13 | 16 → 19 |
| Review | Yes | 3000 ms | 239 → 235 | 198 → 223 | 180 → 176 | 47 → 49 | 37 → 39 | 20 → 20 |

The comparison did not measure the initial click from Source Control to
Monaco. The first-open Electron test establishes the corrected presentation
order; the benchmark checks that protected source/reader transitions did not
regress. Three repetitions meet the contract minimum but do not establish a
high-percentile latency estimate.

Aggregate data and individual samples are in
[the compact comparison](working-tree-first-open-benchmark-2026-09-21.json).
The complete raw run, including per-scenario logs and traces, is at `/tmp/setdown-working-tree-benchmark`.
