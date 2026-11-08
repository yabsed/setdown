# PDF theme and CI validation — 2026-11-08

The print window painted the theme inside the document but left the page-box
margins white. The shared PDF printer now reads the rendered body's background
and applies it to `@page`, keeping the existing A4 size and margins. Both local
Markdown and Web Reader exports use it.

## Actual PDF checks

- Before the fix, the Solarized Light export failed the edge-pixel assertion:
  actual `#ffffff`, expected `#fdf6e3`. See [the original page](before/page-1.png)
  and [failure log](before/electron.log).
- The new Electron tests reopen saved PDFs in the app's PDF.js reader and check
  eight corner/edge pixels on every page, A4 proportions and first/last text.
  All ten source/theme combinations passed: Markdown and Web Reader with
  Solarized Light, GitHub Dark, Paper, VS Code Dark 2026 and GitHub Light.
- [PDF results](pdf-results.json) record all 41 pages. The `after/` directories
  retain each PDF and all page PNGs, including Paper's empty fifth page.
  Text readiness uses PDF.js's completed text-layer marker so blank pages are
  still checked. No page is omitted from the pixel assertions.
- [Before/after layout comparison](layout.txt) found identical page counts and
  all 1,249 word bounds over four pages. Text remains selectable and content
  margins are preserved. See [the corrected page](after/solarized-light-markdown/page-1.png)
  and [corrected PDF](after/solarized-light-markdown/export.pdf).

## Validation commands

`TMPDIR=/var/tmp SETDOWN_BUILD_SOURCEMAP=0 npm run test:preview-contract`
completed with 880 unit tests, 14 desktop tooling tests, build/typecheck and
321 real Electron GUI tests passing. Type checking reported zero errors and
warnings. GUI execution used the standard isolated Xvfb/runtime/D-Bus wrapper,
with no test retries. See [the complete log](preview-contract.log).

`TMPDIR=/var/tmp npm run test:tooling` passed 65 CI policy tests and 14 desktop
tooling tests; see [tooling log](tooling.log). Workflow YAML parsing and the
cache/install/test ordering also passed. The official `install-electron` command
was verified locally, including a fresh temporary Electron package installed
from an isolated archive cache under network restrictions.

No preview latency benchmark was run: the product changes are confined to the
detached PDF print window; screen styles, preparation, bounds, transitions,
hydration, source lookup and dependencies are unchanged.

## GitHub Actions

[Run 42466582054](https://github.com/yabsed/setdown/actions/runs/42466582054)
originally failed before any unit assertions: Electron's first-require download
received HTTP 504 from GitHub Releases. One rerun of the failed jobs succeeded,
including 1,253 unit tests, tooling, typecheck, build and the final CI result.
That rerun used the existing `5218ed7` commit, before these local changes.
See [job IDs and log excerpts](ci.txt).

The local workflow now caches Electron archives separately from npm and runs
the pinned package's installer before tests. Its normal checksum verification
is retained. This follows the [official Electron installation guidance](https://www.electronjs.org/docs/latest/tutorial/installation)
and uses [GitHub's cache action](https://github.com/actions/cache). Cache misses
still require the release server; a failed download remains a failed job.
