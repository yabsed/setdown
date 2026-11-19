# Language tool benchmark

Opens files of real open-source projects in every supported language and records
what the language's tool answers: whether it starts, whether it leaves the
project's own code unmarked, whether it marks a mistake, and what it returns for
hover, completion and go to definition. It exists so that "Setdown supports this
language" is a measurement on this machine, and so that a change to the supported
list, to a tool's settings or to how a tool is prepared is checked against real
tools on real code.

The projects are real because the failures are: a tool that answers well for a
ten-line file can still mark every import of a project as unknown, lead nowhere
from a call into a library, or never read the build. Those show only where there
are several files, libraries and a build.

The benchmark reads the product's own language manager from the working tree
(`product-bridge.ts`). A file is opened through the same channels a Setdown
window uses, so the product decides which tool starts, where its program comes
from, what it is told and when it is downloaded. Only Electron is replaced
(`electron-stub.ts`): the manager needs a settings folder and channels to answer
on, and no window.

## Run it

From the repository root, after the desktop app's main process has been built
once (`npm run build:electron --workspace @setdown/desktop`, or `npm run dev`):

```sh
npm run bench:lsp -- fetch             # fetch the projects and install their libraries
npm run bench:lsp -- run --fresh       # every language, starting with no tool installed
npm run bench:lsp -- run               # again, with the tools prepared by the last run
npm run bench:lsp -- run --only 'rust|go'
npm run bench:lsp -- run --only dockercompose --tool docker-language-server
npm run bench:lsp -- report            # the table of the last run
```

`run` fetches what is missing, prints the table, writes it to
`results/latest.md` with the full answers in `results/latest.json`, and exits
with 1 when an expectation was not met. `--run <name>` keeps a second result
beside `latest`.

`--tool <id>` chooses another tool for the selected cases' languages, the way a
person chooses it in Language Support, and takes the choice back afterwards. It
compares two tools on the same files; the supported list was decided this way
for Docker Compose and Kotlin.

`--program <file>` goes with `--tool` and names that tool's program file, as
**Choose program…** does, for a tool that is already on this computer somewhere
Setdown does not look.

`--fresh` empties the benchmark's own profile first. Every tool is then prepared
the way a first file open prepares it, which needs the network and takes some
minutes: Setdown downloads about 1 GB of tools and runtimes into `work/profile`.
Without `--fresh` the tools of the previous run are reused, as they are on a
person's computer. The benchmark never reads or writes the profile of an
installed Setdown. `LSP_BENCHMARK_WORK` moves `work/`, which must stay inside the
repository so that the bundled tools are found in its `node_modules`.

One tool runs at a time.

## The projects

`projects.mjs` names each project by repository and commit; `work/sources` holds
the checkouts. A project's `setup` is what a person does once before working on
it, and nothing more: `npm install`, a virtual environment with the project
installed into it, `go mod download`, `cargo fetch`, a CMake configuration that
writes `compile_commands.json`. These need the toolchains on this computer: Node,
uv, Go, Cargo, CMake and a C++ compiler, and a JDK for the Kotlin project,
whose tool runs the build itself. Libraries go where each
toolchain keeps them (`~/.cargo`, the Go module cache, `~/.gradle`, `~/.m2`).

PHP has no setup: this computer has no Composer, and the PHP case asks only about
the project's own files.

## What is measured

| File | Holds |
| --- | --- |
| `projects.mjs` | The projects, each at one commit, with their setup |
| `cases.mjs` | Per file, what a person working on it expects: the places to ask about and the answers |
| `results/latest.json`, `.md` | The last run |
| `work/` | The benchmark's profile, the projects and the built product bundle. Not committed |

A place in a file is named by the text found there. `test/checks.test.mjs` fails
when a case names text that its file does not contain.

| Column | Meaning |
| --- | --- |
| Starts | The tool Setdown names for the language started. The time includes a download when one happened |
| No false errors | No line of the project's own file is marked as an error. Warnings are the project's business |
| Marks a mistake | One wrong line is added at the end of the file, in memory, as if just typed. A diagnostic covers it |
| Hover | Hovering a name returns its description: one name from a library, one from the project |
| Completion | Behind the first letters of a member that the code uses, that member is offered |
| Go to definition | A name leads to the file that declares it: another file of the project, or a library |
| Fades left-out code | C and C++: a line inside an `#if` that does not hold for this build is reported as left out, so the editor shows it faded |

"No false errors" is "unknown" when the tool reported nothing at all, the added
mistake included: a silent tool has not found the code correct. Where a tool
disagrees with the project's own checker in every editor, the case says so in
`accept` with the line and the reason; the table still shows it under the case's
answers.

A tool answers "nothing yet" while it reads a project. Each question is asked
again once a second until the answer is the expected one or the case's patience
runs out (60 seconds; more where a tool reads a build first); the table shows
how long the expected answer took. An answer in another language (basedpyright
and Pyright follow the system locale) still counts: diagnostics are matched by
line.

A tool may ask the person something before it reads a project (the Kotlin tool
asks whether to use Gradle or Maven when a project has both). Setdown shows the
question in the document's panel; a case's `answer` says what a person working
on that project replies, and the run records every question, answered or not.

The Kotlin tool is a Java program that also starts the project's build: together
about 3 to 4 GiB of memory. On a small machine run it alone, inside a
memory limit (`systemd-run --user --scope -p MemoryMax=4500M -p MemorySwapMax=0 -- npm run bench:lsp -- run --only kotlin`),
so that a tool that outgrows the machine ends the run and nothing else.

Code that the tool does not compile on this platform (`#ifdef _WIN32`,
`#[cfg(windows)]`) has no answers; a case must ask outside it.

## Adding a language

Add the language to `supportedLanguages` in the desktop app, a project to
`projects.mjs` and a case to `cases.mjs`. A case whose tool is not the one the
supported list names is reported as a failure. To decide between two tools, run
the case once per tool with `--tool` and compare.
