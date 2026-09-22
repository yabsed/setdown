# Git Graph branch label validation — 2026-09-23

The Graph row now gives branch labels space before shortening the commit subject. A branch label shortens only when labels alone exceed the available row width. The Auto badge filter also updates after an external branch switch. The pinned upstream graph remains responsible for history, lanes, and virtualization.

Baseline: clean `8b407e4`; measured candidate: that commit with the branch label change, before adding this report (diff hash `c9263c91ef87bea53b32564a615721259135fffc2ec74201d0726f5feec81718`). Both used the same installed dependencies and Electron 38.8.6. The Git history Electron test verified the full `topic/room-for-branch-labels` badge stays visible while its long commit subject is clipped, and captured `graph-long-branch.png`. The full unit suite passed 529 tests. The preview contract passed its build/typecheck, 130 focused unit tests, and 23 Electron tests.

The comparative preview benchmark completed five matched repetitions per version, eight scenarios per run, and five cycles per scenario. **It failed 2 of 48 comparison buckets** under the existing joint 25% and 50 ms threshold. Both failures were the first ordinary-document capture with 0 ms preparation: no edits, 67 → 125 ms; appended edits, 448 → 664 ms. All other buckets passed. The ordinary-document harness opens a Markdown file and never selects Source Control; the Graph pane is mounted only when Source Control is active. This makes a direct Graph rendering cause unlikely, but it does not invalidate the measured regression or establish its cause. The no-edit candidate's first-capture samples were 207, 125, 69, 63, and 232 ms; the corresponding baseline samples were 59, 97, 67, 61, and 86 ms. The edit case also varied between runs. No threshold, fixture, or test was altered to change the result.

Values below are medians in milliseconds, baseline → candidate. `capture` includes visible native capture readback; `edit` measures double-click to editable source. A warning marks a failed bucket.

| Scenario | Metric | First | Second | Warm (cycles 3–5) |
| --- | --- | ---: | ---: | ---: |
| document, preparation 0 ms, edits no | capture | 67 → 125 ⚠️ | 25 → 26 | 29 → 28 |
| document, preparation 0 ms, edits no | edit | 37 → 19 | 54 → 52 | 23 → 23 |
| document, preparation 0 ms, edits yes | capture | 448 → 664 ⚠️ | 97 → 97 | 86 → 98 |
| document, preparation 0 ms, edits yes | edit | 21 → 31 | 14 → 23 | 15 → 21 |
| document, preparation 3000 ms, edits no | capture | 68 → 70 | 28 → 39 | 25 → 26 |
| document, preparation 3000 ms, edits no | edit | 29 → 28 | 26 → 23 | 23 → 23 |
| document, preparation 3000 ms, edits yes | capture | 135 → 133 | 116 → 116 | 97 → 99 |
| document, preparation 3000 ms, edits yes | edit | 30 → 29 | 29 → 26 | 25 → 24 |
| review, preparation 0 ms, edits no | capture | 1196 → 1168 | 23 → 27 | 30 → 28 |
| review, preparation 0 ms, edits no | edit | 39 → 40 | 14 → 13 | 19 → 20 |
| review, preparation 0 ms, edits yes | capture | 1280 → 1293 | 1793 → 1819 | 206 → 222 |
| review, preparation 0 ms, edits yes | edit | 45 → 43 | 23 → 25 | 24 → 22 |
| review, preparation 3000 ms, edits no | capture | 51 → 49 | 20 → 22 | 29 → 30 |
| review, preparation 3000 ms, edits no | edit | 42 → 38 | 13 → 13 | 18 → 18 |
| review, preparation 3000 ms, edits yes | capture | 235 → 237 | 228 → 226 | 180 → 179 |
| review, preparation 3000 ms, edits yes | edit | 41 → 42 | 35 → 39 | 20 → 20 |

Raw runs, exact hashes, machine information, and comparator output: `/tmp/setdown-graph-label-benchmark/comparison.json`. The benchmark ran in a 3 GB systemd memory scope to limit host memory pressure.

## Follow-up diagnosis

The failure is associated with variable initial document readiness and existing
preview hydration/position work, rather than evidence of extra Graph work.
The slow edited-document path already occurred in the original baseline. Its
frequency changed from 1/5 baseline runs to 3/5 candidate runs, moving the median
between two timing groups. This is real startup work, not grounds to discard the
original failed comparison.

