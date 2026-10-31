# Workspace and file-operation contract

These guarantees remain part of the maintained preview performance contract.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Empty startup and recent folders

A fresh app process and each new window start with no selected project folder
and no tabs. Explicit file launch arguments open only the requested document;
its directory does not implicitly become the project folder. Legacy
`browser-tabs.json` records do not reopen pages. Reload reconnects to the same
window's current folder and live web pages, preserving page identity and forms.

`main/project/recent-folders.ts` stores at most five distinct canonical folder
paths in visit order, shared across windows and app restarts. History never
selects a folder by itself. Successful folder opens move an entry to the front;
an unavailable folder leaves the current workspace intact and reports an error.
The empty screen and Folder Tools selector expose this history. The selector's
None option clears project scope while retaining open documents and edits.

Closing a folder invalidates pending folder selections, directory reads,
search/status results and native watcher subscriptions. It clears project-only
Explorer/search/Git state and language workspace scope. A late asynchronous
result cannot reopen the closed folder. The folder selector uses the existing
native overlay mechanism and keyboard menu semantics.
Escape closes the folder menu without leaving the Markdown source editor;
selecting the current folder preserves the Explorer's expansion state.

`workspace/folder-history.spec.ts`, the project service/controller tests, recent
folder store tests and watcher tests cover these behaviors. The uBlock restart
scenario explicitly opens its page after each empty startup, preserving its
filter/settings checks.

## Explorer file operations and document ownership

Explorer commands are scoped to the tree. Native accelerators, the main Edit
menu, and context-menu actions must agree on the selected files; inline name
inputs, Monaco, terminals and reading surfaces retain their own text clipboard.
The native menu overlay retains the originating tree target across its focus
change. Tree-owned Undo reverses the latest recorded file operation in that
window; it must not undo the active editor. Redo is not provided.

