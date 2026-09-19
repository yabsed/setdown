import { GOLDEN_TOP_RATIO } from '../core/preview/viewport-anchor';
import { applyBaseHref, PREVIEW_SELECTOR, type SourceAtlas } from './source-atlas';
import type { ContentController } from './content-controller';
import type { ThemeController } from './theme-controller';
import type { ViewportController } from './viewport-controller';

export type PreviewRuntimeConfig = {
  totalLineCount: number;
  revision: number;
};

type PreviewCommand = {
  command?: string;
  topRatio?: number;
  sourceLine?: number;
  sourceOccurrence?: number;
  searchOrdinal?: number;
  band?: unknown;
  sourceSide?: unknown;
  blockOffset?: number;
  observationId?: number | null;
  from?: number;
  removeCount?: number;
  lineDelta?: number;
  scrollRatio?: number;
  requestId?: number;
  settle?: boolean;
  id?: string;
  query?: string;
  direction?: 'forward' | 'backward';
  findNext?: boolean;
  themeId?: string;
  previewCssUrl?: string;
  codeCssUrl?: string;
  html?: string;
  markdown?: string;
  totalLineCount?: number;
  revision?: number;
  baseHref?: string;
};

type Options = {
  config: PreviewRuntimeConfig;
  content: ContentController;
  sourceAtlas: SourceAtlas;
  themes: ThemeController;
  viewport: ViewportController;
  send: (message: Record<string, unknown>) => void;
  clearSearch: () => void;
  publishHeadings: (force?: boolean) => void;
  search: (
    query: string,
    direction: 'forward' | 'backward',
    findNext: boolean,
    sourceLine?: number,
    sourceOccurrence?: number,
    searchOrdinal?: number,
  ) => void;
  scrollToHeading: (id: string, hydrate: () => void, afterScroll: () => void) => void;
};

