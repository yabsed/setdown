# Feature validation evidence through 2026-10-16

These are dated execution records, not a replacement for the current contracts.
Paths in code spans are relative to `apps/desktop` unless otherwise noted.
See [the contract entry point](../preview-performance-contract.md) for required
checks, isolated-display rules and the comparative performance gate.

## Browser lifecycle validation, 2026-10-15

The audible-close exception and split-video freeze were reproduced on the
unmodified `1ba591057b0a393e57a2a930d06cc236993e1432` baseline before the fixes.
The final build/typecheck, 688 unit tests, 282 focused contract unit tests,
three comparator tests and 93 real Electron GUI scenarios passed.

The independent baseline and candidate used Electron 44.7.2, the same isolated
Xvfb display and five matched repetitions, alternating their order. Eight
scenarios and all 48 first/second/warm comparisons were retained. The existing
25% **and** 50ms regression thresholds were unchanged. Results below are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 32.0 | 20.0 → 20.0 | 23.0 → 23.0 |
| document | 0ms | false | Double-click → editor | 16.0 → 16.0 | 35.0 → 33.0 | 11.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 390.0 → 404.0 | 99.0 → 111.0 | 89.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 16.0 | 17.0 → 15.0 | 12.0 → 13.0 |
| document | 3000ms | false | Esc → latest capture | 40.0 → 47.0 | 21.0 → 22.0 | 19.0 → 18.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 12.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 103.0 → 103.0 | 99.0 → 99.0 | 89.0 → 88.0 |
| document | 3000ms | true | Double-click → editor | 15.0 → 19.0 | 12.0 → 15.0 | 15.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 908.0 → 932.0 | 21.0 → 19.0 | 19.0 → 17.0 |
| review | 0ms | false | Double-click → editor | 23.0 → 21.0 | 11.0 → 11.0 | 12.0 → 11.0 |
| review | 0ms | true | Esc → latest capture | 991.0 → 974.0 | 1439.0 → 1445.0 | 181.0 → 173.0 |
| review | 0ms | true | Double-click → editor | 14.0 → 22.0 | 19.0 → 13.0 | 18.0 → 17.0 |
| review | 3000ms | false | Esc → latest capture | 28.0 → 30.0 | 24.0 → 24.0 | 18.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 22.0 → 22.0 | 11.0 → 11.0 | 17.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 226.0 → 224.0 | 177.0 → 181.0 | 174.0 → 171.0 |
| review | 3000ms | true | Double-click → editor | 21.0 → 21.0 | 18.0 → 12.0 | 17.0 → 17.0 |

Result: **PASS**, 0 regressing buckets.
The first run flagged `document/idle=0/edits=true/first/captureMs` (329ms → 456ms).
That failure is preserved in [the initial comparison](../browser-lifecycle-benchmark-first-run-2026-10-15.json).
Separate Chromium traces showed similar HTML readiness and variable rendering/capture time;
they do not establish a sole cause. Unused address-dropdown hide IPC was removed from inactive
bars, then the changed implementation was measured again with the same scenarios and thresholds.
[Complete validation and measurement records](../browser-lifecycle-validation-2026-10-15.json)
retain the per-repetition samples, build/lock/harness hashes and limitations; logs are in `/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/test-results/browser-lifecycle-2026-10-15`.

## Reading capabilities validation, 2026-10-15

The final build/typecheck, 694 unit tests, 288 focused contract unit tests, three
comparator tests and 96 real Electron GUI scenarios passed. Tests ran on isolated
Xvfb with a private runtime and D-Bus session, without retries. Exported PDFs were
also checked with `pdftotext`: the web article retained its title, source and first
and last paragraphs; the local Markdown PDF retained its text. The first web
article PDF page was visually inspected.

The public Namu **키스 길** HTML capture, served in actual Electron with page
scripts/external resources disabled, yielded 48 paragraphs, seven tables, seven
section headings and 82 position stamps, without editing links. The synthetic
hashed-layout test additionally verifies double-click restoration to the live
leaf-div paragraph. This evidence is limited to the inspected markup; it does not
establish every future or authenticated Namu layout.

The separately installed baseline is `81bcd84a96ff2cf4b75852dda4354f2090dc1b33`;
both versions used Electron 44.7.2. Five matched repetitions alternated their order
on one isolated display. The eight scenarios and 48 first/second/warm comparisons
used the unchanged 25% **and** 50ms thresholds. Results are **baseline → candidate
medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 42.0 | 21.0 → 28.0 | 23.0 → 19.0 |
| document | 0ms | false | Double-click → editor | 19.0 → 17.0 | 35.0 → 35.0 | 12.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 389.0 → 446.0 | 108.0 → 103.0 | 89.0 → 95.0 |
| document | 0ms | true | Double-click → editor | 22.0 → 21.0 | 14.0 → 14.0 | 15.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 45.0 → 47.0 | 17.0 → 18.0 | 22.0 → 21.0 |
| document | 3000ms | false | Double-click → editor | 17.0 → 17.0 | 11.0 → 11.0 | 10.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 115.0 → 101.0 | 105.0 → 94.0 | 91.0 → 94.0 |
| document | 3000ms | true | Double-click → editor | 15.0 → 21.0 | 16.0 → 13.0 | 14.0 → 16.0 |
| review | 0ms | false | Esc → latest capture | 975.0 → 974.0 | 24.0 → 25.0 | 18.0 → 28.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 23.0 | 11.0 → 13.0 | 12.0 → 13.0 |
| review | 0ms | true | Esc → latest capture | 1089.0 → 1045.0 | 1501.0 → 1501.0 | 179.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 21.0 → 23.0 | 17.0 → 20.0 | 18.0 → 19.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 25.0 | 19.0 → 22.0 | 19.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 25.0 → 25.0 | 11.0 → 12.0 | 18.0 → 18.0 |
| review | 3000ms | true | Esc → latest capture | 231.0 → 233.0 | 186.0 → 184.0 | 180.0 → 178.0 |
| review | 3000ms | true | Double-click → editor | 23.0 → 21.0 | 18.0 → 18.0 | 18.0 → 18.0 |

Result: **PASS**, 0 regressing buckets. These timings cover ordinary Markdown
and Git transitions, not web Reader extraction or file export latency.

The initial contract run passed 95/96 GUI cases; the new native menu test examined
the menu before Chromium emitted `context-menu`. It now waits for that actual
event before sending native menu-selection input. The first Namu fixture routing
also failed to intercept HTTPS and was replaced with verified Playwright routing.
The original failures and final results are preserved in
[the validation record](../reading-capabilities-validation-2026-10-15.json), including
all performance samples, identities, build/lock/harness hashes and limitations.
Raw artifacts are in `test-results/reading-capabilities-2026-10-15` and
`test-results/reading-capabilities-benchmark-2026-10-15`.

## Namu SVG filtering validation, 2026-10-15

Namu Reader strips inline SVG and identifiable SVG images from its cloned,
stamped document before either extraction path. The real Electron fixture checks
SVG elements, data URIs, upper-case `.SVG` with query parameters, an encoded
`.svgz` path and SVG responsive candidates. PNGs, tables, anchors and live-page
restoration remain covered. The generic Readability fallback is checked too.

The first contract run passed 95/96 GUI cases: image-bearing Reader teardown
exposed a queued scroll after its bound container had become null. The final
implementation rejects obsolete callbacks and retains a stable element for
cleanup. The final build/typecheck, 288 focused unit tests, three comparator
tests and all 96 GUI cases passed on isolated Xvfb, without retries.

