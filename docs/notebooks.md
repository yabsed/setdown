# Jupyter notebooks

Open a `.ipynb` file through Open File, Explorer, or the location bar. To create
one, create a file ending in `.ipynb` in Explorer; Setdown writes a valid empty
Python notebook. Editing does not require Jupyter or an installed Python kernel.

- Edit code and raw cells directly. Double-click Markdown to edit it; use Preview
  or `Esc` to return to reading. Equations and cell attachments are supported.
- Add code/Markdown cells from the notebook toolbar. Drag the dotted header handle
  to reorder cells; the insertion line shows the destination. Cell controls move, duplicate,
  delete, or change the cell type. Clear Output removes that cell's saved outputs.
- `Ctrl/Cmd+S`, Save As, Auto Save, unsaved-tab indicators and close confirmation
  use the existing document workflow. `Ctrl/Cmd+F` searches cell sources.
- Text Undo belongs to the focused cell editor. The notebook toolbar's Undo/Redo
  buttons handle cell operations. Deleting and restoring a cell keeps its text
  history while the notebook remains open. Window transfer preserves the current
  contents, but does not transfer the editor's Undo stacks.
- Python cells share a language-server document in notebook order. Completion,
  hover, signature help, diagnostics and definitions use the existing Language
  Support configuration. Analysis follows document order, not prior execution
  order. Normal Python files retain their full existing LSP features.

Code cells and their outputs expand vertically; the notebook owns vertical scrolling.
The mouse wheel over a Python editor scrolls the notebook, and keyboard navigation
reveals the caret in that same scroll area. Cell text and Undo remain owned by the
notebook when a cell view scrolls out of sight.

## Run Python

Use **Run** on a cell (`Ctrl/Cmd+Enter`) or **Run All** in the toolbar. Code cells
share a Python/IPython kernel for that notebook, so variables and imports survive
between runs. Run All takes a source/order snapshot, skips Markdown/raw cells,
and stops at the first error. Editing or reordering while a run is pending does
not change that snapshot. Outputs from changed sources are marked as stale.

Python must contain `ipykernel` and `jupyter_client`. Install them into the
environment you intend to use, for example:

```sh
python -m pip install ipykernel jupyter_client
```

Setdown uses Python from the launch/shell PATH. **Python environment…** selects a
specific virtual environment's Python executable. This choice belongs to the open
notebook; it does not currently change Pyright's interpreter configuration or
persist across closing/reopening the notebook.

**Interrupt** cancels the running cell and remaining Run All queue while keeping
the kernel's variables. **Reset kernel** shuts it down and clears variable state;
the next Run starts a fresh kernel. Closing/reloading/transferring a notebook,
changing its file path or closing the owning window also shuts its kernel down.
No code executes merely by opening a notebook, and Setdown never installs packages
automatically. As with a terminal, explicitly running Python permits the code to
access your files and environment.

Streams, expressions, exceptions, rich displays, `display_id` updates and
`clear_output(wait=True)` update the notebook's persisted outputs. Widgets,
interactive JavaScript, remote kernels, debugger and stdin prompts (`input()`)
are not yet supported. IPython magic/shell cells execute through IPython, while
remaining excluded from ordinary Python static analysis.

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

IPython magic and shell syntax are preserved, but the containing cell is excluded
from ordinary Python analysis. This is not a complete IPython parser. Non-Python
notebooks can be edited and retain their metadata; notebook LSP mapping currently
targets Python. Cross-cell rename, code actions, formatting and completion edits
that cross cell boundaries are withheld until they can be applied transactionally.
Mermaid and other active Markdown runtimes are not part of the fragment renderer.

Execution accepts up to 1 MiB of source per cell and 4 MiB per batch. The overall
16 MiB text-file save limit still applies; clear large outputs before saving if
new execution results exceed it.

Git shows `.ipynb` as a read-only JSON diff. Change cells in the notebook tab, which
remains the single editable owner. Notebook cell/diff merge tooling is not included.

## Implementation boundaries

`core/notebook/notebook-document.ts` owns source, structural history, checkpoints
and JSON spans. `renderer/notebook/notebook-store.ts` owns persistent touched-cell
models. Visible cell components borrow these models and dispose their editor views
when hidden or scrolled away. Outputs do not enter the Python projection.

The Markdown fragment endpoint accepts only an open notebook and a bounded cell,
and reuses the serialized Crossnote worker. Sanitization is applied before fragments
enter the shell. No native browser view is created per cell.

`NotebookProjection` maps UTF-16 coordinates between Python cells and one analysis
document. The main process validates notebook ownership and issues a logical `.py`
URI beside the notebook for local imports. It never writes that file. Requests are
versioned, canceled when obsolete, and checked against the notebook method subset.
Projection ranges that touch another cell or a separator cannot become cell edits.

`main/notebook/kernel-manager.ts` owns per-window/tab processes. The packaged
`kernel-bridge.py` uses the official Python `jupyter_client` manager and client;
Setdown does not implement ZeroMQ, message signing or kernel channel framing.
The client waits for both IOPub idle and the matching execute reply. A bounded
stdio interface carries cell IDs, source revisions and kernel generations;
renderer output updates are batched. EOF shuts the kernel down if its owner dies.

This implements the design's execution phase using `jupyter_client` instead of
`@jupyterlab/services` plus a separate Jupyter Server. That avoids requiring a
server package for local Python while retaining the official Jupyter protocol
implementation. See [Jupyter client API](https://jupyter-client.readthedocs.io/en/stable/api/jupyter_client.html)
and [messaging semantics](https://jupyter-client.readthedocs.io/en/stable/messaging.html).

The implementation and regression scenarios are covered by the
[preview performance contract](preview-performance-contract.md).
