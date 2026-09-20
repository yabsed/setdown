# Preview stability: incremental implementation checkpoints

Base: `ca81a4a2a695ea2af8cb612c341f042e588aa1ee` (`main`).
PR: #15. Branch: `perf/preview-presentation-checkpoints`.

## Working agreement

Keep this work on its own branch. Publish small, meaningful commits as each
bounded change is checked; do not hold every result until a large rewrite is
finished. Open the PR early. Record completed checks and remaining limitations.
Do not merge automatically, force-push, or rewrite checkpoints.

A reasoning/tool failure must not erase already completed work. If a later step
cannot be validated, stop expanding scope and leave an accurate handoff in the
PR rather than describing untested work as finished. Prefer at most one bounded
implementation step awaiting publication; publish it before expanding scope.

## Completed checkpoints

| Commit | Change |
| --- | --- |
| `69da088` | Initial scope and validation plan; Draft PR opened immediately. |
| `4056739` | Native replacement is shown before the old front is hidden. |
| `a05dd74` | Nine handoff, navigation, ownership and failure-recovery tests. |
| `db74c1b` | Isolated lazy render-output selection. |
| `1a3aaa2` | Eight output-selection and runtime-fallback tests. |
| `3ce6df9` | Worker HTML-only path; lazy expanded page templates and block work. |
| `5c4c70f` | Git fragment requests with URL/page/visibility race guards. |
| `51c515d` | Seven fragment-request and stale-page regression tests. |

Each checkpoint was published separately, not accumulated into one final commit.
This final documentation commit records the stopping point and validation gaps.

## Implemented behavior

### Native handoff

Bounds and visibility of an eligible replacement are applied before hiding the
old native front. An already attached warm view keeps its identity and avoids
redundant bounds/visibility/hierarchy writes. A navigating A/B sibling may keep
only its own review's front visible. Different documents, Source mode, invalid
bounds and foreign ownership do not retain that front. Navigation completion
never automatically shows an obsolete request. Failed native bounds application
does not poison the bounds cache, so a retry still applies the bounds.

This fixes hide-first ordering, not the entire presentation pipeline. It does
not introduce a Chromium paint fence, merge the shell's show/position commands
into a single transaction, or implement revision-promotion coalescing. No fixed
frame delay or screenshot overlay was added.

### Output work

The baseline side of a Git comparison requests complete HTML only. A modified
side does the same when the current page can be reused; a cold/recovery request
still requires a full page template. URL, page-record identity and visibility
are rechecked around asynchronous rendering, comparison and installation.

HTML-only worker output skips expanded page-template construction, its encoding
and transfer, and the unused browser block split/cache/patch work. Search uses
this path too. Ordinary warm preview patches no longer build an unused lean
page template. The initial-load and lean-to-Crossnote capability-upgrade paths
remain available. Output failures do not advance the installed block baseline.

Important limit: Crossnote's internal placeholder template is still generated
and parsed to obtain sanitized HTML. This change does not eliminate that entire
upstream operation. Nor does it eliminate later comparison-worker HTML parsing.
The existing KaTeX renderer, deferred-math restoration and HTML/MathML output are
unchanged; no claim of end-to-end visual equivalence was measured here.

## Validation actually run

Environment: Node 22.16.0, TypeScript 5.8.3. The repository requests TypeScript
^5.9.0; the following syntax checks are not a project typecheck.

- All 24 new test bodies passed using an isolated Node `node:test` harness that
  transpiles the actual TypeScript and loads the mocks declared in the tests:
  9 presentation + 8 output-selection + 7 fragment-request checks.
- The presentation test file against the original manager had 4 failing cases;
  the fragment test file against the original renderer had 5 failing cases.
  The corresponding modified implementations passed all those cases.
- All seven changed/added TypeScript files passed transpilation syntax checks.
- `git diff --check` passed for the implementation and tests.
- The three original production files were reconstructed from connector reads
  and their Git blob hashes matched the base repository exactly. Published
  replacement blob hashes matched the locally checked files.

Not run: the actual Vitest runner, full repository test suite, full TypeScript
and Svelte typechecks, application build, Crossnote/Electron integration tests,
or Fedora frame/IME/zoom tests. Direct repository download failed in this
container and the project dependencies (including Vitest) were not installed.
The PR remains Draft pending those checks; passing isolated tests is not proof
that the full application is regression-free.

## Verification in a complete checkout

From `apps/desktop`, with the repository's dependencies installed:

```sh
npm run typecheck
npm test -- src/main/preview/preview-presentation.test.ts src/main/preview/render-output.test.ts src/main/preview/preview-fragment-rendering.test.ts
npm test
npm run build
```

On Electron/Fedora:

- Toggle Source/Viewer repeatedly without edits after preparation.
- Edit ordinary text next to unchanged math, then edit one equation.
- Toggle quickly while A/B rendering completes; navigate to another tab.
- Resize and zoom before and during preparation.
- Verify target source position, before/after mapping, focus, Korean IME and undo.
- Record blank/intermediate/stale frames separately from DOM readiness and
  actual frame presentation. No latency or flicker-elimination claim without
  those measurements.

## Explicitly deferred

Full show/position/promotion transactions and compositor-level readiness still
need design and real-frame validation. Stable math IDs, within-row math DOM
reuse, responsive diff restructuring, geometry indexing, Rust, and GPU frame
caching are separate larger changes. They are not implemented by this PR.
