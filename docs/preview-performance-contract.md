# Preview performance contract

The 2026-10-22 audit fixes and their execution evidence are recorded in
[Audit fix validation](validation/2026-10-22-bug-audit-fixes.md). Local-link URL
resolution, visible Unicode search, and draft revision/asset preservation are
covered by the linked reading-surface/workspace contracts and regression tests.

This is the maintained contract behind `57729a8b0c738aa7ed4580408cbaedde1f6d5fd2`
and `d77e6526e89d009ef12842d133ac27a43b84d607`. Those commits optimize math-heavy
Markdown, particularly the first two Esc → double-click cycles. Correct-looking
output alone does not establish that this contract still holds.

Paths below are relative to `apps/desktop`. The actual fixture is
`test/fixtures/sample.md` (not `test/e2e/fixtures/sample.md`). The candidate harness
copies this same fixture into both applications' temporary projects. Electron,
Crossnote and CSS changes are in scope
even if no preview TypeScript changes.

The linked contracts below are part of this contract. Read the matching feature
contract before changing its behavior. Dated execution evidence is kept separately
from current guarantees; moving it does not remove any required scenario.

Responsive media sizing must preserve KaTeX's calculated SVG heights. Braces,
accents, radicals and extensible arrows use SVG viewBoxes that are not image
aspect ratios. `preview/stretchy-math.spec.ts` checks their geometry and actual
brace pixels in light/dark Electron readers, along with responsive authored SVGs.

Bracket math (`\(...\)` and `\[...\]`) is supported alongside dollar math.
Doubled bracket delimiters identify pasted math with an extra Markdown escape
layer; recovery is limited to those math tokens. Ordinary TeX escapes, code,
links and prose are unchanged. Adjacent display formulas and text after their
closing delimiter must survive parsing. Source text, line/column anchors and Undo
remain original; normalization runs in the render worker before existing cached
KaTeX/deferred rendering. `src/main/preview/math-compat.ts` owns this adapter to pinned
Crossnote. `math-compat.test.ts`, `source-anchors.test.ts` and the real ordinary/Git
`preview/math-compat.spec.ts` cover the AUROC example, TeX rows/subscripts, code
exclusion, native math double-click, edits and Undo. Existing preparation, focus,
IME and latency guarantees and tolerances remain unchanged.

## Guarantees and ownership

Language Support's left sidebar is app settings: download policy, language
defaults, custom connections and advanced installation management. Home does not
scan executables or start tools. Runtime status, environment selection, output and
restart belong to the owning document's Code support. A language without a primary
analyzer (including Make) retains grammar/editing support without borrowing an
environment from a disabled supplementary profile. App defaults preserve explicit
project choices and unaffected live sessions; resetting a project to the app
default preserves shared options. Global changes must preserve model identity,
unsaved text and Undo. `language-manager.test.ts`, `server-registry.test.ts`,
`language-provisioner.test.ts` and `language/document-analysis-ui.spec.ts` cover
these guarantees; `language/language-support.spec.ts` retains real crash recovery
and restart through the document controls. Existing preview timing, native capture
and focus/IME guarantees remain unchanged.

Memory reclamation is app-wide (`main/memory/memory-monitor.ts` and
`core/memory/memory-policy.ts`). Linux uses process-tree PSS, MemAvailable, memory
pressure stalls and ancestor cgroup limits; other platforms use Electron working
sets and OS free memory. The soft application budget is 18% of usable memory,
bounded to 768 MiB–3 GiB. Visible groups and in-flight preparation remain protected;
this is a reclamation trigger, not a hard cap on active documents or websites.

Inactive native Markdown and Git readers can be discarded after 10 minutes,
2 minutes under moderate pressure, or 30 seconds under critical pressure. Git's
two buffers share protection. Renderer cache metadata is invalidated when a view
is discarded; return recreates the reader from the current document revision,
retaining source models, Undo and reading positions. Warm transitions within the
grace period retain their identity and all existing focus/IME guarantees. Cold
returns after eviction are allowed to take preparation time. Unacknowledged shell
contexts are protected. `preview-presentation.test.ts` and `browser/memory.spec.ts`
cover protection and cold recovery.

The app retains at most two spare native readers in normal conditions and none
under pressure. Main's HTML RAM cache is limited to 32 MiB, with private disk
backing in the profile's `preview-cache` (not a potentially RAM-backed `/tmp`).
Navigation and PDF export hold leases; live URLs remain readable after RAM
eviction. Old unleased versions expire, exit removes the session directory, and
startup removes interrupted-session residue. Worker block history is capped at
64 MiB/32 entries, visible search indexes at 16 MiB/128 entries, and Crossnote
retention at four folder/theme notebooks with four engines each. Cache misses
must produce complete current HTML instead of patches against discarded bases.
`byte-cache.test.ts`, `preview-html-store.test.ts` and the existing render-output
tests cover eviction behavior.

Idle render/review workers exit after five minutes (one minute under pressure);
search workers exit after two minutes (15 seconds under pressure). Pending jobs
prevent termination, and an old worker's exit cannot reject a new worker's jobs.
Memory-pressure recovery needs 30 seconds of sustained headroom. Under pressure,
hidden PDF/image surfaces unmount; every visible group's surface stays pinned.
The media cache tests preserve latest-position restoration and visible identity.
The ordinary/Git eight-scenario comparative latency gate and its tolerances are
unchanged.

