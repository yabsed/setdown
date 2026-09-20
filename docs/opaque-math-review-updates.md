# Unchanged-math review latency

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2`.

## Contract

A small prose edit beside unchanged math must not needlessly reconstruct that math. Preserve KaTeX HTML/MathML, sanitization, before/after semantics, source positions, shared undo, IME isolation and latest-only presentation. Do not hide a loading message and call that a speedup. Do not claim literal zero latency without measuring actual latest-content presentation.

Publish bounded implementation and test checkpoints on this branch. No automatic merge, force push or destructive history changes.

## Implementation targets

- Keep opaque math out of repeated comparison/row processing where safely possible.
- Preserve identical math DOM inside a changed review row, not only in entirely unchanged rows.
- Cache by exact rendered output, not LaTeX alone; macro/option changes must not become false cache hits.
- Retain full-install and unsupported-content fallbacks.
- Add regression tests and reproducible workload measurements. Separate CPU/DOM measurements from native Electron presentation latency.

## Validation status

Initial planning checkpoint only. Implementation and results are recorded by later commits and the PR.
