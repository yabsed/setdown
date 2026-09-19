import { createMarkdownLink, createMarkdownTable, preferredEol } from '../../core/markdown/markdown-insertions';
import { emptyTable, insertion, type TableDraft } from './insertion-state.svelte';
import type { DesktopPort } from '../ports/desktop-port';
import { captureInsertion, pasteTarget, replaceSelection, stillCurrent,
  type EditingContext, type InsertionTarget } from './markdown-editing-target';

type Context = EditingContext & { desktop: DesktopPort; host: HTMLElement; save(): Promise<boolean> };
const STALE_TARGET = 'The document changed. Reopen this dialog at the intended location.';

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const trimmed = value.trim();
    const url = new URL(/^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function tableFromTsv(value: string): TableDraft | null {
  if (!value.includes('\t')) return null;
  const lines = value.replace(/\r\n|\r/g, '\n').split('\n').filter(Boolean);
  if (!lines.length) return null;
  const cells = lines.map((line) => line.split('\t'));
  const columns = Math.min(12, Math.max(...cells.map((row) => row.length)));
  return {
    headers: Array.from({ length: columns }, (_, column) => cells[0][column] ?? ''),
    rows: cells.slice(1, 31).map((row) => Array.from({ length: columns }, (_, column) => row[column] ?? '')),
    alignments: Array(columns).fill('none'),
  };
}

export function createEditorInsertions(context: Context) {
  let tableTarget: InsertionTarget | null = null;
  let linkTarget: InsertionTarget | null = null;
  let escapeEcho: { origin: 'dom' | 'native'; at: number } | null = null;
  let disposed = false;

  function focus(target: InsertionTarget | null) {
    if (target && stillCurrent(context, target, false)) target.editor.focus();
  }
  function closeTable() {
    const target = tableTarget;
    insertion.tableOpen = false;
    tableTarget = null;
    focus(target);
  }
  function closeLink() {
    const target = linkTarget;
    insertion.linkOpen = false;
    linkTarget = null;
    focus(target);
  }
  function openTable() {
    if (insertion.tableOpen) return closeTable();
    const target = captureInsertion(context);
    if (!target) return;
    insertion.linkOpen = false;
    linkTarget = null;
    tableTarget = target;
    insertion.tableError = '';
    insertion.table = tableFromTsv(target.model.getValueInRange(target.selection)) ?? emptyTable();
    insertion.tableOpen = true;
    escapeEcho = null;
  }
  function submitTable() {
    const target = tableTarget;
    if (!target || !stillCurrent(context, target)) {
      insertion.tableError = STALE_TARGET;
      return;
    }
    const { model, editor, monaco, selection } = target;
    const value = model.getValue();
    const eol = preferredEol(value);
    const markdown = createMarkdownTable(insertion.table, eol);
    const range = monaco.Range.lift(selection);
    const start = model.getOffsetAt(range.getStartPosition());
    const before = value.slice(0, start);
    const after = value.slice(model.getOffsetAt(range.getEndPosition()));
    const prefix = !before || /(?:\r\n|\r|\n){2}$/.test(before) ? ''
      : /(?:\r\n|\r|\n)$/.test(before) ? eol : eol + eol;
    const suffix = !after || /^(?:\r\n|\r|\n){2}/.test(after) ? ''
      : /^(?:\r\n|\r|\n)/.test(after) ? eol : eol + eol;
    replaceSelection(target, 'insert-table', prefix + markdown + suffix);
    const headerStart = start + prefix.length + 2;
    editor.setSelection(monaco.Selection.fromPositions(model.getPositionAt(headerStart),
      model.getPositionAt(headerStart + insertion.table.headers[0].length)));
    closeTable();
  }
  function openLink() {
    if (insertion.linkOpen) return closeLink();
    const target = captureInsertion(context);
    if (!target) return;
    insertion.tableOpen = false;
    tableTarget = null;
    linkTarget = target;
    const selected = target.model.getValueInRange(target.selection);
    insertion.linkLabel = selected.replace(/\r\n|\r|\n/g, ' ');
    insertion.linkDestination = safeUrl(selected) ?? '';
    insertion.linkTitle = '';
    insertion.linkError = '';
    insertion.linkOpen = true;
    escapeEcho = null;
  }
  function insertLink(target: InsertionTarget, label: string, destination: string, title: string) {
    if (!stillCurrent(context, target)) throw new Error(STALE_TARGET);
    const markdown = createMarkdownLink(label, destination, title);
    const start = replaceSelection(target, 'insert-link', markdown);
    const { editor, monaco, model } = target;
    editor.setSelection(label
      ? monaco.Selection.fromPositions(model.getPositionAt(start + markdown.length))
      : monaco.Selection.fromPositions(model.getPositionAt(start + 1),
        model.getPositionAt(start + 1 + destination.trim().length)));
    editor.focus();
  }
  function submitLink() {
    if (!linkTarget) return;
    try {
      insertLink(linkTarget, insertion.linkLabel,
        safeUrl(insertion.linkDestination) ?? insertion.linkDestination, insertion.linkTitle);
      closeLink();
    } catch (error) {
      insertion.linkError = error instanceof Error ? error.message : String(error);
    }
  }
  async function pickLinkFile() {
    let target = linkTarget;
    if (!target || !stillCurrent(context, target)) { insertion.linkError = STALE_TARGET; return; }
    insertion.linkError = '';
    try {
      if (target.document.isUntitled) {
        const oldText = target.model.getValue();
        const saved = await context.save();
        if (disposed || linkTarget !== target) return;
        const next = captureInsertion(context);
        if (!saved || !next || next.document.isUntitled) {
          insertion.linkError = 'Save the document before linking to a local file.';
          return;
        }
        // Save As may replace the ordinary model/path, but not the dialog's document or text.
        if (next.identity !== target.identity || next.model.getValue() !== oldText) {
          insertion.linkError = STALE_TARGET;
          return;
        }
        target = { ...next, selection: target.selection };
        linkTarget = target;
      }
      const result = await context.desktop.pickLinkTarget(target.path);
      if (disposed || linkTarget !== target || !insertion.linkOpen) return;
      if (!stillCurrent(context, target)) { insertion.linkError = STALE_TARGET; return; }
      if (result.canceled || !result.destination) return;
      insertion.linkDestination = result.destination;
      if (!insertion.linkLabel && result.label) insertion.linkLabel = result.label;
    } catch (error) {
      if (!disposed && linkTarget === target) insertion.linkError = error instanceof Error ? error.message : String(error);
    }
  }

  const paste = (event: ClipboardEvent) => {
    if (disposed) return;
    const target = pasteTarget(context, event);
    if (!target || target.selection.isEmpty()) return;
    const url = safeUrl(event.clipboardData?.getData('text/plain').trim());
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();
    insertLink(target, target.model.getValueInRange(target.selection), url, '');
  };
  context.host.addEventListener('paste', paste, { capture: true });

  /** DOM and Electron deliver the same Escape separately. Consume its opposite-route echo,
   * without waiting, scheduling a timer, or delaying ordinary surface transitions. */
  function dismissOnEscape(origin: 'dom' | 'native'): boolean {
    const now = performance.now();
    if (escapeEcho && escapeEcho.origin !== origin && now - escapeEcho.at < 100) {
      escapeEcho = null;
      return true;
    }
    if (!insertion.linkOpen && !insertion.tableOpen) return false;
    if (insertion.tableOpen) closeTable();
    if (insertion.linkOpen) closeLink();
    escapeEcho = { origin, at: now };
    return true;
  }

  return {
    closeLink, closeTable, openLink, openTable, pickLinkFile, submitLink, submitTable, dismissOnEscape,
    dispose() {
      disposed = true;
      context.host.removeEventListener('paste', paste, { capture: true });
      insertion.linkOpen = insertion.tableOpen = false;
      linkTarget = tableTarget = null;
    },
  };
}
