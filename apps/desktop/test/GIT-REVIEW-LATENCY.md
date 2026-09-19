# Git review: precompute rather than wait on Escape

Base: `5fdc9dd97110aa6951d0149945b081c23a4d08c5`.

## Contract and implementation

- Escape is demand, not an edit: duplicate requests do not mark an in-flight render dirty. Busy/clean guards run before whole-document work.
- Preview preparation no longer calculates source hunks in the UI renderer. Rendered block alignment does not consume them. Source navigation still has its existing hunk calculation where needed.
- Idle 150ms plus a non-resetting 500ms checkpoint keeps preparing during continuous typing. One render runs per review, with only the latest following snapshot retained.
- Source mode maintains current geometry. Entire-review deactivation still invalidates it. Source viewport notifications are passive and coalesced; Escape still samples the actual Monaco viewport synchronously.
- A/B pages navigate initially, then use the existing sanitized `marktex:update-html` path on the hidden back page. The front is never overwritten in place. This is whole-body installation, NOT an incremental diff-row parser.
- The existing rendered alignment, emphasis and unsupported-content rules run in a dedicated utility process. Markdown/KaTeX remain in their existing serial worker. This is not a new multi-Crossnote worker pool.
- Eligible immutable baselines use an 8-entry / 16MiB estimated payload LRU cache keyed by content and render context. Potential imports, media, raw HTML, front matter and code-chunk attributes bypass caching. Notebook invalidation clears the cache.
- Installation requires the matching revision acknowledgment. Hidden geometry/position preparation requires its matching token. Timeouts fail and retain the previous front; they do not mean ready.
- Side-specific document-coordinate anchor rects are cached across scrolling/positioning. Content/resource/font/size changes invalidate the cache. Actual before/after coordinates, weighted band and block-offset arithmetic are preserved.
- A completed same-baseline snapshot may be displayed while newer input is being prepared; the live document is never rolled back. The host exposes refreshing state through aria-busy. No claim is made that uncomputed latest content exists instantly.

## Preserved boundaries

No changes to Monaco composition handling, caret/selection reconciliation, source wrapping, key routing, Git mutation semantics, rendered-diff CSS/algorithms or normal tab resume intent. Initial navigation retains the existing native-focus/IME isolation. The new prewarming code never calls focus(), changes visibility, or reinstalls an editor model. The normal Markdown rendering path remains unchanged apart from shared bookkeeping helpers.

The native compositor still has to present a frame. A hidden-layout acknowledgment is not proof of an actual on-screen paint. Real Electron timing remains an acceptance requirement.

## Verification actually executed during preparation

- 25 checked-in unit-test bodies passed under an offline Node adapter. Vitest registration/fake timers were replaced by node:test and an explicit fake clock; Electron/project/renderer boundaries were mocked. This is NOT a full Vitest or Electron pass.
- Real Chromium checks with the changed SourceAtlas and hidden preparation module: 1,000 initial anchor-rectangle reads; zero additional reads for 100 warm positioning calls; correct before/after distinction and weighted-band result; fresh rectangle reads on resize; matching preparation acknowledgment without requestAnimationFrame; obsolete revision rejection and no redundant prewarm acknowledgment. The unchanged weighted-band helper was copied into that narrow offline harness; point-to-anchor lookup was not exercised by it.
- Changed TypeScript and Svelte script transpile/syntax checks passed. Standalone strict TypeScript checks passed for the checkpoint scheduler, render-identity helper and baseline cache.
- Full repository typecheck, Svelte template compilation, the actual Vitest suite, Electron E2E and real Korean OS IME were NOT executed in the dependency-limited preparation environment.
- No measured end-to-end Electron P95 number is claimed. In particular, the 50ms warm-Escape goal is a target, not a reported result.

## Run in a complete checkout

```bash
npm run typecheck
npm test --workspace @setdown/desktop -- preview-checkpoints review-baseline-cache review-preparation preview-reuse git-review-latency
npm test --workspace @setdown/desktop -- source-control-controller git-review-viewport composition-guard
npm run test:e2e --workspace @setdown/desktop -- review-preparation-layout git-review-instant-escape
npm run test:e2e --workspace @setdown/desktop -- git-review-cold-escape git-review-reading-position git-review-tabs git-review-ime source-atlas-review
```

`git-review-instant-escape` deliberately holds a newer installation while pressing Escape. It requires actual visible native document content and a nonempty capture before releasing the update, then verifies fresh content and stable A/B URLs/context sentinels. It must not pass merely because a spinner or shell class changed.

## Native acceptance before merging

Measure input-to-visible-document separately from latest-revision arrival using actual Electron tracing/capture, not only a shell rAF. Compare warm unchanged Escape, immediate Escape after a keystroke, continuous Korean composition, a first cold preview, very large pasted changes and resizing/theme changes. Repeat at least 30 warm transitions on a declared fixture/device and report median/P95; target warm P95 below 50ms without claiming a guaranteed cold/latest-content bound.

Verify both panes, math/tables, a cursor near the top/bottom, offscreen-cursor weighted band, long-block Viewer bookmarks, tab-away/tab-back, A/B completion during scrolling, narrow/unified layout, stage/unstage baseline changes, close during render, ordinary Markdown and tab transfer. Korean composition must remain intact while hidden preparation completes. Never remove these behaviors to make a timing test pass.
