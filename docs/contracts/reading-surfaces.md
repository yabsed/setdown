# Reading surface contract

These guarantees remain part of the maintained preview performance contract.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Reading surface capabilities

Rendered Markdown/Git and web Reader snapshots share the small capability-based
menu in `core/reading/reading-menu.ts`. Main owns native menu presentation,
clipboard writes and Google-search/new-tab navigation. A menu belongs to its
captured window, tab and navigation; hiding, closing or transferring that native
view invalidates its commands. Selection enables Copy and Search Google; HTTP(S)
links enable copying their address and opening a new tab. Select All and Find
operate on the addressed reading surface. Ordinary Markdown retains PDF export;
Git review does not export the current ordinary document by accident.

Find follows the **visible surface**, not merely the tab's resource type.
`core/reading/rendered-search.ts` retains Markdown's existing cross-inline text
range algorithm; `renderer/browser/rendered-find.ts` uses it for scoped Reader
highlights, counts, wrapping next/previous matches and scrolling. Native website
find is stopped on Reader entry and receives the current query on exit. Late
native find events cannot overwrite Reader counts. Search and Select All exclude
the export controls. Closing search focuses that same Reader, without revealing
or focusing its hidden native page. Keyed Reader mounts dispose highlights and
restore their tab's saved reading anchor.
Queued scroll/image callbacks and post-mount position/focus work must stop when
the Reader is unmounted; cleanup retains its stable element reference. Switching
from an image-bearing wiki Reader to a fallback article exercises this boundary.

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

