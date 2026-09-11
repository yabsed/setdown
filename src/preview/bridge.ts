/**
 * Viewer(iframe) 안에서 도는 다리.
 *
 * 하나의 규칙만 지킨다. Viewer의 어느 지점을 더블 클릭해도 host에게
 * `edit-at-anchor`를 보낸다. mapping은 목적지의 품질만 바꾸고, 전환을
 * 허가하거나 거부하지 않는다.
 */
import {
  GOLDEN_TOP_RATIO,
  resolveViewerPoint,
  type SourceCandidate,
  type ViewportAnchor,
} from '../shared/viewport-anchor';

type BridgeConfig = {
  totalLineCount: number;
  documentIsBlank: boolean;
  initialHtml: string;
  revision: number;
};

declare global {
  interface Window {
    __marktexPreview?: Partial<BridgeConfig>;
    acquireVsCodeApi?: () => { postMessage(message: unknown): void };
  }
}

const config: BridgeConfig = {
  totalLineCount: Math.max(1, Number(window.__marktexPreview?.totalLineCount) || 1),
  documentIsBlank: !!window.__marktexPreview?.documentIsBlank,
  initialHtml: document.body.getAttribute('data-html') || '',
  revision: Number(window.__marktexPreview?.revision) || 0,
};

const ANCHOR_SELECTOR = '[data-source-line], [data-source-start], [data-source-lines]';
const PREVIEW_SELECTOR = '.markdown-preview[data-for="preview"]';
/**
 * 첫 click의 부수 효과를 붙잡아 두는 시간. system double-click 간격보다
 * 짧게 잡아 두 번째 click이 반드시 Viewer에 닿게 한다.
 */
const GESTURE_HOLD_MS = 250;

function send(message: Record<string, unknown>) {
  window.parent.postMessage({ ...message, source: 'crossnote' }, '*');
}

// ── Crossnote webview가 기대하는 host API ──────────────────────────
window.acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    send(message as Record<string, unknown>);
    if ((message as { command?: string })?.command === 'webviewFinishLoading') {
      queueMicrotask(() =>
        window.postMessage(
          {
            command: 'updateHtml',
            html: config.initialHtml,
            markdown: '',
            // 넘기지 않으면 webview의 sidebar TOC effect가 undefined를 읽는다.
            tocHTML: '',
            totalLineCount: config.totalLineCount,
            sourceUri: document.querySelector('base')?.href || '',
            sourceScheme: 'file',
            id: '',
            class: 'zen-mode',
          },
          '*',
        ),
      );
    }
  },
});

// ── source atlas: 매 render 뒤 한 번만 걷는 기하 색인 ───────────────
type AtlasEntry = SourceCandidate & { element: Element };

let atlas: AtlasEntry[] = [];
let atlasStale = true;

function parseLinePair(value: string | null): [number, number | undefined] | null {
  if (!value) return null;
  const match = /^\s*(\d+)\s*(?:[-:]\s*(\d+))?\s*$/.exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  const second = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isFinite(first) || first < 1) return null;
  return [first, second];
}

function readCandidate(element: Element, order: number): AtlasEntry | null {
  let line = Number.NaN;
  let column: number | undefined;
  let endLine: number | undefined;

  const start = parseLinePair(element.getAttribute('data-source-start'));
  if (start) {
    line = start[0];
    column = start[1];
  }
  const range = parseLinePair(element.getAttribute('data-source-lines'));
  if (range) {
    if (!Number.isFinite(line)) line = range[0];
    endLine = range[1] ?? range[0];
  }
  const end = parseLinePair(element.getAttribute('data-source-end'));
  if (end) endLine = end[0];
  if (!Number.isFinite(line)) {
    const single = Number(element.getAttribute('data-source-line'));
    if (Number.isFinite(single) && single >= 1) line = single;
  }
  if (!Number.isFinite(line) || line < 1) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const scrollTop = document.documentElement.scrollTop || 0;
  const scrollLeft = document.documentElement.scrollLeft || 0;
  return {
    line,
    column,
    endLine,
    order,
    element,
    // 문서 좌표로 저장한다. scroll만으로는 색인이 낡지 않는다.
    rect: {
      top: rect.top + scrollTop,
      bottom: rect.bottom + scrollTop,
      left: rect.left + scrollLeft,
      right: rect.right + scrollLeft,
    },
  };
}

