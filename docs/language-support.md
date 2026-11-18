# Language support

Use the language button in a code document’s location bar to choose its project
environment, inspect checks and repair its analysis service.

Open **Language Support** in the left activity bar, directly below Browser.
**Edit → Language Support…** opens the same app settings. The editor’s Language Support
command inspects the owning code tab; surfaces without a code-language control
fall back to app settings.
It stays beside the document; opening it does not cover or freeze a live web page.
The Setdown button continues to toggle Folder Tools.

The home screen is ordered by what a person asks, not by where a setting is stored:

- **Set up language tools automatically** is the app's download policy. Under it
  is the list of supported languages.
- **Needs attention** lists a tool whose session ended, under the name of its
  language, with the same sentence the document shows. **Fix ›** opens that tool
  with the same repair. The section is absent when nothing is wrong.
- **Ready** lists the languages that have a tool Setdown ships, has already
  prepared, or is running now. A language opens its own page.
- **All languages…** searches every recognized language and sets a language's
  default tool.
- **Advanced** is one list of tools, where a person names a tool's program
  themselves or changes its connection settings.

## Supported languages and other languages

Setdown answers for a fixed list of languages, kept in
`src/core/document/supported-languages.ts`: Python, JavaScript and TypeScript,
Svelte, C and C++, Rust, Go, PHP, Kotlin, JSON, YAML, Dockerfile, Docker Compose,
CSS and HTML. Each names the one tool that serves it. Opening a file of a
supported language starts that tool and, when downloads are on, downloads it the
first time without a question. `apps/lsp-benchmark` opens files of real projects
in each of these languages through the same code and records what the tool
answers; a tool is put on the list, or replaced, on that evidence. Docker Compose
is served by the YAML tool for that reason: on a real Compose file it was the one
of three tools that marked a wrong key.

A file kind that is not on the list but is read by a supported tool starts that
tool: a GitHub workflow file is checked by the YAML tool, without a question,
before the dedicated GitHub Actions tool that would first ask to be installed. A
person can still choose the dedicated tool.

Kotlin is served by JetBrains' own tool (`kotlin-lsp`). The community tool
(`kotlin-language-server`) reads a Gradle build inside its start-up, which
outlasts the time Setdown gives a tool to start, and its built-in compiler does
not read libraries built with Kotlin 2.3. The JetBrains tool is 370 MB, brings
its own Java and takes about 3 GiB of memory with a Gradle project open. When a
project has both a Gradle and a Maven build it asks which one to use; the
question appears in the document's panel and nothing is analysed before it is
answered.

An installation may take up to thirty minutes before Setdown gives it up. The
limit is there for an installer that has stopped, not for a slow connection.

Java is not on the list. Its tool installs through an extension that needs a
newer Java than most projects build with and a download that did not finish on
the measuring machine; it was never seen answering on a real project. It works
like every other tool once a person asks for it.

Two supported tools are told more than their catalog entry says
(`scripts/language-profiles/overrides.json`, `settings`). The JSON tool is given
the schema address of well-known files (`package.json`, `tsconfig.json`,
`jsconfig.json`, Babel, ESLint and Prettier configuration), so that such a file
has descriptions, allowed keys and schema errors. The tool downloads a schema
from schemastore.org the first time a matching file is opened; the YAML tool does
the same for the files it recognizes. The HTML tool is given style-sheet settings,
without which it reports nothing for a page's `<style>`.

Every other tool in the imported catalogs works the same way once a person asks
for it, and is not downloaded before that. Its file shows the neutral status
**Not installed** with one sentence and one button, **Install … support**. Saying
yes is the whole installation: the choice is saved for that tool and the file
connects. Selecting the tool as a language's default, or for a project, is also
asking for it. A tool that Setdown installed once stays in use everywhere. A
program that is already on the computer runs without a question, because nothing
is downloaded.

A supported language whose tool a person turned off has no stand-in: an extension
that merely lists the same language is neither started in its place nor offered
as that language's support. It runs when it is already installed or when the
person selects it.

Opening home or the language list performs no executable scan, installation or
server launch. Ready is read from shipped tools and from the receipts Setdown
wrote when it prepared a tool. No open project or document is needed. An explicit
choice is authoritative even if that executable is unavailable. If no default
distinguishes several primary tools, the language's own order decides and the
tool starts; nobody is asked to choose between programs.

The language list shows languages that have a usable tool or an explicit choice.
A search reaches every language.

A language's page chooses Automatic, a primary tool, or no project analysis. A
project's explicit choice takes precedence; **Use app default** restores inheritance.
Changing the app default keeps unaffected project sessions running. Existing
per-server preferences, explicit disabled states, executable paths and custom IDs
remain in the existing settings file. Restoring inheritance does not delete
arguments or options shared by another language.

## The tool list

**Advanced** opens one searchable list. Without a search it holds what this
person has: **Needs attention**, **Your connections** (imported), and **Set up**
(shipped, prepared, chosen by hand or running now). A search adds **Other tools**,
every other tool that has a connection profile. A catalog entry without a profile
cannot run and is not listed. The list reads settings and receipts; it does not
look for programs on the computer.

Each row has one status that says how the tool gets onto the computer:
**Included**, **Installed**, **Installs when needed**, **Asks before installing**,
**Downloads off**, **Install it yourself**, **Your program**, **Your connection**,
**Found on this computer** or **Program not found**. Language logos use named SVG
exports from the already installed Simple Icons package, pinned to 9.21.0 as a
direct dependency. Logos adapt contrast to light/dark themes; languages without
a matching logo use a short language label. No remote image requests are needed.

A tool's own page is the only place that looks its program up, and only for that
tool. It shows the program in use and these actions: **Choose program…**,
**Use automatic setup** (after a program was chosen by hand), **Install** (for a
tool that asks first), **Enable/Disable by default**, **Connection settings**
(arguments and options), and **Remove connection** for an imported one. Runtime
state, restart, project settings and output belong to the document's inspection.
Escape clears a search, moves back one step, then closes the sidebar and restores
its activity button.

**Check again for installed tools**, in the header of the list and of a tool's
page, forgets what was looked up and reconnects open documents whose tool was
missing. **Import a connection (JSON)…** adds a tool Setdown does not know.

