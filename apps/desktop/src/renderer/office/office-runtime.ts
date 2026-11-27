import type { OfficeFamily } from '../../core/document/document-profile';
import type { OfficeReadingPosition } from '../../core/reading/reading-position';

/**
 * The only module that touches flyfish-dev/file-viewer. Each Office family loads
 * its own renderer and worker on first use; nothing here runs at startup and no
 * File Viewer type reaches the workspace model.
 */
export type OfficeViewer = {
  /** Multiplies the current zoom; the viewer's own fit-to-width base stays intact. */
  scaleBy(ratio: number): Promise<void>;
  setAppearance(appearance: 'light' | 'dark'): void;
  destroy(): void;
};
export type OfficeViewerInput = {
  host: HTMLElement; family: OfficeFamily; name: string; bytes: Uint8Array;
  appearance: 'light' | 'dark'; initial?: OfficeReadingPosition;
  onstate(state: { ready: boolean; error: string | null }): void;
  onposition(position: OfficeReadingPosition): void;
};

type ViewerOptions = import('@file-viewer/web').ViewerOptions;
// Renderer packages type their handlers for HTMLDivElement while the options type
// asks for HTMLElement handlers; the viewer always mounts them into a div.
const renderers = (...plugins: unknown[]) => plugins as NonNullable<ViewerOptions['renderers']>;
async function familyOptions(family: OfficeFamily): Promise<Pick<ViewerOptions, 'renderers' | 'docx' | 'spreadsheet' | 'presentation' | 'hangul'>> {
  if (family === 'word') {
    const { wordRenderer } = await import('@file-viewer/renderer-word');
    // The page is served from file:// in production, where File Viewer keeps DOCX
    // parsing on the main thread; its progressive renderer yields between batches.
    return { renderers: renderers(wordRenderer) };
  }
  if (family === 'spreadsheet') {
    const [{ spreadsheetRenderer }, worker] = await Promise.all([import('@file-viewer/renderer-spreadsheet'),
      import('@file-viewer/renderer-spreadsheet/worker/sheet.worker.js?url')]);
    return { renderers: renderers(spreadsheetRenderer), spreadsheet: { workerUrl: new URL(worker.default, window.location.href).href } };
  }
  if (family === 'hangul') {
    const [{ hangulRenderer }, worker] = await Promise.all([import('@file-viewer/renderer-hangul'),
      import('@file-viewer/renderer-hangul/worker/hangul.worker.js?url')]);
    return { renderers: renderers(hangulRenderer), hangul: { workerUrl: new URL(worker.default, window.location.href).href } };
  }
  // Both worker scripts come with their EMF converter corrected: an outline of lines and curves is one figure.
  const [{ presentationRenderer }, pptx, ppt] = await Promise.all([import('@file-viewer/renderer-presentation'),
    import('virtual:office-metafile-worker/pptx'), import('virtual:office-metafile-worker/ppt')]);
  return { renderers: renderers(presentationRenderer), presentation: {
    workerUrl: new URL(pptx.default, window.location.href).href, pptWorkerUrl: new URL(ppt.default, window.location.href).href } };
}
const wholeBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const message = (error: unknown): string => error instanceof Error ? error.message : typeof error === 'string' ? error : 'This document could not be displayed.';

export async function mountOfficeViewer(input: OfficeViewerInput): Promise<OfficeViewer> {
  const [{ mountViewer }, family] = await Promise.all([import('@file-viewer/web'), familyOptions(input.family)]);
  const ratio = (value: number | undefined) => Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0;
  const options = (appearance: 'light' | 'dark', position?: OfficeReadingPosition): ViewerOptions => ({
    ...family,
    ...(position ? { initialViewState: { scroll: { topRatio: position.top, leftRatio: position.left },
      ...(position.sheet === undefined ? {} : { spreadsheet: { sheetId: position.sheet } }) } } : {}),
    // Only the renderer for this family is active; nothing is discovered or fetched implicitly.
    rendererMode: 'replace', builtinRenderers: 'none', autoRenderers: false,
    theme: appearance, locale: 'en-US', styleIsolation: 'shadow',
    // Setdown's tab zoom owns Ctrl+wheel and the zoom buttons; files are never written or exported from here.
    zoomGestures: false,
    toolbar: { zoom: false, download: false, print: false, exportHtml: false, theme: false, search: true, position: 'top',
      permissions: { download: false, print: false, 'export-html': false } },
    ui: { density: 'compact', surfaceBackground: 'transparent' },
  });
  // A view of the IPC buffer may not start at offset 0; the viewer takes a whole ArrayBuffer.
  const buffer = wholeBuffer(input.bytes);
  const source = { buffer, filename: input.name, size: buffer.byteLength };
  const position = (): OfficeReadingPosition | undefined => {
    const state = controller.getViewState();
    if (!state?.scroll) return undefined;
    const sheet = state.spreadsheet?.sheetId;
    return { kind: 'office', top: ratio(state.scroll.topRatio), left: ratio(state.scroll.leftRatio),
      ...(Number.isInteger(sheet) && sheet! >= 0 ? { sheet } : {}) };
  };
  const controller = mountViewer(input.host, { ...source, options: options(input.appearance, input.initial),
    onStateChange: state => input.onstate({ ready: state.ready, error: state.error ? message(state.error) : null }),
    onEvent: event => { if (event.type !== 'view-state-change') return; const current = position(); if (current) input.onposition(current); } });
  return {
    async scaleBy(ratio) {
      const scale = controller.getZoomState()?.scale;
      if (scale && Number.isFinite(ratio) && ratio > 0) await controller.applyViewState({ scale: scale * ratio });
    },
    // A theme change renders the document again; it resumes where the reader was.
    setAppearance(appearance) { void controller.update({ ...source, options: options(appearance, position() ?? input.initial) }); },
    destroy() { controller.destroy(); },
  };
}

