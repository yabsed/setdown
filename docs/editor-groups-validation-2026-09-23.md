# Editor groups validation — 2026-09-23

Tab wheel scrolling and document editor groups are implemented. The VS Code source investigation, interaction rules, resource ownership and current scope are described in [the design record](editor-groups-design.md).

## Verification

- Full unit suite: **537 passed**.
- `npm run test:preview-contract`: **138 focused unit tests**, 3 benchmark-comparator tests, build/typecheck (0 errors/warnings), and **25 Electron tests passed**.
- Additional window-detach suite: **2 Electron tests passed** on the final build.
- The new editor-group Electron test also passes standalone TypeScript checking.
- Comparative preview benchmark: **48/48 buckets passed**, with **0 regressions** under the unchanged joint 25% and 50 ms thresholds.

The group test checks wheel scrolling without changing selection, two simultaneous native Markdown readers and their actual content, a nested image pane with matching bounds, pointer resizing, two live Monaco editors, direct clicks into a background editor, Undo after changing groups, and empty-group collapse. The review test checks native preview restoration after a canceled tab drag. Existing image/terminal stability, reading-position, typography, zoom, IME and native-view identity tests remain in the contract.

An earlier supplemental detach run failed its OS window-focus assertion; independent diagnosis showed the expected focused target window, and the final complete detach suite passed. The image restart test had a separate setup race: it read the rotation’s old center before the scroll event persisted the subsequent pan. It now waits for the exact observed pan coordinates before closing; the restart assertion was not relaxed. The final tests use no retries or skips.

## Performance comparison

Baseline: clean `d8bcf2de6347bf79f5b2096dad89d5ff0d978e1e`. Candidate: the same commit plus this implementation, measured before adding this report; diff hash `00289db9231d5153ddf1bba9631e16d58ea9cdcc5de59f4e77d7cc0dd243c47a`.

Both builds use the same lockfile and Electron 38.8.6. The baseline has a separate installed dependency tree at `test-results/setdown-tabs-baseline`. Both builds were completed before measurement. The working tree also contained pre-existing generated code-growth assets; this task did not modify them.

Five matched repetitions per version, eight scenarios per repetition, five cycles per scenario: **80 fresh Electron launches / 400 measured cycles**. AB/BA order alternates. All scenarios and latest-content checks completed. A systemd scope limited the measurement processes to 3 GB memory and 512 MB swap. An earlier measurement was stopped to fix canceled-review-drag restoration; its incomplete output is not part of this result.

Values below are medians in milliseconds, **baseline → candidate**. Warm is the per-run median of cycles 3–5, then the median across runs. Capture measures Escape through latest-content native capture readback; it is not a monitor presentation timestamp. Source measures double-click through editable source. Preparation 0/3000 ms is the configured time before Escape, excluded from the capture interval.

| Scenario | Metric | First | Second | Warm (3–5) |
| --- | --- | ---: | ---: | ---: |
| document, preparation 0 ms, edits no | capture | 75 → 69 | 18 → 19 | 21 → 20 |
| document, preparation 0 ms, edits no | source | 29 → 29 | 38 → 42 | 22 → 22 |
| document, preparation 0 ms, edits yes | capture | 437 → 452 | 97 → 101 | 84 → 86 |
| document, preparation 0 ms, edits yes | source | 17 → 15 | 17 → 12 | 14 → 15 |
| document, preparation 3000 ms, edits no | capture | 67 → 63 | 39 → 33 | 31 → 26 |
| document, preparation 3000 ms, edits no | source | 27 → 27 | 27 → 24 | 23 → 21 |
| document, preparation 3000 ms, edits yes | capture | 135 → 131 | 117 → 113 | 100 → 96 |
| document, preparation 3000 ms, edits yes | source | 28 → 30 | 29 → 24 | 24 → 21 |
| review, preparation 0 ms, edits no | capture | 1162 → 1183 | 32 → 29 | 30 → 29 |
| review, preparation 0 ms, edits no | source | 41 → 43 | 15 → 14 | 20 → 18 |
| review, preparation 0 ms, edits yes | capture | 1295 → 1287 | 1810 → 1793 | 180 → 224 |
| review, preparation 0 ms, edits yes | source | 46 → 45 | 22 → 25 | 22 → 22 |
| review, preparation 3000 ms, edits no | capture | 48 → 51 | 21 → 24 | 29 → 28 |
| review, preparation 3000 ms, edits no | source | 42 → 40 | 13 → 13 | 18 → 19 |
| review, preparation 3000 ms, edits yes | capture | 237 → 241 | 225 → 227 | 177 → 180 |
| review, preparation 3000 ms, edits yes | source | 42 → 41 | 36 → 35 | 20 → 20 |

For reference, adding the configured preparation wait to capture gives the values below. These are arithmetic wait + capture totals, not a separately measured full editing cycle; at 0 ms they equal the capture rows above.

| Scenario (3000 ms preparation included) | First | Second | Warm (3–5) |
| --- | ---: | ---: | ---: |
| document, edits no | 3067 → 3063 | 3039 → 3033 | 3031 → 3026 |
| document, edits yes | 3135 → 3131 | 3117 → 3113 | 3100 → 3096 |
| review, edits no | 3048 → 3051 | 3021 → 3024 | 3029 → 3028 |
| review, edits yes | 3237 → 3241 | 3225 → 3227 | 3177 → 3180 |

Command:

```sh
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=512M \
  npm run bench:preview -- \
  --baseline /home/yabsed/Documents/fall26/work/better-markdown-viewer/test-results/setdown-tabs-baseline \
  --skip-build --output /tmp/setdown-editor-groups-benchmark-final
```

Raw runs, build identities, sample arrays, machine information and comparator output: `/tmp/setdown-editor-groups-benchmark-final/comparison.json`.

Final logs: `/tmp/setdown-groups-unit-release.log`, `/tmp/setdown-groups-contract-release.log`, `/tmp/setdown-groups-detach-final.log`. The group test captures `editor-groups-source.png` in its temporary Playwright output when it runs.
