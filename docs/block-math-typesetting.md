# Block-math typesetting performance

Base: `222f58a65a0d48a2d703dfea2f8077e386bda1a2`.

## Contract

Reduce actual typesetting work, not the visibility of the loading message.
Keep KaTeX, HTML/MathML, source ranges, sanitizer boundaries, latest-only review,
IME/undo and the existing cold-view line-1 correction. Do not alter presentation
or scheduling to manufacture a latency result.

Two bounded changes will be implemented and checked separately:

1. Defer both inline and block math through Crossnote post-processing, preserving
   the original generated math output and source wrappers.
2. Replace the pinned Crossnote 0.9.35 block rule's eager construction of the
   entire remaining source with an incremental closing-delimiter scan. Preserve
   container-adjusted lines, escapes, custom delimiters and token maps. Retain
   the original rule as fallback where compatibility cannot be established.

Publish meaningful checkpoints and an early draft PR. No automatic merge,
force-push or history rewrite. Do not claim zero end-to-end latency based on
parser/CPU measurements. Record real validation results and unavailable checks.

## Validation plan

Compare tokens, rendered output and source positions with the pinned upstream
rule, including quoted/list math, CRLF, escaped/missing delimiters, adjacent
blocks, multiple delimiters and disabled math. Measure line reads as well as
warm parsing time on many-block inputs. Verify math placeholders restore exactly
in fragments and encoded full-page payloads, including invalid/spoofed markers.

Full Crossnote integration and native Fedora edit-to-Esc behavior remain distinct
acceptance checks; a stand-alone parser benchmark cannot prove those results.
