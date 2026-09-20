# Text workspace acceptance

This feature keeps Markdown as the default new-document format and preserves its
specialized reader, render workers, source mapping, IME guards and rendered Git
review. Other supported UTF-8 files open directly in the source editor.

## Supported boundaries

- `.txt`, source/config files, extensionless files and unknown text extensions.
  Highlighting comes from Monaco's already registered language metadata. Unknown
  languages fall back to plain text; no language server or compiler is added.
- UTF-8 and UTF-8 BOM, uniform LF or CRLF, final-newline and whitespace preservation.
- Non-Markdown editing is bounded to 16 MiB. Invalid UTF-8, binary/control bytes,
  UTF-16/UTF-32, mixed endings and bare CR are rejected rather than rewritten.
  Existing Markdown read limits and decoding policy are not changed.
- Explorer, file dialog, command line, local text links, save/Save As, source-only
  Git review and document-only window transfer are connected.
- Folder search defaults to the existing Markdown scope. All Text Files is opt-in,
  reads at most 2,000,000 bytes per disk candidate, returns at most 300 matches,
  and limits additional text traversal to 25,000 candidates. Open code buffers
  override disk text, including empty buffers. Binary/unsupported files are skipped.
- Plain text does not allocate native previews, enter preview checkpoints, invoke
  Markdown viewport mapping, convert pasted URLs/images, or export through PDF.
- Git's Index comparison remains HEAD → INDEX. Working Tree continues to use the
  open document's live buffer; saving/staging behavior is not changed to disk-only.

## Checks executed during implementation

32 test bodies passed under an offline Node adapter:

- 19 file/codec/language/CLI/Git integration cases in `text-files.integration.test.ts`.
  These used actual temporary files and Git processes, not fake byte streams.
- 4 search cases with actual temporary files and an injected traversal/render service.
- 9 workspace lifecycle cases with injected editor/desktop/preview services.

The adapter replaced Vitest registration with node:test. Workspace fixtures mocked
Svelte state and preview dependencies. This is **not** a claim that the complete
repository Vitest suite or Electron app passed. Selected core document policy,
codec/save/source-search and command-line modules also passed strict TypeScript.

Full repository typecheck, Svelte template compilation, real Electron/Playwright,
OS Korean IME and timing-distribution measurements were not available in the
implementation environment because package/network access was unavailable.
No CI/workflow configuration was added or modified for this work.

## Run with normal local dependencies

```sh
npm run typecheck --workspace @setdown/desktop
npm test --workspace @setdown/desktop -- text-files.integration text-search text-workspace text-review
npm run test:e2e --workspace @setdown/desktop -- text-workspace
npm run test:e2e --workspace @setdown/desktop -- git-review-ime git-review-reading-position git-review-cold-escape
```

`text-review.test.ts` and `text-workspace.spec.ts` are additional repository-native
regressions; they were added but not executed in the offline adapter.

## Manual matrix before merge

1. Warm a math-heavy Markdown Viewer, open/edit a `.cpp`, then return. Native
   preview id/URL, reading position and Markdown layout must stay intact.
2. Open `.txt`, C++, JSON, LICENSE and an unknown UTF-8 extension from each entry
   point. Verify language highlighting, ordinary find, Esc and plain paste.
3. Save UTF-8/BOM with LF/CRLF and without a final newline. Compare original bytes
   after a no-op save. Check Save As both ways between Markdown and text; canceled
   or failed operations must not change document kind or erase newer input.
4. Review both Index and Working Tree for text files. Edit the right pane without
   autosave, confirm the ordinary tab sees the same live buffer, then stage it.
   No rendered-preview button or background Markdown work should appear.
5. Compare Markdown search with All Text Files. Test an unsaved/empty code buffer,
   invalid encodings, ignored files, rapid queries and folder switches.
6. Rename/move files, detach text tabs to a new window, move them to an existing
   window, and save again. Confirm metadata, unsaved content and source view state.
7. Type Korean with the actual OS IME in both the ordinary editor and Working Tree.
   Keep a syllable composing while background work finishes. Run the existing
   Markdown render/viewport/IME regression suites and compare warm Esc timings.

A source-only file's memory and syntax-tokenization cost is not zero. The guarded
invariant is that it does not create additional Markdown rendering work or discard
unrelated Markdown pages; timing equality still needs the same-device measurement.
