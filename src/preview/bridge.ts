/**
 * Viewer iframe 안에서 도는 다리.
 *
 * 하나의 규칙만 지킨다. Viewer의 어느 지점을 더블 클릭해도 host에게
 * `edit-at-anchor`를 보낸다. mapping은 목적지의 품질만 바꾸고, 전환을
 * 허가하거나 거부하지 않는다.
 */
import { previewThemeBackground } from '../shared/preview-preferences';
import {
  DEFERRED_HTML_SCRIPT_ID,
  INITIAL_HTML_TEMPLATE_ID,
  partitionPreviewHtml,
  requiresCrossnoteInstall,
} from '../shared/preview-install';
import { splitPreviewBlocks } from '../shared/preview-blocks';
import {
  GOLDEN_TOP_RATIO,
  type BandLine,
} from '../shared/viewport-anchor';
import {
  ANCHOR_SELECTOR,
  PREVIEW_SELECTOR,
  SourceAtlas,
  applyBaseHref,
  shiftSourceLines,
  shiftSourceLinesHtml,
  sourceLinePair,
} from './source-atlas';
import { createReaderTools } from './reader-tools';

type BridgeConfig = {
  totalLineCount: number;
  documentIsBlank: boolean;
  initialHtml: string;
  revision: number;
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

// Chromium은 root 요소의 배경을 canvas에 칠한다. crossnote의 preview.css가
// `html`을 흰색으로 두므로, 본문이 조판되기 전 첫 frame이 흰색으로 번쩍인다.
// stylesheet 순서로는 이길 수 없어 inline important로 못박는다.
function paintRootBackground(themeId: string) {
  const background = previewThemeBackground(themeId);
  document.documentElement.style.setProperty('background-color', background, 'important');
  document.body.style.setProperty('background-color', background, 'important');
}

paintRootBackground(config.themeId);

document.body.dataset.setdownPreviewTheme = config.themeId;
document.body.dataset.previewTheme = [
  'github-dark',
  'night',
  'one-dark',
  'solarized-dark',
].includes(config.themeId) ? 'dark' : 'light';

/**
 * 첫 click의 부수 효과를 붙잡아 두는 시간. system double-click 간격보다
 * 짧게 잡아 두 번째 click이 반드시 Viewer에 닿게 한다.
 */
const GESTURE_HOLD_MS = 250;

function send(message: Record<string, unknown>) {
  const payload = { ...message, source: 'crossnote' };
  if (window.marktexPreviewHost) window.marktexPreviewHost.send(payload);
  else window.parent.postMessage(payload, '*');
}

// ── Crossnote webview가 기대하는 host API ──────────────────────────
window.acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    send(message as Record<string, unknown>);
    if ((message as { command?: string })?.command === 'webviewFinishLoading') {
      queueMicrotask(() => {
        // 워커가 본문을 `<template>`으로 실어 보냈으면 그대로 옮겨 심는다.
        // crossnote에게 다시 넘기면 sanitize와 숨은 DOM 왕복이 붙는다.
        if (installInitialHtml()) return;
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
        );
      });
    }
  },
});

// ── source atlas: 매 render 뒤 한 번만 걷는 기하 색인 ───────────────
const sourceAtlas = new SourceAtlas({
  lineCount: () => config.totalLineCount,
  documentIsBlank: () => config.documentIsBlank,
});
const {
  applyDisclosures,
  clearSearch: clearSearchHighlights,
  publishActiveHeading,
  publishHeadings,
  scheduleHeadings,
  scrollToHeading,
  search: performSearch,
} = createReaderTools(send, () => config.revision, PREVIEW_SELECTOR);

let viewportStateFrame: number | null = null;

