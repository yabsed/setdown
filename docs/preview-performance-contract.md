# Preview performance contract

This is the maintained contract behind `57729a8b0c738aa7ed4580408cbaedde1f6d5fd2`
and `d77e6526e89d009ef12842d133ac27a43b84d607`. Those commits optimize math-heavy
Markdown, particularly the first two Esc → double-click cycles. Correct-looking
output alone does not establish that this contract still holds.

Paths below are relative to `apps/desktop`. The actual fixture is
`test/fixtures/sample.md` (not `test/e2e/fixtures/sample.md`). The candidate harness
copies this same fixture into both applications' temporary projects. Electron,
Crossnote and CSS changes are in scope
even if no preview TypeScript changes.

## Guarantees and ownership

| Guarantee and reason | Implementation owner | Required coverage |
| --- | --- | --- |
| A never-shown view must have a positive Blink viewport before preparation. Native `setBounds` alone can leave Blink at 0×0. Keep the desktop viewport override across show; natural DPR/zoom must survive. | `src/main/preview/preview-preparation.ts` owns readiness/cache invalidation; `preview-manager.ts` owns navigation and visibility. | `preview-presentation.test.ts`; real `document-preparation.spec.ts`, `review-document-styles.spec.ts` |
| Hidden preparation and display use the same clipped native DIP rectangle. Keep fractional CSS pixels until **one** zoom conversion, then clip against the owner. A 1px mismatch can invalidate styles throughout the math document. | `src/protocol/preview-preparation.ts` validates CSS bounds; `PreviewManager.applyCssBounds` is the common entry; `nativeZoomBounds` converts. Reader layout keeps outline width while covered by the editor. | `workspace-zoom.test.ts`, `review-preparation.test.ts`, `preview-presentation.test.ts`; real document/review geometry tests at multiple widths/zoom |
| Preparation never shows or focuses a hidden view. Detach initial hidden navigation for IME isolation, reattach only the current owned completion, then replay readiness. Obsolete navigation or another window cannot expose a view. | `preview-manager.ts`, `preview-preparation.ts`, `review-preparation.ts` | `preview-presentation.test.ts`; `git-review-ime.spec.ts` asserts zero blur during Korean composition |
| Ordinary hidden hydration uses bounded timer tasks, not hidden rAF. Layout is computed during those batches so Esc does not inherit all the work. Replacement/cancellation invalidates old batches. Visible hydration remains paint-scheduled. | `src/preview-runtime/content-controller.ts`, `command-router.ts`; typed `marktex:prepare-document` follows valid viewport setup. | `content-controller.test.ts`; `document-preparation.spec.ts` checks hidden completion. Full hydration remains legitimate for search/end-of-document/source targets outside installed blocks. |
| Strip only Crossnote's trusted webview UI stylesheet in lean ordinary/review documents. Preserve document/theme/code/KaTeX MathML styles and authored content. Full Crossnote pages retain their needed UI. Broad selectors in the unnecessary UI CSS amplify style invalidation. | `src/core/preview/preview-install.ts`, `src/main/preview/review-render-worker.ts` | `preview-install.test.ts`; document/review E2E compares real geometry and typography with the original stylesheet reinserted |
| Use local authored anchors for double-click hit testing; retain full-search fallback for whitespace. Skip hidden unobserved review viewport scans, but preserve active final flush and ordinary reporting. | `src/preview-runtime/source-atlas.ts`, `viewport-controller.ts` | `source-atlas.test.ts`, `viewport-controller.test.ts`, `source-atlas-review.spec.ts` |
| Preparation acknowledgments belong to their exact revision/request. Reuse of hidden work must not discard a new Esc position, survive an invalidating resize, or overwrite source position from a background viewport event. Warm transitions keep native view identity. | `src/renderer/project/source-control/review-presentation.ts`, main/runtime `review-preparation.ts`, `src/renderer/reader/reader-controller.ts` | `source-control-controller.test.ts`, `review-presentation.test.ts`, `reader-preparation.test.ts`, `review-preparation-layout.spec.ts`, `verified-review-position.spec.ts`, `zero-latency-architecture.spec.ts` |

PDF and image tabs use a separate shell-rendered surface cache (not native
Markdown views). `renderer/workspace/media-cache.ts` retains the three most
recently visited surfaces, keyed by tab, path, kind and disk version. Warm PDF
returns preserve canvas/worker/scroll identity; closed, evicted or superseded
surfaces release their resources. Closing a tab removes its surface; activating
an evicted neighboring replacement can refill the cache up to its capacity.
Inactive surfaces are inert, cannot focus
find controls or publish reading positions, and preserve nonzero layout. Hidden
resizes are reconciled on activation. This does not promise instant cold opens
or instant returns after eviction. `media-tabs.spec.ts`, `image-reader.spec.ts`,
`reading-positions.spec.ts` and the cache/file/history unit tests cover these
guarantees and are included in the focused gate.
Text-bearing PDFs allow pointer selection, keyboard copy, and a native Copy menu
on right-click inside the PDF. The selected range must belong to that PDF's
shadow root; selections elsewhere in the shell must not appear in its menu.
Native text selection paint stays enabled: PDF.js' draw-layer selection renderer
uses document-level ranges and treats Chromium's shadow selection as collapsed,
which hides its own highlight while suppressing the native one. Selection must
remain visibly highlighted during dragging and after release, and clearing it
must remove that highlight. The Electron test compares actual screenshot pixels.
Image-only PDFs need OCR before their contents can be selected as text.
`pdf-selection.spec.ts` covers the pointer and both copy paths in Electron.
Set `SETDOWN_TEST_PDF_FILE` to an absolute PDF path when running that test to
repeat the same visual and clipboard checks against a real document; it copies
the file into its temporary workspace before opening it.

Content zoom belongs to each tab. Ctrl+plus/minus and Ctrl+0 still change/reset
persisted app zoom in every window. Ctrl+wheel and location-bar controls change
only the addressed tab's content factor, including ordinary/Git editors, native
Markdown previews, terminals, and web reader mode. Native previews compose
app × tab zoom; editor and terminal typography uses the tab factor. New tabs
start at 100%, even when another tab of the same type is enlarged. The two
panes of one Git review share that review tab's factor. Transferred tab IDs keep
their factors. A newly created document tab after restart is a new zoom scope.
Legacy text/terminal preference fields are retained for settings compatibility;
they no longer couple production tabs.