function rebuildAtlas() {
  const root = document.querySelector(PREVIEW_SELECTOR);
  const entries: AtlasEntry[] = [];
  if (root) {
    const elements = root.querySelectorAll(ANCHOR_SELECTOR);
    for (let index = 0; index < elements.length; index += 1) {
      const entry = readCandidate(elements[index], index);
      if (entry) entries.push(entry);
    }
  }
  atlas = entries;
  atlasStale = false;
}

function getAtlas(): AtlasEntry[] {
  if (atlasStale) rebuildAtlas();
  return atlas;
}

function invalidateAtlas() {
  atlasStale = true;
}

function positionPreview(sourceLine: number, topRatio: number) {
  invalidateAtlas();
  const entries = getAtlas();
  const ratio = Math.min(1, Math.max(0, topRatio));
  let targetTop: number;

  if (entries.length > 0) {
    const containing = entries.find((entry) =>
      entry.line <= sourceLine && (entry.endLine ?? entry.line) >= sourceLine,
    );
    const nearest = containing ?? entries.reduce((best, entry) =>
      Math.abs(entry.line - sourceLine) < Math.abs(best.line - sourceLine) ? entry : best,
    );
    targetTop = nearest.rect.top;
  } else {
    const documentHeight = Math.max(
      document.documentElement.scrollHeight || 0,
      window.innerHeight || 1,
    );
    const sourceRatio = config.totalLineCount <= 1
      ? 0
      : (sourceLine - 1) / (config.totalLineCount - 1);
    targetTop = documentHeight * sourceRatio;
  }

  const maximum = Math.max(
    0,
    (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
  );
  const scrollTop = Math.min(maximum, Math.max(0, targetTop - window.innerHeight * ratio));
  document.documentElement.scrollTop = scrollTop;
  document.body.scrollTop = scrollTop;
}

/** 문서 좌표로 저장한 색인을 현재 화면 좌표로 옮긴다. */
function toClientCandidates(entries: AtlasEntry[]): SourceCandidate[] {
  const scrollTop = document.documentElement.scrollTop || 0;
  const scrollLeft = document.documentElement.scrollLeft || 0;
  return entries.map((entry) => ({
    line: entry.line,
    endLine: entry.endLine,
    column: entry.column,
    order: entry.order,
    rect: {
      top: entry.rect.top - scrollTop,
      bottom: entry.rect.bottom - scrollTop,
      left: entry.rect.left - scrollLeft,
      right: entry.rect.right - scrollLeft,
    },
  }));
}

function candidateFromElement(element: Element, order: number): SourceCandidate | null {
  const entry = readCandidate(element, order);
  if (!entry) return null;
  const scrollTop = document.documentElement.scrollTop || 0;
  const scrollLeft = document.documentElement.scrollLeft || 0;
  return {
    line: entry.line,
    endLine: entry.endLine,
    column: entry.column,
    order,
    rect: {
      top: entry.rect.top - scrollTop,
      bottom: entry.rect.bottom - scrollTop,
      left: entry.rect.left - scrollLeft,
      right: entry.rect.right - scrollLeft,
    },
  };
}

function ancestorCandidates(path: EventTarget[], fallback: Element | null): SourceCandidate[] {
  const found: SourceCandidate[] = [];
  const nodes: Element[] = [];
  for (const node of path) {
    if (node instanceof Element) nodes.push(node);
  }
  if (nodes.length === 0 && fallback) {
    // composedPath()를 쓸 수 없는 환경. closest() 사슬로 대신한다.
    let element: Element | null = fallback;
    while (element) {
      nodes.push(element);
      element = element.parentElement;
    }
  }
  nodes.forEach((element, index) => {
    if (!element.matches?.(ANCHOR_SELECTOR)) return;
    const candidate = candidateFromElement(element, index);
    if (candidate) found.push(candidate);
  });
  return found;
}

function descendantCandidates(target: Element | null): SourceCandidate[] {
  if (!target) return [];
  const elements = target.querySelectorAll?.(ANCHOR_SELECTOR);
  if (!elements) return [];
  const found: SourceCandidate[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const candidate = candidateFromElement(elements[index], index);
    if (candidate) found.push(candidate);
  }
  return found;
}

function scrollRatioAt(clientY: number): number {
  const scrollTop = document.documentElement.scrollTop || 0;
  const documentHeight = Math.max(
    document.documentElement.scrollHeight || 0,
    window.innerHeight || 1,
  );
  return (scrollTop + clientY) / documentHeight;
}

/** 화면의 한 점에서 anchor를 얻는다. 절대 null이 아니다. */
function anchorAtPoint(clientX: number, clientY: number, target: Element | null, path: EventTarget[]): ViewportAnchor {
  return resolveViewerPoint({
    point: { x: clientX, y: clientY },
    viewportHeight: window.innerHeight || 1,
    lineCount: config.totalLineCount,
    ancestors: ancestorCandidates(path, target),
    descendants: descendantCandidates(target),
    candidates: toClientCandidates(getAtlas()),
    scrollRatio: scrollRatioAt(clientY),
    documentIsBlank: config.documentIsBlank,
  });
}

// ── 더블 클릭: 조건 없는 상태 전환 ──────────────────────────────────
document.addEventListener(
  'dblclick',
  (event) => {
    cancelPendingGesture();
    const target = event.target instanceof Element ? event.target : null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const anchor = anchorAtPoint(event.clientX, event.clientY, target, path);
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: 'edit-at-anchor', anchor });
  },
  true,
);