The list's compact view title, icon actions, search field, counted sections and
row hierarchy follow [VS Code's view guidance](https://code.visualstudio.com/api/ux-guidelines/views)
and its vendored `extensionsViewlet.ts` / `media/extensionsViewlet.css`. Setdown
retains its own theme tokens and sidebar layout; the screen is not a marketplace.

The [discovery design](../reports/2026_10_16_00_09_lsp_discovery_and_connection_design.md)
explains the architecture and follow-up work. The
[global settings design](language-support-global-settings-design.ko.md) explains
why detection moved out of the ordinary workflow after the Zed integration.

The automatic-download switch is a default; explicit tool/project download
settings override it. With the switch off nothing is downloaded and nothing is
offered. Bundled and external executables and validated managed launch receipts
remain usable with downloads off. Native Zed adapters can still check an external
tool in an isolated host with HTTP and Node downloads disabled. WASI extensions
own their installers and may invoke package managers; without download permission
the extension is not loaded, and Setdown looks for the tool's program by name
instead. A receipt is specific to its project inputs and launch settings: a new
project or changed manifest may require preparation even if the same tool was
prepared elsewhere. Setdown reports that condition without starting an installer
or silently downloading. This switch controls analysis tools; it does not control
syntax grammar package loading.

## Current file support

The language button belongs to the document view in its editor group. Healthy
project analysis shows only a neutral language name. Six other statuses exist:
**Setting up…** (Setdown is fetching a tool), **Reconnecting…**, **Needs setup**,
**Not working**, **Limited** (part of the support works) and **Needs answer**.
Each adds an indicator and an accessible status; narrow groups retain the
indicator even when the text is hidden. An ordinary start, local checks only and
a language without a project analyzer show no text. The label never certifies
that the document or project has been fully checked.

The first step is titled with the language. When something is wrong it states
one sentence naming what the person lost ("Java support can't start."), the one
action that addresses the cause, and at most one secondary action. The action
follows the cause, not the state:

| Cause | Sentence | Action | Secondary |
| --- | --- | --- | --- |
| Setdown is fetching the tool | Setting up Java support… | none | none |
| A download or installer failed | Couldn't download Java support. | Try again | none |
| Downloads are off | Java support isn't installed. | Install Java support | none |
| The tool is outside the supported languages and was not asked for | Zig support isn't installed. | Install Zig support | none |
| Setdown has no installer for it | Java support isn't installed. | How to install ↗ | I already have it… |
| The chosen program does not start as a language tool | Java support can't start. | Use automatic setup | Show log |
| The chosen program no longer exists | Java support can't start. | Use automatic setup | Choose program… |
| A runtime is missing or too old | Java support needs Java 21 or newer. | How to install ↗ | Show log |
| It never answered, cause unknown | Java support can't start. | Show log | Try again |
| It worked, then stopped | Java support stopped unexpectedly. | Restart | Show log |

**Restart** is offered only for a tool that had been working. A repair runs in
the status itself: **Use automatic setup** clears the chosen program,
**Install …** allows downloads for that tool, **I already have it…** opens a file
chooser, and each reconnects the document. Help links open only addresses from
the shipped catalog. When another tool still serves the document, the sentence
names the tool instead of the language and adds that the other still works.

A healthy document shows **✓ Working**. Below either form are the language row
and, for a language with one, its environment row. A required environment choice
takes precedence over restarting a process that stopped or failed for an unknown
reason, and brings the project row with it. A tool that cannot start at all (a
chosen program that is not a language tool, a missing runtime, a failed download)
comes before the environment: no environment choice can start it.
Local-check failures and supplementary-provider failures remain visible
independently of the primary provider.

**More…** stays in the same editor group. It adds one block per tool attached
to the file: the tool's name and state, what it last reported, and **Restart**
and **Show log** for that tool. **Problems** is below them. Selecting a tool's
name opens its own step: results, capabilities, recovery, messages,
**Choose analysis tool…** (the project's choice between primary tools) and
**Project connection settings…**. The project folder, the file's path and where a
choice is stored are not listed; the environment row and the tool's step say
which project a choice applies to. Project connection settings and output are
separate steps; a log returns to the step it was opened from. Longer inspection
stays open while another editor group receives focus, and is bounded by its
own group. Quick selection steps close on an outside click. Tab replacement,
closing, path retargeting or language changes retire the old inspection; a
closed-document placeholder never occupies the global catalog. Escape returns
one step, then closes and restores the language button; composition is guarded.

The language chooser applies to the shared open document, not global file
associations; Auto-detect restores association detection. It preserves the model,
unsaved content and Undo. Environment/provider choices and advanced project
settings apply to the displayed analysis root, including other tabs/windows
using it. The UI states that scope. Each operation captures the document
incarnation and root; late responses cannot update a replacement document or
retarget an in-progress choice. Connection-setting edits retain their original
options instead of following live catalog refreshes.

The left **Language Support** sidebar owns app defaults, the tool list and
import. It has no current-file mode; **Needs attention** reports tools, not the
document in front. The document's inspection does not link into it: a repair is
offered where the fault is shown. **Disable by default** is distinct from a document’s
project analysis selection. Closing all code tabs leaves the catalog usable.

Disabling or uninstalling a server does not remove language associations or
grammars. Unknown languages open as plain text and can be assigned a mode.
Notebook execution continues to use its own environment/kernel controls. The
ordinary code location control is not unconditionally added to Markdown readers,
Git snapshots, notebooks or browser tabs.

This separation follows the pinned GNOME Builder revision
`0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718`: `gbp-editorui-workspace-addin.c` binds
the syntax menu to the buffer; `ide-application-tweaks.c` owns global plugin
toggles; the build omnibar and `ide-lsp-service.c` connect project tooling and
process launch. It is an adaptation of those responsibility boundaries, not a
claim to have ported GTK or Builder’s project model. The corrected
[design review](../reports/2026_11_01_gnome_builder_lsp_ui_review.md#후속-검토-화면의-위치보다-소유권을-먼저-정한다)
records the product reasoning and concrete failure cases.

No applicable primary server is a supported editing state. Make shows syntax and
editing support without a Python environment or an instruction to enable project
analysis. Disabled supplementary profiles do not establish that project analysis
was explicitly turned off. Built-in JSON validates syntax
and available schemas; CSS/SCSS/Less validate syntax and configured lint knowledge;
HTML supplies completion, hover and formatting without a diagnostic adapter.
JS/TS's isolated worker supplies syntax checks only. It has no filesystem/project
model and therefore does not publish missing-import or type errors. Saved JS/TS
files use the bundled project server when enabled. No diagnostic code blacklist
is applied to project servers: genuine missing imports and type errors remain.

JSONC files, TypeScript/JavaScript configuration files, VS Code workspace files
and supported `.vscode/*.json` settings accept comments and trailing commas.
Ordinary JSON stays strict. JSON Lines validates each line independently; a
generic JSON language server is not connected to it unless its profile declares
the JSON Lines language. These dialect choices follow the current resource even
after Save As, while preserving the live model and Undo.

JSON schema resolution failure (the JSON service's known code 768) appears as a
service issue, separately from syntax and schema-violation diagnostics. The local
worker has no filesystem schema resolver. Use an applicable project server for
filesystem-backed schemas; syntax checks remain available meanwhile. CSS custom
properties/dialects depend on the selected service's configuration; unknown-property
warnings are not blindly removed. Built-in parser settings and external tool
settings are distinct; the server configuration form configures that server.

Servers may register capabilities after initialization. Setdown applies the
registrations it uses, accepts `workspace/didChangeConfiguration` (settings are
pulled through `workspace/configuration`, and a settings change reconnects the
session), and acknowledges any other method without effect, recording it in the
service output. It does not answer with an error: many Node servers, including
`dockerfile-language-server`, exit on a rejected registration, and Zed, whose
adapters install and launch these servers, acknowledges them the same way.

A shared diagnostic store supplies both editor markers and Problems, including
built-in checks. Contributions are scoped to provider, document, session and
push/pull channel. Configuration changes restart affected sessions. Edits clear
previous live results; late versioned replies and disposed sessions cannot
republish. Versionless push is explicitly best-effort, never assigned a fabricated
analysis version. An empty Problems list means no diagnostics were reported, not
that every possible check ran successfully.

## Syntax colors without a server

Svelte files now have local TextMate syntax highlighting through Shiki. Opening
`.svelte` automatically colors tags, attributes, template blocks, expressions,
JavaScript/TypeScript inside `<script>`, and CSS inside `<style>`, including Svelte
5 rune expressions. No language server, project installation or setting is needed
for these colors. The optional Svelte language server still supplies diagnostics,
completion, navigation and semantic tokens; semantic colors overlay lexical colors.

The shared language catalog supplies file associations, editing defaults and
grammar identities to `renderer/language/syntax-runtime.ts`. Its 260 local
TextMate grammars load on demand. Where Monaco also ships a tokenizer for a
language, the catalog grammar takes precedence: Monaco's built-in tokenizers for
shell, Dockerfile, YAML, C/C++, Rust, Go and about fifty other languages are
coarse fallbacks (its shell tokenizer leaves commands, options and expansions in
the plain text color), while the bundled grammars are the ones VS Code uses.
Monaco keeps lexical ownership only for Markdown, Python, JavaScript/TypeScript,
JSON, CSS/SCSS/Less and HTML, whose built-in workers, embedded modes or
engine-free loading depend on it (`monacoLexicalLanguages` in
`renderer/language/syntax-runtime.ts`). Monaco's registration, brackets and
comment configuration for a built-in language are unchanged, and its tokenizer
remains the fallback if a grammar cannot be loaded. YAML dialects
can share the YAML grammar while keeping separate analyzer identities. Compatible
runtime packages can add a Tree-sitter WASM grammar through the Zed host without
an application rebuild. An arbitrary LSP connection alone does not supply syntax
grammar metadata. Additional preprocessors such as Pug and SCSS inside Svelte
need their own embedded grammars.

The TextMate engine, Oniguruma WASM and local grammars are bundled assets, loaded
when a matching language needs them. Opening only Markdown or Python does not
load them. All nine app
themes supply corresponding TextMate colors, including the pinned VS Code Dark
2026 rules. Namespaced token rules preserve existing Monaco and LSP colors.
Ordinary editors, split groups and both Git comparison models share the same
provider; changing the theme retokenizes without replacing document models or
their Undo histories. The upstream adapter's 20,000-character line cutoff and
500 ms soft tokenization time budget limit lexical work; a skipped oversized
line keeps its incoming grammar state and can temporarily affect following colors.

Implementation and execution evidence: [Svelte syntax highlighting validation](validation/2026-10-30-svelte-syntax-highlighting.md)
and [language package platform validation](../reports/zed-language-platform-implementation-2026-11-10/README.md).

## Project environments and recovery

The current file’s language button includes its applicable project environment.
Select Python, the TypeScript SDK, or a C/C++ build configuration here. **Manage
analysis tools…** opens the corresponding app language defaults. The current-file
chooser manages project overrides and shows whether the selection comes from the
app default or this project. The choice is stored for the
analysis root shown in the panel, independently of other projects. **Basic editing**
disables that project’s matching providers while preserving syntax colors and local
checks. Re-enable its primary provider from the same chooser.

- **Python:** project `.venv`/`venv`, host, Conda metadata and registered Python
  kernels are offered without executing the discovered candidates. A project
  interpreter is selected automatically when the nearest `.venv`/`venv` is unique,
  or explicitly when ambiguous, and passed to the analyzer as `python.pythonPath`.
  The bundled language server and the project interpreter are separate choices.
  Ordinary files and notebooks share the project default; a saved notebook-specific
  choice wins. A stopped notebook refreshes its default when the project changes.
  An already running kernel retains its environment and variables and explains
  how to switch deliberately. Native Pyright configuration and
  `executionEnvironments` continue to be interpreted by the server.
- **Python type checking:** files and notebooks use `basic` by default. The project
  control offers Basic, Standard, Strict and Off without JSON editing. An explicit
  project choice wins over connection settings and compatible `.vscode` workspace
  settings; native Pyright project configuration remains server-owned and may
  override client policy. The UI shows the source and this distinction. Changing
  checking does not restart notebook kernels. Missing imports and type mismatches
  retain the server's severity; no blanket suppression is applied.
- **TypeScript:** a project that installs TypeScript is analysed with its own SDK,
  so diagnostics match the project's `tsc`. `node_modules/typescript/lib/tsserver.js`
  is looked up from the analysis root through its ancestors to the repository
  boundary, reading metadata only, and the nearest one is used without a choice.
  Without one the bundled SDK is used; that includes TypeScript 7, which ships no
  `tsserver.js`. A `tsserver.path` in the connection's initialization options wins
  over discovery. An explicit project choice, including **Bundled TypeScript**, wins
  over both, and **Remove project override** returns to the automatic choice.
  The selected `tsserver.js` is passed in initialization options and runs as the
  analysis process. The server’s own version/source report is shown under service
  details.
  The installed application carries TypeScript's standard library (`lib.*.d.ts`)
  beside the bundled `tsserver.js`. electron-builder leaves declaration files out
  of `node_modules`; without them every built-in type (`Array`, `Promise`,
  `console`) is reported as an error, and only in a packaged build.
  `scripts/package-typescript-sdk.mjs` keeps them and fails packaging when one is
  missing.
- **C/C++:** root, `build`, `builddir`, `out/build`, and literal local CMake preset
  directories are checked for `compile_commands.json`. A unique database is used
  automatically; several build configurations require a choice. **Choose build
  folder…** supports an external build directory. The selected directory is passed
  in the actual clangd `--compile-commands-dir` argument. Existing `.clangd` and
  `compile_flags.txt` remain server-owned configuration.
- **Configure project:** projects containing `CMakeLists.txt` or `meson.build`
  offer an explicit configure action. It runs installed CMake/Meson with fixed
  argument arrays in an app-owned build cache under the user-data directory,
  then selects the resulting database. It never runs on file opening. Output,
  cancellation, missing tools and failures appear in the panel. Configuration is
  limited to two minutes, output to 64 KiB. Generating headers or installing
  dependencies can still require the project’s normal build workflow.
- **Rust/Go:** the same context service records the existing Cargo/Go/toolchain
  configuration files and reconnects when these inputs change. The native server
  continues to resolve the actual toolchain and dependency graph.

A missing explicitly selected environment remains visible as missing; the app does
not substitute a different choice. **Remove project override** removes only the project environment override. The
chooser previews the inherited choice and its source, including any existing
connection configuration or missing fallback.
New selections are saved in `project-analysis.json`; legacy `language-servers.json`
settings and per-notebook `notebook-python.json` choices remain intact. Project
provider/disabled preferences extend the existing language settings format.

The same analysis plan supplies the launch configuration and the displayed
selection evidence. Known configuration files and selected external paths are
watched; reconnecting keeps the live Monaco model, unsaved contents, Undo/Redo,
provider ownership and document-version checks. **Restart [tool]**
restarts that tool’s session serving the current file in this window, including
other files sharing that session. Other languages and other windows continue running. Changing a saved project preference reconnects
matching sessions for that root across subscribed windows.

An unexpected server exit schedules reconnects after 1, 3 and 5 seconds, at most
three attempts in a minute for each window/provider/root. A subsequent failure
leaves the cause's sentence and its action. A session that ends is classified
from what it recorded: whether it had answered `initialize`, its exit and its
error output. Two causes repeat identically and are not retried: a program the
person chose that ends before answering, and a runtime the tool itself reports
as missing or too old. Their repair is a change of setup, so the status offers
that instead of another attempt. Recovery resends current
open buffers; it never replays editor commands or workspace edits. Requests from a
server that offer choices appear in the status panel without a modal or focus
change. Actions are bound to their original session and expire on shutdown or
after two minutes.

Connection, environment readiness, work progress and received analysis results
are distinct. **Results received for this open file** describes actual observations,
not completion of project indexing. Edits alone do not imply reported work progress.
Stale results, versionless results, pending checks and no active checks remain distinct. Diagnostics retain their original payload,
provider, channel, epoch, version and environment context. File and notebook-cell
URIs share the diagnostic store; cell diagnostics survive editor virtualization
and inactive tabs. Problems opens their notebook and cell; quick fixes still receive
that provider’s original diagnostics. Missing-import and other code diagnostics
are not hidden to make the editor look successful.

The architecture follows the context, tooling, service and provider boundaries in
[the pinned GNOME Builder source](../vendor/gnome-builder/src/libide/lsp/ide-lsp-service.c).
The [source analysis](../reports/2026_10_30_gnome_builder_lsp_porting_report.md)
explains the correspondence and retained Setdown guarantees.

## Choosing a server

The offline catalog combines 331 [Mason Registry](https://github.com/mason-org/mason-registry)
packages, pinned [Helix definitions](https://docs.helix-editor.com/languages.html)
and 581 published [Zed extension packages](https://zed.dev/extensions). The initial
snapshot has **749 catalog entries and 560 connection profiles**. File recognition
uses a separate catalog of 805 language definitions, including aliases and
dialects; grammar availability does not depend on whether a server is installed.
A profile is an association/launch recipe, not a claim that every server feature
has been integration-tested.

Open a matching saved file. For a server supported by Zed, its actual adapter owns
external executable selection, language-specific validation and managed preparation.
Setdown's global metadata scan cannot bypass that adapter. A project-local external
tool is considered again before reusing a managed command. Bundled services and
explicit custom executables keep their existing launch contracts. Profiles without
a Zed adapter retain a compatibility path for external executables and pinned npm
packages. The actual Zed host supplies its managed
Node runtime when needed. Its script path and transport arguments are preserved;
explicit user arguments are appended to the adapter command. Preparation runs asynchronously and connects the latest
unsaved text when ready. **Connection settings → Server installation → Use
installed servers only** disables automatic preparation for that connection.
Explicitly disabled providers stay disabled.

The package index refreshes in the background. Compatible new published languages
can add file associations, syntax and server adapters without changing Setdown's
application code. Cached packages and launch commands are reused across runs.
First use of an uncached package requires a download; language-specific project
SDK requirements still follow the upstream adapter or extension.

Profiled servers know their command, arguments, language IDs, file associations
and root markers:

- **Pyright** remains bundled and enabled for Python.
- **TypeScript Language Server** and TypeScript 5.9.3 are included for saved JS/TS/JSX/TSX files. Automatic typings acquisition is disabled; project configuration and installed dependencies determine analysis.
- **clangd**, **rust-analyzer**, **gopls** and **fortls** retain their existing
  identities and settings. `pip install fortls` followed by opening `.f90` needs
  no connection form; uppercase and other Fortran suffixes remain supported.
- Imported profiles cover TypeScript/JavaScript, Bash, Lua, YAML, JSON, Dockerfile,
  CMake and many others. Names such as `Dockerfile`, `CMakeLists.txt` and `go.mod`,
  path globs, compound suffixes and JSX/TSX language IDs are included.
- The declared primary server connects or prepares automatically. Several
  installed alternatives do not override a declared default. Without a declared
  default, the language's own server order decides. An explicit selection stays selected
  even if its executable disappears. Bundled Python and TypeScript services take precedence
  until the user chooses another primary server for those languages. Healthy sessions stay on their
  original server when new installations are discovered.
- Optional writing/diagnostic providers remain disabled by default. Ruff, Biome
  and other supplementary profiles can run beside the primary service. They
  retain separate diagnostic/code-action ownership and do not replace the primary
  rename or semantic-token provider. Connection settings select their role and
  formatting participation independently. Runtime-only profiles such as R/Julia explain the package that must
  be installed before enabling them. TCP bridges and download-capable launcher
  recipes are excluded from generated connections.
- A Zed extension names its server with an identifier such as `java`, `cmake` or
  `gem`. That identifier is not a program name and is never looked up on PATH:
  the JVM is not a Java language server. The extension's adapter resolves and
  prepares the real tool. A program chosen explicitly with **Choose program…**
  is still used as chosen.
- A tool may need a newer runtime than the project it analyzes. eclipse.jdt.ls
  states its minimum Java in its launcher. When the default JDK is older, Setdown
  starts the tool on the closest installed JDK that satisfies it, found in the
  known directories of system packages and version managers without executing
  any candidate, and passes the project's own JDK as its default runtime. With no
  suitable JDK the status says which Java is needed and which was found.
- A catalog entry without a connection profile cannot run and is not listed.
  **Import a connection (JSON)…** adds a tool with its language ID, extensions
  and stdio arguments; imported custom connections initially stay disabled.

Automatic preparation uses Zed's actual installers/extensions and supported npm
package metadata; it does not execute arbitrary Mason installation recipes.
Custom connections retain explicit executable selection. Stdio servers start
with argument arrays and `shell: false`. Native executable scripts on Unix work through their normal
interpreter. npm package `bin` metadata can also resolve an installed Node runtime
and script directly, including on Windows without running `.cmd`/`.bat` wrappers.
Custom connections can still select Node and put the server script in `args`.

A tool's page exposes the program in use; document tool details expose the analysis root, negotiated features
and startup/crash errors (including available stderr). Finding an executable does
not prove that its runtime or project is healthy; **Connected** means LSP
initialization completed, not that analysis completed.
A runtime proxy such as rustup can exist even when its server component is missing.

## Sharing Zed language-server settings

Setdown reads `lsp.<server>.settings` and `lsp.<server>.initialization_options`
from Zed's user settings and enclosing `.zed/settings.json` files. On Linux, the
user settings are `${XDG_CONFIG_HOME:-~/.config}/zed/settings.json`;
`~/.zed/settings.json` is also accepted. On Windows the Zed user directory is
`%APPDATA%/Zed`. JSONC comments and trailing commas are supported.

For a workspace opened at `chess`, `chess/.zed/settings.json` applies to
`chess/infra/backend/template.yaml` and other nested files:

```json
{
  "lsp": {
    "yaml-language-server": {
      "settings": {
        "yaml": {
          "customTags": ["!Sub scalar", "!Sub sequence"]
        }
      }
    }
  }
}
```

More specific folders override ancestors. Objects merge recursively; arrays
replace inherited arrays. Explicit Setdown connection settings have final
precedence. Saving a valid settings change reconnects affected services with the
current unsaved text, keeping focus and Undo. A temporarily malformed settings
file retains the last valid settings until it is fixed.

This example declares the two `!Sub` forms. It does not disable validation or
declare other custom tags such as `!Ref` and `!GetAtt`.

## Finding an installation

A tool's program is looked for in one order: the program a person chose, the
project's environment (its shell PATH, then the known user locations below), and
last Setdown's own prepared copy. There is no list of everything installed on the
computer and no step where a person picks between programs.

If you install a server while Setdown is running, open **Edit → Language Support…**,
**Advanced**, and click **Check again for installed tools**. Open documents with unavailable or failed
connections retry using their latest unsaved text. Healthy connections keep their
processes, and explicitly disabled servers stay disabled. Additional documents in
the same live workspace reuse its session; a newly detected path takes effect on
a new session or explicit restart. Newly opened documents
also recheck after the short discovery cache expires.

Discovery first honors a manually selected executable, including the legacy clangd
selection. An explicit path that disappears reports an error; it does not silently
switch versions. **Use automatic setup** clears that path choice without
changing enablement or server options. **Choose program…** names a program again.

The lookup by name uses the selected environment's absolute PATH directories in
order, then known user locations such as `~/.local/bin`, Cargo's bin directory,
GOBIN/GOPATH and configured pipx/uv bin directories. For profiles/catalog packages distributed through Python, it can query the
selected interpreter's scripts and user-scripts directories. npm packages use
known global directories and `package.json` bin mappings. On a document connection
or Rescan, a shared `npm root --global` metadata query can locate a custom prefix;
it runs the installed npm CLI through Node with fixed arguments and no scripts.
Multiple PATH matches follow PATH order, and among the known user locations the
first in the order above is used; a person who wants another copy names its path
with **Choose program…**. No home-directory crawl or server `--version` sweep occurs.

For Zed-supported automatic connections, project shell capture uses the vendored
Zed `util::shell_env::capture`, including its quoting, shell hooks and `--printenv`
callback. The returned environment is scoped to the analysis root and passed to
both the adapter and the server. Explicit inherited environments (activated venv,
Conda or `SETDOWN_LSP_INHERIT_ENV=1`) remain authoritative. Refresh invalidates the
project environment cache. A project shell failure is surfaced rather than silently
selecting a different project's environment.

For the lookup by name, a native connection or **Check again for installed tools**
can read the user's shell environment asynchronously. Shell queries have a
five-second timeout; Python/npm metadata queries have a three-second timeout, with a
1 MiB combined output limit and process cleanup on cancellation. Activated venv
and Conda environments retain the inherited environment. Advanced launchers can
set `SETDOWN_LSP_INHERIT_ENV=1` to preserve their environment without a shell query.
Windows uses its inherited environment, with `Path` renamed to the `PATH` Zed's
adapters read. A shell query failure falls back to the
inherited environment and appears in connection details.

The resolved executable and environment are passed together to the server. They
never replace Setdown's global environment or persist the entire environment in
settings. Opening the tool list reads settings and receipts only; a tool's own
page looks up that one tool. Shell/Python/npm queries require a native language
document, a tool's page or **Check again for installed tools**. Markdown reading, PDF and web use do
not trigger this discovery unless explicitly connected to a language server.

A missing tool of a supported language is prepared asynchronously when automatic
installation is enabled; any other tool is prepared after a person asks for it. Servers without a supported installation path remain unavailable;
normal editing and saving stay usable. Explicit connection failures show their cause.
Finding an executable cannot repair a missing shared library or toolchain.

Directory listings and Python/npm metadata are shared between lookups; eight workers
bound catalog I/O. A lookup does not execute what it finds. Zed adapters
may probe a selected tool when a document needs it (for example, Rust's `--help`
check rejects broken rustup shims). Results
are cached briefly; **Check again for installed tools** invalidates results and
pending metadata work.

Python can select a unique local `.venv`/`venv` from metadata. Other toolchain
choices and dependency installation remain explicit.
Executable presence does not validate shared libraries, a language-server package
inside R/Julia, project SDKs or all runtime requirements. Windows npm resolution
is implemented but the integration validation described below ran on Linux.

## Settings and lifetime

**Connection settings** provides typed fields for analysis root, provider role,
formatting choice, Python interpreter and clangd compilation-database directory.
Advanced JSON edits `args`, `settings` and `initializationOptions`; the typed fields
remain authoritative when applying the form. These replace the corresponding defaults. `settings` supports both nested
objects and exact dotted section keys for `workspace/configuration`.
`initializationOptions` is passed directly to the server's initialize request.
The catalog edits global defaults; **Project connection settings…** in the
document's tool details edits its displayed analysis root. The scope is fixed
for that inspection rather than following the active document or Explorer folder.
Project overrides are keyed by absolute project directory and apply only beneath that boundary, with more specific scopes
winning. `workspace/configuration` resolves the requested resource within the
server workspace. Effective launch/settings contexts have separate sessions; a
configuration change creates a new session epoch instead of accepting old push
results as new-environment analysis.

The catalog's enable/disable, executable selection and preferred primary
selection apply application-wide. The document's **Choose analysis tool…** uses
the existing project override. Neither entry point silently changes its scope
when another group receives focus.

Settings persist atomically in `language-servers.json` in Electron's user-data
directory (normally `~/.config/Setdown` on Linux). Invalid persisted settings are
reported instead of silently discarded. clangd's previous `clangd.json` selection
is still read: new selection → old selection → `SETDOWN_CLANGD_PATH` → `clangd`
on the selected environment's PATH. **Reset executable selection** bypasses the
old path selection and executable environment override until another manual
selection is made.

Enabling a primary selects it for its language IDs. Enabling a supplementary
provider adds it without replacing that primary. Choose **Use this provider** for
formatting to select one external formatter for overlapping languages in that
settings scope. Supplementary formatting is otherwise off. Built-in formatting
remains available where no selected external formatter advertises the feature.
The advanced global enable/disable controls remain compatible with earlier
settings; use language defaults for ordinary primary selection and explicit Off.
Changing effective definitions, paths, selection or settings reconnects affected
models with their current unsaved text. Unchanged project-pinned sessions keep
running, including when only the download default changes. It preserves document
ownership, selection and Undo; it does not save files. A document's **Restart
[tool]** restarts its shared session in that window. F1 **Restart Language Servers**
remains a window-wide command.

Processes start lazily for saved files with live editor models, shared within one
window/server/root/configuration. Separate windows retain separate unsaved
buffers. The last document closes its server; quitting waits for bounded shutdown.
A model shared with Working Tree review has one connection. Immutable history and
staged models are excluded. Plain Markdown use starts no language server unless
the user explicitly associates Markdown with an enabled server.

An open project folder is the analysis root when it contains the file. Otherwise,
Setdown searches ancestors for that connection's `rootMarkers` (including filename
globs such as `*.sln`), falling back to
the file's parent. The search stops at a repository boundary, which becomes the
root when no marker is found below it. As in Git, `.git`
counts (as a boundary or a `.git` root marker) only when it is a gitfile or a
directory holding `HEAD`. Sandboxes leave empty `.git` mount targets, such as
`/tmp/.git` created by Codex's bubblewrap; these must not make `/tmp` the
analysis root (`server-definitions.test.ts`). `.C` retains C++ matching before case-insensitive extensions;
exact filenames and path globs precede suffix matches, and longer suffixes such as
`.custom.py` take precedence over `.py`. Imported shebang and syntax-grammar
metadata are not used for LSP routing.

## Custom connection format

Save the following as JSON and choose **Import a connection (JSON)…** in the tool list, then enable the connection.
Use the installed server's real executable and documented arguments.

```json
{
  "id": "my-server",
  "name": "My language server",
  "launch": {
    "kind": "native",
    "command": "/absolute/path/to/server",
    "args": ["--stdio"]
  },
  "languages": [
    { "languageId": "example", "monacoId": "plaintext", "extensions": [".example"] }
  ],
  "rootMarkers": ["example.project", ".git"],
  "settings": { "example": { "diagnostics": true } },
  "initializationOptions": {},
  "watchExtensions": [".example"],
  "watchFiles": ["example.project"]
}
```

IDs must be unique; new imports cannot replace built-in profiles. A custom profile
that already existed before a new built-in with the same ID was introduced is
preserved and takes precedence. Reimporting that custom ID updates its definition. `monacoId` optionally maps syntax highlighting
to an existing Monaco language independently of the LSP language ID. Server
selection does not install syntax grammars. Without matching syntax support,
ordinary text editing still works. `filenames` and `filenamePatterns` optionally match exact names and path suffix
globs (`*`, `**`, `?`); `extensions` may be empty when a name or pattern is present.
`caseSensitiveExtensions` optionally precedes case-insensitive suffix matching. Paths, settings and arguments are validated in the
main process; only the owning editor frame can manage connections.

## Supported protocol boundary

Completion, hover, signature help, definitions, references, hierarchical/flat
symbols and rename use negotiated static capabilities. Changes honor None, Full
or Incremental synchronization; open/close and save notifications honor the
server's options. Save's optional text is the actual saved snapshot, not later
typing. Requests and diagnostics retain connection and document-version checks.

Only UTF-16 positions are supported. Versioned push, best-effort versionless push,
pull diagnostics, dynamic registration, code actions, formatting and semantic
tokens are supported as detailed below. Capability negotiation is per document.
An initialize response does not prove project indexing has finished. Ordinary
external providers connect saved files; notebook analysis retains its separate
cell protocol. Untitled, immutable Git snapshots and arbitrary embedded resources
do not masquerade as live saved documents.

## Catalog provenance and validation

Snapshot: Mason release
[`2026-10-15-sedate-sheep`](https://github.com/mason-org/mason-registry/releases/tag/2026-10-15-sedate-sheep).
The importer keeps only LSP entries and selected metadata; Setdown's connection
profiles are generated separately; user overrides remain in user settings.

- Archive `registry.json.zip` SHA-256:
  `3750d44c6245413fda2201cff1ced92baf9c501a2c4cabc3f794b18421da7ae2`.
- Extracted `registry.json` SHA-256:
  `76df9a5627a77983a956b17549483ba2f9292eecafd2150875b3dc4540a91ed1`.
- Regenerate with `node apps/desktop/scripts/update-language-catalog.mjs /path/to/registry.json`.
  The importer verifies the pinned checksum. Updates require a reviewed change to
  the pin and generated snapshot; there is no runtime catalog fetch.
- Apache-2.0 license is retained as `src/main/language/catalog/MASON-LICENSE`
  and copied into packaged `dist-electron/MASON-LICENSE`.

Connection source: Helix commit
[`ba40e547426b0f9896c8bdc699a4ab11f2b37dbc`](https://github.com/helix-editor/helix/blob/ba40e547426b0f9896c8bdc699a4ab11f2b37dbc/languages.toml).
The original TOML and MPL-2.0 license are retained in
`apps/desktop/scripts/language-profiles/upstream`. Its SHA-256 is
`365d39f08c94e792d685cb9f12020340daefeb7999ab4bb8202d4fe04b9fc273`.

```sh
npm run update:language-profiles --workspace @setdown/desktop
npm run check:language-profiles --workspace @setdown/desktop
```

The offline importer requires Python 3.11+ for maintainers only. Application
builds and installations use checked-in JSON and need no Python importer or
network fetch. `sources.json` pins inputs; `overrides.json` contains existing
application defaults, identity/Monaco mappings and exceptional setup notes.
The importer joins exact server IDs/executable names and, for unbound upstream
commands, exact Mason/Helix language names. It does not evaluate editor plugins,
Lua, shell snippets or installation recipes. Unsupported entries/patterns are
recorded in generated `coverage`/`excluded` data, not silently guessed.
Helix initialization `config` is imported as `initializationOptions`; user
`settings` remains a separate LSP configuration channel.

Generated profiles and both catalogs stay in the main process. Renderer
configuration receives lightweight file associations, enablement, role and
formatting policy; disabled associations remain available for language recognition. Source
attribution and `HELIX-LICENSE` ship in `dist-electron`; the generated data retains
the upstream MPL-2.0 notice. To update, change the pinned source/checksum, regenerate,
review coverage and policy changes, then run the profile/routing/discovery tests
and the preview contract. No language-specific client branch is needed.

The preview contract includes real Python/clangd and a custom stdio fixture which
checks the Edit menu, catalog, import, Full sync, initialization settings, save text,
configuration restart and Undo. It also checks a missing automatic server,
installation followed by Rescan, current unsaved text, a stable server process
through repeated scans and unrelated configuration changes. Discovery unit tests
cover lookup precedence, caching, shell fallback, npm bin/runtime resolution,
shared custom-prefix metadata, the first fallback location winning without a
question and metadata process limits. Real Electron fixtures exercise generated npm-profile discovery, built-in
workers with all servers disabled, and concurrent analysis/formatting providers
with unified Problems. Unit tests also execute real Pyright, basedpyright and
clangd. Each test records which server or fixture it exercises; profile presence
alone is not an integration-test claim.

The additional real-server gate requires an installed Rust toolchain, an explicit
rust-analyzer path and `fortls` discoverable in the test environment:

```sh
SETDOWN_RUST_ANALYZER_PATH=/absolute/path/to/rust-analyzer \
  npm run test:language-servers --workspace @setdown/desktop
```

It uses isolated Xvfb and fails if its tools are missing. The Fortran case opens a
real `.f90`, connects without creating user settings, checks hover/completion and
keeps the connection through Rescan. To run only that case:

```sh
npm run test:language-servers --workspace @setdown/desktop -- fortls.spec.ts
```

The Rust case exercises completion, hover, native syntax diagnostics, definition,
rename/Undo and restart. Cargo checks
and build scripts are disabled for this small fixture, so it does not measure
build/check diagnostics, proc macros or large-project indexing.

The Fortran fixture was exercised with fortls `3.2.2` without manual registration.
The Rust fixture was exercised with rust-analyzer `0.3.3081-standalone` from the
[2026-10-12 release](https://github.com/rust-lang/rust-analyzer/releases/tag/2026-10-12),
using Rust `1.95.0`. The Linux x86-64 gzip archive was checked against release
SHA-256 `040cab4e2abc490fadd95c3f6cbc60b941a78761dbc3acf0ec66fd7a97f31db3`.
The binary is a local test tool, not a bundled application dependency.

## Editor features

This is the implemented inventory following the
[LSP feature audit](../reports/2026_10_16_03_22_lsp_feature_audit_and_expansion_plan.md).
Validation and matched preview measurements are recorded in the
[performance contract](preview-performance-contract.md#lsp-feature-expansion-validation--2026-10-16).

Features are registered per document from the connected server's capabilities,
including supported dynamic registrations. Installing a server does not imply
that it implements every feature below.
Workspace-symbol and hierarchy actions prefer the primary provider when it
supports the command, then an applicable companion. A companion's unsupported
capability cannot disable another provider's working command.

| Feature | Where to use it |
| --- | --- |
| Semantic token colors (full, delta and range) | Automatically complements the existing syntax grammar and Setdown theme |
| Declaration, type definition, implementation, references | Editor context menu / F1 navigation actions |
| Document highlights, semantic selection expansion, folding | Cursor highlighting, Expand Selection and the folding gutter |
| Document links and color presentations | Ctrl/Cmd-click links; color swatches and the color picker |
| Code actions, quick fixes, refactorings, organize imports | Lightbulb, Ctrl/Cmd+. and F1; only server-provided kinds appear |
| Document / range formatting | Format Document / Format Selection in F1 and the context menu |
| Formatting while typing | F1 → Toggle Format on Type; off by default |
| Linked editing | Matching names supplied by the server, such as paired tags |
| Inlay hints, including lazy tooltips, locations and edits | Hold Ctrl+Alt (Cmd+Option on macOS), or F1 → Toggle Inlay Hints |
| Code Lens and lazy command resolution | F1 → Toggle Code Lens; off by default |
| Workspace symbols and lazy locations | F1 → Go to Workspace Symbol…; searches the active server's workspace |
| Incoming/outgoing calls, super/subtypes | Corresponding F1/context-menu action; select a location or use › to explore its children |
| Problems in open files | F1 → Show Problems in Open Files |
| Server progress and bounded output | The existing Language Support server details |

Navigation results use a small editor-local panel. Escape restores the editor;
opening a result reuses ordinary tabs. These panels do not cover or suspend native
web pages. Unsupported hierarchy/symbol actions are disabled. No persistent
language-error button is added over the editor.

Push diagnostics with versions require an exact match. Versionless diagnostics
(such as fortls') are best-effort and are cleared on the next edit. Pull diagnostics
use a 250 ms debounce, request versions, result IDs, refresh notifications and
cancellation. Raw diagnostic data is retained for quick fixes; diagnostic links
and related locations are preserved. This is separate from coloring: a server
that does not supply semantic tokens still needs a syntax grammar for colors.
In particular, fortls does not currently supply semantic tokens.
Its legacy numeric text-sync capability now sends `didSave` without source text,
matching [vscode-languageclient's normalization](https://github.com/microsoft/vscode-languageserver-node/blob/b8c8db0b6a5c1a257d224cda3f0c21ce0a8a3203/client/src/common/client.ts).
This matters because fortls publishes diagnostics on open/save, not every keystroke.

Bundled Pyright keeps push diagnostics by default. Pyright 1.1.414 enumerates source
files asynchronously; requesting rename immediately after initialization can omit
unopened files even in push mode. For this profile, rename waits for the first
analysis diagnostic before sending the request, with cancellation and the normal
request deadline. There is no fixed sleep or rename retry. Setdown uses Pyright's
[`disablePullDiagnostics` initialization option](https://github.com/microsoft/pyright/blob/1.1.414/packages/pyright-internal/src/languageServerBase.ts)
to make that initial-analysis signal available; other servers retain generic pull
support. This follows the ordering in Pyright's
[source enumeration and analysis](https://github.com/microsoft/pyright/blob/1.1.414/packages/pyright-internal/src/analyzer/service.ts).
Explicit initialization options can override it (and opt out of the push barrier).
The real Pyright session tests exercise generic pull/refresh separately.

## Edits and file operations

Formatting, rename, quick fixes, command edits and save edits use the existing
Monaco models. Workspace edits validate all target versions, ranges and overlaps
before applying. Closed targets become ordinary unsaved tabs without taking focus.
Undo is per file; an edit is not silently saved and is not a filesystem-wide
atomic transaction. Server item resolution and commands use bounded, expiring
main-process handles. Server command names never become arbitrary editor commands
or shell commands. Server `workspace/applyEdit` is accepted only during an active
user command or an authorized Explorer operation and remains within that workspace.

`willSave` and `willSaveWaitUntil` run before explicit saves, close-save,
Save As, staging saves and auto save; wait-until has a 1.5-second budget. Edits
arriving after a revision change are ignored. A server still initializing does
not delay saving. Save still captures the current
buffer and `didSave` receives the actual saved snapshot. This is not an automatic
format-on-save setting.
Save participants run sequentially across the connected providers, with existing
version checks on each participant's edits. Each provider receives its negotiated
save notifications; the selected formatting provider remains independent.

Explorer create, rename/move/cut, copy/duplicate and trash operations send filtered
`will*Files` / `did*Files` events to connected servers. The existing serialized
file-operation path holds auto save. Import/reference text edits are validated
before filesystem mutation; `did` describes only completed operations. A rejected
pre-edit aborts the operation. Filesystem failures can still leave the existing
Explorer's explicitly reported partial result, and text edits retain per-file Undo.

Server-requested creation/deletion/renaming **inside a WorkspaceEdit**, annotation
confirmation, notebook synchronization, debugger inline values, monikers, virtual
server documents, nonstandard clangd
extensions remain unadvertised. Those require their own document/transaction or
product contract. The implementation does not add a VS Code extension runtime.

## UI regression coverage

`document-analysis-ui.spec.ts` checks the short summary (language title, Working,
no project row, Problems or selection source before **More…**), the home lists
without a scan, the tool choice on a tool's own step, IME/Escape steps, two
projects in separate groups, group-bounded inspection, explicit shared scope,
project-only writes from an inspection while another group has focus, Undo, the
independent catalog after tab closure, and an actionable missing-environment
summary without scrolling. Closing the final document view also retires its
coverage from the Problems summary. `project-environment.spec.ts` retains real Python,
clangd, TypeScript, CMake, recovery and persistence checks through the new paths.
`language-policy.spec.ts` retains local checks, supplementary tools and genuine
project diagnostic coverage. Presentation/controller unit tests cover priority,
one sentence and action per cause, partial failure, pending/stale observations,
closure and obsolete async responses. `language-issue.test.ts` covers cause
classification and `tool-runtime.test.ts` the JDK choice; `language-manager.test.ts`
covers the extension-name lookup, ranked choice, which causes are retried, the
question before a tool outside the supported languages is downloaded, and an
installed program running without that question. `server-registry.test.ts` checks
that every supported language names a tool that exists and is its default.
`language-registry.spec.ts` covers the tool list: what is listed without a search,
the statuses of a supported and of another tool, import, and a missing program.
These are included in the preview contract; its GUI and performance gates still
apply to changes in these surfaces.

Execution evidence and the 48-bucket baseline comparison:
[Document language support UI](validation/2026-11-01-document-language-support-ui.md).
