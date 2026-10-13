# Terminal tabs

The tab bar provides New Markdown, New web tab, and New terminal buttons. Each
terminal is a pinned workspace tab: reorder it, drop it on another tab strip,
split a group horizontally or vertically, or drag it into a separate window.
Switching tabs and moving between groups preserves the xterm instance and PTY.
Multiple terminal groups can remain visible at once.

The activity-bar Terminal button and Ctrl+backquote toggle the terminal-session
sidebar. Opening the list does not start a shell. The list selects existing
terminal tabs, creates sessions, and closes a session together with its process.
Closing a terminal tab also ends its process. Exited sessions retain their output
and display an exited label until closed. Window close/reload terminates sessions
owned by that window. App restart does not restore terminal processes.

A session starts in the project folder, then the active document directory, then
the user's documents/home directory. The location row displays this launch
folder; it does not track subsequent shell `cd` commands. There are at most 12
sessions per window. Ctrl+C remains a shell interrupt; Ctrl+Shift+C/V handles
clipboard operations without duplicate paste. Escape stays inside the terminal.

The renderer lazily loads xterm.js and fits the live PTY to its group, including
on group resize and activation. Inactive terminals continue to consume and
acknowledge output without taking focus. Main owns process lifetime separately
from renderer surfaces. Tab transfer validates ownership, pauses the same PTY,
changes its owner, and resumes when the destination subscribes. The old window
cannot write, resize or terminate the transferred session. A lazily loaded
headless xterm engine in main retains the live normal/alternate screen buffers
and the same 5000-row scrollback limit as the renderer. A parser barrier captures
the current cells, colors, cursor, saved cursor, scroll margins and input modes;
output arriving after that barrier follows the snapshot exactly once. The new
renderer restores at the old dimensions before fitting its group. This preserves
full-screen programs such as Vim, including continued insert-mode input.

`TerminalManager` validates input and sizes, and pauses busy output until the
renderer acknowledges parsing it. Renderer disposal releases xterm only; explicit
workspace close or owner destruction closes the PTY. Terminal tabs never enter
document save, Markdown preparation, or browser navigation paths. File changes
from a focused terminal refresh a clean neighboring document without stealing
terminal focus.

Tests: `terminal-manager.test.ts`, `terminal-screen.test.ts`, `text-workspace.test.ts`, and real Electron
`terminal.spec.ts` cover ownership, backpressure, lifecycle, retained shell PID
and variables, actual pointer splits, native reader boundaries, resizing, and
cross-window transfer. Screen tests compare both VT buffers and continued output,
including colors, saved cursor, scrolling margins, mouse modes, Korean wide
characters and pending right-margin wrap. Real Vim transfer compares visible
rows and continues an unsaved edit after the move. The supplemental VT adapter
is isolated in `terminal-screen.ts` and pinned to xterm 6.0.0/serialize 0.14.0;
its round-trip checks must accompany upgrades. Image/video/group layout tests cover neighboring surfaces.
Run GUI tests on Xvfb as required by AGENTS.md. These checks are included in the
preview contract suite; the comparative latency gate still applies.
