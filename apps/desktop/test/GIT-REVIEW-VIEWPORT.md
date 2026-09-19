# Git review viewport regression

## Behavior contract

A tab resume is not an Editor-to-Viewer transition. Returning to the same live
preview at the same size must preserve its native scroll position without sending
a new position command. Explicit Esc reads the active Monaco pane synchronously
through `readEditorViewport`: a visible cursor keeps its actual screen ratio;
an offscreen cursor uses the visible source band and its existing weighted mapping.

Source and Viewer bookmarks are separate. A replacement preview or a changed
viewport size restores the last Viewer bookmark, including its before/after source
space and fractional point within a tall block. Hidden back-buffer and obsolete
observation messages may not overwrite that bookmark. This state is per open tab;
this change does not add full bookmark persistence across application restarts.

## Automated checks

From the repository root:

```bash
npm run typecheck
npm test --workspace @setdown/desktop -- review-viewport editor-viewport source-control-controller
npm run test:e2e --workspace @setdown/desktop -- source-atlas-review git-review-reading-position
npm run test:e2e --workspace @setdown/desktop -- git-review-cold-escape git-review-tabs git-review-ime
```

`source-atlas-review.spec.ts` bundles the production SourceAtlas with esbuild and
uses real Chromium layout. `git-review-reading-position.spec.ts` launches Electron
and checks native preview identity, scroll preservation through both review and
ordinary tabs, and subsequent explicit source navigation.

## Manual acceptance

Use a long Markdown file with headings, wrapped paragraphs, and display math.
Prepare both staged and unstaged changes, including an insertion near the top so
before/after source line numbers no longer match.

1. Open Working Tree, switch to Viewer, scroll far away from the editor cursor,
   visit an Index tab and a normal document tab, and return. The Viewer mode and
   last reading position should remain, with no rewind or forced recenter.
2. Repeat in Index. Resize the window while away, then return: the same reading
   block/point should be restored rather than the last source cursor.
3. Edit, Esc, then scroll while the background preview completes. A/B replacement
   should preserve the latest observed Viewer bookmark. Exercise rapid tab switches
   and scrolling at completion as well as a quiet, fully prepared preview.
4. In Source place the cursor near the top and bottom of the viewport and press
   Esc. Repeat with a wrapped line, then leave the cursor offscreen and scroll.
   The visible cursor's height, or the visible band, should determine the transition.
5. At split width, click a deleted block on the left and an added block on the right.
   Source navigation must use the appropriate side, not the other document's same
   line number. Also check narrow/inline rendering and deleted-only regions.
6. Check Korean composition, canceling composition with Esc, undo/redo, the cold
   first Esc, and ordinary Markdown transitions. No added timer or focus recovery
   is part of the new Esc viewport read.

## Validation performed during authoring

25 new unit test bodies passed under an offline Node adapter. Vitest registration
was replaced with node:test, reactive project state and the desktop port were
mocked, and textDiffHunks was stubbed because npm dependencies were unavailable.
This is isolated ordering/math/viewport validation, not a full repository run.

10 real Chromium checks passed through a Python Playwright harness: side-scoped
line selection and weighted bands, tall-block restoration after layout growth,
original lines beyond modified EOF, command forwarding, observation flush and
hidden-event rejection, unified diff selection, and ordinary Markdown behavior.
The committed browser test captures the principal layout cases in the project
Playwright format; that TypeScript wrapper has not been run in this environment.

Scoped strict TypeScript checks for the new core/port and runtime components passed.
All changed TypeScript and the Svelte script were transpiled for syntax checking.
The complete project typecheck, Svelte template compiler, actual Vitest, Electron
E2E, and real OS Korean IME tests could not run because external DNS/npm downloads
were unavailable. Complete those checks before treating this as release-verified.

This PR does not implement the separate persistent-preview/worker-pool performance
redesign. It removes synchronous full-text diff computation from `showRendered`
and adds no rendering wait or IPC round trip to that transition.
