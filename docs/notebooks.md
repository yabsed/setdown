# Jupyter notebooks

Open a `.ipynb` file through Open File, Explorer, or the location bar. To create
one, create a file ending in `.ipynb` in Explorer; Setdown writes a valid empty
Python notebook. Editing does not require Jupyter or an installed Python kernel.

- Edit code and raw cells directly. Double-click Markdown to edit it; use Preview
  or `Esc` to return to reading. Equations and cell attachments are supported.
- Select a cell with its execution-count button. Shift-click selects a range; Ctrl/Cmd-click toggles a cell. In cell selection mode, Ctrl/Cmd+C/X/V copies, cuts and pastes whole cells, including metadata, attachments and outputs. Arrow keys move selection; Shift extends it; Delete removes the selected cells. Enter edits and Esc returns to cell selection.
- Add code/Markdown cells from the notebook toolbar. Drag the dotted header handle
  to reorder the selected cells; the insertion line shows the destination. Cell controls move, duplicate,
  delete, or change the cell type. Clear Output removes that cell's saved outputs.
- `Ctrl/Cmd+S`, Save As, Auto Save, unsaved-tab indicators and close confirmation
  use the existing document workflow. `Ctrl/Cmd+F` searches sources, complete stored text outputs, or rendered Markdown text; case-sensitive and regular-expression modes are available. Replace All changes sources in one cell operation. The first Enter selects the first match; finding Markdown keeps its reader open and leaves focus in the search field.
- Text Undo belongs to the focused cell editor. The notebook toolbar's Undo/Redo
  buttons handle cell operations. Deleting and restoring a cell keeps its text
  history while the notebook remains open. Window transfer preserves the current
  contents, but does not transfer the editor's Undo stacks.
- Python cells use native notebook language-server documents in notebook order. Completion,
  hover, signature help, diagnostics and definitions use the bundled notebook
  analyzer. Its status and restart are available in Language Support. Analysis follows document order, not prior execution
  order. Normal Python files retain their full existing LSP features.

Code cells and their outputs expand vertically; the notebook owns vertical scrolling.
The mouse wheel over a Python editor scrolls the notebook, and keyboard navigation
reveals the caret in that same scroll area. Cell text and Undo remain owned by the
notebook when a cell view scrolls out of sight. A focused/composing editor stays
mounted offscreen. Long cells reserve their full height while Monaco renders only
one notebook viewport; its internal offset follows the outer scroll. Virtual views
use Monaco's textarea input path to preserve ordinary input and IME across disposal. Offscreen
outputs reserve their measured height. Input and output can be collapsed separately.
Copy Output copies the full available text, and multi-format outputs offer a format
selector. These presentation choices do not rewrite saved output bundles.

## Run Python

Use **Run** on a cell (`Ctrl/Cmd+Enter`) or **Run All** in the toolbar. Code cells
share a Python/IPython kernel for that notebook, so variables and imports survive
between runs. Run All takes a source/order snapshot, skips Markdown/raw cells,
and stops at the first error. Additional Run requests join the queue; repeated
requests for a waiting cell replace its pending snapshot. Completed/error/canceled/
skipped states are tracked per cell. `Shift+Enter` runs and moves to the next cell;
`Alt+Enter` runs and inserts a cell below. For Markdown these keys return to preview
and move/insert without executing Python. Editing or reordering while a run is pending does
not change that snapshot. Outputs from changed sources are marked as stale.

Python must contain `ipykernel` and `jupyter_client`. Install them into the
environment you intend to use, for example:

```sh
python -m pip install ipykernel jupyter_client
```

The **Python environment** selector lists the launch/shell PATH Python, project
`.venv`/`venv` environments, current virtual/Conda environments, Conda’s registered environment list, and Python executables from installed Jupyter kernelspecs. Choose an
entry or **Choose executable…**. Setdown starts from PATH; project executables are
listed without being run or automatically selected. An explicit choice is saved
per notebook path and shared by execution and notebook language analysis. Switching
environments resets the kernel and reconnects analysis. A missing saved environment
is reported rather than silently replaced with a different Python.

