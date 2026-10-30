# Notebook contract

These guarantees remain part of the maintained preview performance contract.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Notebook surface contract — 2026-10-16

Explorer's generic New File action supports `.ipynb` names. Empty or whitespace-only
`.ipynb` files also open as clean, editable nbformat 4.5 Python notebooks without
rewriting the disk on open. Code and Markdown insertion are enabled; saving
serializes valid notebook JSON. Malformed nonempty notebooks remain protected.
`notebook-document.test.ts` and `notebook.spec.ts` cover blank files, insertion,
save/reopen, and the ordinary New File flow. There is no dedicated creation button.

Notebooks have one document owner and persistent touched-cell Monaco models.
Mounted views borrow these models; hiding/remounting a view must preserve source,
selection and text Undo. Structural Undo is separate. No native browser view is
created per cell. Markdown fragments reuse the existing serialized Crossnote
worker and are sanitized before entering the shell. A late fragment must not
replace a newer source revision. Escape returns a Markdown cell to its latest
preview while respecting composition and Monaco popup ownership. The first frame
on opening or reactivating a notebook waits for viewport observation, mounted
code editors and current visible Markdown. Raw Markdown is never used as a
transient preview. Escape keeps the editor until the current revision is rendered;
late requests cannot dismiss a newer edit. `notebook.spec.ts` samples animation
frames across initial load, a new notebook, return to a retained tab, and edited
Markdown Escape to check that raw/empty preparation frames are not presented.

Logical code-cell heights follow the full content at the current width, wrap setting
and zoom. Code defaults to no wrapping; an explicit command enables wrapping. There is no 600px cell or output height cap. Notebook scrolling owns wheel
input over code and keyboard caret reveal; shrinking/Undo and view restoration
must not leave an independent editor scroll offset. Monaco renders a viewport-sized
sticky inner editor whose offset follows the outer scroll; its full logical height
is reserved. Document start/end spacing scrolls with the content and must not
inset the sticky editor's viewport. The editor's internal offset follows its actual
position inside the logical cell, including the clamp at the cell's end. Fractional
CSS geometry at noninteger app zoom is reconciled with Monaco's integer scroll
offset without moving the outer viewport or altering the logical content height. Scrolling
through a long cell must not leave a blank strip below the section heading or
shift visible lines from their logical positions. `notebook.spec.ts` checks both
viewport edges and line coordinates at 90%, 100% and 130% app zoom, after resizing
and after returning to the document start.
Execution evidence: [Notebook scroll validation](../validation/2026-10-22-notebook-scroll.md).
Offscreen focused/composing editors are retained, and output placeholders
reserve measured height without margin-collapse shifts. These virtual views use
Monaco's supported textarea input (`editContext: false`): native EditContext left
an ordinary focused find input receiving `beforeinput` without committing text
after offscreen editor retirement. The regression checks real Korean composition
across scrolling, subsequent normal input, and both fill and keyboard typing. Dragging starts only from
a cell gutter handle, with insertion position, edge auto-scroll, selected-cell grouping
and a single structural Undo. Cell selection and native text selection have separate
clipboard scopes; copied metadata, attachments and output bundles retain exact JSON.

Explicit Run starts one Python kernel per notebook; opening does not. Source/order
snapshots, unique run IDs, kernel generations, owner window and stable cell IDs prevent results
from attaching to a different cell. Closing the owner or resetting releases the
kernel. Output changes must not invalidate Python LSP requests. Source-only edits
preserve unrelated JSON spans, metadata, outputs and attachments. Converting a
Markdown/raw cell to code omits attachments from serialized code-cell JSON, while
the original attachment data remains available to structural Undo/Redo. The audit
regression test checks this nbformat boundary. Runs join a serial
queue; errors stop queued work, interrupt cancels it, and delayed results from an
older run cannot overwrite a rerun of the same cell.

Path changes preserve a running kernel's identity and variables. Reload replaces
the notebook model in place while preserving an idle kernel and disposing cell
models that disappeared. A starting/busy kernel blocks reload with an explanation
until execution finishes or is interrupted. Invalid replacement JSON preserves
the previous notebook. Explicit reset and closing retain their shutdown behavior.
The existing kernel process keeps its working directory after a path change;
reset starts the next process from the new notebook location.

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

