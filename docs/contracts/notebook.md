# Notebook contract

These guarantees remain part of the maintained preview performance contract.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Notebook surface contract — 2026-10-16

Notebooks have one document owner and persistent touched-cell Monaco models.
Mounted views borrow these models; hiding/remounting a view must preserve source,
selection and text Undo. Structural Undo is separate. No native browser view is
created per cell. Markdown fragments reuse the existing serialized Crossnote
worker and are sanitized before entering the shell. A late fragment must not
replace a newer source revision. Escape returns a Markdown cell to its latest
preview while respecting composition and Monaco popup ownership.

Logical code-cell heights follow the full wrapped content at the current width and
zoom. There is no 600px cell or output height cap. Notebook scrolling owns wheel
input over code and keyboard caret reveal; shrinking/Undo and view restoration
must not leave an independent editor scroll offset. Monaco renders a viewport-sized
sticky inner editor whose offset follows the outer scroll; its full logical height
is reserved. Offscreen focused/composing editors are retained, and output placeholders
reserve measured height without margin-collapse shifts. These virtual views use
Monaco's supported textarea input (`editContext: false`): native EditContext left
an ordinary focused find input receiving `beforeinput` without committing text
after offscreen editor retirement. The regression checks real Korean composition
across scrolling, subsequent normal input, and both fill and keyboard typing. Dragging starts only from
a cell header handle, with insertion position, edge auto-scroll, selected-cell grouping
and a single structural Undo. Cell selection and native text selection have separate
clipboard scopes; copied metadata, attachments and output bundles retain exact JSON.

Explicit Run starts one Python kernel per notebook; opening does not. Source/order
snapshots, unique run IDs, kernel generations, owner window and stable cell IDs prevent results
from attaching to a different cell. Closing the owner or resetting releases the
kernel. Output changes must not invalidate Python LSP requests. Source-only edits
preserve unrelated JSON spans, metadata, outputs and attachments. Runs join a serial
queue; errors stop queued work, interrupt cancels it, and delayed results from an
older run cannot overwrite a rerun of the same cell.

Python analysis uses native notebook cell synchronization with the bundled
basedpyright, preserving magic-cell Python statements, top-level await and cell
syntax boundaries. Core syntax/name/import diagnostics remain enabled; broad type
checking follows the lightweight policy documented in `notebooks.md`. Wire URI epochs,
notebook dependency revisions and cell source revisions reject stale diagnostics.
Notebook analysis and execution share a persisted explicit Python environment.
Project-local candidates are only listed until selected. Search keeps Markdown in
reader mode, selects the first match on first Enter and leaves find input focus intact.

Coverage lives in `notebook-document.test.ts`, `notebook-language.test.ts`,
`notebook-execution.test.ts`, `kernel-manager.test.ts` and real Electron
`notebook.spec.ts` (Markdown/Escape, LSP, Undo, drag, long-cell wheel/caret/shrink).
The separate real-kernel integration test is
`python3 apps/desktop/test/notebook/kernel-bridge.test.py`; it requires
`ipykernel` and `jupyter_client` and loopback socket access.

Final functional validation passed **65 unit files / 436 tests**, **three
benchmark comparator tests**, production build/typecheck with **zero Svelte errors
or warnings**, **121 real Electron scenarios** (including all four notebook
scenarios), and **three real IPython kernel integration tests**. All GUI runs use
isolated Xvfb/runtime/D-Bus. The kernel tests cover shared variables, execution
counts, stop-on-error, rich/updated/cleared output, working directory, IPython magic,
interrupt and reuse. Initial failure logs, final passing logs and the notebook
screenshot are retained in `test-results/notebook-validation-2026-10-16/`.

Those checks exposed a reactive dependency on the replaced tab-summary object:
typing restarted the notebook LSP session. The language connection now depends
on the stable document path, and cell view setup does not subscribe to incidental
model reads. The regression checks retained editor identity, zero reconnections,
IME/Escape and cross-cell definition focus. The long-cell height regression deletes
the selection in one edit before Undo, independently of Monaco's auto-closing
quote history. It verifies both restored height and exact saved source. No
scenario, assertion or performance tolerance was relaxed.


The independent baseline is `1f37fa1b3d3520d6cd918777248c9f5d9ce69344`, installed
separately in `/tmp/setdown-hover-baseline`. Baseline and candidate use Electron
**44.7.2**. Five matched repetitions alternate order on one isolated display,
with the same fixture and harness. `--skip-build` reuses the current independently
built artifacts, whose hashes the harness verifies before and after measurement.
All eight scenarios and all five cycles completed, with latest-content captures
and real double-click input.

Comparison: **PASS — zero regressions across 48 buckets**, at the unchanged
joint thresholds (>25% and >50ms). Median milliseconds are **baseline → candidate**.
Warm is the median of cycles 3–5 in each process, then across repetitions. Esc
includes native capture/readback, not a monitor presentation timestamp. The table
excludes the configured preparation wait.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 43 → 36 | 19 → 21 | 20 → 22 | 17 → 16 | 33 → 34 | 11 → 11 |
| Markdown | 0ms | yes | 425 → 442 | 101 → 95 | 93 → 86 | 20 → 19 | 14 → 14 | 12 → 15 |
| Markdown | 3000ms | no | 41 → 43 | 20 → 17 | 19 → 24 | 16 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 108 → 108 | 104 → 101 | 92 → 90 | 19 → 20 | 13 → 16 | 14 → 13 |
| Git review | 0ms | no | 945 → 948 | 22 → 29 | 29 → 29 | 23 → 22 | 11 → 12 | 12 → 12 |
| Git review | 0ms | yes | 1031 → 997 | 1530 → 1489 | 180 → 177 | 21 → 23 | 20 → 21 | 19 → 18 |
| Git review | 3000ms | no | 28 → 25 | 23 → 22 | 18 → 18 | 23 → 23 | 11 → 11 | 17 → 17 |
| Git review | 3000ms | yes | 232 → 232 | 185 → 187 | 178 → 174 | 21 → 22 | 18 → 18 | 17 → 18 |

Including the **configured 3000ms preparation allowance**, first Esc totals are
below. These add the explicit wait to measured input latency; they do not measure
preparation CPU time. The wait precedes only the first cycle, so second/warm and
double-click values stay as above. The 0ms scenarios' inclusive totals equal the
first table.

| Surface | Edit | First Esc including preparation allowance |
| --- | --- | ---: |
| Markdown | no | 3041 → 3043 |
| Markdown | yes | 3108 → 3108 |
| Git review | no | 3028 → 3025 |
| Git review | yes | 3232 → 3232 |

[Samples, build identities and hashes](../notebook-preview-benchmark-2026-10-16.json).
Raw measurements are in `test-results/notebook-performance-2026-10-16/` and
functional logs/screenshots are in `test-results/notebook-validation-2026-10-16/`.
The comparison covers existing ordinary Markdown/Git transition latency. The
notebook GUI scenarios establish behavior, not large-notebook memory budgets or
kernel startup/indexing performance; those are not measured by this benchmark.

