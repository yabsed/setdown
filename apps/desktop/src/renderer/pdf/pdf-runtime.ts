import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, AnnotationMode,
  type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import viewerCss from 'pdfjs-dist/web/pdf_viewer.css?inline';
import type { PDFViewer, PDFLinkService, EventBus } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import type { DocumentSnapshot } from '../../core/document/document';
import type { PdfReadingPosition } from '../../core/reading/reading-position';
import type { DesktopPort } from '../ports/desktop-port';
import { readPdfBytes } from './pdf-range';

export type OutlineItem = { title: string; depth: number; dest: string | unknown[] | null };
type Options = {
  host: HTMLElement; document: DocumentSnapshot; initial?: PdfReadingPosition; desktop: DesktopPort;
  active(): boolean;
  changed(position: PdfReadingPosition): void;
  status(page: number, pages: number): void;
  outline(items: OutlineItem[]): void;
  matches(current: number, total: number): void;
  password(update: (password: string) => void, incorrect: boolean): void;
  error(message: string): void;
};

/** PDF.js owns page rendering and text selection; Setdown owns lifetime and history. */
export class PdfRuntime {
  private task?: PDFDocumentLoadingTask;
  private pdf?: PDFDocumentProxy;
  private viewer?: PDFViewer;
  private links?: PDFLinkService;
  private bus?: EventBus;
  private observer?: ResizeObserver;
  private readonly abort = new AbortController();
  private dead = false;
  private restoring = true;
  private position?: PdfReadingPosition;
  private needsResize = false;
  constructor(private readonly options: Options) {}

