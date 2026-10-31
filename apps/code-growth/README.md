# Setdown code growth

Measure **physical lines in committed code** across one Git ref's first-parent
history. All charts use the same file policy and history in `metrics.py`.
Physical LOC includes blank lines and comments. It describes code volume, not
feature completeness, complexity, test coverage, passing tests, or productivity.

From the repository root, regenerate every output with:

```bash
npm run plot:code-growth
```

This resolves `main` to one commit and uses that same first-parent commit list
for every view. LOC and density collectors each cache statistics by blob ID.
It does not include staged, unstaged or untracked work.
Python 3.10+ and Matplotlib are required. Every plot uses the noninteractive Agg
backend and saves PNGs without opening a desktop window.

## Views and outputs

All paths below are under `apps/code-growth/output/`.

| Output | What it measures |
| --- | --- |
| `repository-code-growth.png` | Total physical LOC and net change from the preceding first-parent snapshot |
| `repository-code-growth-detailed.png` | The same total, with production/test/tooling subtotals and calendar span |
| `repository-code-growth.csv` | Total, production, testing, tooling and net change per commit |
| `repository-component-growth-line.png` / `.csv` | Stacked area: all measured code by execution environment, with tests and tooling separated |
| `repository-feature-growth.png` / `.csv` | Stacked area: production source by feature responsibility, excluding tests and tooling |
| `repository-test-growth.png` / `.csv` | Stacked area: unit/service, E2E/integration, support and code fixtures |
| `repository-code-growth-files.csv` | Every included file at the measured tip, with commit, blob, LOC and classifications |
| `repository-code-growth-summary.json` | Measured ref and commit, scope, subtotals, classifications and unclassified paths |
| `repository-code-density.png` / `.csv` / `.json` | Line charts of mean nonblank line length per commit, data and methodology |
| `repository-code-density-by-characters.png` | The same density panels against total characters in each repository snapshot |

Every chart names the measured ref, commit and commit timestamp. Date axes use
Asia/Seoul calendar time, not working hours. Commit samples use steps; code growth
is not interpolated between commits. Breakdown charts use stacked areas: the top
boundary is the view's total, and each band's thickness is that category's LOC.
The component output keeps its existing `-line` filename for compatibility.
The first delta is the initial snapshot's
size; later deltas compare consecutive first-parent snapshots, including merges.

Growth CSV rows share `commit`, `committed_at`, `elapsed_hours` and `total`. `total` is the
sum of the categories **within that view**:

- Overall total = architecture total = production + testing + tooling.
- Feature total = production.
- Test-kind total = testing = the architecture view's `tests` column.

The component CSV adds the current runtimes and `other`; the previous combined
`legacy` column is replaced. Subset commands can be run separately, so compare
commit IDs before combining their outputs. The full build keeps them in sync.

## Measurement policy

