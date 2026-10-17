# Language support

Open **Language Support** in the left activity bar, directly below Browser.
**Edit → Language Support…** and the editor's F1 palette open the same sidebar.
It stays beside the document; opening it does not cover or freeze a live web page.
The Setdown button continues to toggle Folder Tools.

The sidebar has four groups: **Detected**, **Needs attention**, **Manual
connections**, and **Available servers**. The fourth group contains automatically
discoverable servers that have not been found yet. It starts collapsed to keep
installed servers visible; search includes all four groups and expands matching
results. Discovery support is independent of installation and of connection
profile availability. Only entries without automatic discovery metadata are
omitted from this list; they remain available in the manual-add flow.

Each row separates runtime state (Ready, Running, Disabled, Failed, Not detected)
from origin (Detected, Included, Manual). Missing saved connections and failed
sessions remain visible so they can be repaired. A detected executable without a
connection profile appears with **Setup needed**. Language logos use named SVG
exports from the already installed Simple Icons package, pinned to 9.21.0 as a
direct dependency. Logos adapt contrast to light/dark themes; languages without
a matching logo use a short language label. No remote image requests are needed.

Select a row to view its executable, controls, and errors. Advanced arguments,
settings, and profile information are under **Connection settings**. Back returns
to the filtered list. Escape clears a search, returns from details, or closes the
sidebar; it does not switch the active document into reader mode.

The title bar's refresh icon rescans installations. **+ / Add server manually…**
opens the manual flow: choose a known profile and locate its executable, or enter
a custom connection. **Import JSON…** remains available. Browsing a manual-only profile
in this flow does not add it to the default list until it is detected or saved.