The independent baseline is `1ca71e5de96fbfc39616b8a0beb84bcbc99fdf39`, with
matching lockfiles and Electron 44.7.2. Five matched repetitions per version
alternated their order on one isolated display. All eight scenarios and 48
comparisons used the unchanged 25% **and** 50ms regression thresholds. Values are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 37.0 → 37.0 | 21.0 → 27.0 | 20.0 → 20.0 |
| document | 0ms | false | Double-click → editor | 16.0 → 19.0 | 34.0 → 34.0 | 11.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 413.0 → 390.0 | 106.0 → 98.0 | 90.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 15.0 | 17.0 → 17.0 | 13.0 → 14.0 |
| document | 3000ms | false | Esc → latest capture | 45.0 → 40.0 | 22.0 → 18.0 | 19.0 → 24.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 12.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 111.0 → 89.0 | 102.0 → 98.0 | 90.0 → 92.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 18.0 | 12.0 → 13.0 | 14.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 954.0 → 908.0 | 22.0 → 19.0 | 20.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 21.0 → 22.0 | 11.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 999.0 → 983.0 | 1480.0 → 1484.0 | 175.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 21.0 → 22.0 | 20.0 → 19.0 | 18.0 → 18.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 23.0 | 23.0 → 21.0 | 18.0 → 17.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 23.0 | 12.0 → 11.0 | 16.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 230.0 → 228.0 | 187.0 → 182.0 | 180.0 → 173.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 22.0 | 18.0 → 18.0 | 18.0 → 17.0 |

Result: **PASS**, 0 regressing buckets. This compares ordinary Markdown and Git
transitions; it does not measure Namu extraction latency.

[The SVG validation record](../namu-svg-validation-2026-10-15.json) retains every
cycle measurement, comparison, identity/hash, the initial failure and the final
checks. Raw logs/event traces are in `test-results/namu-svg-filter-2026-10-15`
and `test-results/namu-svg-benchmark-2026-10-15`.

## Address draft validation, 2026-10-15

A real native mouse click from a focused web page, followed by 140ms-per-character
typing across the Places debounce, reproduced the input loss on the original
build. `no-history-match-928471` became the current `/first` URL followed by
`-history-match-928471`. An empty result hid the native dropdown, which echoed
`location-overlay:hidden`; the renderer canceled editing and synchronized the
draft back to the committed URL before later keystrokes arrived.

Renderer-requested hides and resize hides now update presentation without echoing
an edit cancellation. Existing native cancellation paths retain their signals.
The new GUI case verifies native-click selection, slow typing through empty
results, caret position, Home-key insertion, reopening matches, Korean composition
and explicit Escape. It identifies the suggestion by URL because native title
updates can rename a bookmarked row. Existing split-video and native pointer
selection cases also passed.

The final build/typecheck, 288 focused unit tests, three comparator tests and all
97 Electron GUI scenarios passed on isolated Xvfb with no retries. Initial
fixture/typecheck failures and the successful unmodified-build reproduction are
preserved in [the validation record](../address-draft-validation-2026-10-15.json).

The separate, independently installed baseline is
`5c43b04c33b2930059cba3ccb8934538a892d1ec`; lockfiles match and both use Electron
44.7.2. Five matched repetitions alternated version order on one isolated display.
The eight scenarios and 48 first/second/warm comparisons retain the existing
25% **and** 50ms thresholds. Values are **baseline → candidate medians in
milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 45.0 → 29.0 | 21.0 → 23.0 | 21.0 → 20.0 |
| document | 0ms | false | Double-click → editor | 22.0 → 16.0 | 25.0 → 33.0 | 11.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 430.0 → 434.0 | 101.0 → 101.0 | 89.0 → 89.0 |
| document | 0ms | true | Double-click → editor | 18.0 → 19.0 | 14.0 → 13.0 | 16.0 → 13.0 |
| document | 3000ms | false | Esc → latest capture | 41.0 → 42.0 | 21.0 → 19.0 | 25.0 → 21.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 15.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 106.0 → 102.0 | 103.0 → 108.0 | 90.0 → 90.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 15.0 | 12.0 → 12.0 | 13.0 → 15.0 |
| review | 0ms | false | Esc → latest capture | 928.0 → 955.0 | 22.0 → 19.0 | 28.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 22.0 | 11.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 975.0 → 970.0 | 1455.0 → 1496.0 | 177.0 → 173.0 |
| review | 0ms | true | Double-click → editor | 22.0 → 22.0 | 18.0 → 20.0 | 17.0 → 17.0 |
| review | 3000ms | false | Esc → latest capture | 30.0 → 29.0 | 23.0 → 23.0 | 17.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 22.0 | 11.0 → 11.0 | 16.0 → 16.0 |
| review | 3000ms | true | Esc → latest capture | 229.0 → 230.0 | 181.0 → 183.0 | 166.0 → 177.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 21.0 | 18.0 → 19.0 | 17.0 → 18.0 |

Result: **PASS**, 0 regressing buckets. These timings cover Markdown/Git
transitions, not Places query latency. Every cycle measurement, comparison,
identity/hash and the original failures are retained in the validation record.
Raw logs/traces are in `test-results/address-draft-2026-10-15` and
`test-results/address-draft-benchmark-2026-10-15`.

## Reader toolbar removal validation, 2026-10-15

The web Reader now begins with the article title and content, without an export
toolbar or overflow button. The existing real Electron scenario checks that the
reading surface has no buttons, visible-article search still works, right-click
Markdown/PDF exports retain the snapshot, and File PDF and live-page restoration
still work. Build/typecheck, 288 focused unit tests, three comparator tests and all
97 Electron GUI scenarios passed on isolated Xvfb, without retries.

The independently installed baseline is `344e69db8601ff88d192e878e27139f1843daab8`; both
versions use Electron 44.7.2. Three matched repetitions per version
alternated order on one isolated display, retaining all eight scenarios and 48
comparisons with the unchanged 25% **and** 50ms thresholds. Values are
**baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 46.0 → 51.0 | 18.0 → 18.0 | 23.0 → 18.0 |
| document | 0ms | false | Double-click → editor | 17.0 → 17.0 | 36.0 → 34.0 | 11.0 → 12.0 |
| document | 0ms | true | Esc → latest capture | 451.0 → 429.0 | 102.0 → 99.0 | 86.0 → 88.0 |
| document | 0ms | true | Double-click → editor | 21.0 → 16.0 | 16.0 → 13.0 | 15.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 41.0 → 34.0 | 24.0 → 23.0 | 24.0 → 20.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 17.0 | 11.0 → 13.0 | 11.0 → 10.0 |
| document | 3000ms | true | Esc → latest capture | 120.0 → 109.0 | 102.0 → 99.0 | 91.0 → 92.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 18.0 | 13.0 → 13.0 | 15.0 → 14.0 |
| review | 0ms | false | Esc → latest capture | 910.0 → 1033.0 | 25.0 → 22.0 | 16.0 → 30.0 |
| review | 0ms | false | Double-click → editor | 26.0 → 23.0 | 12.0 → 12.0 | 12.0 → 11.0 |
| review | 0ms | true | Esc → latest capture | 1034.0 → 1034.0 | 1494.0 → 1490.0 | 181.0 → 177.0 |
| review | 0ms | true | Double-click → editor | 22.0 → 23.0 | 21.0 → 19.0 | 20.0 → 19.0 |
| review | 3000ms | false | Esc → latest capture | 27.0 → 25.0 | 21.0 → 21.0 | 19.0 → 27.0 |
| review | 3000ms | false | Double-click → editor | 24.0 → 24.0 | 13.0 → 12.0 | 18.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 228.0 → 236.0 | 188.0 → 183.0 | 170.0 → 176.0 |
| review | 3000ms | true | Double-click → editor | 22.0 → 23.0 | 18.0 → 18.0 | 17.0 → 17.0 |

