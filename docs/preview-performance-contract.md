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
surfaces release their resources. Inactive surfaces are inert, cannot focus
find controls or publish reading positions, and preserve nonzero layout. Hidden
resizes are reconciled on activation. This does not promise instant cold opens
or instant returns after eviction. `media-tabs.spec.ts`, `image-reader.spec.ts`,
`reading-positions.spec.ts` and the cache/file/history unit tests cover these
guarantees and are included in the focused gate.

Zoom has four independent scopes. Ctrl+plus/minus and Ctrl+0 change/reset the
persisted app factor in every window. Ctrl+wheel in text/Markdown changes the
persisted common text factor: ordinary and Git Monaco editors scale typography,
and native Markdown views use app × text zoom (including hidden/spare views).
Native bounds still convert with **app zoom only**, never the text factor.
Changing zoom must not navigate, replace models, discard undo history or focus
hidden previews. `workspace-zoom.test.ts` and `workspace-zoom.spec.ts` cover scope,
reset, inheritance and persistence. The View menu uses the same coordinator.

Browser Ctrl+wheel changes website zoom from 50% to 300% in 10-point steps.
The isolated page preload reuses the bounded wheel accumulator in each frame;
Electron's native `zoom-changed` event handles unconsumed requests. Ordinary
scrolling and synthetic DOM wheel events do not request zoom. Website
zoom is shared by hostname within the browser session, matching Chromium's zoom
policy, and composes with app zoom without changing app/text preferences or native
bounds. Reloads, tab switches and app zoom updates retain the website factor.
Zoom preserves the live page and forms. The custom content-factor target in
`workspace-zoom.test.ts` and native wheel input in `browser.spec.ts` cover these
guarantees. Wheel IPC is accepted only from a visible owned web contents, with
bounded integer steps; no desktop API is exposed to remote pages.

The web location bar always displays website zoom, including 100%, and provides
decrease, increase and reset controls through the same hostname-scoped path.
The percentage describes website zoom relative to the app factor. Updates in
other tabs of the same hostname and app zoom changes retain this distinction;
the indicator never adds native captures, navigation or layout polling.

PDF/image wheel zoom is per file and keeps the content point under the cursor,
subject to the scroll range at content edges. It must not change either common
factor. PDF starts at fit width; explicit fit modes recompute on viewport/app
zoom changes, while numeric file zoom is retained. The media controls provide
100% and fit actions; Ctrl+0 leaves file zoom untouched. PDF.js receives wheel
origins in its container coordinate system, including the shadow host's offset.
`workspace-zoom.spec.ts` checks real wheel input, cursor anchors, fit resizing,
tab isolation and app reset; reading-position tests cover file-state persistence.

The common native lifecycle is: validate CSS bounds → convert/clip once → apply
native bounds → synchronize Blink viewport → prepare hidden content. Navigation
invalidates the viewport cache and replays that sequence after current ownership
is checked. A pending document request is consumed once; repeated show does not
enqueue more background hydration. Showing is still an explicit presentation decision; readiness never
grants permission to change visibility. Review positioning has its own revision
acknowledgment, so it is not collapsed into ordinary document hydration.

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

## Required deterministic and browser checks

From the repository root:

```sh
npm ci
npx playwright install chromium
npm run test:preview-contract
```

Linux without a display: `xvfb-run -a npm run test:preview-contract`. The command
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

GitHub Actions for `yabsed/setdown` was disabled at the user's request on
2026-10-09 after recurring browser zoom test failures and an Electron inspector
evaluation failure in recent CI runs. The repository setting disables automatic
and manual workflows, including Release. Local contract checks and comparative
benchmarks remain required for changes in the scope described above.

If Actions is re-enabled, `.github/workflows/preview-contract.yml` runs
`preview-contract` on every PR and main push, with no path filter that could miss
a stylesheet or dependency change. The workflow retains build/type checks,
focused unit tests and real Electron/Chromium contract tests.

When Actions is enabled, `preview-latency` runs only through `workflow_dispatch`
with `run_latency` enabled (disabled by default). The full 80-launch comparison
has encountered intermittent Electron evaluation failures before it could produce measurements; see
[the CI investigation](ci-failure-analysis-2026-09-21.md). It is therefore a manual
diagnostic rather than an automatic merge gate. This reduces automatic coverage:
timing regressions must still be checked locally for changes to performance paths,
using the full benchmark described above. Its scenarios, repetitions, thresholds
and fail-closed validation are unchanged.

Manual comparisons use the selected ref's parent commit as the baseline. Each
lockfile is installed independently. Both versions are measured serially on one
VM; logs and comparisons are uploaded even on failure. Automatic events do not
cancel a manually requested run.

At disablement, `main` had no branch protection and the repository had no
rulesets. If CI is restored, branch protection/rulesets should require
`preview-contract` on `main`; `preview-latency` is not an automatic merge
requirement. Workflow YAML cannot configure repository rules. Changes to this
document, the suite lists, workflow, fixture and tolerances deserve the same
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
New web tabs open Google and select their address; ordinary mouse/keyboard
address focus also selects the complete value. `tab-navigation.test.ts`,
`text-workspace.test.ts`, `preview-tabs.spec.ts`, and `browser.spec.ts` cover this
behavior in the focused gate.

`main/browser/browser-manager.ts` retains one sandboxed WebContentsView per live
web tab, with a separate persistent browser session. Switching tabs and splitting
groups keep page identity, forms and history. Browser layout uses app zoom once;
remote pages receive neither Node nor the desktop bridge. Hidden initial loads
stay detached. Library indexing/ranking runs in a separate, detached Places view.
No periodic page captures or Markdown hydration are added to browser tabs.

Browser library history deletion serializes with visits/bookmark updates in the
detached Places service. IndexedDB and its search cache change together; clearing
visits preserves bookmarks, cookies and live page state. Downloads use native
session DownloadItem events, coalesce progress updates, and immediately publish
terminal states. Only serializable metadata crosses the desktop bridge. The
library retains completed records across restart; an unfinished transfer from a
previous process is shown as interrupted. Removing a download record keeps its
file. `browser.spec.ts` checks deletion persistence and native download controls;
`browser-downloads.test.ts` checks interrupted restoration, duplicate file paths
and progress/completion ordering.

`browser.spec.ts` covers navigation, live state, native split visibility, bookmarks,
fresh-profile extension startup, popup opener identity, and real uBlock network,
scriptlet, frame cosmetic and response-header filtering. It is part of the focused
gate. The full uBlock extension starts before remote navigation. Its adapter
preserves native response-header events and targets styles to their actual frame.
Electron 38 cannot remove user-origin webFrame styles; scoped user styles are
disabled through root tokens and reused until navigation, preserving priority
and allowing uBlock's cosmetic toggle without replacing page content.

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
that live view, including after scrolling a visible background group. Text tabs
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
