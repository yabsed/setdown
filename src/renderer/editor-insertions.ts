import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../shared/contracts';
import {
  createMarkdownLink,
  createMarkdownTable,
  preferredEol,
  type TableAlignment,
} from '../shared/markdown-insertions';

type Context = {
  editor: () => Monaco.editor.IStandaloneCodeEditor | null;
  monaco: () => typeof Monaco | null;
  model: () => Monaco.editor.ITextModel | null;
  document: () => DocumentSnapshot | null;
  editing: () => boolean;
  save: () => Promise<boolean>;
};

type TableState = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
};

const IMAGE_URL = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;
const emptyTable = (): TableState => ({
  headers: ['열 1', '열 2', '열 3'],
  rows: [['', '', ''], ['', '', '']],
  alignments: ['none', 'none', 'none'],
});

function safeExternalUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeRemoteImageUrl(value?: string | null) {
  const url = safeExternalUrl(value);
  return url && /^https?:/i.test(url) ? url : null;
}

function tableFromTsv(value: string): TableState | null {
  if (!value.includes('\t')) return null;
  const lines = value.replace(/\r\n|\r/g, '\n').split('\n').filter(Boolean);
  if (!lines.length) return null;
  const cells = lines.map((line) => line.split('\t'));
  const columns = Math.min(12, Math.max(...cells.map((row) => row.length)));
  return {
    headers: Array.from({ length: columns }, (_, column) => cells[0][column] ?? ''),
    rows: cells.slice(1, 31).map((row) =>
      Array.from({ length: columns }, (_, column) => row[column] ?? '')),
    alignments: Array(columns).fill('none') as TableAlignment[],
  };
}

