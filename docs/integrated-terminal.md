# Terminal tabs

The tab bar provides New Markdown, New web tab, and New terminal buttons. Each
terminal is a pinned workspace tab: reorder it, drop it on another tab strip,
split a group horizontally or vertically, or drag it into a separate window.
Switching tabs and moving between groups preserves the xterm instance and PTY.
Multiple terminal groups can remain visible at once.
The New terminal button creates its tab in that button's group, even while
another editor group is focused or still activating asynchronously.

The activity-bar Terminal button and Ctrl+backquote toggle the terminal-session
sidebar. Its activity icon follows Browser; the session rows and empty-list
creation action use Explorer's 23px row height and 11px text. Opening the list does not start a shell. The list selects existing
terminal tabs, creates sessions, and closes a session together with its process.
Closing a terminal tab, or navigating that tab to a file or web page, preserves
its process. Select the session in the Terminal sidebar to return to it; the
sidebar close button explicitly ends the process. Exited sessions retain their output
and display an exited label until closed. Window close/reload terminates sessions
owned by that window. App restart does not restore terminal processes.

The cell font (13px base) follows the displaying tab's content factor. Each
terminal tab starts at 100% and changes independently, even from other terminal
tabs. Ctrl+wheel and address-bar controls update that tab and refit its PTY
through the ordered resize path. Click the percentage in the address bar to
reset that terminal tab to 100%. Ctrl+plus/minus/0 keep their separate app-zoom
scope. Zoom never kills, restarts or detaches a session.

A session starts in the project folder, then the active document directory, then
the user's documents/home directory. The editable location row displays `terminal://<session-id>`; the sidebar
displays the launch folder. Sessions have stable Terminal 1, Terminal 2 labels
instead of shell-provided titles. Normal tab Back/Forward spans terminal, file
and web resources, preserving the process when returning to its address. There are at most 12
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

Horizontal layout notifications are coalesced for 100ms. Main owns the resulting
grid change: growth enlarges the grid before notifying the PTY; shrink notifies
the PTY first and lets its redraw finish in the old wider grid before reflow.
Shrink waits for a 30ms output gap, bounded at 150ms for streaming processes.
Input arriving during that change follows its completion. Parsed output and
grid events retain their order in both VT engines, including during transfer;
snapshots capture their dimensions at the same parser barrier as their cells.
Exited output can still fit a resized group without touching an exited process.

The reference submodule `vendor/ptyxis` uses GTK4/VTE for grid and PTY handling;
`ptyxis-terminal.c` chains allocation to VTE and reads changed cell dimensions.
Its VTE widget also reproduces the multiline right-prompt resize issue with
Powerlevel10k. The theme's [resize explanation](https://github.com/romkatv/powerlevel10k#horrific-mess-when-resizing-terminal-window)
describes the changed distance from prompt start to cursor after reflow. The
ordered resize path preserves prior output and typed input while allowing the
process to redraw at the target width.

`TerminalManager` validates input and sizes, and pauses busy output until the
renderer acknowledges parsing it. Renderer disposal releases xterm only; explicit
session close or owner destruction closes the PTY. The terminal resource itself
never enters document save or Markdown preparation; its tab can navigate to
those resources through the same address/history route as other tabs. File changes
from a focused terminal refresh a clean neighboring document without stealing
terminal focus.

Tests: `terminal-manager.test.ts`, `terminal-screen.test.ts`, `terminal-resize.test.ts`, `text-workspace.test.ts`, and real Electron
`terminal.spec.ts` cover ownership, backpressure, lifecycle, retained shell PID
and variables, actual pointer splits, native reader boundaries, resizing, and
cross-window transfer. Screen tests compare both VT buffers and continued output,
including colors, saved cursor, scrolling margins, mouse modes, Korean wide
characters and pending right-margin wrap. Real Vim transfer compares visible
rows and continues an unsaved edit after the move. The supplemental VT adapter
is isolated in `terminal-screen.ts` and pinned to xterm 6.0.0/serialize 0.14.0;
its round-trip checks must accompany upgrades. Image/video/group layout tests cover neighboring surfaces.
The native window resize test uses a real PTY program with a multiline right
prompt and zsh's redraw position. Repeated shrinking/growing and stopping at a
narrow width retain one prompt, the pending input, prior long output, and matching
grid/PTY dimensions. Timer/ownership checks cover superseded resize, output
deadlines and closing while input is waiting.
Run GUI tests on Xvfb as required by AGENTS.md. These checks are included in the
preview contract suite; the comparative latency gate still applies.