Result: **PASS**, 0 regressing buckets. These timings cover ordinary Markdown/Git
transitions; they do not measure web Reader rendering or export latency.
[Complete validation and per-repetition measurements](../reader-toolbar-removal-validation-2026-10-15.json)
retain the build/harness identities and raw log paths, including the interrupted
check of the superseded UI.

## Python language support validation, 2026-10-15

The final implementation keeps Monaco 0.56.0 and adds lazy Python providers with
bundled Pyright 1.1.414. Full unit validation passed **704 tests in 101 files**.
The preview gate passed build/typecheck, **298 focused unit tests**, three
comparator tests and **103 real Electron scenarios**, without retries or skips.
Eight CI policy tests also passed. A final Linux x64 unpacked release package
rendered Markdown, opened the editor and received Python diagnostics from its
bundled server. Windows packaged execution was not tested locally.

Earlier build attempts were interrupted during the memory-exhaustion incident.
After resuming, builds and heavy checks ran serially inside systemd scopes with
4 GiB RAM and 512 MiB swap limits; Node build heaps were capped at 2304 MiB.
GUI runs used isolated Xvfb, runtime directories and D-Bus sessions. The baseline
and candidate used the same benchmark scope and display; no build ran during
measurement. These resource limits do not change production application policy.

The independently installed baseline is
`bf464956ed12ce64453eb461426f1544b697be6b`; both versions use Electron 44.7.2.
Three matched repetitions alternated AB/BA order, retaining all eight scenarios,
five cycles and 48 comparisons with the unchanged 25% **and** 50ms thresholds.
Values are **baseline → candidate medians in milliseconds**; warm is cycles 3–5.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 39.0 → 53.0 | 26.0 → 19.0 | 21.0 → 22.0 |
| document | 0ms | false | Double-click → editor | 18.0 → 23.0 | 36.0 → 38.0 | 12.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 437.0 → 464.0 | 103.0 → 97.0 | 93.0 → 91.0 |
| document | 0ms | true | Double-click → editor | 19.0 → 21.0 | 15.0 → 13.0 | 13.0 → 12.0 |
| document | 3000ms | false | Esc → latest capture | 47.0 → 41.0 | 15.0 → 19.0 | 20.0 → 24.0 |
| document | 3000ms | false | Double-click → editor | 16.0 → 16.0 | 13.0 → 13.0 | 11.0 → 12.0 |
| document | 3000ms | true | Esc → latest capture | 109.0 → 108.0 | 97.0 → 92.0 | 91.0 → 93.0 |
| document | 3000ms | true | Double-click → editor | 20.0 → 17.0 | 17.0 → 13.0 | 15.0 → 15.0 |
| review | 0ms | false | Esc → latest capture | 1388.0 → 1070.0 | 29.0 → 20.0 | 28.0 → 20.0 |
| review | 0ms | false | Double-click → editor | 22.0 → 22.0 | 12.0 → 11.0 | 12.0 → 12.0 |
| review | 0ms | true | Esc → latest capture | 1085.0 → 1149.0 | 1601.0 → 1682.0 | 178.0 → 174.0 |
| review | 0ms | true | Double-click → editor | 23.0 → 22.0 | 20.0 → 21.0 | 17.0 → 16.0 |
| review | 3000ms | false | Esc → latest capture | 25.0 → 31.0 | 20.0 → 15.0 | 19.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 24.0 → 24.0 | 11.0 → 11.0 | 17.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 229.0 → 233.0 | 184.0 → 183.0 | 170.0 → 179.0 |
| review | 3000ms | true | Double-click → editor | 24.0 → 21.0 | 19.0 → 18.0 | 17.0 → 16.0 |

Result: **PASS**, 0 regressing buckets. This establishes the existing
Markdown/Git transition gate, not large-project indexing, completion latency,
or browser responsiveness under language-server load. All timing samples,
identities and comparisons are retained in
[the validation record](../lsp-preview-benchmark-2026-10-15.json). Raw benchmark logs
and protocol traces remain in `test-results/lsp-preview-benchmark-2026-10-15`;
final build, unit, GUI and package logs are in
`test-results/lsp-final-validation`.

## C/C++ language support validation, 2026-10-15

Saved C/C++ files now use installed clangd alongside bundled Python/Pyright.
The final full unit run passed **710 tests in 103 files**. The preview contract
passed build/typecheck, **304 focused unit tests**, three comparator tests and
**106 real Electron scenarios**, with no retries or skips. clangd 22.1.0 on Linux
was exercised with real compilation commands, `.clangd` defines, headers,
unsaved diagnostics, completion, hover/references, rename/Undo, UTF-16 edits,
independent buffers, missing-executable recovery, persistence and restart.
Windows packaged clangd was not tested. These are small-project checks, not a
large-project indexing or completion-latency guarantee.

Initial chooser test failures came from removing the command-palette `>` prefix
and using `require` in an Electron evaluation context without it. Corrected
tests assert the actual command entry, execute it, verify the persisted path
and receive real diagnostics. Initial and final logs are retained in
`test-results/clangd-validation-2026-10-15`.

Heavy checks ran sequentially with 4 GiB RAM, 512 MiB swap and a 2304 MiB Node
heap limit. GUI checks and measurements used isolated Xvfb, runtime and D-Bus.
The independent baseline is `f2e88c07df87775954f627f6b6946b6bf27d5c38`, with its
own `npm ci` installation and build. Lockfiles match; both use Electron 44.7.2.
Three matched repetitions alternated AB/BA on one display, preserving all eight
scenarios, five cycles and the unchanged 25% **and** 50ms thresholds.
Values below are **baseline → candidate medians in milliseconds**; warm is
cycles 3–5. No builds or other heavy checks ran during measurement.

| Surface | Preparation | Edits | Measurement | First | Second | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| document | 0ms | false | Esc → latest capture | 43.0 → 39.0 | 22.0 → 23.0 | 20.0 → 18.0 |
| document | 0ms | false | Double-click → editor | 19.0 → 18.0 | 34.0 → 36.0 | 12.0 → 11.0 |
| document | 0ms | true | Esc → latest capture | 382.0 → 387.0 | 100.0 → 93.0 | 87.0 → 83.0 |
| document | 0ms | true | Double-click → editor | 22.0 → 19.0 | 15.0 → 15.0 | 13.0 → 15.0 |
| document | 3000ms | false | Esc → latest capture | 39.0 → 39.0 | 22.0 → 24.0 | 18.0 → 26.0 |
| document | 3000ms | false | Double-click → editor | 17.0 → 16.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| document | 3000ms | true | Esc → latest capture | 107.0 → 109.0 | 108.0 → 99.0 | 83.0 → 100.0 |
| document | 3000ms | true | Double-click → editor | 19.0 → 21.0 | 12.0 → 16.0 | 15.0 → 13.0 |
| review | 0ms | false | Esc → latest capture | 973.0 → 950.0 | 21.0 → 28.0 | 19.0 → 21.0 |
| review | 0ms | false | Double-click → editor | 23.0 → 24.0 | 11.0 → 11.0 | 12.0 → 13.0 |
| review | 0ms | true | Esc → latest capture | 1024.0 → 1005.0 | 1460.0 → 1537.0 | 178.0 → 178.0 |
| review | 0ms | true | Double-click → editor | 20.0 → 22.0 | 20.0 → 22.0 | 17.0 → 21.0 |
| review | 3000ms | false | Esc → latest capture | 24.0 → 25.0 | 22.0 → 23.0 | 18.0 → 18.0 |
| review | 3000ms | false | Double-click → editor | 23.0 → 23.0 | 11.0 → 10.0 | 17.0 → 17.0 |
| review | 3000ms | true | Esc → latest capture | 228.0 → 229.0 | 183.0 → 181.0 | 177.0 → 178.0 |
| review | 3000ms | true | Double-click → editor | 23.0 → 21.0 | 18.0 → 19.0 | 19.0 → 18.0 |