## Reading and interaction hierarchy — 2026-10-30

The notebook adopts VS Code's compact layout and renderer hierarchy (studied at
commit `2d0b7506a36c1d6db9a466440131a8e01eab2289`). This intentionally replaces the
2026-10-19 reading measure and permanent output-action footer.

Code, inline code and plain output use Monaco's platform-default monospace font;
prose, rich HTML and notebook controls use the system UI font. Markdown is 1.2 times
the code size and uses the available cell width. Rich HTML uses the base size,
normal word breaking, natural table sizing and an output-local horizontal scrollbar.
Table headings and row labels wrap at normal boundaries; narrow panes must not
split words into individual letters to avoid horizontal scrolling. Author CSS is
still stripped. These display rules never modify output bundles on disk.

The compact left margin/run gutter is 8px + 36px, the right margin is 16px.
Code padding is 12px above and 4px below, with a stable 22px status/language slot.
Execution count stays in the gutter beside that slot. Cell actions use Codicons,
appear at the upper right on hover/selection/focus, and do not change geometry.
Less frequent cell actions and output actions use keyboard-accessible popovers;
output actions sit beside their result without a reserved footer. Insert controls
appear between cells without changing height on hover. The global toolbar stays
on one row; commands and the kernel picker remain reachable in split panes.

Code wrapping, output wrapping, line numbers and sticky headings default off.
Notebook commands toggle each independently. Full logical heights, outer vertical
scroll ownership and viewport-sized editors remain required in both wrap modes;
horizontal source scrolling must survive outer vertical scrolling. Shift+Enter
selects an existing next cell in command mode; at the end it creates a same-kind
cell (Markdown or code) and enters editing. Alt+Enter creates a code cell below.
Find still leaves input focus intact. Cell/output popover keys never become cell
commands; Escape closes the popover and returns focus to its trigger.

Selection and input focus remain distinct. Only the focused editor highlights its
current line. Running, error and earlier-source-output states remain visible
independently of hover. The earlier-source notice compares the cell's source with
its recorded execution source; it does not establish dependency/kernel freshness.
Keyboard editing, selection, popup/IME Escape ownership, structural Undo, output
placeholders, sanitization and exact serialization retain the guarantees above.

Comments retain at least 4.5:1 contrast against the actual notebook input background
in every registered theme; the GitHub palettes keep their validated editor background
instead of adding a tint. The real Electron notebook scenarios cover typography, DataFrame wrapping and
horizontal overflow, menus, insertion/keyboard focus, output formats, narrow panes,
IME, long-cell geometry, output-height preservation, execution and Undo.
Reference research and measured VS Code screenshots are in
`reports/notebook-vscode-study-2026-10-30/` at the repository root.
Implementation screenshots, real Electron results (including intermittent Git
test failures), and the independent preview latency comparison are recorded in
[the notebook implementation validation](../../reports/notebook-vscode-implementation-2026-10-30/index.html).

## Historical notebook validation — 2026-10-16

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



## Python analysis project paths

The Python analysis host reads the owning root's `.vscode/settings.json` as JSONC.
It accepts `basedpyright.analysis.extraPaths` or `python.analysis.extraPaths`
(flat or nested), preferring basedpyright and preserving an explicit empty list.
Relative paths and `${workspaceFolder}` resolve against that root. Unknown
variables, malformed/oversized input and nonstring paths are rejected with context;
settings from an outer repository do not leak into a nested project. Explicit
language connection paths take precedence over this compatibility layer.

The selected server still interprets `pyrightconfig.json`/`pyproject.toml`, including
its native execution-environment rules; Setdown does not flatten or claim to know
those final effective paths. Language Support distinguishes client configuration,
its provenance, selected interpreter/root and server project configuration. Settings
file changes retire only affected analysis sessions and rebuild their configuration.
This does not execute `sys.path` expressions or change the notebook kernel.

`python-project-settings.test.ts` covers JSONC, precedence, empty/removal cases,
provenance and project isolation. The notebook Electron test creates a Unicode
source directory, observes a real missing-import diagnostic disappear and module
hover appear after changing project paths, retains a negative-control diagnostic,
and verifies that an explicit empty list restores the original missing imports.