Included code suffixes: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.svelte`,
`.css`, `.html`, `.sh`, `.py`. Supported roots are `src/`, `test/`, `tests/`,
`scripts/` and their `apps/desktop/` equivalents, plus `index.html` and executable
`*.config.*` files directly in the repository or desktop app root.

Excluded: `docs/`, `reports/`, `vendor/` submodules, assets outside those code
roots, lockfiles, JSON/data files, other apps, and this analysis tool (including
its old `scripts/plot-code-growth.py` path). A config filename in an excluded
directory cannot bypass the scope. JSON language catalogs/theme data and non-code
test inputs are excluded. Code fixtures inside test roots are counted explicitly.
Copied or generated source inside the supported roots, such as `min-places.js`,
is included; this is not a measure of originally authored code.

Architecture groups include Renderer, Main, Core, Protocol, Preload, Preview
runtime, Browser runtime, Image runtime, Image export runtime, Launcher and
shared declarations. Tests take precedence over their containing architecture;
script/config tests belong to tests rather than tooling. Former `src/shared/`
and `src/preview/` paths retain their semantic groups after the monorepo move.

Feature groups cross execution environments: workspace/documents, reading/preview,
text editing, browser, language support, notebooks, Git/review, explorer/search,
media, terminal, themes/shared UI and shared infrastructure. Classification is an
explicit **path-based approximation of responsibility**, not dependency or
complexity analysis. Known moves, such as language UI leaving `renderer/editor`
and the location bar moving into workspace, retain their feature. A real change
of execution environment may still change its architecture group.

Removed HWP support retains its own historical feature and runtime groups; its
disappearance remains visible without being confused with unclassified code.

Test fixtures and support directories take precedence over filename patterns.
`*.spec.*` and `*.integration.test.*` are E2E/integration; other `*.test.*` files
are unit/service tests. Remaining code under test roots is support, including
historical helpers that lived beside E2E specs. This classification does not run
or infer the outcome of any desktop test.

Unrecognized production paths appear as `Other / unclassified`, and the tip's
paths are listed in the JSON summary and file CSV. Review these when adding a
new execution environment or feature. The collector reuses one `git cat-file
--batch` process and caches physical line counts by blob ID.

## Commands and validation

```bash
npm test --workspace @setdown/code-growth
npm run build:total --workspace @setdown/code-growth
npm run build:components --workspace @setdown/code-growth
npm run build:features --workspace @setdown/code-growth
npm run build:tests --workspace @setdown/code-growth
npm run build:density --workspace @setdown/code-growth
```

`build:tests` draws the test-code chart; `npm test` runs the analysis tool's own
regression tests. Those tests create a temporary Git repository to check directory
moves, merge history, uncommitted-change exclusion, physical line counting,
filenames containing newlines, and CSV/audit totals. They also cover scope leaks,
current runtimes, feature moves and test-kind classification.

## Code density

The density chart measures the entire snapshot at **every first-parent commit**,
not just the lines changed by that commit. Its average is:

```text
sum of character counts in all nonblank lines / total nonblank lines
```

This weights lines equally; it does not average per-file averages. Every panel
uses the full included file population. No files are selected as representatives.

1. **Mean length:** all measured code, production source and tests/support.
   Tooling is included in the all-code average and exported separately.
2. **Distribution:** mean, median and 90th percentile across all nonblank lines.
   Percentiles pool lines across files; they are not averages of file percentiles.
   They use linear interpolation, equivalent to R type 7.
3. **Sensitivity:** compare the raw mean with the mean after stripping leading
   and trailing whitespace, and with the mean after discarding the longest
   `floor(0.01 * nonblank_lines)` lines. Groups below 100 lines are not trimmed.
   Neither control removes internal whitespace, comments or strings.
4. **Shares:** lines longer than 160 code points as a percentage of nonblank
   lines, and blank lines as a percentage of all physical lines. The denominators
   differ intentionally. Blank-line changes cannot directly change the nonblank
   mean. The 160-character threshold is descriptive, not a quality cutoff.

Characters are Unicode code points, including indentation, trailing spaces and
comments. Tabs count as one character; CR/LF line endings are excluded. Lines
whose `.strip()` is empty are excluded from the average. A final newline does
not add a phantom blank line. Empty or absent files have no average rather than
zero. Source decoding is strict UTF-8 so invalid bytes cannot silently change
the measurement. No smoothing or resampling is applied; connecting line segments
join measurements at commits. The density view intentionally uses line charts
instead of the growth views' stacked areas.

Both density PNGs are generated together from the same measurements.
`repository-code-density-by-characters.png` uses the CSV's **all-code `characters`**
as a linear X axis for every series, including production and tests/support.
This is the sum of Unicode code points in nonblank lines present at that commit,
including indentation, trailing spaces, comments and strings; it excludes CR/LF
and whitespace-only lines. It is neither cumulative additions nor bytes.
Lines retain first-parent commit order, so deletions can move left and different
snapshots can share an X coordinate. Filled dots mark the latest snapshot.
This view shows density against repository size; calendar gaps disappear.
The all-code mean is `characters / nonblank_lines`, so its numerator is also X:
an upward trend alone cannot establish that code growth causes longer lines.

The density CSV has four rows per commit (all, production, tests, tooling).
It contains raw/stripped character counts, physical/nonblank line counts, raw and
stripped means, P10/median/P90, the mean without the longest 1%, the count and
percentage of nonblank lines **strictly longer than 160 characters**, and the
blank-line percentage. JSON schema 2 records the measured tip, methodology and
first/current group values. The former selected-file series have been removed.
Changing file composition can shift an aggregate mean without reformatting any
existing file; line length alone does not measure code quality.

Readability research uses line length as one feature alongside layout and textual
features. [Scalabrino et al., *A Comprehensive Model for Code Readability*](https://sscalabrino.github.io/files/2018/JSEP2018AComprehensiveModel.pdf)
reports improved predictions when structural, visual and textual features are
combined. This chart does not implement that model or claim its validation for
this repository. It studies physical presentation; causally separating formatting,
new/deleted code, language mix and semantic complexity needs further analysis.

```bash
python3 -B apps/code-growth/code_density.py --ref main --output-dir /tmp/setdown-density
```

To measure another ref and keep the entire output set separate:

```bash
python3 -B apps/code-growth/plot-code-growth.py --all \
  --ref HEAD --output-dir /tmp/setdown-growth
```

The existing component command remains available, with optional view selection:

```bash
python3 -B apps/code-growth/plot-component-growth.py \
  --ref main --view components \
  --output /tmp/component-growth.png \
  --data-output /tmp/component-growth.csv
```
