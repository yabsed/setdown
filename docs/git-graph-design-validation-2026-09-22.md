# Git Graph design validation — 2026-09-22

Setdown Graph was restyled to use the Source Control heading, row type scale, neutral refs, theme surfaces and subdued lanes. The collapsed panel shows only its title. The heading exposes Fetch, Pull, Push and Refresh through the existing Git service.

The baseline is the clean worktree at `d0932fc`; the candidate is the same commit with the Graph changes (diff hash `99f39a6c13a171d730e21258ec8119f481a271a14aa208b09c1133a528784a5c`). Both use the same pinned dependencies and Electron 38.8.6. The focused preview contract passed: 130 unit tests, build/typecheck, and 23 real Electron tests. The Git history Electron test also exercised light/dark presentation, collapsed controls, and fetch/pull/push/refresh against a temporary local remote.

The full preview benchmark ran 5 matched repetitions per version, 8 scenarios per run, with fresh Electron processes and five cycles per scenario. The process ran in a 3 GB systemd memory scope because the host had previously killed VS Code under memory pressure. All 48 comparison buckets passed the existing 25% and 50 ms joint threshold. Values below are medians in milliseconds across repetitions. `capture` includes the visible capture readback; `edit` is double-click to editable source. Each cell is baseline → candidate.

| Scenario | Metric | First | Second | Warm (cycles 3–5) |
| --- | --- | ---: | ---: | ---: |
| document, preparation 0 ms, edits no | capture | 71 → 61 | 30 → 24 | 24 → 25 |
| document, preparation 0 ms, edits no | edit | 35 → 49 | 47 → 56 | 22 → 22 |
| document, preparation 0 ms, edits yes | capture | 449 → 474 | 98 → 87 | 83 → 94 |
| document, preparation 0 ms, edits yes | edit | 25 → 30 | 19 → 24 | 15 → 20 |
| document, preparation 3000 ms, edits no | capture | 73 → 77 | 41 → 34 | 25 → 27 |
| document, preparation 3000 ms, edits no | edit | 30 → 31 | 24 → 25 | 22 → 24 |
| document, preparation 3000 ms, edits yes | capture | 131 → 126 | 116 → 111 | 100 → 99 |
| document, preparation 3000 ms, edits yes | edit | 30 → 30 | 28 → 26 | 27 → 24 |
| review, preparation 0 ms, edits no | capture | 1173 → 1191 | 27 → 31 | 28 → 28 |
| review, preparation 0 ms, edits no | edit | 40 → 39 | 14 → 17 | 19 → 20 |
| review, preparation 0 ms, edits yes | capture | 1287 → 1290 | 1807 → 1817 | 219 → 177 |
| review, preparation 0 ms, edits yes | edit | 45 → 42 | 23 → 19 | 20 → 14 |
| review, preparation 3000 ms, edits no | capture | 48 → 49 | 24 → 22 | 26 → 30 |
| review, preparation 3000 ms, edits no | edit | 37 → 44 | 13 → 13 | 18 → 19 |
| review, preparation 3000 ms, edits yes | capture | 236 → 237 | 217 → 224 | 178 → 178 |
| review, preparation 3000 ms, edits yes | edit | 43 → 42 | 36 → 35 | 19 → 21 |

Raw runs, exact hashes, machine and comparator output: `/tmp/setdown-graph-design-benchmark/comparison.json`. The preview benchmark is a latency guard, not a visual quality score.
