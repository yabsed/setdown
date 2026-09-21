# PDF tab caching and image reader validation (2026-09-21)

Baseline: `62544a8b2668b14cebdf82a76b78233c4fc83239`, separate checkout `/tmp/setdown-media-base` with independently installed dependencies. Candidate: the working tree implementing retained PDF/image surfaces and the image reader. Both use Electron 38.8.6. Final checks and comparisons ran serially on the same Linux machine, on an isolated Xvfb display (`:97`, 1440×1000, 24-bit).

## Implementation and checks

- PDF and image surfaces share a three-entry LRU cache. Unchanged PDF returns preserve the worker, canvas, text layers and scroll position; closing, eviction, path/version changes dispose the old surface. Hidden views are inert and cannot focus find or publish reading positions.
- PDF page controls become available after initial position restoration, so early page changes cannot race setup.
- PNG, JPEG/JPG, WebP, GIF, AVIF and SVG use a read-only image element with fit, zoom, rotation and panning. SVG is never inserted as document markup. Image reads require an owned regular file, an unchanged disk version and at most 64 MiB.
- `npm test`: 70 files, 512 tests passed.
- `DISPLAY=:97 npm run test:preview-contract`: 106 focused unit tests, benchmark comparator tests, build/typecheck and all 17 real Electron/Chromium tests passed, with no retries.
- Image E2E tests decode each listed format in Chromium, check retained element/blob identity, read-only saving, SVG script isolation, restart position restoration, changed files, invalid images and unowned read rejection. PDF E2E tests verify canvas identity across Markdown/PDF switches, focused find, hidden resize, eviction, reload/page clamping and durable positions.
- A real image-reader screenshot was inspected. Windows/macOS execution was not exercised.

## PDF tab latency

Three matched repetitions, alternating order, 12 fresh apps. Each starts with another document already open, then measures the first opening of the 100-page target PDF and five returns to page 98. Each return verifies the active tab, page text, nonblank canvas pixels and a nonempty native capture. The PDF-to-PDF case already has the PDF module loaded before the initial target open. Values below are baseline → candidate medians in milliseconds.

| Other tab | Initial target open | First return | Second return | Warm returns |
| --- | ---: | ---: | ---: | ---: |
| Markdown | 405 → 394 | 306 → 120 | 302 → 114 | 298 → 114 |
| PDF | 288 → 292 | 301 → 110 | 283 → 102 | 289 → 111 |

Warm returns improve by about **62%** in both cases. Initial opening is largely unchanged; the optimization removes reconstruction on cached tab returns. Native canvas identity is additionally asserted by the integration tests.

Full samples, build and harness hashes: [PDF tab benchmark](pdf-tab-benchmark-2026-09-21.json). The harness rejects a baseline resolving to the candidate checkout, including path aliases; that rejection was checked separately.

## Existing Markdown and Git review latency

**PASS: all 48 comparison buckets, zero regressions.** Five matched repetitions per version, alternating order, 80 fresh app launches. All eight scenarios and latest-content captures validated. Default tolerances remain unchanged: a regression must exceed both 25% and 50 ms.

Values are baseline → candidate medians in milliseconds. First and second cycles remain separate; warm is the median of cycles 3–5 per launch, then across launches. Preparation is time in source before Escape (0 or 3000 ms).

### Escape to verified native capture

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 46 → 62 | 24 → 26 | 24 → 32 |
| Markdown | Yes | 0 | 437 → 388 | 87 → 100 | 84 → 87 |
| Markdown | No | 3000 | 101 → 102 | 43 → 42 | 31 → 32 |
| Markdown | Yes | 3000 | 182 → 196 | 164 → 159 | 124 → 131 |
| Git review | No | 0 | 1235 → 1228 | 26 → 28 | 28 → 27 |
| Git review | Yes | 0 | 1295 → 1335 | 1781 → 1773 | 218 → 227 |
| Git review | No | 3000 | 51 → 50 | 24 → 26 | 28 → 27 |
| Git review | Yes | 3000 | 248 → 235 | 199 → 224 | 181 → 182 |

### Double-click to editable source

| Surface | Edit | Preparation | First | Second | Warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Markdown | No | 0 | 34 → 35 | 48 → 52 | 23 → 23 |
| Markdown | Yes | 0 | 21 → 18 | 14 → 18 | 14 → 16 |
| Markdown | No | 3000 | 45 → 46 | 36 → 39 | 27 → 31 |
| Markdown | Yes | 3000 | 28 → 27 | 36 → 44 | 24 → 20 |
| Git review | No | 0 | 40 → 42 | 15 → 17 | 20 → 21 |
| Git review | Yes | 0 | 42 → 43 | 28 → 25 | 24 → 23 |
| Git review | No | 3000 | 43 → 42 | 13 → 13 | 20 → 20 |
| Git review | Yes | 3000 | 45 → 45 | 38 → 37 | 15 → 21 |

## Measurement limits and excluded attempts

Timings include automation, IPC, polling and capture readback; they are not monitor presentation timestamps. Cold PDF opening still requires parsing/rendering, and evicted tabs reconstruct their view. The cache bounds the number of live surfaces, not total decoded bytes.

Direct-desktop test runs encountered focus/reading-position failures. The final isolated-display contract run passed every assertion. An initial PDF benchmark attempt stopped at the baseline reading-position precondition before collecting any sample; its [incomplete report](pdf-tab-benchmark-incomplete-2026-09-21.json) is retained and contributes no successful measurements. No tolerances were relaxed, scenarios skipped or automatic retries added.

Markdown/review comparison metadata and every comparison sample: [benchmark summary](media-preview-benchmark-2026-09-21.json). Full raw measurements and logs: `/tmp/setdown-media-preview-benchmark/`. Implementation, cache policy and reproducible commands: [reading positions and media](reading-positions-and-pdf.md).