// 두 번째 mousedown의 단어 선택은 전환보다 우선하지 않는다.
document.addEventListener(
  'mousedown',
  (event) => {
    if (event.detail >= 2) event.preventDefault();
  },
  true,
);

// ── gesture arbiter: 부수 효과가 큰 single click을 잠깐 붙잡는다 ─────
const DEFERRED_SELECTOR = 'a, .code-chunk .run-btn, .code-chunk .run-all-btn, [data-cmd]';

let pendingGesture: { timer: number; replay: () => void } | null = null;
let replaying = false;

function cancelPendingGesture() {
  if (!pendingGesture) return;
  window.clearTimeout(pendingGesture.timer);
  pendingGesture = null;
}

document.addEventListener(
  'click',
  (event) => {
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
        deferred.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          }),
        );
      } finally {
        replaying = false;
      }
    };
    pendingGesture = { timer: window.setTimeout(replay, GESTURE_HOLD_MS), replay };
  },
  true,
);

// ── host의 요청: 지금 보고 있는 화면의 anchor ────────────────────────
window.addEventListener('message', (event) => {
  const data = event.data as {
    command?: string;
    topRatio?: number;
    sourceLine?: number;
    requestId?: number;
  } | null;
  if (!data) return;
  if (data.command === 'marktex:position-preview') {
    const sourceLine = Math.min(
      config.totalLineCount,
      Math.max(1, Number(data.sourceLine) || 1),
    );
    const ratio = Number.isFinite(data.topRatio) ? Number(data.topRatio) : GOLDEN_TOP_RATIO;
    const preview = document.querySelector(PREVIEW_SELECTOR);
    let settleTimer: number | null = null;
    let observer: MutationObserver | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      observer?.disconnect();
      positionPreview(sourceLine, ratio);
      window.requestAnimationFrame(() => send({
        type: 'marktex:preview-positioned',
        revision: config.revision,
        requestId: data.requestId,
      }));
    };
    const applyAndSettle = () => {
      if (finished) return;
      positionPreview(sourceLine, ratio);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(finish, 180);
    };
    if (preview) {
      observer = new MutationObserver(applyAndSettle);
      observer.observe(preview, { childList: true, subtree: true });
    }
    applyAndSettle();
    return;
  }
  if (data.command !== 'marktex:request-anchor') return;
  const ratio = Number.isFinite(data.topRatio) ? Number(data.topRatio) : GOLDEN_TOP_RATIO;
  const clientY = (window.innerHeight || 1) * ratio;
  const clientX = (window.innerWidth || 1) / 2;
  const target = document.elementFromPoint(clientX, clientY);
  const path: EventTarget[] = [];
  let node: Element | null = target;
  while (node) {
    path.push(node);
    node = node.parentElement;
  }
  send({ type: 'edit-at-anchor', anchor: anchorAtPoint(clientX, clientY, target, path) });
});

// ── 색인 무효화: resize, 이미지 로드, 다이어그램 렌더 ─────────────────
window.addEventListener('resize', invalidateAtlas);
window.addEventListener('load', invalidateAtlas, true);
document.addEventListener('load', invalidateAtlas, true);
document.addEventListener('DOMContentLoaded', invalidateAtlas);

const observer = new MutationObserver(invalidateAtlas);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'data-source-line', 'data-processed'],
});