- **No edits:** the candidate's 207 and 232 ms samples waited 148 and 168 ms,
  respectively, before the first non-null `preview:show` request was recorded.
  Capture followed 59 and 64 ms later. `marktex:prepare-document` only arrived at
  +144 and +165 ms. The benchmark waits for the shell's `.viewer-surface`, then
  enters the editor; it does not wait for native document readiness before the
  first cycle. Thus the measured interval can include unfinished initial load.
- **Edits:** the candidate's 711/749/664 ms samples acknowledged HTML updates at
  106/103/114 ms. The original baseline's 756 ms sample had the same signature:
  acknowledgement at 109 ms. The extra 550–647 ms was after that acknowledgement.
  `ContentController.patch` can accept a patch into deferred blocks and acknowledge
  it before those blocks enter the DOM. The measurement explicitly waits for a
  marker appended at the end of the document before capturing, so it includes
  remaining offscreen hydration; it is not a timestamp for the first visible frame.
- **Chromium profile:** one separate slow edited run took 1199 ms, with 19
  `ViewportController.publish` calls totaling 662.1 ms before capture. Hydration
  mutates the DOM, the runtime observer invalidates source positions and schedules
  publication, and `SourceAtlas.viewportAnchorAt` can measure many descendants or
  use the full-source fallback. This competes with the remaining hydration.
  The trace contained 113,366 `Document::UpdateStyleAndLayout` events in that
  interval; these are calls, not 113,366 full layout passes. Tracing itself adds
  overhead, so 1199/662.1 ms are profiling evidence, not gate measurements.

The application artifacts were unchanged for the follow-up. Both the original
baseline and candidate have the same entire `dist-electron` hash, including the
preview runtime: `365fa47604df015fda4f36b6badde95081336274f6331a9f21cce142645ea02d`.
The current renderer still matches the measured candidate's hash. A temporary
diagnostic also asserted that no `web-git-graph` element was mounted in the
ordinary-document scenarios.

Ten fresh launches per scenario of the **same candidate build**, using the
unchanged non-tracing harness at 0 ms preparation, produced these medians (ms):

| Scenario | Metric | First | Second | Warm |
| --- | --- | ---: | ---: | ---: |
| document, no edits | capture | 69 | 25 | 23 |
| document, no edits | double-click to editor | 38.5 | 42.5 | 22.5 |
| document, edits | capture | 427.5 | 92 | 84 |
| document, edits | double-click to editor | 16 | 15.5 | 15 |

First-capture samples were 62, 99, 97, 92, 36, 60, 139, 72, 66, 51 ms without
edits, and 462, 454, 398, 400, 447, 411, 433, 439, 400, 422 ms with edits. This
does not reproduce a persistent candidate slowdown. It is a targeted diagnostic,
not a replacement for the original eight-scenario comparison. A further input
timing experiment (0/20/100 ms before Esc, three runs each) stayed within
377–461 ms; it did not establish smooth scrolling alone as the trigger.

The original run did not record enough startup/runtime or system-pressure detail
to assign the changed slow-path frequency to a specific scheduler, cache, or
memory event. The evidence identifies the delayed stages and a real shared
runtime bottleneck; it does not prove a particular OS cause. Improving ordinary
reading-position lookup during hydration was the next performance target. Changing
the benchmark to wait for complete hydration would hide the cold path.

The subsequent mutation-publication fix and its independent full comparison are
recorded in [the hydration viewport validation](preview-hydration-viewport-validation-2026-09-23.md).

No application code, original benchmark harness, or pass threshold was changed during this
diagnosis. Temporary diagnostic tests were removed from the repository. Evidence:
`/tmp/setdown-label-diagnosis-identical` (20 unchanged-harness runs),
`/tmp/setdown-label-diagnosis-trace` (separate Chromium profiles),
`/tmp/setdown-label-diagnosis-commands` (10 command-recording runs),
`/tmp/setdown-label-diagnosis-command-trace` (one command-recording profile), and
`/tmp/setdown-label-diagnosis-input-phase` (nine input-timing runs). All correctness
assertions passed; Electron runs were serial and limited to 3 GB.
