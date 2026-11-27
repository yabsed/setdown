# Reading surface contract

These guarantees remain part of the maintained preview performance contract.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Reading surface capabilities

### Static image editing

PNG, JPEG and static WebP tabs expose **Edit image**. Svelte owns the controls;
the lazy Fabric 7.4 adapter applies the same geometry and color recipe in the
preview and export runtimes. Crop coordinates belong to the upright original
after quarter turns/flips, independent of window size, zoom and DPR. Rotation
in the existing image reader remains a reading preference. Editing starts from
the upright file, without silently committing the reader's rotation.

`core/image/image-recipe.ts` owns geometry and bounded recipe history.
`renderer/image/image-edit-sessions.ts` owns original-source handles, saved
checkpoints and pending saves independently of media surfaces. Cache eviction
must preserve edits and Undo/Redo. A save acknowledges its captured recipe;
later changes stay dirty and Undo back to the saved recipe becomes clean.
Toolbar, keyboard/menu, save-before-close, navigation and save-before-staging
dispatch through the same content owner. Image edits use explicit saves.
Dirty image tabs must be saved before dragging to another group/window; recipe
transfer and crash recovery are outside this first implementation.

Main retains immutable encoded originals under window-owned opaque IDs (64 MiB
per source, 256 MiB total). Source acquisition rejects animation, more than
24 million pixels, and edges over 8192 pixels. GIF, APNG, animated WebP, AVIF and
SVG remain viewing formats. Opening an unsupported edit must preserve the viewer.
Preview bitmap decoding uses an upright image with a maximum edge of 2048 pixels;
zoom requiring finer detail replaces it with a full-resolution render. Export
and detailed previews run one at a time in a separate, never-shown sandboxed
BrowserWindow, with only its dedicated job/result bridge. They cannot show or
focus Markdown previews or the desktop shell and do not depend on hidden rAF.

Image editing inherits its tab’s current original-size percentage. Selecting Fit
updates that same tab value; opening the editor does not reset it.
Image editing fit mode uses the viewport's fractional outer CSS bounds, without
feeding scrollbar-reduced integer client sizes back into the scale. Fit mode
has no scrolling overflow when the fitted scale is within the shared 10–1000%
range; fixed numeric zoom retains scrolling/panning. With
no input or viewport change, the image's size and position must stay still at
fractional application zoom too. The image editor Electron tests sample consecutive
frames at 90%, 120% and 130%, including returning from 100% to Fit.

`main/documents/image-edit-ipc.ts` validates ownership, dimensions, recipe and
output format. Saves serialize per canonical destination across windows, compare
the expected content hash and disk version, and check the destination again
before a temporary-file rename. Failures remove the temporary file and retain
the edit session. A closed/reloaded session cannot commit a delayed save.
External changes preserve dirty recipes; **Keep My Changes** retains that recipe
without granting overwrite permission. Save As to a different file or Reload
resolves the conflict. An external process can still race the final check/rename;
this is optimistic conflict detection, not filesystem compare-and-swap.

Output is a flattened 8-bit browser raster. PNG/WebP preserve transparency;
JPEG flattens onto white. EXIF orientation is applied once. Metadata and original
color profiles are not preserved. Repeated saves in one session render the
immutable original, avoiding cumulative JPEG recompression.

`image-recipe.test.ts`, `image-save.test.ts`, `image-edit-sessions.test.ts` and
`media/image-editor.spec.ts` cover geometry/history, save races, file replacement,
cache eviction, crop after resize, EXIF 1–8, alpha, formats and size limits.
They join the existing `media/image-reader.spec.ts` and full preview contract gate.

### Document and web readers

Rendered Markdown keeps its 14px screen body (`MARKDOWN_FONT_SIZE`). Web Reader
uses an 18px body (`READER_FONT_SIZE`, the size of long-form news text; it shared
Markdown's 14px until 2026-11-12 and was 20px until 2026-11-17, when 90% of that
proved the better default). Reader is the selected Markdown theme scaled by
18/14: its `--reader-scale` carries that ratio and the tab zoom, so every theme
length keeps its proportion to the text. Both use the app font and 2em page
padding. Lines stop at an 840px measure (`DOCUMENT_MEASURE_PX`): a wider pane centers the text column while the surface still paints its
full width, and a narrower pane uses all of its width. Tab zoom changes the text
size only; the column keeps its on-screen width. The shell Reader uses a fixed px
width. The native Markdown preview, whose tab zoom scales every length, divides
the width by `--setdown-content-zoom`, which `PreviewManager` publishes after each
zoom application and document load (never at the default 100%). App zoom scales
the column with the rest of the interface. PDF export keeps the page width.
Web Reader loads the same installed Crossnote preview
and code stylesheets and the same imported-theme color overrides, scoped to the
article so the shell and other groups retain their styling. Headings, paragraphs,
lists, quotations, inline code and tables follow the selected Markdown theme.
The existing tab zoom scales the document and its padding and survives entering
or leaving Reader. Theme changes retain the current reading anchor and never
refocus an already mounted Reader. `browser/reader.spec.ts` compares actual web
and native Markdown typography across themes in em of each body size, checks
scaled font sizes, the fixed reading column at several zoom levels,
Esc entry, reading-anchor restoration and live-page state preservation.

Rendered Markdown/Git and web Reader snapshots share the small capability-based
menu in `core/reading/reading-menu.ts`. Main owns native menu presentation,
clipboard writes and Google-search/new-tab navigation. A menu belongs to its
captured window, tab and navigation; hiding, closing or transferring that native
view invalidates its commands. Selection enables Copy and Search Google; HTTP(S)
links enable copying their address and opening a new tab. Select All and Find
operate on the addressed reading surface. Ordinary Markdown retains PDF export;
Git review does not export the current ordinary document by accident.

Non-Monaco context menus use `main/menu/menu-overlay.ts`, a themed native overlay
above live web/reader views. Compact rows follow the current app palette; nested
menus, disabled/checked items and keyboard navigation retain their actions.
Dismissal restores the originating WebContents, and Escape closes in main before
subsequent typing can be delivered to the menu. Chromium hit-test coordinates and
captured document/navigation guards still belong to the original surface.
Monaco keeps its own menu. `browser/menus.spec.ts` checks light/dark appearance,
immediate native typing after Escape and image/link command ownership.

