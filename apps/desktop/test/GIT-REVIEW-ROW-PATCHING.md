# Working Tree edit → Esc: retain the rendered document

Base: `340edf5aefa68a5353708577dc4504936497a6b4`.

The reported case is **editing immediately followed by Esc**. A warmed,
unchanged review is already fast. This change deliberately keeps the existing
Source/Viewer navigation, IME guards, viewport band math, observation tokens,
A/B presentation and CSS intact. It reduces post-edit document installation.

## What changes

Previously every warm Git update sent `marktex:update-html`, replacing both
large unified/split wrappers with `innerHTML`. Ordinary Markdown's block patch
could not help: Git's top-level blocks are two document-sized containers.

The comparison utility process now retains bounded **per-page** row snapshots
and emits `marktex:patch-review-rows`. The two representations keep their current
wrappers; changed inner cells/paired rows are replaced, not unchanged paragraphs,
math, or their descendants. Ordered matching has a bounded LIS-based path rather
than another quadratic whole-document diff. Disjoint edits can retain intervening
rows. Large rewrites and unavailable baselines deliberately use the old full
hidden-page installation fallback.

Source attributes are shifted separately for before/after cells. Columns, absent
attributes and authored text are not changed. A proposed uniform shift is checked
against the exact freshly rendered row; nonuniform remapping replaces that row.
The existing `responsiveRenderedDiff`, alignment and styling are unchanged.

A/B base revisions are not interchangeable. The main process supplies the
acknowledged revision for the actual WebContents; the worker sends a patch only
for that exact base. Both DOM trees are validated and new rows parsed before
either tree is mutated. A rejected install is an error, not readiness. Main can
reset the hidden page with a **new revision**, so an old timed-out patch ACK cannot
satisfy the reset. Worker restart, cache eviction and lost acknowledgments fall
back safely. Cache bounds: 16 pages / estimated 64 MiB payload, in addition to the
existing baseline cache.

For editable Working Tree reviews, the second page can be seeded from the first
sanitized page before the first edit. This incurs one extra initial DOM build,
not another Markdown/KaTeX/alignment run. Showing the first page does not wait
for it. An edit arriving during seeding joins that load instead of racing it.
Initial navigation continues to use the existing IME isolation. Staged reviews
do not eagerly seed an unused second page.

## Preserved contracts

- No mutation of the visible front; install ACK and existing position preparation
  precede promotion. This is not an in-place visible DOM replacement.
- No changes to Monaco composition, selection, undo or source model ownership.
- No changes to source/resume navigation, before/after selection, cursor yRatio,
  viewport band or Viewer bookmarks/block offsets.
- No changes to diff emphasis/CSS, wrapping, or HTML sanitization. Warm assembly
  still performs the existing lean-runtime content/capability check.
- No change to ordinary Markdown's render/patch behavior.
- Existing installed-content hold tests now intercept both full HTML and row
  patches; they still require real native content, not just a loader.

## Verified here

External Git/npm DNS access was unavailable; these are not full-project results.

1. **27 unit-test bodies passed**, including the existing six preview-reuse tests,
   120 seeded mixed edit cases, independent A/B bases, standby startup, error ACK
   and new-revision reset handling. Executed with an offline Node adapter: Vitest
   registration is mapped to node:test; Electron/project-edge dependencies are
   stubbed. Production row diff/cache/renderer installation control flow is used.
2. **Six actual Chromium DOM checks passed**, plus a narrow-screen visibility
   check. Patched DOM equals fresh rendered DOM; wrapper and distant row identity,
   independent source metadata, column preservation, input selection, rejected
   base preflight, A/B convergence, runtime ACK and split alignment were checked.
3. Strict TypeScript checking passed for the new pure row patch/cache and browser
   patch/update modules. All 21 locally available TS files passed syntax/transpile
   checks. This is not full repository typechecking or Svelte compilation.
4. Full typecheck, actual Vitest runner, Electron E2E and real OS Korean IME were
   **not run**. The added/updated Electron tests are acceptance tests to run locally.

### Measured scope, not an Esc benchmark

In a 1,000-paragraph fixture, editing one paragraph produced **1,643 UTF-8 bytes**
of patch instead of **902,229 bytes** of full review HTML. It replaced two
representation rows (one unified, one split) and retained 1,998.

In a separate synthetic DOM fixture (160 paragraphs × 12 nested math-like span
groups, **not real KaTeX**, 1,200 × 900 viewport), two warmups and six measured
runs of DOM mutation plus forced layout produced:

| Path | Median | Payload |
| --- | ---: | ---: |
| Full innerHTML installation | 154.2 ms | 744,504 bytes |
| Review row patch | 2.8 ms | 6,905 bytes |

These are local component measurements, not end-to-end Electron or user-device
latency, and not a promise that the whole Esc operation is 2.8 ms. Markdown
parsing, changed math rendering, comparison work and native presentation still
have costs. Cold and large-rewrite paths still build full DOM. Row virtualization
and partial Markdown parsing are intentionally not added in this PR.

## Run in the full repository

```bash
npm run typecheck
npm test --workspace @setdown/desktop -- review-row-patch review-row-cache preview-reuse review-patch-ack
npm run test:e2e --workspace @setdown/desktop -- review-row-patching git-review-instant-escape
npm run test:e2e --workspace @setdown/desktop -- git-review-tabs git-review-cold-escape git-review-reading-position git-review-ime source-atlas-review
```

The immediate-edit Electron case seeds A/B, saves a distant row/math DOM reference
in each native page, edits and presses Esc **without a debounce wait**, checks
latest content and retained identity, and repeats for the other page. The held
installation case proves an unfinished update cannot make Esc wait for a loader.
The tab test expects three native diff pages for one Index and one editable review
(Index A + Working Tree A/B); it retains the previous navigation/focus assertions.

Before merging, run real Korean composition (including initial standby creation),
Viewer tab round trips, stage/unstage, insertion/deletion before a long math block,
narrow/wide resize and a long edit followed immediately by Esc. Measure time to
first valid document separately from time to the latest revision. Existing warm
Esc behavior must not regress. This PR does not claim a native P95 or zero flashes
without those measurements.