**Interrupt** cancels the running cell and remaining Run All queue while keeping
the kernel's variables. **Reset kernel** shuts it down and clears variable state;
the next Run starts a fresh kernel. Closing/reloading/transferring a notebook,
changing its file path or closing the owning window also shuts its kernel down.
Notebook cells never execute merely by opening a notebook, and Setdown never installs packages
automatically. As with a terminal, explicitly running Python permits the code to
access your files and environment.

Streams, expressions, exceptions, rich displays, `display_id` updates and
`clear_output(wait=True)` update the notebook's persisted outputs. `input()` and `getpass()` display an input form; password values are masked and are not written into notebook outputs by Setdown. Interrupt or reset dismisses pending input. Widgets, interactive plots, remote execution and debugging are available through the JupyterLab integration described below. IPython magic/shell cells execute through IPython. Notebook-aware analysis retains
Python imports and statements in these cells; it does not blank the entire cell.

## Preservation and limits

The codec edits nbformat 4 notebooks with code, Markdown and raw cells. Existing
4.0–4.4 cells without IDs receive only internal IDs. New 4.5 notebooks use persisted
unique IDs. Unsupported versions, invalid JSON, duplicate keys or malformed cells
open read-only. The existing strict UTF-8/BOM and 16 MiB file limit applies.

Unchanged saves retain original bytes. Changed source and cell structure are
patched into the original JSON; untouched metadata, attachments, output bundles
and unknown fields retain their raw JSON, including large numeric values. Explicit
conversion from code to another cell type removes the code-only output fields;
Undo restores them. Saving a revision does not erase edits made during the save.

Stored streams, errors, plain text, JSON, raster images, sanitized HTML, Markdown
and LaTeX have static renderers. Unsupported MIME data is preserved with a fallback
message. Output scripts, SVG, widgets, forms, arbitrary CSS and remote output images
are not executed or loaded. Static display truncation never truncates stored outputs. New live output is
bounded to 8 MiB of bridge messages per executed cell, with an explicit truncation
notice persisted in the output; subsequent live output is drained and omitted.
Text output display is limited to 200,000 characters, HTML/Markdown rendering to
1 MiB, raster base64 to 8 MiB and each cell's visible output list to 100 items.

The bundled **basedpyright 1.40.2** analyzer receives separate Python cell documents
through LSP notebook synchronization. It supports notebook `await`, magic/shell
syntax and notebook-order dependencies. `display` and `get_ipython` have notebook
context. Python files and notebooks use VS Code-style lightweight diagnostics by
default: syntax errors remain errors; undefined names, unresolved imports, missing
module sources and invalid type forms remain warnings. Broad type-checking
diagnostics (including argument, overload and attribute mismatches) are off;
completion, hover and navigation still use type inference. There is no separate
type-checking mode selector. basedpyright disables even those core warnings in its
`off` preset, so Setdown explicitly restores the four Pyright/Pylance defaults
through server settings. Runtime execution order does not rewrite static
document-order analysis. Non-Python
notebooks can be edited and retain their metadata; notebook LSP mapping currently
targets Python. F2 or Commands → Rename changes cell-local LSP edits across the notebook atomically. Safe LSP code actions with explicit workspace edits use the same transaction. Stale responses, external file edits, resource operations and arbitrary server commands are rejected. Ruff provides whole-notebook formatting and safe fixes; only its source changes are applied, preserving original metadata and outputs. Completion edits still remain within their originating cell.
Mermaid and other active Markdown runtimes are not part of the fragment renderer.

Execution accepts up to 1 MiB of source per cell. The renderer submits one cell at a
time from its queue; the main-process batch transport also retains its 4 MiB limit. The overall
16 MiB text-file save limit still applies; clear large outputs before saving if
new execution results exceed it.

Git shows `.ipynb` as a read-only JSON diff. Change cells in the notebook tab, which
remains the single editable owner. Commands → Compare notebook with Git HEAD opens a read-only cell-aware nbdime comparison of HEAD and the current unsaved snapshot. It separates source, outputs and metadata. Merge conflict resolution remains in Git/Jupyter tooling.

## Implementation boundaries

