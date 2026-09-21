<p align="center">
  <img src="apps/desktop/build/icon.png" width="104" alt="Setdown app icon">
</p>

<h1 align="center">Setdown</h1>

<p align="center">Write plain. Read beautifully.</p>

Setdown is a desktop Markdown reader and editor for local files. Read a typeset
document, double-click the passage you want to change, and edit its Markdown
source. Press `Esc` to return to reading with your place preserved.

Keep related text files, PDFs, and images in the same window. Open a folder when
you need file navigation, search, Git review, or a terminal.

<p align="center">
  <img src="live_demo.gif" width="900" alt="Editing Markdown from the Setdown Viewer and returning to the reading position">
</p>

<table>
  <tr>
    <td><img src="docs/assets/setdown-tabs.png" alt="Markdown with equations in the Paper theme, with multiple document tabs"></td>
    <td><img src="docs/assets/setdown-editor.png" alt="Markdown source in the One Dark editor theme"></td>
  </tr>
</table>

## Read and edit in place

The Viewer renders Markdown with equations, tables, code blocks, and images.
Double-click a paragraph, equation, image, or nearby whitespace to open the Editor
at the corresponding source position. Switch back with `Esc` or toggle either
view with `Ctrl/Cmd+E`.

Open Markdown tabs keep their rendered views and editor state alive. While you
edit, Setdown prepares updated content in the background and keeps the last
completed preview available until the replacement is ready. Source anchors help
preserve your place when switching views or changing the window width.

- Navigate headings through the document outline and search with `Ctrl/Cmd+F`.
- Export Markdown through **File → Export as PDF…**.
- Reorder tabs, drag them into another Setdown window, or detach them into a new one.
- Reopen saved files at their last reading or editing position, including after an
  application restart.
- Choose Paper, GitHub, One Dark, Dracula, Nord, Sepia, or Solarized Dark. Themes
  apply to the reader, editor, and application chrome across windows.

The Monaco-based Editor includes a table-size picker, TSV-to-table conversion,
link insertion, and URL pasting over selected text. Pasted images use ordinary
Markdown links: web images retain their URLs, copied image files retain their
format, and screenshots become PNG assets. Local assets go in
`<document name>.assets/`; untitled documents keep them in a draft bundle until
Save As succeeds.

## Work with more than Markdown

| File type | Experience |
| --- | --- |
| Markdown | Typeset Viewer and source Editor, including rendered Git comparisons |
| Text, source, and configuration files | Source editing with Monaco syntax highlighting and text Git diffs |
| PDF | Read-only viewer with continuous scrolling, page navigation, outline, text search and selection, zoom, rotation, and password entry |
| PNG, JPEG, WebP, GIF, AVIF, SVG | Read-only image viewer with fit, zoom, rotation, and drag-to-pan controls |

Non-Markdown text editing supports UTF-8, with or without a BOM, up to 16 MiB.
It preserves uniform LF or CRLF line endings and the final-newline state.
Unsupported encodings, binary content, and mixed line endings are rejected.
Unknown text languages fall back to plain text; language servers and compilers
are not bundled.

PDF search uses the document's embedded text; scanned pages need an existing OCR
text layer. Image files can be up to 64 MiB. PDF and image positions, zoom, and
rotation persist across restarts. The three most recently visited PDF/image
surfaces stay in memory per window; older surfaces reload at their saved position.

### Three zoom controls

| Scope | Control | Effect |
| --- | --- | --- |
| Application | `Ctrl/Cmd++`, `Ctrl/Cmd+-`, `Ctrl/Cmd+0` | Resize the application across windows; `0` resets app zoom |
| Text | `Ctrl+wheel` over Markdown or text | Change the shared reader/editor text size, including Git review |
| PDF or image | `Ctrl+wheel` over the file, or its toolbar | Zoom that file independently |

App zoom and text size persist across restarts. Use **View → Reset Text Size** to
reset text size. Media toolbars provide their own fit and 100% controls; new PDFs
start at fit width.

## Optional folder tools

Opening a file does not automatically open its parent folder as a project.
Choose **File → Open Folder…** for a sidebar with:

- **Explorer:** browse, create, rename, move, and trash files and folders.
- **Search:** search Markdown by default, or opt into all text files.
- **Source control:** inspect changes, stage, unstage, discard, commit, fetch,
  pull, push, and sync using Git.

Markdown changes can be reviewed as rendered documents or source diffs. Staged
review compares **HEAD → Index**; unstaged review compares **Index → the current
document**, including unsaved edits. The ordinary document tab and editable Git
review share the same text and undo history. Staging saves the selected open
documents before running `git add`. Staged and unstaged reviews can remain open
in separate tabs.

Clean documents reload external file changes. Documents with unsaved edits keep
those edits and ask before replacing them.

Click the Setdown wordmark to toggle folder tools. The sidebar and document
outline are resizable, and their layout is restored on window reload. Closing
folder tools leaves document tabs open.

### Integrated terminal