Native targets use [Electron's isolated zoom mode](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoommodemode) so two pages on the same origin
can have different factors. Native bounds still convert with **app zoom only**.
Changing zoom must not navigate, replace models, discard undo history or focus
hidden previews. Unchanged native factors are not reapplied when another tab's
factor changes. Terminal font updates refit the PTY through the ordered resize
path. `workspace-zoom.test.ts`, `workspace-zoom.spec.ts`, `browser.spec.ts` and
`terminal.spec.ts` cover scope, composition, tab independence, and reset.
The View menu uses the same coordinator and active-tab ownership.

App typography uses the locally installed D2Coding family with a monospace
fallback across shell controls, ordinary/Git editors, terminals, and Markdown
body, heading, and code styles in every theme. Math and diagram renderers retain
their specialized fonts. Preview font overrides are present during hidden
preparation and remain applied when themes change. `document-preparation.spec.ts`
and `review-document-styles.spec.ts` check the computed text font alongside the
existing real math geometry comparisons. Hidden theme updates use main's native
presentation state: a never-shown view can report DOM visibility as "visible"
while its animation frames are suspended. Theme completion must not wait for
those frames, and a spare finishing navigation must reconcile the current theme
before adoption. `theme-controller.test.ts`, `preview-presentation.test.ts`, and
`preview-reading-tools.spec.ts` cover these cases without showing or focusing
hidden readers.

Browser Ctrl+wheel changes website zoom from 50% to 300% in 10-point steps.
The isolated page preload registers the bounded wheel accumulator in each
committed frame after a native owner/frame readiness acknowledgment;
Electron's native `zoom-changed` event handles unconsumed requests. Ordinary
scrolling and synthetic DOM wheel events do not request zoom. Website
zoom belongs to the web tab, including when another tab has the same hostname,
and composes with app zoom without changing other tabs or native bounds. Reloads, tab switches and app zoom updates retain the website factor.
Zoom preserves the live page and forms. The custom content-factor target in
`workspace-zoom.test.ts` and native wheel input in `browser.spec.ts` cover these
guarantees. Wheel IPC is accepted only from a visible owned web contents, with
bounded integer steps; no desktop API is exposed to remote pages.

Every tab's location bar displays decrease, reset percentage, and increase
controls, including 100%. Live web pages use their tab's website factor; web
reader mode uses that tab's separate Markdown/text factor. Reader Ctrl+wheel
follows that same tab text scope. Entering or
leaving reader mode preserves the live page's website factor and form state.
Bookmark and reader buttons precede zoom, with the Markdown toolbar icon style;
uBlock stays active and its controls remain available from Browser Extensions.
Terminal and video bars use their tab factors; PDF/image bars use their actual
per-tab scale (including fit modes). Each split's controls
address its own tab. Updates from wheels and menus keep the addressed tab's percentage current; indicators add no native captures, navigation,
or layout polling. `browser.spec.ts`, `workspace-zoom.spec.ts`, and
`terminal.spec.ts` cover the toolbar routing alongside the existing zoom checks.

Top-level application menus over live web pages use a transparent, owned native
menu view above the page. They do not capture, hide, pause or replace the page.
Menu/submenu selection, Escape and dismissal preserve the live view and video
frame delivery. `browser.spec.ts` verifies advancing video frames while selecting
these menus and unchanged page identity/visibility. The overlay runs only trusted
shell code and validates commands against the owner's current menu entries.

Address history/bookmark suggestions use their own bounded, transparent native
view above the pages. Opening or editing the dropdown must not capture, hide,
detach, resize or replace a web page in any split, including the input's own
split. The shell address input retains keyboard and IME ownership; the native
list accepts pointer selection and follows app zoom. Late show requests are
invalidated by dismissal and owner destruction. `browser.spec.ts` exercises
advancing video frames beside Markdown, web Reader and live web content,
unchanged native page bounds/identity, Korean composition, native pointer
selection and keyboard dismissal.
Hiding an empty suggestion list or repositioning it on window resize is a
presentation change, not an address-edit cancellation. Renderer-requested hides
must not echo a native cancellation event that resets its draft to the committed
URL. Mouse-focused typing preserves the draft, caret and IME across matching →
empty → matching queries; explicit Escape and actual focus/tab changes retain
their existing cancellation behavior. The real native-click/slow-typing case in
`browser.spec.ts` covers this boundary.

Closing a workspace retires all its browser entries before closing their stable
WebContents handles. Native View accessors are not a lifetime guarantee: audio
and loading events can run during destruction, after `view.webContents` has
become unavailable. Such events must not publish state or revive Places work.
Cleanup is idempotent, and cancelable `before-quit` must not destroy browser
pages. The audible-window close and canceled-close/quit scenarios in
`browser.spec.ts` cover resource release and the absence of main-process errors.

Explorer context menus, sidebar action menus, and the Explorer trash confirmation
use the shell's balanced native-overlay lifecycle. Visible Markdown/Git/web views
are replaced with captured content while these controls cover them, including
split groups. Dismissal, menu actions, sidebar hiding, and component removal
restore the same live views; transferring from a context menu to its confirmation keeps the overlay
active. `browser.spec.ts` checks overlap, actionable menus, restoration, and
unsaved web input across ordinary Markdown and split Markdown/web panels.

Website navigation controls styled with Electron's `app-region: drag` must
remain clickable inside web tabs. Only the desktop shell owns native window
dragging. The isolated page preload excludes web document elements and their
`::before`/`::after` regions, including authored inline/important declarations.
`browser.spec.ts` covers wide/narrow layouts, reloads and real child-frame clicks.
The browser session registers a frame preload and applies the user-origin policy
to the committed document through its owning native frame at DOM/load boundaries
as well as initial creation. Session/extension preloads finish registration
before the first web view is created; native frame load completion confirms the
policy and wheel listener on each actual document;
a provisional child document must not discard that policy. This rule does not
inject styles into the shell or Markdown preview runtime.

PDF/image wheel zoom is per file and keeps the content point under the cursor,
subject to the scroll range at content edges. It must not change either common
factor. PDF starts at fit width; explicit fit modes recompute on viewport/app
zoom changes, while numeric file zoom is retained. The media controls provide
100% and fit actions; Ctrl+0 leaves file zoom untouched. PDF.js receives wheel
origins in its container coordinate system, including the shadow host's offset.
`workspace-zoom.spec.ts` checks real wheel input, cursor anchors, fit resizing,
tab isolation and app reset; reading-position tests cover file-state persistence.

Terminals are workspace tabs and use the existing editor-group geometry. Their
stable keyed surfaces retain xterm and PTY state across tab switches and local
group moves. A terminal group must remain outside every native reader/web view,
including during window and sash resizing. No bottom terminal grid row remains.
The Terminal activity button now manages sessions in the sidebar; opening that
list does not create a PTY. Closing a tab or navigating to a file/web page preserves its process; the
Terminal sidebar selects the session again or explicitly ends it. Editable
`terminal://<session-id>` addresses and Terminal 1, Terminal 2 labels distinguish
sessions from web/file resources. Back/Forward restores the same session. An
already displayed terminal address focuses its existing tab rather than creating
a second competing PTY surface. Cross-window transfer of a terminal tab adopts the same PTY and restores its live VT screen and input modes. A clean document
beside the terminal refreshes external file changes without stealing focus.
`terminal.spec.ts`, `editor-groups.spec.ts`, `image-terminal-layout.spec.ts`, and
`video-reader.spec.ts` cover the replacement layout; terminal ownership and
workspace lifecycle unit tests accompany them. See `integrated-terminal.md` for
session and transcript limits.

Terminal resize preserves a multiline prompt, unsubmitted input and prior
output. Main applies growth before PTY notification and shrink after the
process redraw, with ordered parser/grid events and a bounded output wait.
The real native-window resize scenario in `terminal.spec.ts`, along with
`terminal-resize.test.ts` and VT/manager tests, covers this ordering, snapshot
dimensions, cancellation and closed/exited sessions. Sidebar compact sizing
does not change the editor-group geometry.

The common native lifecycle is: validate CSS bounds → convert/clip once → apply
native bounds → synchronize Blink viewport → prepare hidden content. Navigation
invalidates the viewport cache and replays that sequence after current ownership
is checked. A pending document request is consumed once; repeated show does not
enqueue more background hydration. Showing is still an explicit presentation decision; readiness never
grants permission to change visibility. Review positioning has its own revision
acknowledgment, so it is not collapsed into ordinary document hydration.

Ordinary source positions reuse document-relative geometry across scrolling;
DOM, stylesheet/font/resource and viewport changes still invalidate it. Returning
from edited source positions the latest prepared revision instead of scanning
obsolete content immediately before patching it. The latest Esc anchor and
weighted editor band still apply once that revision is installed.
`source-atlas.test.ts` and the real edited document/reading-position cycles cover
cache reuse, invalidation and latest-position behavior.

Owned background document preparation uses its tab's file, without changing the
foreground document or watcher. Per-tab main preparation keeps worker block
history aligned with installed native content; a superseded uninstalled render
cannot become a later patch base. Background preparation and early real tab
split tests cover this ownership boundary.

Ordinary document position/scroll settlement owns only its last applied scroll
offset. A later scroll or positioning request supersedes it; its delayed layout
callback must not jump back to the old anchor. `scroll-settlement.test.ts` and
the Markdown restart scenario in `reading-positions.spec.ts` cover this rule.

Shared preparation command types live in `src/protocol/preview-preparation.ts`.
Call sites use `satisfies`; IPC inputs still require runtime validation. Core
document algorithms must not import Electron or the protocol layer.

Opening a Working Tree review binds its live document without presenting or
awaiting the ordinary Markdown reader. New reviews start in Monaco source mode;
ordinary rendering and reading-position settlement must not gate first opening.
The document retains its own surface, position, unsaved text and shared undo
history. `text-workspace.test.ts` and `git-review-first-open.spec.ts` cover first
opening without an ordinary preview and returning to the shared document.

Git history reviews carry an immutable commit selection. Their source models
are read-only and must never borrow a Working Tree model or receive its unsaved
text. Source/rendered transitions use the same review preparation guarantees.
The lazily mounted history graph must not take ownership of document focus or
trigger history reads on unsaved keystrokes. `git-history.spec.ts` and the
history/provider/controller unit tests cover the integration.

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

The three reading-capability scenarios in `browser.spec.ts` exercise native
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

Language support now uses declarative server definitions and a persisted registry.
`Edit → Language Support…` and F1 open the same lazy management screen; the Setdown
Folder Tools button retains its meaning. Catalog browsing starts no process.
Configuration changes reconnect only models served by affected servers, without
changing text or Undo, including models first acquired by Working Tree. One primary server is selected
per language; settings changes are user-wide while explicit restart is window-local.
Legacy clangd executable selection is retained. `server-registry.test.ts` and
`language-registry.spec.ts` cover registration, persistence, routing, native choice,
Full/Incremental/None negotiation, save snapshots, initialization/settings and
reconfiguration with Undo. Versionless push diagnostics remain rejected; pull
and dynamic capabilities remain unadvertised. The real Rust integration test in
`test/language-servers` is a separate explicit toolchain gate; see
[language support](language-support.md). All existing Python/clangd, native-preview,
focus/IME and comparative latency checks remain required.

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

## Explorer file operations and document ownership

Explorer commands are scoped to the tree. Native accelerators, the main Edit
menu, and context-menu actions must agree on the selected files; inline name
inputs, Monaco, terminals and reading surfaces retain their own text clipboard.
The native menu overlay retains the originating tree target across its focus
change. File-operation Undo/Redo remains unavailable and must not accidentally
undo the active editor while the tree owns the command.

`main/project/explorer-service.ts` serializes mutations. `file-transfer.ts` copies
through a staging directory on the destination volume and reserves destinations
without replacing existing contents. It preserves nested symbolic links as
links; unsupported file types fail instead of silently disappearing. The typed
receipt identifies completed, skipped, failed and unstarted entries. Cut is
consumed only for completed moves. A main-owned nonce on the system clipboard
invalidates file selection when another copy replaces it; this is currently
Setdown project clipboard support, not OS file-manager interoperability.

`explorer-controller.ts` applies committed path mappings before watcher refresh,
invalidates stale directory reads, and retains selection outside the mounted
view. `project-watcher.ts` sends changed paths; ordinary notifications refresh
affected cached parents, with full refresh available for explicit reload and
transaction reconciliation. Rename/move must keep live model text and history.
`AutoSaveController.hold()` drains in-flight saves before path changes, while the
workspace queues explicit saves with mutations. A file open in another Setdown
window blocks a destructive operation until those tabs close; cross-window
retargeting is not yet implemented.

Trash preparation confirms dirty documents but keeps their models alive. Only
successful OS trash completion closes approved revisions. New edits during the
job remain in their buffer, and autosave must not recreate a missing file.
Tests cover filesystem collision/failure receipts, clipboard invalidation,
stale reads, autosave draining and deletion lifecycle. `explorer-selection.spec.ts`
executes keyboard, context-menu and main-menu copy/paste, duplicate, conflict
choices, basename/IME handling, selection persistence and failed trash in real
Electron. Existing native web/Markdown overlay identity and focus tests remain
required. These guarantees do not imply large-tree virtualization or file Undo.

## Required deterministic and browser checks

From the repository root:

```sh
npm ci
npx playwright install chromium
npm run test:preview-contract
```

Linux GUI tests use `scripts/with-isolated-display.sh` by default. It creates an
Xvfb screen, private runtime directory and D-Bus session, removes inherited
Wayland sockets, and selects X11. D-Bus starts inside the virtual display so its
activated services inherit the same display. Plain `xvfb-run` can still expose windows on a
Wayland desktop. The command
runs the explicitly listed `vitest.preview-contract.config.ts` suite, the benchmark
comparator's Node tests, the production build/typecheck, and
`playwright.preview-contract.config.ts` with real Electron/Chromium. Retries are
disabled. This is a focused gate, not a substitute for other applicable tests.

Useful shorter commands (after a current build for E2E):

```sh
npm run test:preview-contract:unit --workspace @setdown/desktop
npm run test:preview-contract:e2e --workspace @setdown/desktop
```

## Comparative latency gate

Prepare a **separate** baseline checkout with its own installed dependencies. Do
not switch/reset the working tree under test. For example, choose an explicit
base commit and create a worktree outside the candidate:

```sh
git worktree add --detach /tmp/setdown-preview-base <base-commit>
npm ci --prefix /tmp/setdown-preview-base
npm run bench:preview -- --baseline /tmp/setdown-preview-base --runs 5
```

The runner builds both apps, then alternates baseline/candidate and
candidate/baseline on the **same machine/display**. Both use the candidate's exact
measurement harness and the same candidate-owned sample fixture, but each launches
its **own installed Electron executable** so dependency upgrades are compared
correctly. Each scenario starts a fresh
Electron app and profile; OS caches are not claimed to be cold. There are eight
scenarios: ordinary document / Git review × no edit / appended edit × 0ms / 3000ms
source preparation time. Ordinary documents open in reader before entering source;
there is no extra reader-idle delay. Each app executes five Esc/double-click cycles.

Both paths wait for the latest edit marker in the visible DOM before the single
nonempty native capture. The Esc metric includes polling, IPC and capture readback;
it is **not a monitor presentation timestamp**. Real browser mouse input measures
double-click → editable source separately. After Esc timing ends, select a visible
authored block for input; fixed viewport coordinates can miss the document during
initial native layout. Target selection is outside double-click timing. Tracing and hidden geometry probes are
disabled during timing. Failed correctness assertions abort the benchmark.

For each scenario and metric, compare:

- First cycle across fresh apps.
- Second cycle across fresh apps.
- Median of cycles 3–5 within each app, then across apps.

The default is five repetitions per version (80 app launches). Compare medians
across repetitions; fail a bucket only when its increase exceeds **both 25% and
50ms**. These initial noise allowances are policy, not established universal
perceptual limits. At least three matched repetitions are required. A slow first
cycle cannot be averaged away by later cycles, and fast ordinary tabs cannot hide
a review regression. Missing/duplicate scenarios, invalid samples, stale edited
captures and insufficient repetitions fail closed. Exit code is nonzero on either
regression or measurement/build failure.

Use `--output /absolute/new-directory` to retain raw per-run JSON/logs and
`comparison.json` with commit/status, lock/fixture/harness/build hashes, Electron
versions, machine, order,
thresholds, samples and all 48 bucket comparisons. Existing output directories
are rejected to avoid mixing runs. `--skip-build` is only for already-current
builds. A changed harness or rebuilt application during measurement aborts the
comparison. `--relative` / `--absolute-ms` make calibration explicit and recorded;
do not change them just to pass a regression. Calibrate with repeated unchanged
baseline/candidate runs on the intended runner, inspecting distributions rather
than one outlier. Five runs do not establish a reliable P95. Diagnose regressions
with separate Chromium traces; do not enable tracing in the gate run.

## CI and merge protection

`.github/workflows/ci.yml` runs on PRs, main pushes, version tags and manual
requests. Its reusable `desktop.yml` typechecks and builds PRs and application
changes on main. Version tags and manual runs build Windows and Linux installers
and verify the expected files; only a `v*` tag push may publish a GitHub Release.
It does not run unit tests, benchmark-comparator tests, the real
Electron/Chromium contract, or packaged-app smoke tests. Run
`npm run test:preview-contract` locally for changes in this contract's scope;
its GUI tests use the isolated-display wrapper and keep retries disabled.

The only automatic exemptions are known documentation paths: root README,
AGENTS, CONTRIBUTING, CHANGELOG and LICENSE files, `live_demo.gif`, `docs/`, and
`reports/`. CSS, dependencies, Markdown test fixtures, workflows, submodule
pointers and unknown paths always require a desktop build or packaging. Missing
diff history triggers the build. Tags and manual CI runs always package the app.
The policy and its rename/deletion handling can be checked locally with
`node --test scripts/ci/policy.test.mjs`.

`preview-latency` is a separate manual **Preview latency benchmark** workflow
(`preview-benchmark.yml`). The full 80-launch comparison has encountered
intermittent Electron evaluation failures before it could produce measurements; see
[the CI investigation](ci-failure-analysis-2026-09-21.md). It is therefore a manual
diagnostic rather than an automatic merge gate. This reduces automatic coverage:
timing regressions must still be checked locally for changes to performance paths,
using the full benchmark described above. Its scenarios, repetitions, thresholds
and fail-closed validation are unchanged.

Manual comparisons accept an explicit baseline commit/tag, defaulting to the
selected ref's parent commit. Each lockfile is installed independently. Both
versions are measured serially on one
VM; logs and comparisons are uploaded even on failure. Automatic events do not
cancel a manually requested run.

Require **CI result** in main's branch rules. This final job fails on a failed or
canceled desktop build or packaging run and accepts documentation-only skips;
it is never omitted by workflow-level path filters. `preview-latency` is not an
automatic merge requirement. Workflow YAML cannot configure repository rules.
Versioned tag releases depend on successful OS builds for the exact same commit.
Ordinary main pushes never package or publish a release; manual CI runs produce
workflow artifacts only, including when the selected ref is a tag. Later
documentation pushes cannot cancel a pending application build.
Changes to this document, the suite lists, workflow, fixture and tolerances deserve the same
review as the optimized code. Do not bypass a measured regression by weakening
its thresholds.

Historical measurements and explanations remain in
`sample-review-viewport-2026-09-21.md` and
`sample-document-optimization-2026-09-21.md`; they are evidence, not portable
hardcoded millisecond budgets.

## Editor groups

Web pages share the editor-group tab strip and its address/file-path bar. The bar
occupies 34 CSS pixels below the tab strip; both document preparation and visible
readers use the resulting group body. Existing viewport, IME, revision and timing
guarantees still apply.

Local addresses display encoded `file:///` URLs while document state retains
filesystem paths. Explicit address navigation can replace a file with a web page
or a web page with a file in the same tab and editor group. Failed reads, canceled
save prompts, and rejected web beforeunload preserve the outgoing resource.
Superseded reads cannot replace a newer address; native close events emitted
during replacement cannot remove the retained tab. File URL encoding and the
same-tab lifecycle are covered by `file-location.test.ts`,
`text-workspace.test.ts`, and `browser.spec.ts` in the focused gate.

Back/Forward spans file locations and web segments in each tab. Explorer preview
replacement inherits that slot's journal, including forward-branch truncation.
The journal retains up to 64 resource visits and moves with detached tabs. File
visits restore their reading positions; canceled or failed navigation keeps the
current resource and history cursor. Web segments retain Chromium's native
navigation stack: capture it only when leaving a web surface, then restore it
before initial navigation when returning. Historical visits do not keep native
views, Monaco models, or media readers alive. Page navigation, toolbar actions,
and Alt+Left/Right share the same route, including native reader/page focus.
New web tabs open Google with page focus and a collapsed address selection;
explicit mouse/keyboard address focus selects the complete value. Web title and
loading-label updates preserve tab widths while available space is unchanged.
Tabs still shrink and scroll when needed, with creation buttons after the list.
`tab-navigation.test.ts`,
`text-workspace.test.ts`, `preview-tabs.spec.ts`, and `browser.spec.ts` cover this
behavior in the focused gate.

`main/browser/browser-manager.ts` retains one sandboxed WebContentsView per live
web tab, with a separate persistent browser session. Switching tabs and splitting
groups keep page identity, forms and history. Browser layout uses app zoom once;
remote pages receive neither Node nor the desktop bridge. Hidden initial loads
stay detached. Library indexing/ranking runs in a separate, detached Places view.
No periodic page captures or Markdown hydration are added to browser tabs.
Hidden web tabs are detached from the native window without closing their
WebContents. Chromium background throttling stays enabled; visible split groups
remain attached. No timer discards live forms, audio, downloads or opener state.
The browser lifecycle E2E disables Playwright's focus emulation on its original
CDP session before asserting actual `document.visibilityState`; a second CDP
session cannot release the first session's synthetic capturer.

Website permissions are page/owner/origin scoped and announced through a quiet
address-bar control. Navigation, transfer, destruction and expiry settle pending
callbacks, without focusing a window. Native menus retain the source frame and
navigation generation, and pass Chromium hit-test coordinates unchanged.
Find results match both the native request ID and current query. Composition and
page-owned Escape handlers precede Reader entry. HTTP authentication carries
only its challenge token and origin to the UI; submitted credentials are never
persisted by Setdown. Browser reload commands reload the focused web page while
preserving the workspace. Same-URL reloads invalidate old Reader snapshots.

Browser library history deletion serializes with visits/bookmark updates in the
detached Places service. IndexedDB and its search cache change together; clearing
visits preserves bookmarks, cookies and live page state. Downloads use native
session DownloadItem events, coalesce progress updates, and immediately publish
terminal states. Only serializable metadata crosses the desktop bridge. The
library retains completed records across restart; an unfinished transfer from a
previous process is shown as interrupted. Removing a download record keeps its
file. Completed PDFs stay in Downloads until explicitly opened; they cannot
replace the user's active surface. `browser.spec.ts` checks deletion persistence and native download controls;
`browser-downloads.test.ts` checks interrupted restoration, duplicate file paths
and progress/completion ordering.

Web Store installs reuse the existing extension session and registry. The store
downloader is imported only on an explicit install/update request, and staging
does not execute extensions before confirmation. Disabled extensions stay disabled
when updated; a failed enabled replacement restores the previous version.
`browser-extensions.spec.ts` exercises real CRX3 unpacking, native content scripts,
confirmation/cancellation, updates, restart restoration and removal; it is included
in the focused gate. Store input and registry mutation tests accompany it.

`browser.spec.ts` covers navigation, live state, native split visibility, bookmarks,
fresh-profile extension startup, popup opener identity, and real uBlock network,
scriptlet, frame cosmetic and response-header filtering. It is part of the focused
gate. The full uBlock extension starts before remote navigation; startup is
warmed when a shell restores web tabs so first navigation does not pay the
fresh-profile filter compilation (seconds) — document-only launches do not
start extensions at all — and creating a web tab
only needs the synchronous session-preload registration — the tab appears
immediately while its remote load still waits for extension readiness. Its
adapter preserves native response-header events and targets styles to their
actual frame.
Electron 44/Chromium exposes a separate native `browser` namespace. The pinned
extension compatibility preload augments `chrome` and synchronously aliases
`browser` to that same API before extension scripts run. uBlock's own aliasing
must not discard browserAction, tabs, managed-storage and header adapters.
`browser.spec.ts` checks both namespaces, fresh startup, real filtering, popup
operation and settings/filter preservation across three restarts. API warnings
from unsupported manifest permissions are not a readiness signal; remote
navigation still waits for uBlock's actual filtering readiness.

Electron 38 cannot remove user-origin webFrame styles; scoped user styles are
disabled through root tokens and reused until navigation, preserving priority
and allowing uBlock's cosmetic toggle without replacing page content. Frames
that never run the page preload or never acknowledge a style request
(blocked ad frames, error or destroyed frames) are skipped best-effort after
a bounded wait; one such frame must not reject the extension's call, delay
other frames, or spam the main-process log.

Document command focus and presentation are separate: each editor group selects
one document, and several groups may remain visible. The focused group owns the
existing source/reader command session. `renderer/groups/group-runtime.ts` owns
background group geometry; `core/workspace/editor-groups.ts` owns placement and
selection. `PreviewManager.setBackgrounds` validates native-view ownership and
retains visible background groups during foreground changes. Backgrounds use the
same hidden preparation and fractional CSS-to-DIP boundary as foreground readers.
They must not be focused by preparation, lose their current revision, or cover the
shell's split resize handles. Native focus explicitly activates its owning group.

Media cache capacity applies to hidden readers: every visible group's media surface
is pinned until it becomes hidden. `active` on a media surface means visible;
PDF search commands additionally require command focus. Splitting, moving and
collapsing groups must preserve Monaco models and Undo histories.

Focusing a continuously mounted text editor preserves its current viewport and
the caret placed by the user's click. A saved reading position must not override
that live view, including after scrolling a visible background group. Monaco
receives its pointer/caret focus before group activation reparents its host;
connected editor hosts use an atomic DOM move to retain focus and IME state. Text tabs
that are newly mounted still restore their saved view against the final shell
geometry. The source-group focus case in `editor-groups.spec.ts` and activation
cases in `text-workspace.test.ts` cover this distinction.

`editor-groups.spec.ts`, `tab-detach.spec.ts`, `editor-groups.test.ts`,
`preview-presentation.test.ts`, and `media-cache.test.ts` cover these guarantees.
The detach test forces source `dragend` to reach main before an existing window's
drop claim and verifies that the existing window still receives the live native
preview. Keep ordinary single-group preview and Git-review cycles in the same
48-bucket performance comparison.

## Preview tabs

VS Code's editor-group preview policy applies to document tabs. Explorer single
clicks open one replaceable preview per group; double-clicks (file or tab), middle
clicks on files, Enter, explicit Open, native/external opens and new files keep
their tabs. Preview labels are italic. Reopening an existing pinned document never
demotes it. Editing ordinary or shared Working Tree text pins the document; Save
and Undo do not make it replaceable again. Dragging/moving a preview also pins it.

`core/workspace/editor-groups.ts` owns each group's preview identity. Replacing a
preview preserves its group and split geometry, releases its Monaco/native/media
resources, and never closes dirty text or activates a neighboring document on the
way to the requested one. Failed reads preserve the current tab; superseded
project-file reads cannot override a newer open request. These rules do not change
the preparation, focus, revision or visual guarantees above.

`editor-groups.test.ts`, `text-workspace.test.ts` and `preview-tabs.spec.ts` cover
replacement, promotion, resource release, saved edits, independent groups and
explicit opens. They are included in the focused gate; ordinary and Git review
latency retain the same 48-bucket comparison.

## Explorer selection and tab-strip drops

Explorer selection follows the [VS Code multi-selection model](https://code.visualstudio.com/docs/editing/getting-started/userinterface):
Ctrl/Cmd toggles entries, Shift selects a visible range, Ctrl/Cmd+A selects visible
entries, and modifier clicks do not replace the editor preview. Keyboard range
selection and selected-item context menus operate on that same selection.
A selected folder carries its selected descendants exactly once. Batch moves
preflight paths and name conflicts before moving; unexpected disk failures report
completed moves so live document paths and saved reading positions can follow.
`explorer-selection.spec.ts` and selection/service unit tests cover the real
multi-item drag, conflicts, pinned batch opens, and unsaved text after moving.

Like [Chrome tab movement](https://support.google.com/chrome/answer/2391819), tab
strips accept drops over tabs, padding, and unused space, with an insertion marker
and edge scrolling. Their unused space is not a native window-drag region; the
application title bar still moves the window. A strip drop inserts without
splitting, while body-edge drops retain their split behavior. Drop completion and
cancellation clear feedback and release native overlays.
A source drag keeps its native captures until drop/end/cancel: a null
`dragleave.relatedTarget` can also denote a native child-surface boundary inside
the window and must not restore native views over a pending split drop. Incoming
drags still release a destination window's captures when leaving it.
`editor-groups.spec.ts` checks real Markdown pointer splits in both axes with/without
a native-boundary leave signal, order, group collapse, and Undo. `browser.spec.ts`
checks the same boundary signal during a real web-tab split;
`tab-detach.spec.ts` checks cross-window strip drops even when source dragend
precedes the destination claim, preserving the live native reader and position.

## Browser lifecycle validation, 2026-10-15

The audible-close exception and split-video freeze were reproduced on the
unmodified `1ba591057b0a393e57a2a930d06cc236993e1432` baseline before the fixes.
The final build/typecheck, 688 unit tests, 282 focused contract unit tests,
three comparator tests and 93 real Electron GUI scenarios passed.

The independent baseline and candidate used Electron 44.7.2, the same isolated
Xvfb display and five matched repetitions, alternating their order. Eight
scenarios and all 48 first/second/warm comparisons were retained. The existing
25% **and** 50ms regression thresholds were unchanged. Results below are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 32.0 | 20.0 → 20.0 | 23.0 → 23.0 |
| document | 0ms | false | Double-click → editor | 16.0 → 16.0 | 35.0 → 33.0 | 11.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 390.0 → 404.0 | 99.0 → 111.0 | 89.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 16.0 | 17.0 → 15.0 | 12.0 → 13.0 |
| document | 3000ms | false | Esc → latest capture | 40.0 → 47.0 | 21.0 → 22.0 | 19.0 → 18.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 12.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 103.0 → 103.0 | 99.0 → 99.0 | 89.0 → 88.0 |
| document | 3000ms | true | Double-click → editor | 15.0 → 19.0 | 12.0 → 15.0 | 15.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 908.0 → 932.0 | 21.0 → 19.0 | 19.0 → 17.0 |
| review | 0ms | false | Double-click → editor | 23.0 → 21.0 | 11.0 → 11.0 | 12.0 → 11.0 |
| review | 0ms | true | Esc → latest capture | 991.0 → 974.0 | 1439.0 → 1445.0 | 181.0 → 173.0 |
| review | 0ms | true | Double-click → editor | 14.0 → 22.0 | 19.0 → 13.0 | 18.0 → 17.0 |
| review | 3000ms | false | Esc → latest capture | 28.0 → 30.0 | 24.0 → 24.0 | 18.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 22.0 → 22.0 | 11.0 → 11.0 | 17.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 226.0 → 224.0 | 177.0 → 181.0 | 174.0 → 171.0 |
| review | 3000ms | true | Double-click → editor | 21.0 → 21.0 | 18.0 → 12.0 | 17.0 → 17.0 |

Result: **PASS**, 0 regressing buckets.
The first run flagged `document/idle=0/edits=true/first/captureMs` (329ms → 456ms).
That failure is preserved in [the initial comparison](browser-lifecycle-benchmark-first-run-2026-10-15.json).
Separate Chromium traces showed similar HTML readiness and variable rendering/capture time;
they do not establish a sole cause. Unused address-dropdown hide IPC was removed from inactive
bars, then the changed implementation was measured again with the same scenarios and thresholds.
[Complete validation and measurement records](browser-lifecycle-validation-2026-10-15.json)
retain the per-repetition samples, build/lock/harness hashes and limitations; logs are in `/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/test-results/browser-lifecycle-2026-10-15`.

## Reading capabilities validation, 2026-10-15

The final build/typecheck, 694 unit tests, 288 focused contract unit tests, three
comparator tests and 96 real Electron GUI scenarios passed. Tests ran on isolated
Xvfb with a private runtime and D-Bus session, without retries. Exported PDFs were
also checked with `pdftotext`: the web article retained its title, source and first
and last paragraphs; the local Markdown PDF retained its text. The first web
article PDF page was visually inspected.

The public Namu **키스 길** HTML capture, served in actual Electron with page
scripts/external resources disabled, yielded 48 paragraphs, seven tables, seven
section headings and 82 position stamps, without editing links. The synthetic
hashed-layout test additionally verifies double-click restoration to the live
leaf-div paragraph. This evidence is limited to the inspected markup; it does not
establish every future or authenticated Namu layout.

The separately installed baseline is `81bcd84a96ff2cf4b75852dda4354f2090dc1b33`;
both versions used Electron 44.7.2. Five matched repetitions alternated their order
on one isolated display. The eight scenarios and 48 first/second/warm comparisons
used the unchanged 25% **and** 50ms thresholds. Results are **baseline → candidate
medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 42.0 | 21.0 → 28.0 | 23.0 → 19.0 |
| document | 0ms | false | Double-click → editor | 19.0 → 17.0 | 35.0 → 35.0 | 12.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 389.0 → 446.0 | 108.0 → 103.0 | 89.0 → 95.0 |
| document | 0ms | true | Double-click → editor | 22.0 → 21.0 | 14.0 → 14.0 | 15.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 45.0 → 47.0 | 17.0 → 18.0 | 22.0 → 21.0 |
| document | 3000ms | false | Double-click → editor | 17.0 → 17.0 | 11.0 → 11.0 | 10.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 115.0 → 101.0 | 105.0 → 94.0 | 91.0 → 94.0 |
| document | 3000ms | true | Double-click → editor | 15.0 → 21.0 | 16.0 → 13.0 | 14.0 → 16.0 |
| review | 0ms | false | Esc → latest capture | 975.0 → 974.0 | 24.0 → 25.0 | 18.0 → 28.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 23.0 | 11.0 → 13.0 | 12.0 → 13.0 |
| review | 0ms | true | Esc → latest capture | 1089.0 → 1045.0 | 1501.0 → 1501.0 | 179.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 21.0 → 23.0 | 17.0 → 20.0 | 18.0 → 19.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 25.0 | 19.0 → 22.0 | 19.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 25.0 → 25.0 | 11.0 → 12.0 | 18.0 → 18.0 |
| review | 3000ms | true | Esc → latest capture | 231.0 → 233.0 | 186.0 → 184.0 | 180.0 → 178.0 |
| review | 3000ms | true | Double-click → editor | 23.0 → 21.0 | 18.0 → 18.0 | 18.0 → 18.0 |

Result: **PASS**, 0 regressing buckets. These timings cover ordinary Markdown
and Git transitions, not web Reader extraction or file export latency.

The initial contract run passed 95/96 GUI cases; the new native menu test examined
the menu before Chromium emitted `context-menu`. It now waits for that actual
event before sending native menu-selection input. The first Namu fixture routing
also failed to intercept HTTPS and was replaced with verified Playwright routing.
The original failures and final results are preserved in
[the validation record](reading-capabilities-validation-2026-10-15.json), including
all performance samples, identities, build/lock/harness hashes and limitations.
Raw artifacts are in `test-results/reading-capabilities-2026-10-15` and
`test-results/reading-capabilities-benchmark-2026-10-15`.

## Namu SVG filtering validation, 2026-10-15

Namu Reader strips inline SVG and identifiable SVG images from its cloned,
stamped document before either extraction path. The real Electron fixture checks
SVG elements, data URIs, upper-case `.SVG` with query parameters, an encoded
`.svgz` path and SVG responsive candidates. PNGs, tables, anchors and live-page
restoration remain covered. The generic Readability fallback is checked too.

The first contract run passed 95/96 GUI cases: image-bearing Reader teardown
exposed a queued scroll after its bound container had become null. The final
implementation rejects obsolete callbacks and retains a stable element for
cleanup. The final build/typecheck, 288 focused unit tests, three comparator
tests and all 96 GUI cases passed on isolated Xvfb, without retries.

The independent baseline is `1ca71e5de96fbfc39616b8a0beb84bcbc99fdf39`, with
matching lockfiles and Electron 44.7.2. Five matched repetitions per version
alternated their order on one isolated display. All eight scenarios and 48
comparisons used the unchanged 25% **and** 50ms regression thresholds. Values are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 37.0 → 37.0 | 21.0 → 27.0 | 20.0 → 20.0 |
| document | 0ms | false | Double-click → editor | 16.0 → 19.0 | 34.0 → 34.0 | 11.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 413.0 → 390.0 | 106.0 → 98.0 | 90.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 15.0 | 17.0 → 17.0 | 13.0 → 14.0 |
| document | 3000ms | false | Esc → latest capture | 45.0 → 40.0 | 22.0 → 18.0 | 19.0 → 24.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 12.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 111.0 → 89.0 | 102.0 → 98.0 | 90.0 → 92.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 18.0 | 12.0 → 13.0 | 14.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 954.0 → 908.0 | 22.0 → 19.0 | 20.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 21.0 → 22.0 | 11.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 999.0 → 983.0 | 1480.0 → 1484.0 | 175.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 21.0 → 22.0 | 20.0 → 19.0 | 18.0 → 18.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 23.0 | 23.0 → 21.0 | 18.0 → 17.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 23.0 | 12.0 → 11.0 | 16.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 230.0 → 228.0 | 187.0 → 182.0 | 180.0 → 173.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 22.0 | 18.0 → 18.0 | 18.0 → 17.0 |

Result: **PASS**, 0 regressing buckets. This compares ordinary Markdown and Git
transitions; it does not measure Namu extraction latency.

[The SVG validation record](namu-svg-validation-2026-10-15.json) retains every
cycle measurement, comparison, identity/hash, the initial failure and the final
checks. Raw logs/event traces are in `test-results/namu-svg-filter-2026-10-15`
and `test-results/namu-svg-benchmark-2026-10-15`.

## Address draft validation, 2026-10-15

A real native mouse click from a focused web page, followed by 140ms-per-character
typing across the Places debounce, reproduced the input loss on the original
build. `no-history-match-928471` became the current `/first` URL followed by
`-history-match-928471`. An empty result hid the native dropdown, which echoed
`location-overlay:hidden`; the renderer canceled editing and synchronized the
draft back to the committed URL before later keystrokes arrived.

Renderer-requested hides and resize hides now update presentation without echoing
an edit cancellation. Existing native cancellation paths retain their signals.
The new GUI case verifies native-click selection, slow typing through empty
results, caret position, Home-key insertion, reopening matches, Korean composition
and explicit Escape. It identifies the suggestion by URL because native title
updates can rename a bookmarked row. Existing split-video and native pointer
selection cases also passed.

The final build/typecheck, 288 focused unit tests, three comparator tests and all
97 Electron GUI scenarios passed on isolated Xvfb with no retries. Initial
fixture/typecheck failures and the successful unmodified-build reproduction are
preserved in [the validation record](address-draft-validation-2026-10-15.json).

The separate, independently installed baseline is
`5c43b04c33b2930059cba3ccb8934538a892d1ec`; lockfiles match and both use Electron
44.7.2. Five matched repetitions alternated version order on one isolated display.
The eight scenarios and 48 first/second/warm comparisons retain the existing
25% **and** 50ms thresholds. Values are **baseline → candidate medians in
milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 45.0 → 29.0 | 21.0 → 23.0 | 21.0 → 20.0 |
| document | 0ms | false | Double-click → editor | 22.0 → 16.0 | 25.0 → 33.0 | 11.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 430.0 → 434.0 | 101.0 → 101.0 | 89.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 18.0 → 19.0 | 14.0 → 13.0 | 16.0 → 13.0 |
| document | 3000ms | false | Esc → latest capture | 41.0 → 42.0 | 21.0 → 19.0 | 25.0 → 21.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 15.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 106.0 → 102.0 | 103.0 → 108.0 | 90.0 → 90.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 15.0 | 12.0 → 12.0 | 13.0 → 15.0 |
| review | 0ms | false | Esc → latest capture | 928.0 → 955.0 | 22.0 → 19.0 | 28.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 22.0 | 11.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 975.0 → 970.0 | 1455.0 → 1496.0 | 177.0 → 173.0 |
| review | 0ms | true | Double-click → editor | 22.0 → 22.0 | 18.0 → 20.0 | 17.0 → 17.0 |
| review | 3000ms | false | Esc → latest capture | 30.0 → 29.0 | 23.0 → 23.0 | 17.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 22.0 | 11.0 → 11.0 | 16.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 229.0 → 230.0 | 181.0 → 183.0 | 166.0 → 177.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 21.0 | 18.0 → 19.0 | 17.0 → 18.0 |

Result: **PASS**, 0 regressing buckets. These timings cover Markdown/Git
transitions, not Places query latency. Every cycle measurement, comparison,
identity/hash and the original failures are retained in the validation record.
Raw logs/traces are in `test-results/address-draft-2026-10-15` and
`test-results/address-draft-benchmark-2026-10-15`.

## Reader toolbar removal validation, 2026-10-15

The web Reader now begins with the article title and content, without an export
toolbar or overflow button. The existing real Electron scenario checks that the
reading surface has no buttons, visible-article search still works, right-click
Markdown/PDF exports retain the snapshot, and File PDF and live-page restoration
still work. Build/typecheck, 288 focused unit tests, three comparator tests and all
97 Electron GUI scenarios passed on isolated Xvfb, without retries.

The independently installed baseline is `344e69db8601ff88d192e878e27139f1843daab8`; both
versions use Electron 44.7.2. Three matched repetitions per version
alternated order on one isolated display, retaining all eight scenarios and 48
comparisons with the unchanged 25% **and** 50ms thresholds. Values are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 46.0 → 51.0 | 18.0 → 18.0 | 23.0 → 18.0 |
| document | 0ms | false | Double-click → editor | 17.0 → 17.0 | 36.0 → 34.0 | 11.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 451.0 → 429.0 | 102.0 → 99.0 | 86.0 → 88.0 |
| document | 0ms | true | Double-click → editor | 21.0 → 16.0 | 16.0 → 13.0 | 15.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 41.0 → 34.0 | 24.0 → 23.0 | 24.0 → 20.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 17.0 | 11.0 → 13.0 | 11.0 → 10.0 |
| document | 3000ms | true | Esc → latest capture | 120.0 → 109.0 | 102.0 → 99.0 | 91.0 → 92.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 18.0 | 13.0 → 13.0 | 15.0 → 14.0 |
| review | 0ms | false | Esc → latest capture | 910.0 → 1033.0 | 25.0 → 22.0 | 16.0 → 30.0 |
| review | 0ms | false | Double-click → editor | 26.0 → 23.0 | 12.0 → 12.0 | 12.0 → 11.0 |
| review | 0ms | true | Esc → latest capture | 1034.0 → 1034.0 | 1494.0 → 1490.0 | 181.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 22.0 → 23.0 | 21.0 → 19.0 | 20.0 → 19.0 |
| review | 3000ms | false | Esc → latest capture | 27.0 → 25.0 | 21.0 → 21.0 | 19.0 → 27.0 |
| review | 3000ms | false | Double-click → editor | 24.0 → 24.0 | 13.0 → 12.0 | 18.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 228.0 → 236.0 | 188.0 → 183.0 | 170.0 → 176.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 23.0 | 18.0 → 18.0 | 17.0 → 17.0 |

Result: **PASS**, 0 regressing buckets. These timings cover ordinary Markdown/Git
transitions; they do not measure web Reader rendering or export latency.
[Complete validation and per-repetition measurements](reader-toolbar-removal-validation-2026-10-15.json)
retain the build/harness identities and raw log paths, including the interrupted
check of the superseded UI.

## Python language support validation, 2026-10-15

The final implementation keeps Monaco 0.56.0 and adds lazy Python providers with
bundled Pyright 1.1.414. Full unit validation passed **704 tests in 101 files**.
The preview gate passed build/typecheck, **298 focused unit tests**, three
comparator tests and **103 real Electron scenarios**, without retries or skips.
Eight CI policy tests also passed. A final Linux x64 unpacked release package
rendered Markdown, opened the editor and received Python diagnostics from its
bundled server. Windows packaged execution was not tested locally.

Earlier build attempts were interrupted during the memory-exhaustion incident.
After resuming, builds and heavy checks ran serially inside systemd scopes with
4 GiB RAM and 512 MiB swap limits; Node build heaps were capped at 2304 MiB.
GUI runs used isolated Xvfb, runtime directories and D-Bus sessions. The baseline
and candidate used the same benchmark scope and display; no build ran during
measurement. These resource limits do not change production application policy.

The independently installed baseline is
`bf464956ed12ce64453eb461426f1544b697be6b`; both versions use Electron 44.7.2.
Three matched repetitions alternated AB/BA order, retaining all eight scenarios,
five cycles and 48 comparisons with the unchanged 25% **and** 50ms thresholds.
Values are **baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 39.0 → 53.0 | 26.0 → 19.0 | 21.0 → 22.0 |
| document | 0ms | false | Double-click → editor | 18.0 → 23.0 | 36.0 → 38.0 | 12.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 437.0 → 464.0 | 103.0 → 97.0 | 93.0 → 91.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 21.0 | 15.0 → 13.0 | 13.0 → 12.0 |
| document | 3000ms | false | Esc → latest capture | 47.0 → 41.0 | 15.0 → 19.0 | 20.0 → 24.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 13.0 → 13.0 | 11.0 → 12.0 |
| document | 3000ms | true | Esc → latest capture | 109.0 → 108.0 | 97.0 → 92.0 | 91.0 → 93.0 |
| document | 3000ms | true | Double-click → editor | 20.0 → 17.0 | 17.0 → 13.0 | 15.0 → 15.0 |
| review | 0ms | false | Esc → latest capture | 1388.0 → 1070.0 | 29.0 → 20.0 | 28.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 22.0 | 12.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 1085.0 → 1149.0 | 1601.0 → 1682.0 | 178.0 → 174.0 |
| review | 0ms | true | Double-click → editor | 23.0 → 22.0 | 20.0 → 21.0 | 17.0 → 16.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 31.0 | 20.0 → 15.0 | 19.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 24.0 → 24.0 | 11.0 → 11.0 | 17.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 229.0 → 233.0 | 184.0 → 183.0 | 170.0 → 179.0 |
| review | 3000ms | true | Double-click → editor | 24.0 → 21.0 | 19.0 → 18.0 | 17.0 → 16.0 |

Result: **PASS**, 0 regressing buckets. This establishes the existing
Markdown/Git transition gate, not large-project indexing, completion latency,
or browser responsiveness under language-server load. All timing samples,
identities and comparisons are retained in
[the validation record](lsp-preview-benchmark-2026-10-15.json). Raw benchmark logs
and protocol traces remain in `test-results/lsp-preview-benchmark-2026-10-15`;
final build, unit, GUI and package logs are in
`test-results/lsp-final-validation`.

## C/C++ language support validation, 2026-10-15

Saved C/C++ files now use installed clangd alongside bundled Python/Pyright.
The final full unit run passed **710 tests in 103 files**. The preview contract
passed build/typecheck, **304 focused unit tests**, three comparator tests and
**106 real Electron scenarios**, with no retries or skips. clangd 22.1.0 on Linux
was exercised with real compilation commands, `.clangd` defines, headers,
unsaved diagnostics, completion, hover/references, rename/Undo, UTF-16 edits,
independent buffers, missing-executable recovery, persistence and restart.
Windows packaged clangd was not tested. These are small-project checks, not a
large-project indexing or completion-latency guarantee.

Initial chooser test failures came from removing the command-palette `>` prefix
and using `require` in an Electron evaluation context without it. Corrected
tests assert the actual command entry, execute it, verify the persisted path
and receive real diagnostics. Initial and final logs are retained in
`test-results/clangd-validation-2026-10-15`.

Heavy checks ran sequentially with 4 GiB RAM, 512 MiB swap and a 2304 MiB Node
heap limit. GUI checks and measurements used isolated Xvfb, runtime and D-Bus.
The independent baseline is `f2e88c07df87775954f627f6b6946b6bf27d5c38`, with its
own `npm ci` installation and build. Lockfiles match; both use Electron 44.7.2.
Three matched repetitions alternated AB/BA on one display, preserving all eight
scenarios, five cycles and the unchanged 25% **and** 50ms thresholds.
Values below are **baseline → candidate medians in milliseconds**; warm is
cycles 3–5. No builds or other heavy checks ran during measurement.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 39.0 | 22.0 → 23.0 | 20.0 → 18.0 |
| document | 0ms | false | Double-click → editor | 19.0 → 18.0 | 34.0 → 36.0 | 12.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 382.0 → 387.0 | 100.0 → 93.0 | 87.0 → 83.0 |
| document | 0ms | true | Double-click → editor | 22.0 → 19.0 | 15.0 → 15.0 | 13.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 39.0 → 39.0 | 22.0 → 24.0 | 18.0 → 26.0 |
| document | 3000ms | false | Double-click → editor | 17.0 → 16.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 107.0 → 109.0 | 108.0 → 99.0 | 83.0 → 100.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 21.0 | 12.0 → 16.0 | 15.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 973.0 → 950.0 | 21.0 → 28.0 | 19.0 → 21.0 |
| review | 0ms | false | Double-click → editor | 23.0 → 24.0 | 11.0 → 11.0 | 12.0 → 13.0 |
| review | 0ms | true | Esc → latest capture | 1024.0 → 1005.0 | 1460.0 → 1537.0 | 178.0 → 178.0 |
| review | 0ms | true | Double-click → editor | 20.0 → 22.0 | 20.0 → 22.0 | 17.0 → 21.0 |
| review | 3000ms | false | Esc → latest capture | 24.0 → 25.0 | 22.0 → 23.0 | 18.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 23.0 | 11.0 → 10.0 | 17.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 228.0 → 229.0 | 183.0 → 181.0 | 177.0 → 178.0 |
| review | 3000ms | true | Double-click → editor | 23.0 → 21.0 | 18.0 → 19.0 | 19.0 → 18.0 |

Result: **PASS**, 0 regressing buckets across 48 comparisons. These timings cover
ordinary Markdown/Git transitions, not C++ indexing or completion. The
[validation record](clangd-preview-benchmark-2026-10-15.json) retains every cycle,
comparison, build/source identity and check result. Raw measurements remain in
`test-results/clangd-preview-benchmark-2026-10-15`.

## 2026-10-15 declarative language registry validation

Implemented user-wide server definitions/selection and the lazy
`Edit → Language Support…` screen, preserving existing models and legacy clangd
selection. The offline catalog is a pinned Mason snapshot, not an automatic
installer or a blanket compatibility claim. [Setup and limits](language-support.md).

Final checks on Linux, with GUI execution isolated by `with-isolated-display.sh`:

- Full desktop unit suite: **104 files / 721 tests passed**.
- `npm run test:preview-contract`: **50 unit files / 323 tests**, three comparator
  tests, build/typecheck (zero Svelte errors/warnings), and **107 Electron scenarios
  passed**. The new shared-model coverage preserves Undo without requiring DOM
  event registration when the optional language integration is absent.
- Real rust-analyzer `0.3.3081-standalone`: explicit integration test passed on the
  final build, covering completion, hover, native syntax diagnostics, definition,
  rename/Undo and restart through the generic registry. No gopls runtime claim.
- Validation logs and management screenshot: `test-results/language-support-validation/`.

Comparative baseline: **8831961d30c6ddec0cb47982d3228031b6765a3e**, in an independent
installed checkout. Ran three repetitions per version, alternating AB/BA/AB, on
the same isolated display. Both versions were rebuilt by the benchmark runner.
Heavy checks ran sequentially with `MemoryMax=4G`, `MemorySwapMax=512M` and
`NODE_OPTIONS=--max-old-space-size=2304`; no retry or tolerance changes.

All eight scenarios and **48 comparisons passed; zero regressions** at the
existing joint thresholds (>25% and >50ms). The table gives median milliseconds
**baseline → candidate**, with the source preparation wait explicitly separated.
First/second are individual cycles; warm is the median of cycles 3–5 per run.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 33 → 36 | 25 → 24 | 24 → 22 | 33 → 21 | 40 → 39 | 12 → 11 |
| Markdown | 0ms | yes | 478 → 414 | 104 → 103 | 97 → 87 | 21 → 16 | 17 → 13 | 17 → 15 |
| Markdown | 3000ms | no | 30 → 41 | 19 → 19 | 22 → 25 | 18 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 108 → 98 | 98 → 110 | 90 → 93 | 20 → 16 | 13 → 17 | 16 → 14 |
| Git review | 0ms | no | 1002 → 1020 | 26 → 24 | 27 → 28 | 23 → 22 | 12 → 12 | 12 → 13 |
| Git review | 0ms | yes | 1107 → 1085 | 1604 → 1598 | 179 → 177 | 14 → 23 | 21 → 20 | 19 → 18 |
| Git review | 3000ms | no | 28 → 23 | 23 → 23 | 16 → 17 | 23 → 23 | 12 → 12 | 18 → 17 |
| Git review | 3000ms | yes | 233 → 229 | 182 → 189 | 179 → 175 | 22 → 23 | 18 → 19 | 17 → 17 |

[Comparison summary, samples and artifact hashes](language-registry-preview-benchmark-2026-10-15.json).
Raw captures, per-run logs and the complete report remain in
`test-results/language-registry-benchmark-2026-10-15/`. Latest-content assertions
were required for edited captures. These small-document measurements retain the
existing timing limitations and do not establish large-project LSP performance.


## Explorer file operations validation, 2026-10-15

Final functional checks: **109 unit files / 744 tests**, and the full
`test:preview-contract` gate with **56 files / 353 tests**, three comparator
checks, build/typecheck (zero Svelte errors/warnings), and **111 real Electron
scenarios passed**. The seven Explorer scenarios include the original native
pointer/multi-selection coverage and four new clipboard, conflict, inline-name
and failed-trash scenarios. All GUI runs used isolated Xvfb/runtime/D-Bus.

The first full Electron run had **110 passes / one failure**: the existing
website-draggable-CSS test observed `drag` on an iframe. A single baseline run
and five independent candidate diagnostic runs passed; the final full gate also
passed. The browser policy and that assertion were unchanged. The intermittent
failure is retained as an unresolved diagnostic observation, not described as a
fixed Explorer regression. Logs are in `test-results/explorer-validation/`.

The independent, separately installed baseline is
`12a234033dc62019be3c8ef15067d40a4e907218`. Both builds use Electron 44.7.2.
Heavy checks ran sequentially with `MemoryMax=4G`, `MemorySwapMax=512M` and a
2304MiB Node heap. Baseline and candidate use the same isolated display and
settings within each comparison batch. No scenario/assertion/retry/tolerance
changes were made.

Performance evidence includes the failed initial comparison:

- Initial **three matched repetitions: FAIL, two regressing buckets**. Markdown,
  immediate first Esc after editing: **326 → 440ms**. Git review, immediate first
  Esc without edits: **973 → 1225ms**. These samples were not discarded.
- A separate Chromium trace placed the ordinary show request at approximately
  0ms in both apps; native layout/preparation and capture dominated the cold
  delay. The preview bridge and review worker artifacts were byte-identical.
  Trace runs include diagnostic probes and are **excluded from gate samples**;
  they do not establish the cause of the initial difference.
- Before further measurements, the follow-up was fixed at **five additional
  matched repetitions**, using the same builds, harness, fixtures and thresholds.
  That five-pair batch passed all 48 comparisons. It used the runner's
  `--skip-build` option only after both original artifact hashes were verified.
- Re-evaluating **all eight repetitions**, including every initial sample, also
  passes **48 comparisons, zero regressions** at the unchanged joint thresholds
  (>25% and >50ms). No production code changed between these two batches. The
  checked-in record includes each batch's outcome, all eight per-bucket samples,
  artifact identities and hashes of the changed/new source files.

Median milliseconds below are **baseline → candidate** across all eight
repetitions. First and second are distinct cycles; warm is the median of cycles
3–5 within each process, then across processes. Source wait is listed separately.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39.5 → 35.5 | 19 → 20 | 20.5 → 21.5 | 17.5 → 17 | 35.5 → 33 | 11 → 12 |
| Markdown | 0ms | yes | 429.5 → 437.5 | 101 → 105.5 | 91 → 93.5 | 18.5 → 19.5 | 14.5 → 14 | 15 → 13 |
| Markdown | 3000ms | no | 42.5 → 40 | 20.5 → 20 | 24.5 → 25.5 | 17.5 → 16.5 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 108 → 108.5 | 94.5 → 102 | 90.5 → 92 | 17.5 → 17.5 | 15.5 → 15.5 | 14.5 → 14.5 |
| Git review | 0ms | no | 942 → 939 | 21.5 → 19.5 | 28 → 24.5 | 24 → 22 | 11 → 11 | 12.5 → 12 |
| Git review | 0ms | yes | 1013.5 → 1042.5 | 1497.5 → 1565.5 | 175 → 181 | 25.5 → 22.5 | 19.5 → 20.5 | 18.5 → 19 |
| Git review | 3000ms | no | 28 → 24.5 | 21.5 → 22 | 18 → 17.5 | 23.5 → 24 | 11 → 11.5 | 17.5 → 17.5 |
| Git review | 3000ms | yes | 229.5 → 229 | 188 → 187 | 176.5 → 177 | 21.5 → 22.5 | 18 → 19 | 18 → 17 |

[Comparison summary, samples and validation metadata](explorer-preview-benchmark-2026-10-15.json).
Full raw records are in `test-results/explorer-benchmark-2026-10-15/` and
`test-results/explorer-benchmark-expanded-2026-10-15/`; the combined record and
logs are in `test-results/explorer-validation/`. Separate Chromium traces are in
`test-results/explorer-performance-diagnostic/`. These results cover Markdown/Git
transitions; they do not establish large-tree or large-copy throughput, and do
not prove the initial cold-path variation cannot recur.

## Installed language-server discovery validation, 2026-10-16

Final functional checks: **110 unit files / 761 tests**, including a real login
shell exposing an executable through a path containing spaces and Korean text;
**57 preview-contract unit files / 369 tests**, three comparator checks,
build/typecheck with zero Svelte errors/warnings, and **112 real Electron
scenarios passed**. The additional real-server gate passed **two scenarios**:
fortls 3.2.2 auto-connection, hover/completion and Rescan; rust-analyzer
0.3.3081-standalone with Rust 1.95.0 completion, hover, diagnostics, navigation,
rename/Undo and restart. The full unit run includes the additional login-shell
case added after the preview-contract unit phase. GUI runs used isolated
Xvfb/runtime/D-Bus; no test window used the desktop display.

Discovery regression coverage includes missing executables, disabled/manual
choices, old custom fortls definitions, PATH priority, ambiguous candidates,
Python scripts queries, environment/output limits, cancelled results, close while
discovering, Rescan while discovering, latest unsaved text and Undo. New documents
reuse a live workspace session after Rescan changes its future launch plan;
unrelated settings changes preserve healthy server processes. gopls real-server
behavior and Windows execution were not exercised by this Linux run.

The independently installed baseline is
`6b0db3c3ce0b7c18383e4292f57b8dba24849a39`; both apps use Electron 44.7.2.
Two batches of five matched repetitions alternate baseline/candidate order on
one isolated display within each batch, with eight fresh-app scenarios and five
cycles each. No harness, correctness assertion, retry count or tolerance was
relaxed. The benchmark
includes first, second and warm cycles separately and checks current edited
content before capture. Source preparation wait remains separate from measured
input latency; Esc includes capture readback, not a monitor presentation timestamp.

The initial five-pair comparison failed one bucket: ordinary Markdown, no edits,
immediate first Esc, **35 → 121ms**. All eight scenarios and correctness checks
completed; this was a timing failure, not an incomplete measurement. Its five
baseline samples were 35, 22, 26, 50, 55ms, and candidate samples were
121, 60, 121, 41, 127ms. Those samples remain part of the final aggregate.

A separate diagnostic trace found immediate show requests in both versions
and first captures of 20ms and 62ms. Preview bridge, render/review workers and
CSS were byte-identical; Crossnote, KaTeX and Monaco versions also matched.
These observations do not establish the cause of the initial timing difference.
Traces include probes and are excluded from performance samples.

Before further measurement, the follow-up was fixed at five additional matched
repetitions. Original build hashes were verified before using `--skip-build`.
No production code changed between batches. The aggregate uses all ten matched
repetitions, including every initial sample, with unchanged thresholds. Each
batch's separate outcome is retained in the comparison record.

Combined comparison result: **PASS — 0 regressions across 48 buckets**, at the
unchanged joint thresholds (>25% and >50ms).

Median milliseconds below are **baseline → candidate**. Warm means the median
of cycles 3–5 in each app, then the median across repetitions.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39 → 53.5 | 24 → 27 | 22.5 → 21.5 | 36.5 → 22 | 37.5 → 35.5 | 11.5 → 12 |
| Markdown | 0ms | yes | 464.5 → 447 | 101 → 103 | 91 → 91.5 | 21 → 21 | 17 → 13.5 | 15 → 14.5 |
| Markdown | 3000ms | no | 42 → 41 | 22.5 → 21.5 | 22 → 23 | 16 → 16 | 12 → 12 | 11 → 11 |
| Markdown | 3000ms | yes | 107.5 → 100 | 101.5 → 98 | 94.5 → 92 | 17 → 20 | 16 → 14 | 13 → 13 |
| Git review | 0ms | no | 994 → 1005 | 19 → 21 | 27.5 → 29 | 23 → 22.5 | 11.5 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1069 → 1046.5 | 1576.5 → 1541.5 | 179 → 177 | 23.5 → 22 | 21.5 → 22 | 20 → 18.5 |
| Git review | 3000ms | no | 26 → 28 | 21 → 21.5 | 17.5 → 18 | 25 → 24 | 11.5 → 11 | 17 → 17 |
| Git review | 3000ms | yes | 228.5 → 230.5 | 185 → 189 | 175.5 → 178 | 22 → 22.5 | 18 → 17.5 | 16 → 18 |

[Comparison samples, identities and source hashes](lsp-discovery-preview-benchmark-2026-10-16.json).
Full raw records are in `test-results/lsp-discovery-benchmark-2026-10-16/` and
`test-results/lsp-discovery-benchmark-followup-2026-10-16/`; combined data and
functional logs are in `test-results/lsp-discovery-validation/`. Traces are in
`test-results/lsp-discovery-diagnostic/`. These results cover ordinary Markdown/Git
transitions, not large-project LSP indexing or
network-filesystem discovery latency. They do not prove the initial first-cycle
variation cannot recur.

## Catalog-wide language discovery validation, 2026-10-16

The generated catalog contains 384 entries and 195 connection profiles. Every
entry participates in installation discovery; 142 of the 331 Mason entries have
profiles and 189 still require connection metadata. The importer is offline,
checksum-pinned and reproducible. Profile presence is not a blanket compatibility
claim for every server or every protocol capability.

Validation passed **111 unit files / 772 tests**, **58 contract unit files / 381
tests**, three comparator tests, build/typecheck with zero Svelte errors/warnings,
and **113 real Electron scenarios**. After the small final refinement to select
an installed entry when opening Language Support, the final build reran **all
three management scenarios**, including that initial choice, plus **two real
fortls/rust-analyzer scenarios**. GUI tests used isolated Xvfb/runtime/D-Bus and
never used the desktop display.

Coverage includes imported variants and exact names/globs, independent Ada/GPR
launch arguments, C#/F# solution root patterns, persisted disabling/custom
connections, installed-primary ambiguity, main-owned candidate selection, npm
bin/runtime lookup and one shared custom-prefix query, cancellation and metadata
limits. The Electron npm fixture verifies an unconfigured TypeScript file connects
and completes through an imported profile, survives Rescan on the same process,
and retains Undo. It validates Setdown's protocol/launch integration; it does not
run the actual upstream TypeScript server. Real servers cover Pyright/clangd in
the contract and fortls/rust-analyzer in the additional gate.

The independently installed baseline is
`4b1683f6fbb25039e2ed13cd3c43df8414f62439`; baseline and candidate both use
Electron 44.7.2. Each was separately built before the comparison. `--skip-build`
reused those builds; the harness recorded and verified both artifact hashes.
Five matched repetitions alternate execution order on one isolated display.
All eight scenarios, five cycles, real double-clicks and latest-content captures
were retained. No retry, assertion or tolerance was relaxed.

Comparison: **PASS — 0 regressions across 48 buckets**, using the
existing joint thresholds (>25% and >50ms).

Median milliseconds are **baseline → candidate**. Warm is cycles 3–5 within each
app, then the median across repetitions. Preparation wait is separate from input
latency; Esc includes native capture/readback, not a monitor presentation timestamp.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 48 → 44 | 19 → 25 | 24 → 19 | 16 → 16 | 32 → 34 | 12 → 12 |
| Markdown | 0ms | yes | 432 → 423 | 102 → 107 | 92 → 90 | 19 → 17 | 13 → 14 | 15 → 12 |
| Markdown | 3000ms | no | 38 → 40 | 21 → 20 | 19 → 20 | 16 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 109 → 107 | 102 → 105 | 88 → 89 | 19 → 19 | 13 → 13 | 15 → 14 |
| Git review | 0ms | no | 906 → 969 | 20 → 20 | 26 → 27 | 23 → 23 | 12 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1031 → 1043 | 1502 → 1498 | 176 → 175 | 25 → 24 | 22 → 20 | 19 → 18 |
| Git review | 3000ms | no | 27 → 27 | 23 → 24 | 17 → 19 | 24 → 23 | 11 → 11 | 16 → 16 |
| Git review | 3000ms | yes | 226 → 228 | 178 → 182 | 177 → 176 | 21 → 21 | 18 → 19 | 17 → 17 |

[Samples, identities, coverage and source hashes](lsp-profiles-preview-benchmark-2026-10-16.json).
Raw records are in `test-results/lsp-profiles-benchmark-2026-10-16/`; functional
logs are in `test-results/lsp-profile-validation/`. The baseline checkout is on
disk under that validation directory: stale previous /tmp checkouts were removed
after an initial temporary-filesystem quota failure, and the incomplete baseline
install was replaced with a clean independent npm install before measurement.
These measurements cover Markdown/Git transitions, not large-project LSP indexing,
Windows execution, or slow/network-filesystem discovery latency.
