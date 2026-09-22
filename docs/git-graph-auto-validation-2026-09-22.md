# Git Graph Auto and row placement validation — 2026-09-22

The candidate adds an Auto filter for the checked-out branch and its upstream, hides unrelated commit badges in Auto, keeps Show All/manual selection, and places commit text after the lanes crossing each row. It uses the pinned upstream layout function and leaves vendor modules unchanged.

Baseline: clean `4a7deed`; candidate: the same commit with the current Git Graph changes (diff hash `465181298454ad18f8759be03b7b8873ed318ef6da829ed65aeac5263d73e231`). Dependencies and Electron version are identical. The preview contract passed its build/typecheck, 130 focused unit tests and 23 real Electron tests. The full unit suite passed 529 tests. The Git history Electron test used multiple refs and a real merge in a temporary repository; it checked Auto, Show All, live badge visibility, row insets, review behavior and remote operations.

The comparative preview benchmark ran 5 matched repetitions per version, 8 scenarios per run, and five cycles per scenario. It ran in a 3 GB systemd memory scope after earlier host memory pressure. All 48 comparison buckets passed the existing joint 25% and 50 ms threshold. Values are medians in milliseconds; each cell is baseline → candidate. `capture` includes visible capture readback; `edit` measures double-click to editable source.

| Scenario | Metric | First | Second | Warm (cycles 3–5) |
| --- | --- | ---: | ---: | ---: |
| document, preparation 0 ms, edits no | capture | 62 → 66 | 24 → 25 | 25 → 26 |
| document, preparation 0 ms, edits no | edit | 19 → 32 | 38 → 37 | 22 → 22 |
| document, preparation 0 ms, edits yes | capture | 462 → 414 | 99 → 91 | 81 → 86 |
| document, preparation 0 ms, edits yes | edit | 22 → 19 | 13 → 12 | 14 → 14 |
| document, preparation 3000 ms, edits no | capture | 71 → 70 | 30 → 37 | 26 → 26 |
| document, preparation 3000 ms, edits no | edit | 28 → 29 | 24 → 24 | 22 → 23 |
| document, preparation 3000 ms, edits yes | capture | 113 → 121 | 101 → 111 | 99 → 99 |
| document, preparation 3000 ms, edits yes | edit | 28 → 28 | 28 → 28 | 21 → 23 |
| review, preparation 0 ms, edits no | capture | 1185 → 1215 | 26 → 30 | 29 → 28 |
| review, preparation 0 ms, edits no | edit | 40 → 43 | 13 → 14 | 18 → 20 |
| review, preparation 0 ms, edits yes | capture | 1314 → 1277 | 1758 → 1760 | 223 → 226 |
| review, preparation 0 ms, edits yes | edit | 47 → 42 | 26 → 23 | 23 → 20 |
| review, preparation 3000 ms, edits no | capture | 48 → 49 | 23 → 19 | 21 → 30 |
| review, preparation 3000 ms, edits no | edit | 41 → 42 | 13 → 13 | 17 → 18 |
| review, preparation 3000 ms, edits yes | capture | 235 → 239 | 226 → 224 | 177 → 183 |
| review, preparation 3000 ms, edits yes | edit | 43 → 41 | 38 → 37 | 21 → 20 |

Raw runs, exact hashes, machine information and comparator output: `/tmp/setdown-graph-auto-benchmark/comparison.json`. The benchmark is a latency guard; visual behavior is checked by the Git history Electron test.
