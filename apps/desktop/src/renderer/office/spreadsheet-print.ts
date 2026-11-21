/**
 * Lays a workbook out for paper. File Viewer draws sheets on a virtual canvas and offers no
 * print of its own, so the same parsed model (values as displayed, cell formats, merges, sizes,
 * pictures and charts) becomes one real table per sheet: text stays selectable in the PDF.
 *
 * Paper follows the usual spreadsheet export: A4, landscape once a sheet is wider than a
 * portrait page, columns scaled down to fit the page width. Below MIN_SCALE the text would be
 * unreadable, so wider sheets continue in further column bands (down, then over).
 */
export type PrintCell = { className?: string; style?: Record<string, string>; richText?: PrintRun[] };
export type PrintRun = { text: string; fontFamily?: string; fontSize?: number; color?: string; bold?: boolean;
  italic?: boolean; underline?: boolean; strike?: boolean; verticalAlign?: 'sub' | 'super' };
export type PrintPicture = { left: number; top: number; width: number; height: number; row: number; col: number };
export type PrintSheet = {
  name: string;
  /** Displayed text by row and column; ragged rows are padded. */
  data: string[][];
  /** Formats keyed `row-col`. */
  cell: Record<string, PrintCell>;
  merge: { row: number; col: number; rowspan: number; colspan: number }[];
  colWidths: number | number[] | undefined; rowHeights: number | number[] | undefined;
  hiddenColumns: ReadonlySet<number>;
  defaults: { colWidth: number; rowHeight: number };
  images: (PrintPicture & { src: string })[];
  charts: (PrintPicture & { element: HTMLElement })[];
};
export type SheetPlan = {
  /** Visible column and row indexes that reach the paper, in order. */
  cols: number[]; rows: number[];
  width: number; landscape: boolean; scale: number;
  /** Column bands; each is a run of indexes into `cols`. */
  bands: { from: number; to: number }[];
};

const PX_PER_MM = 96 / 25.4;
export const PAGE = { short: 210 * PX_PER_MM, long: 297 * PX_PER_MM, margin: 10 * PX_PER_MM };
export const MIN_SCALE = .5;
/** A table this size already fills hundreds of pages; beyond it the export process runs out of memory. */
export const MAX_CELLS = 400_000;
const FONTS = 'Calibri, Carlito, Aptos, "Segoe UI", "Noto Sans", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const NUMERIC = /^[\s(+\-−]*[$€£¥₩]?\s*\d[\d,.\s]*(?:[eE][+-]?\d+)?\s*[%)]?\s*[$€£¥₩]?$/;

const size = (sizes: number | number[] | undefined, index: number, fallback: number) => {
  const value = typeof sizes === 'number' ? sizes : sizes?.[index];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
};
const formatted = (cell: PrintCell | undefined) => !!cell?.style
  && Object.keys(cell.style).some(key => key === 'backgroundColor' || key.startsWith('border'));

/** Which rows and columns are printed, on what paper, at what scale. */
export function planSheet(sheet: PrintSheet): SheetPlan {
  // The declared range often runs past the content (formatted but empty rows, stray dimensions).
  let lastRow = -1, lastCol = -1;
  const reach = (row: number, col: number) => { if (row > lastRow) lastRow = row; if (col > lastCol) lastCol = col; };
  sheet.data.forEach((row, r) => { for (let c = row.length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) { reach(r, c); break; } });
  for (const [key, cell] of Object.entries(sheet.cell)) {
    if (!formatted(cell) && !cell.richText?.length) continue;
    const [row, col] = key.split('-').map(Number); reach(row, col);
  }
  const widthOf = (col: number) => sheet.hiddenColumns.has(col) ? 0 : size(sheet.colWidths, col, sheet.defaults.colWidth);
  const heightOf = (row: number) => size(sheet.rowHeights, row, sheet.defaults.rowHeight);
  // A picture or chart keeps the rows and columns it covers.
  for (const item of [...sheet.images, ...sheet.charts]) {
    let col = item.col, row = item.row;
    for (let right = item.left + item.width, x = 0, c = 0; c < 16_384 && x < right; c++) { x += widthOf(c); col = Math.max(col, c); }
    for (let bottom = item.top + item.height, y = 0, r = 0; r < 1_048_576 && y < bottom; r++) { y += heightOf(r); row = Math.max(row, r); }
    reach(row, col);
  }
  const cols: number[] = [], rows: number[] = [];
  for (let col = 0; col <= lastCol; col++) if (widthOf(col) > 0) cols.push(col);
  for (let row = 0; row <= lastRow; row++) if (heightOf(row) > 0) rows.push(row);
  const width = cols.reduce((sum, col) => sum + widthOf(col), 0);
  const portrait = PAGE.short - 2 * PAGE.margin, wide = PAGE.long - 2 * PAGE.margin;
  const landscape = width > portrait;
  const available = landscape ? wide : portrait;
  const scale = Math.max(MIN_SCALE, Math.min(1, available / Math.max(1, width)));
  const bands: SheetPlan['bands'] = [];
  for (let from = 0; from < cols.length;) {
    let to = from, used = 0;
    // A column wider than the page still gets a band of its own.
    while (to < cols.length && (to === from || (used + widthOf(cols[to])) * scale <= available + .5)) used += widthOf(cols[to++]);
    bands.push({ from, to }); from = to;
  }
  return { cols, rows, width, landscape, scale, bands };
}

