import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import { createMarkdownLink, createMarkdownTable, preferredEol } from '../../core/markdown/markdown-insertions';
import { emptyTable, insertion, type TableDraft } from './insertion-state.svelte';
import type { DesktopPort } from '../ports/desktop-port';

type Context = {
  desktop: DesktopPort;
  host: HTMLElement;
  editor: () => Monaco.editor.IStandaloneCodeEditor | null;
  monaco: () => typeof Monaco | null;
  model: () => Monaco.editor.ITextModel | null;
  document: () => DocumentSnapshot | null;
  editing: () => boolean;
  save: () => Promise<boolean>;
};

const IMAGE_URL = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function remoteImageUrl(value?: string | null) {
  const url = safeUrl(value);
  return url && /^https?:/i.test(url) ? url : null;
}

function tableFromTsv(value: string): TableDraft | null {
  if (!value.includes('\t')) return null;
  const lines = value.replace(/\r\n|\r/g, '\n').split('\n').filter(Boolean);
  if (!lines.length) return null;
  const cells = lines.map((line) => line.split('\t'));
  const columns = Math.min(12, Math.max(...cells.map((row) => row.length)));
  return {
    headers: Array.from({ length: columns }, (_, column) => cells[0][column] ?? ''),
    rows: cells.slice(1, 31).map((row) =>
      Array.from({ length: columns }, (_, column) => row[column] ?? '')),
    alignments: Array(columns).fill('none'),
  };
}

