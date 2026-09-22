/** Viewer WebContents의 adapters와 controller를 조립하는 진입점. */
import { GOLDEN_TOP_RATIO } from '../core/preview/viewport-anchor';
import { installCommandRouter, type PreviewRuntimeConfig } from './command-router';
import { ContentController } from './content-controller';
import { installInteractions } from './interactions';
import { createReaderTools } from './reader-tools';
import { applyBaseHref, PREVIEW_SELECTOR, SourceAtlas } from './source-atlas';
import { ThemeController } from './theme-controller';
import { ViewportController } from './viewport-controller';
import { installReviewPreparation } from './review-preparation';
import { installReviewRowUpdates } from './review-row-updates';

type BridgeConfig = PreviewRuntimeConfig & {
  documentIsBlank: boolean;
  initialHtml: string;
  themeId: string;
};
declare global {
  interface Window {
    __marktexPreview?: Partial<BridgeConfig>;
    acquireVsCodeApi?: () => { postMessage(message: unknown): void };
    marktexPreviewHost?: { send(message: Record<string, unknown>): void };
  }
}
const config: BridgeConfig = {
  totalLineCount: Math.max(1, Number(window.__marktexPreview?.totalLineCount) || 1),
  documentIsBlank: !!window.__marktexPreview?.documentIsBlank,
  initialHtml: document.body.getAttribute('data-html') || '',
  revision: Number(window.__marktexPreview?.revision) || 0,
  themeId: String(window.__marktexPreview?.themeId || 'github-light'),
};
function send(message: Record<string, unknown>) {
  const payload = { ...message, source: 'crossnote' };
  if (window.marktexPreviewHost) window.marktexPreviewHost.send(payload);
  else window.parent.postMessage(payload, '*');
}
const sourceAtlas = new SourceAtlas({
  lineCount: () => config.totalLineCount, documentIsBlank: () => config.documentIsBlank,
});
const reader = createReaderTools(send, () => config.revision, PREVIEW_SELECTOR);
const viewport = new ViewportController({ sourceAtlas, revision: () => config.revision, send });
const themes = new ThemeController({ sourceAtlas, revision: () => config.revision, send,
  viewportChanged: viewport.schedule });
const content = new ContentController({ sourceAtlas, applyDisclosures: reader.applyDisclosures,
  scheduleHeadings: reader.scheduleHeadings, viewportChanged: viewport.schedule });

installReviewPreparation({ sourceAtlas, revision: () => config.revision, send,
  hydrate: () => content.hydrateAll() });
installReviewRowUpdates({ config, root: () => content.root(), send,
  afterPatch: (inserted, baseHref) => {
    applyBaseHref(baseHref);
    reader.applyDisclosures(inserted);
    sourceAtlas.invalidate();
    reader.scheduleHeadings();
    viewport.schedule();
    void document.fonts?.ready.then(() => {
      sourceAtlas.invalidate(); viewport.schedule();
    }).catch(() => {});
  } });
viewport.start();
themes.initialize(config.themeId);
installInteractions({ sourceAtlas, revision: () => config.revision, root: () => content.root(), send });
installCommandRouter({ config, content, sourceAtlas, themes, viewport, send,
  clearSearch: reader.clearSearch, publishHeadings: reader.publishHeadings,
  search: reader.search, scrollToHeading: reader.scrollToHeading });

window.acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    send(message as Record<string, unknown>);
    if ((message as { command?: string })?.command !== 'webviewFinishLoading') return;
    queueMicrotask(() => {
      if (content.installInitial()) return;
      window.postMessage({ command: 'updateHtml', html: config.initialHtml, markdown: '', tocHTML: '',
        totalLineCount: config.totalLineCount, sourceUri: document.querySelector('base')?.href || '',
        sourceScheme: 'file', id: '', class: 'zen-mode' }, '*');
    });
  },
});
window.addEventListener('scroll', () => {
  if (content.pendingCount > 0 && window.scrollY > (window.innerHeight || 1) * 1.5) {
    const oldMaximum = Math.max(1, document.documentElement.scrollHeight - (window.innerHeight || 1));
    const ratio = Math.min(1, Math.max(0, window.scrollY / oldMaximum));
    content.hydrateAll();
    const estimatedSourceLine = Math.max(1, Math.min(config.totalLineCount,
      Math.round(1 + ratio * (config.totalLineCount - 1))));
    sourceAtlas.position(estimatedSourceLine, GOLDEN_TOP_RATIO);
  }
  viewport.schedule();
  reader.publishActiveHeading();
}, { passive: true });
window.addEventListener('resize', () => {
  sourceAtlas.invalidate(); viewport.schedule(); reader.publishActiveHeading();
});
window.addEventListener('load', () => { sourceAtlas.invalidate(); viewport.schedule(); }, true);
document.addEventListener('load', () => { sourceAtlas.invalidate(); viewport.schedule(); }, true);
document.addEventListener('DOMContentLoaded', () => {
  sourceAtlas.invalidate(); viewport.schedule(); reader.scheduleHeadings();
});
if (document.body.dataset.setdownPreviewRuntime === 'lean') content.installInitial();
const observer = new MutationObserver(() => {
  sourceAtlas.invalidate();
  // Hydration appends several blocks in separate tasks. Publishing a reading
  // position for every append repeatedly measures the growing math document.
  // The final batch publishes once; explicit scroll/resize events still do so.
  if (content.pendingCount === 0) viewport.schedule();
  reader.scheduleHeadings();
});
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
  attributeFilter: ['style', 'class', 'data-source-line', 'data-processed'] });
send({ type: 'marktex:ready', revision: config.revision });
viewport.schedule();
reader.scheduleHeadings();