const STYLE = `
@page { size: A4 portrait; margin: 10mm; }
@page wide { size: A4 landscape; margin: 10mm; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
body { font: 11pt/1.2 ${FONTS}; }
.sheet { break-before: page; }
.sheet:first-child { break-before: auto; }
.sheet.wide { page: wide; }
.sheet-name { margin: 0 0 6px; font: 600 9pt/1.3 ${FONTS}; color: #555; break-after: avoid; }
.sheet-band + .sheet-band { break-before: page; }
table { table-layout: fixed; border-collapse: collapse; width: max-content; }
tr { break-inside: avoid; }
td { position: relative; box-sizing: border-box; padding: 0 2px; border: .5px solid #d4d4d4; vertical-align: bottom;
  white-space: nowrap; overflow: visible; text-align: left; }
td.clip { overflow: hidden; }
td.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
td.right { text-align: right; } td.center { text-align: center; }
td.top { vertical-align: top; } td.middle { vertical-align: middle; }
.anchor { position: absolute; z-index: 1; left: 0; top: 0; width: 0; height: 0; overflow: visible; }
.anchor > img, .anchor > .chart { position: absolute; display: block; max-width: none; }
/* A picture keeps its shape inside the box its anchor gives it, as it does on screen. */
.anchor > img { object-fit: contain; }
.chart svg { display: block; width: 100%; height: 100%; }
.empty { margin: 0; color: #555; }
`;

function styleCell(td: HTMLElement, text: string, cell: PrintCell | undefined, spills: boolean) {
  const names = cell?.className?.split(/\s+/) ?? [];
  const style = cell?.style ?? {};
  for (const [key, value] of Object.entries(style)) {
    if (key === 'fontFamily') td.style.fontFamily = `"${value.replace(/["\\]/g, '')}", ${FONTS}`;
    else (td.style as unknown as Record<string, string>)[key] = value;
  }
  const horizontal = names.includes('htRight') ? 'right' : names.includes('htCenter') ? 'center' : names.includes('htLeft') ? 'left'
    : NUMERIC.test(text) ? 'right' : 'left';
  if (horizontal !== 'left') td.classList.add(horizontal);
  if (names.includes('htTop')) td.classList.add('top'); else if (names.includes('htMiddle')) td.classList.add('middle');
  if (names.includes('htWrap')) td.classList.add('wrap');
  // Like the sheet itself: text runs over empty neighbours and is cut at an occupied one. A number is never cut short.
  else if (!spills && horizontal === 'left') td.classList.add('clip');
}