/**
 * 첫 자리가 잡히기 전에는 화면을 보고하지 않는다.
 *
 * 이 보고는 "지금 화면 38% 높이에 있는 원문 줄"이고, host는 그것을 나중에
 * Preview를 그 높이로 되돌리는 기준으로 쓴다. stylesheet와 수식 font가 붙기
 * 전에는 블록이 제 높이를 갖지 않아 첫 화면 안에 문서의 절반이 들어와 있는
 * 것처럼 보인다. 그 상태를 보고하면 문서를 열자마자 한가운데로 내려간다.
 *
 * 한 번 자리가 잡히면 다시 가리지 않는다. font는 뒤늦게 한 벌 더 불려올 수
 * 있고, 그때마다 보고를 막으면 사용자가 실제로 보고 있는 위치를 host가
 * 영영 모르게 된다.
 */
let initialLayoutReady = false;

function markInitialLayoutReady() {
  if (initialLayoutReady) return;
  initialLayoutReady = true;
  sourceAtlas.invalidate();
  scheduleViewportState();
}

function awaitInitialLayout() {
  const settle = () => {
    if (document.fonts) {
      void document.fonts.ready.then(markInitialLayoutReady, markInitialLayoutReady);
    } else {
      markInitialLayoutReady();
    }
  };
  if (document.readyState === 'complete') settle();
  else window.addEventListener('load', settle, { once: true });
}

awaitInitialLayout();

function publishViewportState() {
  viewportStateFrame = null;
  if (!initialLayoutReady) return;
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
  const maximum = Math.max(
    0,
    (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
  );
  send({
    type: 'marktex:viewport-state',
    revision: config.revision,
    anchor: sourceAtlas.viewportAnchorAt(GOLDEN_TOP_RATIO),
    scrollRatio: maximum > 0 ? scrollTop / maximum : 0,
  });
}

function scheduleViewportState() {
  if (viewportStateFrame !== null) return;
  viewportStateFrame = window.requestAnimationFrame(publishViewportState);
}

function restoreScrollRatio(scrollRatio: number) {
  const ratio = Math.min(1, Math.max(0, scrollRatio));
  const maximum = Math.max(
    0,
    (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
  );
  const scrollTop = maximum * ratio;
  document.documentElement.scrollTop = scrollTop;
  document.body.scrollTop = scrollTop;
}

// 목차·검색·접힘 상태는 reader-tools가 관리한다.

// 테마는 Markdown의 의미나 DOM이 아니라 표현 상태다. 문서를 다시 navigation하지
// 않고 Crossnote가 삽입한 두 stylesheet만 교체해 scroll/search/TOC 상태를 보존한다.
function isLocalThemeAsset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'marktex-resource:';
  } catch {
    return false;
  }
}

function themeStylesheet(pathFragment: string): HTMLLinkElement | null {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .find((link) => {
      try {
        return decodeURIComponent(link.href).includes(pathFragment);
      } catch {
        return link.href.includes(pathFragment);
      }
    }) ?? null;
}

function replaceThemeStylesheet(pathFragment: string, url: string): Promise<void> {
  const existing = themeStylesheet(pathFragment);
  if (existing) {
    if (existing.href === url) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => resolve();
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', finish, { once: true });
      existing.href = url;
      window.setTimeout(finish, 1_000);
    });
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  return new Promise((resolve) => {
    const finish = () => resolve();
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    document.head.append(link);
    window.setTimeout(finish, 1_000);
  });
}

let themeApplication = 0;

