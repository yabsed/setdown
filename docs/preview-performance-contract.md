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

The linked contracts below are part of this contract. Read the matching feature
contract before changing its behavior. Dated execution evidence is kept separately
from current guarantees; moving it does not remove any required scenario.

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
PDF/image pinches use their existing cursor-anchored file scale. Shell/app zoom,
other tabs, live page identity, and editor models remain unchanged. The zoom,
browser, and video Electron tests use `Input.synthesizePinchGesture` with the
mouse source, exercising Chromium's touchpad-to-wheel conversion without a
Control key or synthetic DOM event. Physical device/OS gesture delivery is not
established by those automated tests. Dated results, including five consecutive
short pinches and the full latency comparison, are in
[Touchpad pinch validation](validation/2026-10-17-touchpad-pinch.md).

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

Browser coarse Ctrl+wheel changes website zoom from 50% to 300% in 10-point steps;
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
controls, including 100%. Live web pages use their tab's website factor; web
reader mode uses that tab's separate Markdown/text factor. Reader Ctrl+wheel
follows that same tab text scope. Entering or
leaving reader mode preserves the live page's website factor and form state.
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
Terminal and video bars use their tab factors; PDF/image bars use their actual
per-tab scale (including fit modes). Each split's controls
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

## HWP editor isolation

HWP/HWPX use a separate local RHWP Studio `WebContentsView`, created only for
HWP tabs. They never enter the Markdown render worker, Monaco text serialization,
or the three-entry media cache. Hidden editors retain their engine/undo state;
transfers adopt the same native view. Geometry converts CSS to native DIP with
app zoom once. Shell overlays hide and restore that view, without discarding the
document. HWP's page zoom remains separate from app zoom and Markdown tab zoom.
The file/session tests and `media/hwp-editor.spec.ts` are in the focused gate.
See [HWP support](hwp-support.md) for save, isolation and compatibility boundaries.

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
