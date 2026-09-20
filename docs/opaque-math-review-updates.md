# Unchanged-math review latency

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2` (PR #16 merged).
Branch: `perf/opaque-math-review-updates`; PR #17.

## Contract

A small prose edit beside unchanged math must not needlessly reconstruct that math. Preserve KaTeX HTML/MathML, sanitization, before/after semantics, source positions, shared undo, IME isolation and latest-only presentation. Do not hide a loading message and call that a speedup. Literal zero end-to-end latency has NOT been demonstrated.

Work was published as bounded checkpoints. No automatic merge, force push, or history rewrite.

## Implemented

### Opaque math throughout comparison

`ReviewMathCodec` identifies complete, balanced KaTeX spans by their **exact rendered output**, not LaTeX strings or a lossy hash. Macro/option changes that change output therefore cannot become false hits. IDs never recycle after eviction. The bounded codec retains at most 1,024 outputs / an estimated 8 MiB of UTF-16 string data (not measured heap).

The comparison worker now keeps math opaque through alignment, word highlighting, review-row extraction and row matching. A text projection preserves the old alignment algorithm's token sequence while remaining excluded from inline emphasis. Only changed rows are expanded to ordinary sanitized HTML before IPC. Initial pages and full resets still expand the complete document. Original runtime requirements are checked before packing.

A bounded exact-prefix lookup skips rescanning a previously validated math subtree when its bytes still match. Ambiguous/common prefixes fall back to scanning. Authored reserved markers, malformed/raw-text input and unrecognized cases use the old path. Source metadata inside math is never concealed from row-delta verification.

### Preserve DOM inside changed rows

`prepareReviewMathRow` parses a detached row shell without recreating matching math. It retains a distinct existing node for each occurrence and side. No math is stolen from another pane or a retained row. Both unified and split trees are validated before any live node moves. Exact serialization mismatches, genuinely new math and large restructures use normal parsing.

The row patcher now preserves the unchanged KaTeX/MathML subtree inside an otherwise changed row, including the first equal-to-changed edit. This is not a guarantee that browser layout or painting costs zero; parent changes may still require layout.

### Unchanged boundaries

No changes to the math engine, sanitizer, whole-document render worker, source/Viewer controller, native view ownership/visibility, timing of Escape, or cold-position correction. The latest-only presentation checks from PR #16 remain. The Typesetting changes message is not suppressed. No screenshots or stale revision are substituted for the current document.

## Verification actually performed

- 23 persisted TypeScript test bodies passed with Node 22.16.0 / TypeScript 5.8.3 in an isolated test-body harness, **not Vitest**. Real core/comparison/cache functions were used.
- 11 checks passed in **actual Headless Chromium 144**, driven by Python Playwright using the same persisted browser-check function. Checks cover DOM and MathML identity, first edit, duplicate formulas, before/after isolation, source line shifts, malformed patch rejection and serialization fallback.
- Swapping in the exact original row patcher makes four DOM-preservation checks fail; the modified row patcher passes them. This is browser DOM verification, not Electron/Fedora/native-frame verification.
- 900 seeded pipeline cases matched the original expanded comparison HTML byte-for-byte and the original row-cache patch/full-update output. Cases include prose/math changes, insertion, deletion, line shifts and block-kind changes.
- Targeted strict TypeScript compilation passed for the codec/cache/browser-patcher dependency graph. Nine changed/added TS files passed syntax transpilation. Local changed-file architecture boundary checks passed; the integration test is placed under main, not core.
- The benchmark verifies the baseline row-cache file's Git blob SHA before executing it. The original block splitter, alignment, row-patch and exact-pair-cache dependency hashes were also checked locally.

## Reproducible CPU experiment

From a complete checkout with project dev dependencies:

```sh
node apps/desktop/scripts/benchmark-review-math.cjs
cd apps/desktop
npm test -- review-math-codec.test.ts review-math-pipeline.test.ts
npx playwright test test/e2e/review-math-dom.spec.ts
```

The benchmark's fixtures are **synthetic KaTeX-shaped HTML containing MathML**, not actual KaTeX engine output. Eight alternating-order batches, each measuring nine warm updates, use 80 blocks and seven distinct synthetic formulas with 160 repeated nested units. The reported median is the median of batch mean milliseconds per update, not a p95/p99 interaction measurement.

| Measured quantity | Before | After |
| --- | ---: | ---: |
| Comparison + row-update CPU, batch-mean median | 46.38 ms | 12.75 ms |
| Internal full review representation for this fixture | 2,158,459 bytes | 139,843 bytes |

Raw batch values are in `docs/benchmarks/opaque-review-math-2026-09-20.json`. The reduced byte count is the **worker's internal representation**, not the initial renderer IPC payload or browser's final DOM. These are not Esc latency numbers.

## Remaining work / merge gate

The full Crossnote parse/typesetting and first full-HTML IPC still occur. This is not a fully incremental Markdown pipeline, viewport geometry index, unified/split DOM consolidation, same-view presentation redesign, or GPU frame cache. The DOM reuse path still reads candidate serialization and may fall back for equivalent-but-not-byte-identical markup.

Full project Vitest, Svelte/TypeScript checks, Electron build and actual Fedora execution were not possible with the missing checkout/dependencies and container DNS restrictions. The browser is available in this run; the full Electron app is not. Before merge, run the normal full test/build commands and measure last input -> latest correct native frame on the user's math documents. Include first edit around line 200, no-edit Escape, equation edits, resize/zoom, IME, undo, quick toggles, overlays, malformed input and memory/CPU while typing.

Do not interpret the synthetic speedup or absence of math-node recreation as proof of zero latency or elimination of the loading state in the actual application.
