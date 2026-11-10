# Matched preview benchmark — 2026-11-10

**PASS: 80 launches, 48 comparisons, no regressions.** Five matched repetitions used the same isolated Xvfb display and unchanged candidate-owned measurement harness. Baseline and candidate alternate AB/BA order.

Baseline commit: `6631359dad549ef89affaf80c1e101c6a6c3c5a9`, independent checkout `/tmp/setdown-language-baseline` with its own installed dependencies. Both builds used `SETDOWN_BUILD_SOURCEMAP=0`; the already-current builds were checked with `--skip-build`. All build/harness hashes and per-run samples are in [comparison.json](preview-benchmark/comparison.json).

The unchanged gate fails only when an increase exceeds both **25% and 50 ms**. First and second are medians across five fresh apps; warm is the median of each app’s cycles 3–5, then across apps. Values below are **baseline → candidate, milliseconds**. Capture includes IPC, correctness polling and native capture readback; it is not a monitor presentation timestamp.

Both versions ran sequentially within the same memory scope (`MemoryHigh=3G`, `MemoryMax=4G`, `MemorySwapMax=256M`). [Scope observation](benchmark-memory-scope.txt).

## Esc → current preview capture

| Document | Source preparation | Edited | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| Markdown | 0 ms | No | 89 → 58 | 34 → 28 | 21 → 25 |
| Markdown | 0 ms | Yes | 362 → 317 | 96 → 95 | 91 → 90 |
| Markdown | 3000 ms | No | 29 → 45 | 24 → 21 | 21 → 21 |
| Markdown | 3000 ms | Yes | 116 → 123 | 98 → 99 | 90 → 93 |
| Git review | 0 ms | No | 1007 → 717 | 21 → 19 | 18 → 19 |
| Git review | 0 ms | Yes | 1026 → 783 | 1545 → 1497 | 174 → 180 |
| Git review | 3000 ms | No | 27 → 27 | 23 → 23 | 20 → 21 |
| Git review | 3000 ms | Yes | 230 → 234 | 194 → 196 | 170 → 173 |

## Double-click → editable source

| Document | Source preparation | Edited | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| Markdown | 0 ms | No | 20 → 31 | 17 → 16 | 13 → 14 |
| Markdown | 0 ms | Yes | 21 → 17 | 14 → 16 | 14 → 14 |
| Markdown | 3000 ms | No | 18 → 18 | 15 → 15 | 13 → 13 |
| Markdown | 3000 ms | Yes | 17 → 20 | 15 → 16 | 13 → 14 |
| Git review | 0 ms | No | 20 → 23 | 11 → 11 | 12 → 11 |
| Git review | 0 ms | Yes | 19 → 21 | 16 → 18 | 15 → 15 |
| Git review | 3000 ms | No | 20 → 21 | 11 → 11 | 15 → 15 |
| Git review | 3000 ms | Yes | 19 → 20 | 15 → 15 | 14 → 15 |