async function applyTheme(themeId: string, previewCssUrl: unknown, codeCssUrl: unknown) {
  if (!isLocalThemeAsset(previewCssUrl) || !isLocalThemeAsset(codeCssUrl)) return;
  const application = ++themeApplication;
  // 심어 둔 바탕색을 새 theme으로 옮긴다. stylesheet 교체 사이의 어떤
  // frame도 흰색으로 칠해지지 않는다.
  paintRootBackground(themeId);
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
  const maximumScrollTop = Math.max(
    0,
    (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
  );
  const boundary = scrollTop <= 1
    ? 'start'
    : maximumScrollTop > 0 && maximumScrollTop - scrollTop <= 1
      ? 'end'
      : null;
  const semanticAnchor = sourceAtlas.viewportAnchorAt(GOLDEN_TOP_RATIO);
  await Promise.all([
    replaceThemeStylesheet('/styles/preview_theme/', previewCssUrl),
    replaceThemeStylesheet('/styles/prism_theme/', codeCssUrl),
  ]);
  if (application !== themeApplication) return;
  // theme별 글꼴·행간·margin이 달라져도 같은 pixel Y가 아니라 같은 source
  // 내용을 같은 viewport 비율에 둔다. 문서 시작/끝은 그 자체가 의미론적 위치다.
  // 두 frame 적용은 font/layout 후행 변화를 흡수한다.
  const restoreThemePosition = () => {
    if (boundary === 'start') {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      return;
    }
    if (boundary === 'end') {
      const nextMaximum = Math.max(
        0,
        (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
      );
      document.documentElement.scrollTop = nextMaximum;
      document.body.scrollTop = nextMaximum;
      return;
    }
    sourceAtlas.position(semanticAnchor.sourceLine, semanticAnchor.yRatio);
  };
  const finishThemeApplication = () => {
    document.body.dataset.setdownPreviewTheme = themeId;
    document.body.dataset.setdownThemeAnchorLine = String(semanticAnchor.sourceLine);
    document.body.dataset.previewTheme = [
      'github-dark',
      'night',
      'one-dark',
      'solarized-dark',
    ].includes(themeId) ? 'dark' : 'light';
    sourceAtlas.invalidate();
    scheduleViewportState();
    send({ type: 'marktex:theme-applied', revision: config.revision, themeId });
  };
  sourceAtlas.invalidate();
  // 숨긴 WebContentsView에는 Chromium이 animation frame을 주지 않는다. 여기서
  // frame을 기다리면 탭을 드러낸 뒤에야 테마가 완료되어 이전 색이 한 번 보인다.
  // stylesheet는 이미 load됐으므로 숨은 탭은 동기적으로 위치를 맞추고 완료한다.
  if (document.visibilityState === 'hidden') {
    restoreThemePosition();
    finishThemeApplication();
    return;
  }
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => {
    restoreThemePosition();
    resolve();
  }));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => {
    restoreThemePosition();
    resolve();
  }));
  finishThemeApplication();
}

// 본문 설치 sequence만 bridge가 소유한다.

let htmlUpdateSequence = 0;

// ── 더블 클릭: 조건 없는 상태 전환 ──────────────────────────────────
document.addEventListener(
  'dblclick',
  (event) => {
    cancelPendingGesture();
    const target = event.target instanceof Element ? event.target : null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const anchor = sourceAtlas.anchorAtPoint(event.clientX, event.clientY, target, path);
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

document.addEventListener('keydown', (event) => {
  // Crossnote는 Esc를 자체 Outline 토글로 사용한다. Setdown은 독립된 목차를
  // 제공하므로 iframe 내부의 숨은 두 번째 navigation surface를 열지 않는다.
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (
    event.key.toLowerCase() === 'f'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: 'marktex:open-find', revision: config.revision });
  }
}, true);

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

// ── 본문 설치: crossnote의 왕복을 건너뛰고 한 번만 파싱한다 ──────────

function previewRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PREVIEW_SELECTOR);
}

/**
 * 본문이 자리를 잡은 뒤에 해야 하는 일.
 *
 * crossnote의 `updateHtml`이 초기화 끝에 하던 것 중 이 앱이 쓰는 것만
 * 남겼다. class는 zen mode를, 나머지는 새 DOM 위에서 색인과 접힘 상태를
 * 다시 세운다. 링크는 위임 handler가 문서 하나에 한 번만 달린다.
 */
function finishInstall(root: HTMLElement) {
  root.className = 'crossnote markdown-preview zen-mode';
  applyDisclosures(null);
  sourceAtlas.invalidate();
  scheduleHeadings();
  scheduleViewportState();
  // 새 본문이 부르는 font가 붙으면 모든 블록의 높이가 달라진다. 그때 색인과
  // 화면 보고를 한 번 다시 세운다.
  void document.fonts?.ready.then(() => {
    sourceAtlas.invalidate();
    scheduleViewportState();
  }).catch(() => {});
}

let deferredHtmlBlocks: string[] = [];
let deferredHydrationGeneration = 0;
let deferredHydrationStartedGeneration = 0;

