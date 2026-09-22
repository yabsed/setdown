# Preview hydration viewport validation — 2026-09-23

The preview runtime now coalesces mutation-triggered reading-position publications while deferred Markdown blocks are being appended. DOM mutations still invalidate source-position data. The last hydration batch schedules a publication, and user scroll/resize events continue to publish during hydration. This removes repeated source-position measurements of a growing math document without changing the preview's visible hydration or latest-revision checks.

The change addresses the bottleneck identified in [the Git Graph label benchmark diagnosis](git-graph-label-validation-2026-09-23.md#follow-up-diagnosis). That diagnosis found 19 `ViewportController.publish` calls totaling 662 ms in one profiled slow edited-document run. Profiling adds overhead, so that number is not a user-facing latency estimate. The original two failed comparison buckets remain recorded there.

The preview contract passed its build/typecheck, 130 focused unit tests, and 23 real Electron tests. The full unit suite passed 529 tests. The existing browser suite covers source/reader transitions, reading-position restoration, review positioning, focus/IME, and latest-content capture. The code and test harness were unchanged throughout the following benchmark.

The comparative benchmark used a clean `8b407e4` baseline and the current working candidate, both with independently installed identical lockfile dependencies and Electron 38.8.6. The measured candidate diff hash was `cdd47b274abda422a8502f084d752153cd143bf1b25275dc0e2a305be07455b7`; it includes the pending Git Graph label edits and this runtime fix. The runner completed five matched repetitions per version, eight scenarios per run, and five Esc/double-click cycles per fresh app. **All 48 buckets passed** the unchanged joint 25% and 50 ms regression threshold. Every correctness assertion passed. The first ordinary-document capture with 0 ms preparation was 61 → 82 ms without edits and 449 → 438 ms with edits, baseline → candidate. One candidate no-edit run still waited for initial preview readiness (184 ms), so startup variability remains.

Values are medians in milliseconds, baseline → candidate. `capture` includes visible native capture readback and, with edits, waits for the appended end-of-document marker. `edit` measures double-click to editable source.

| Scenario | Metric | First | Second | Warm (cycles 3–5) |
| --- | --- | ---: | ---: | ---: |
| document, preparation 0 ms, edits no | capture | 61 → 82 | 25 → 23 | 27 → 22 |
| document, preparation 0 ms, edits no | edit | 37 → 18 | 53 → 41 | 22 → 21 |
| document, preparation 0 ms, edits yes | capture | 449 → 438 | 97 → 101 | 82 → 86 |
| document, preparation 0 ms, edits yes | edit | 23 → 21 | 13 → 23 | 12 → 15 |
| document, preparation 3000 ms, edits no | capture | 67 → 70 | 31 → 34 | 27 → 28 |
| document, preparation 3000 ms, edits no | edit | 28 → 27 | 23 → 24 | 22 → 22 |
| document, preparation 3000 ms, edits yes | capture | 123 → 117 | 117 → 118 | 98 → 102 |
| document, preparation 3000 ms, edits yes | edit | 29 → 29 | 29 → 27 | 29 → 24 |
| review, preparation 0 ms, edits no | capture | 1213 → 1201 | 26 → 25 | 30 → 27 |
| review, preparation 0 ms, edits no | edit | 42 → 44 | 13 → 13 | 18 → 20 |
| review, preparation 0 ms, edits yes | capture | 1283 → 1274 | 1794 → 1823 | 226 → 223 |
| review, preparation 0 ms, edits yes | edit | 44 → 44 | 21 → 22 | 19 → 20 |
| review, preparation 3000 ms, edits no | capture | 48 → 50 | 24 → 22 | 29 → 20 |
| review, preparation 3000 ms, edits no | edit | 39 → 41 | 13 → 13 | 18 → 17 |
| review, preparation 3000 ms, edits yes | capture | 234 → 235 | 223 → 228 | 176 → 182 |
| review, preparation 3000 ms, edits yes | edit | 42 → 44 | 36 → 39 | 15 → 19 |

Raw comparison, hashes, machine details, execution order, and per-cycle traces: `/tmp/setdown-hydration-benchmark/comparison.json`. The measured applications were run serially inside a 3 GB systemd memory scope. A separate installed baseline worktree was used and later removed.
