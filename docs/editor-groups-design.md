# Editor groups and tab scrolling

The tab strip scrolls horizontally with a mouse wheel or trackpad without changing
selection. Drag a document tab or an Explorer file to an editor's left/right/top/
bottom edge to split that group; drop in its center to join it, or onto its tab
strip to insert/reorder. Groups can be split again, resized by their boundaries,
and restored to equal sizes by double-clicking a boundary. Arrow keys also resize
a focused boundary. Moving/closing the last tab removes its empty group. Dropping
a tab outside the window still uses the existing window-transfer protocol.

## VS Code source investigation

Inspected `vendor/vscode` at `05e414c309fa121dc9a2046946a38534b32d4180`.
These are separate mechanisms in VS Code, rather than mini-tabs inside a tab:

| Responsibility | VS Code source and behavior | Setdown integration |
| --- | --- | --- |
| Wheel scrolling | `src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts`, `createTabsScrollbar`: `ScrollableElement` with `scrollYToX: true`, applying `scrollLeft` from its scroll event. A separate wheel handler implements the configurable `scrollToSwitchTabs` behavior. | `renderer/tabs/tab-scroll.ts` maps the dominant wheel axis to horizontal scrolling, normalizes pixel/line/page units, and leaves Ctrl/Meta gestures alone. It never calls activation. Selection changes reveal their tab separately. |
| Local drop target | `src/vs/workbench/browser/parts/editor/editorDropTarget.ts`, `DropOverlay.positionOverlay`: individual editors split only inside the outer 10% band. With the default rightward preference, the left/right thirds win at corners; the central third chooses up/down. Center drops have no split direction. | `core/workspace/editor-groups.ts:splitDirection` implements that decision independently of DOM state. The overlay covers the proposed half, or the complete body for a center drop. The tab strip has separate insertion logic and edge auto-scroll. |
| Drop execution | `editorDropTarget.ts:handleDrop` resolves the target group, calls `addGroup` when necessary, then moves or copies editors. Moving a singleton group to itself must not create an empty split. | `EditorGroups.move` keeps document identity, chooses local neighboring selection, inserts the moved tab, focuses the destination, and prunes empty branches. Ctrl-drag on Linux/Windows and Alt-drag on macOS copy shareable text/review views. An identical input already in the destination is reused; singleton surfaces retain their own owners. |
| Group selection | `src/vs/workbench/common/editor/editorGroupModel.ts` keeps ordered editors, selection, and MRU inside each group. `doCloseEditor` selects either the recent editor or an adjacent editor, depending on settings. | `WorkspaceState` retains document/model ownership. `EditorGroups` separately owns each group's ordered tab IDs and selected tab, plus the focused group. Closing selects the adjacent tab in that group. |
| Layout | `src/vs/workbench/browser/parts/editor/editorPart.ts:addGroup` adds a group view to `gridWidget` with direction and sizing policy; it restores focus after reparenting. `src/vs/base/browser/ui/grid/grid.ts:addView/removeView` resolves relative locations and split sizing. `gridview.ts` composes orthogonal `SplitView` instances with sashes and constraints. | A small binary split tree stores axis and ratio; `groupLayout` produces stable leaf rectangles and sash rectangles. Svelte keys leaf hosts by group identity, rather than remounting resources whenever nesting changes. Pointer capture drives resizing; native view gutters preserve sash hit targets. |

The workbench classes depend on VS Code services, editor inputs, and its group/view
lifecycle. Importing them would require bringing in that workbench ownership model.
Setdown retains Monaco for editing and Crossnote for rendering, and implements only
the group/placement adapter around its existing document and native-view owners.
No vendor sources or dependency versions are changed.

## Resource and focus ownership

- Documents, revisions, dirty state, and Monaco models remain owned by the existing
  workspace. Each group has a Monaco view; moving a tab keeps its model and Undo
  stack. Nonfocused editors remain live and editable. Clicking/focusing their
  surface switches command ownership before subsequent edits and save commands.
- The focused group's existing reader, search, outline and Git-review controls
  remain the command surface. Other selected Markdown tabs have independent native
  view bounds. PreviewManager accepts only views owned by the requesting window,
  retains those backgrounds when the foreground changes, and uses the same CSS to
  native bounds conversion and hidden preparation logic as before.
- Native preview focus identifies the document to the renderer. Background reader
  preparation checks tab identity, path, revision and theme before publishing its
  result. Dragging/resizing and shell overlays temporarily hide native layers so
  they cannot intercept the shell's pointer input.
- Visible image/PDF readers are pinned in the media cache even when more than three
  groups are open. Hidden resources remain subject to cache eviction. PDF Find
  targets the focused group, while each visible reader keeps its own page/zoom.