export function createEditorInsertions(context: Context) {
  let tableSelection: Monaco.Selection | null = null;
  let linkSelection: Monaco.Selection | null = null;
  let pastingImage = false;

  function openTable() {
    const editor = context.editor();
    const model = context.model();
    if (!editor || !model || !context.editing()) return;
    tableSelection = editor.getSelection();
    insertion.table = tableFromTsv(
      tableSelection ? model.getValueInRange(tableSelection) : '',
    ) ?? emptyTable();
    insertion.tableOpen = true;
  }

  function closeTable() {
    insertion.tableOpen = false;
    tableSelection = null;
    context.editor()?.focus();
  }

  function submitTable() {
    const editor = context.editor();
    const monaco = context.monaco();
    const model = context.model();
    if (!editor || !monaco || !model || !tableSelection) return;
    const eol = preferredEol(model.getValue());
    const markdown = createMarkdownTable(insertion.table, eol);
    const range = monaco.Range.lift(tableSelection);
    const start = model.getOffsetAt(range.getStartPosition());
    const before = model.getValue().slice(0, start);
    const after = model.getValue().slice(model.getOffsetAt(range.getEndPosition()));
    const prefix = !before || /(?:\r\n|\r|\n){2}$/.test(before) ? ''
      : /(?:\r\n|\r|\n)$/.test(before) ? eol : eol + eol;
    const suffix = !after || /^(?:\r\n|\r|\n){2}/.test(after) ? ''
      : /^(?:\r\n|\r|\n)/.test(after) ? eol : eol + eol;
    editor.executeEdits('insert-table', [{
      range,
      text: prefix + markdown + suffix,
      forceMoveMarkers: true,
    }]);
    const headerStart = start + prefix.length + 2;
    editor.setSelection(monaco.Selection.fromPositions(
      model.getPositionAt(headerStart),
      model.getPositionAt(headerStart + insertion.table.headers[0].length),
    ));
    closeTable();
  }

  function openLink() {
    const editor = context.editor();
    const model = context.model();
    if (!editor || !model || !context.editing()) return;
    linkSelection = editor.getSelection();
    const selected = linkSelection ? model.getValueInRange(linkSelection) : '';
    const selectedUrl = safeUrl(selected);
    insertion.linkLabel = selected.replace(/\r\n|\r|\n/g, ' ');
    insertion.linkDestination = selectedUrl ?? '';
    insertion.linkTitle = '';
    insertion.linkError = '';
    insertion.linkOpen = true;
  }

  function closeLink() {
    insertion.linkOpen = false;
    linkSelection = null;
    context.editor()?.focus();
  }

  function insertLink(label: string, destination: string, title: string, selection: Monaco.Selection) {
    const editor = context.editor();
    const monaco = context.monaco();
    const model = context.model();
    if (!editor || !monaco || !model) return;
    const markdown = createMarkdownLink(label, destination, title);
    const range = monaco.Range.lift(selection);
    const start = model.getOffsetAt(range.getStartPosition());
    editor.executeEdits('insert-link', [{ range, text: markdown, forceMoveMarkers: true }]);
    editor.setSelection(label
      ? monaco.Selection.fromPositions(model.getPositionAt(start + markdown.length))
      : monaco.Selection.fromPositions(
        model.getPositionAt(start + 1),
        model.getPositionAt(start + 1 + destination.trim().length),
      ));
    editor.focus();
  }

  function submitLink() {
    if (!linkSelection) return;
    try {
      insertLink(
        insertion.linkLabel,
        insertion.linkDestination,
        insertion.linkTitle,
        linkSelection,
      );
      closeLink();
    } catch (error) {
      insertion.linkError = error instanceof Error ? error.message : String(error);
    }
  }

  async function pickLinkFile() {
    insertion.linkError = '';
    let current = context.document();
    if (!current) return;
    if (current.isUntitled) {
      await context.save();
      current = context.document();
      if (!current || current.isUntitled) {
        insertion.linkError = '로컬 파일의 상대 경로를 만들려면 문서를 먼저 저장해야 합니다.';
        return;
      }
    }
    const result = await context.desktop.pickLinkTarget(current.path);
    if (result.canceled || !result.destination) return;
    insertion.linkDestination = result.destination;
    if (!insertion.linkLabel && result.label) insertion.linkLabel = result.label;
  }

  function insertImage(markdown: string, selection: Monaco.Selection | null) {
    const editor = context.editor();
    const monaco = context.monaco();
    const model = context.model();
    if (!editor || !monaco || !model) return;
    const range = selection ? monaco.Range.lift(selection) : new monaco.Range(1, 1, 1, 1);
    const end = model.getOffsetAt(range.getStartPosition()) + markdown.length;
    editor.executeEdits('paste-image', [{ range, text: markdown, forceMoveMarkers: true }]);
    editor.setPosition(model.getPositionAt(end));
    editor.focus();
  }

  async function pasteImage(remote: string | null) {
    const editor = context.editor();
    if (!editor || !context.model() || !context.document() || pastingImage) return;
    pastingImage = true;
    const selection = editor.getSelection();
    try {
      if (remote) insertImage(`![외부 이미지](<${remote}>)`, selection);
      else {
        const result = await context.desktop.pasteClipboardImage();
        if (!result.canceled && result.markdown) insertImage(result.markdown, selection);
      }
    } catch (error) {
      window.alert(`이미지를 붙여넣지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pastingImage = false;
    }
  }

  context.host.addEventListener('paste', (event) => {
    const editor = context.editor();
    const model = context.model();
    if (!editor) return;
    const selection = editor.getSelection();
    const plain = event.clipboardData?.getData('text/plain').trim() ?? '';
    const pastedUrl = safeUrl(plain);
    if (selection && !selection.isEmpty() && pastedUrl && model) {
      event.preventDefault();
      event.stopPropagation();
      insertLink(model.getValueInRange(selection), pastedUrl, '', selection);
      return;
    }
    const html = event.clipboardData?.getData('text/html');
    const htmlImage = html
      ? new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.getAttribute('src')
      : null;
    const remote = remoteImageUrl(htmlImage) ?? (IMAGE_URL.test(plain) ? remoteImageUrl(plain) : null);
    const types = Array.from(event.clipboardData?.types ?? [], (type) => type.toLowerCase());
    const stored = Array.from(event.clipboardData?.items ?? []).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    ) || types.some((type) => type === 'files' || type.includes('uri-list')
      || type.includes('gnome-copied-files'))
      || (plain.startsWith('file://') && IMAGE_URL.test(plain));
    if (!remote && !stored) return;
    event.preventDefault();
    event.stopPropagation();
    void pasteImage(remote);
  }, { capture: true });

  return {
    closeLink,
    closeTable,
    openLink,
    openTable,
    pickLinkFile,
    submitLink,
    submitTable,
  };
}
