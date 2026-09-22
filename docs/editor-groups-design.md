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
| Drop execution | `editorDropTarget.ts:handleDrop` resolves the target group, calls `addGroup` when necessary, then moves or copies editors. Moving a singleton group to itself must not create an empty split. | `EditorGroups.move` keeps document identity, chooses local neighboring selection, inserts the moved tab, focuses the destination, and prunes empty branches. This implementation moves tabs; modifier-based duplication of an editor is not introduced. |
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
- Git review retains its existing window-level review session; Git diff tabs are
  not draggable editor-group members in this change. Ordinary Markdown, source,
  text, image and PDF document tabs can be moved into groups. Layout restoration
  across application restarts and duplicate views of the same document are also
  outside this change.

## Verification

`editor-groups.spec.ts` exercises simultaneous native readers, image bounds, nested
splits, pointer resizing, multiple live Monaco editors, editing/Undo across focus,
empty-group collapse, direct background-editor focus, and wheel scroll without selection changes.
`git-review-first-open.spec.ts` additionally checks that canceling a document drag
restores the active rendered Git review. Core tests cover
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
