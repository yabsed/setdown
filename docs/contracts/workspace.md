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
result cannot reopen the closed folder. The folder selector stays inside the
sidebar with keyboard menu semantics and leaves native web views visible.
Escape closes the folder menu without leaving the Markdown source editor;
selecting the current folder preserves the Explorer's expansion state.
An open menu snapshots its entries so a shared-history refresh cannot move a
pressed target before mouse release. Refreshed entries appear on the next opening.
Changing folders keeps the selected sidebar view when the panel is already open,
as well as the active website, its native WebContents, form state and navigation.
Opening a folder when Folder Tools is hidden or collapsed reveals Explorer.
Project, Git metadata and language-server watcher lifecycle operations share a
serial native queue. Parcel's backend lock otherwise lets concurrent tree crawls
fill the libuv worker pool and starve the next folder's `stat`/directory read.
Queued obsolete roots are skipped; teardown never delays closing project scope
or stopping a language server. Generation guards continue rejecting old events.

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
Graph treats an unborn branch as an empty state without querying its nonexistent
ref, and starts displaying history after the first commit. Local history needs
no remote or GitHub connection. This includes returning to an unborn orphan
branch when other branches already have commits. `git/git-history.spec.ts`
covers these transitions. The empty-state presentation follows VS Code's
[SCM history welcome state](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scm.contribution.ts).
Unmerged comparisons expose base/ours/theirs against the working copy. Discard
requires confirmation and preserves unsaved editor buffers. Remote partial
success reports what completed, then refreshes status and comparisons.
Stage does not inherit the 10-second status-read timeout: large binaries and
clean filters may take longer. Selected literal paths use NUL-delimited stdin
so large batches and unusual filenames do not hit command-line limits. The
operation remains busy until Git exits, and failures report stderr or a concise
reason instead of dumping the complete command and path list.

Removing a discovered repository's `.git` marker invalidates its discovery and
repository caches on the next refresh. The folder returns to the Initialize
Repository state, removes stale counts/Graph/errors, and keeps any independently
discovered nested repositories. Reinitializing it restores the empty Graph.
Failed graph sessions are evicted so a new repository can be opened at that path.

Image Git comparisons show original and modified pixels side by side, with
transparency backgrounds, dimensions and byte sizes. Unstaged changes compare
Index → Working Tree; staged changes compare HEAD → Index; history reads the
selected immutable blobs, including rename paths. Added/deleted sides show an
empty state. Conflict selection uses base/ours/theirs image bytes. Each side has
the existing 64 MiB image limit and reports read/decode errors without treating
them as a missing image. Both panes use the review tab's zoom, including numeric
controls, Fit and Ctrl+wheel. Image URLs are released on replacement/unmount.
Comparisons are read-only and do not create an ordinary image editor or a text
model. `git/image-diff.spec.ts` verifies actual decoded pixels, working/staged/
historical versions, added/deleted files, decode failures and shared magnification.

Explorer, staged/unstaged changes and Graph's changed files share VS Code's Seti
file icons, using exact filename and longest compound-extension associations.
Light/dark palettes follow the app theme; Git status colors/badges remain on the
file labels. Folder icons distinguish open and closed states. The pinned font,
associations and MIT notice live in `src/core/files`; regenerate with
`node scripts/update-file-icons.mjs` from the pinned VS Code reference checkout.
No Monaco, language-server launch or file read is needed to render an icon.
`project/file-icons.spec.ts` checks all three locations and both appearances.

Project search returns result-limit and skipped-file information. Both search
scopes include eligible open buffers, including ignored or deleted files. An
empty ripgrep listing is an ordinary empty result. Opening a result cannot apply
an obsolete query's highlights after a newer search.

## Editor groups

Markdown table and URL insertion popovers anchor below their focused group's
location-bar button and stay inside that group's visible bounds. Window/app zoom
and split resizing update the open popup; narrow or short panes scroll its
contents instead of covering an adjacent native reader or website.
`workspace/markdown-insertions.spec.ts` covers left/right/bottom placement, native
pointer selection, keyboard invocation, focus, Undo and retained browser state.
Execution evidence: [insertion popover validation](../../reports/insertion-popovers-2026-11-08/validation.json)
and [first, second and warm latency comparisons](../../reports/insertion-popovers-2026-11-08/preview-latency.txt).

