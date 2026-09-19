# Working Tree Markdown editing tools

Base inspected: `da4aad37444a8eeedfa3814ffead0f617b6aa927`.

## Feature audit

The ordinary editor's add-ons live in `editor-insertions.ts`,
`editor-image-paste.ts`, and `MonacoEditor.installBindings()`. Previously their
context and paste host pointed only at the ordinary editor. The Git toolbar
also unconditionally hid the insertion controls.

This change shares those tools with **the modified/right pane of a Markdown
Working Tree source review**, rather than creating a second insertion engine.

| Existing ordinary Markdown behavior | Working Tree behavior |
| --- | --- |
| Table grid/popover | Same toolbar and editor context-menu command |
| Selected TSV -> table draft | Same headers, rows, escaping and preferred EOL |
| Link popover | Toolbar, context menu and Ctrl/Cmd+K |
| Selected text + pasted URL | Same label-to-link conversion, once per paste |
| Local file link picker | Same existing main-process picker and relative path logic |
| Clipboard bitmap / copied local image files | Same existing asset writer and Markdown result |
| Copied browser image / image URL | Same remote image reference; no new downloader |

Native Monaco editing, search, selection and undo/redo remain native. Outline
and project-search navigation are not duplicated into a diff as editing tools.
The intentionally denser diff font/layout and existing preview algorithms are
unchanged.

## Boundaries

- A synchronous renderer-local port exposes only the active editable Markdown
  review's modified model. Index, original/before, rendered mode, non-Markdown,
  missing models and IME composition do not expose an insertion target.
- A single workspace paste pipeline checks the event's actual Monaco DOM
  origin. It cannot process a paste in a link input, commit message, original
  pane or hidden ordinary document. Plain-text paste remains Monaco's job.
- The toolbar follows the review's mode rather than the underlying ordinary
  tab's surface. A source review can be editable while its ordinary tab is
  still in Viewer mode.
- All insertions use `executeEdits` with undo stops. No `setValue`, model
  replacement, preview render, native-view operation or new input debounce is
  introduced by these tools. Existing content-change notifications perform the
  Working Tree -> live document synchronization.
- Dialogs and asynchronous image/file operations capture surface identity,
  model, document path, selection and model version. A changed target is
  rejected instead of silently editing a new tab or overwriting newer input.
  Cancel/close does not focus an unrelated or hidden editor.
- Clipboard asset writing itself is unchanged. A target invalidated during
  an asynchronous asset write can leave an unused asset, but never inserts its
  Markdown into a different document. The user is told to paste again.
- The two existing Escape delivery paths (native command and DOM keydown) are
  consumed for an open insertion popup. Closing the popup does not also enter
  the Viewer on that same key. This is an immediate opposite-route echo check;
  it does not add a timer or delay the normal no-popup Escape path. Existing IME
  guards remain in place.
- Listener/command registrations are disposed with the editor/workspace.

## Validation performed in the authoring environment

1. **39 unit test cases passed**, including ordinary/review link and table
   insertion, TSV/CRLF, smart URL/image arbitration, plain paste, native-image
   request routing, read-only/IME isolation, stale selection/model/tab/path,
   asynchronous picker cancellation, listener disposal, action registration,
   undo boundaries, popup Escape and Untitled Save As.
   These ran against the production modules in an explicit offline Node
   adapter: Vitest registration was replaced by `node:test`, Svelte `$state`
   by plain state, and Monaco/DOM/desktop were the test doubles in
   `markdown-editing.test.ts`. This is **not** an actual Vitest/full-app run or
   verification of Monaco's real undo stack.
2. **9 browser checks passed in system Chromium** using the production paste
   modules and real DOM events, DOMParser and CSS. Checks covered capture/event
   origin, original/dialog/commit isolation, copied browser images, read-only,
   review toolbar visibility over a Viewer-mode ordinary tab, hidden controls,
   and listener removal. Monaco, desktop IPC and Svelte state were doubled;
   this was not an Electron/native clipboard test.
3. Changed TypeScript and Svelte script blocks passed syntax/transpile checks.
   This does **not** replace semantic `tsc` or Svelte template compilation.

**Not executed:** full repository typecheck, Svelte compilation, actual Vitest,
Electron integration tests, actual OS Korean IME, and native clipboard/file
picker behavior. GitHub/npm DNS access was unavailable in the build container,
so full application dependencies could not be installed. Native integration
and OS checks remain required before release.

## Repository regression tests

```bash
npm run typecheck
npm test --workspace @setdown/desktop -- markdown-editing markdown-insertions composition-guard
npm run test:e2e --workspace @setdown/desktop -- git-review-editing-tools markdown-insertions
npm run test:e2e --workspace @setdown/desktop -- git-review-ime git-review-reading-position git-review-tabs git-review-instant-escape
```

`git-review-editing-tools.spec.ts` is an Electron integration regression with
real Git/Monaco/document saving. It checks table/link insertion, Ctrl/Cmd+K,
undo/redo, selected-URL paste, popup Escape, local linking (only the native
chooser is stubbed), PNG clipboard asset creation, unchanged Index content,
read-only targets, commit inputs, ordinary editor compatibility and tab
roundtrips. These integration tests were written but **not run here**.

Before merging, exercise Korean composition while a background preview is
preparing; insert/paste then immediately Escape; paste a native screenshot and
a file-manager image; cancel a local picker or change tabs while it is open;
try the original/Index pane; and verify insertion undo plus saved Markdown and
asset paths. Normal read-only copying and native plain-text paste must still
work. No end-to-end latency claim is made by this PR.
