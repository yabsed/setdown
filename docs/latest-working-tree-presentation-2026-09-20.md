# Latest Working Tree presentation

Base: `1e35a904c849dac8f70cef9dcc9c3c722f219d6d` (PR #15 merged).

## Contract

The performance target is Escape to the latest edited buffer at the correct
reading position, not Escape to any old preview. Keep the no-edit warm path
fast. Never publish intermediate render results as if they were current. Bind
presentation to content/baseline and the final viewport intent; late results
must not reopen a closed tab or override a new Source/Viewer intent.

Preserve KaTeX HTML/MathML, shared Monaco undo, IME isolation, before/after source
mapping, ownership checks, patch-base validation and the full-render fallback.
Do not replace the math engine, discard accessibility, add a fixed frame delay,
or pretend that an IPC acknowledgment proves native pixel presentation.

## Checkpoints

Open the draft early and publish each bounded implementation/test unit. Do not
force-push or merge automatically. Record actual checks, incomplete checks and
remaining risks; a interrupted session must leave useful remote work.

1. Latest-only promotion and Escape request handling.
2. Position-before-presentation ordering with cancellation and warm reuse.
3. Reduce repeated preparation work without changing the math output.
4. Regression tests and honest validation/handoff.

## Validation

Exercise edit -> Escape, in-flight older work -> another edit -> Escape,
no-edit repeated Escape, cancel/close/switch during preparation, failure and
retry, rapid Source/Viewer toggles, resize/zoom and IME. Check latest content
and final position, not just shell visibility. Timing claims require the actual
Electron/Fedora application; isolated mocks are only ordering/logic tests.

## Environment

Direct git clone currently fails because github.com does not resolve in the
execution container. GitHub connector reads/writes work. Validation will state
exactly which parts could be executed rather than claiming a full build.