Local Reload and external-change reconciliation must preserve these guarantees:
only the current document revision can invalidate/install preview content, and
neither action restarts the shell or steals focus from another tab. File-drop
feedback is transient and does not cover the reading surface. The workspace
contract describes dirty-buffer and cancellation behavior.

Renderer builds prepare worker entries sequentially before Rollup to bound peak
memory. Workers remain lazy local assets; their real Chromium execution is still
required. `SETDOWN_BUILD_SOURCEMAP=0` omits renderer debug maps for memory-limited
validation; use the same setting for both baseline and candidate and record it.
This does not reduce scenarios, assertions or runtime content. Resource-limited
runs must fail rather than silently retry or fall back to the user's display.

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
Inline external PDFs share this reader and cache; their current navigation token
also participates in surface identity. The native browser view retains history
but stays hidden while the shell PDF reader is active. Authentication cookies,
bounded reads, cancellation, original-byte saving and the external-PDF Electron
scenarios are described in [PDF documents](reading-positions-and-pdf.md).
`pdf-selection.spec.ts` covers the pointer and both copy paths in Electron.
Set `SETDOWN_TEST_PDF_FILE` to an absolute PDF path when running that test to
repeat the same visual and clipboard checks against a real document; it copies
the file into its temporary workspace before opening it.

Content zoom belongs exclusively to the workspace tab ID. Website, web Reader,
Markdown/source, code/plain text, notebooks, PDF/image (including image editing),
video and terminal surfaces all consume that same value. Address navigation and
Back/Forward and Explorer preview replacement retain it when the tab's resource or surface changes. Files of the
same type and different views of the same file do not share zoom. The two panes
of a Git review share its review tab's factor, including the two image versions.
Image comparisons are shell-rendered, read-only views of bounded version bytes;
they do not change Markdown preparation, model ownership or native bounds.
Their Fit control publishes a common tab percentage and their numeric/wheel
controls leave Fit, as ordinary image tabs do. Seti file icons in Explorer/SCM
use a local font and static associations without loading an editor or reading
file contents. `git/image-diff.spec.ts` and `project/file-icons.spec.ts` cover
these surfaces; all existing transition and timing guarantees remain required.
Transferred tabs retain their ID
and factor. A newly allocated file tab starts at that document's last recorded
percentage, or 100% without history. Each zoom change and tab/window close records
the current percentage. Navigation records both the outgoing and incoming file
at the retained tab percentage. Main
process event order decides the latest value across independent tabs/windows;
ordinary rendering, focusing and scrolling do not overwrite it. Existing tab
navigation (including Explorer preview replacement) never reapplies file history.
File history persists across restarts without time-based or recent-file eviction,
separately from reading positions; neither this history nor another tab's changes own a live tab's zoom.
Initial zoom is resolved before mounting a new file's editor/reader/media surface.

Ctrl+plus/minus and Ctrl+0 still change/reset persisted app zoom in every window.
Ctrl+wheel/pinch and location controls address only the pointed-to tab. Native
previews compose app × tab zoom (within Chromium's native 25–500% effective zoom
limits); native bounds use app zoom alone. All tab surfaces store 10–1000% (including fractional fit values), so changing
resource type does not change the stored percentage. Native Chromium rendering
clamps effective zoom to 25–500%; that platform limit does not rewrite tab state. App zoom retains its existing 50–300% range.

PDF/image 100% means original size. Fit controls explicitly calculate and publish
the corresponding tab percentage, within the common bounds. Fit mode continues
recalculating on viewport changes while that surface is active; leaving it carries
the resulting number to the next resource. Numeric controls and wheel/pinch leave
fit mode. Cursor anchors, worker/canvas/model identity, rotation, reading positions,
Undo and focus must survive zoom. Synchronous media geometry updates reconcile
only the latest acknowledged request, so rapid gestures cannot rewind to an older
IPC snapshot. Cached inactive surfaces never publish fit changes.

Legacy text/terminal preference fields remain readable but cannot seed new tabs.
The former global code preference is ignored; former website-only settings migrate
to their tab (an existing canonical tab value wins). `workspace-zoom.test.ts`,
`text-zoom.test.ts`, `workspace-zoom.spec.ts`, browser navigation/reader/transfer
and media reading-position tests cover ownership, migration, ordering and isolation.

