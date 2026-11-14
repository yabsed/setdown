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
  const [{ presentationRenderer }, pptx, ppt] = await Promise.all([import('@file-viewer/renderer-presentation'),
    import('@file-viewer/pptx/worker/pptx.worker.js?url'), import('@file-viewer/ppt/worker.mjs?url')]);
  return { renderers: renderers(presentationRenderer), presentation: {
    workerUrl: new URL(pptx.default, window.location.href).href, pptWorkerUrl: new URL(ppt.default, window.location.href).href } };
}
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
  const buffer = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer;
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