Press **Ctrl+`**, choose **View → Toggle Terminal**, or use the terminal button at
the bottom of the activity bar. The resizable panel supports multiple shell
sessions, scrollback, ANSI colors, and interactive programs.

New sessions start in the open project folder, the active document's folder, or
your home directory, in that order. Hiding the panel preserves sessions; closing
or reloading the window terminates them. Sessions do not survive an app restart.
Use `Ctrl+Shift+C/V` to copy and paste on Linux and Windows, or `Cmd+C/V` on macOS.

## Run from source

Use Node.js 22.12 or later in the Node 22 series and npm. CI uses Node 22. Git must
be available on `PATH` for source-control operations. Native dependencies may
require platform build tools when a suitable prebuilt binary is unavailable.

From the repository root:

```bash
npm ci
npm start
```

`npm start` builds the application before launching Electron. To open a file at
launch:

```bash
npm start -- /absolute/path/to/document.md
```

For development with the Vite server:

```bash
npm run dev
```

If your environment sets `ELECTRON_RUN_AS_NODE=1`, unset it for commands that
launch Electron.

## Install and package

### Linux

After installing dependencies, build and install for the current user:

```bash
npm run install:linux
```

The installer places the application under
`${XDG_DATA_HOME:-~/.local/share}/setdown`, registers a desktop entry and icon, and
sets Setdown as the default Markdown application. It uses
`update-desktop-database` and `xdg-mime` and does not require administrator access.

To produce AppImage and deb packages instead:

```bash
npm run package:linux
```

### Windows

Build the x64 NSIS installer on Windows after installing dependencies:

```powershell
npm run package:win
```

The installer supports per-user installation, a selectable install directory,
shortcuts, and Markdown, PDF, and image file associations.

Both packaging commands write their output to `apps/desktop/release/`.
The repository currently defines packaging targets for Linux and Windows.

## Keyboard reference

`Ctrl/Cmd` means `Ctrl` on Linux/Windows and `Cmd` on macOS.

| Action | Shortcut |
| --- | --- |
| Edit at a location in the Markdown Viewer | Double-click |
| Return from Markdown Editor to Viewer | `Esc` |
| Toggle Markdown Viewer / Editor | `Ctrl/Cmd+E` |
| Find | `Ctrl/Cmd+F` |
| New document | `Ctrl/Cmd+N` |
| New window | `Ctrl/Cmd+Shift+N` |
| Open file | `Ctrl/Cmd+O` |
| Save / Save As | `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` |
| Insert a Markdown link | `Ctrl/Cmd+K` |
| Close tab | `Ctrl/Cmd+W` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Toggle terminal | **Ctrl+`** |

The in-window **File · View · Edit · Window** menus also expose folder tools,
themes, PDF export, zoom, and window commands.

## Architecture

Setdown uses Electron, Svelte, TypeScript, Monaco, and Crossnote. Markdown
rendering and math typesetting run in Electron utility processes. Isolated native
`WebContentsView` instances host Markdown previews; PDF.js handles PDFs, and
xterm.js with node-pty provides the terminal.

```text
apps/
├── desktop/
│   ├── src/
│   │   ├── core/             Domain rules and document algorithms
│   │   ├── protocol/         Serializable IPC contracts
│   │   ├── main/             Files, windows, rendering, Git, and PTYs
│   │   ├── preload/          Typed renderer IPC bridge
│   │   ├── preview-runtime/  Markdown reader interactions and rendering updates
│   │   └── renderer/         Svelte UI, Monaco, folder tools, and media viewers
│   ├── scripts/              Build, installation, and benchmark tools
│   └── test/                 Electron end-to-end tests and fixtures
└── code-growth/              Repository code-growth chart generator
```

Core code is independent of Electron and UI frameworks. Process entry points wire
services to adapters, and architecture tests enforce dependency boundaries.
Preview results carry revision identity so obsolete work cannot replace newer
content or appear in another tab.

Markdown previews use a separate `marktex-preview:` origin with local resources
restricted to the document directory and required rendering assets. Executable
code chunks, document-local Crossnote scripts/configuration, and HTML5 embeds
are disabled. PDF scripts are disabled, and SVG files are loaded as images.

Upstream reference sources live in `vendor/` as submodules. Normal builds use npm
packages and do not require those checkouts. Fetch them when needed with:

```bash
git submodule update --init --recursive
```

## Development checks

Run commands from the repository root:

```bash
npm run typecheck           # TypeScript and Svelte checks
npm test                    # Unit and integration tests
npm run build               # Typecheck and production build
npm run test:e2e             # Build and run Electron end-to-end tests
npm run test:preview-contract
```

Before running browser checks, install Chromium with
`npx playwright install chromium`. On Linux without a display, use
`xvfb-run -a npm run test:preview-contract`.

Read the [preview performance contract](docs/preview-performance-contract.md)
before changing preview preparation or presentation, native bounds, zoom,
source/reader transitions, hydration, source-position lookup, themes/CSS, or
Electron/Crossnote dependencies. Those changes require the contract suite and a
comparison against a separate baseline checkout with installed dependencies:

```bash
npm run bench:preview -- --baseline /absolute/path/to/installed-baseline
```

The contract explains baseline setup and reporting. Report first, second, and
warm cycles separately for ordinary Markdown and Git review, with and without
edits and preparation time. Incomplete runs, stale-content captures, and failed
checks are not successful benchmarks.

CI runs the contract suite on pull requests and pushes to `main`. The full latency
comparison is available manually through the **Preview performance contract**
workflow with `run_latency` enabled; local performance-path changes still require
the comparative benchmark.

Further documentation:

- [Preview guarantees, ownership, and benchmark procedure](docs/preview-performance-contract.md)
- [Reading-position persistence, PDF and image viewers](docs/reading-positions-and-pdf.md)
- [Integrated terminal behavior and implementation](docs/integrated-terminal.md)
- [Text workspace support and acceptance scenarios](apps/desktop/test/TEXT-WORKSPACE.md)
- [Design and implementation records](reports/)

Regenerate the repository growth chart with `npm run plot:code-growth`:

<p align="center">
  <img src="apps/code-growth/output/repository-code-growth.png" width="960" alt="Setdown repository code growth by commit">
</p>