Result: **PASS**, 0 regressing buckets across 48 comparisons. These timings cover
ordinary Markdown/Git transitions, not C++ indexing or completion. The
[validation record](../clangd-preview-benchmark-2026-10-15.json) retains every cycle,
comparison, build/source identity and check result. Raw measurements remain in
`test-results/clangd-preview-benchmark-2026-10-15`.

## 2026-10-15 declarative language registry validation

Implemented user-wide server definitions/selection and the lazy
`Edit → Language Support…` screen, preserving existing models and legacy clangd
selection. The offline catalog is a pinned Mason snapshot, not an automatic
installer or a blanket compatibility claim. [Setup and limits](../language-support.md).

Final checks on Linux, with GUI execution isolated by `with-isolated-display.sh`:

- Full desktop unit suite: **104 files / 721 tests passed**.
- `npm run test:preview-contract`: **50 unit files / 323 tests**, three comparator
  tests, build/typecheck (zero Svelte errors/warnings), and **107 Electron scenarios
  passed**. The new shared-model coverage preserves Undo without requiring DOM
  event registration when the optional language integration is absent.
- Real rust-analyzer `0.3.3081-standalone`: explicit integration test passed on the
  final build, covering completion, hover, native syntax diagnostics, definition,
  rename/Undo and restart through the generic registry. No gopls runtime claim.
- Validation logs and management screenshot: `test-results/language-support-validation/`.

Comparative baseline: **8831961d30c6ddec0cb47982d3228031b6765a3e**, in an independent
installed checkout. Ran three repetitions per version, alternating AB/BA/AB, on
the same isolated display. Both versions were rebuilt by the benchmark runner.
Heavy checks ran sequentially with `MemoryMax=4G`, `MemorySwapMax=512M` and
`NODE_OPTIONS=--max-old-space-size=2304`; no retry or tolerance changes.

All eight scenarios and **48 comparisons passed; zero regressions** at the
existing joint thresholds (>25% and >50ms). The table gives median milliseconds
**baseline → candidate**, with the source preparation wait explicitly separated.
First/second are individual cycles; warm is the median of cycles 3–5 per run.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 33 → 36 | 25 → 24 | 24 → 22 | 33 → 21 | 40 → 39 | 12 → 11 |
| Markdown | 0ms | yes | 478 → 414 | 104 → 103 | 97 → 87 | 21 → 16 | 17 → 13 | 17 → 15 |
| Markdown | 3000ms | no | 30 → 41 | 19 → 19 | 22 → 25 | 18 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 108 → 98 | 98 → 110 | 90 → 93 | 20 → 16 | 13 → 17 | 16 → 14 |
| Git review | 0ms | no | 1002 → 1020 | 26 → 24 | 27 → 28 | 23 → 22 | 12 → 12 | 12 → 13 |
| Git review | 0ms | yes | 1107 → 1085 | 1604 → 1598 | 179 → 177 | 14 → 23 | 21 → 20 | 19 → 18 |
| Git review | 3000ms | no | 28 → 23 | 23 → 23 | 16 → 17 | 23 → 23 | 12 → 12 | 18 → 17 |
| Git review | 3000ms | yes | 233 → 229 | 182 → 189 | 179 → 175 | 22 → 23 | 18 → 19 | 17 → 17 |

[Comparison summary, samples and artifact hashes](../language-registry-preview-benchmark-2026-10-15.json).
Raw captures, per-run logs and the complete report remain in
`test-results/language-registry-benchmark-2026-10-15/`. Latest-content assertions
were required for edited captures. These small-document measurements retain the
existing timing limitations and do not establish large-project LSP performance.


## Explorer file operations validation, 2026-10-15

Final functional checks: **109 unit files / 744 tests**, and the full
`test:preview-contract` gate with **56 files / 353 tests**, three comparator
checks, build/typecheck (zero Svelte errors/warnings), and **111 real Electron
scenarios passed**. The seven Explorer scenarios include the original native
pointer/multi-selection coverage and four new clipboard, conflict, inline-name
and failed-trash scenarios. All GUI runs used isolated Xvfb/runtime/D-Bus.

The first full Electron run had **110 passes / one failure**: the existing
website-draggable-CSS test observed `drag` on an iframe. A single baseline run
and five independent candidate diagnostic runs passed; the final full gate also
passed. The browser policy and that assertion were unchanged. The intermittent
failure is retained as an unresolved diagnostic observation, not described as a
fixed Explorer regression. Logs are in `test-results/explorer-validation/`.

The independent, separately installed baseline is
`12a234033dc62019be3c8ef15067d40a4e907218`. Both builds use Electron 44.7.2.
Heavy checks ran sequentially with `MemoryMax=4G`, `MemorySwapMax=512M` and a
2304MiB Node heap. Baseline and candidate use the same isolated display and
settings within each comparison batch. No scenario/assertion/retry/tolerance
changes were made.

Performance evidence includes the failed initial comparison:

- Initial **three matched repetitions: FAIL, two regressing buckets**. Markdown,
  immediate first Esc after editing: **326 → 440ms**. Git review, immediate first
  Esc without edits: **973 → 1225ms**. These samples were not discarded.
- A separate Chromium trace placed the ordinary show request at approximately
  0ms in both apps; native layout/preparation and capture dominated the cold
  delay. The preview bridge and review worker artifacts were byte-identical.
  Trace runs include diagnostic probes and are **excluded from gate samples**;
  they do not establish the cause of the initial difference.
- Before further measurements, the follow-up was fixed at **five additional
  matched repetitions**, using the same builds, harness, fixtures and thresholds.
  That five-pair batch passed all 48 comparisons. It used the runner's
  `--skip-build` option only after both original artifact hashes were verified.
- Re-evaluating **all eight repetitions**, including every initial sample, also
  passes **48 comparisons, zero regressions** at the unchanged joint thresholds
  (>25% and >50ms). No production code changed between these two batches. The
  checked-in record includes each batch's outcome, all eight per-bucket samples,
  artifact identities and hashes of the changed/new source files.

Median milliseconds below are **baseline → candidate** across all eight
repetitions. First and second are distinct cycles; warm is the median of cycles
3–5 within each process, then across processes. Source wait is listed separately.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39.5 → 35.5 | 19 → 20 | 20.5 → 21.5 | 17.5 → 17 | 35.5 → 33 | 11 → 12 |
| Markdown | 0ms | yes | 429.5 → 437.5 | 101 → 105.5 | 91 → 93.5 | 18.5 → 19.5 | 14.5 → 14 | 15 → 13 |
| Markdown | 3000ms | no | 42.5 → 40 | 20.5 → 20 | 24.5 → 25.5 | 17.5 → 16.5 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 108 → 108.5 | 94.5 → 102 | 90.5 → 92 | 17.5 → 17.5 | 15.5 → 15.5 | 14.5 → 14.5 |
| Git review | 0ms | no | 942 → 939 | 21.5 → 19.5 | 28 → 24.5 | 24 → 22 | 11 → 11 | 12.5 → 12 |
| Git review | 0ms | yes | 1013.5 → 1042.5 | 1497.5 → 1565.5 | 175 → 181 | 25.5 → 22.5 | 19.5 → 20.5 | 18.5 → 19 |
| Git review | 3000ms | no | 28 → 24.5 | 21.5 → 22 | 18 → 17.5 | 23.5 → 24 | 11 → 11.5 | 17.5 → 17.5 |
| Git review | 3000ms | yes | 229.5 → 229 | 188 → 187 | 176.5 → 177 | 21.5 → 22.5 | 18 → 19 | 18 → 17 |