export function installCommandRouter(options: Options): void {
  let htmlUpdateSequence = 0;

  const acknowledge = (type: string, requestId?: number) => {
    window.requestAnimationFrame(() => options.send({
      type,
      revision: options.config.revision,
      requestId,
    }));
  };

  const settleMutations = (apply: () => void, done: () => void) => {
    const preview = document.querySelector(PREVIEW_SELECTOR);
    let timer: number | null = null;
    let observer: MutationObserver | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer !== null) window.clearTimeout(timer);
      observer?.disconnect();
      apply();
      done();
    };
    const applyAndSettle = () => {
      if (finished) return;
      apply();
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(finish, 180);
    };
    if (preview) {
      observer = new MutationObserver(applyAndSettle);
      observer.observe(preview, { childList: true, subtree: true });
    }
    applyAndSettle();
  };

  const updateConfig = (command: PreviewCommand) => {
    options.config.totalLineCount = Math.max(1, Number(command.totalLineCount) || 1);
    options.config.revision = Math.max(0, Number(command.revision) || 0);
    applyBaseHref(command.baseHref);
  };

  const updateHtml = (command: PreviewCommand) => {
    applyBaseHref(command.baseHref);
    const sequence = ++htmlUpdateSequence;
    const revision = Math.max(0, Number(command.revision) || 0);
    options.config.totalLineCount = Math.max(1, Number(command.totalLineCount) || 1);
    options.config.revision = revision;
    const html = String(command.html ?? '');
    const root = options.content.root();
    options.content.cancelHydration();
    if (options.content.installSanitized(html)) {
      options.send({ type: 'marktex:html-updated', revision });
      return;
    }

    let completed = false;
    let timeout = 0;
    const observer = new MutationObserver(() => finish());
    const finish = () => {
      if (completed || sequence !== htmlUpdateSequence) return;
      completed = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      const installed = options.content.root();
      if (installed) options.content.finishInstall(installed);
      options.send({ type: 'marktex:html-updated', revision });
    };
    if (root) observer.observe(root, { childList: true });
    timeout = window.setTimeout(finish, 4_500);
    window.postMessage({
      command: 'updateHtml',
      html,
      markdown: String(command.markdown ?? ''),
      tocHTML: '',
      totalLineCount: options.config.totalLineCount,
      id: '',
      class: '',
    }, '*');
  };

  const restoreScroll = (command: PreviewCommand) => {
    options.content.hydrateAll();
    const ratio = Number.isFinite(command.scrollRatio) ? Number(command.scrollRatio) : 0;
    settleMutations(
      () => options.viewport.restoreRatio(ratio),
      () => acknowledge('marktex:preview-scroll-restored', command.requestId),
    );
  };

  const positionPreview = (command: PreviewCommand) => {
    const side = command.sourceSide === 'before' || command.sourceSide === 'after'
      ? command.sourceSide : undefined;
    const sourceLine = Math.min(
      options.sourceAtlas.lineCount(side),
      Math.max(1, Number(command.sourceLine) || 1),
    );
    const ratio = Number.isFinite(command.topRatio)
      ? Number(command.topRatio) : GOLDEN_TOP_RATIO;
    const band = options.sourceAtlas.readBand(command.band, side);
    if (!options.content.includesSourceLine(sourceLine, band)) options.content.hydrateAll();
    const apply = () => options.sourceAtlas.position(sourceLine, ratio, band, side, command.blockOffset);
    const done = () => acknowledge('marktex:preview-positioned', command.requestId);
    if (command.settle === false || options.content.pendingCount > 0) {
      apply();
      done();
    } else {
      settleMutations(apply, done);
    }
  };

  const requestAnchor = (command: PreviewCommand) => {
    const ratio = Number.isFinite(command.topRatio)
      ? Number(command.topRatio) : GOLDEN_TOP_RATIO;
    const clientY = (window.innerHeight || 1) * ratio;
    const clientX = (window.innerWidth || 1) / 2;
    const target = document.elementFromPoint(clientX, clientY);
    const path: EventTarget[] = [];
    for (let node: Element | null = target; node; node = node.parentElement) path.push(node);
    options.send({
      type: 'edit-at-anchor',
      anchor: options.sourceAtlas.anchorAtPoint(clientX, clientY, target, path),
    });
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    const command = event.data as PreviewCommand | null;
    if (!command) return;
    switch (command.command) {
      case 'marktex:observe-viewport':
        options.viewport.observe(typeof command.observationId === 'number'
          && Number.isSafeInteger(command.observationId) && command.observationId > 0
          ? command.observationId : null);
        break;
      case 'marktex:resume-hydration':
        options.content.resumeAfterPaint();
        break;
      case 'marktex:sync-config':
        updateConfig(command);
        options.send({ type: 'marktex:html-updated', revision: options.config.revision });
        break;
      case 'marktex:patch-blocks':
        updateConfig(command);
        options.content.patch(command);
        options.send({ type: 'marktex:html-updated', revision: options.config.revision });
        break;
      case 'marktex:update-html':
        updateHtml(command);
        break;
      case 'marktex:apply-theme':
        void options.themes.apply(
          command.themeId ?? '',
          command.previewCssUrl,
          command.codeCssUrl,
        );
        break;
      case 'marktex:find':
        if (command.query) options.content.hydrateAll();
        options.search(
          typeof command.query === 'string' ? command.query.slice(0, 512) : '',
          command.direction === 'backward' ? 'backward' : 'forward',
          !!command.findNext,
          Number.isFinite(command.sourceLine) ? Number(command.sourceLine) : undefined,
          Number.isFinite(command.sourceOccurrence) ? Number(command.sourceOccurrence) : undefined,
          Number.isFinite(command.searchOrdinal) ? Number(command.searchOrdinal) : undefined,
        );
        break;
      case 'marktex:stop-find':
        options.clearSearch();
        break;
      case 'marktex:collect-headings':
        options.publishHeadings(true);
        break;
      case 'marktex:scroll-to-heading':
        if (typeof command.id === 'string') {
          options.scrollToHeading(command.id, () => options.content.hydrateAll(), options.viewport.schedule);
        }
        break;
      case 'marktex:restore-scroll-ratio':
        restoreScroll(command);
        break;
      case 'marktex:position-preview':
        positionPreview(command);
        break;
      case 'marktex:request-anchor':
        requestAnchor(command);
        break;
    }
  });
}
