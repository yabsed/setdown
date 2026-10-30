# Editor tools

Open **File → Commands…** (`Ctrl/Cmd+Shift+P`) or the source editor's **Setdown:
Search Commands…** context action. The palette combines Setdown commands with the
installed Monaco actions, searches prefixes/substrings/fuzzy matches, and prefers
recent successful commands. Unavailable commands show their reason. **Command
help and examples**, **Inspect keyboard commands**, **Show effective settings for
this file**, **Inspect language support and analysis environment**, and **Show
command messages** explain the current scope and recent failures.

## Selection and editing

Inside/around targets include Unicode words, whitespace-delimited chunks, escaped
single-line strings, sentences, paragraphs, parsed Markdown sections, fences,
list items, inline link labels/destinations and table cells. Malformed or unsupported
targets fail without editing. Bracket/tag semantic expansion, column selection,
word/subword movement, comment, indentation, case, ordinary sort/join, folding,
find/replace and display-line movement use Monaco's installed contributions.
These are Setdown/Monaco semantics, not a Vim parser or Vim regular expressions.

Additional commands join without spaces, sort numerically, remove duplicate lines
(with or without sorting), change exact integers (including signed/padded and
base-prefixed integers), number multiple selections, reflow prose and transform
matching lines after a preview. Reflow rejects Markdown structural lines and hard
line breaks. A selection ending at column 1 excludes that final line. Line-ending
conversion is explicit and undoable; UTF-8 BOM preservation remains with saving.

**Repeat last semantic edit** re-evaluates a supported target at the new cursor.
Numeric transforms, line transforms, reflow, structured replacement/deletion and
single search replacements retain their intent after success. A repeat count means
that many new executions (1–100); each completed edit has its own Undo step.
There is no raw keystroke macro, cross-file atomic Undo, branching/persistent Undo,
arbitrary shell filter, modeline execution or Vimscript runtime. Version changes,
read-only state, IME composition and overlapping edits prevent stale mutations.

## Copy store and navigation

Explicit copy/cut and structured deletion retain up to 40 entries, each at most
1,048,576 UTF-16 code units, with timestamp/path, optional name and pin. Character/line/multiple
cursor fragments keep their order. Matching cursor counts paste corresponding
fragments; one fragment broadcasts. Other counts require the explicit **Paste a
combined copy** command. Line copies insert complete lines at empty selections.
Append requires the same shape and fragment count. All slots pinned is reported
without evicting a pin or replacing the last successful copy.

Ordinary Delete does not populate the store or overwrite **Paste last explicit
copy**. Cut has separate history. Copy/paste feedback is short and honors reduced
motion. Copies, result snapshots, commands, searches and named locations are
**window-memory only**, discarded when that renderer is reloaded or closed.
They are not uploaded or added to workspace snapshots. The OS clipboard remains
separate. The personal English spelling dictionary follows Electron's own lifetime.

Navigation history (100 locations), edit locations (100), named bookmarks and the
alternate file are separate from a tab's address history. Live decoration anchors
follow edits and renames. Continuous typing groups nearby changes; internal
preview/restore movements do not add user jumps. Closed-file context is checked:
a unique matching line relocates automatically; ambiguous/missing context offers
an approximate location or cancellation. Notebook locations include stable cell
IDs; deleted cells fail explicitly.

## Search and result lists

Smart search is literal: lowercase queries ignore case, uppercase makes the query
case-sensitive. Input previews a location; cancel restores the original view.
Hiding highlights retains the query. Word search, next/previous and repeatable
single-match replacement are separate commands. Monaco's find/replace retains its
own regex, selection scope, capture replacement and history behavior.

Search, language references/symbols/problems, spelling and collected terminal
locations enter one result-history model. Each group owns its selection. Up to
30 lists with 1,000 entries each retain title/provider/query/root/time, selected
item, truncation and stale state. Filtering creates a derived list; previous/next
lists do not rerun their providers. Pinning protects against eviction. Next/previous
item and next/previous file navigate without needing the panel. A group's captured
query result is not reassigned to whichever group later receives focus.

**Collect file locations from terminal output** reads the last 5,000 terminal
lines and asks for the relative-path base directory (the terminal's start directory
is a suggestion, not a claim about its current shell directory). The bounded parser
accepts `file:line:column` diagnostics and Python traceback locations, retains a
sample of unparsed output, and starts no process.

## Settings, completion and writing

EditorConfig reads are bounded to 256 KiB per file and stop at the project boundary
or `root=true`. Supported globs include nested paths, alternatives, character
classes and bounded numeric ranges. `indent_style`, `indent_size` and `tab_width`
affect the shared buffer. `end_of_line` is reported as requested policy; conversion
requires the explicit command. Unsupported charset/trailing-space/final-newline
rules are displayed, not silently applied. File-local indentation overrides can
be reset to inheritance. Effective settings show actual values and declaration
sources, plus the analysis environment's observable configuration.

Display options (line numbers, whitespace, wrap, rulers, indentation guides),
automatic suggestion visibility and delay belong to a view. Word-suggestion
source scope belongs to Monaco's workspace setting. Switching models reapplies
the destination view's options. Explicit line/path completion, a symbol picker,
small document templates and named copy fragments work without a language server.
Function/class motions use LSP symbols; notebook cells use their outline.
Markdown heading movement uses parsed headings and ignores fence lookalikes.

English prose spelling is explicit and bounded to 2,000 distinct words. Fenced
and inline code, HTML blocks/tags and URLs are excluded. Suggestions, one-occurrence
replacement, result navigation and adding a personal word are available when
Electron's English dictionary has loaded. An unavailable/unloaded dictionary is
reported, not mistaken for zero spelling errors. This is not Korean grammar
checking or full linguistic analysis.

## Groups, sessions and recovery

Ordinary text and editable Working Tree tabs share content, save state and Undo,
while each view owns its cursor, folding, scroll, mode and zoom. Use split in any
of four directions, Copy/Move editor to group, next/previous group, equalize,
maximize/restore or optional source-line scroll linking. Scroll linking changes
no keyboard focus and is removed when either editor closes or changes its model.
SCM and comparison toolbars offer explicit side opens. Other document owners
(notebook, media), terminals and web tabs retain their existing lifetimes.

**Save workspace snapshot** records a declarative version-1 manifest: project,
group tree, file/comparison views, view state and dirty text. **Create a content
checkpoint** also includes saved text. **Restore a workspace or recovery snapshot**
is explicit, additive and confirmed in the application; it never writes an original
file. Changed/missing disk baselines or an already-dirty owner recover into a
separate untitled document. Unavailable files/projects and partial failures are
reported. Damaged/unsupported manifests are rejected before layout restoration.

Recovery captures dirty contents every five seconds and writes a serialized,
atomic JSON artifact in Electron userData's `workspace-snapshots` directory.
A forced exit can recover the **latest completed snapshot**, not every keystroke.
A window's clean periodic checkpoint removes that window's recovery artifact;
older recovery artifacts remain until removed explicitly. Normal new processes
still start empty; a recovery affordance offers explicit restore. Renderer Reload
retains the existing native-window active-review checkpoint, a separate lifetime.

Limits: 100 artifacts, 32 MiB per stored JSON envelope, 24 MiB captured text,
200 contents, 500 views and 32 groups per workspace snapshot. Individual Monaco
view-state JSON is bounded to 1 MiB. Atomic files use mode 0600. Artifacts may
contain private document text: **Remove a saved snapshot** deletes the selected
artifact only. There is no automatic pruning of user checkpoints or cross-window
shared Undo. Browser pages, running terminals/kernels and persistent Undo stacks
are not serialized into this manifest.
