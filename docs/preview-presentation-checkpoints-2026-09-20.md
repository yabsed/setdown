# Preview stability: incremental implementation checkpoints

Base: `ca81a4a2a695ea2af8cb612c341f042e588aa1ee` (`main`).

## Working agreement

Keep this work on its own branch. Publish small, meaningful commits as each
bounded change is checked; do not hold every result until a large rewrite is
finished. Open the PR early. Record completed checks and remaining limitations.
Do not merge automatically, force-push, or rewrite checkpoints.

A reasoning/tool failure must not erase already completed work. If a later step
cannot be validated, stop expanding scope and leave an accurate handoff in the
PR rather than describing untested work as finished.

## Scope and invariants

The supplied investigation prioritizes presentation stability over replacing
KaTeX. Preserve the existing math engine, HTML/MathML, source position mapping,
undo behavior, and full-render fallback.

1. Inspect the current presentation/preparation lifecycle and add the smallest
   testable fix for native-view handoff; do not mistake IPC delivery or a DOM
   acknowledgement for proof that Chromium has presented pixels.
2. Avoid creating/transferring an unused full template when reusing a Git preview
   page, while retaining a full template for initial load and recovery.
3. Add regression coverage for the changed paths and explicitly record which
   checks could actually be run in this environment.

Stable math IDs, within-row math DOM reuse, responsive diff restructuring,
geometry indexing, Rust, and GPU frame caching are separate, larger follow-ups.
Do not claim these are implemented by a smaller presentation fix.

## Manual verification required on Electron/Fedora

- Toggle Source/Viewer repeatedly without edits after preparation.
- Edit ordinary text next to unchanged math, then edit one equation.
- Toggle quickly while A/B rendering completes; navigate to another tab.
- Resize and zoom before and during preparation.
- Verify target source position, before/after mapping, focus and undo.
- Record blank/intermediate/stale frames separately from DOM readiness and
  actual frame presentation. No latency or flicker-elimination claim without
  those measurements.

## Checkpoints

- Initial scope and validation plan published. Implementation and validation
  results will be recorded in subsequent commits and the PR.
