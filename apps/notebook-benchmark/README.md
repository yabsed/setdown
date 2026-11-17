# Notebook analysis benchmark

Measures what Setdown's Python analysis marks in real notebooks: how many lines turn
red or yellow at each checking level, why, and how many of the red lines are real
problems. It exists so that a change to the analyzer, the bundled library stubs, the
IPython rules or the notebook default is decided by a measurement on public notebooks.

The benchmark reads the product's own modules from the working tree
(`product-bridge.ts`), so it measures the code as it is now, with nothing to keep in
step by hand. The first run and the policy that came out of it are in
[reports/notebook-lsp-corpus-2026-11-18](../../reports/notebook-lsp-corpus-2026-11-18/README.md).

## Run it

From the repository root:

```sh
npm run bench:notebooks -- fetch          # download the pinned notebooks
npm run bench:notebooks -- environment    # create work/venv from requirements.txt
npm run bench:notebooks -- run            # analyse: off, basic, standard, strict, analyzer
npm run bench:notebooks -- report         # the tables below, for this run
npm run bench:notebooks -- compare        # what changed since results/baseline.json
```

`run` keeps each repository's result and analyses again only what changed: the
analyzer version, the settings the product sends, the library versions, the pinned
commit or the prepared cells. An interrupted run continues where it stopped. One
analyzer process runs at a time with a 3 GiB heap limit; on Linux it is marked as the
first process to end if memory runs out. All eight configurations took about
13 minutes on the machine of the first run, with at most 1.2 GiB in the analyzer.

To analyse against another interpreter, pass `--python /path/to/python` to `run`.
`--only <regex>` limits `fetch` and `run` to matching repositories, and
`--run <name>` keeps a second set of results beside the current one.

## What is measured

| File | Holds |
| --- | --- |
| `corpus.json` | 28 public repositories, each pinned to a commit, with the notebooks sampled from it: an even spread of up to ten in path order |
| `requirements.txt` | The library versions of the analysis environment |
| `configurations.mjs` | The named configurations: the four checking levels, and variants that isolate one decision |
| `labels.json` | Lines judged by hand, used to score every configuration |
| `results/baseline.json`, `.md` | A saved run: its summary, and every diagnostic except those of `strict` |
| `work/` | Downloads, the environment and run results: about 180 MB of notebooks after a run, plus the environment. Not committed; `NOTEBOOK_BENCHMARK_WORK` moves it |

Each notebook is analysed as Setdown's notebook host presents it: code cells only,
with the host's hidden first cell, the IPython rules applied, and the analyzer
settings that the host builds for that project root and interpreter, bundled stubs
included. The analyzer is the bundled basedpyright, run from the command line with
those settings as its project file. Settings only the language server understands
are left out, and a setting the benchmark does not know stops the run.

| Configuration | Analyses |
| --- | --- |
| `off`, `basic`, `standard`, `strict` | Setdown at that checking level |
| `analyzer` | The bundled analyzer alone at `basic`: cells as written, no bundled stubs. The difference from `basic` is what Setdown adds |
| `declared` | `basic` with types taken only from declarations, never inferred from library source |
| `basic-without-sklearn-stubs` | `basic` without one bundled library's stubs |
| `basic-with-sympy-stubs` | `basic` with a candidate that is not bundled |

Notebooks are data here. Nothing in them is executed, each repository is a partial
clone with hooks and symbolic links disabled, and Python reads the corpus only
through the analyzer. Notebooks in Python 2 or another language are skipped and
counted.

## Read the result

A place is one source line of one cell; several diagnostics on a line count as one
red or yellow line. `report` prints three tables: lines and diagnostics for each
configuration, red and yellow lines by cause (syntax, undefined name, unresolved
import, type), and the judged lines each configuration still marks red.

`labels.json` holds the verdict on 78 lines marked red for a type reason, drawn at
random from `basic-without-sklearn-stubs`, which was the basic level when they were
judged. The verdict is about the line, so it scores any configuration; `cause` says
why that configuration marked it. The verdicts:

- **real**: the line fails when the notebook runs in the analysed environment.
- **hazard**: the line runs here, and the report names a way it can fail.
- **false**: the line runs and the report describes nothing that can go wrong.

"Real share of marked" is the share of real problems among the judged lines a
configuration marks red. It says how much a red line can be trusted, for the type
category only. Each label records its source line; after a corpus change, `run`
names the labels whose line is no longer there and leaves them out of the scores.

Results depend on the environment. `run` records the version of every library the
notebooks import and the imported modules that are absent, and `compare` says when
those differ from the baseline.

## After a change

1. `npm run bench:notebooks -- run`, then `compare`. It lists, for each
   configuration, the red lines that are gone and those that are new, grouped by
   kind of report with an example of each, and how the judged lines moved.
2. Look at the new red lines: `groups basic` lists every kind of report by
   frequency, and `sample basic --count 20 --seed 3` prints random marked lines
   with their source.
3. When the change is accepted, `save` replaces the baseline. Commit it with the
   change.

To judge more lines, draw a sample, read each line against the notebook and the
installed library, and add `{ notebook, cell, line, verdict, cause, source }` to
`labels.json`; `sample` prints the first three fields ready to copy, and `source`
is the line's text without surrounding spaces.

To add a repository, add `{ "repo": "owner/name" }` to `corpus.json` and run
`fetch`: it pins the current commit and samples the notebooks. `fetch --repin`
does that for every repository, which makes a new corpus: judge the labels again
and save a new baseline.

`npm test --workspace @setdown/notebook-benchmark` checks the counting, the
comparison, the sampling and that the label set matches the corpus.