function cancelDeferredHydration() {
  deferredHtmlBlocks = [];
  deferredHydrationGeneration += 1;
  document.body.dataset.setdownHydration = 'complete';
  document.body.dataset.setdownDeferredBlockCount = '0';
  document.body.dataset.setdownPendingBlockCount = '0';
}

function finishDeferredHydration(root: HTMLElement) {
  document.body.dataset.setdownHydration = 'complete';
  document.body.dataset.setdownPendingBlockCount = '0';
  document.body.dataset.setdownHydrationCompletedMs = String(performance.now());
  document.body.dataset.setdownFullElementCount = String(root.querySelectorAll('*').length);
  sourceAtlas.invalidate();
  scheduleHeadings();
  scheduleViewportState();
}

/** 한 frame의 style/layout을 다시 길게 막지 않도록 뒤쪽 블록을 작은 묶음으로 심는다. */
function hydrateDeferredBatch(root: HTMLElement, generation: number) {
  if (generation !== deferredHydrationGeneration || deferredHtmlBlocks.length === 0) return;
  const batch: string[] = [];
  let bytes = 0;
  while (deferredHtmlBlocks.length > 0 && batch.length < 8) {
    const next = deferredHtmlBlocks[0];
    if (batch.length > 0 && bytes + next.length > 64 * 1024) {
      break;
    }
    deferredHtmlBlocks.shift();
    batch.push(next);
    bytes += next.length;
  }
  document.body.dataset.setdownPendingBlockCount = String(deferredHtmlBlocks.length);

  const holder = document.createElement('template');
  holder.innerHTML = batch.join('\n');
  const inserted = Array.from(holder.content.children);
  root.append(holder.content);
  applyDisclosures(inserted);
  sourceAtlas.invalidate();
  scheduleHeadings();

  if (deferredHtmlBlocks.length === 0) {
    finishDeferredHydration(root);
    return;
  }
  scheduleHydrationFrame(root, generation);
}

function scheduleHydrationFrame(root: HTMLElement, generation: number) {
  window.requestAnimationFrame(() => hydrateDeferredBatch(root, generation));
}

function beginDeferredHydration(root: HTMLElement, blocks: string[]) {
  const generation = ++deferredHydrationGeneration;
  deferredHtmlBlocks = blocks;
  document.body.dataset.setdownHydrationStartedMs = String(performance.now());
  document.body.dataset.setdownInitialElementCount = String(root.querySelectorAll('*').length);
  document.body.dataset.setdownDeferredBlockCount = String(blocks.length);
  document.body.dataset.setdownPendingBlockCount = String(blocks.length);
  if (blocks.length === 0) {
    finishDeferredHydration(root);
    return;
  }
  document.body.dataset.setdownHydration = 'pending';
}

function resumeDeferredHydrationAfterPaint() {
  const root = previewRoot();
  const generation = deferredHydrationGeneration;
  if (!root || deferredHtmlBlocks.length === 0) return;
  if (deferredHydrationStartedGeneration === generation) return;
  deferredHydrationStartedGeneration = generation;
  // 메인이 view를 드러낸 뒤 보내는 신호다. 최초 본문을 표시할 frame 둘을
  // compositor에 먼저 양보한 다음에만 뒤쪽 DOM을 만들기 시작한다.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (generation === deferredHydrationGeneration) scheduleHydrationFrame(root, generation);
  }));
}

/** 검색·편집·임의 위치 이동은 전체 문서를 전제로 하므로 남은 본문을 즉시 완성한다. */
function hydrateAllDeferredHtml() {
  if (deferredHtmlBlocks.length === 0) return;
  const root = previewRoot();
  if (!root) return;
  const pending = deferredHtmlBlocks;
  deferredHtmlBlocks = [];
  deferredHydrationGeneration += 1;
  const holder = document.createElement('template');
  holder.innerHTML = pending.join('\n');
  const inserted = Array.from(holder.content.children);
  root.append(holder.content);
  applyDisclosures(inserted);
  finishDeferredHydration(root);
}