Native targets use [Electron's isolated zoom mode](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoommodemode) so two pages on the same origin
can have different factors. Native bounds still convert with **app zoom only**.
Changing zoom must not navigate, replace models, discard undo history or focus
hidden previews. Unchanged native factors are not reapplied when another tab's
factor changes. Terminal font updates refit the PTY through the ordered resize
path. `workspace-zoom.test.ts`, `workspace-zoom.spec.ts`, `test/e2e/browser/*.spec.ts` and
`terminal.spec.ts` cover scope, composition, tab independence, and reset.
The View menu uses the same coordinator for app zoom. Content zoom resets use
the percentage control in each tab's location bar; the separate text and terminal
reset menu items are removed. `workspace-zoom.spec.ts` checks their absence and
retains app reset and independent tab reset coverage.

Touchpad pinch follows the content under the pointer, without requiring the
Control key. Fine pixel input, including Chromium's trusted pinch-derived wheel events,
changes the tab factor continuously using its logarithmic scale, without a
dead zone or reliance on deprecated wheel tick metadata. Coarse Ctrl+wheel
retains its existing notch scale. Fractional tab factors survive persistence.
Residual input must not carry between tab owners. Notebook outputs and video surfaces participate too;
PDF/image pinches change that same tab factor with cursor-anchored geometry. Shell/app zoom,
other tabs, live page identity, and editor models remain unchanged. The zoom,
browser, and video Electron tests use `Input.synthesizePinchGesture` with the
mouse source, exercising Chromium's touchpad-to-wheel conversion without a
Control key or synthetic DOM event. Physical device/OS gesture delivery is not
established by those automated tests. Dated results, including five consecutive
short pinches and the full latency comparison, are in
[Touchpad pinch validation](validation/2026-10-17-touchpad-pinch.md).

On Linux X11/XWayland, `main/windows/x11-pinch.py` subscribes to XI 2.4 pinch
events on each owned native window. The main-process adapter locks each gesture
to the pointed-to surface and translates absolute scale into continuous wheel
samples, accounting for native content zoom. It does not grab devices, read global
input, synthesize Control key presses or change focus. Native Wayland and other
platforms retain Chromium's gesture path. The helper requires system Python 3,
libX11 and libXi; unsupported XI versions leave ordinary input working.
`workspace/input-regressions.spec.ts` checks a live isolated X11 subscription and
decoded gesture routing through real Chromium, including reverse zoom. This is
additional bridge coverage, not a claim of physical touchpad reproduction.

Korean strong emphasis permits punctuation immediately inside `**` adjacent to
Hangul, including `**'정책'**이`, `**(정책)**은` and `**90%**가`. The render-worker
extension in `main/preview/korean-emphasis.ts` uses Markdown-it delimiter pairing;
it never rewrites document bytes or source offsets. Code, escapes, link targets,
single/triple-star delimiters and ordinary CommonMark behavior remain unchanged.
Unit cases and `preview/korean-emphasis.spec.ts` cover ordinary Markdown, Git
review and notebook rendering with byte-for-byte source preservation.

App typography uses the locally installed D2Coding family with a monospace
fallback across shell controls, ordinary/Git editors, terminals, and Markdown
body, heading, and code styles in every theme. Math and diagram renderers retain
their specialized fonts. Notebooks intentionally use a separate content/UI font
stack for prose and HTML tables; their code and plain-text outputs use Monaco's
platform-default monospace font, matching VS Code notebooks. This notebook-only exception and its real Electron coverage are
specified in [the notebook reading contract](contracts/notebook.md#reading-and-interaction-hierarchy--2026-10-30).
Preview font overrides are present during hidden
preparation and remain applied when themes change. `document-preparation.spec.ts`
and `review-document-styles.spec.ts` check the computed text font alongside the
existing real math geometry comparisons. Hidden theme updates use main's native
presentation state: a never-shown view can report DOM visibility as "visible"
while its animation frames are suspended. Theme completion must not wait for
those frames, and a spare finishing navigation must reconcile the current theme
before adoption. `theme-controller.test.ts`, `preview-presentation.test.ts`, and
`preview-reading-tools.spec.ts` cover these cases without showing or focusing
hidden readers.

Terminal colors use a separate 16-color ANSI palette for each app theme and
xterm's 4.5 minimum contrast correction. Theme changes update the existing
terminal instance; they must preserve its PTY, unsubmitted input and buffer.
Extended indexed/truecolor and explicit backgrounds still flow through xterm's
renderer. Terminal E2E measures actual DOM color contrast for every registered theme
and checks PTY and renderer identity. Browser theme and live-drag guarantees are
specified in the workspace contract; they remain in this gate and latency comparison.

Terminal history and application-mode input are specified in
[Terminal search](integrated-terminal.md#terminal-search). Normal and headless
buffers share a 50,000-line retention limit and preserve ED2-erased normal output;
explicit ED3 still clears history. The terminal-only scrollbar stays visible and
application wheel delivery preserves distance. Alternate-screen Ctrl+F belongs
to the running app; terminal find labels its current-screen scope. The terminal
screen unit tests and `terminal/search.spec.ts` cover these intentional changes,
including snapshot restoration, wheel protocols, search and IME/focus boundaries.
These terminal-only controls do not change ordinary/Git preview presentation,
bounds, preparation, zoom or performance thresholds.

VS Code Dark 2026 is an additional choice; existing theme palettes and the default
remain unchanged. Its 324 workbench colors and ordered token rules are pinned to
VS Code 1.143.0 (`2d0b7506a36c1d6db9a466440131a8e01eab2289`), including inherited
Dark Modern/Dark+ rules. Source hashes and MIT notices live in
`src/core/theme/upstream/`. Monaco's lexical/LSP roles map to those original
scopes; this does not replace language tokenizers with VS Code extensions.
Shell/menu, ordinary/diff/notebook editor, terminal and web surfaces share that
choice. Markdown readers retain their existing layout with theme-specific colors
over the GitHub Dark base. The override also applies while hidden, without
showing/replacing the native view, and is removed when selecting another theme.
`workspace/vscode-theme.spec.ts` checks actual colors, unchanged editor/reader
identity, Undo, menu selection and restart persistence; existing all-theme
notebook, terminal and browser scenarios include the new choice.

GitHub Dark High Contrast, Night Owl and Dracula are additional imported choices.
Pinned upstream JSON, original licenses and adaptation notices live beside the
VS Code snapshot. Their workbench, ANSI and ordered token palettes feed shell,
Monaco lexical/LSP roles, lazy TextMate grammars and ordinary/Git Markdown
readers; missing app roles use colors from the same palette. Night Owl and
Dracula comment tokens are brightened to retain the existing 4.5:1 notebook/editor
guarantee. Existing choices and the default remain unchanged. Switching between
imports updates the retained reader stylesheet, including while hidden; selecting
a legacy palette removes it. Theme changes preserve native/editor/terminal/page
identity, focus, unsaved content and Undo. The workspace theme and Git document
style E2E tests cover these transitions, colors and restart persistence; the
existing all-theme notebook, browser and terminal checks include all three.

GitHub Light High Contrast is an additional light choice. It uses light
Monaco/TextMate defaults and the GitHub Light reader base with the same retained
theme stylesheet. Source snapshots, pins and licenses live in
`src/core/theme/upstream/`. Its notebook input surface retains the editor
background without a tint. VS Code Light 2026, Light Owl and Atom One Light are
removed from the catalog; saved preferences for these IDs normalize to GitHub
Light. Their dedicated color scenarios are retired with the choices, while
fallback checks cover all three IDs. The workspace theme tests cover the
remaining imports on the real editor and visible/hidden native reader, including
Undo, focus, appearance and restart persistence.
Git document style and all-theme notebook, browser and terminal checks include
these choices. Existing defaults, palettes, layout and preparation guarantees
remain unchanged.

Browser coarse Ctrl+wheel changes tab zoom from 10% to 1000% in 10-point steps;
fine pixel input changes it continuously within those same limits.
The isolated page preload registers the bounded wheel accumulator in each
committed frame after a native owner/frame readiness acknowledgment;
Electron's native `zoom-changed` event handles unconsumed requests. Ordinary
scrolling and synthetic DOM wheel events do not request zoom. Website
zoom belongs to the web tab, including when another tab has the same hostname,
and composes with app zoom without changing other tabs or native bounds. Reloads, tab switches and app zoom updates retain the website factor.
Zoom preserves the live page and forms. The custom content-factor target in
`workspace-zoom.test.ts` and native wheel input in `test/e2e/browser/*.spec.ts` cover these
guarantees. Wheel IPC is accepted only from a visible owned web contents, with
bounded integer steps or finite relative scale factors from 0.5 to 2;
no desktop API is exposed to remote pages.

Every tab's location bar displays decrease, reset percentage, and increase
controls, including 100%. Live web pages and web Reader use the same tab factor.
Reader Ctrl+wheel changes that factor, including for the retained live page.
Entering or leaving Reader preserves the tab percentage and live form state.
Bookmark and reader buttons precede zoom, with the Markdown toolbar icon style;
uBlock stays active and its controls remain available from Browser Extensions.
One transparent Extensions button before the page actions keeps the same width in live web and Reader
mode: entering or leaving Reader must not shift the other location controls.
It opens a compact icon strip, then replaces
it with the selected extension's popup at the same anchor. Both are native
WebContentsViews inside the owner, avoiding compositor placement of separate
windows on Wayland. They do not capture, hide or resize the live web page.
A popup is sandboxed and never a registered browser tab: popup/worker queries must
retain the original web tab and owning window. Its anchor converts CSS pixels to
native DIP with app zoom once. Escape, loss of focus, navigation and owner changes
close it without replacing the page. `browser/extension-runtime.spec.ts` covers
this identity, input, lifecycle, and the connected proxy/download APIs; details
and explicit compatibility limits are in `browser-extension-runtime.md`.
`browser/reader.spec.ts` also checks stationary controls and closing the strip
without focusing or showing the hidden web page in Reader mode.
The Electron test helper enables Chromium sandbox, matching production and
allowing MV3 service-worker preloads to run.
Terminal, video and PDF/image bars use the same tab factor; PDF/image rendering
applies it to the original size (Fit writes the calculated percentage to the tab). Each split's controls
address its own tab. Updates from wheels and menus keep the addressed tab's percentage current; indicators add no native captures, navigation,
or layout polling. `test/e2e/browser/*.spec.ts`, `workspace-zoom.spec.ts`, and
`terminal.spec.ts` cover the toolbar routing alongside the existing zoom checks.

Top-level application menus over live web pages use a transparent, owned native
menu view above the page. They do not capture, hide, pause or replace the page.
Menu/submenu selection, Escape and dismissal preserve the live view and video
frame delivery. `test/e2e/browser/*.spec.ts` verifies advancing video frames while selecting
these menus and unchanged page identity/visibility. The overlay runs only trusted
shell code and validates commands against the owner's current menu entries.

Address history/bookmark suggestions use their own bounded, transparent native
view above the pages. Opening or editing the dropdown must not capture, hide,
detach, resize or replace a web page in any split, including the input's own
split. The shell address input retains keyboard and IME ownership; the native
list accepts pointer selection and follows app zoom. Late show requests are
invalidated by dismissal and owner destruction. `test/e2e/browser/*.spec.ts` exercises
advancing video frames beside Markdown, web Reader and live web content,
unchanged native page bounds/identity, Korean composition, native pointer
selection and keyboard dismissal.
Hiding an empty suggestion list or repositioning it on window resize is a
presentation change, not an address-edit cancellation. Renderer-requested hides
must not echo a native cancellation event that resets its draft to the committed
URL. Mouse-focused typing preserves the draft, caret and IME across matching →
empty → matching queries; explicit Escape and actual focus/tab changes retain
their existing cancellation behavior. The real native-click/slow-typing case in
`test/e2e/browser/*.spec.ts` covers this boundary.

Focus entering the native suggestion view continues the same address edit.
Its focus transition can precede the popup's pointer event, so shell DOM blur
must consult main's native focus before dismissing the list. A late blur reply
cannot cancel a newer edit or a completed selection. `browser/focus.spec.ts`
covers focus before and after pointer press, unedited address clicks in both
live web splits at 130% app zoom, and repeated native selections.

Closing a workspace retires all its browser entries before closing their stable
WebContents handles. Native View accessors are not a lifetime guarantee: audio
and loading events can run during destruction, after `view.webContents` has
become unavailable. Such events must not publish state or revive Places work.
Cleanup is idempotent, and cancelable `before-quit` must not destroy browser
pages. The audible-window close and canceled-close/quit scenarios in
`test/e2e/browser/*.spec.ts` cover resource release and the absence of main-process errors.

Explorer context menus, sidebar action menus, and the Explorer trash confirmation
use the shell's balanced native-overlay lifecycle. Visible Markdown/Git/web views
are replaced with captured content while these controls cover them, including
split groups. Dismissal, menu actions, sidebar hiding, and component removal
restore the same live views; transferring from a context menu to its confirmation keeps the overlay
active. `test/e2e/browser/*.spec.ts` checks overlap, actionable menus, restoration, and
unsaved web input across ordinary Markdown and split Markdown/web panels.

Monaco context menus use that same balanced shell overlay lifecycle across
ordinary, diff and notebook cell editors, including keyboard invocation and
submenus. While the menu is open, captured native panels allow the entire menu
to remain visible and receive pointer input across split boundaries. Dismissal
restores the same page and unsaved form state. `browser/menus.spec.ts` checks
real native mouse selection in the overlapping region and keyboard dismissal.

Website navigation controls styled with Electron's `app-region: drag` must
remain clickable inside web tabs. Only the desktop shell owns native window
dragging. The isolated page preload excludes web document elements and their
`::before`/`::after` regions, including authored inline/important declarations.
`test/e2e/browser/*.spec.ts` covers wide/narrow layouts, reloads and real child-frame clicks.
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

Auto save after returning from source must not briefly move the native reader.
A window's own atomic save holds its file observation until the written disk
version is known, then checks the actual file against that version. It must not
flash an external-change notice. Other windows still receive the change;
concurrent external replacement/deletion and failed saves are reconciled without
a time-based ignore window (`document-save.test.ts`).
`document-preparation.spec.ts` edits a scrolled document, returns with Esc and
observes auto save across 180 Chromium frames. It checks every native bounds
write and external-change notification as well as current content and DOM scroll:
DOM scroll stability alone cannot detect a native reader moving with a transient
shell banner. Reader presentation and preparation retain their existing paths.

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

An Esc transition during Monaco's smooth scroll uses that scroll's requested
destination, not an arbitrary intermediate frame. Complete the pending scroll
through Monaco's saved view state before reading the viewport; do not add an
animation delay or guess from an offscreen cursor. The immediate edited
Ctrl+End/Esc case in `document-preparation.spec.ts` checks the source anchor and
the latest paragraph's actual visible bounds. Hidden preview preparation stays
outside the input path; existing on-demand hydration for requested source lines
outside the installed prefix remains unchanged.

Alt+Z uses VS Code's transient model word-wrap override. Different files retain
independent state across tab/source-reader switches; split views sharing a model
share the override, and side-by-side diff editors synchronize both models.
The next toggle clears the override and inherits the underlying configuration;
ordinary/diff source defaults are unwrapped, matching notebook code. Explicit
display overrides and Alt+Z still select wrapping; the change is only the default.
An initially unwrapped editor must expose a nonempty native input target. Monaco
0.56 computes a negative width from its unwrapped `wrappingColumn`; the scoped
CSS minimum width prevents a zero-width EditContext without replacing it or
changing source layout. Initial visibility, real input and IME checks stay enabled.
The state ends when the model is disposed and never changes document text or Undo.
`renderer/editor/toggle-word-wrap.ts` and `transient-model-properties.ts` port the
upstream action/controller and model-property lifetime; provenance and MIT license
are in their `upstream/` directory. `workspace/word-wrap.spec.ts` verifies real
keyboard input, rendered lines, tab/model lifetime, split/diff synchronization,
notebook-cell isolation, selection, focus, Undo and reader transitions.
Validation on 2026-11-01 passed 788 unit tests, 14 tooling tests, the production
build/typecheck and all 283 isolated Electron scenarios. The independent baseline
comparison completed 80 launches with no regressions across the unchanged 48
timing gates. [First, second and warm results for every scenario](../reports/explorer-git-decorations-2026-11-01/preview-latency.txt)
and [execution evidence](../reports/explorer-git-decorations-2026-11-01/validation.json)
retain the earlier failures and the initial-unwrapped-input diagnosis.
Moving focus between the panes of the active Git review must retain its command
state. `workspace/groups/group-runtime.ts` must not reactivate that same tab and
temporarily clear the review projection; the Alt+Z test presses Esc immediately
after refocusing the other pane to verify this.
Retained review tab switches also publish the selected surface before document
activation IPC. The existing Index/Working Tree first-frame check in
`git/git-review-tabs.spec.ts` must see the newly selected source, even when main
has not yet acknowledged the active document.

The first code/text tab opened in an empty shell restores its saved Monaco view
against the final tab/address-bar geometry before yielding to document-activation
IPC. It must not paint a scroll position clamped to the document end and then
jump to the saved middle. Position recording remains fenced through activation.
`text-workspace.test.ts` covers ordering; `media/reading-positions.spec.ts` samples
the first 30 painted viewports with both a retained and freshly loaded editor.

Opening a Working Tree review binds its live document without presenting or
awaiting the ordinary Markdown reader. New reviews start in Monaco source mode;
ordinary rendering and reading-position settlement must not gate first opening.
The document retains its own surface, position, unsaved text and shared undo
history. `text-workspace.test.ts` and `git-review-first-open.spec.ts` cover first
opening without an ordinary preview and returning to the shared document.

Review views now have independent controllers and presentation ports. Opening
Working Tree creates only the comparison input; shared text belongs to the
workspace document store. Ordinary/review and review/review groups can be visible
at once. `preview-layout-coordinator.ts` aggregates their native rectangles and
visibility, preserving positive bounds, app-only DIP conversion, exact revision
acknowledgments, overlay freezing and hidden preparation's focus/IME isolation.
Review-side native IDs normalize to their owning review tab's zoom factor; separate
review tabs remain separate zoom scopes. This extends the owners and visible-view
cardinality, not the timing guarantees or benchmark tolerances.
`git-review-first-open.spec.ts`, `review-workspace.test.ts`, and
`preview-layout-coordinator.test.ts` cover simultaneous views and lifetime boundaries;
all existing first/second/warm and edited/prepared buckets remain required.
Opening a Working Tree retains its content before mounting the comparison. Its
source editor borrows the shared model through `liveDocumentModels`; it must not
load/activate an ordinary editor as a prerequisite. Native review preparation
and Monaco loading can proceed concurrently. `shared-document-history.test.ts`
checks model ownership without an ordinary editor; the cold benchmark covers the
observable first-display cost of this boundary.

Initial source placement happens once per review model pair. A late review
refresh must not reset a live caret to column one before its first blur/save of
view state. Explicit reader-to-source targets still apply. The Markdown and
TypeScript cases in `workspace/workspace-zoom.spec.ts` pause between typed
characters to expose this race while retaining zoom, model and Undo assertions;
`workspace/input-regressions.spec.ts` also covers a background Git refresh during
typing with exact clipboard text and unchanged disk content.

Git history reviews carry an immutable commit selection. Their source models
are read-only and must never borrow a Working Tree model or receive its unsaved
text. Source/rendered transitions use the same review preparation guarantees.
The lazily mounted history graph must not take ownership of document focus or
trigger history reads on unsaved keystrokes. `git-history.spec.ts` and the
history/provider/controller unit tests cover the integration.
Replacing a status snapshot for the same repository must not remount that graph.
Unchanged automatic or manual refreshes retain its rows, loaded pages, selection,
scroll and keyboard focus; paging cursors are renewed without resetting the view.
Changed commits/refs still refresh, and pending checks cannot overwrite a newer
filter or outlive the pane. `git-graph-refresh.test.ts` and the real Electron
history regression cover these boundaries.

## HWP support removal — 2026-10-30

HWP/HWPX support is removed intentionally. The dedicated native editor, IPC,
content/session owner, save/recovery/reading-position paths, file associations,
build assets and HOP/RHWP submodules are retired. The HWP-only tests are removed
with those capabilities. HWP/HWPX remain in the unsupported binary extension
list so opening or saving through the text editor cannot corrupt them.
`text-files.integration.test.ts` covers that boundary. Existing Markdown,
Git review, notebook, image, PDF, browser and focus/IME guarantees remain in force.

## Reading surface capabilities

Current guarantees, ownership and required coverage: [Reading surface capabilities](contracts/reading-surfaces.md#reading-surface-capabilities).

## Explorer file operations and document ownership

Current guarantees, ownership and required coverage: [Explorer file operations and document ownership](contracts/workspace.md#explorer-file-operations-and-document-ownership).

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
uses `apps/desktop/test/suites.json` as the single contract inventory: the Vitest
contract suite, build/benchmark tooling tests, the production build/typecheck, and
`playwright.preview-contract.config.ts` with real Electron/Chromium. Retries are
disabled. This is a focused gate, not a substitute for other applicable tests.

Test cleanup destroys remaining windows only after removing automatic
`window-all-closed` quit handlers from that isolated application. Playwright then
owns the final quit and inspector disconnect. Otherwise quitting inside a window
destruction evaluation can strand its response and hang worker teardown. This
cleanup runs after user close/quit assertions and does not alter their behavior,
timeouts, retries or measured transition paths.

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
requests. Its reusable `desktop.yml` runs all Vitest tests (including architecture boundaries),
CI policy and build-tooling tests, then typechecks and builds PRs and application
changes on main. Version tags and manual runs build Windows and Linux installers
and verify the expected files; only a `v*` tag push may publish a GitHub Release.
The real Electron/Chromium contract and packaged-app smoke tests are not automatic
PR checks. Run
`npm run test:preview-contract` locally for changes in this contract's scope;
its GUI tests use the isolated-display wrapper and keep retries disabled.

The desktop build restores Electron's archive cache separately from npm's cache
and explicitly installs the pinned Electron binary before running tests. Electron
44 otherwise downloads it on first `require('electron')`; a release-server error
can fail `pretest` before any assertions run. Cache keys include OS, architecture
and lockfile, and the official installer retains its checksum verification.

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
Changes to this document, the suite manifest, workflow, fixture and tolerances deserve the same
review as the optimized code. Do not bypass a measured regression by weakening
its thresholds.

Historical measurements and explanations remain in
`sample-review-viewport-2026-09-21.md` and
`sample-document-optimization-2026-09-21.md`; they are evidence, not portable
hardcoded millisecond budgets.

## Editor groups

Current guarantees, ownership and required coverage: [Editor groups](contracts/workspace.md#editor-groups).

## Preview tabs

Current guarantees, ownership and required coverage: [Preview tabs](contracts/workspace.md#preview-tabs).

## Explorer selection and tab-strip drops

Current guarantees, ownership and required coverage: [Explorer selection and tab-strip drops](contracts/workspace.md#explorer-selection-and-tab-strip-drops).

## Browser lifecycle validation, 2026-10-15

Dated validation evidence: [Browser lifecycle validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#browser-lifecycle-validation-2026-10-15).

## Reading capabilities validation, 2026-10-15

Dated validation evidence: [Reading capabilities validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#reading-capabilities-validation-2026-10-15).

## Namu SVG filtering validation, 2026-10-15

Dated validation evidence: [Namu SVG filtering validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#namu-svg-filtering-validation-2026-10-15).

## Address draft validation, 2026-10-15

Dated validation evidence: [Address draft validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#address-draft-validation-2026-10-15).

## Reader toolbar removal validation, 2026-10-15

Dated validation evidence: [Reader toolbar removal validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#reader-toolbar-removal-validation-2026-10-15).

## Python language support validation, 2026-10-15

Dated validation evidence: [Python language support validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#python-language-support-validation-2026-10-15).

## C/C++ language support validation, 2026-10-15

Dated validation evidence: [C/C++ language support validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#cc-language-support-validation-2026-10-15).

## 2026-10-15 declarative language registry validation

Dated validation evidence: [2026-10-15 declarative language registry validation](validation/2026-10-16-feature-regressions.md#2026-10-15-declarative-language-registry-validation).

## Explorer file operations validation, 2026-10-15

Dated validation evidence: [Explorer file operations validation, 2026-10-15](validation/2026-10-16-feature-regressions.md#explorer-file-operations-validation-2026-10-15).

## Installed language-server discovery validation, 2026-10-16

Dated validation evidence: [Installed language-server discovery validation, 2026-10-16](validation/2026-10-16-feature-regressions.md#installed-language-server-discovery-validation-2026-10-16).

## Catalog-wide language discovery validation, 2026-10-16

Dated validation evidence: [Catalog-wide language discovery validation, 2026-10-16](validation/2026-10-16-feature-regressions.md#catalog-wide-language-discovery-validation-2026-10-16).

## Language Support sidebar validation, 2026-10-16

Dated validation evidence: [Language Support sidebar validation, 2026-10-16](validation/2026-10-16-feature-regressions.md#language-support-sidebar-validation-2026-10-16).

## LSP feature expansion validation — 2026-10-16

Dated validation evidence: [LSP feature expansion validation — 2026-10-16](validation/2026-10-16-feature-regressions.md#lsp-feature-expansion-validation--2026-10-16).

## LSP overflow widget validation — 2026-10-16

Dated validation evidence: [LSP overflow widget validation — 2026-10-16](validation/2026-10-16-feature-regressions.md#lsp-overflow-widget-validation--2026-10-16).

## Notebook surface contract — 2026-10-16

Current guarantees, ownership and required coverage: [Notebook surface contract — 2026-10-16](contracts/notebook.md#notebook-surface-contract--2026-10-16).

## Notebook reform validation — 2026-10-16

Dated validation evidence: [Notebook reform validation — 2026-10-16](validation/2026-10-16-feature-regressions.md#notebook-reform-validation--2026-10-16).

## Notebook convenience validation — 2026-10-16

Dated validation evidence: [Notebook convenience validation — 2026-10-16](validation/2026-10-16-feature-regressions.md#notebook-convenience-validation--2026-10-16).

## LSP conformance reform validation 2026-10-17

Dated validation evidence: [LSP 개혁 적용 검증](validation/2026-10-17-lsp-reform.md).
The shared Monaco worker dispatcher is covered by the contract's ordinary/Git/notebook
checks and the new language worker/protocol regression scenarios. The independent
baseline comparison completed 80 launches with all 48 comparisons inside the existing tolerances.

## Document language support policy — 2026-10-18

Language recognition and local checks do not depend on an installed server.
The shared worker dispatcher preserves JSON/JSONC/JSON Lines, CSS and HTML's
actual capabilities; isolated JS/TS workers run syntax checks only. External
project diagnostics retain their own provider/session/version ownership.
The code-document language status uses the existing location bar and must not
alter Markdown, review, media or web bounds, preparation, model identity or IME.
`language/language-policy.spec.ts` adds real worker, no-server, multi-provider and
project-import checks alongside the existing language, ordinary/review and
notebook scenarios in the contract manifest. Project clients remain lazy.
Implementation and dated execution evidence: [Language support system validation](validation/2026-10-18-language-support-system.md).
The final build passed all 149 isolated Electron contract scenarios. The separate
baseline comparison completed 80 launches and all 48 timing buckets passed the
unchanged tolerances; first, second and warm measurements are recorded separately.


## Project analysis environments — 2026-10-30

The code-document status popover adds project interpreter/SDK/build selection and
scoped recovery without changing Markdown/review bounds, preparation or model
identity. Environment discovery and configure jobs run in main, off the source
presentation and save paths. Notebook project-default refresh preserves an active
kernel and its analysis environment; it must not restart a running kernel or
execute cells. A stopped notebook can adopt the new shared default.

`language/project-environment.spec.ts` covers real Python import repair, C++ build
flags, TypeScript SDK/disabled state, explicit CMake preparation, process recovery,
unsaved buffers and Undo/Redo. The contract also includes analysis context and
CMake/Meson preparation unit/integration checks. Existing focus/IME, ordinary and
Git-review transition guarantees and benchmark tolerances are unchanged.

Execution evidence: [Builder analysis environment implementation](validation/2026-10-30-builder-analysis-environments.md).

## Lazy TextMate syntax highlighting — 2026-10-30

`renderer/language/syntax-runtime.ts` owns local grammar associations and lazy
activation; `textmate-runtime.ts` owns the shared Shiki/Oniguruma engine and
per-language tokenization. `syntax-themes.ts` maps existing app palettes into
namespaced syntax rules; `renderer/theme.ts` applies one theme to both engines.
The lexical engine and Svelte grammar must remain absent when opening only
Markdown or Python. Existing Monarch and LSP providers retain their own rules.
Theme changes must preserve document models, selections and Undo histories.

The contract includes `textmate-runtime.test.ts` and
`language/syntax-highlighting.spec.ts`: real grammar state continuity, all theme
mappings, actual no-server Svelte colors, lazy asset loading, unchanged Python
colors, LSP semantic overlays, Undo/Redo, and both Git comparison models in a
split workspace. The ordinary/review focus, IME, latest-content and timing
guarantees and tolerances remain unchanged.

Execution evidence: [Svelte syntax highlighting validation](validation/2026-10-30-svelte-syntax-highlighting.md).

The language package platform extends this ownership: the core catalog recognizes
files independently of server availability; local TextMate grammars remain lazy.
Languages added by runtime packages use the separate Zed host for Tree-sitter WASM
captures. Captures use UTF-16 offsets and must be discarded after a model revision,
language, ownership or cancellation change. Grammar preparation and server
installation never replace a document model, enter the Escape input path, or
block editing. Markdown and existing native Monaco grammars keep their lazy-load
guarantees.

Zed user and ancestor `.zed/settings.json` files supply language-server settings.
Saving them may reconnect affected providers, but must preserve current unsaved
text, focus and Undo. A project opened at its root must inherit settings into
nested files, including `infra/backend/template.yaml`. Package catalog refreshes
must obey the same model and revision guarantees. The syntax Electron suite tests
these cases, Make recipe tabs, YAML dialects and a language absent from the build
that obtains highlighting through an actual runtime WASM grammar. Catalog,
package-installation, settings-inheritance and capture-flattening unit tests are
part of the focused contract. The latency gate and tolerances remain unchanged.

The [language platform validation](../reports/zed-language-platform-implementation-2026-11-10/README.md)
records 1,303 unit checks, all 339 isolated Electron scenarios, a packaged-app
WASM check and the matched 80-launch comparison. All 48 first/second/warm timing
buckets passed the unchanged tolerances; both builds used source maps disabled.

## Document-owned analysis inspection — 2026-11-01

The global Language Support catalog manages tool availability and global defaults.
Document language, project choices, recovery, results and individual tool inspection
belong to the code tab's editor group. Opening details must not select a sidebar
folder, take another group's document as its target, cover adjacent native views,
replace a Monaco model, or change Markdown/review presentation or preparation.
Project settings still apply to their actual analysis root; the UI must state that
shared scope rather than inventing per-tab language-server instances.

`language/document-analysis-ui.spec.ts` exercises compact and missing-environment
screens, IME/Escape, separate project groups, bounded inspection, project-scoped
writes, Undo and the catalog's independence from document lifetime. Existing real
server/environment/recovery/import tests follow the new navigation without dropping
scenarios. Presentation and controller tests distinguish connection, observations,
freshness and partial failures and reject obsolete document responses. All are in
the contract manifest. Comparative ordinary/review timing gates remain unchanged.
The design and scope contract are recorded in [Language support](language-support.md#current-file-support).
Execution evidence, including the menu-path test correction and all 48 unchanged
latency comparisons, is in [Document language support UI](validation/2026-11-01-document-language-support-ui.md).

## Reader process failure recovery and compact chrome

A `render-process-gone` event invalidates the reader's prepared URL, revision,
theme and generation. Main rejects installation waiters and retires the failed
native view (both buffers for a Git review). Visible content may regenerate once
from the current memory model; inactive tabs prepare when needed. A second
failure within 30 seconds stops automatic recovery and exposes source/retry
controls. Source text, model history, Undo and reading anchors are retained.
Ordinary installation ACK timeouts now reject, as Git preparation already did;
a missing ACK is never a successful preparation. Obsolete generations cannot
publish a ready preview or poison a replacement's preparation state. Healthy
warm transitions gain no additional round trip or whole-document render.

`preview/renderer-recovery.spec.ts` injects real Chromium renderer failures while
visible, editing and inactive, checks latest text and Undo, and exercises repeated
failure/retry and replacement of both Git buffers. The isolated display wrapper
disables OS core dumps for its child processes: intentional renderer crashes must
not wait for the host core-dump service or retain crashed process memory. Real
Chromium failure injection, assertions, logs and screenshots remain enabled.
Unit presentation tests cover rejection of pending installation
and missing ACK. Background split failures show recovery controls instead of an
unexplained empty group. Existing revision, anchor, IME, geometry and timing
requirements remain in force.

The shared compact location panel and Markdown URL draft behavior are specified
in `contracts/workspace.md`. Compact input belongs to its native overlay; wide
input still belongs to the shell. Neither mode hides or resizes the live web page
to simulate an overlay. Theme tests also check actual foreground/background
contrast on mixed solid surfaces and removal of corrections in original mode.
The required full contract and matched baseline/candidate latency comparison,
including all first/second/warm buckets and unchanged tolerances, still apply.