Find follows the **visible surface**, not merely the tab's resource type.
Literal search uses Unicode case-insensitive matching with offsets in the original
text; lowercasing must not shift matches after expanding characters such as `İ`.
Rendered find excludes CSS-hidden text and ancestors, including `!important`
declarations. Static project indexing also excludes inline hidden declarations.
Reader Markdown export retains IDs on headings themselves as well as descendant
anchors. The preview reading-tools Electron tests and audit regression suite
cover these cases.

**Formulas in web Reader.** A page that draws mathematics holds each formula two
or three times: the drawing (styled spans hidden from assistive technology),
MathML, and the TeX it was written in. An extraction that keeps text prints the
copies side by side (`nn`, or a formula followed by its own source). Before
Readability or the Namu path reads the page copy, `core/browser/reader-math.ts`
(`carryMath`, serialized into the page like the Namu adapter) leaves one copy of
each formula:

- KaTeX (`.katex`, with its `.katex-display` wrapper), MathJax 2 (the
  `script[type^="math/tex"]` after the drawing) and MathJax 3 (`mjx-container`,
  with the TeX from MathJax's own list of what it drew) become
  `<span data-setdown-math="inline|display">TeX</span>`.
- MathML the page wrote itself, and MathJax 3 output with no TeX on record, stays
  `<math>`, without `annotation`/`semantics` and with a TeX annotation moved to
  `data-setdown-tex`.

Block ordinals are stamped before this step and are not touched by it. The shell
Reader draws TeX carriers with KaTeX after its sanitizer has run
(`renderer/browser/reader-math.ts`, loaded only for an article that has a
formula), with the options in `readerMathOptions`: untrusted TeX gets no command
that loads or links, and a formula KaTeX cannot read is shown as its source.
KaTeX's rules are confined to the Reader article by the same `@scope` as its
theme, because a notebook shows KaTeX's MathML, which those rules hide; only its
WOFF2 fonts ship in the renderer. The article is first shown with its formulas
drawn. Reader PDF export draws the same carriers in main with the style sheet
`scripts/build-browser.mjs` writes as `dist-electron/reader-math.css` (KaTeX's
CSS with its fonts inside, since the export page may load nothing), and loads
the page as a base64 `data:` URL. Reader Markdown export writes `$…$` and
`$$…$$`; MathML without TeX stays as markup. `core/browser/reader-math.test.ts`,
`scripts/browser/reader-math-css.test.mjs` and the formula test in
`browser/reader.spec.ts` (real KaTeX markup, the Reader, both exports) cover it.
MathJax and page-authored MathML are covered by unit tests on markup of the
shape those libraries write, not by a run of MathJax itself.

Local Markdown destinations encode path segments once. The pinned Crossnote
resolver adapter in `main/preview/render-worker.ts` interprets authored URL paths
before the filesystem hook encodes them for the resource protocol. Reader click
messages remove Crossnote's transport envelope exactly once; IPC then receives
an ordinary URL with its escaped filename, query and fragment preserved.
`preview-local-links.spec.ts` covers real image loading and document navigation
with `#` and `%` in filenames, as well as parent-relative links.

`core/reading/rendered-search.ts` retains Markdown's existing cross-inline text
range algorithm; `renderer/browser/rendered-find.ts` uses it for scoped Reader
highlights, counts, wrapping next/previous matches and scrolling. Native website
find is stopped on Reader entry and receives the current query on exit. Late
native find events cannot overwrite Reader counts. Search and Select All exclude
the export controls. Closing search focuses that same Reader, without revealing
or focusing its hidden native page. Keyed Reader mounts dispose highlights and
restore their tab's saved reading anchor.

Web page and web Reader find share a compact panel at the upper right of the
owning editor group, below the unchanged location bar. Ctrl/Cmd+F opens/selects
its query; counts use `current / total`, arrow buttons and Enter/Shift+Enter wrap
through matches, and Escape/close return focus to the same visible surface.
Composition does not submit partial text or dismiss the panel. The trusted native
panel stays above live website content without capturing, hiding, resizing or
replacing the page. App zoom and split geometry position only the panel; tab
switches hide it and navigation/close retire it. `browser/find.spec.ts` covers
native keyboard/pointer input, counts, composition, stable page/address geometry,
split ownership, app zoom and lifetime. `browser/reader.spec.ts` retains visible
article scope, hidden-page isolation, Reader focus and transition coverage.

Queued scroll/image callbacks and post-mount position/focus work must stop when
the Reader is unmounted; cleanup retains its stable element reference. Switching
from an image-bearing wiki Reader to a fallback article exercises this boundary.

Returning to a Reader tab restores the place the user last scrolled it to, exactly.
A reading anchor keeps its golden-line block at a height inside the viewport, so
it cannot express a view that has moved past a block starting above it: a cover
image taller than the reading offset, or text far below the last block that
carries an ordinal (Readability rebuilds paragraphs separated by line breaks as
new elements). `ReaderPosition.offset` holds that remainder in pixels; the live
page still receives the plain anchor. Only the user's scrolling publishes a
position. The scroll event of a restore is measured in whatever layout has loaded
so far and must not replace the place being restored, so a second visit cannot
drift, and restoring retries after the theme and late images until the user
scrolls. A position pending in the current frame is published before unmount.

The Reader owns the keyboard after a tab switch. Detaching the native page that
holds focus leaves no view with the keyboard, so `BrowserManager` hands focus to
the shell when a tab switch hides that page, and when a Reader tab is activated;
the Reader, editor or terminal shown in its place then receives the keys. Pages
hidden behind a shell overlay are left alone, because they return. `browser/reader.spec.ts`
returns to both article shapes repeatedly and sends native keys after a pointer
and a keyboard tab switch.

Web Reader exposes Export to Markdown and Export to PDF through its existing
native right-click menu. The reading surface has no export toolbar or overflow
button above or beside the article. The File menu's existing
PDF command addresses the active Reader too. `BrowserManager` retains the exact
validated article snapshot and document generation used by the reading surface.
`main/browser/reader-exporter.ts` opens an owned Save dialog, rejects obsolete or
transferred snapshots, and never replaces the active document. Conversion is
loaded on demand. `core/browser/reader-export.ts` sanitizes article HTML and uses
[Turndown](https://github.com/mixmark-io/turndown) with its
[GFM plugin](https://github.com/mixmark-io/turndown-plugin-gfm) to preserve headings,
section anchors, absolute links/images, lists, simple tables and fenced code.
Tables with merged cells retain sanitized HTML. Export includes the article title
and source URL. PDF prints the complete sanitized snapshot in a detached hidden
window with no page scripts or desktop bridge, using the existing printable
resource readiness check. Markdown image links remain remote references; this
export does not promise an offline image archive.

Markdown and Web Reader PDF exports paint the selected theme's background over
the complete A4 page, including the outer print margins on every page. The
shared `main/preview/pdf-exporter.ts` printer resolves the rendered snapshot's
body color and supplies a page-box background in the detached print window.
Content margins, pagination and selectable text remain intact; screen preview
styles and preparation are unaffected. `preview/pdf-export.spec.ts` reopens the
saved PDF bytes in the real PDF reader and checks all pages' corner/edge pixels,
page proportions and first/last selectable text in tinted light, dark, imported
and white themes. PDFs and rendered page images are retained as test artifacts.

`core/browser/namu-reader.ts` is an extraction adapter limited to `namu.wiki` and
`www.namu.wiki` `/w/` articles. Public HTML inspected on 2026-10-15 for
[Markdown](https://namu.wiki/w/Markdown) and
[키스 길](https://namu.wiki/w/%ED%82%A4%EC%8A%A4%20%EA%B8%B8) uses changing hashed
classes, semantic section anchors and nested `div` paragraphs. The adapter finds
the common section root, removes empty scaffolding and editing controls, converts
leaf content divs to paragraphs and preserves tables, lists, anchors, footnotes
and expanded details. All inline SVGs and identifiable SVG image sources
(`.svg`/`.svgz` URLs or SVG data URIs) are removed from the stamped clone before
either wiki extraction or the Readability fallback. SVG responsive candidates
are removed while raster fallback images remain. The same filtered snapshot
feeds the Reader and Markdown/PDF export; the live page stays intact.
Extraction mutates a clone only. Extraction and live-page
restoration share the same block coordinate system; absent semantic structure
falls back to Readability. This does not bypass an unavailable or blocked page.

The three reading-capability scenarios in `test/e2e/browser/*.spec.ts` exercise native
right-click input and clipboard/Google commands, local Markdown PDF, visible
Reader search without hidden-page find, the absence of reading-surface buttons,
right-click Markdown/PDF commands alongside File PDF,
tab preservation, and hashed Namu-layout extraction with real double-click
restoration. The Namu case checks inline/file/data-URI SVG removal, retained
raster images and filtering through the Readability fallback. HTTPS fixtures use Playwright request routing on actual Electron
WebContents; the Namu fixture asserts that it was served rather than accidentally
loading a public page. Export sanitization and menu capability unit tests are
included in the focused gate. Existing preparation, IME, position and visual
checks remain required.

Saved Python and C/C++ documents add language support to the existing Monaco model; they
do not replace the ordinary/Working Tree buffer or its Undo history. The language
client is loaded only for a saved supported model. Bundled Pyright and installed
clangd processes are scoped to window, server kind and root. Markdown-only use starts no language
server. Save As reconnects the file URI without replacing the model; immutable
history/staged models are not language documents. Incremental changes preserve
UTF-16 positions and simultaneous edit ordering, and diagnostic/response delivery
checks the current connection and document version.

Language failure must leave editing and saving usable. Closing the last document
releases its server; restart resends the current unsaved text, and window/app exit
waits for child cleanup with a kill deadline. Rename opens affected files through
normal document ownership and validates versions before applying text edits; Undo
remains per file. The language client/manager/session unit tests and real
`language-support.spec.ts` and `clangd-support.spec.ts` cover these boundaries, including completion-widget
Escape, cross-file navigation, rename/Undo, Save As, Working Tree sharing, crash
recovery and child-process reaping. Packaged-app smoke tests also require actual
Python diagnostics from the unpacked bundled server. These small-project checks
do not establish large-project indexing or completion-latency guarantees.

clangd owns compilation database and `.clangd` interpretation. Setdown supplies
UTF-16 capabilities and registers only negotiated providers/triggers, including
omitting completion resolve when unsupported. The C++ tests use actual clangd,
compile commands, include paths, defines, unsaved diagnostics, rename/Undo and
header navigation. Missing-executable recovery uses the native chooser and a
persisted absolute path. A timed-out UI request must cancel only that request;
the existing crash/shutdown cleanup and bounded outstanding-request limit remain.
Both the full unit suite and preview gate require `clangd` on PATH or an absolute
`SETDOWN_CLANGD_PATH`; absent clangd fails these checks rather than skipping them.

Ordinary and Git source editors use fixed-position Monaco overflow widgets.
First-line LSP hovers may extend over the surrounding chrome without being
clipped by editor-group or source-surface containers. `clangd-support.spec.ts`
checks real include hovers in ordinary, lower split and Working Tree editors,
including hit testing at all four corners and retained screenshots. DOM
visibility alone does not establish that the complete popup is displayed.

Monaco documentation hovers in ordinary, Git and notebook editors share the
context menu's balanced native-overlay cover. They retain Monaco's original
position and dimensions, including when extending across a split into a native
browser or reader pane. The existing capture covers that pane while the hover is
open; dismissal restores the same native view and unsaved content. The adapter
observes only Monaco's overflow-widget container and releases its cover on model
replacement or editor disposal. `browser/menus.spec.ts` checks actual OS pointer
input over the adjacent browser, MDN link clicks, hover-to-menu handoff, and
restoration of page/input identity for ordinary and notebook editors.

Language support now uses declarative server definitions and a persisted registry.
The Language Support activity below Browser, `Edit → Language Support…`, and F1
open the same lazy sidebar; the Setdown Folder Tools button retains its meaning.
The sidebar uses normal workspace geometry, without the native-overlay capture
lifecycle. Web content remains live and keeps its identity and unsaved inputs.
Keyboard/IME input belongs to the sidebar while its controls are focused; Escape
must not enter reader mode. `test/e2e/browser/*.spec.ts` covers advancing native page frames,
zero visibility changes, and preserved inputs while the sidebar is open.
Catalog browsing starts no process. Undetected but discoverable servers appear in
the fourth **Available servers** group and remain searchable alongside installed
servers. Missing saved connections and failed sessions stay repairable. Only
entries without discovery metadata are omitted; they remain available through
the explicit manual-add flow. The discovery-capability flag is separate from
installation presence and connection-profile availability.
`language-presentation.test.ts` and `language-registry.spec.ts` cover filtering,
status/source distinctions, manual creation/import/removal, and sidebar focus.
Configuration changes reconnect only models served by affected servers, without
changing text or Undo, including models first acquired by Working Tree. One primary server is selected
per language; settings changes are user-wide while explicit restart is window-local.
Legacy clangd executable selection is retained. `server-registry.test.ts` and
`language-registry.spec.ts` cover registration, persistence, routing, native choice,
Full/Incremental/None negotiation, save snapshots, initialization/settings and
reconfiguration with Undo. Versioned push diagnostics still require an exact
model version. Versionless push diagnostics are now explicitly best-effort:
receipt is stamped with the main process's observed document version and the
renderer rejects it if it has already advanced. They are cleared on edits; this
does not prove the server analyzed the latest text and must never authorize an
edit. This supports servers such as fortls that omit versions. Pull diagnostics
use the requesting model/generation/version, debounce changes, retain result IDs
and handle refresh and unchanged reports. Supported dynamic registrations honor
document selectors and are removed on unregister/session close. The real Rust integration test in
`test/language-servers` is a separate explicit toolchain gate; see
[language support](../language-support.md). All existing Python/clangd, native-preview,
focus/IME and comparative latency checks remain required.

Semantic tokens, inlay hints, navigation, formatting and code actions attach to
the same owned Monaco model through per-document providers. They must not create
a second text store, make immutable Git revisions editable, or change reader
preparation. Semantic token deltas validate their base, array bounds and tuple
length; a corrupt delta triggers one full-token fetch. Refresh and provider
disposal retire their caches. Optional Code Lens and format-on-type start disabled;
inlay hints are shown on modifier-key request unless explicitly toggled.

Text workspace edits validate every target before mutation, preserve ordinary
dirty state and per-file Undo, and reject resource operations and annotations.
Server-issued commands and resolvable items retain main-owned, expiring handles;
renderer-supplied command arguments cannot replace the original server payload.
Disposed completion commands have a bounded grace lease for the post-insertion
callback: one document change and at most 30 seconds. A later change, session
close or lease expiry retires them. When memory is needed, disposed commands are
reclaimed before rejecting a new reply; visible results retain their handles.
The server-item tests retain command execution after completion disposal and
check that unused commands cannot exhaust the active-result budget indefinitely.
Unsolicited `workspace/applyEdit` is rejected outside an owned user command or
Explorer operation. Save preprocessing skips initializing/failed servers, bounds
`willSaveWaitUntil`, and rejects edits for a superseded buffer. Explorer will/did
notifications use both static and dynamic filters and report actual completed
filesystem operations. The feature fixture covers formatting/Undo, raw diagnostic
quick fixes, command/applyEdit into an unopened file, lazy symbols, hierarchy,
visible semantic colors/inlays and Explorer rename/refactor/Undo in real Electron.
The clangd gate also exercises actual server formatting with `.clang-format`.

Bundled Pyright's initial source enumeration is asynchronous. Its first rename
waits for its first analysis diagnostic rather than interpreting initialization
as project-index readiness; cancellation/timeout must not later send the edit.
The unchanged unopened-file rename scenario verifies this without a test sleep.
This profile retains push diagnostics; generic pull remains covered separately.
Legacy numeric Full/Incremental synchronization includes `didSave` without text,
as in the reference client; numeric None remains unsynchronized. The explicit
fortls gate now checks a duplicate-declaration diagnostic after actual disk save.
See [language support](../language-support.md) for feature entry points, server
compatibility and deliberately unadvertised capabilities.

Native-server discovery is lazy and separate from editor-model creation. Static
routes, Markdown-only reading, PDF and web browsing start no environment query.
The first native LSP connection or explicit Rescan may resolve a bounded user
shell environment; an activated Python environment remains inherited. Catalog
browsing checks files but starts neither metadata helpers nor language servers.
Discovery passes its selected absolute executable and environment together to the
existing session and checks ownership/configuration after asynchronous work.
If no installation is available, an eligible enabled profile may prepare its
package asynchronously through the separate Zed host. Package discovery and
installation do not replace models or block source editing or saving. When
preparation finishes, ownership, configuration and document generation are
checked again before sending the latest revision. User-selected installed-only
connections and explicitly disabled providers retain their choices. Runtime
language metadata and grammar registration follow the same revision and model
ownership guarantees. Zed settings inheritance is covered by the nested project
YAML scenario in the syntax suite.

Default automatic profiles can return a quiet unavailable state. Editing and
saving continue, without queueing unbounded changes for a missing server. Rescan
retries unavailable/failed bindings with the latest model contents; healthy
connections and their process IDs survive repeated scans. Manual executable
choices and explicit disable settings survive discovery and settings updates.
`server-discovery.test.ts`, the client/manager tests and
`language-registry.spec.ts` cover these guarantees, including installation after
opening a document and unrelated configuration changes. The separate real-server
gate adds fortls auto-connection, hover/completion and Rescan.

Language discovery now covers the whole offline catalog. Pinned Helix definitions
are normalized into main-process connection profiles; the renderer receives only
enabled associations. Exact names, specific path globs, case-sensitive and compound
suffixes retain their routing precedence. Bundled Python and explicit choices win;
otherwise one installed primary connects, and several installed alternatives wait
for selection. Disabled settings and older custom profiles keep their identities.
A healthy session remains on its selected server across scans. Configuration
invalidation uses the actual connected server, not a missing route alternative.

Catalog reads share directory/package caches and use at most eight metadata
workers; they never execute candidates. An eligible document or explicit Rescan
may query the installed npm CLI's global root through Node with fixed arguments,
in addition to the existing shell/Python metadata. npm bin mappings resolve a
script and runtime without invoking shell wrappers or installation recipes.
All metadata subprocesses retain cancellation, timeout and output limits.
Unprofiled entries can reuse a main-owned detected candidate when a user supplies
the missing connection data. No workspace-local command or package discovery is
introduced. Generated writing/auxiliary profiles remain opt-in, preserving the
Markdown-only no-LSP guarantee. Profile/routing/discovery/manager/client tests and
the npm TypeScript fixture in `language-registry.spec.ts` cover these boundaries.


### Markdown find placement — 2026-11-05

Markdown find uses the same trusted native floating panel as web find. Opening,
closing or typing in the panel must leave the preview's full bounds, scroll
position (until selecting a match), content and native view identity intact.
There is no full-width reserved strip above the document. The panel stays inside
the focused reader group, excluding the outline; split/zoom changes reposition
it. Escape is IME-safe and restores focus to that reader. Source/tab changes hide
the panel and stale panel actions cannot search a different tab.
`preview-reading-tools.spec.ts` and `preview/find-overlay.spec.ts` verify native
bounds, reading position, focus, counts, split/zoom placement and lifetime.

Reader Ctrl+A/Cmd+A, the application menu and the reading context menu all
select only the active article's content. Selection must exclude sibling
terminals, other reader groups, location bars and application controls. Native
web pages and find inputs retain their own selection target; address fields and
terminal readline Ctrl+A keep their normal behavior.
`browser/reader-selection.spec.ts` exercises DOM and native keyboard input,
menu selection, clipboard-visible ranges, sibling terminals and live pages.

### Office and Hangul documents — 2026-11-14

Word (`docm`, `dotx`, `dotm`, `doc`, `dot`; `docx` see below), Excel (`xlsx`, `xlsm`,
`xltx`, `xltm`, `xlsb`, `xls`, `xlt`), PowerPoint (`pptm`, `potx`, `potm`,
`ppsx`, `ppsm`, `ppt`, `pot`; `pptx` see below) and Hangul (`hwp`, `hwpx`) files open as read-only
`office` documents in an ordinary media tab. `core/document/document-profile.ts`
owns the extension families; OpenDocument and delimited text keep their previous
routes. Main sends metadata on open and the whole file (at most 128 MiB) through
`office:read` only to the window that owns the tab, and only for the disk version
the tab was opened with. No text model, Markdown preview or save path exists for
these documents: Save and Save As leave the file untouched, and they cannot
become text save destinations.

`renderer/office/office-runtime.ts` is the only importer of
flyfish-dev/file-viewer. Each family loads its renderer and parsing Worker on
first use, so startup and other surfaces do not load them. Exactly one renderer
is active per document, with no automatic renderer discovery. The viewer's
download, print and HTML export actions are disabled in the reader; saving as PDF is
Setdown's own action ([Office documents as PDF](#office-documents-as-pdf--2026-11-21)). `OfficeSurface.svelte`
creates and destroys the viewer with the media cache entry.

Document content is untrusted. A link inside a document never navigates the
shell or opens a child window: `http(s)` links open a Setdown browser tab through
`document:open-link`, in-document bookmarks stay with the viewer, and every other
target is ignored. Word keeps the viewer's default block on external links and
linked resources. Independently of any surface, main denies child windows and
navigation away from the shell page for every application window
(`main/windows/window-manager.ts`).

The tab zoom owns zoom: its buttons and Ctrl+wheel scale the document relative
to the viewer's own initial fit, and the viewer's zoom gestures are off. Find
(Ctrl/Cmd+F and the menu) focuses the viewer's search field in the focused group.
Word, Hangul and spreadsheet documents restore their scroll ratio (and active
sheet) across tab eviction and restart; only scrolling that follows real input
is recorded, so reopening does not drift the stored position. Slide decks reopen
at the first slide. Theme changes re-render in the app's light or dark
appearance at the current position.

**Metafile pictures.** File Viewer draws an EMF picture (in a presentation, a
legacy PowerPoint file or a legacy Word file) as SVG with a converter of its own.
Setdown corrects that converter when the application is built
(`scripts/office-metafile-patch.mjs`, wired in `vite.config.ts`; the dev server
serves the same corrected code), so a path is built as GDI builds it:

- the lines and curves between a `MoveToEx` and a `CloseFigure` are one figure
  (`LineTo`, `PolylineTo`, `PolyBezierTo`, and `ArcTo` where the copy reads it);
- a figure that follows a `MoveToEx` starts there, and one that follows a
  `CloseFigure` or a figure of its own (`Polygon`, `Rectangle`, …) starts at the
  current position;
- only the records that continue from the current position move it; `Polyline`,
  `Polygon` and `PolyBezier` do not.

As published, the converter started a sub-path at every `PolylineTo` and
`PolyBezierTo` record and filled each piece by itself, so a logo exported from a
drawing program (move, lines, curves, close) came out as slivers. The correction
changes nothing else: records the converter does not read (`PolyDraw`,
`AngleArc`, gradient fills, and the arc records outside the legacy PowerPoint
copy) stay unread, and a path selected as a clip region still does not clip.

`office-file.test.ts`, `text-files.integration.test.ts`,
`reading-position-store.test.ts` and `media/office-reader.spec.ts` cover routing,
bounded version-checked reads, the read-only boundary, zoom, find, every family in
real Electron, link containment and position restoration.
`metafile-outlines.test.ts` runs the four corrected converters on a metafile of
such outlines and compares each figure; `media/office-reader.spec.ts` opens a
presentation with that metafile and reads painted and clear points back from the
slide.
`scripts/office-viewer-notices.test.mjs` covers the bundled license notices.

### Office documents as PDF — 2026-11-21

Every Office family can be saved as a PDF: the address bar of an Office tab has a
Save as PDF button, and File → Export as PDF… is enabled for these documents (not in
Git review). The save dialog proposes `<name>.pdf` beside the document. The document
itself stays read-only and byte-identical; Save and Save As are still unavailable.
The exceptions are a `.docx` open in the Word editor and a `.pptx` open in the
presentation editor: the PDF is still made from the
file on disk, so a document with unsaved edits is not exported. An alert asks for a
save first, and no save dialog opens (`renderer/workspace/document-actions.ts`).

`main/documents/office-pdf-exporter.ts` reads the file again for the disk version the
tab holds and renders it in a hidden window of its own: session partition
`office-export`, sandboxed, with a preload (`office-export-runtime/preload.ts`) that
offers only the job and its completion. That window is never shown or focused, is
destroyed when the PDF is printed or the export fails, and its session cancels every
request that is not `file:`, `data:`, `blob:` or the app's own dev server, so saving
a PDF fetches nothing a document names. Exports run one at a time; one document has
at most one export under way, during which its button is disabled and labelled
Saving PDF…. The reading tab keeps its selection, position and focus throughout.
A document that cannot be rendered, a file that changed on disk, a cancelled dialog
or a closed window writes no file; failures are reported in an alert.

The PDF is laid out for paper, not copied from the screen: light appearance, no
zoom, every page.

- **Word.** DOCX is paginated by the viewer (`docx.visualPagination`) into the
  document's own sheets, including mixed sizes and orientations, with margins,
  headers and footers on each. Page breaks Word stored from its last layout are
  ignored (`ignoreLastRenderedPageBreak`), because honouring them with other fonts
  leaves alternating half-empty pages; the page count can therefore differ from
  Word's. Legacy `doc` is one flowing column on A4 whose margins are repeated on
  every sheet.
- **Slides.** One slide per page, the page exactly the slide's size. PPTX keeps
  selectable text; a legacy `ppt` slide is the picture the viewer draws of it.
- **Hangul.** The stated paper size, with the page margins on every sheet and placed
  pictures where the reader shows them.
- **Workbooks.** The viewer draws sheets on a canvas and cannot print them, so
  `renderer/office/spreadsheet-print.ts` lays out tables from the same parsed model
  (`@file-viewer/renderer-spreadsheet/worker/sheetjs`): every visible sheet from a new
  page, trimmed to its content, with column widths, row heights, merged cells, cell
  formats, rich text, pictures and charts. A sheet wider than upright A4 turns the
  paper, then shrinks to fit the width down to 50%; beyond that its columns continue
  in further bands (down, then over). More than 400,000 cells are refused rather than
  laid out. Charts reuse the viewer's internal SVG chart renderer through the
  `@file-viewer-spreadsheet-chart` alias in `vite.config.ts`; that path must be
  re-checked when the package version changes.

`renderer/office/office-paper.ts` holds the paper rules the viewer's print output
lacks (slide-sized pages, per-sheet margins for flowing text) and depends on the
viewer's class names as of 3.3.3. `office-runtime.ts` stays the only importer of the
library.

`media/office-pdf-export.spec.ts` saves real documents of every family in Electron and
reads the PDFs back in the PDF reader: page count and shape, complete text in order,
clear margins on every page, one slide per page, placed pictures, the hidden offline
window, focus, cancel and failure, and unchanged sources. `spreadsheet-print.test.ts`
covers the sheet plan (orientation, scale, bands, hidden tracks, trimmed range).

Since 2026-11-28 a `.docx` that really is a Word document and a `.pptx` that really
is a presentation are the exceptions to "read-only": they open in the Word editor and
the presentation editor described next. Every other format above, including `docm`,
`dotx`, `dotm`, `doc`, `dot`, `pptm`, `potx`, `ppsx` and `ppt`, and any file that is
only *named* `.docx` or `.pptx`, keeps this viewer and this section's guarantees
unchanged.

### Word document editing — 2026-11-28

The editor was first added on 2026-11-15 and removed the same day. It is back with
the engine at 2.41.1 and the font supply described under **Fonts** below, which the
first version lacked: Korean text was then measured by estimate and drawn by whatever
face the browser picked.

A `.docx` file is still an `office` document in an ordinary media tab, with the
same 128 MiB bound, version-checked read, tab zoom, `Ctrl/Cmd+F`, link containment
and scroll-ratio reading position as the viewer above. There is still no text
model: these documents cannot be opened, saved or chosen as a destination through
the text save path.

**The name is not enough.** A spreadsheet, a legacy binary document or a web page
can be named `.docx`; the engine would show such a file as an empty page that a
save would write over the data. When main reads the document's metadata
(`main/documents/office-file.ts`) it checks the bytes: a ZIP archive whose
`[Content_Types].xml` declares a Word main document part that is present
(`officePackageProblem` in `main/documents/office-package.ts`). Only then does the
snapshot carry `officeEditor: 'word'`, and every decision follows that mark
through `isWordEditorDocument` (`core/document/document-capabilities.ts`): which
surface `App.svelte` mounts (`renderer/docx/DocxSurface.svelte`, otherwise
`OfficeSurface.svelte`), the content owner, the media-cache key, Save and Save As
in the menu, and undo routing. A reload re-reads the verdict, so a file that
becomes, or stops being, a Word document changes surface in the same tab. The
bytes handed to the engine (`docx-edit:open`) are checked again, and a save is
checked a third time before anything is written.

`renderer/docx/docx-runtime.ts` is the only importer of eigenpal/docx-editor
(`@docx-editor.dev/core`, `@docx-editor.dev/fonts` and `@docx-editor.dev/fonts-cjk`;
the code is Apache-2.0 and the font files carry their own open licenses). It loads
with the first Word document, never at startup. The engine's separately licensed
Pro packages (tracked changes, comments, charts, PDF export, automation, telemetry)
are not installed and must not be added: their license forbids distribution.

**Fonts.** The engine measures and paints text from font bytes it is given; it
cannot see the fonts installed on the machine, and text in a family it has no bytes
for is measured by estimate and drawn by a face the browser picks. Fonts are
therefore offered in this order, and the first answer for a face wins:

1. **Fonts installed on this machine.** Main builds an index of the installed font
   files once per run (`main/documents/system-fonts.ts`: `fc-list` on Linux, the
   platform font directories otherwise) from each file's own name tables
   (`core/fonts/font-file.ts`), and hands the renderer the files for the faces a
   document names (`docx-edit:fonts`). A family name from a document is only ever a
   key into that index; it never becomes a path. A family matches under any of its
   names, so `맑은 고딕` and `Malgun Gothic` are the same family. A face is stated as
   what it is: a family with no bold or italic face answers with its regular one and
   the engine thickens or slants it. Variable fonts and files above 64 MiB are not
   offered, because the engine takes neither; one document takes at most 96 MiB of
   installed font files.
2. **Packaged substitutes** for the Latin Word fonts (Carlito for Calibri, Liberation
   for Arial, Times New Roman and Courier New, and so on).
3. **The packaged pan-CJK face** (Noto Sans CJK JP), for East Asian text nothing above
   covers.

**Korean families that are not installed** — the families of Windows, Microsoft
Office and Hancom Office, such as 맑은 고딕, 바탕, 굴림, 돋움, 궁서, the HY and 휴먼
families and 함초롬 — are drawn by an installed Korean family of the same class:
a gothic by a gothic, a myeongjo by a myeongjo, and the other class only when the
machine has none of its own (`core/fonts/korean-fonts.ts`). The stand-in is declared
to the engine as a substitution that keeps the line box Word gives the missing
family (1.729 em for 맑은 고딕; 1.3 em is assumed for the others), so lines and pages
do not follow the stand-in's own metrics. On a machine with no usable Korean font,
and for a family the byte budget left out, the packaged pan-CJK face is the last
resort: every Korean family that nothing earlier draws is mapped onto it and keeps
the same line box (`koreanLastResort` in `renderer/office-edit/font-supply.ts`). The
engine's own rule covers four Korean families only and uses the face's line
(1.448 em). The class is not kept there: the packaged face is a gothic.

**Italic and bold without a face.** No Korean font has an italic face, and many have
no bold one. The engine then registers the regular face and leaves the slant and the
thickening to the browser, so the pages must allow synthesized styles: the
application's own `font-synthesis: none` (`renderer/style.css`) is reset on the Word
pages (`DocxSurface.svelte`). Without that reset italic text is stored as italic and
drawn upright.

The document's font names are never rewritten: the stand-in exists only in this
session's layout, and a saved file names the fonts it named when it was opened.
Nothing is requested from another origin, and a font that cannot be read or that the
engine refuses only leaves its family to the next step above.

**Shown once.** Fonts arrive after the document is parsed, and the engine moves every
line when they land. The pages stay hidden and the surface is not `ready` until the
engine reports that the text is laid out in its own fonts (at most eight seconds), so
the first layout a reader sees is the one that stays. A font that arrives later, for
text typed in a new family, never hides the pages again. A fallback face that a later
page turns out to need (a symbol or mathematics font) can still move lines on that
page shortly after opening.

A document opens for **reading** (`mode: 'view'`): input on the pages changes
nothing. **Edit document**, or a double click on the pages, enters editing; **Done**
or `Esc` returns to reading, as for Markdown. `Esc` during an IME composition, or
one the engine consumes itself (leaving a header, a footnote or the format
painter), does not leave editing. Unsaved edits stay in the tab in either mode.

`renderer/docx/docx-sessions.ts` owns one engine per open Word document, as a
workspace content owner beside notebooks and images. A surface only mounts and
unmounts that engine, so edits, undo history and the editing mode survive tab
switches, media-cache eviction, memory reclamation, saves and Save As. An unedited
session is freed shortly after its surface is unmounted and read again from disk
when it is next shown; an edited one is kept until it is saved, discarded or
closed, and its tab is protected from memory reclamation. The media-cache key of
an editable Word document deliberately excludes the disk version, so a save does
not remount the surface or move the caret.

Reading the engine can commit input it was still holding. `DocxSurface.svelte`
therefore reads engine state only when the engine notifies, never from a template
expression or a derived value, and a listener that throws never unwinds into the
engine.

**Saving.** Save, Save As, the close prompt, Save All on window close and the
toolbar buttons all go through the same content owner. The renderer serializes
the whole package; `main/documents/office-edit-ipc.ts` accepts it only for a `.docx`
that is open in the requesting window, at most 128 MiB, and only if it still is a
Word document package by the same check. `main/documents/office-package.ts` writes and
syncs a sibling temporary file, replaces the document with one rename, keeps its
mode, and refuses when the destination
is not the disk version the tab was editing; the writer then reloads or uses
Save As. A save in place is not reported back as an external change. Save As adds
`.docx` to a bare name, refuses other extensions and never replaces a file open
in another tab. Input the engine commits as a save starts counts as saved; edits
made while the file is written stay unsaved. There is no auto save for Word
documents.

**Other applications.** A changed file reloads an unedited document. An edited one
shows the external-change notice instead; Save then fails without touching the
file, **Reload** asks before dropping the edits, and **Keep My Changes** only
dismisses the notice (Save As remains the way out).

**Recovery.** Unsaved Word edits are part of the workspace recovery snapshot as a
serialized package (24 MiB limit shared with other content). Serialization waits
for a typing pause, at most ten seconds. Restoring writes a separate
`Recovered-document.docx` and never the original file.

**History and commands.** The engine keeps its own undo history: `Ctrl/Cmd+Z`,
`Ctrl/Cmd+Y` and the Edit menu (`office:undo`/`office:redo`) reach it; text fields
keep their own. A tab with unsaved Word edits cannot be dragged to another group
or window, because the edits live in this window's engine.

**Links.** A click on an external `http(s)` link opens a Setdown browser tab at
once while reading; while editing, the click places the caret and the link is
offered in a small panel. Nothing else navigates, as for every Office document.

`office-package.test.ts`, `docx-sessions.test.ts`, `media-cache.test.ts`,
`office-file.test.ts`, `editor-tools.test.ts` and `media/docx-editor.spec.ts` cover
package validation, the content verdict for misnamed files, the atomic
version-checked write, ownership checks, session lifetime, read-only reading,
zoom, find, editing with toolbar formatting and undo, Korean composition, Save and
Save As, the close prompt, eviction with unsaved edits, external changes, position
restoration, links, crash recovery, Copy with and without a selection in both modes
and the PDF export of unsaved edits in real Electron. `font-file.test.ts`, `system-fonts.test.ts` and `renderer/office-edit/font-supply.test.ts`
cover what a font file says about itself (family names per language, linked bold,
collections, variable faces, damaged files), the installed-font index, Korean
stand-ins by class with their line boxes, names as keys only, the byte budget and
the last-resort mapping onto the packaged face; `media/docx-editor.spec.ts` checks in
real Electron, on machines whose installed fonts are exactly the shipped font files
(with and without the pan-CJK one), that a missing Korean family keeps Word's line,
that nothing moves after the document is announced, that a save keeps the font
names, and that italic and bold change the painted pixels of a family whose only
face is a regular one. `scripts/office-viewer-notices.test.mjs` also checks that the engine's
packages are pinned to one release, that no Pro package is installed, and that
the engine and font licenses are in `dist-electron/OFFICE-VIEWER-NOTICES.txt`.

### Presentation editing — 2026-11-28

A `.pptx` file is an `office` document in an ordinary media tab like every other
Office file, with the same 128 MiB bound, version-checked read, tab zoom,
`Ctrl/Cmd+F` and link containment, and still no text model. When main reads the
document's metadata it checks the bytes as it does for Word
(`officePackageProblem(bytes, 'presentation')` in `main/documents/office-package.ts`:
a ZIP archive whose `[Content_Types].xml` declares a presentation main part that is
present). Only then does the snapshot carry `officeEditor: 'presentation'`, and
`App.svelte` mounts `renderer/pptx/PptxSurface.svelte`; a file that is only named
`.pptx` stays in the viewer, and a reload re-reads the verdict. `core/document`'s
`officeEditorOf` and `renderer/office-edit/office-editors.ts` are where code asks
"which editor owns this tab" for either editor.

`renderer/pptx/pptx-runtime.ts` is the only importer of eigenpal/pptx-editor
(`@pptx-editor.dev/core`, Apache-2.0). It loads with the first presentation.
`pptx-sessions.ts` keeps the engine, its edits and its undo history for the tab,
like the Word sessions it shares a base with (`office-edit/edit-sessions.ts`).

**Reading.** Every slide is in one vertical list, drawn by the engine; the engine
paints the slides in sight first and repaints a slide only when asked again, so
the surface asks for every slide after each change. Tab zoom scales the slides.
Find counts matches over the whole deck and marks the slide of the current one.
A click on linked text follows it: `http(s)` opens a Setdown browser tab, a link
to a slide scrolls to it. A double click enters editing on that slide with the
caret at the clicked point, as in a Word document; **Edit presentation** starts at
the slide in the middle of the view. Input changes nothing while reading.

**Editing.** The list becomes a rail beside the engine's stage. The toolbar has
undo and redo, font size, bold, italic, underline, strikethrough, four alignments,
bulleted and numbered lists with indent, and adds a text box, a shape (rectangle,
rounded rectangle, ellipse, triangle, block arrow, line, arrow), a 3 × 3 table, a
picture file (PNG, JPEG, GIF) and slides (new, duplicate, delete). The engine puts
a new object at the centre of the slide and selects it; a new text box holds the
caret. `Esc` returns to reading in one press from anywhere in the stage: the
surface takes it before the engine, whose own `Esc` steps (text, shape, nothing)
would ask for three. `Esc` during a composition belongs to the input method, and
in the find field it closes find. The slide has the keyboard as soon as editing
starts, and the list has it again on return. `PageUp`/`PageDown` change slide when
no text is being edited. The stage follows the tab zoom by the size of the
engine's host element, so the engine's own fit gives the exact ratio.

**Saving, other applications, recovery, PDF** follow the Word editor through the
same code: one content owner, `office-edit-ipc.ts` and `office-package.ts`
(`.pptx` only, the content check repeated before a write, an atomic
version-checked replace, Save As to a bare name, no auto save), the
external-change notice, a recovery snapshot restored as `Recovered-document.pptx`,
and a PDF made from the file on disk only once edits are saved. One difference is
the engine's: it writes **every XML part again** on save. Parts it did not edit
keep their content; their bytes change wherever the file spelled XML another way
(an empty element becomes self-closing, the declaration gains `standalone`, line
breaks between elements go). Pictures and other binary parts are unchanged.

**History.** `Ctrl/Cmd+Z`, `Ctrl/Cmd+Y` and the Edit menu reach the engine's
history. The engine takes typing through a textarea of its own inside the stage,
so "a focused text field keeps its own history" excludes fields inside
`[data-office-pages]`.

**Fonts.** The supply is the Word editor's (`office-edit/font-supply.ts`:
installed fonts by index, the packaged Latin substitutes, the packaged pan-CJK
face as the last resort for Korean). Two things differ. The engine takes
single-font files only, so a face inside a collection is extracted to a file of
its own (`core/fonts/font-collection.ts`). And a line is 1.2 × the font size
whatever the face, with the baseline from the engine's own table of families; a
substitution's line metrics are not read, so no line box is declared and a
Korean stand-in does not move lines.

**Shown once.** Fonts arrive after the deck is parsed, in two steps: the engine
gets the font files, then hands their faces to the browser and lays the deck out
again when the browser has loaded them. The engine brings a slide picture that is
already painted up to date only when the browser is idle. The deck is therefore
announced (`data-office-ready`) only after both steps, eight seconds at most, and
the surface asks for no slide picture before that, so a deck never opens showing
its text in a stand-in face first.

**Known limits** of the engine at 0.8.0: a chart and an embedded object are drawn
as a placeholder box (their parts are kept on save), and a placeholder filled only
through its style reference (`p:style`) is drawn without that fill.

`office-package.test.ts`, `pptx-sessions.test.ts`, `font-collection.test.ts`,
`font-supply.test.ts` and `media/pptx-editor.spec.ts` cover the content verdict,
the session lifetime, face extraction, and in real Electron: reading (list, tab
icon, zoom, find), editing with undo from the keyboard and the Edit menu, saving in
place with every other part's content kept, Korean composition, `Esc` and the
double click, Save As and the close prompt, eviction with unsaved edits, external
changes, position restoration, links, crash recovery, toolbar formatting and every
insertion, the packaged Korean face on a machine with no Korean font, an EMF
picture, the PDF export of unsaved edits and a file that is only named `.pptx`.
`media/office-reader.spec.ts` keeps the viewer's presentation checks on a slide
show (`.ppsx`).
