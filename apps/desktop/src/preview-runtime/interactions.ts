import type { SourceAtlas } from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  revision: () => number;
  root: () => HTMLElement | null;
  send: (message: Record<string, unknown>) => void;
};

const GESTURE_HOLD_MS = 250;
const DEFERRED_SELECTOR = 'a, .code-chunk .run-btn, .code-chunk .run-all-btn, [data-cmd]';

export function installInteractions(options: Options): void {
  let pendingGesture: { timer: number; replay: () => void } | null = null;
  let replaying = false;

  const cancelPendingGesture = () => {
    if (!pendingGesture) return;
    window.clearTimeout(pendingGesture.timer);
    pendingGesture = null;
  };

  document.addEventListener('dblclick', (event) => {
    cancelPendingGesture();
    const target = event.target instanceof Element ? event.target : null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const anchor = options.sourceAtlas.anchorAtPoint(event.clientX, event.clientY, target, path);
    event.preventDefault();
    event.stopImmediatePropagation();
    options.send({ type: 'edit-at-anchor', anchor });
  }, true);

  document.addEventListener('mousedown', (event) => {
    if (event.detail >= 2) event.preventDefault();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key.toLowerCase() === 'f'
      && (event.ctrlKey || event.metaKey)
      && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.send({ type: 'marktex:open-find', revision: options.revision() });
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (replaying) return;
    const target = event.target instanceof Element ? event.target : null;
    const deferred = target?.closest(DEFERRED_SELECTOR) ?? null;
    if (!deferred) return;
    cancelPendingGesture();
    event.preventDefault();
    event.stopImmediatePropagation();
    const { clientX, clientY } = event;
    const replay = () => {
      pendingGesture = null;
      replaying = true;
      try {
        deferred.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
        }));
      } finally {
        replaying = false;
      }
    };
    pendingGesture = { timer: window.setTimeout(replay, GESTURE_HOLD_MS), replay };
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor || !options.root()?.contains(anchor)) return;
    const href = anchor.getAttribute('href') ?? '';
    if (anchor.classList.contains('tag') || href.startsWith('tag://') || !href) return;
    event.preventDefault();
    event.stopPropagation();
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const destination = id ? options.root()?.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      destination?.scrollIntoView({ block: 'start' });
      return;
    }
    const normalizedHref = href.replace(/\\/g, '/');
    let resolvedHref = normalizedHref;
    try {
      resolvedHref = new URL(
        normalizedHref,
        document.querySelector('base')?.href || window.location.href,
      ).href;
    } catch {
      // main process가 허용 protocol을 최종 검사한다.
    }
    options.send({
      command: 'clickTagA',
      args: [{
        uri: document.querySelector('base')?.href ?? '',
        href: encodeURIComponent(resolvedHref),
        scheme: 'file',
      }],
    });
  }, true);
}
