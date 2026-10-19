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
A subsequent dragover replaces the guide; a rejected area, confirmed window exit,
or explicit cancellation clears it. Chromium's canceled drag (`dropEffect: none`) must not
commit a guide even when Escape never reaches the DOM. `tab-detach.spec.ts`
covers guide placement and these invalidation paths in Electron, alongside
actual outside detachment.
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
a native-boundary leave signal, order, group collapse, and Undo. `test/e2e/browser/*.spec.ts`
checks the same boundary signal during a real web-tab split;
`tab-detach.spec.ts` checks cross-window strip drops even when source dragend
precedes the destination claim, preserving the live native reader and position.

