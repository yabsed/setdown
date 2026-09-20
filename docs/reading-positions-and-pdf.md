# Reading positions and PDF documents

Setdown stores reading positions for Markdown, other text documents and PDFs in
one main-process store. Opening a file through the file dialog, Explorer, a local
document link or the command line restores its most recently saved position.
History survives closing a tab and restarting the application.

## Common history

`apps/desktop/src/core/reading/reading-position.ts` defines the versioned record:
file path, observed disk version, observation timestamp and a discriminated
position. Text positions contain the reading/editing surface, source anchor and
optional Monaco view state. PDF positions contain a one-based page number,
coordinates within that page in PDF units, zoom mode/value and rotation.

`main/reading/reading-position-store.ts` owns the only disk writer. It keeps at most
1,000 file records in `reading-positions.json` under Electron's user-data directory.
Updates are debounced and written through a temporary file and atomic rename;
the renderer requests a final synchronous flush when closing. Corrupt or unknown
history versions do not prevent document opening. Older timestamped observations
cannot replace newer ones. IPC accepts observations only from the focused owning
window. Untitled documents have no durable reading record.

Text positions reuse Setdown's source anchor rather than a scroll percentage.
Monaco layout/cursor state is reused only when the file's size and modification
time still match. Otherwise Setdown retains the source line, clamped to the new
document. Explorer rename/move relocates both file and descendant history keys.
Renames performed outside Setdown are not tracked. Different files with the same
name in different directories have separate histories.

## PDF reader

`renderer/pdf/PdfSurface.svelte` and `pdf-runtime.ts` provide a read-only PDF.js
viewer with page navigation, continuous scrolling, selectable/searchable text,
outline navigation, zoom, rotation and password entry. PDF scripts are not run;
annotation form editing is disabled. Search operates on the PDF's embedded text;
image-only scans need an OCR text layer supplied by the document.

PDF metadata is a separate document kind. It never enters Markdown/Crossnote
preparation or creates a Monaco text model, and text-saving paths reject it.
`main/documents/pdf-file.ts` reads regular files through bounded byte-range IPC,
validating the disk version on each request. PDF.js uses a worker and range reads
with automatic full-file fetching disabled. Files changed during reading report
an error instead of silently combining revisions.

PDF.js is loaded only when a PDF surface mounts. Its compatibility build supports
the project's existing Electron runtime. Viewer CSS lives inside a shadow root,
so generic PDF.js selectors cannot restyle Markdown, editor or shell elements.
CMaps, standard fonts and WASM assets are bundled locally. Closing or switching
away from the PDF surface destroys its worker, page views and event observers;
returning reconstructs it from the tab's last reading position.

PDF restoration uses page-relative coordinates, not accumulated document pixels,
so a different viewport or zoom does not confuse preceding pages with the current
page. Page numbers are clamped if the file now has fewer pages. No passwords or PDF
contents are written to reading history.

## Verification

Focused storage and file-reader unit tests exercise durable writes, older-write
rejection, corrupt input, file moves, bounds and changed-file detection.
`test/e2e/reading-positions.spec.ts` exercises real Electron PDF rendering, page
coordinates/zoom/rotation across restarts, text search and outline navigation,
bounded-range documents, Markdown/PDF tab switching, read-only saving, and text
and Markdown position restoration. Changes also require the existing preview
performance contract and comparative benchmark.
