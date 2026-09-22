# Git history integration

Source Control embeds `@web-git-graph/web` below Changes. A draggable, keyboard
operable divider controls its height; collapse and size persist within the
window session. The graph loads only while Folder Tools / Source Control /
Graph are visible. History, refs, search, comparison, context menus and virtual
rows belong to the upstream component, not a Setdown renderer fork.

The default Auto filter follows the checked-out branch and its tracking remote
branch (or detached HEAD). The upstream picker still offers Show All and manual
ref selection; an Auto button restores the default. The choice persists for
the project within the window session. Auto hides badges outside those refs,
while the provider places selected refs first so the upstream component's
four-badge cap cannot hide them. Setdown's status snapshot does not expose
VS Code's optional base ref, so Auto uses the current branch and upstream.

All three `@web-git-graph/{web,node,protocol}` packages are pinned to 1.0.7.
`vendor/web-git-graph` is an upstream reference; production builds use npm and
do not require submodule initialization. No React runtime or HTTP server is
introduced.

## Boundaries

- `GitHistoryPane.svelte`: panel size, lifecycle, theme variables, and file-open
  events. The component uses Shadow DOM and receives its provider as a property.
- `git-graph-provider.ts`: implements upstream `GitGraphProvider` over the
  desktop port. Disposing the graph aborts outstanding IPC requests and rejects
  stale replies.
- `protocol/git-history.ts`: graph transport types and the small immutable
  comparison selection used by the existing document review.
- `main/project/git-history-service.ts`: validates window/project ownership,
  IDs, paths and request bounds; calls upstream `LocalGitBackend` directly.
  Upstream owns history parsing, snapshot paging, refs and comparisons.
- Existing `GitService` owns mutations and working-tree/index review. Status
  refreshes following disk writes or Git operations refresh the visible graph,
  with watcher bursts coalesced. Unsaved typing does not query history.

File selection opens an immutable Git review tab with the target's short commit
ID. A commit defaults to its first parent; a root commit compares against empty
text. Upstream comparison selection supplies explicit base/head IDs. Rename
and deletion paths come from the backend's change list. A deleted file does not
need to exist on disk. Snapshot text uses Setdown's bounded strict byte decoder;
binary content is not typeset. Historical snapshots never acquire the ordinary
document's editable model, receive unsaved text, save to disk, or reload on
stage/commit. Markdown supports the existing source/rendered review switch.

## Pinned-version compatibility

The 1.0.7 component defaults to a 420px minimum height. The host overrides this
to zero and supplies a bounded height. It has no public `layout()` or container
resize observer. A host `ResizeObserver` reapplies its public `density` property
on an animation frame, which redraws the visible rows without reloading Git or
resetting selection. Revisit this adapter when upstream adds a layout method.

`git-graph-theme.css` and `git-graph-presentation.ts` are the isolated
presentation adapters for the open shadow root.
Version 1.0.7 has no CSS parts or configurable lane palette: the adapter styles
its toolbar, rows, refs, menus and seven SVG palette attributes. It uses Setdown
surface/selection tokens, subdued distinguishable lane colors and the shared SCM
section heading. Upstream still owns layout and interactions; no vendor files
are changed. The same adapter gives each subject an inset computed from the
upstream package's exported `layoutGitGraph` result. It accounts for lanes
crossing a row, including curves, so a distant bend does not create empty
space beside every other commit. A shadow-root observer reapplies insets only
to visible virtual rows. Check these selectors, palette attributes, row geometry,
light/dark themes and branch/menu behavior when updating the pinned package.
The public comfortable row density keeps virtualization and row heights in
agreement.

Graph avatars stay disabled. Theme selection is owned by Setdown. Graph
keyboard input owns its own Escape/Find behavior instead of triggering the
document's source/reader shortcuts. Checkout/cherry-pick/branch creation are not
provided by this read-only integration; existing Source Control mutations keep
their existing UI. The Graph heading also exposes Fetch (`fetch --all --prune`),
Pull (`pull --ff-only`), Push (`push`) and Refresh through those existing actions.
Remote operations share Source Control's busy lock and error display; Refresh
updates repository status and graph history. No force push or implicit merge is
introduced.

## Validation

`git-history-service.test.ts` uses real temporary repositories for root,
rename/deletion, binary and snapshot-paging behavior. Provider tests cover
cancellation; controller tests keep immutable snapshots independent of live
edits. `git-history.spec.ts` exercises the real Electron graph, divider, file
selection, read-only Monaco, rendered Markdown and external-commit refresh.
Changes also require the preview contract and baseline comparison described in
`preview-performance-contract.md`.