[Comparison summary, samples and validation metadata](../explorer-preview-benchmark-2026-10-15.json).
Full raw records are in `test-results/explorer-benchmark-2026-10-15/` and
`test-results/explorer-benchmark-expanded-2026-10-15/`; the combined record and
logs are in `test-results/explorer-validation/`. Separate Chromium traces are in
`test-results/explorer-performance-diagnostic/`. These results cover Markdown/Git
transitions; they do not establish large-tree or large-copy throughput, and do
not prove the initial cold-path variation cannot recur.

## Installed language-server discovery validation, 2026-10-16

Final functional checks: **110 unit files / 761 tests**, including a real login
shell exposing an executable through a path containing spaces and Korean text;
**57 preview-contract unit files / 369 tests**, three comparator checks,
build/typecheck with zero Svelte errors/warnings, and **112 real Electron
scenarios passed**. The additional real-server gate passed **two scenarios**:
fortls 3.2.2 auto-connection, hover/completion and Rescan; rust-analyzer
0.3.3081-standalone with Rust 1.95.0 completion, hover, diagnostics, navigation,
rename/Undo and restart. The full unit run includes the additional login-shell
case added after the preview-contract unit phase. GUI runs used isolated
Xvfb/runtime/D-Bus; no test window used the desktop display.

Discovery regression coverage includes missing executables, disabled/manual
choices, old custom fortls definitions, PATH priority, ambiguous candidates,
Python scripts queries, environment/output limits, cancelled results, close while
discovering, Rescan while discovering, latest unsaved text and Undo. New documents
reuse a live workspace session after Rescan changes its future launch plan;
unrelated settings changes preserve healthy server processes. gopls real-server
behavior and Windows execution were not exercised by this Linux run.

The independently installed baseline is
`6b0db3c3ce0b7c18383e4292f57b8dba24849a39`; both apps use Electron 44.7.2.
Two batches of five matched repetitions alternate baseline/candidate order on
one isolated display within each batch, with eight fresh-app scenarios and five
cycles each. No harness, correctness assertion, retry count or tolerance was
relaxed. The benchmark
includes first, second and warm cycles separately and checks current edited
content before capture. Source preparation wait remains separate from measured
input latency; Esc includes capture readback, not a monitor presentation timestamp.

The initial five-pair comparison failed one bucket: ordinary Markdown, no edits,
immediate first Esc, **35 → 121ms**. All eight scenarios and correctness checks
completed; this was a timing failure, not an incomplete measurement. Its five
baseline samples were 35, 22, 26, 50, 55ms, and candidate samples were
121, 60, 121, 41, 127ms. Those samples remain part of the final aggregate.

A separate diagnostic trace found immediate show requests in both versions
and first captures of 20ms and 62ms. Preview bridge, render/review workers and
CSS were byte-identical; Crossnote, KaTeX and Monaco versions also matched.
These observations do not establish the cause of the initial timing difference.
Traces include probes and are excluded from performance samples.

Before further measurement, the follow-up was fixed at five additional matched
repetitions. Original build hashes were verified before using `--skip-build`.
No production code changed between batches. The aggregate uses all ten matched
repetitions, including every initial sample, with unchanged thresholds. Each
batch's separate outcome is retained in the comparison record.

Combined comparison result: **PASS — 0 regressions across 48 buckets**, at the
unchanged joint thresholds (>25% and >50ms).

Median milliseconds below are **baseline → candidate**. Warm means the median
of cycles 3–5 in each app, then the median across repetitions.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39 → 53.5 | 24 → 27 | 22.5 → 21.5 | 36.5 → 22 | 37.5 → 35.5 | 11.5 → 12 |
| Markdown | 0ms | yes | 464.5 → 447 | 101 → 103 | 91 → 91.5 | 21 → 21 | 17 → 13.5 | 15 → 14.5 |
| Markdown | 3000ms | no | 42 → 41 | 22.5 → 21.5 | 22 → 23 | 16 → 16 | 12 → 12 | 11 → 11 |
| Markdown | 3000ms | yes | 107.5 → 100 | 101.5 → 98 | 94.5 → 92 | 17 → 20 | 16 → 14 | 13 → 13 |
| Git review | 0ms | no | 994 → 1005 | 19 → 21 | 27.5 → 29 | 23 → 22.5 | 11.5 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1069 → 1046.5 | 1576.5 → 1541.5 | 179 → 177 | 23.5 → 22 | 21.5 → 22 | 20 → 18.5 |
| Git review | 3000ms | no | 26 → 28 | 21 → 21.5 | 17.5 → 18 | 25 → 24 | 11.5 → 11 | 17 → 17 |
| Git review | 3000ms | yes | 228.5 → 230.5 | 185 → 189 | 175.5 → 178 | 22 → 22.5 | 18 → 17.5 | 16 → 18 |

[Comparison samples, identities and source hashes](../lsp-discovery-preview-benchmark-2026-10-16.json).
Full raw records are in `test-results/lsp-discovery-benchmark-2026-10-16/` and
`test-results/lsp-discovery-benchmark-followup-2026-10-16/`; combined data and
functional logs are in `test-results/lsp-discovery-validation/`. Traces are in
`test-results/lsp-discovery-diagnostic/`. These results cover ordinary Markdown/Git
transitions, not large-project LSP indexing or
network-filesystem discovery latency. They do not prove the initial first-cycle
variation cannot recur.

## Catalog-wide language discovery validation, 2026-10-16

The generated catalog contains 384 entries and 195 connection profiles. Every
entry participates in installation discovery; 142 of the 331 Mason entries have
profiles and 189 still require connection metadata. The importer is offline,
checksum-pinned and reproducible. Profile presence is not a blanket compatibility
claim for every server or every protocol capability.

Validation passed **111 unit files / 772 tests**, **58 contract unit files / 381
tests**, three comparator tests, build/typecheck with zero Svelte errors/warnings,
and **113 real Electron scenarios**. After the small final refinement to select
an installed entry when opening Language Support, the final build reran **all
three management scenarios**, including that initial choice, plus **two real
fortls/rust-analyzer scenarios**. GUI tests used isolated Xvfb/runtime/D-Bus and
never used the desktop display.

Coverage includes imported variants and exact names/globs, independent Ada/GPR
launch arguments, C#/F# solution root patterns, persisted disabling/custom
connections, installed-primary ambiguity, main-owned candidate selection, npm
bin/runtime lookup and one shared custom-prefix query, cancellation and metadata
limits. The Electron npm fixture verifies an unconfigured TypeScript file connects
and completes through an imported profile, survives Rescan on the same process,
and retains Undo. It validates Setdown's protocol/launch integration; it does not
run the actual upstream TypeScript server. Real servers cover Pyright/clangd in
the contract and fortls/rust-analyzer in the additional gate.