The compact view title, icon actions, search field, counted sections, and row
hierarchy follow [VS Code's view guidance](https://code.visualstudio.com/api/ux-guidelines/views)
and its vendored `extensionsViewlet.ts` / `media/extensionsViewlet.css`. Setdown
retains its own theme tokens and sidebar layout; the screen is not a marketplace.

The [discovery design](../reports/2026_10_16_00_09_lsp_discovery_and_connection_design.md)
explains the architecture and follow-up work. The behavior below describes the
implemented catalog-wide discovery and imported connection profiles.

## Current file support

The language button in a code document's location bar describes that document,
independently of other tabs. It shows the language mode, built-in features,
connected providers, reported environment, and setup/restart/Problems actions.
The mode chooser applies to the current open document; Auto-detect restores file
association detection. It preserves the model, unsaved content and Undo. Disabling
or uninstalling a server does not remove its language associations or grammar.
Unknown languages open as plain text and can be assigned a mode explicitly.

No applicable server is a supported editing state. Built-in JSON validates syntax
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

A shared diagnostic store supplies both editor markers and Problems, including
built-in checks. Contributions are scoped to provider, document, session and
push/pull channel. Configuration changes restart affected sessions. Edits clear
previous live results; late versioned replies and disposed sessions cannot
republish. Versionless push is explicitly best-effort, never assigned a fabricated
analysis version. An empty Problems list means no diagnostics were reported, not
that every possible check ran successfully.

## Choosing a server

The offline catalog combines 331 packages from [Mason Registry](https://github.com/mason-org/mason-registry)
with pinned [Helix language definitions](https://docs.helix-editor.com/languages.html).
It currently contains **384 servers and 195 connection profiles**. Automatic
discovery uses the catalog's executable metadata; bundled Pyright and the TypeScript project server are shown as Included.
Five catalog entries without executable metadata require manual executable selection. The sidebar
separates detected installations from available discovery profiles. Of the original
331 Mason entries, 142 have an imported or retained connection profile; 189 still
need connection metadata. The shared discovery flow checks every entry using its available executable
metadata. Five Mason entries have neither an executable name nor an imported
profile, so their path still needs a manual choice.
A profile is a launch/association recipe, not a claim that every server feature
has been integration-tested.

Install a server yourself, then open a matching saved file. Profiled servers know
their command, arguments, language IDs, file associations and root markers:

- **Pyright** remains bundled and enabled for Python.
- **TypeScript Language Server** and TypeScript 5.9.3 are included for saved JS/TS/JSX/TSX files. Automatic typings acquisition is disabled; project configuration and installed dependencies determine analysis.
- **clangd**, **rust-analyzer**, **gopls** and **fortls** retain their existing
  identities and settings. `pip install fortls` followed by opening `.f90` needs
  no connection form; uppercase and other Fortran suffixes remain supported.
- Imported profiles cover TypeScript/JavaScript, Bash, Lua, YAML, JSON, Dockerfile,
  CMake and many others. Names such as `Dockerfile`, `CMakeLists.txt` and `go.mod`,
  path globs, compound suffixes and JSX/TSX language IDs are included.
- One installed primary server connects automatically. Multiple installed
  alternatives wait for **Use for these languages**. An explicit selection stays
  selected even if its executable disappears. Bundled Python and TypeScript services take precedence
  until the user chooses another primary server for those languages. Healthy sessions stay on their
  original server when new installations are discovered.
- Optional writing/diagnostic providers remain disabled by default. Ruff, Biome
  and other supplementary profiles can run beside the primary service. They
  retain separate diagnostic/code-action ownership and do not replace the primary
  rename or semantic-token provider. Connection settings select their role and
  formatting participation independently. Runtime-only profiles such as R/Julia explain the package that must
  be installed before enabling them. TCP bridges and download-capable launcher
  recipes are excluded from generated connections.
- Entries without a connection profile still detect their installed executable.
  **Connect installed server…** asks for the missing language ID, extensions and
  stdio arguments. When there is one detected installation, it reuses that path
  without opening a file chooser. **Add server manually…** and **Import JSON…** remain
  available; imported custom connections initially stay disabled.

Installation is manual. Setdown does not execute Mason installation recipes or
install packages. It starts installed stdio servers with argument arrays and
`shell: false`. Native executable scripts on Unix work through their normal
interpreter. npm package `bin` metadata can also resolve an installed Node runtime
and script directly, including on Windows without running `.cmd`/`.bat` wrappers.
Custom connections can still select Node and put the server script in `args`.

The details distinguish **Not detected**, **Choose installation**, **Disabled**,
**Ready**, **Choose primary**, **Starting**, **Running** and **Failed**. Detected
entries lacking a profile show **Setup needed**. The detail view shows
executable path, workspace root, negotiated editor features and startup/crash
errors (including available stderr). Finding an executable does not prove that
its runtime or workspace is healthy; **Running** means LSP initialization completed.
A runtime proxy such as rustup can exist even when its server component is missing.

## Finding an installation

If you install a server while Setdown is running, open **Edit → Language Support…**
and click **Rescan installed servers**. Open documents with unavailable or failed
connections retry using their latest unsaved text. Healthy connections keep their
processes, and explicitly disabled servers stay disabled. Additional documents in
the same live workspace reuse its session; a newly detected path takes effect on
a new session or explicit restart. Newly opened documents
also recheck after the short discovery cache expires.

Discovery first honors a manually selected executable, including the legacy clangd
selection. An explicit path that disappears reports an error; it does not silently
switch versions. **Use automatic detection** clears that path choice without
changing enablement or server options. The existing native **Choose executable…**
button remains available.

Automatic detection uses the selected environment's absolute PATH directories in
order, then known user locations such as `~/.local/bin`, Cargo's bin directory,
GOBIN/GOPATH and configured pipx/uv bin directories. For profiles/catalog packages distributed through Python, it can query the
selected interpreter's scripts and user-scripts directories. npm packages use
known global directories and `package.json` bin mappings. On a document connection
or Rescan, a shared `npm root --global` metadata query can locate a custom prefix;
it runs the installed npm CLI through Node with fixed arguments and no scripts.
The same runtime lookup is shared across the entire catalog. Multiple PATH
matches follow PATH order; multiple fallback matches require choosing a candidate
in Language Support. No home-directory crawl or server `--version` sweep occurs.

On supported Unix shells, the first native LSP connection or an explicit Rescan
can read the user's shell environment asynchronously. Shell queries have a
five-second timeout; Python/npm metadata queries have a three-second timeout, with a
1 MiB combined output limit and process cleanup on cancellation. Activated venv
and Conda environments retain the inherited environment. Advanced launchers can
set `SETDOWN_LSP_INHERIT_ENV=1` to preserve their environment without a shell query.
Windows uses its inherited environment. A shell query failure falls back to the
inherited environment and appears in connection details.

The resolved executable and environment are passed together to the server. They
never replace Setdown's global environment or persist the entire environment in
settings. Opening the catalog performs only file checks; shell/Python/npm queries
require a native language document or Rescan. Markdown reading, PDF and web use do
not trigger this discovery unless explicitly connected to a language server.

A missing default automatic server is a quiet unavailable state; normal editing
and saving remain usable. Explicit connection failures still show their cause.
Finding an executable cannot repair a missing shared library or toolchain.

Directory listings and Python/npm metadata are shared across scans; eight workers
bound catalog I/O. No discovered server is executed to check its version. Results
are cached briefly; Rescan invalidates results and pending metadata work. Explicit
candidate IDs are revalidated in main before they become a saved connection.

Project-local environments and dependency installation are not inferred.
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
Choose **All projects** or **This project**. Project overrides are keyed by absolute
project directory and apply only beneath that boundary, with more specific scopes
winning. `workspace/configuration` resolves the requested resource within the
server workspace. Effective launch/settings contexts have separate sessions; a
configuration change creates a new session epoch instead of accepting old push
results as new-environment analysis.

Enable/disable, executable selection and preferred primary selection remain
application-wide. The scope selector applies to the connection fields in that
form; it does not silently change these global controls.

Settings persist atomically in `language-servers.json` in Electron's user-data
directory (normally `~/.config/Setdown` on Linux). Invalid persisted settings are
reported instead of silently discarded. clangd's previous `clangd.json` selection
is still read: new selection → old selection → `SETDOWN_CLANGD_PATH` → `clangd`
on the selected environment's PATH. **Use automatic detection** bypasses the
old path selection and executable environment override until another manual
selection is made.

Enabling a primary selects it for its language IDs. Enabling a supplementary
provider adds it without replacing that primary. Choose **Use this provider** for
formatting to select one external formatter for overlapping languages in that
settings scope. Supplementary formatting is otherwise off. Built-in formatting
remains available where no selected external formatter advertises the feature. Disabling the chosen server
allows another enabled connection; multiple automatic installations require a choice. Changing definitions,
paths, selection or settings stops the affected servers in all windows and
reconnects their models with current unsaved text. Unrelated servers keep running. It preserves document ownership,
selection and Undo; it does not save files. **Restart servers in this window** and
F1 **Restart Language Servers** only restart the current window.

Processes start lazily for saved files with live editor models, shared within one
window/server/root/configuration. Separate windows retain separate unsaved
buffers. The last document closes its server; quitting waits for bounded shutdown.
A model shared with Working Tree review has one connection. Immutable history and
staged models are excluded. Plain Markdown use starts no language server unless
the user explicitly associates Markdown with an enabled server.

An open project folder is the analysis root when it contains the file. Otherwise,
Setdown searches ancestors for that connection's `rootMarkers` (including filename
globs such as `*.sln`), falling back to
the file's parent. `.C` retains C++ matching before case-insensitive extensions;
exact filenames and path globs precede suffix matches, and longer suffixes such as
`.custom.py` take precedence over `.py`. Imported shebang and syntax-grammar
metadata are not used for LSP routing.

## Custom connection format

Save the following as JSON and choose **Import JSON…**, then enable the connection.
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
cover candidate precedence, caching, shell fallback, npm bin/runtime resolution,
shared custom-prefix metadata, catalog-wide detection, ambiguous primary selection
and metadata process limits. Real Electron fixtures exercise generated npm-profile discovery, built-in
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
