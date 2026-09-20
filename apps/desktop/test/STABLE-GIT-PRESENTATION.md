# Stable Git presentation / fragment rendering

This branch contains connected production code, not just the original presentation-intent parser.
It extends `fce5eb8` / `ca81a4a` without modifying CI or workflows.

## Run

```sh
git fetch origin
git switch perf/git-review-stable-presentation
git pull --ff-only origin perf/git-review-stable-presentation
npm start
```

Use a clean working tree or save local edits first. Do not merge just because the
isolated checks below passed: full Electron integration is still pending.

## Connected changes

- The ProjectController uses a Git-only presentation transport. A synchronous
  show/position/observe sequence becomes one immutable request in a microtask,
  rather than showing the page before delivering its desired position.
- The normal source editor remains painted but inert under the native Viewer.
  The old front stays visible while the replacement prepares; the new front is
  shown before the old native view is hidden. No screenshot or second renderer
  for Monaco, no model/Undo changes, no KaTeX or CSS replacement.
- The main coordinator rejects superseded requests and validates owner, native
  view/page identity, installed revision, geometry and zoom before exposing a view.
  Source-mode/hide/close cancels pending transactions. A resize while waiting
  retains the final source intent rather than replacing it with an empty resume.
- Fonts already loading are awaited in the target page. There is no fixed settle
  timer or animation-frame delay on the normal presentation path. A 5-second
  watchdog is error handling only; stale acknowledgments do not authorize a swap.
- The current page's SourceAtlas remains responsible for its exact warm no-op
  proof, before/after coordinates, weighted band and block offset.
- A/B follow-up rendering waits in the background if its target is still the old
  visible front. It does not mutate a visible page to get a newer result sooner.
- The Git baseline and reusable modified pages request `fragmentOnly` from the
  existing serialized render worker. This uses the same Crossnote `parseMD`
  preview options, sandbox filesystem, source anchors, math placeholder wrapper
  and KaTeX HTML restoration. It avoids generating/encoding/transferring an unused
  full page and avoids ordinary preview-block splitting for those requests.
- First modified-page loads still request the full template. A lean page that
  gains content requiring the full Crossnote runtime falls back to a full render
  and upgrades once instead of silently dropping diagram features. Later updates
  to that capable page return to fragment-only rendering.
- Ordinary Markdown rendering/export/search request paths keep the old defaults.

## Verification actually performed for this posting

26 production-module checks passed using TypeScript transpilation and an injected
Node harness. They cover request validation, snapshot immutability, cancellation,
stale revisions/pages/geometry/zoom, batching, retained resize intent, native
presentation ordering, normal Markdown passthrough, fragment parse options,
fragment-only warm calls and full-runtime capability upgrade. Electron targets,
Crossnote and worker transport were fakes; this is not a full repository test run.

Six scenarios ran in actual headless Chromium using the production presentation
runtime: position-before-ack, rejected revision, resume without position, pending
font cancellation, superseded font request and content changing during the wait.
The SourceAtlas was an injected DOM/scroll probe, not the full math renderer.

Pure parser/coordinator/fragment helper modules passed strict TypeScript checks.
Changed TS and the Svelte script passed transpile/parser checks. Full repository
TypeScript/Svelte compilation, Electron tests, actual Korean IME, math image
parity, native GPU presentation and same-device latency distributions have NOT
been run in this environment (GitHub/npm DNS unavailable).

The previously quoted 55 Node / 10 Chromium counts are not asserted for this
reconstructed posting. The counts above are the checks actually rerun here.

## Important distinction

A positioned DOM acknowledgment is not a GPU compositor fence. This change
removes deliberately exposed intermediate positions and the hide-first gap; it
does not claim that all OS/GPU frame flicker is proven eliminated or that a
particular millisecond latency target has been measured.

## Local checks

```sh
node apps/desktop/scripts/check-review-presentation.cjs
npm run typecheck --workspace @setdown/desktop
npm test --workspace @setdown/desktop
npm run test:e2e --workspace @setdown/desktop -- review-presentation-runtime
npm run test:e2e --workspace @setdown/desktop -- shared-document-history verified-review-position git-review-reading-position git-review-ime workspace-zoom
```

Manually test a math-heavy Working Tree: repeat Esc without edits, edit only prose,
edit one formula, resize/zoom while preparing, switch tabs during preparation and
switch back. Check first and warm Esc positions, latest content, continuous Korean
composition and Undo across both editors. Compare the same file/size/zoom/device
with main. A missing acknowledgment must leave a readable old surface, not make
a partial/incorrect page appear. No code here depends on a CI configuration.