  async open(): Promise<void> {
    try {
      // pdf_viewer reads the global installed by the core module above.
      const { PDFViewer, PDFLinkService, PDFFindController, EventBus } = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
      if (this.dead) return;
      GlobalWorkerOptions.workerSrc = workerUrl;
      const shadow = this.options.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      // Dependency selectors stay inside the PDF shadow root, including its custom properties.
      style.textContent = viewerCss.replaceAll(':root', ':host')
        + ':host{color-scheme:light}.pdf-container{position:absolute;inset:0;overflow:auto;outline:none}.pdfViewer{padding:12px 0}';
      shadow.append(style);
      const container = document.createElement('div');
      container.className = 'pdf-container'; container.tabIndex = 0;
      container.setAttribute('aria-label', 'PDF pages'); container.setAttribute('role', 'document');
      const pages = document.createElement('div'); pages.className = 'pdfViewer';
      container.append(pages); shadow.append(container);
      const bus = this.bus = new EventBus();
      const links = this.links = new PDFLinkService({ eventBus: bus });
      const find = new PDFFindController({ eventBus: bus, linkService: links });
      // PDF.js' runtime accepts abortSignal, although its generated options type omits it.
      // It releases the viewer's own scroll listener and ResizeObserver on tab disposal.
      const viewerOptions = { container, viewer: pages, eventBus: bus, abortSignal: this.abort.signal,
        linkService: links, findController: find, annotationMode: AnnotationMode.ENABLE,
        maxCanvasPixels: 16 * 1024 * 1024 };
      const viewer = this.viewer = new PDFViewer(viewerOptions);
      links.setViewer(viewer);
      shadow.addEventListener('click', (event) => {
        const link = (event.target as Element)?.closest?.('a');
        if (link && /^(https?:|mailto:)/i.test(link.href)) {
          event.preventDefault(); void this.options.desktop.openLink(link.href);
        }
      }, { capture: true, signal: this.abort.signal });
      bus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
        if (!this.restoring && !this.dead) this.options.status(pageNumber, this.pdf?.numPages ?? 0);
      });
      bus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
        this.options.matches(matchesCount.current, matchesCount.total));
      bus.on('updatefindcontrolstate', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
        if (matchesCount) this.options.matches(matchesCount.current, matchesCount.total);
      });
      bus.on('updateviewarea', ({ location }: { location: { pageNumber: number; left: number; top: number } }) => {
        if (this.restoring || this.dead || !this.options.active()) return;
        const raw = viewer.currentScaleValue;
        const zoom = ['page-width', 'page-fit', 'auto'].includes(raw) ? raw as PdfReadingPosition['zoom'] : viewer.currentScale;
        this.position = { kind: 'pdf', page: location.pageNumber, left: location.left || 0, top: location.top || 0,
          zoom, rotation: viewer.pagesRotation };
        this.options.changed(this.position);
      });
      const file = this.options.document;
      const version = { ...file.diskVersion };
      const read = (begin: number, end: number) => readPdfBytes(begin, end, file.diskVersion.size,
        (from, to) => this.options.desktop.readPdfRange(file.path, from, to, version));
      const initial = new Uint8Array(await read(0, Math.min(file.diskVersion.size, 65536)));
      if (this.dead) return;
      const fail = (error: unknown) => { if (!this.dead) { this.options.error(String(error)); void this.task?.destroy(); } };
      class Ranges extends PDFDataRangeTransport {
        override requestDataRange(begin: number, end: number) {
          void read(begin, end).then((bytes) => this.onDataRange(begin, new Uint8Array(bytes))).catch(fail);
        }
      }
      const range = new Ranges(file.diskVersion.size, initial, true);
      const assets = new URL('./pdf-assets/', document.baseURI).href;
      const task = this.task = getDocument({ range, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true,
        cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/',
        wasmUrl: assets + 'wasm/' });
      task.onPassword = (update: (password: string) => void, reason: number) => this.options.password(update, reason === 2);
      const pdf = this.pdf = await task.promise;
      if (this.dead) return;
      links.setDocument(pdf); viewer.setDocument(pdf);
      await viewer.firstPagePromise;
      await viewer.pagesPromise;
      if (this.dead) return;
      const saved = this.options.initial;
      viewer.pagesRotation = saved?.rotation ?? 0;
      viewer.currentScaleValue = String(saved?.zoom ?? 'page-width');
      if (saved) {
        const page = Math.max(1, Math.min(pdf.numPages, saved.page));
        viewer.scrollPageIntoView({ pageNumber: page,
          destArray: [null, { name: 'XYZ' }, saved.left, saved.top, null], ignoreDestinationZoom: true });
      }
      // Ignore all setup scroll events until the restored layout is installed.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (this.dead) return;
      this.restoring = false;
      viewer.update();
      this.options.status(viewer.currentPageNumber, pdf.numPages);
      void pdf.getOutline().then((outline) => {
        if (this.dead) return;
        const flat: OutlineItem[] = [];
        const visit = (items: NonNullable<typeof outline>, depth: number) => {
          if (depth > 30) return;
          for (const item of items) {
            if (flat.length >= 2000) return;
            flat.push({ title: item.title, depth, dest: item.dest }); visit(item.items, depth + 1);
          }
        };
        visit(outline ?? [], 0); this.options.outline(flat);
      }).catch(() => {});
      this.observer = new ResizeObserver(() => {
        if (this.dead || this.restoring) return;
        this.needsResize = true;
        if (this.options.active()) this.resume();
      });
      this.observer.observe(container);
    } catch (error) { if (!this.dead) this.options.error(error instanceof Error ? error.message : String(error)); }
  }
  resume(): void {
    const viewer = this.viewer;
    if (!viewer || this.dead || this.restoring || !this.needsResize) return;
    this.needsResize = false;
    const scale = viewer.currentScaleValue;
    if (['page-width', 'page-fit', 'auto'].includes(scale)) viewer.currentScaleValue = scale;
    viewer.update();
  }
  page(number: number): void {
    if (this.viewer && this.pdf && Number.isFinite(number)) this.viewer.currentPageNumber = Math.max(1, Math.min(this.pdf.numPages, Math.round(number)));
  }
  zoom(value: PdfReadingPosition['zoom']): void {
    if (this.viewer) this.viewer.currentScaleValue = String(value);
  }
  rotate(): void { if (this.viewer) this.viewer.pagesRotation = (this.viewer.pagesRotation + 90) % 360; }
  find(query: string, previous = false, again = false): void {
    this.bus?.dispatch('find', { source: this, type: again ? 'again' : '', query, caseSensitive: false,
      entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  destination(dest: OutlineItem['dest']): void { if (dest) void this.links?.goToDestination(dest); }
  dispose(): void {
    if (this.dead) return;
    this.dead = true; this.abort.abort(); this.observer?.disconnect();
    // setDocument(null) cancels rendering, destroys page views and observers.
    this.viewer?.setDocument(null as unknown as PDFDocumentProxy);
    this.links?.setDocument(null);
    void this.task?.destroy();
  }
}
