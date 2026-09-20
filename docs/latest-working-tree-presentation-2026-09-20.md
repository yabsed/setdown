# Latest Working Tree presentation

Base: `1e35a904c849dac8f70cef9dcc9c3c722f219d6d` (PR #15 merged).
Branch: `perf/latest-working-tree-presentation`. Draft PR: #16.

## Contract

The performance target is Escape to the latest edited buffer at the correct
reading position, not Escape to any old preview. Keep the no-edit warm path
fast. Never publish intermediate render results as if they were current. Bind
presentation to content/baseline and the final viewport intent; late results
must not reopen a closed tab or override a new Source/Viewer intent.

Preserve KaTeX HTML/MathML, shared Monaco undo, IME isolation, before/after source
mapping, ownership checks, patch-base validation and the full-render fallback.
Do not replace the math engine, discard accessibility, add a fixed frame delay,
or pretend that an IPC acknowledgment proves native pixel presentation.

## Implemented

### Latest content, not a dirty flag

The controller records the completed input/baseline, render revision and theme
for each native A/B page. Escape compares that snapshot to the actual unsaved
buffer. `previewDirty=false` during an in-flight render is no longer treated as
proof of freshness. A superseded result is not promoted even if its Index and
theme still match. It remains a hidden worker/page checkpoint, and one followup
uses the newest buffer immediately, without another zero-delay timer.

An obsolete unsupported response or render exception cannot switch the newer
Escape request back to Source or publish an irrelevant error. Only a different
input/theme causes automatic retry; the same failing input is not retried in a
loop. Close, tab switch and Source cancellation still invalidate presentation.

### Position before new-content presentation

`ReviewPresentation` applies hidden bounds and requests the final position
using the existing `marktex:prepare-review` runtime protocol. A unique string
request ID cannot collide with main-process numeric preparation IDs. It accepts
only the matching native page, request and revision; the controller rechecks
active tab, Source/Viewer intent, latest buffer, theme and bounds at acceptance.
A resize or changed position replaces the outstanding request. Duplicate layout
requests do not restart it. The five-second timer is an error deadline, not a
fixed display delay.

Only after this final hidden-layout acknowledgment does the controller show the
new content. It does not send a second correction after that show. A/B native
IDs are paired with render revisions: returning to A after A -> B -> A cannot
accidentally be classified as the old warm page.

The unchanged, already-presented revision retains the previous no-ACK Escape
route and page-local position-proof validation. No mandatory frame wait was
added to that path.

### Real preparation work reduced

- Working Tree prewarming uses 32 ms idle / 120 ms maximum-wait checkpoints,
  instead of 150 / 500. This spends more preparation CPU during typing; it is a
  tuning choice, not a measured end-to-end latency guarantee.
- `rendered-diff.ts` reuses block analysis for byte-identical HTML and the word
  highlighting results of unchanged before/after block pairs.
- Keys include the completed exact HTML, including MathML, attributes and
  source locations. No LaTeX-only key, lossy hash or macro-context assumption.
- Pure-operation LRU caches are bounded to four HTML inputs / 16 MiB estimated
  size and 64 highlighted pairs / 8 MiB estimated size. These estimates are not
  measurements of the JavaScript heap.
- Output semantics, alignment, styles and the row-patch/full-render fallbacks
  are unchanged. Cache misses execute the original algorithms.

## What this does NOT claim

When the newest preview is not prepared yet, the existing typesetting state is
shown instead of an old Working Tree. This removes misleading intermediate
content; that policy alone does not reduce computation time. There can still be
a visible wait for the latest result.

This change does not preempt synchronous work already running in the render
worker, cancel every obsolete downstream installation, or prioritize that
worker across all tabs. Crossnote still renders the complete modified input.
It does not implement equation IDs, within-row math DOM preservation, unified /
split DOM deduplication, geometry virtualization, Rust or a GPU frame cache.

The new acknowledgment verifies the existing hidden layout/position protocol,
NOT native pixel presentation. Actual Electron/Fedora frame correctness, font
and zoom behavior, selection, IME focus and end-to-end latency still need an
application run. A renderer mock is not a substitute for those checks.

## Actual validation in this environment

Direct git clone failed because github.com did not resolve in the execution
container. GitHub connector reads/writes succeeded. Selected sources were
copied into a partial local snapshot and relevant Git blob hashes checked.
The published controller, diff implementation and updated regression tests
match the final locally checked bytes.

Environment: Node 22.16.0; TypeScript 5.8.3.

- 49 actual TypeScript test bodies passed under a Node isolated harness, NOT
  Vitest: final-position helper 9, freshness controller 12, cache 7, updated
  legacy latency tests 5, updated legacy viewport tests 16. The legacy controller
  runs stub external document/diff/model dependencies and the anchor constant /
  clamp; this verifies control/ordering, not Monaco or browser geometry.
- The two obsolete-error tests first failed against the preceding implementation
  and passed after the error-freshness fix.
- Strict `tsc --noEmit --strict --target ES2022 --module commonjs` passed for the
  four pure core files: exact-pair-cache, rendered-diff, rendered-diff-alignment
  and preview-blocks. This is not the project typecheck.
- Syntax transpilation passed for all nine changed/added TypeScript files.
- `git diff --check` passed on the local change snapshot.
- 1,188 output comparisons were byte-equal against the pinned original diff
  implementation, including repeated cache hits, source-line shifts, opaque
  math HTML/MathML, Korean, attributes, lists, repeated blocks and SVG.

### Synthetic CPU measurement only

`apps/desktop/scripts/benchmark-review-cache.cjs` reproduces the output checks
and a synthetic workload of 40 math-containing blocks with 20 pre-existing
changes and 12 further edits. The baseline HTML is 434,621 bytes. A final local
run measured median diff-generation time of 31.63 ms before and 10.49 ms after.
The script measures the diff functions only; its math markup is synthetic.
It does not execute KaTeX, install DOM, perform layout, run Electron, or measure
Escape-to-latest-pixels. Timing is informational, never a test pass/fail gate.

From a full checkout with desktop dependencies installed:

```sh
node apps/desktop/scripts/benchmark-review-cache.cjs
cd apps/desktop
npm run typecheck
npm test
npm run build
```

The optional first argument to the benchmark supplies an original rendered-diff
source file for snapshot-only environments. The default uses `git show` of the
pinned base revision.

## Before merging

Full Vitest, full TypeScript/Svelte checks, application build and actual
Electron/Fedora tests have NOT been run here. Keep this PR draft until those
checks and native interaction tests are completed.

Test one edit then immediate Escape, several edits while old work runs,
repeated unchanged Escape, Source cancellation, close/tab switch, failure/retry,
resize, zoom, fonts and Korean IME. Record Escape-to-latest-content/position and
native frames separately from shell visibility. Watch CPU usage with the shorter
prewarming cadence. Native performance is not established by the CPU benchmark.

## Remote checkpoints

The draft was opened after `4258a911`, before implementation. Code, tests,
cache integration, legacy test updates and error fixes were each published as
separate commits. No force-push, history rewrite or automatic merge was used.