`core/notebook/notebook-document.ts` owns source, structural history, checkpoints
and JSON spans. `renderer/notebook/notebook-store.ts` owns persistent touched-cell
models. Visible cell components borrow these models and dispose their editor views
when hidden or scrolled away unless they own focus/composition. Output-only changes
do not enter LSP synchronization or repeatedly rebuild workspace chrome.

The Markdown fragment endpoint accepts only an open notebook and a bounded cell,
and reuses the serialized Crossnote worker. Sanitization is applied before fragments
enter the shell. No native browser view is created per cell.

`NotebookLanguageHost` validates the open notebook and owns each analysis process,
its selected interpreter and wire cell URIs. The bundled analyzer recognizes
`vscode-notebook-cell:` wire URIs; renderer models retain Setdown's own cell scheme.
A hidden analysis-only cell imports `get_ipython` from the chosen environment's
IPython package; it is never saved or executed. Cell diagnostics carry both the
notebook revision and cell source revision. Source changes advance dependency
versions, while structural changes reopen cell documents on the same server with
new URI epochs, rejecting late results for reordered or removed cells. No virtual
Python file is written, and there is no regex-based magic stripping or joined-file
syntax contamination. Analysis is active only for visible notebook tabs; failure
and restart remain available in the Language Support panel.

`NotebookController` owns cell selection, collapse state and scroll position.
Bulk copy/paste/move/delete use the same document transaction history; source Undo
still belongs to each persistent Monaco model. The clipboard carries nbformat JSON
and regenerates cell IDs without rounding metadata numbers.

`main/notebook/kernel-manager.ts` owns per-window/tab processes. The packaged
`kernel-bridge.py` uses the official Python `jupyter_client` manager and client;
Setdown does not implement ZeroMQ, message signing or kernel channel framing.
The client waits for both IOPub idle and the matching execute reply. A bounded
stdio interface carries cell IDs, source revisions, unique run IDs and kernel generations;
renderer output updates are batched. EOF shuts the kernel down if its owner dies.

