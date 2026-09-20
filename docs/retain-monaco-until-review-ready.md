# Uninterrupted Working Tree Escape handoff

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2`.

## Contract

Escape requests a Viewer; it must not remove the current Monaco editor before
the latest unsaved Working Tree and final target position are ready. Keep the
actual editable Monaco instance, not a screenshot, read-only lock or stale
Viewer. No intermediate Typesetting changes screen on this transition.

Separate requested Viewer intent from the displayed surface. Already-ready
unchanged revisions retain the immediate path. New typing, source navigation,
composition, explicit Source selection, tab switch/close and errors cancel
obsolete auto-transition without discarding the edit or resetting the cursor.
Duplicate Escape requests must not duplicate or cancel useful preparation.

Preserve latest-content/baseline/theme checks, before/after source coordinates,
first-edit line-1 verification, native focus/IME boundaries and shared Undo.
Never treat hidden layout acknowledgment as a native pixel presentation fence.
No fixed frame delay or minimum loading duration is added.

## Verification

Add regression coverage for delayed rendering, delayed final positioning,
no-edit warm Escape, stale results, user interruption and errors. Check the real
Svelte visibility/input wiring, not just an isolated state helper. Run available
project tests/typecheck/build and report unrelated baseline failures separately.

Publish small checkpoints on this branch and open the draft PR early. Do not
merge automatically, force-push, or replace other performance branches. Record
what was actually validated; do not call a UI continuity change zero latency.