- `DocumentStore` owns shared mutable text independently of tabs. Ordinary and
  Working Tree inputs share its model, dirty state, save checkpoint and Undo.
  Index/history inputs own immutable snapshots. Each review has its own controller,
  viewport, source/rendered mode, native view IDs and presentation state; global
  SCM fields are only the focused view's command projection.
- The same input is deduplicated within its target group. Different groups may
  contain ordinary or comparison views of the same text. Each view keeps its
  selection, folds, scroll, zoom and source/reader mode. Split copies the current
  input even when it is the group's only tab. Copying starts a new zoom scope.
- SCM offers Open Changes, Open Changes to the Side, Open File, and Open File to
  the Side. A side open reuses the right neighbor or creates it. A late response
  cannot replace a newer group request or take focus from a different group.
- `PreviewLayoutCoordinator` combines the ordinary readers and all visible reviews
  into one native layout update. Overlays and drag freezes apply to all of them;
  hiding one review cannot remove another group's native reader.
- Sessions and recovery snapshots restore files/groups only on explicit request.
  New processes still start empty. Dirty content whose saved disk hash no longer
  matches restores to a separate untitled document. Browser and terminal process
  lifetimes remain separate. See [editor tools](editor-tools.md).
- Cross-window diff tear-off and shared Undo across Electron windows remain outside
  this contract. Unsupported diff drops preserve their source. Ordinary transfers
  retain the existing acknowledgment protocol; a destination already owning the
  same path rejects the incoming transfer without discarding either buffer.

## Tab context menu and pinned tabs

Right-clicking a tab opens VS Code's tab commands that have a Setdown counterpart.
The menu acts on the clicked tab without selecting it.

| VS Code | Setdown |
| --- | --- |
| Close, Close Others, Close to the Right, Close Saved, Close All | Same, scoped to the tab's group. Bulk closes ask once for every document whose last view is closing, and stop at Cancel or at an edit made while the prompt was open. |
| Copy Path, Copy Relative Path | Same for files and folder tabs; relative to the open project folder. A web tab offers Copy Address. |
| — | Copy, above them, puts the file or folder itself on the clipboard, as Copy on an Explorer row does; see "Explorer file operations" in the workspace contract. Every tab with a saved file or a folder has it; web pages, terminals and unsaved documents do not. |
| Open Containing Folder, Reveal in Explorer View | Reveal in Folder Tab opens the parent folder with the file selected; Reveal in Explorer View needs the file inside the project folder. |
| Keep Open | Same: turns a replaceable preview tab into an ordinary one. |
| Pin, Unpin | Same; see below. |
| Split Right, Split & Move | Split copies shareable inputs (text, reviews, folders) into a new group. Move joins the adjacent group on that side, or opens one while other tabs stay behind. |
| Move into New Window | Same, through the window-transfer protocol without a drag. Reviews and file choosers stay in their window. |

Copy Breadcrumbs Path, Reopen Editor With, Share, Add File to Chat, Copy into New
Window and Find File References have no counterpart and are not offered.

`core/workspace/tab-menu.ts` is the menu model. The renderer describes the tab
(`renderer/workspace/tabs/tab-menu.ts`), main shows the model in the native menu
layer, so it stays above live readers and web pages, and resolves with the chosen
command for the renderer to run. Main writes the clipboard itself: the shell
document does not hold focus while the menu layer is open. Copy goes through
`files:copy`, where main checks that the path exists before owning the clipboard.

Pinned tabs follow VS Code's `EditorGroupModel` sticky editors. `Group.sticky`
counts the leading pinned tabs. They keep the order in which they were pinned, new
tabs open after them, and Unpin makes a tab the first ordinary one. Dragging a tab
among them pins it, dragging one past them releases it, and a pinned tab stays
pinned when it changes groups. A pinned tab shows a pin in place of its close
button, is skipped by the bulk closes, and Ctrl/Cmd+W selects the next ordinary
tab instead of closing it; Close in its menu still closes it. Pins last for the
window session: workspace snapshots and tabs moved to another window do not
carry them.

A menu move creates its window at that moment. Main delivers the tab only after
that window's renderer publishes its first tab state, because the page finishes
loading before the shell's lazily imported workspace subscribes to transfers.

## Tab groups

Tab groups are Firefox's (`browser/components/tabbrowser/content/tabgroup.mjs`,
`tabgroup-menu.mjs`, `tab-context-menu.mjs`, `drag-and-drop.mjs`): a named,
coloured run of neighbouring tabs in one strip that folds to its label. In the
code a tab group is a *cluster* (`core/workspace/tab-clusters.ts`), because
"group" already means an editor group, a pane with its own strip. People read
"tab group".