function fillCell(document: Document, td: HTMLElement, text: string, cell: PrintCell | undefined) {
  if (!cell?.richText?.length) { td.textContent = text; return; }
  for (const run of cell.richText) {
    const span = document.createElement('span');
    span.textContent = run.text;
    if (run.fontFamily) span.style.fontFamily = `"${run.fontFamily.replace(/["\\]/g, '')}", ${FONTS}`;
    if (run.fontSize) span.style.fontSize = `${run.fontSize}px`;
    if (run.color) span.style.color = run.color;
    if (run.bold) span.style.fontWeight = 'bold';
    if (run.italic) span.style.fontStyle = 'italic';
    if (run.underline || run.strike) span.style.textDecoration = [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ');
    if (run.verticalAlign) { span.style.verticalAlign = run.verticalAlign; span.style.fontSize = '.75em'; }
    td.append(span);
  }
}

function sheetSection(document: Document, sheet: PrintSheet, named: boolean): HTMLElement {
  const plan = planSheet(sheet);
  const section = document.createElement('section');
  section.className = plan.landscape ? 'sheet wide' : 'sheet';
  section.dataset.sheet = sheet.name;
  if (named) { const name = document.createElement('h2'); name.className = 'sheet-name'; name.textContent = sheet.name; section.append(name); }
  if (!plan.cols.length || !plan.rows.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'This sheet is empty.'; section.append(empty);
    return section;
  }
  const widthOf = (col: number) => size(sheet.colWidths, col, sheet.defaults.colWidth);
  const heightOf = (row: number) => size(sheet.rowHeights, row, sheet.defaults.rowHeight);
  // Offsets in the sheet's own geometry (hidden tracks included, as its anchors are measured).
  const left = (col: number) => { let x = 0; for (let c = 0; c < col; c++) x += sheet.hiddenColumns.has(c) ? 0 : widthOf(c); return x; };
  const top = (row: number) => { let y = 0; for (let r = 0; r < row; r++) y += heightOf(r); return y; };
  const anchors = new Map<string, (PrintPicture & { node: HTMLElement })[]>();
  const anchor = (item: PrintPicture, node: HTMLElement) => {
    // An anchor in a hidden or trimmed track moves to the nearest printed cell after it.
    const row = plan.rows.find(candidate => candidate >= item.row) ?? plan.rows.at(-1)!;
    const col = plan.cols.find(candidate => candidate >= item.col) ?? plan.cols.at(-1)!;
    const key = `${row}-${col}`;
    anchors.set(key, [...anchors.get(key) ?? [], { ...item, row, col, node }]);
  };
  for (const image of sheet.images) {
    const node = document.createElement('img'); node.src = image.src; node.alt = ''; anchor(image, node);
  }
  for (const chart of sheet.charts) { chart.element.classList.add('chart'); anchor(chart, chart.element); }
  const merges = new Map<string, PrintSheet['merge'][number]>();
  const covered = new Set<string>();
  for (const merge of sheet.merge) {
    merges.set(`${merge.row}-${merge.col}`, merge);
    for (let r = merge.row; r < merge.row + merge.rowspan; r++) for (let c = merge.col; c < merge.col + merge.colspan; c++)
      if (r !== merge.row || c !== merge.col) covered.add(`${r}-${c}`);
  }
  const rowIndex = new Map(plan.rows.map((row, index) => [row, index]));
  for (const band of plan.bands) {
    const cols = plan.cols.slice(band.from, band.to);
    const wrapper = document.createElement('div');
    wrapper.className = 'sheet-band';
    if (plan.scale !== 1) wrapper.style.zoom = String(Math.round(plan.scale * 1000) / 1000);
    const table = document.createElement('table');
    const group = document.createElement('colgroup');
    for (const col of cols) { const element = document.createElement('col'); element.style.width = `${widthOf(col)}px`; group.append(element); }
    table.append(group);
    table.style.width = `${cols.reduce((sum, col) => sum + widthOf(col), 0)}px`;
    for (const row of plan.rows) {
      const tr = document.createElement('tr');
      tr.style.height = `${heightOf(row)}px`;
      for (let index = 0; index < cols.length; index++) {
        const col = cols[index], key = `${row}-${col}`;
        const merge = merges.get(key);
        // A merge that starts in an earlier band or a hidden track shows its remainder as plain cells.
        if (covered.has(key) && !merge) {
          const owner = sheet.merge.find(item => row >= item.row && row < item.row + item.rowspan && col >= item.col && col < item.col + item.colspan)!;
          if (cols.includes(owner.col) && rowIndex.has(owner.row)) continue;
        }
        const td = document.createElement('td');
        const text = sheet.data[row]?.[col] ?? '';
        const cell = sheet.cell[key];
        if (merge) {
          const spanCols = cols.filter(candidate => candidate >= merge.col && candidate < merge.col + merge.colspan).length;
          const spanRows = plan.rows.filter(candidate => candidate >= merge.row && candidate < merge.row + merge.rowspan).length;
          if (spanCols > 1) td.colSpan = spanCols;
          if (spanRows > 1) td.rowSpan = spanRows;
        }
        const next = cols[index + (merge ? Math.max(1, td.colSpan) : 1)];
        const spills = next === undefined ? true : (sheet.data[row]?.[next] ?? '') === '' && !covered.has(`${row}-${next}`) && !merges.has(`${row}-${next}`);
        styleCell(td, text, cell, spills);
        fillCell(document, td, text, cell);
        const pinned = anchors.get(key);
        if (pinned) {
          const holder = document.createElement('div'); holder.className = 'anchor';
          for (const item of pinned) {
            Object.assign(item.node.style, { left: `${item.left - left(col)}px`, top: `${item.top - top(row)}px`, width: `${item.width}px`, height: `${item.height}px` });
            holder.append(item.node);
          }
          td.prepend(holder);
        }
        tr.append(td);
      }
      table.append(tr);
    }
    wrapper.append(table);
    section.append(wrapper);
  }
  return section;
}

/** Replaces `document` with the printable workbook; resolves once its pictures are decoded. */
export async function writeSpreadsheetDocument(document: Document, title: string, sheets: PrintSheet[]): Promise<void> {
  const cells = sheets.reduce((sum, sheet) => { const plan = planSheet(sheet); return sum + plan.cols.length * plan.rows.length; }, 0);
  if (cells > MAX_CELLS) throw new Error(`This workbook is too large to save as PDF (${cells.toLocaleString('en-US')} cells; the limit is ${MAX_CELLS.toLocaleString('en-US')}).`);
  const style = document.createElement('style');
  style.textContent = STYLE;
  const heading = document.createElement('title');
  heading.textContent = title;
  document.head.replaceChildren(heading, style);
  const main = document.createElement('main');
  main.className = 'workbook';
  for (const sheet of sheets) main.append(sheetSection(document, sheet, sheets.length > 1));
  document.body.replaceChildren(main);
  document.body.removeAttribute('style'); document.body.removeAttribute('class');
  await Promise.all(Array.from(document.images, image => image.decode().catch(() => { image.remove(); })));
  await document.fonts?.ready;
}