function readDeferredInitialBlocks(): string[] {
  const carrier = document.getElementById(DEFERRED_HTML_SCRIPT_ID);
  if (!carrier) return [];
  carrier.remove();
  try {
    const parsed = JSON.parse(carrier.textContent || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function hydratedThroughSourceLine(sourceLine: number, band: BandLine[]): boolean {
  if (deferredHtmlBlocks.length === 0) return true;
  const root = previewRoot();
  if (!root) return false;
  let lastLine = 0;
  root.querySelectorAll(ANCHOR_SELECTOR).forEach((element) => {
    const values = [
      sourceLinePair(element.getAttribute('data-source-end'))?.[0],
      sourceLinePair(element.getAttribute('data-source-lines'))?.[1],
      Number(element.getAttribute('data-source-line')),
    ];
    for (const value of values) {
      if (Number.isFinite(value)) lastLine = Math.max(lastLine, Number(value));
    }
  });
  const requestedLine = band.reduce(
    (largest, entry) => Math.max(largest, entry.sourceLine),
    sourceLine,
  );
  return requestedLine <= lastLine;
}

/**
 * 첫 로드. 워커가 `<template>`에 실어 보낸 본문을 그 자리로 옮긴다.
 *
 * `replaceChildren`은 이미 파싱된 node를 옮기기만 한다. 문자열로 되돌리는
 * 단계도, 다시 파싱하는 단계도 없다.
 */
function installInitialHtml(): boolean {
  const carrier = document.getElementById(INITIAL_HTML_TEMPLATE_ID);
  const root = previewRoot();
  if (!(carrier instanceof HTMLTemplateElement) || !root) return false;
  root.replaceChildren(carrier.content);
  carrier.remove();
  const deferred = readDeferredInitialBlocks();
  finishInstall(root);
  beginDeferredHydration(root, deferred);
  return true;
}

// ── 링크: crossnote의 초기화를 거치지 않으므로 여기서 위임으로 받는다 ──
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor || !previewRoot()?.contains(anchor)) return;
  const href = anchor.getAttribute('href') ?? '';
  // tag anchor는 이 앱이 다루지 않는다. 그대로 둔다.
  if (anchor.classList.contains('tag') || href.startsWith('tag://')) return;
  if (!href) return;
  event.preventDefault();
  event.stopPropagation();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const destination = id ? previewRoot()?.querySelector(`[id="${CSS.escape(id)}"]`) : null;
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
    // main이 허용 protocol만 다시 검사한다. 해석할 수 없는 값은 그대로 보내
    // 조용히 거부되게 한다.
  }
  send({
    command: 'clickTagA',
    args: [{
      uri: document.querySelector('base')?.href ?? '',
      href: encodeURIComponent(resolvedHref),
      scheme: 'file',
    }],
  });
}, true);

