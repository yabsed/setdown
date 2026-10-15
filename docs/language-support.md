# Language support

Open **Edit → Language Support…** to find servers and manage connections. The
editor's F1 palette opens the same screen. The Setdown button continues to open
Folder Tools.

## Choosing a server

The catalog is an offline snapshot of [Mason Registry](https://github.com/mason-org/mason-registry).
It describes 331 LSP packages; a catalog entry is not a guarantee that all of that
server's features work in Setdown. Browsing it never downloads or executes packages.

- **Pyright** is included and enabled for Python.
- **clangd** is enabled for C/C++ and uses an installed executable.
- **rust-analyzer** and **gopls** have connection profiles, initially disabled.
  Install the server and its toolchain, choose its executable if necessary, and
  click **Enable**. The gopls profile has not yet had a real-server integration test.
- Other entries offer **Installation instructions** and **Connect installed
  server…**. Supply the server's documented language ID, extensions, arguments and
  project markers, then choose its executable. **New connection** supports servers
  outside the catalog. **Import JSON…** supports multiple language associations
  and additional watch rules; imported connections initially stay disabled.

Installation is manual. Setdown does not run Mason's recipes, package managers,
VS Code extensions or project-supplied launch commands. Native stdio servers are
supported. For a Node-based server, choose the Node executable and put the
installed server script plus `--stdio` in `args`. Arguments are separate array
entries, not a shell command; `.cmd`/`.bat` launchers are not supported.

The screen distinguishes a missing executable, disabled connection, a ready
connection waiting for a document, a running session and a failed session. It shows
executable path, workspace root, negotiated editor features and startup/crash
errors (including available stderr). Finding an executable does not prove that
its runtime or workspace is healthy; **Running** means LSP initialization completed.
A runtime proxy such as rustup can exist even when its server component is missing.

## Settings and lifetime

**Connection settings** edits `args`, `settings` and `initializationOptions` as
JSON. These replace the corresponding defaults. `settings` supports both nested
objects and exact dotted section keys for `workspace/configuration`.
`initializationOptions` is passed directly to the server's initialize request.
Settings are user-wide, not project-specific. A scope URI currently receives that
same connection's settings; there are no per-document overrides.

Settings persist atomically in `language-servers.json` in Electron's user-data
directory (normally `~/.config/Setdown` on Linux). Invalid persisted settings are
reported instead of silently discarded. clangd's previous `clangd.json` selection
is still read: new selection → old selection → `SETDOWN_CLANGD_PATH` → `clangd`
on the inherited PATH.

Enable selects a server for its language IDs. One primary server serves each
language; enabling another replaces that selection. Disabling the chosen server
falls back to another enabled connection, if one exists. Changing definitions,
paths, selection or settings stops old sessions in all windows and reconnects
existing models with their current unsaved text. It preserves document ownership,
selection and Undo; it does not save files. **Restart servers in this window** and
F1 **Restart Language Servers** only restart the current window.

Processes start lazily for saved files with live editor models, shared within one
window/server/root/configuration. Separate windows retain separate unsaved
buffers. The last document closes its server; quitting waits for bounded shutdown.
A model shared with Working Tree review has one connection. Immutable history and
staged models are excluded. Plain Markdown use starts no language server unless
the user explicitly associates Markdown with an enabled server.

An open project folder is the analysis root when it contains the file. Otherwise,
Setdown searches ancestors for that connection's `rootMarkers`, falling back to
the file's parent. `.C` retains C++ matching before case-insensitive extensions;
longer suffixes such as `.custom.py` take precedence over `.py`.

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

IDs must be unique; built-in profiles cannot be replaced by imports. Reimporting a
custom ID updates its definition. `monacoId` optionally maps syntax highlighting
to an existing Monaco language independently of the LSP language ID. Server
selection does not install syntax grammars. Without matching syntax support,
ordinary text editing still works. `caseSensitiveExtensions` optionally precedes
case-insensitive matching. Paths, settings and arguments are validated in the
main process; only the owning editor frame can manage connections.

## Supported protocol boundary

Completion, hover, signature help, definitions, references, hierarchical/flat
symbols and rename use negotiated static capabilities. Changes honor None, Full
or Incremental synchronization; open/close and save notifications honor the
server's options. Save's optional text is the actual saved snapshot, not later
typing. Requests and diagnostics retain connection and document-version checks.

Only UTF-16 positions are supported. Unversioned push diagnostics are dropped;
pull diagnostics and dynamic registration are not implemented or advertised.
A server can therefore provide completion/hover while its diagnostics remain
unavailable. Code actions, formatting, semantic tokens, additional URI schemes,
server commands and unsolicited edits are not implemented. These are common
client capabilities to add when needed, not features to duplicate per language.

## Catalog provenance and validation

Snapshot: Mason release
[`2026-10-15-sedate-sheep`](https://github.com/mason-org/mason-registry/releases/tag/2026-10-15-sedate-sheep).
The importer keeps only LSP entries and selected metadata; Setdown's connection
profiles and user overrides are maintained separately.

- Archive `registry.json.zip` SHA-256:
  `3750d44c6245413fda2201cff1ced92baf9c501a2c4cabc3f794b18421da7ae2`.
- Extracted `registry.json` SHA-256:
  `76df9a5627a77983a956b17549483ba2f9292eecafd2150875b3dc4540a91ed1`.
- Regenerate with `node apps/desktop/scripts/update-language-catalog.mjs /path/to/registry.json`.
  The importer verifies the pinned checksum. Updates require a reviewed change to
  the pin and generated snapshot; there is no runtime catalog fetch.
- Apache-2.0 license is retained as `src/main/language/catalog/MASON-LICENSE`
  and copied into packaged `dist-electron/MASON-LICENSE`.

The preview contract includes real Python/clangd and a custom stdio fixture which
checks the Edit menu, catalog, import, Full sync, initialization settings, save text,
configuration restart and Undo. The additional real Rust integration gate requires
an installed Rust toolchain and an explicit rust-analyzer path:

```sh
SETDOWN_RUST_ANALYZER_PATH=/absolute/path/to/rust-analyzer \
  npm run test:language-servers --workspace @setdown/desktop
```

It uses isolated Xvfb and fails if its tools are missing. It exercises completion,
hover, native syntax diagnostics, definition, rename/Undo and restart. Cargo checks
and build scripts are disabled for this small fixture, so it does not measure
build/check diagnostics, proc macros or large-project indexing.

The Rust fixture was exercised with rust-analyzer `0.3.3081-standalone` from the
[2026-10-12 release](https://github.com/rust-lang/rust-analyzer/releases/tag/2026-10-12),
using Rust `1.95.0`. The Linux x86-64 gzip archive was checked against release
SHA-256 `040cab4e2abc490fadd95c3f6cbc60b941a78761dbc3acf0ec66fd7a97f31db3`.
The binary is a local test tool, not a bundled application dependency.
