# Ctrl+wheel zoom

Ctrl+wheel now changes workspace zoom, not a separate Monaco-only font setting.
The shell, Markdown Viewer, source editor, Git source diff and native A/B review
views share the same application-session scale. Multiple Setdown windows share
it intentionally, avoiding inconsistent zoom for Chromium same-origin previews.
Ctrl+0 resets to 100%. The range is 50%-300%; high-resolution wheel events are
accumulated before applying 10-percentage-point steps. Ordinary wheel scrolling
is not intercepted. Synthetic page-dispatched events do not invoke privileged IPC.

Both sandbox preloads capture the trusted gesture before Monaco/preview handlers.
Main validates that the sender is a workspace main frame or an owned visible
preview, and validates bounded integer steps. No new main-world API is exposed.

Zoom does not change document text, revision, saved bytes, Monaco models, IME
composition, native view identity, or preview URL. It does not request Markdown
rendering or recreate a view. Existing layout/resource invalidation still runs.
New views inherit the current zoom after initial navigation. The title-bar overlay
tracks shell scaling. Native view coordinates are converted from renderer CSS
pixels to Electron DIP using page zoom, not devicePixelRatio; the same conversion
is used for hidden Git prewarming and visible presentation.

## Verification in the implementation environment

- Two new production modules compiled with strict TypeScript (ES2022 + DOM).
- 16 Node checks of the production zoom/accumulation code passed. The Electron
  targets were injected fakes, not actual native views.
- Six browser interaction scenarios passed in installed Chromium: trusted
  Ctrl+wheel; preventing duplicate downstream handling; retaining scroll during
  zoom; normal wheel scrolling; rejecting synthetic events; reset and disposal.
- The two Electron tests in `workspace-zoom.spec.ts` were added but not run.
  Full repository typecheck/Vitest/Svelte compilation, native Electron geometry,
  Fedora Korean IME and warm-Esc timing comparisons remain local acceptance work.
  No CI/workflow configuration was added, updated or dispatched.

## Local checks

```sh
npm run typecheck --workspace @setdown/desktop
npm test --workspace @setdown/desktop -- workspace-zoom text-workspace text-review text-files.integration text-search
npm run test:e2e --workspace @setdown/desktop -- workspace-zoom text-workspace
```

Manually zoom with the pointer over both Monaco diff panes and over the native
rendered comparison. Check Viewer -> Source -> Esc and tab return at 50%, 100%,
150% and 200%; retain the current reading point, before/after side, no clipping,
no new page load, and no interruption to Korean composition. Test a resized window,
sidebar changes and a tab transferred to another window. Mixed-file and Markdown
fastpath acceptance remains documented in `TEXT-WORKSPACE.md`.