`main/project/explorer-service.ts` serializes mutations. `file-transfer.ts` copies
through a staging directory on the destination volume and reserves destinations
without replacing existing contents. It preserves nested symbolic links as
links; unsupported file types fail instead of silently disappearing. The typed
receipt identifies completed, skipped, failed and unstarted entries. Cut is
consumed only for completed moves. A main-owned nonce on the system clipboard
invalidates file selection when another copy replaces it. Native file-URL/URI-list
clipboard data can be imported as copies; an external Cut never authorizes
Setdown to remove its source. Explorer native file drops import every selected
file into the target folder (or a file row's parent). Editor drops open separate
pinned tabs. Drop, paste and internal drag share collision handling. Shell and
native-reader feedback must not cover the document or persist after cancellation.

Copy/import are staged before publication. Cross-volume move verifies that its
source metadata tree stayed unchanged before removing it; a changed source or
failed removal preserves the destination and reports partial completion. Cancel
stops unpublished work and preserves completed receipts. Up to 50 operations per
window are undoable. Undo checks destination identity/metadata and open edited
documents again, refusing to remove subsequently changed content. Recording Undo
or notifying a language server cannot erase an already-completed disk receipt.

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
required. These guarantees do not imply large-tree virtualization, cross-window
file Undo, or verification of the macOS Finder compositor on a Linux runner.

## Text saves, Git paths and external changes

The Source Control activity badge follows VS Code's defaults (`git.countBadge=all`,
`git.untrackedChanges=mixed`, `scm.countBadge=all`): sum merge, index and working-tree
resource counts across visible, successfully read repositories. A partially staged file counts
twice; a conflict counts once; untracked files count and ignored files do not.
Zero hides a complete badge. Under the default all-repositories setting, selecting
a repository or collapsing a group does not change the total. Repository metadata watches include unselected repositories and linked
worktrees. The repository picker must fit the sidebar, ellipsize long paths and
expose the full path in its tooltip, without a horizontal scrollbar.
The upstream implementations are
[Repository.setCountBadge](https://github.com/microsoft/vscode/blob/1d7e3b013a0f4ed6c0e00fe11370e91797681e21/extensions/git/src/repository.ts)
and [SCMActiveRepositoryController](https://github.com/microsoft/vscode/blob/1d7e3b013a0f4ed6c0e00fe11370e91797681e21/src/vs/workbench/contrib/scm/browser/activity.ts).
Workspace `.vscode/settings.json` supplies Git/SCM count and discovery settings;
Setdown's explicit per-folder preferences override them and persist repository
visibility. Focused/tracked/off badge modes and hidden/separate untracked groups
use the same resource classification as the displayed groups. Discovery defaults
to one folder level, ten submodules, opt-in linked worktrees and a parent-repository
prompt; it skips symlink traversal and retains bounded work. A failing repository
or discovery step reports its own error without dropping other repositories' counts.
Truncated/failed counts carry an incomplete marker rather than pretending to be
zero. Parent-repository mutations require the same explicit repository selection.
The count, metadata and narrow-sidebar checks live in `git-change-groups.test.ts`,
`git-service.test.ts`, `completeness.test.ts` and `git-activity-badge.spec.ts`.

Text saves serialize conflict checks and publication per canonical destination
across windows. Each write uses an exclusive unique temporary file and restores
the original permissions independently of umask. Save As follows symbolic links,
including a dangling leaf link. Markdown reads verify one opened handle before
and after reading and reject replacement of its path. A final save conflict check
precedes rename; this is optimistic detection, not filesystem compare-and-swap.
Each window owns only its own file-watch listener. Deletion or loss of access
produces an external-change notice and retains the buffer; autosave never
recreates a missing file. Disabling autosave invalidates queued work and work
awaiting save preprocessing, while already-started I/O completes normally.
File versions include available device/inode/ctime metadata as well as size and
mtime. Every backed open content, including background/shared views, has an
owner-scoped parent-directory native watch, a two-second polling fallback and a
focus reconciliation. Atomic replacement does not retire the parent watch.
A window's own save defers its watcher observation across atomic publication,
then compares the current file with the exact written version before reporting
an external change. It must not flash a notice for its own write. Other windows
remain notified, and concurrent replacement/deletion or a failed save still
reconciles immediately; no elapsed-time ignore interval is used.
Reloads coalesce per path and reject stale completions after another reload, new
edits, retargeting or closing. Unavailable files retain their buffers and notices.
The location-bar and native Reload commands reload local content without
restarting the shell, terminals or web tabs; dirty reload requires confirmation.
Untitled documents cannot reload. Autosave timers belong to each document and
survive tab changes; errors remain visible on their owning document.

First Save suggests the directory of the working document, or the open folder
when there is no backed document; temporary draft directories are not suggested.
Save As starts at the document's own path. Cancel leaves the draft untouched.
Destructive terminal/watcher cleanup runs only after application quit is accepted.

Draft relocation rewrites parsed local Markdown/HTML destinations, including
reference definitions and encoded filenames. Code, prose and external URLs stay
byte-for-byte intact. A one-shot relocation mapping also updates edits made
during saving, without replacing them with the older saved revision. Generated
local destinations encode filesystem segments; URL consumers parse before
decoding. Saved baselines and live model text retain separate revisions.

Git selections are literal paths and preserve symbolic-link entries. Staged
renames read HEAD using the previous path. Hunk bodies beginning with `---` or
`+++` remain changes. An absent repository is not permanently cached, and a blob
read failure or size limit is never reported as an empty original. Read-only
directory copies restore their mode after publication and clean writable staging
trees on failure. The audit integration suite, draft parser tests, and actual
preview local-link tests cover these boundaries.

Git status and mutations operate on the actual repository root, even when Explorer
shows a subfolder. Bounded discovery exposes nested repositories for explicit
selection. Index/ref watches resolve the real gitdir and common directory,
including linked worktrees. Mutable open comparisons refresh after repository
changes; immutable history comparisons retain their commit identity. Mutation
queues serialize per repository and late results cannot change a different
folder's UI. Staged rename Unstage includes both names; unborn HEAD is detected
explicitly instead of treating every reset error as an unborn repository.
Unmerged comparisons expose base/ours/theirs against the working copy. Discard
requires confirmation and preserves unsaved editor buffers. Remote partial
success reports what completed, then refreshes status and comparisons.

Project search returns result-limit and skipped-file information. Both search
scopes include eligible open buffers, including ignored or deleted files. An
empty ripgrep listing is an ordinary empty result. Opening a result cannot apply
an obsolete query's highlights after a newer search.

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
`text-workspace.test.ts`, and `test/e2e/browser/*.spec.ts` in the focused gate.

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
`text-workspace.test.ts`, `preview-tabs.spec.ts`, and `test/e2e/browser/*.spec.ts` cover this
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
Pages opened by another page become independent tabs: closing the opener must
preserve descendants and their live state, including tabs moved to another
window. Chromium's `window.opener` relationship remains intact while the opener
is alive; Setdown owns tab destruction (`outlivesOpener: true`).
The browser lifecycle E2E disables Playwright's focus emulation on its original
CDP session before asserting actual `document.visibilityState`; a second CDP
session cannot release the first session's synthetic capturer.

Web pages follow the app palette by default. View → Theme → Apply Theme to Web
Pages and Browser Appearance share a persisted global switch; per-origin original
color exceptions remain independent. Changes apply to open frames without page
navigation, form replacement or scroll resets. The pinned Dark Reader API runs
only in the isolated page preload. A bounded, owned-frame and document-token
resource bridge accepts CSS/images with cancellation on navigation and ownership
changes. A moved live tab receives a fresh policy, so later CSS loads still work;
the upstream
cross-origin guards remain enabled. No resource API enters the website world.
Guarded build adapters normalize CSS light-dark() input and preserve readable
opaque dark text in light palettes. The bundled CSSOM proxy runs in the page world
without inline-script injection, including under strict script CSP; disabling the
theme restores original CSS and proxy descriptors. The theme E2E checks all registered
palettes, cross-origin styles after in-page navigation and window transfer,
CSSOM updates, site exceptions, persistence and
page identity. The folder picker stays within the sidebar and leaves native web
content visible. Repeated native clicks on the extension toolbar toggle a strip
once, without blur closing it before the click recreates it. Browser layout E2E
checks both interactions while video frames continue advancing.

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
replace the user's active surface. `test/e2e/browser/*.spec.ts` checks deletion persistence and native download controls;
`browser-downloads.test.ts` checks interrupted restoration, duplicate file paths
and progress/completion ordering.

Web Store installs reuse the existing extension session and registry. The store
downloader is imported only on an explicit install/update request, and staging
does not execute extensions before confirmation. Disabled extensions stay disabled
when updated; a failed enabled replacement restores the previous version.
`browser-extensions.spec.ts` exercises real CRX3 unpacking, native content scripts,
confirmation/cancellation, updates, restart restoration and removal; it is included
in the focused gate. Store input and registry mutation tests accompany it.

`test/e2e/browser/*.spec.ts` covers navigation, live state, native split visibility, bookmarks,
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
`test/e2e/browser/*.spec.ts` checks both namespaces, fresh startup, real filtering, popup
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

Shared text content and views have separate identities. `DocumentStore` owns one
mutable record per normalized resource path; tab IDs identify views, not files.
Ordinary and editable Working Tree inputs borrow the same Monaco model and Undo
history. Saving, autosave, Stage-before-save, close/quit confirmation and external
file reconciliation enumerate unique contents, including documents with only a
Working Tree view. Closing a nonfinal view does not prompt or dispose the content;
the last reference follows the existing revision-checked save/discard contract.
Index/history, notebooks and media retain their separate content owners.

Opening a comparison creates no ordinary tab. Input deduplication is group-local:
ordinary versus comparison are different inputs, as are Working Tree versus Index
and different immutable commit selections. Side opens target the right neighbor;
explicit split/copy creates a new view, with its own caret/folds/scroll/mode/zoom.
Move to a group already containing the input reuses its existing view. Linux/Windows
Ctrl-drag and macOS Alt-drag copy eligible views; unsupported singleton surfaces
remain singleton. New comparisons are pinned. Explorer preview replacement remains
local to its group.

Each review owns its controller, viewport port, presentation requests and native
IDs. Its shared repository status does not own another review's display. Native
layout is aggregated across ordinary readers and review sides by
`PreviewLayoutCoordinator`; drag/overlay freezing, clipping and focus isolation
apply to every visible group. Group maximize temporarily displays one leaf while
retaining the original split geometry; restore reuses the original ratios.

Rename/Save As keeps content identity and retargets all views. A destination
already owned by a different live content is rejected, preserving both buffers.
A mutable comparison moved outside its repository becomes an ordinary view with
its edits intact. Closing the folder similarly keeps mutable content in ordinary
inputs. Immutable comparisons are closed. Cross-window comparison transfer and
cross-window shared Undo are excluded; ordinary transfers retain acknowledgments
and cannot silently overwrite a destination's existing buffer.

Session restore is explicit and additive. It validates a versioned manifest and
restores the recorded project, groups, text views, cursor/fold/scroll/display state
and comparison presentation when available. Missing projects and individual file
failures are reported. Dirty buffers with changed/missing disk baselines or an
existing dirty owner recover into separate untitled documents. Automatic recovery
writes after a 250ms edit debounce, with a one-second fallback and blur/visibility
flush. Only the latest completed snapshot is promised. Image recovery retains
owned original bytes and the edit recipe. Binary restoration creates a separate
recovery file and never overwrites the original. Aggregate content is bounded before encoding;
failed writes are visible and back off for 30 seconds unless content changes.
New windows/processes still start empty, with a recovery affordance when artifacts
exist. Retention and size bounds are specified in [editor tools](../editor-tools.md).

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
Monaco Find actions must receive their click before mouse focus can activate and
reparent a background editor. The Close button works while another split owns
focus, including with no search results, and returns input to its own editor.
Keyboard activation remains available. `editor-groups.spec.ts` covers both paths.
Find tooltips remain visible above the editor and retain their measured size at
split edges. Positioning must not wrap a tooltip onto its own target and trigger repeated mouseout/recreation;
the same Electron test file holds a real pointer over Close and checks stable
tooltip identity, dimensions, clipping, hit testing, and keyboard focus across frames.

`editor-groups.spec.ts`, `tab-detach.spec.ts`, `editor-groups.test.ts`,
`preview-presentation.test.ts`, and `media-cache.test.ts` cover these guarantees.
The blue tab insertion/split guide is the accepted drop placement. Completion
uses that same placement, including when a native child surface consumes an
accepted move drop or reports a null-relatedTarget leave inside the window.
Such a leave must not erase the guide or turn a local move into window detachment.
A new dragenter or dragover replaces the guide; a fast boundary crossing must
not retain the previous strip's placement while waiting for another dragover.
Accepted body-guide updates replace the previous guide directly, without an
intermediate clear message to the native receiver. Repeated motion within a
split must retain the guide on every Chromium frame. Browser layout tests sample
the native receiver during real OS pointer motion at normal and increased app
zoom, then verify all four split directions and the final right-hand drop.
On Linux, participating windows temporarily suppress their native resize border
during a tab drag: that non-client border otherwise swallows rightmost drops
before Chromium can accept them. Completion and cancellation restore only windows
that were originally resizable. Maximized/fullscreen windows retain their size
hints throughout the drag, since changing them makes Mutter restore the window.
This changes neither the window bounds nor native
page ownership. The real browser layout regression releases immediately at the
last pixel of a wide window, repeats at increased app zoom, and checks Escape
and originally fixed-size windows; it also runs maximized under isolated XWayland.
Valid final drop coordinates replace an earlier center hover even if its final
dragover is delayed. Source dragend retains receiver/token ownership through the
existing detach arbitration interval so an in-flight local native drop can still
win. A canceled inside release cannot reuse stale sole-tab tear-off intent; actual
outside detachment and coordinate-less accepted completions retain their rules.
A rejected area, confirmed window exit,
or explicit cancellation clears it. A confirmed outside release takes precedence
over a retained guide: Chromium can report a real boundary leave at `(0, 0)`
and provide the outside coordinates only on `dragend`. Native pointer tear-off
tests exercise this path after hovering the strip, alongside Escape cancellation.
Chromium's canceled drag (`dropEffect: none`) must not
commit a guide even when Escape never reaches the DOM. `tab-detach.spec.ts`
covers guide placement and these invalidation paths in Electron, alongside
actual outside detachment.
Tab movement uses the OS drag-and-drop transport and receiver-local coordinates.
The OS chooses the destination window; main must not infer it from global window
positions or focus order. Native Wayland windows do not expose their global positions.
Only the private owned token authorizes a Setdown tab transfer. Tab drags do not
export resource paths as plain text.
Each receiver records its current accepted guide with main; entering another
receiver clears the previous window's guide, including when Chromium omits its
leave. Close/audio controls retain ordinary clicks. Cancellation, source closure,
expiry and Escape release every participant.

Cross-window drags share their lifetime with every visible shell. Native Markdown
readers retain their existing capture lifetime; live websites stay
attached, visible and playing. A lightweight, transparent WebContentsView is
prepared when a workspace first displays a website, before any drag starts.
Document-only windows use their existing shell receiver and do not allocate
an extra renderer. Once created, the native receiver is retained across tab
types until window closure. During a drag it receives native
drop events above those pages and paints the same guide, clipped to their native
regions. It has only a dedicated sandboxed preload, no desktop API, navigation or
page content, and never requests focus. It is not repeatedly reattached while already
on top. This avoids forwarding drag input through untrusted page content or
freezing videos. Actual OS pointer input in the browser transfer and tab-detach
tests covers repeated fast moves and cancellation; browser layout coverage also
asserts advancing video frames while holding the drag.
On Linux with an available XWayland display, default startup selects X11. Electron
44's native Wayland transport can keep its accepted operation at NONE after a
renderer accepts a drop, cancelling a fast cross-window release. Explicit
`--ozone-platform=wayland` remains available; a Wayland-only session is not forced
onto an unavailable X11 display. Backend selection is effective at process startup:
if necessary, relaunch once before creating windows, preserving launch arguments.
The XWayland suite separately verifies this actual relaunch. That upstream native transport limitation is
recorded, not hidden by treating cancelled drops as successful moves. Global
position validation uses the selected backend, not just WAYLAND_DISPLAY.
`npm run test:xwayland --workspace @setdown/desktop` uses private headless Mutter
and its own XWayland server, runtime/profile and D-Bus session, with real compositor
input. It checks 40 web and 40 document operations, split/merge and insertion
guides, Escape, and live form identity between physically tiled windows.
`test:wayland` runs the same strict scenarios on native Wayland and retains the
upstream fast-entry failure as an investigation case. Neither replaces the
required default Xvfb gate.

If Chromium acknowledges move/copy but substitutes a coordinate-less terminal
leave for DOM drop, a receiver retains its last accepted placement separately
from the cleared visual guide. Only an accepted OS effect can commit it. An
ordinary leave, rejection, cancellation or entry into another receiver clears
that retained ownership. A source-local release outside the source dimensions
defeats its retained local guide, even when Chromium leaves a stale move effect.
This validation needs no global window position. On X11, macOS and Windows a
valid final screen point can also disprove stale in-window client coordinates;
that additional outside-release check is disabled on Wayland and never selects
a destination window. A null-relatedTarget leave whose client point is still
inside retains the visible guide, including local-only Git review splits.
A normal claim wins once;
remote claims already in flight remain eligible until arbitration completes.
`browser/transfer.spec.ts` exercises repeated native web/terminal body transfers
between overlapping windows, including remote cancellation and preserving the
live page/PTY. Manager tests cover identical/zero global bounds and local versus
remote fallback ownership. Synthetic DOM events do not replace the OS tests.
Every editor-group body uses the same four-column, two-row split grid:

```text
1 2 5 6       left  up    up    right
3 4 7 8       left  down  down  right
```

The left quarter selects left, the right quarter selects right, and the middle
half selects up above the vertical midpoint and down at/below it. The 25% boundary
belongs to the middle and the 75% boundary to the right. Every valid body point
has a direction, including the center; there is no center merge/tear-off area or
history-dependent exit margin. The hovered group's body supplies the bounds,
including nested groups, normal/maximized/fullscreen windows and app zoom.
The painted half and committed split must agree. Tab strips own merging into an
existing group and reordering; file drops use the same body/strip placement.
`editor-groups.test.ts` covers all eight cells, fractional geometry and exact
boundaries. Real Markdown pointer tests commit each cell with/without a native
child boundary leave; browser layout tests cover all cells and reverse boundary
crossings above live web content at normal and increased app zoom.

A source group's sole tab cannot split itself. Its body keeps the existing
tear-off behavior in normal windows. Maximized and fullscreen sources never
create a detached window, including a hidden prepared window: a sole-tab body
drop or unclaimed outside release cancels and keeps the tab in place. Local
splits/reordering and transfers into existing windows remain available, including
a delayed native drop/claim during arbitration. A window entering maximized/fullscreen
state before detach commits also cancels its pending tear-off; restoring during
a drag cannot enable one that started maximized/fullscreen.
A late end notification for the preceding drag cannot reset a new local token
or its native receiver when the next gesture begins during that arbitration.
The location bar and unrelated shell areas are not drop destinations.
An internal tab transport still accepts native enter/over while traversing that
chrome: X11 can otherwise retain the rejected operation across a subsequent
valid entry and cancel a quick release. The guide remains cleared in chrome;
release there cancels without moving, copying or detaching. Transport acceptance
never substitutes for an accepted placement, and Escape/`none` still cancel.
Returning from tear-off to a strip or split replaces that intent with the new
visible guide; Escape cancels without moving or detaching. Source Markdown surfaces retain their capture throughout the drag,
including over a sole-tab tear-off area; web surfaces remain live. Native pointer tests in `tab-detach.spec.ts` check feedback before
release, detach, cancellation, return, split and the sole-tab case; its accepted
native-drop cases also verify body splitting and tab-strip merging into another group.
An accepted sole-tab tear-off retains its last screen position when native drop
completion reports zero coordinates. Its explicit in-source request is checked
against the OS receiver ownership, so an overlapping window behind it does not
intercept the tear-off; outside drops still allow the destination window to
claim the transfer. Main observes native Escape keydown and keyup while a
transfer is unclaimed, since an OS drag can consume keydown before it reaches
the shell. Cancellation destroys the prepared window and defeats a late
detach request. `tab-transfer-manager.test.ts` checks these ownership rules.
The detach test forces source `dragend` to reach main before an existing window's
drop claim and verifies that the existing window still receives the live native
preview. Keep ordinary single-group preview and Git-review cycles in the same
48-bucket performance comparison.
`test/wayland/tab-drag.spec.ts` uses the private Mutter compositor (also with
XWayland) to check real maximized/fullscreen web and document drags: all eight cells, top/bottom
to left/right corners, immediate center-to-right release, increased app zoom,
center splitting and Escape. It asserts zero new windows, including hidden
ones, and unchanged window mode/bounds. Unit tests cover window-state changes
during arbitration and late claims into existing windows.
The earlier 2026-10-31 [fullscreen transport execution record](../../reports/fullscreen-tab-drag-2026-10-31/validation.json)
records 63 focused unit checks and 42 isolated Electron cases across Xvfb,
XWayland and native Wayland, with the initial diagnostics retained alongside them.
The [eight-cell split validation](../../reports/tab-split-grid-2026-10-31/validation.json)
records 63 unit checks and 76 GUI scenarios for the grid above, including the
corrected test selectors and original diagnostic logs.

Dated reproduction, native input evidence, and validation:
[Tab tear-off area — 2026-10-20](../validation/2026-10-20-tab-tear-off.md).
[Cross-window tab drag — 2026-10-23](../validation/2026-10-23-cross-window-tab-drag.md)
records the missing-drop reproduction, native lifecycle/entry fixes and repeated
web/terminal transfers between overlapping windows.

## Preview tabs

VS Code's editor-group preview policy applies to document tabs. Explorer single
clicks open one replaceable preview per group; double-clicks (file or tab), middle
clicks on files, Enter, explicit Open, native/external opens and new files keep
their tabs. Preview labels are italic. Reopening an existing pinned document never
demotes it. Editing ordinary or shared Working Tree text pins the document; Save
and Undo do not make it replaceable again. Dragging/moving a preview also pins it.

`core/workspace/editor-groups.ts` owns each group's preview identity. Replacing a
preview preserves its tab ID and tab zoom as well as its group and split geometry,
releases its Monaco/native/media
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
a native-boundary leave signal, order, group collapse, and Undo. `test/e2e/browser/*.spec.ts`
checks the same boundary signal during a real web-tab split;
`tab-detach.spec.ts` checks cross-window strip drops even when source dragend
precedes the destination claim, preserving the live native reader and position.

