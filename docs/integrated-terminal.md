# Integrated terminal

The terminal button is at the bottom of the left activity bar. **Ctrl+`** or
**View → Toggle Terminal** opens the bottom panel, including when no document is
open. New sessions start in the project folder, the active document folder, or
the home directory, in that order. Existing sessions keep their own directory.

The panel supports multiple sessions, a draggable/keyboard-resizable top edge,
scrollback, ANSI colors, interactive programs, and the system shell (PowerShell
on Windows). Hide preserves sessions and output. Kill terminates the selected
session; shell exit leaves its output available until the tab is removed.
Window close, application quit, and window reload terminate the window's PTYs.
Sessions are not restored after restarting Setdown.

Use **Ctrl+Shift+C/V** to copy/paste on Linux and Windows, or **Cmd+C/V** on macOS.
Ctrl+C and Escape reach the shell. Markdown remains editable in Setdown's Monaco
editor above the terminal; save with Ctrl/Cmd+S while the editor has focus. Shell
changes to an open file use the existing external-change handling, including
protection for unsaved edits.

Implementation references in the VS Code submodule:

- `vendor/vscode/src/vs/platform/terminal/node/terminalProcess.ts`: PTY creation,
  resizing, process lifecycle, and output flow control.
- `vendor/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts`:
  terminal rendering and input with xterm.

Setdown uses the same underlying [node-pty](https://github.com/microsoft/node-pty)
and [xterm.js](https://xtermjs.org/) libraries with its own small integration;
VS Code workbench services are not bundled. Terminal code is loaded only on first
open. The main-process manager owns PTYs per window, validates sizes and input,
and pauses output until the renderer acknowledges parsing it (following
[xterm's flow control guidance](https://xtermjs.org/docs/guides/flowcontrol/)).
The preload exposes only typed terminal operations. Native node-pty files and
its spawn helper are unpacked from ASAR for packaged applications.

The panel occupies a separate shell grid row. Reader placeholders shrink through
the existing ResizeObserver/native-bounds path, including hidden preparation.
The preview performance contract applies to this layout change.

Validation: `src/main/terminal/terminal-manager.test.ts` covers ownership,
validation, cleanup, and backpressure. `test/e2e/terminal.spec.ts` exercises a real
PTY, Markdown changes, editor saving, keyboard routing, panel geometry, and
session lifecycle. Run it after building with
`npx playwright test test/e2e/terminal.spec.ts` from `apps/desktop`.