Web pages share the editor-group tab strip and its address/file-path bar. The
tab strip occupies 36 CSS pixels with 28 pixel tabs and creation controls. The bar
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
groups keep page identity, forms and history while resident. Inactive web tabs can
sleep after 10 minutes, or after 2 minutes/30 seconds under moderate/critical
memory pressure. A sleeping tab keeps its identity and Chromium navigation
history and restores its URL, scroll, mute and tab zoom on activation; the website
reloads. The tab strip marks sleeping pages with a moon. Edited forms, active
media, page permission grants/prompts, authentication, popups, embedded apps,
Reader/PDF views, visible groups and tabs explicitly kept awake are excluded.
Active downloads defer web reclamation. A beforeunload veto silently keeps the
page awake. The site menu exposes Keep This Tab Awake. The real
`browser/memory.spec.ts` checks native contents destruction, restoration, history,
scroll, draft protection and beforeunload; existing lifecycle tests continue to
check warm live identity. View → Memory Usage shows the app-wide measurement,
budget and resource counts and allows explicit inactive-resource reclamation.
Browser layout uses app zoom once;
remote pages receive neither Node nor the desktop bridge. Hidden initial loads
stay detached. Library indexing/ranking runs in a separate, detached Places view.
No periodic page captures or Markdown hydration are added to browser tabs.
HTML fullscreen temporarily belongs to the requesting page's window. Its native
view fills the entire content rectangle in DIP, independently of app/tab zoom;
other web splits and native Markdown readers remain retained but hidden. Reader
layout/preparation updates cannot expose a native view over the fullscreen page.
The window enters OS fullscreen and restores its prior mode on exit, including
preserving an already fullscreen app. Escape exits the video without also entering
Reader. The page's exit control, OS fullscreen exit, navigation, tab close/transfer,
crash and shell navigation commands release the presentation and restore splits.
Cross-origin HTTP(S) players may use fullscreen when Chromium's user-activation
and iframe Permissions Policy checks permit it; this grants no other cross-origin
permissions. Hidden/unowned pages remain ineligible. `browser/fullscreen.spec.ts`
uses real pointer/Escape input and advancing video with web/Markdown neighbors,
zoom and embedded-frame policy checks; permission and preview-presentation unit
tests cover ownership and suspended presentation. These run in the focused gate.
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
Native Markdown and website bounds follow the actual content rectangles after
layout, including position changes that leave the window and pane sizes unchanged.
Restoring a temporarily unavailable background surface must show its retained
native child again without waiting for a window or split resize.
`renderer/workspace/groups/workspace-geometry.ts` observes the layout owners and
individual surfaces, then reconciles document, review and browser geometry together.
It ignores content/editor mutations and suppresses duplicate geometry updates.
`preview/native-layout.spec.ts` checks late position changes without resizing,
retained native identity, composed screen pixels and native pointer input.

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
1 2 3 4       left  up    up    right
5 6 7 8       left  down  down  right
```

The left quarter selects left, the right quarter selects right, and the middle
half selects up above the vertical midpoint and down at/below it. The 25% boundary
belongs to the middle and the 75% boundary to the right. Every valid body point
has a direction, including the center; there is no center merge/tear-off area or
history-dependent exit margin. The hovered group's body supplies the bounds,
including nested groups, normal/maximized/fullscreen windows and app zoom.
For a single focused maximized/fullscreen X11 window, native pointer sampling
keeps the guide current if Chromium stops dispatching target events outside the
old normal-window hit-test region. An accepted single-window release recomputes
the placement from its final screen point, converted through current window
bounds and app zoom. Rejected releases, cross-window ownership, and native
Wayland continue to use OS drag arbitration. Window shape and bounds are not
changed for this recovery. The XWayland regression includes normal-window
dragging before maximization, restoration, app zoom, cells 4/8, and an already
split terminal/website layout.
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

Explorer file drags must release the shared workspace input shield on drag end,
including cancellation and rejected/outside drops. These drags have no tab
transfer token or tab-chrome completion callback. `workspace/input-regressions.spec.ts`
uses native pointer input to cancel/reject them, then verifies tab selection and
wheel scrolling without a corrective focus click.

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


## Git file decorations

Explorer and Source Control share VS Code's status letters, descriptions and
`gitDecoration.*` color roles, pinned to
`d3d31f62268b169a2dfab62ffb2d7d38158a5b7c`. Extracted upstream methods, color defaults,
source hashes and MIT notices live in `src/core/project/upstream/`; the build
ships their license and notice. Imported themes override those named roles;
other themes use the upstream light/dark defaults. Source Control colors the
filename and status badge while retaining muted parent paths and neutral actions.
Its index and working-tree rows describe their own resources: a partially staged
addition is A in Staged Changes and M in Changes, while Explorer shows M.

`core/project/git-file-decorations.ts` adapts the original group order (index,
untracked, working tree, merge), seven conflict states, rename aliases and
propagation rule. Deleted files do not emphasize ancestor directories. Explorer
builds descendant decorations from the whole bounded status snapshot, including
collapsed/unloaded folders and every visible repository, independently of SCM
selection or count-badge settings. Equal-weight children use path order, as in
the upstream URI tree; the SCM resource priority is not a FileDecoration weight.
Folders with changed descendants use a dot and an accessible description.
Rows retain identity, selection and focus when only status changes.

Ignored files/folders use Git's batched `check-ignore -v -z --stdin`, with the
upstream negation-aware parser. Only loaded visible entries are queried; no
recursive scan of ignored build/node_modules directories is added. Git retains
ownership of nested/global ignore rules and tracked-file exceptions. Existing
file/index/ref notifications and the bounded watcher fallback refresh decoration
state even when Source Control is closed. Ignore queries are scoped to the
nearest open repository, batched with bounded concurrency and discarded on
folder/request/component replacement; hidden repositories do not inherit their
parent's ignore state. Failures are visible and cannot fabricate a clean Git
snapshot. Status and discovery retain their existing configured limits.

This import covers local working-tree presentation, not VS Code's extension host,
SCM command stack, remote incoming-change badges, dedicated submodule S badges,
or editor-tab decorations. Existing file operations, review preparation and
native-view ownership remain unchanged. `git-file-decorations.test.ts`,
`explorer-git-decorations.test.ts`, Git service integration tests and
`project/explorer-git-decorations.spec.ts` cover the rules, real ignore semantics,
external stage/reset/commit, light/dark colors in both lists, folder propagation,
multiple repositories and focus. They are in the preview contract inventory;
the full unchanged preview contract and comparative latency gate remain required.

Repository discovery limits remain visible as a small muted information icon
in `Repositories and Count`, with a tooltip and accessible name. The full explanation belongs inside that disclosure,
so a closed notice consumes no separate block above the change list. It remains
available by pointer or keyboard, including in narrow sidebars.

## Default source word wrap

Ordinary code/plain-text/Markdown source and Git diff editors default to word
wrap off. Alt+Z and the existing Wrap command still toggle VS Code's transient
model state, shared by split views and synchronized across diff sides. Toggling
must preserve selection, focus, text, Undo and reader transitions; it does not
persist a new per-file preference after the last model owner closes. Explicit
restored editor display options continue to override the default. Notebook code
cells already default to no wrapping and retain their current behavior.
`workspace/word-wrap.spec.ts` checks the new initial state and both toggle
directions without dropping the existing independent-file, split, diff,
read-only-side, notebook, ownership and Undo scenarios. Markdown reader layout,
preparation and source-position guarantees remain in force.

## Browser reliability and compact locations

URL insertion keeps its draft on outside clicks, application focus changes,
Escape and repeated URL commands. Only its X button cancels it; successful Insert
also closes it. The captured editor selection and document revision remain the
insertion target. Returning from another split activates that target before
inserting, and stale or closed documents cannot receive the insertion. Table
insertion keeps outside-click and Escape dismissal. Popup positioning follows
the original command button in the originating group.

Every resource uses the shared location bar. When fixed controls leave less than
120 CSS pixels for the address, the inline input becomes an icon-only Search
button at the right edge of the address space, beside the trailing toolbar
controls. It returns to the growing inline input at 144 pixels
of available address width. Search has the same fixed square size and transparent
resting background as other toolbar icons; it must not stretch into an
address-shaped field or show placeholder text. Other commands stay on the
toolbar, including extensions, site controls, bookmarks, reader and
zoom. There is no overflow menu replacing them. Extremely narrow toolbars scroll
horizontally within their own group instead of covering adjacent native content.
Address focus has no keyboard shortcut. Ctrl/Cmd+L and Ctrl/Cmd+Shift+L remain
available to the focused editor or page; Markdown source can select all matching
occurrences without losing focus. Clicking the address or choosing Open Location
from the menu still selects the entire current address.

The native location overlay is at most 280 CSS pixels wide and contains only an
address input and suggestions.
Its input matches the inline address's 25 CSS pixel height and single 1 pixel
focus border, without an additional browser focus outline.
It selects the current address on opening; there is no duplicate current-address
header, readout or copy button. Native clipboard commands copy the input's
selection. It appears above native web/readers without moving or replacing them.
Wide-bar typing stays in the shell. Composition cannot submit
or navigate; Escape dismisses and returns focus to the resource. Popup tokens
isolate groups and late replies. Hidden overlays are retired after 60 seconds.
An asynchronous web-tab activation cannot take focus from an open compact panel.
Clipboard and Undo/Redo menu commands target the focused owned native input,
including this panel, rather than editing the document behind it.

The web contrast pass examines visible text against its actual solid ancestor
background after Dark Reader runs. Corrections target 4.5:1, retain authored
colors, and disappear in original-site mode. Chromium resolves modern computed
solid colors (`color(srgb ...)`, Lab/LCH/OKLab/OKLCH), including the relative
`rgb(from ...)` and `color-mix()` used by ChatGPT's sidebar. A lazy 1px sRGB
canvas resolves color values only, never page pixels; its cache is capped at
256 entries per active contrast pass. Attribute-selector state changes also
invalidate contrast. Link/button corrections include inherited currentColor
icons, and dynamically inserted labels are rechecked. `browser/themes.spec.ts`
uses the public sidebar's relative/mixed background expressions across all app
themes and checks text/icon contrast, retained input and original-color cleanup.
In Solarized Light, ChatGPT's sidebar explicitly uses white text and currentColor
icons for both pinned and recent conversations, including dynamically added rows.
This site/theme rule takes precedence over automatic foreground selection and
is removed with the contrast stylesheet when the theme or original-site mode changes.
Transparent text, disabled controls, images/gradients, blend/filter and
translucent-group backgrounds are excluded
rather than assigned a guessed background. Work is event-driven, capped at 100
nodes/8 ms per batch, 32 queued roots, 10,000 nodes per root and 1,024 retained
corrections; hidden documents pause work. This is not a guarantee for text over
images or an authenticated live ChatGPT screen that the test fixture cannot access.

Bookmark HTML import parses data without loading the file as a page. A native
confirmation describes the counts and skipped entries. HTTP(S) URLs, folder
hierarchy, order and Unicode are kept under a new imported folder; duplicate URLs
inside one imported folder and unsafe schemes are skipped. Existing URL visits
are preserved. IndexedDB v2 migrates existing stars to bookmark nodes. A batch
transaction publishes its cache after commit; Undo removes only that import and
retains URLs referenced by other bookmarks. Folder and search lists paginate at
100 nodes. Inputs are bounded at 10 MiB, 50,000 nodes and 32 nested folders. This
version imports HTML; it does not read another browser's live profile database.

The Browser library contains Bookmarks, History, Downloads, Passwords and Extensions.
Appearance is removed from this sidebar; View → Theme owns app/web theme choices,
and site controls retain their original-colors exception. Existing theme tests
continue to cover these menu choices, page preservation and restart persistence.

The first built-in password manager was removed on 2026-11-09 by product choice
(sidebar, key button, preload API, form inspection, vault, lock/sleep listeners).
Saving passwords was requested again on 2026-11-14 and returns with a different
design, described under [Browser library](#browser-library-passwords-bookmark-export-page-developer-tools-clearing-data):
no lock or unlock step, logins keyed by exact origin, nothing filled until the
user picks a login. `browser/compact-location.spec.ts` now checks that the
toolbar shows no password button on a page without a login form and that the
library lists Passwords. The old `passwords.v1.enc` profile file is still left
untouched and is never read; the new store is a separate file.

The empty workspace offers Open Terminal alongside New Document, Open File,
Open Folder and Open Web Page. It uses the existing new-terminal action, current
project cwd and normal terminal focus. The terminal lifecycle scenario verifies
opening it from the empty workspace after reload and executing in that cwd.

## File manager tabs and the in-app file chooser

A folder is a workspace resource like a document, a web page or a terminal. The
tab strip's New folder tab button, `File → New Folder Tab` (Ctrl/Cmd+Shift+E), the
empty workspace's Browse Files, an address-bar folder path (including `~`),
`setdown <folder>`, `setdown --files` and another application's "Show in folder"
(`org.freedesktop.FileManager1`) all open a `FolderTab` (`kind: 'folder'`).

- **One tab, one location.** Folder-to-folder navigation keeps the tab and its DOM
  surface and records a `folder` visit; Back/Forward restore the selection that was
  left (`core/workspace/tab-navigation.ts`, `tab-navigation-controller.ts`). A file
  address still reads the document first; only a failed read asks whether the
  address is a folder, so document navigation timing is unchanged.
- **DOM surface.** `renderer/folder/FolderSurface.svelte` is a shell layer like the
  terminal: it adds no `WebContentsView`, native bounds or preview preparation. It
  consumes the tab's content zoom for row height and font size. Rows are virtualized
  with `virtua`; a grid layout shows thumbnails only for mounted cells.
- **Same file engine.** Copy/cut/paste/duplicate, conflicts, Undo, Trash, rename and
  create run through `ExplorerService` with a filesystem-wide path policy
  (`main/files/file-system-paths.ts`). The sidebar Explorer and folder tabs share
  one clipboard, one per-window Undo history, the cross-window open-document
  protection and the renderer's save/auto-save mutation queue. A filesystem root
  can never be renamed, moved, trashed or deleted. These IPC channels exist only on
  app windows (`ipc/window-ipc.ts`); web contents and extensions cannot reach them.
- **Edit commands.** `renderer/files/file-command-target.ts` decides whether the
  Explorer or one folder tab owns Ctrl+C/X/V/A/Z and the Edit menu. Inputs, Monaco
  and the terminal keep their own text commands.
- **Drag and drop.** Dragging rows starts an OS file drag
  (`webContents.startDrag`, `files:start-drag`), not an HTML drag: only that hands
  real files to a web page in a web tab, to another application or to the
  desktop. Its payload is just `Files`, so `renderer/files/file-drag.ts` records
  the dragged paths and this window's targets recognize their own drag by the
  dropped paths: onto a folder row, breadcrumb, Place or the list it moves (Ctrl
  copies), onto the Explorer tree it keeps the Explorer's move/copy, and its
  documents take tab-strip and split placements like Explorer files. Over a folder
  tab a file drag is always a transfer into that folder, never a tab placement.
  Files dropped from another application (or another Setdown window) are
  transferred into the folder under the pointer instead of being opened: moved
  within a volume, copied between volumes or out of a read-only folder; Ctrl
  copies, Shift moves (`FileBrowserService.dropKind`). The status bar names the
  pending action, because an OS drag that offers only copy/link still shows a copy
  cursor for a move. Two platform limits are accepted: Electron runs the drag
  inside `startDrag`, so main answers no other request until the drop (native
  previews therefore cannot be captured for split guides during this drag; a drop
  on one is an ordinary file drop), and an X11 source drops with the answer to its
  previous pointer position, so a release in the same instant the pointer first
  reaches a target is a cancel.
- **Narrow panes.** Below 560 CSS px the Places sidebar becomes a drawer over the
  list only. The toolbar (and its Places toggle) always spans the pane, columns
  drop from four to two to one, and the file name column is never removed. Places
  can also be collapsed in wide panes (F9); that choice is a per-viewer preference.
- **Chooser.** `main/dialogs/path-picker.ts` keeps Electron's `showOpenDialog` /
  `showSaveDialog` signatures for every call site but answers them with a transient
  picker-mode folder tab in the requesting window. Acceptance follows GNOME Files'
  modes (`core/files/picker-rules.ts`): the selection when it fits the request,
  otherwise the current folder for folder requests; filters never hide folders; a
  save name is validated live and overwriting asks first. A file that cannot answer
  a folder request still opens on activation. Its address bar moves within the
  filesystem for a path and, as in every other tab, opens a web address or search
  in a browser tab beside it; neither answers nor cancels the request. Closing the
  tab, Escape, Cancel or closing the window cancels. Main re-validates every reply (kind, count, existing
  parent) and ignores replies from another window. Focus returns to the requesting
  tab before the chooser closes. Picker tabs are not transferable or restorable.
  `SETDOWN_NATIVE_DIALOGS=1` keeps the platform dialog; the shared E2E launcher
  sets it so specs that replace `electron.dialog` are unchanged.
- **Downloads** save directly into the Downloads folder under a reserved unique
  name, as Chrome does without "Ask where to save"; a canceled download removes its
  empty reservation. The native save prompt remains with `SETDOWN_NATIVE_DIALOGS=1`.
- **Desktop services are reused, not reimplemented.** GTK bookmarks, XDG user
  directories, `/proc/self/mountinfo`, `lsblk`/`udisksctl`, `gio` (content types,
  default applications, Trash), the freedesktop thumbnail cache and ripgrep supply
  places, volumes, Open With, properties, thumbnails and name search
  (`main/files/desktop-integration.ts`, `places.ts`, `file-search.ts`).

Checks: `core/files/*.test.ts`, `main/files/*.test.ts`,
`main/dialogs/path-picker.test.ts`, `main/browser/download-path.test.ts`,
`renderer/files/file-command-target.test.ts` and
`test/e2e/workspace/folder-tab.spec.ts` (browse, Back/Forward selection, address
completion, file operations outside a workspace, chooser accept/cancel/save, search,
grid, properties, the Files side view, narrow panes, launch with a folder).
`renderer/files/file-drag.test.ts` and `test/e2e/workspace/folder-drag.spec.ts`
cover drag and drop with real pointer input: moving a file and a document into a
subfolder, a web page receiving the dragged files' contents, a tab-strip drop, and
a second process's files moving into the folder under the pointer.

## Browser library: passwords, bookmark export, page developer tools, clearing data

Design notes and the submodule survey behind these choices:
[the implementation report](../../reports/2026_11_14_01_05_browser_passwords_bookmarks_devtools_clear_data_plan.md).

- **Saved passwords.** `main/browser/password-store.ts` keeps every login in one
  file encrypted through Electron `safeStorage`, written atomically with mode
  0600. A login is keyed by its exact origin (scheme, host and port), and only
  HTTPS or loopback origins are kept (`core/browser/passwords.ts`). Without a
  usable OS keyring (Linux `basic_text`) nothing is written: logins last until
  the application quits and the Passwords panel says so. A file the current
  keyring cannot decrypt is renamed aside, never overwritten.
- **Whose login it is.** The page preload only reports that a login form exists
  or was submitted. Main takes the site from the sending frame
  (`browser-passwords.ts` `frameOrigin`), never from the message, and rechecks it
  after every wait before a password is sent to that frame. The shell receives
  lists without secrets; one password crosses to it only for an explicit Show or
  Copy of that entry. Editing a saved login changes its user name and/or password
  in place without fetching the stored password; the site is not editable, and a
  user name already used for that site is refused.
- **Nothing is filled on load.** A saved login reaches a page only after the user
  picks it: the address bar's key button, the context menu of a field, or
  Ctrl+\ (which fills at once only when exactly one login fits). Saving is an
  offer on the same key button; it survives the navigation a sign-in causes,
  expires after five minutes and can be declined per site.
- **CSV.** Export writes Chrome's `name,url,username,password,note` layout after a
  plain-text warning, owner-readable only. Import accepts the column aliases of
  the common browsers and managers, previews how many logins are new or replaced,
  and skips rows without a password or an HTTPS address. Other browsers' profile
  files are not read: their passwords are encrypted with those browsers' keys.
- **Bookmark export.** `serializeBookmarks` (`core/browser/bookmarks.ts`) is the
  inverse of the HTML import: Chrome's Netscape header, folders in order, every
  item on its own line. An item whose folder is missing is kept at the top level.
- **Page developer tools.** A web tab's tools open in a detached window, so the
  native-view layout, drag shields and overlay captures are unaffected. Inspect
  (context menu), F12 and Ctrl+Shift+I target the page; the application menu's
  Toggle Developer Tools targets the active web tab and otherwise the app, whose
  own tools are always at Ctrl+Shift+Alt+I. A tab with open tools is not put to
  sleep.
- **Clear browsing data.** One request clears the chosen kinds (history, cookies
  and site data, cache, download list, site settings, saved passwords) for every
  site and all time; there is no time range because neither `session.clearData`
  nor the visit store has one. It uses `session.clearData`, which removes by web
  origin, so extension storage (uBlock's filters and settings) is kept; bookmarks
  are never a choice. Kinds are cleared independently and failures are reported
  per kind. Open pages reload after cookies or site settings are cleared.

Checks: `core/browser/password-csv.test.ts`, `main/browser/password-store.test.ts`,
`main/browser/bookmark-import.test.ts`, and `test/e2e/browser/passwords.spec.ts`
(offer, update, decline, exact-origin matching, fill only on request, panel,
in-place edit, CSV round trip), `clear-data.spec.ts` (site data gone, bookmarks and a uBlock user
filter kept, reload), `devtools.spec.ts` (Inspect, keys, menu target, no sleep)
and `bookmark-import.spec.ts` (export and re-import).