This implements the design's execution phase using `jupyter_client` instead of
`@jupyterlab/services` plus a separate Jupyter Server. That avoids requiring a
server package for local Python while retaining the official Jupyter protocol
implementation. See [Jupyter client API](https://jupyter-client.readthedocs.io/en/stable/api/jupyter_client.html)
and [messaging semantics](https://jupyter-client.readthedocs.io/en/stable/messaging.html).

The implementation and regression scenarios are covered by the
[preview performance contract](preview-performance-contract.md).

For the original audit and implementation status, see the [feature audit](../reports/2026_10_16_notebook_remaining_convenience_features.md).

## Notebook commands

Use **Commands…**, Ctrl/Cmd+Shift+P inside a notebook, or right-click its cell header.
The same command handler backs toolbar, context and keyboard actions.

- Run cells above excludes the active cell; Run from current cell to end includes it.
  Restart kernel and run all waits for the old bridge to exit before starting a new one.
- Clear all outputs is one Undo operation. Collapse/expand all inputs or outputs,
  section folding and line-number choices affect presentation only.
- Split cell at cursor (Ctrl/Cmd+Shift+-) gives the second cell a fresh ID. Split
  and Join selected adjacent cells clear stale code results, with original data
  available through Undo. Join requires identical metadata, attachments and unknown
  fields; conflicting attachments or metadata produce an error without changes.
- Outline parses all Markdown cells, including those offscreen. Fenced code is not
  treated as a heading. Title links retain reading mode; section toggles hide cells
  until the next same/higher-level heading, and the current title sticks above the
  scroller. A section boundary is a cell; headings within one cell remain together.
- In cell selection mode: A/B insert above/below, M/Y select Markdown/code, DD deletes,
  L toggles that cell’s numbers, Shift+L toggles all numbers, Alt+Up/Down moves selected
  cells. These keys do not change cells during ordinary typing or IME composition.
- Images have **View full size** (zoom and scroll) and **Save image…**. Saving writes
  original PNG/JPEG/GIF/WebP bytes without changing the notebook. It does not recreate
  a vector original from a raster output. Traceback buttons navigate to execution
  counts or file/line locations and identify changed cell source.
- **Variables** inspects the current idle local kernel on demand. Lists and dictionaries,
  NumPy arrays (flat indices) and DataFrames have paged previews of 100 rows and up to
  100 columns. Busy/reset kernels clear the panel; returning idle refreshes it. Custom
  objects show their type instead of recursively inspecting arbitrary attributes.
- Search uses a worker, debounces edits and terminates expressions exceeding two
  seconds. It finds text in offscreen/truncated outputs and shows a match excerpt.
  Replace All rechecks every cell revision before changing any source. Regex replacement
  supports JavaScript capture substitutions; literal replacement keeps `$` unchanged.

## External notebook tools

Choose **Install notebook tools** once. Setdown creates a separate virtual environment
under its application data directory and installs JupyterLab, nbconvert with WebPDF,
nbdime, Jupytext, Ruff, ipywidgets, Plotly and anywidget. It does not install these into
the selected project Python. This explicit command requires network access; normal
opening/editing/running of notebooks does not download packages. The UI reports
installation/export failures and provides **Cancel tool**. **Stop external notebook
sessions** stops local tool servers owned by this window. Closing the window or app
also stops them. Jupyter configuration, trust state and runtime files have their own
Setdown application-data directories.

HTML, Markdown, script and PDF export run **nbconvert** on the current snapshot without
executing cells or overwriting the notebook. Save dialogs choose a separate destination.
Markdown image assets are copied to a companion folder; an existing asset folder is
never silently overwritten. WebPDF uses nbconvert’s Chromium exporter and may download
its supported Chromium on first use. Exports containing user-authored HTML are ordinary
exported documents, separate from Setdown’s sanitized native output view.

**Open JupyterLab: widgets, plots and debugger** opens a token-authenticated loopback
JupyterLab server in an ordinary Setdown web tab. Save first: this session edits the
saved notebook file, and existing external-change/conflict handling applies when
returning to the native notebook. Its kernel state is separate from the native kernel.
The selected Python is registered as a `Setdown · /path/to/python` kernel choice in Lab;
choose that kernel to use the project’s installed packages. Other registered kernels
remain selectable. JupyterLab supplies widget comms, interactive MIME renderers and
its debugger with breakpoints, stepping and inspection; debugging requires a compatible
kernel such as ipykernel. The native cell output renderer remains static.

**Connect to remote JupyterLab** opens the supplied HTTP(S) Lab URL in a web tab.
Authentication, sessions, uploads and kernel selection belong to that server’s UI;
local files/variables are not silently copied to it. Python and non-Python kernels use
JupyterLab’s own language support. A classic Notebook-only server needs a Lab endpoint
to provide the integrated debugger and Lab interface.

In a `.py` editor, use the context menu or Monaco command palette action **Open Python
# %% cells as interactive notebook…**. Jupytext converts the current unsaved text,
including `# %% [markdown]`, into a separately saved `.ipynb` and opens it in Setdown.
This is an explicit snapshot: execution and outputs belong to the new notebook;
editing it does not rewrite or automatically synchronize the source `.py` file.

External integrations deliberately reuse maintained tools. They do not run VS Code
extensions inside Setdown or turn the native notebook pane into JupyterLab.

## Verify the integrations

`npm run test:preview-contract` covers notebook transactions, analysis, input/variables,
images and search in the full isolated Electron regression suite. The standalone
kernel suite is `python3 apps/desktop/test/notebook/kernel-bridge.test.py` with
ipykernel, pandas and NumPy installed in the test Python.

For external tools, provision a separate venv with the package ranges listed in
`src/main/notebook/notebook-tools.ts`. Set `SETDOWN_NOTEBOOK_TOOLS_PYTHON` to its absolute
Python executable and run `npm run test:notebook-tools --workspace @setdown/desktop`.
The test uses temporary files/configuration and exercises real HTML/Markdown/script/PDF
exports, Ruff, nbdime, Jupytext, JupyterLab widgets, Plotly, debugger activation and server
shutdown. Chromium for WebPDF must be available or downloadable. These checks do not
exercise a third-party remote server or a separately installed non-Python kernel.
