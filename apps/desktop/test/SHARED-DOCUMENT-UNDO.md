# Shared document history and verified review positioning

## Contract

Within one workspace renderer, an ordinary file tab owns the live Monaco model.
The Working Tree modified editor borrows that exact object. HEAD and Index remain
independent read-only snapshots. Cursor/selection/scroll view states remain local
to each editor; text, Undo/Redo and document revisions are not duplicated.

A document-owned listener publishes an edit once, including Undo/Redo and IME
updates. Working Tree no longer copies that edit back with applyEdits/setValue.
Closing/rebuilding a review releases a lease, never the document. Closing the
actual document retires its listener; the model is disposed after every attached
review releases it. Rename/Save As changes language without replacing the model;
obsolete Working Tree paths are closed. Explicit reloads are undoable full-range
edits rather than disposing a model still displayed by another editor.

## Esc safety without a new wait

A delayed shell ACK cannot prove what an independent WebContents currently shows.
This change removes the shell's `review-primed` position certificate. Esc always
delivers its current before/after anchor, band and block offset, without waiting
for a render, native response or settle timer.

The actual page decides whether the operation is already complete. SourceAtlas
keeps an immutable page-local proof of the target, installed revision, layout
generation, viewport dimensions, scale and actual scroll coordinates. Exact warm
hits skip anchor rectangle reads, the weighted solve and scroll writes. Content,
fonts, resize, zoom, unexpected scrolling or a changed request invalidate the
no-op. Empty/unsized and font-loading fallbacks are never certified. A new page
has no old proof, even when its native A/B id is reused.

The old literal invariant "no position IPC on warm Esc" is intentionally replaced
by "no redundant layout/position work on warm Esc". One final intent message is
required to avoid a cross-process stale-ACK race. Same-page Viewer tab resume still
sends no navigation command. The existing cursor/band equations are unchanged.

Hidden preparation snapshots its arguments before an asynchronous font wait and
never reapplies an older target after a newer navigation. Its ACK describes only
install/layout completion, never current positional ownership.

## Executed checks

- 26 pure test bodies for model leases/ownership and position-proof matching.
- 8 production MonacoEditor adapter test bodies with a fake Monaco model, checking
  identity, history routing, once-only notifications, reopen, reload and retarget.
- 18 production SourceControlController test bodies with injected Svelte/desktop/
  preview dependencies, including existing cold bounds and tab-resume cases,
  old ACK rejection, first-edit/in-flight render and shared document notifications.
- 14 real Chromium checks against the modified production SourceAtlas/runtime:
  cold line 120, exact warm no-op (zero rectangle scans and scroll writes), old
  line-1 prewarming, revision/layout/scroll/resize/scale invalidation, before/after,
  weighted band, tall-block offset, empty-anchor fallback and late font completion.
- TypeScript transpilation plus JavaScript parser checks for all changed TS and
  the Svelte script; standalone strict TypeScript for the pure proof module.

The 52 Node bodies used a node:test registration adapter, NOT the complete Vitest
runner. UI and Electron dependencies were mocked where described; adapter Undo
routing is NOT a measurement of Monaco's native undo service. The Chromium harness
used the unchanged weighted-band function copied from the pinned base; the
repository Playwright spec bundles the complete production dependencies.

The container could not resolve GitHub/npm to install the complete repository.
Full repository typecheck, Svelte template compilation, native Electron tests,
OS Korean IME and same-device latency distributions remain unexecuted. No CI or
workflow configuration is changed and no workflow was manually dispatched.

## Run with normal dependencies

```sh
npm run typecheck --workspace @setdown/desktop
npm test --workspace @setdown/desktop -- live-document-model shared-document-history review-position-proof source-control-controller
npm run test:e2e --workspace @setdown/desktop -- shared-document-history verified-review-position
npm run test:e2e --workspace @setdown/desktop -- git-review-ime git-review-reading-position git-review-cold-escape workspace-zoom text-workspace
```

The new native tests exercise Markdown and text through actual keyboard Undo/Redo,
save, stage and review reopen. Browser tests check real layout and delayed fonts.
These repository-native Playwright tests were added but not run in this container.

Before merging, also check dirty/save state through mixed-surface undo, Index
reverts, discarded/reloaded files, rename across .md/.txt, two simultaneous files,
Korean composition, source wrapping, 50/100/150/200% zoom, ordinary Viewer return,
long blocks and resize. Warm-hit work counts should remain zero; do not equate a
quick IPC call with a measured native paint latency.

Scope: sharing is within a live workspace renderer. Persisting private Monaco
undo stacks across application restarts or OS-window transfers is not added.