| Firefox | Setdown |
| --- | --- |
| Tab menu: "Add Tab to New Group"; with another group in the window, the submenu "Add Tab to Group" (New Group, then the groups); "Remove from Group" for a member | Same, for the groups of the tab's own strip. A group without a name is listed as "Unnamed group (Blue)". |
| Drag a tab onto another, pause (240 ms), drop: a group of the two | Same, over the middle three fifths of a tab that is loose (not pinned, in no group). The tab under it is ringed once the hold is long enough. |
| A new group is unfolded, unnamed, in the first of nine colours no group uses | Same; when all nine are used, the one used least (Firefox: a random one). |
| Create panel under the label: name field focused, nine swatches, Cancel and Done; name and colour apply as they are chosen; Escape and Cancel undo the group; Enter, Done and a click elsewhere keep it; Enter that ends an input-method composition is ignored | Same. |
| Left click on the label folds or unfolds; right click and the menu key open the panel for the existing group | Same. The panel for an existing group has "New tab in group" (a web tab), "Ungroup tabs" and "Delete group" (closes its tabs under one unsaved-changes question). |
| A folded group shows only its selected tab, with "+N" for the others; the line under the label shows only when the group is unfolded or holds the selected tab | Same. "+N" unfolds the group. |
| 2px line in the group's colour under the label, the tabs and the count | Same, in Firefox's light and dark colour values. |
| A new tab opens outside every group; "New tab in group" opens at the group's end and unfolds it | Same: a tab opened while a member is selected comes after that group. A preview that replaces the selected preview keeps its place in the group. |
| Next and previous tab skip tabs hidden in folded groups | Same, and closing the selected tab selects the nearest tab that shows. |
| Pinned tabs are in no group | Same: pinning a member takes it out; putting a pinned tab into a group releases the pin. |
| A group with no tab is gone; "Remove from Group" puts the tab right after its group | Same. |
| Dragging: before a label is before the group; over an unfolded label is its first place; onto a folded label joins without unfolding; past a group's last tab is outside | Same, read from the halves of the piece under the pointer (`stripDrop`). The guide line takes the group's colour when the tab would join. |

Not built: dragging a whole group by its label, saved groups ("Save and close
group", middle click), the hover preview of a folded group's tabs, moving a group
to another window, and several selected tabs (the strip selects one tab).

`Group.clusters` holds a strip's tab groups in strip order. Every change to a
strip ends with `normalizeTabClusters`: a tab is in at most one group, pinned tabs
in none, a group's tabs stand together, and a group without tabs is removed.
`stripItems` is what `TabChrome.svelte` draws; `visibleTabs` is what next/previous
tab moves over. `EditorGroupPlacement.cluster` names the group a dropped tab joins
(`null`: none; left out, its neighbours decide: between two members it joins, at
an edge of its own group it stays). `TabClusterPanel.svelte` is the panel; it
lies over the whole window and raises the native-overlay signal, so a live reader
or web page under it gives way while it is open.

Tab groups last for the window session, like pins: workspace snapshots and tabs
moved to another window or pane do not carry them.

## Verification

`tab-menu.spec.ts` drives the menu in real Electron above a live reader: position,
clipboard, Explorer reveal, pinning, bulk closes, split, move and the new window.
`tab-groups.spec.ts` drives tab groups the same way: both menu forms, the panel
(focus, live name and colour, Enter, Escape, Cancel, Done, a click elsewhere, over
a live reader), folding with and without the selected tab, the count, Next Tab and
closing beside a folded group, joining and leaving by menu and by drag, the hold
that makes a group of two tabs, pinning a member, and the panel's three commands.
`tab-clusters.test.ts` covers the strip rules, what a strip draws, where a dragged
tab lands, colours and names.
Unit tests cover the menu model, sticky ordering, the single close prompt and the
transfer without a drag.


`editor-groups.spec.ts` exercises simultaneous native readers, image bounds, nested
splits, pointer resizing, multiple live Monaco editors, editing/Undo across focus,
empty-group collapse, direct background-editor focus, and wheel scroll without selection changes.
`git-review-first-open.spec.ts` additionally checks that canceling a document drag
restores the active rendered Git review. `workspace/editor-tools.spec.ts` also checks explicit recovery after process loss,
and `review-workspace.test.ts` checks side reuse and late request ownership. Core tests cover
drop geometry and tree/membership invariants. Native presentation tests cover
owner validation and background/foreground visibility. Media tests cover pinning
beyond the normal cache capacity.

The existing window-detach tests now specify a negative client X at drag end: their
old synthetic default `(0, 0)` did not actually represent a pointer outside the
window. Their preview identity, scroll-position and ownership assertions remain.

The image restart test now waits for persisted pan coordinates as well as zoom and
rotation before closing the application. Its previous partial check could capture
the rotation's centered position before the asynchronous scroll event persisted
the subsequent pan. The restart comparison is unchanged; the setup assertion is
stronger.