// ── host의 요청: 지금 보고 있는 화면의 anchor ────────────────────────
window.addEventListener('message', (event) => {
  if (event.source !== window && event.source !== window.parent) return;
  const data = event.data as {
    command?: string;
    topRatio?: number;
    sourceLine?: number;
    band?: unknown;
    from?: number;
    removeCount?: number;
    insertCount?: number;
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
  } | null;
  if (!data) return;
  if (data.command === 'marktex:resume-hydration') {
    resumeDeferredHydrationAfterPaint();
    return;
  }
  if (data.command === 'marktex:sync-config') {
    const update = data as typeof data & { totalLineCount?: number; revision?: number };
    config.totalLineCount = Math.max(1, Number(update.totalLineCount) || 1);
    config.revision = Math.max(0, Number(update.revision) || 0);
    applyBaseHref((data as typeof data & { baseHref?: string }).baseHref);
    send({ type: 'marktex:html-updated', revision: config.revision });
    return;
  }
  if (data.command === 'marktex:patch-blocks') {
    const update = data as typeof data & {
      html?: string; markdown?: string; totalLineCount?: number;
      revision?: number; baseHref?: string;
    };
    config.totalLineCount = Math.max(1, Number(update.totalLineCount) || 1);
    config.revision = Math.max(0, Number(update.revision) || 0);
    applyBaseHref(update.baseHref);
    const root = previewRoot();
    let insertedNodes: Element[] = [];
    if (root) {
      const children = Array.from(root.children);
      const completeLength = children.length + deferredHtmlBlocks.length;
      const from = Math.min(Math.max(0, Math.round(Number(update.from) || 0)), completeLength);
      const removeCount = Math.min(
        Math.max(0, Math.round(Number(update.removeCount) || 0)),
        completeLength - from,
      );
      const insertedHtml = splitPreviewBlocks(String(update.html ?? ''))
        .map((block) => block.html);
      const delta = Math.round(Number(update.lineDelta) || 0);

      if (deferredHtmlBlocks.length > 0 && from > children.length) {
        // 변경 지점 전체가 아직 문자열인 경우 DOM은 전혀 건드리지 않는다.
        const deferredFrom = from - children.length;
        deferredHtmlBlocks.splice(
          deferredFrom,
          removeCount,
          ...insertedHtml,
        );
        if (delta !== 0) {
          for (let index = deferredFrom + insertedHtml.length;
            index < deferredHtmlBlocks.length; index += 1) {
            deferredHtmlBlocks[index] = shiftSourceLinesHtml(deferredHtmlBlocks[index], delta);
          }
        }
      } else {
        // 변경이 설치된 접두에 닿으면 그 작은 구간만 DOM에 반영한다. 삭제가
        // 경계를 넘은 부분만 deferred 배열의 앞에서 함께 걷어낸다.
        const holder = document.createElement('template');
        holder.innerHTML = insertedHtml.join('\n');
        const inserted = Array.from(holder.content.children);
        const domFrom = Math.min(from, children.length);
        const domRemoveCount = Math.min(removeCount, children.length - domFrom);
        const deferredRemoveCount = removeCount - domRemoveCount;
        const anchor = children[domFrom + domRemoveCount] ?? null;
        for (let index = 0; index < domRemoveCount; index += 1) {
          children[domFrom + index].remove();
        }
        for (const node of inserted) root.insertBefore(node, anchor);
        insertedNodes = inserted;
        if (deferredRemoveCount > 0) deferredHtmlBlocks.splice(0, deferredRemoveCount);
        if (delta !== 0) {
          const rest = Array.from(root.children).slice(domFrom + inserted.length);
          for (const element of rest) shiftSourceLines(element, delta);
          for (let index = 0; index < deferredHtmlBlocks.length; index += 1) {
            deferredHtmlBlocks[index] = shiftSourceLinesHtml(deferredHtmlBlocks[index], delta);
          }
        }
      }

      document.body.dataset.setdownPendingBlockCount = String(deferredHtmlBlocks.length);
      if (deferredHtmlBlocks.length === 0) finishDeferredHydration(root);
    }
    applyDisclosures(insertedNodes);
    sourceAtlas.invalidate();
    // 곧바로 답한다. 패치는 이 핸들러 안에서 동기로 끝났고, frame을 기다릴
    // 이유가 없다. 편집 중에는 이 view가 숨겨져 있어 rAF가 느려지는데,
    // 측정에서 그 대기가 34바이트 패치에 162ms였다.
    send({ type: 'marktex:html-updated', revision: config.revision });
    return;
  }
  if (data.command === 'marktex:update-html') {
    const update = data as typeof data & {
      html?: string;
      markdown?: string;
      totalLineCount?: number;
      revision?: number;
      baseHref?: string;
    };
    // 부팅만 해 둔 예비 Preview를 넘겨받았으면 base가 이전 문서의 폴더다.
    // 새 본문을 심기 전에 옮겨야 상대 경로 자산이 제 폴더에서 풀린다.
    applyBaseHref(update.baseHref);
    const sequence = ++htmlUpdateSequence;
    const updateRevision = Math.max(0, Number(update.revision) || 0);
    config.totalLineCount = Math.max(1, Number(update.totalLineCount) || 1);
    config.revision = updateRevision;
    const html = String(update.html ?? '');
    const root = previewRoot();
    cancelDeferredHydration();

    // 워커가 보낸 HTML은 이미 sanitize를 거쳤다. 곧바로 심으면 본문을 한 번만
    // 파싱한다. crossnote에게 넘기면 sanitize 한 번, 숨은 DOM에 한 번,
    // 그것을 문자열로 되돌려 보이는 DOM에 다시 한 번 지나간다.
    if (root && !requiresCrossnoteInstall(html)) {
      const partition = partitionPreviewHtml(html);
      root.innerHTML = partition.eagerHtml;
      finishInstall(root);
      beginDeferredHydration(root, partition.deferredBlocks);
      // patch 경로와 같은 이유로 곧바로 답한다. 설치는 이 handler 안에서
      // 동기로 끝났고, 이 view는 아직 숨어 있어 frame이 오지 않는다. host는
      // 이 답을 받아야 view를 보여 주므로, frame을 기다리면 서로를 기다린다.
      send({ type: 'marktex:html-updated', revision: updateRevision });
      return;
    }

    // 브라우저에서 그려지는 도해가 든 문서. crossnote의 초기화가 필요하다.
    let completed = false;
    let timeout = 0;
    const finish = () => {
      if (completed || sequence !== htmlUpdateSequence) return;
      completed = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      const installed = previewRoot();
      if (installed) finishInstall(installed);
      send({ type: 'marktex:html-updated', revision: updateRevision });
    };
    // 보이는 쪽 DOM만 본다. 숨은 DOM은 crossnote가 먼저 채우므로, 그것을
    // 신호로 삼으면 본문이 승격되기도 전에 다 됐다고 답하게 된다.
    const observer = new MutationObserver(() => finish());
    if (root) observer.observe(root, { childList: true });
    timeout = window.setTimeout(finish, 4500);
    // Crossnote preview runtime가 제공하는 updateHtml 경로를 그대로 쓴다.
    // navigation하지 않으므로 현재 WebContents, stylesheet, JS heap과 viewport가
    // 살아 있고 Crossnote의 hidden DOM buffer가 완성된 내용만 승격한다.
    window.postMessage({
      command: 'updateHtml',
      html,
      markdown: String(update.markdown ?? ''),
      tocHTML: '',
      totalLineCount: config.totalLineCount,
      id: '',
      class: '',
    }, '*');
    return;
  }
  if (data.command === 'marktex:apply-theme') {
    void applyTheme(data.themeId ?? '', data.previewCssUrl, data.codeCssUrl);
    return;
  }
  if (data.command === 'marktex:find') {
    if (data.query) hydrateAllDeferredHtml();
    performSearch(
      typeof data.query === 'string' ? data.query.slice(0, 512) : '',
      data.direction === 'backward' ? 'backward' : 'forward',
      !!data.findNext,
    );
    return;
  }
  if (data.command === 'marktex:stop-find') {
    clearSearchHighlights();
    return;
  }
  if (data.command === 'marktex:collect-headings') {
    publishHeadings(true);
    return;
  }
  if (data.command === 'marktex:scroll-to-heading') {
    if (typeof data.id !== 'string') return;
    scrollToHeading(data.id, hydrateAllDeferredHtml, scheduleViewportState);
    return;
  }
  if (data.command === 'marktex:restore-scroll-ratio') {
    hydrateAllDeferredHtml();
    const ratio = Number.isFinite(data.scrollRatio) ? Number(data.scrollRatio) : 0;
    const preview = document.querySelector(PREVIEW_SELECTOR);
    let settleTimer: number | null = null;
    let observer: MutationObserver | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      observer?.disconnect();
      restoreScrollRatio(ratio);
      window.requestAnimationFrame(() => send({
        type: 'marktex:preview-scroll-restored',
        revision: config.revision,
        requestId: data.requestId,
      }));
    };
    const applyAndSettle = () => {
      if (finished) return;
      restoreScrollRatio(ratio);
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
  if (data.command === 'marktex:position-preview') {
    const sourceLine = Math.min(
      config.totalLineCount,
      Math.max(1, Number(data.sourceLine) || 1),
    );
    const ratio = Number.isFinite(data.topRatio) ? Number(data.topRatio) : GOLDEN_TOP_RATIO;
    const band = sourceAtlas.readBand(data.band);
    if (!hydratedThroughSourceLine(sourceLine, band)) hydrateAllDeferredHtml();
    // 목표가 이미 설치된 접두에 있으면 뒤쪽 배치 추가는 그 위치를 바꾸지 않는다.
    // 그 mutation을 끝까지 관찰하며 position을 재적용하면, 사용자가 그 사이 직접
    // 스크롤한 것까지 수 초 뒤 과거 위치로 되돌려 버린다.
    const shouldSettle = data.settle !== false && deferredHtmlBlocks.length === 0;
    if (!shouldSettle) {
      sourceAtlas.position(sourceLine, ratio, band);
      window.requestAnimationFrame(() => send({
        type: 'marktex:preview-positioned',
        revision: config.revision,
        requestId: data.requestId,
      }));
      return;
    }
    const preview = document.querySelector(PREVIEW_SELECTOR);
    let settleTimer: number | null = null;
    let observer: MutationObserver | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      observer?.disconnect();
      sourceAtlas.position(sourceLine, ratio, band);
      window.requestAnimationFrame(() => send({
        type: 'marktex:preview-positioned',
        revision: config.revision,
        requestId: data.requestId,
      }));
    };
    const applyAndSettle = () => {
      if (finished) return;
      sourceAtlas.position(sourceLine, ratio, band);
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
  send({ type: 'edit-at-anchor', anchor: sourceAtlas.anchorAtPoint(clientX, clientY, target, path) });
});

// ── 색인 무효화: resize, 이미지 로드, 다이어그램 렌더 ─────────────────
window.addEventListener('scroll', () => {
  if (deferredHtmlBlocks.length > 0 && window.scrollY > (window.innerHeight || 1) * 1.5) {
    // 스크롤바를 잡아 아직 만들지 않은 먼 구간으로 뛴 경우다. 부분 문서 높이의
    // 같은 pixel에 머물면 의도보다 위쪽 내용이나 source anchor 없는 빈 띠가 온다.
    // 전체를 완성한 뒤 사용자가 고른 상대 위치를 원문 행으로 환산해 golden line에
    // 놓는다. 그래야 높이가 크게 다른 수식 사이의 빈 margin이 anchor가 되지 않는다.
    const oldMaximum = Math.max(
      1,
      document.documentElement.scrollHeight - (window.innerHeight || 1),
    );
    const ratio = Math.min(1, Math.max(0, window.scrollY / oldMaximum));
    hydrateAllDeferredHtml();
    const estimatedSourceLine = Math.max(
      1,
      Math.min(config.totalLineCount, Math.round(1 + ratio * (config.totalLineCount - 1))),
    );
    sourceAtlas.position(estimatedSourceLine, GOLDEN_TOP_RATIO);
  }
  scheduleViewportState();
  publishActiveHeading();
}, { passive: true });
window.addEventListener('resize', () => {
  sourceAtlas.invalidate();
  scheduleViewportState();
  publishActiveHeading();
});
window.addEventListener('load', () => {
  sourceAtlas.invalidate();
  scheduleViewportState();
}, true);
document.addEventListener('load', () => {
  sourceAtlas.invalidate();
  scheduleViewportState();
}, true);
document.addEventListener('DOMContentLoaded', () => {
  sourceAtlas.invalidate();
  scheduleViewportState();
  scheduleHeadings();
});

// lean page에는 Crossnote preview.js가 없으므로 webviewFinishLoading 신호도 없다.
// root와 carrier는 이 bundle보다 앞에 파싱되어 있어 여기서 곧바로 옮길 수 있다.
// full page는 기존 Crossnote 신호가 같은 함수를 호출한다.
if (document.body.dataset.setdownPreviewRuntime === 'lean') installInitialHtml();

const observer = new MutationObserver(() => {
  sourceAtlas.invalidate();
  scheduleViewportState();
  scheduleHeadings();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'data-source-line', 'data-processed'],
});
send({ type: 'marktex:ready', revision: config.revision });
scheduleViewportState();
scheduleHeadings();