export type OfficePrintInput = { host: HTMLElement; family: OfficeFamily; name: string; bytes: Uint8Array; target: Window };
/**
 * Renders a document for paper and replaces `target`'s document with the printable result:
 * every page, light, at the paper size the file states. Word, slides and Hangul are printed by
 * the viewer from its own rendering; a workbook, which it draws on a canvas and cannot print,
 * is laid out from the same parsed model instead.
 */
export async function printOfficeDocument(input: OfficePrintInput): Promise<void> {
  if (input.family === 'spreadsheet') return printWorkbook(input);
  const [{ mountViewer }, family] = await Promise.all([import('@file-viewer/web'), familyOptions(input.family)]);
  const buffer = wholeBuffer(input.bytes);
  let controller!: ReturnType<typeof mountViewer>;
  await new Promise<void>((resolve, reject) => {
    controller = mountViewer(input.host, { buffer, filename: input.name, size: buffer.byteLength,
      options: { ...family, rendererMode: 'replace', builtinRenderers: 'none', autoRenderers: false,
        // No shadow tree here: the viewer gathers a slide deck's styles from the document it is mounted in.
        theme: 'light', locale: 'en-US', styleIsolation: 'none', zoomGestures: false, toolbar: false,
        ui: { surfaceBackground: 'transparent' },
        // Reading uses one continuous flow; paper needs the document's own pages, each with its margins, header and footer.
        ...(input.family === 'word' ? { docx: { ...family.docx, visualPagination: true, progressive: false, ignoreLastRenderedPageBreak: true } } : {}) },
      onStateChange: state => { if (state.error) reject(new Error(message(state.error))); else if (state.ready) resolve(); } });
  });
  if (!controller.getOperationAvailability()?.print) throw new Error('This kind of document cannot be saved as PDF yet.');
  await controller.printRenderedHtml({ printWindow: input.target, autoPrint: false, title: input.name });
  if (!input.target.document.querySelector('.viewer-export-content')) throw new Error('The document could not be laid out for printing.');
  (await import('./office-paper')).layOutPaper(input.target.document);
  await input.target.document.fonts?.ready;
}

async function printWorkbook(input: OfficePrintInput): Promise<void> {
  const [{ createSpreadsheetParserContext, handleSpreadsheetWorkerRequest }, { renderSpreadsheetChart }, { writeSpreadsheetDocument }] =
    await Promise.all([import('@file-viewer/renderer-spreadsheet/worker/sheetjs'), import('@file-viewer-spreadsheet-chart'), import('./spreadsheet-print')]);
  const context = createSpreadsheetParserContext();
  const ask = async (type: string, payload: Record<string, unknown>) => {
    const responses = await handleSpreadsheetWorkerRequest(context, { type, payload });
    const failure = responses.find(response => response.type === 'parseError');
    if (failure) throw new Error(message(failure.payload?.message));
    return responses[0]?.payload;
  };
  const document = input.target.document;
  const workbook = await ask('parseWorkbook', { workbook: wholeBuffer(input.bytes), filename: input.name,
    fileType: /\.([a-z0-9]+)$/i.exec(input.name)?.[1].toLowerCase() });
  const definitions = (workbook?.sheets ?? []) as { id: number; name: string; hidden?: boolean; rowCount?: number }[];
  const sheets: import('./spreadsheet-print').PrintSheet[] = [];
  for (const definition of definitions) {
    if (definition.hidden) continue;
    const data = (await ask('parseSheet', { sheet: definition.id, startRow: 0, pageSize: Math.max(1, definition.rowCount ?? 0) }))?.sheetData;
    if (!data) continue;
    const structure = data.structure ?? {};
    sheets.push({ name: definition.name, data: data.data ?? [], cell: data.cell ?? {}, merge: structure.merge ?? data.merge ?? [],
      colWidths: structure.colWidths ?? data.colWidths, rowHeights: structure.rowHeights ?? data.rowHeights,
      hiddenColumns: new Set(((structure.columns ?? data.columns ?? []) as { hidden?: boolean }[]).flatMap((column, index) => column.hidden ? [index] : [])),
      defaults: data.defaults, images: structure.images ?? [],
      charts: ((structure.charts ?? []) as (import('./spreadsheet-print').PrintPicture & { id: string })[])
        .map(chart => ({ left: chart.left, top: chart.top, width: chart.width, height: chart.height, row: chart.row, col: chart.col,
          element: renderSpreadsheetChart(document, chart) })) });
  }
  if (!sheets.length) throw new Error('This workbook has no visible sheet.');
  await writeSpreadsheetDocument(document, input.name, sheets);
}
