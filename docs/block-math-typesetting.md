# Block-math typesetting performance

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2`.
Runtime and CI verification head: `d89a561cd260ffe8dfecfdd5eb0924e609f960c9`.
PR: https://github.com/yabsed/setdown/pull/18
Verification run: https://github.com/yabsed/setdown/actions/runs/35509035990

## Result

Two actual typesetting costs are reduced, without hiding loading UI or changing
Source/Viewer presentation. This PR is independent of PR #17's later comparison
and changed-row math DOM optimizations.

1. `fast-block-math.ts` scans adjusted logical lines only through the closing
   delimiter. The old Crossnote 0.9.35 rule assembled the entire remaining source
   for every block. Render tokens, source maps, container indentation, escapes
   and configured delimiter order are preserved. Unknown package versions,
   unsupported delimiter forms and absent upstream rules keep the original path.
2. `DeferredMath` covers both `math` and `math_block`, before source-anchor wrappers
   are installed. Valid untrusted-mode KaTeX output uses render-scoped opaque
   placeholders through generic HTML processing, then restores the output.
   Error output, raw HTML math and HTML-enabled math retain the normal sanitizer
   path. Random per-render markers cannot resolve authored numeric/stale slots.
3. The first real integration run caught a block-output serialization difference
   (NBSP versus `&nbsp;`). Production restoration was corrected in `ae9de4f`;
   output-equality assertions were not weakened.

No KaTeX engine replacement, dependency upgrade, MathML removal, position/scroll
controller change, loading-text suppression, scheduler adjustment or native-view
change is included. Existing latest-only promotion and first-edit line-1 fixes
are unchanged.

## Actual Crossnote warm typesetting benchmark

Executed on GitHub Actions Ubuntu 24.04.5, Node 22.23.2, AMD EPYC 7763, using
installed Crossnote 0.9.35 and the repository dependency lockfile. Not a mock.

Synthetic documents contain 64 or 256 block matrices/fractions, four repeated
formula variants, and paragraphs. Each iteration changes ordinary text while
KaTeX caches are warm. Baseline retains the application's prior inline-only
math deferral and original block parser; optimized uses both new helpers.

Measured interval: `generateHTMLTemplateForPreview` through body decoding and
math restoration. Nine alternating-order pairs per document size; discard two
warmup pairs and report the median of seven timed samples. Every pair also
checks exact final HTML equality, and encoded full-page restoration is checked.

| Block formulas | Baseline median | Optimized median | Time reduction |
| --- | ---: | ---: | ---: |
| 64 | 66.096707 ms | 6.221975 ms | 90.6% |
| 256 | 282.625393 ms | 12.489004 ms | 95.6% |

Raw samples: `docs/benchmarks/block-math-crossnote-2026-09-20.json`.
The hosted artifact is also linked from the verification run.

This measures real warm Crossnote typesetting/template work on a synthetic
corpus, NOT the complete Setdown worker envelope, IPC, review diff, DOM/layout,
Electron composition or user-visible edit-to-Esc latency. It does not establish
these absolute times on a Fedora laptop, cold first rendering, new uncached
formulas, or arbitrary documents. No end-to-end zero-latency claim is made.

## Independent parser-only check

A separate local Node 22.16.0 isolated line-state benchmark measured 500 blocks
at median 19.50 -> 0.33 ms and 1,000 at 155.66 -> 0.64 ms. This is NOT added to the
Crossnote improvement above. Instrumented source-end reads for 500 blocks fell
from 502,500 to 2,000; timing samples disable that instrumentation. The reference
fixture retains the adapted upstream rule with its NCSA license.

## Verification actually completed

- Full project `npm run typecheck`: PASS; TypeScript and Svelte, zero Svelte errors
  and warnings.
- Real Vitest focused checks: 16/16 PASS (7 parser, 7 deferral, 2 actual Crossnote
  integration tests). Parser tests include 2,500 seeded cases in normal/silent
  modes, quoted/list-adjusted source, CRLF, missing/escaped/custom delimiters,
  disabled math, source ranges and version/fallback behavior.
- Full `npm run build`: PASS, including Vite and Electron bundles. Vite reports
  its existing large-chunk warning; this is not a warning-free build claim.
- Full Vitest: 475 passed, 13 failed, 488 total; 61 passing files and one failing
  file. No failed suites are filtered out or relabeled successful.
- All 13 failures are in the unchanged
  `src/renderer/project/source-control/source-control-controller.test.ts`.
  A second checkout of the unmodified base `222f58a` in the same CI job reproduces
  the same 13 failures (5 passing tests in that file). They predate this math
  change. The fixture/expectations still assume the older preview readiness and
  show-before-position contract. These failures are recorded, not silently fixed
  by changing unrelated production behavior or suppressing the suite.
- Local syntax transpilation and `git diff --check` passed. Real CI typecheck and
  tests above supersede reliance on the local isolated harness.

The CI job is therefore NOT green overall, despite math tests, build and the
benchmark passing. Keep this PR as a draft until baseline test expectations and
native acceptance are resolved. Native Fedora/Electron UI, IME, zoom, scrolling
and first-edit Esc were not executed in this task.

## Reproduce

From a full repository checkout with development dependencies installed:

```sh
npm run typecheck
npm test --workspace @setdown/desktop -- src/main/preview/fast-block-math.test.ts src/main/preview/deferred-math.test.ts src/main/preview/block-math-integration.test.ts
npm run build
node apps/desktop/scripts/benchmark-block-math.cjs
node apps/desktop/scripts/benchmark-block-math.cjs --isolated
```

The added read-only Actions workflow runs real dependency installation,
TypeScript/Svelte checks, focused and full tests, build and the benchmark. It
preserves a failed full-suite status while collecting build/benchmark evidence
and reproducing the known controller suite on the pinned baseline.

## Native acceptance still required

Use a long real Working Tree with block matrices. Warm it, edit ordinary text
near line 200, immediately press Esc, and then edit one formula. Record latest
content and correct source position, not just the time the loading label closes.
Repeat left/right navigation, Undo, IME input and resize/zoom. Do not interpret
hidden layout acknowledgment as proof of the first displayed pixel.

Checkpoints were published throughout the task. No automatic merge, force-push
or rewriting of checkpoint history was performed.