The independently installed baseline is
`4b1683f6fbb25039e2ed13cd3c43df8414f62439`; baseline and candidate both use
Electron 44.7.2. Each was separately built before the comparison. `--skip-build`
reused those builds; the harness recorded and verified both artifact hashes.
Five matched repetitions alternate execution order on one isolated display.
All eight scenarios, five cycles, real double-clicks and latest-content captures
were retained. No retry, assertion or tolerance was relaxed.

Comparison: **PASS — 0 regressions across 48 buckets**, using the
existing joint thresholds (>25% and >50ms).

Median milliseconds are **baseline → candidate**. Warm is cycles 3–5 within each
app, then the median across repetitions. Preparation wait is separate from input
latency; Esc includes native capture/readback, not a monitor presentation timestamp.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 48 → 44 | 19 → 25 | 24 → 19 | 16 → 16 | 32 → 34 | 12 → 12 |
| Markdown | 0ms | yes | 432 → 423 | 102 → 107 | 92 → 90 | 19 → 17 | 13 → 14 | 15 → 12 |
| Markdown | 3000ms | no | 38 → 40 | 21 → 20 | 19 → 20 | 16 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 109 → 107 | 102 → 105 | 88 → 89 | 19 → 19 | 13 → 13 | 15 → 14 |
| Git review | 0ms | no | 906 → 969 | 20 → 20 | 26 → 27 | 23 → 23 | 12 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1031 → 1043 | 1502 → 1498 | 176 → 175 | 25 → 24 | 22 → 20 | 19 → 18 |
| Git review | 3000ms | no | 27 → 27 | 23 → 24 | 17 → 19 | 24 → 23 | 11 → 11 | 16 → 16 |
| Git review | 3000ms | yes | 226 → 228 | 178 → 182 | 177 → 176 | 21 → 21 | 18 → 19 | 17 → 17 |

[Samples, identities, coverage and source hashes](../lsp-profiles-preview-benchmark-2026-10-16.json).
Raw records are in `test-results/lsp-profiles-benchmark-2026-10-16/`; functional
logs are in `test-results/lsp-profile-validation/`. The baseline checkout is on
disk under that validation directory: stale previous /tmp checkouts were removed
after an initial temporary-filesystem quota failure, and the incomplete baseline
install was replaced with a clean independent npm install before measurement.
These measurements cover Markdown/Git transitions, not large-project LSP indexing,
Windows execution, or slow/network-filesystem discovery latency.


## Language Support sidebar validation, 2026-10-16

The Language Support activity opens a normal sidebar below Browser. Detected,
Needs attention, and Manual connections are followed by Available servers.
All 378 discoverable server definitions remain searchable, regardless of whether
they are installed or have a connection profile. Included Pyright remains visible;
five entries without discovery metadata stay in the manual-add flow. Real language
logos load with the lazy sidebar and use the existing light/dark appearance.

Validation passed **59 contract unit files / 385 tests**, three benchmark comparator
tests, production build/typecheck with zero Svelte errors/warnings, **115 real
Electron scenarios**, and **two real fortls/rust-analyzer scenarios**. Coverage
includes manual creation/import/removal, missing executable repair, search across
all four groups, SVG logos, Escape ownership, unchanged native web visibility and
frame delivery, current unsaved text, stable healthy sessions, and Undo. All GUI
runs used isolated Xvfb/runtime/D-Bus.

The independent baseline is `fb4951c16302857f5fb71b88f5c5fc323d155be3`. Its dependencies were
installed separately with offline npm ci; the pinned local submodules and cached
uBlock assets completed its production build. Candidate and baseline both use
Electron 44.7.2. Five matched repetitions alternate order on
one isolated display. The harness reused and verified the previously built
artifacts, with all eight scenarios, all five cycles, latest-content captures,
and real double-click input. No assertions, retries or tolerances were changed.

Comparison: **PASS — 0 regressions across 48 buckets**, at the existing joint
thresholds (>25% and >50ms). Median milliseconds below are **baseline → candidate**.
Warm means cycles 3–5 within each app, then the median across repetitions.
Source preparation wait is separate from input latency; Esc includes native
capture/readback and is not a monitor presentation timestamp.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 59 → 39 | 28 → 31 | 20 → 24 | 20 → 20 | 37 → 36 | 12 → 11 |
| Markdown | 0ms | yes | 440 → 433 | 94 → 94 | 91 → 90 | 17 → 20 | 17 → 15 | 14 → 14 |
| Markdown | 3000ms | no | 43 → 41 | 16 → 22 | 21 → 23 | 16 → 17 | 11 → 11 | 12 → 11 |
| Markdown | 3000ms | yes | 126 → 118 | 102 → 90 | 93 → 92 | 20 → 19 | 14 → 16 | 13 → 13 |
| Git review | 0ms | no | 978 → 955 | 27 → 20 | 29 → 27 | 24 → 22 | 11 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1009 → 1022 | 1534 → 1457 | 177 → 176 | 22 → 15 | 13 → 22 | 18 → 18 |
| Git review | 3000ms | no | 30 → 26 | 21 → 23 | 18 → 17 | 25 → 23 | 11 → 12 | 18 → 18 |
| Git review | 3000ms | yes | 226 → 227 | 189 → 180 | 176 → 177 | 22 → 23 | 19 → 19 | 17 → 17 |

[Samples, identities and source hashes](../language-sidebar-preview-benchmark-2026-10-16.json).
Raw comparisons are in `test-results/language-sidebar-benchmark-2026-10-16/`;
functional logs and light/dark screenshots are in
`test-results/language-sidebar-validation/`. These checks cover Markdown/Git
transitions and sidebar integration; they do not measure large-project indexing
or claim a logo exists for every language. Unmapped languages use a short label.

## LSP feature expansion validation — 2026-10-16

