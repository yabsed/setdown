# Keep Source until the latest review is ready

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2`.

Escape requests Viewer; it must not immediately remove the live Monaco editor.
Retain the current source, cursor, selection, scroll and editability while latest
content and its final position prepare. Show the accepted native preview before
retiring Source. Do not show stale content or an intervening full-page
`Typesetting changes` surface. Keep the existing no-edit fast path and the
cold-reveal position verification; no fixed transition delay.

A newer edit, explicit cursor/scroll/pointer intent, source selection, tab change,
close or overlay must cancel the pending automatic transition without canceling
ordinary prerendering. Repeated Escape for the same intent is idempotent.
Failures retain the editor and expose a nonblocking, retryable error.

Implement on this branch in bounded checkpoints with regression coverage.
Run real project checks through CI if local dependency/network access fails.
Record checks honestly; do not label layout acknowledgment as proof of native
pixel presentation or claim this changes computational typesetting latency.

This follows the supplied investigation's display contract: do not remove the
current surface before its replacement is prepared; do not add a delay when
already ready. No math engine, worker scheduling, sanitizer or undo rewrite.