export function createEditorInsertions(context: Context) {
  const element = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  const host = element<HTMLElement>('.editor-host');
  const tableDialog = element<HTMLDialogElement>('.table-dialog');
  const tableForm = element<HTMLFormElement>('.table-form');
  const columnsInput = element<HTMLInputElement>('.table-columns');
  const rowsInput = element<HTMLInputElement>('.table-rows');
  const grid = element<HTMLElement>('.table-grid-editor');
  const linkDialog = element<HTMLDialogElement>('.link-dialog');
  const linkForm = element<HTMLFormElement>('.link-form');
  const labelInput = element<HTMLInputElement>('.link-label');
  const destinationInput = element<HTMLInputElement>('.link-destination');
  const titleInput = element<HTMLInputElement>('.link-title');
  const linkError = element<HTMLElement>('.dialog-error');

  let tableSelection: Monaco.Selection | null = null;
  let linkSelection: Monaco.Selection | null = null;
  let table = emptyTable();
  let pastingImage = false;

  const bounded = (input: HTMLInputElement, fallback: number, maximum: number) => {
    const value = Number.parseInt(input.value, 10);
    return Math.max(
      Number(input.min) || 0,
      Math.min(maximum, Number.isFinite(value) ? value : fallback),
    );
  };

  function readTable(): TableState {
    const columns = bounded(columnsInput, 3, 12);
    const rows = bounded(rowsInput, 2, 30);
    return {
      headers: Array.from(grid.querySelectorAll<HTMLInputElement>('[data-table-header]'), (input) => input.value),
      alignments: Array.from(
        grid.querySelectorAll<HTMLSelectElement>('[data-table-alignment]'),
        (select) => select.value as TableAlignment,
      ),
      rows: Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) =>
          grid.querySelector<HTMLInputElement>(
            `[data-table-row="${row}"][data-table-column="${column}"]`,
          )?.value ?? '')),
    };
  }

  function renderTable() {
    const columns = bounded(columnsInput, 3, 12);
    const rows = bounded(rowsInput, 2, 30);
    table = {
      headers: Array.from({ length: columns }, (_, column) => table.headers[column] ?? `열 ${column + 1}`),
      alignments: Array.from({ length: columns }, (_, column) => table.alignments[column] ?? 'none'),
      rows: Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => table.rows[row]?.[column] ?? '')),
    };
    columnsInput.value = String(columns);
    rowsInput.value = String(rows);
    grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    grid.style.minWidth = `${columns * 170}px`;

    for (let column = 0; column < columns; column += 1) {
      const header = document.createElement('div');
      const input = document.createElement('input');
      const alignment = document.createElement('select');
      header.className = 'table-column-header';
      input.value = table.headers[column];
      input.dataset.tableHeader = String(column);
      input.ariaLabel = `${column + 1}열 제목`;
      alignment.dataset.tableAlignment = String(column);
      alignment.ariaLabel = `${column + 1}열 정렬`;
      for (const [value, label] of [
        ['none', '기본 정렬'], ['left', '왼쪽 정렬'],
        ['center', '가운데 정렬'], ['right', '오른쪽 정렬'],
      ] as Array<[TableAlignment, string]>) {
        alignment.add(new Option(label, value, false, table.alignments[column] === value));
      }
      header.append(input, alignment);
      grid.append(header);
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const input = document.createElement('input');
        input.className = 'table-cell-input';
        input.value = table.rows[row][column];
        input.dataset.tableRow = String(row);
        input.dataset.tableColumn = String(column);
        input.ariaLabel = `${row + 1}행 ${column + 1}열`;
        grid.append(input);
      }
    }
  }

  function openTable() {
    const editor = context.editor();
    const model = context.model();
    if (!editor || !model || !context.editing()) return;
    tableSelection = editor.getSelection();
    table = tableFromTsv(tableSelection ? model.getValueInRange(tableSelection) : '') ?? emptyTable();
    columnsInput.value = String(table.headers.length);
    rowsInput.value = String(table.rows.length);
    renderTable();
    tableDialog.showModal();
    grid.querySelector<HTMLInputElement>('[data-table-header]')?.select();
  }

  function insertTable() {
    const editor = context.editor();
    const monaco = context.monaco();
    const model = context.model();
    if (!editor || !monaco || !model || !tableSelection) return;
    table = readTable();
    const eol = preferredEol(model.getValue());
    const markdown = createMarkdownTable(table, eol);
    const range = monaco.Range.lift(tableSelection);
    const start = model.getOffsetAt(range.getStartPosition());
    const before = model.getValue().slice(0, start);
    const after = model.getValue().slice(model.getOffsetAt(range.getEndPosition()));
    const prefix = !before || /(?:\r\n|\r|\n){2}$/.test(before) ? ''
      : /(?:\r\n|\r|\n)$/.test(before) ? eol : eol + eol;
    const suffix = !after || /^(?:\r\n|\r|\n){2}/.test(after) ? ''
      : /^(?:\r\n|\r|\n)/.test(after) ? eol : eol + eol;
    editor.executeEdits('insert-table', [{ range, text: prefix + markdown + suffix, forceMoveMarkers: true }]);
    const headerStart = start + prefix.length + 2;
    editor.setSelection(monaco.Selection.fromPositions(
      model.getPositionAt(headerStart),
      model.getPositionAt(headerStart + table.headers[0].length),
    ));
    editor.focus();
  }

  function openLink() {
    const editor = context.editor();
    const model = context.model();
    if (!editor || !model || !context.editing()) return;
    linkSelection = editor.getSelection();
    const selected = linkSelection ? model.getValueInRange(linkSelection) : '';
    const selectedUrl = safeExternalUrl(selected);
    labelInput.value = selected.replace(/\r\n|\r|\n/g, ' ');
    destinationInput.value = selectedUrl ?? '';
    titleInput.value = '';
    linkError.hidden = true;
    linkDialog.showModal();
    (selectedUrl ? labelInput : destinationInput).focus();
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

  async function pasteImage(remoteUrl: string | null) {
    const editor = context.editor();
    if (!editor || !context.model() || !context.document() || pastingImage) return;
    pastingImage = true;
    const selection = editor.getSelection();
    try {
      if (remoteUrl) insertImage(`![외부 이미지](<${remoteUrl}>)`, selection);
      else {
        const result = await window.marktex.pasteClipboardImage();
        if (!result.canceled && result.markdown) insertImage(result.markdown, selection);
      }
    } catch (error) {
      window.alert(`이미지를 붙여넣지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pastingImage = false;
    }
  }

  host.addEventListener('paste', (event) => {
    const editor = context.editor();
    const model = context.model();
    if (!editor) return;
    const selection = editor.getSelection();
    const plain = event.clipboardData?.getData('text/plain').trim() ?? '';
    const pastedUrl = safeExternalUrl(plain);
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
    const remoteImage = safeRemoteImageUrl(htmlImage)
      ?? (IMAGE_URL.test(plain) ? safeRemoteImageUrl(plain) : null);
    const types = Array.from(event.clipboardData?.types ?? [], (type) => type.toLowerCase());
    const storedImage = Array.from(event.clipboardData?.items ?? []).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    ) || types.some((type) => type === 'files' || type.includes('uri-list') || type.includes('gnome-copied-files'))
      || (plain.startsWith('file://') && IMAGE_URL.test(plain));
    if (!remoteImage && !storedImage) return;
    event.preventDefault();
    event.stopPropagation();
    void pasteImage(remoteImage);
  }, { capture: true });

  element('.insert-table-button').addEventListener('click', openTable);
  element('.insert-link-button').addEventListener('click', openLink);
  for (const input of [columnsInput, rowsInput]) {
    input.addEventListener('change', () => {
      table = readTable();
      renderTable();
    });
  }
  element('.table-submit').addEventListener('click', () => {
    insertTable();
    tableDialog.close();
  });
  tableForm.addEventListener('submit', (event) => event.preventDefault());
  tableForm.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (!grid.contains(event.target)) return event.target.blur();
    const inputs = Array.from(grid.querySelectorAll<HTMLInputElement>('input'));
    const next = inputs[inputs.indexOf(event.target) + (event.shiftKey ? -1 : 1)];
    next?.focus();
    next?.select();
  });
  tableDialog.querySelectorAll('.dialog-close, .table-cancel').forEach((button) =>
    button.addEventListener('click', () => tableDialog.close()));
  tableDialog.addEventListener('close', () => {
    tableSelection = null;
    context.editor()?.focus();
  });

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!linkSelection) return;
    try {
      insertLink(labelInput.value, destinationInput.value, titleInput.value, linkSelection);
      linkDialog.close();
    } catch (error) {
      linkError.textContent = error instanceof Error ? error.message : String(error);
      linkError.hidden = false;
    }
  });
  linkDialog.querySelectorAll('.dialog-close, .link-cancel').forEach((button) =>
    button.addEventListener('click', () => linkDialog.close()));
  linkDialog.addEventListener('close', () => {
    linkSelection = null;
    context.editor()?.focus();
  });
  element('.pick-link-file').addEventListener('click', async () => {
    linkError.hidden = true;
    let current = context.document();
    if (!current) return;
    if (current.isUntitled) {
      await context.save();
      current = context.document();
      if (!current || current.isUntitled) {
        linkError.textContent = '로컬 파일의 상대 경로를 만들려면 문서를 먼저 저장해야 합니다.';
        linkError.hidden = false;
        return;
      }
    }
    const result = await window.marktex.pickLinkTarget(current.path);
    if (result.canceled || !result.destination) return;
    destinationInput.value = result.destination;
    if (!labelInput.value && result.label) labelInput.value = result.label;
    titleInput.focus();
  });

  return { openTable, openLink };
}