The feature inventory, entry points and exclusions are maintained in
[language support](../language-support.md#editor-features). The existing Monaco
document, dirty-state and per-file Undo paths remain authoritative. No editor
framework or language-server dependency was added.

Final verification passed **61 unit files / 400 tests**, **three benchmark
comparator tests**, production build/typecheck with **zero Svelte errors or
warnings**, **116 real Electron scenarios**, and **two real native-server
scenarios** using installed fortls and rust-analyzer. All GUI runs used isolated
Xvfb/runtime/D-Bus. The new fixture verifies visible semantic colors, inlay hints,
formatting/Undo, raw diagnostic quick fixes, resolved commands with server-requested
edits in an unopened file, workspace symbols, call hierarchy, and Explorer
will/did rename with reference edits and Undo. Actual clangd verifies project
formatting; actual fortls verifies diagnostics after disk save. Existing Python
rename/Undo, source/reader, IME, zoom, browser playback and shutdown checks passed.

Validation exposed and fixed the static `willRename` → `willRenameFiles` mapping,
Pyright's initial source-enumeration race, and legacy numeric synchronization
omitting `didSave`. An invalid semantic-token delta fetches a fresh full result;
an initializing language server cannot delay ordinary saving. Initial failing
logs and final passing logs are retained in `test-results/lsp-feature-validation/`.
No assertions were relaxed and no retries or skips were added to obtain a pass.

The independently installed baseline is
`34ef4df5c85e436baa62bf6641122d005fa7fcf2`. Baseline and candidate use Electron
**44.7.2**, with separate dependency installations. Five matched repetitions
alternate baseline/candidate order on one isolated display. `--skip-build`
reuses their verified production builds; the harness records and verifies both
artifact hashes. All eight scenarios and five cycles per process completed,
including latest-content captures and real double-click input.

Comparison: **PASS — zero regressions across 48 buckets** using the existing
joint thresholds (>25% and >50ms). Median milliseconds are **baseline → candidate**.
Warm means cycles 3–5 within each process, then the median across repetitions.
The table excludes the explicit source-preparation wait. Esc includes native
capture/readback; it is not a monitor presentation timestamp.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39 → 42 | 26 → 27 | 19 → 19 | 17 → 18 | 33 → 26 | 12 → 11 |
| Markdown | 0ms | yes | 437 → 446 | 100 → 103 | 92 → 88 | 16 → 19 | 13 → 14 | 13 → 16 |
| Markdown | 3000ms | no | 44 → 41 | 19 → 20 | 23 → 18 | 16 → 16 | 12 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 110 → 96 | 106 → 101 | 92 → 89 | 19 → 19 | 13 → 12 | 15 → 13 |
| Git review | 0ms | no | 952 → 912 | 21 → 19 | 26 → 28 | 23 → 24 | 12 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1027 → 1011 | 1493 → 1498 | 177 → 176 | 21 → 23 | 22 → 21 | 19 → 20 |
| Git review | 3000ms | no | 29 → 24 | 22 → 22 | 19 → 19 | 23 → 23 | 11 → 11 | 17 → 17 |
| Git review | 3000ms | yes | 227 → 233 | 181 → 191 | 174 → 175 | 22 → 22 | 18 → 18 | 18 → 17 |

Including the **configured 3000ms preparation allowance**, the first Esc totals
are below. This is wait allowance + measured input latency, not a separate
measurement of preparation CPU time or complete application startup. The wait
occurs only before the first cycle, so second/warm and double-click values stay
as above; the 0ms scenarios' inclusive totals equal the first table.

| Surface | Edit | First Esc including preparation allowance |
| --- | --- | ---: |
| Markdown | no | 3044 → 3041 |
| Markdown | yes | 3110 → 3096 |
| Git review | no | 3029 → 3024 |
| Git review | yes | 3227 → 3233 |

[Comparison samples, build identities and source hashes](../lsp-features-preview-benchmark-2026-10-16.json).
Raw results are in `test-results/lsp-features-performance/`; functional logs and
feature screenshots are in `test-results/lsp-feature-validation/`.
These checks establish the existing Markdown/Git transition contract for these
fixtures. They do not establish large-project LSP indexing time, RSS, or every
server's support for each optional feature. Workspace edits remain text-only
with per-file Undo; notebook/debugger/virtual-document and multi-server support
remain outside this implementation.

## LSP overflow widget validation — 2026-10-16

Ordinary and Git source editors now use Monaco's fixed overflow widgets, so
include hovers remain painted and hit-testable across clipped source/group
boundaries. The real clangd regression covers ordinary, lower split and Working
Tree source, with screenshots and four-corner hit testing. The same test fails
against the unmodified baseline. No editor model or native preview lifecycle was
changed.

Final verification passed **61 unit files / 400 tests**, **three benchmark
comparator tests**, production build/typecheck with **zero Svelte errors or
warnings**, and **117 real Electron scenarios**. All GUI runs used isolated
Xvfb/runtime/D-Bus. An initial run exposed a pre-existing clangd formatting-test
race: normalized whitespace matched before formatting and disk save completed.
The test now waits for actual changed indentation and changed disk contents.
Initial failing logs and final passing logs are retained; no retry, skipped
scenario, weakened assertion or tolerance change was introduced.

The independent baseline is `1f37fa1b3d3520d6cd918777248c9f5d9ce69344`, installed separately
with offline npm ci. Both apps use Electron **44.7.2**.
Five matched repetitions alternate baseline/candidate order on one isolated
display. The harness reuses and verifies their current production builds with
`--skip-build`. All eight scenarios, all five cycles, latest-content captures
and real double-click input completed.

Comparison: **PASS — zero regressions across 48 buckets**, using the unchanged
joint thresholds (>25% and >50ms). Values below are **baseline → candidate**
median milliseconds. Warm is the median of cycles 3–5 in each fresh process,
then the median across repetitions. Preparation wait is separate from measured
input latency; Esc includes native capture/readback, not monitor presentation.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 39 → 36 | 24 → 25 | 22 → 21 | 18 → 17 | 34 → 35 | 12 → 11 |
| Markdown | 0ms | yes | 420 → 453 | 97 → 99 | 90 → 93 | 18 → 17 | 16 → 13 | 12 → 14 |
| Markdown | 3000ms | no | 40 → 43 | 22 → 21 | 20 → 18 | 17 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 111 → 94 | 99 → 100 | 90 → 90 | 20 → 17 | 17 → 12 | 15 → 14 |
| Git review | 0ms | no | 964 → 979 | 24 → 25 | 21 → 22 | 23 → 26 | 11 → 12 | 13 → 12 |
| Git review | 0ms | yes | 1039 → 1021 | 1558 → 1538 | 178 → 183 | 23 → 22 | 22 → 21 | 20 → 18 |
| Git review | 3000ms | no | 28 → 27 | 22 → 21 | 19 → 18 | 24 → 24 | 12 → 12 | 18 → 17 |
| Git review | 3000ms | yes | 231 → 236 | 185 → 189 | 181 → 179 | 22 → 24 | 18 → 18 | 17 → 18 |

Including the **configured 3000ms preparation allowance**, first Esc totals are
below. These add the explicit wait allowance to measured input latency; they do
not measure preparation CPU time. The wait precedes only the first cycle, so
second/warm and double-click values stay as above. The 0ms scenarios' inclusive
values equal the first table.

| Surface | Edit | First Esc including preparation allowance |
| --- | --- | ---: |
| Markdown | no | 3040 → 3043 |
| Markdown | yes | 3111 → 3094 |
| Git review | no | 3028 → 3027 |
| Git review | yes | 3231 → 3236 |

[Samples, build identities and source hashes](../lsp-hover-preview-benchmark-2026-10-16.json).
Raw measurements are in `test-results/lsp-hover-performance-2026-10-16/`; functional logs and hover screenshots
are in `test-results/lsp-hover-validation/`. These measurements cover
ordinary Markdown/Git transitions, not large-project LSP indexing or general
popup latency.


## Notebook reform validation — 2026-10-16

This follows the initial notebook validation above, against baseline `600f9ae`.
The completed gate passed **67 unit files / 441 tests**, **three benchmark
comparator tests**, production build/typecheck with **zero Svelte errors or
warnings**, **123 real Electron scenarios**, and **three real IPython integration
tests**. All GUI execution used isolated Xvfb/runtime/D-Bus; no desktop windows,
test retries, weakened assertions or changed performance tolerances were used.

The six notebook Electron scenarios cover native notebook diagnostics for magic,
top-level await and independent cell syntax; a genuine type error remains visible.
They also cover reordered cell diagnostics, cross-cell definitions, two actual
Python environments with different import availability, and execution using the
selected environment. Layout/input cases exercise 35 cells with long output and
a 120-line cell, bounded Monaco rendering, retained output height, real Korean
composition while scrolling, and subsequent ordinary search input. Clipboard,
structural Undo, Shift/Alt+Enter queueing, output copy, canceled app quit preserving
kernel variables, and reset clearing those variables are included.

The initial full run caught the expected catalog change from one bundled Python
entry to two. Its assertion now verifies both exact server IDs and opens the
notebook-specific details. A full rerun passed all 123 scenarios. Earlier probes
also exposed a will-quit drain that delayed restart without a language session,
and Chromium EditContext swallowing find input after virtual editor disposal;
the final production fixes and regression scenarios are included in this gate.

Functional logs and the notebook screenshot are retained in
`test-results/notebook-reform/`; the final full log is `contract-final-2.log`, and
the real IPython log is `kernel-tests.log`.

The independent baseline is `600f9aeb4380d5895d980f57b291dc1316a97774`,
installed with its own dependencies and built under
`test-results/notebook-reform/baseline/`. Baseline and candidate both use Electron
**44.7.2**. Five matched repetitions alternate order on one isolated display.
`--skip-build` reused current independently built artifacts; the harness verified
their hashes before and after measurement. All eight scenarios and five cycles
completed with latest-content capture checks and real double-click input.

**PASS — zero regressions across 48 buckets**, using unchanged joint thresholds
(>25% and >50ms). Values below are **baseline → candidate medians in milliseconds**.
Warm is the median of cycles 3–5 per process, then across repetitions. Esc includes
polling/IPC/native capture readback, not a monitor presentation timestamp.
This table excludes the configured preparation wait.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 40 → 40 | 21 → 23 | 24 → 24 | 17 → 19 | 30 → 35 | 11 → 11 |
| Markdown | 0ms | yes | 404 → 428 | 101 → 100 | 90 → 89 | 16 → 15 | 14 → 14 | 14 → 14 |
| Markdown | 3000ms | no | 25 → 27 | 18 → 21 | 22 → 22 | 16 → 16 | 11 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 95 → 110 | 103 → 89 | 91 → 90 | 20 → 20 | 14 → 13 | 12 → 13 |
| Git review | 0ms | no | 927 → 907 | 19 → 22 | 28 → 20 | 23 → 23 | 12 → 11 | 12 → 12 |
| Git review | 0ms | yes | 1006 → 980 | 1432 → 1492 | 175 → 175 | 25 → 22 | 12 → 19 | 17 → 17 |
| Git review | 3000ms | no | 32 → 30 | 21 → 22 | 17 → 17 | 24 → 24 | 11 → 11 | 16 → 16 |
| Git review | 3000ms | yes | 227 → 232 | 181 → 185 | 174 → 175 | 20 → 23 | 18 → 19 | 17 → 18 |

Including the **configured 3000ms preparation allowance**, first Esc totals are
below. This adds the explicit wait, not measured preparation CPU time. The wait
precedes only the first cycle; second/warm and double-click metrics are unchanged.
The 0ms scenarios have the same inclusive totals as the first table.

| Surface | Edit | First Esc including preparation allowance |
| --- | --- | ---: |
| Markdown | no | 3025 → 3027 |
| Markdown | yes | 3095 → 3110 |
| Git review | no | 3032 → 3030 |
| Git review | yes | 3227 → 3232 |

[Samples, build identities and hashes](../notebook-reform-preview-benchmark-2026-10-16.json).
Raw run JSON/logs are in `test-results/notebook-reform/benchmark/`. This comparison
covers existing ordinary Markdown/Git transitions. Notebook functional regressions
cover the fixtures above; they do not establish a 1,000-cell memory budget,
kernel startup latency or sustained output throughput.

## Notebook convenience validation — 2026-10-16

This implements the remaining convenience audit with native notebook commands and
explicit integrations with JupyterLab, nbconvert, nbdime, Jupytext and Ruff. See
[notebook usage and session boundaries](../notebooks.md). Native Python diagnostics
keep the VS Code-style lightweight policy; there is no strictness selector.

Final validation: **68 unit files / 450 tests**, **3 benchmark-comparator tests**,
production typecheck/build with **zero Svelte errors or warnings**, **125 real
Electron scenarios** including **8 notebook scenarios**, and **4 real IPython
kernel integration tests**. The separate external-tool Electron test passes real
HTML/Markdown/script/WebPDF export, Ruff, nbdime HEAD comparison, Jupytext conversion,
JupyterLab slider widgets and Plotly FigureWidget rendering, debugger activation,
and stopping the owned servers. It uses a separate fully installed tool venv.

Bulk source edits validate every cell revision before mutation and use one cell
operation for Undo. Splitting clears stale results; joins reject incompatible
metadata/attachments instead of discarding them. Search regexes run in a worker
with a two-second timeout. Output changes still do not resynchronize LSP. The
variable viewer transfers bounded pages only on request; input requests are tied
to the active run and kernel generation. Restart-all awaits old bridge shutdown.

JupyterLab is an owned web session with its own kernel, not the native cell renderer.
The Python `# %%` path creates a separate notebook snapshot. Native output sanitization,
IME/focus, original JSON spans and shared native analysis/execution Python remain
covered by the existing regressions. Remote-server compatibility and non-Python
kernels were not independently exercised by this local Python tool test.

The baseline is **3bbf4355a8e520fed17455a16f5db211b83ddb98**, installed in the original
checkout with its own dependencies. The candidate is a separate checkout with its
own installation. Both use **Electron 44.7.2**. Three matched repetitions alternate
AB/BA on one isolated Xvfb/runtime/D-Bus environment: eight scenarios per version,
five cycles per process, 48 application launches. Both applications were built by
the benchmark runner; fixture/harness/build hashes were retained and checked.

**PASS — zero regressions in all 48 buckets**, with unchanged joint thresholds
(**>25% and >50ms**). Values below are baseline → candidate medians in milliseconds.
Warm is the median of cycles 3–5 in each process, then across repetitions. Esc is
latest-content native capture latency including polling/IPC/readback, not a monitor
presentation timestamp. The first table excludes the configured preparation wait.

| Surface | Source wait | Edit | Esc first | Esc second | Esc warm | Double-click first | Double-click second | Double-click warm |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Markdown | 0ms | no | 33 → 37 | 21 → 20 | 24 → 24 | 17 → 17 | 31 → 31 | 11 → 11 |
| Markdown | 0ms | yes | 393 → 432 | 95 → 100 | 81 → 90 | 19 → 20 | 13 → 13 | 17 → 14 |
| Markdown | 3000ms | no | 27 → 42 | 22 → 16 | 20 → 24 | 16 → 16 | 12 → 11 | 11 → 11 |
| Markdown | 3000ms | yes | 88 → 106 | 98 → 100 | 90 → 93 | 20 → 14 | 12 → 14 | 13 → 12 |
| Git review | 0ms | no | 922 → 930 | 21 → 20 | 18 → 17 | 22 → 23 | 12 → 12 | 12 → 12 |
| Git review | 0ms | yes | 970 → 994 | 1492 → 1438 | 175 → 175 | 14 → 21 | 21 → 21 | 18 → 19 |
| Git review | 3000ms | no | 32 → 23 | 23 → 22 | 18 → 18 | 23 → 23 | 11 → 11 | 18 → 17 |
| Git review | 3000ms | yes | 223 → 231 | 189 → 171 | 177 → 180 | 23 → 21 | 18 → 17 | 18 → 17 |

Including the **configured 3000ms preparation allowance** gives the following
first-cycle totals. This adds the intentional wait, not measured preparation CPU
time. Only the first cycle waits; second/warm and double-click measurements are
unchanged. The 0ms inclusive totals equal the first table.

| Surface | Edit | First Esc including preparation allowance |
| --- | --- | ---: |
| Markdown | no | 3027 → 3042 |
| Markdown | yes | 3088 → 3106 |
| Git review | no | 3032 → 3023 |
| Git review | yes | 3223 → 3231 |

[Samples, build identities and hashes](../notebook-convenience-preview-benchmark-2026-10-16.json).
Raw measurements and passing logs/screenshots are retained in
`test-results/notebook-convenience-2026-10-16/`. These benchmarks cover ordinary
Markdown/Git transitions; they do not establish notebook kernel startup, large
variable-query throughput, PDF export latency or remote-server performance.
