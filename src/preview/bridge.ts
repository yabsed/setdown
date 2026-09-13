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
  resolveBandScrollTop,
  resolveViewerPoint,
  type BandLine,
  type SourceCandidate,
  type ViewportAnchor,
  type ViewportBandSample,
} from '../shared/viewport-anchor';

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

const ANCHOR_SELECTOR = '[data-source-line], [data-source-start], [data-source-lines]';
const PREVIEW_SELECTOR = '.markdown-preview[data-for="preview"]';
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

/** 이 줄을 실제로 담고 있는 entry. 스냅하지 않는다. */
function containingEntry(entries: AtlasEntry[], sourceLine: number): AtlasEntry | undefined {
  return entries.find((entry) =>
    entry.line <= sourceLine && (entry.endLine ?? entry.line) >= sourceLine,
  );
}

/** 두 좌표계에서 위치를 모두 아는 줄만 표본으로 남긴다. */
function bandSamples(entries: AtlasEntry[], band: BandLine[]): ViewportBandSample[] {
  const samples: ViewportBandSample[] = [];
  for (const line of band) {
    const entry = containingEntry(entries, line.sourceLine);
    if (!entry) continue;
    samples.push({
      renderedTop: entry.rect.top,
      renderedHeight: entry.rect.bottom - entry.rect.top,
      editorRatio: line.yRatio,
    });
  }
  return samples;
}

/** 줄 하나를 화면의 주어진 비율에 고정한다. */
function singleLineScrollTop(
  entries: AtlasEntry[],
  sourceLine: number,
  ratio: number,
): number {
  let targetTop: number;
  if (entries.length > 0) {
    const nearest = containingEntry(entries, sourceLine)
      ?? entries.reduce((best, entry) =>
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
  return targetTop - (window.innerHeight || 1) * ratio;
}

/** 예비 view를 넘겨받았을 때 등, base가 다른 문서를 가리키면 옮긴다. */
function applyBaseHref(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('marktex-resource://')) return;
  const base = document.querySelector('base');
  if (base) base.setAttribute('href', value);
}

/**
 * 줄이 밀린 블록의 source 좌표를 델타만큼 옮긴다.
 *
 * 내용은 그대로이므로 다시 조판하지 않는다. 속성만 고치면 되고, 그래야
 * atlas가 가리키는 행과 실제 원문이 계속 맞는다.
 */
function shiftSourceLines(root: Element, delta: number) {
  const shiftPair = (value: string | null, separator: string): string | null => {
    if (!value) return null;
    const parts = value.split(separator);
    const first = Number(parts[0]);
    if (!Number.isFinite(first)) return null;
    parts[0] = String(Math.max(1, first + delta));
    return parts.join(separator);
  };
  const apply = (element: Element) => {
    const line = Number(element.getAttribute('data-source-line'));
    if (Number.isFinite(line)) {
      element.setAttribute('data-source-line', String(Math.max(1, line + delta)));
    }
    const lines = element.getAttribute('data-source-lines');
    if (lines) {
      const [start, end] = lines.split('-').map(Number);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        element.setAttribute(
          'data-source-lines',
          `${Math.max(1, start + delta)}-${Math.max(1, end + delta)}`,
        );
      }
    }
    for (const name of ['data-source-start', 'data-source-end']) {
      const shifted = shiftPair(element.getAttribute(name), ':');
      if (shifted !== null) element.setAttribute(name, shifted);
    }
  };
  if (root.matches(ANCHOR_SELECTOR)) apply(root);
  root.querySelectorAll(ANCHOR_SELECTOR).forEach(apply);
}

/** 아직 문자열로 남은 뒤쪽 블록에도 같은 줄 이동을 적용한다. */
function shiftSourceLinesHtml(html: string, delta: number): string {
  if (delta === 0) return html;
  return html.replace(
    /\b(data-source-(?:line|lines|start|end))="(\d+)(?:([:-])(\d+))?"/g,
    (whole, name: string, first: string, separator?: string, second?: string) => {
      const shiftedFirst = Math.max(1, Number(first) + delta);
      if (!separator || second === undefined) return `${name}="${shiftedFirst}"`;
      // lines의 두 숫자는 모두 행이다. start/end의 두 번째 숫자는 열이다.
      const shiftedSecond = separator === '-'
        ? Math.max(1, Number(second) + delta)
        : Number(second);
      return `${name}="${shiftedFirst}${separator}${shiftedSecond}"`;
    },
  );
}

/** host가 보낸 띠를 신뢰하지 않고 읽는다. 망가져 있으면 빈 띠다. */
function readBand(value: unknown): BandLine[] {
  if (!Array.isArray(value)) return [];
  const band: BandLine[] = [];
  for (const item of value) {
    const sourceLine = Number((item as BandLine)?.sourceLine);
    const yRatio = Number((item as BandLine)?.yRatio);
    if (!Number.isFinite(sourceLine) || sourceLine < 1) continue;
    if (!Number.isFinite(yRatio)) continue;
    band.push({
      sourceLine: Math.min(config.totalLineCount, Math.round(sourceLine)),
      yRatio: Math.min(1, Math.max(0, yRatio)),
    });
  }
  return band;
}

function positionPreview(sourceLine: number, topRatio: number, band: BandLine[] = []) {
  invalidateAtlas();
  const entries = getAtlas();
  const ratio = Math.min(1, Math.max(0, topRatio));

  // 띠를 받았으면 무게중심으로 맞춘다. cursor가 화면에 있을 때는 host가 띠를
  // 보내지 않는다. 그 한 점이 사용자의 관심이고, 평균으로 흐리면 안 된다.
  const target = resolveBandScrollTop(
    bandSamples(entries, band),
    window.innerHeight || 1,
  ) ?? singleLineScrollTop(entries, sourceLine, ratio);

  const maximum = Math.max(
    0,
    (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
  );
  const scrollTop = Math.min(maximum, Math.max(0, target));
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

let viewportStateFrame: number | null = null;

function viewportAnchorAt(yRatio: number): ViewportAnchor {
  const clientY = (window.innerHeight || 1) * yRatio;
  const clientX = (window.innerWidth || 1) / 2;
  const target = document.elementFromPoint(clientX, clientY);
  const path: EventTarget[] = [];
  let node: Element | null = target;
  while (node) {
    path.push(node);
    node = node.parentElement;
  }
  return anchorAtPoint(clientX, clientY, target, path);
}

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
  invalidateAtlas();
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
    anchor: viewportAnchorAt(GOLDEN_TOP_RATIO),
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

// ── 읽기 도구: Crossnote DOM에서 heading 구조만 꺼낸다 ─────────────
type PreviewHeading = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  sourceLine?: number;
};

let headingElements = new Map<string, HTMLElement>();
let headingSignature = '';
let activeHeadingId: string | null = null;
let headingTimer: number | null = null;

function readHeadings(): PreviewHeading[] {
  const root = document.querySelector(PREVIEW_SELECTOR);
  const nextElements = new Map<string, HTMLElement>();
  const headings: PreviewHeading[] = [];
  root?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
    const level = Number(heading.tagName.slice(1)) as PreviewHeading['level'];
    const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const id = heading.id ? `id:${heading.id}` : `index:${index}`;
    const source = Number(
      heading.getAttribute('data-source-line')
      ?? heading.closest('[data-source-line]')?.getAttribute('data-source-line'),
    );
    nextElements.set(id, heading);
    headings.push({
      id,
      text,
      level,
      sourceLine: Number.isFinite(source) && source > 0 ? source : undefined,
    });
  });
  headingElements = nextElements;
  return headings;
}

function publishActiveHeading() {
  if (headingElements.size === 0) readHeadings();
  const threshold = Math.min(120, Math.max(36, window.innerHeight * 0.16));
  let active: string | null = null;
  for (const [id, heading] of headingElements) {
    if (heading.getBoundingClientRect().top <= threshold) active = id;
    else if (active === null) {
      active = id;
      break;
    } else break;
  }
  if (active === activeHeadingId) return;
  activeHeadingId = active;
  send({ type: 'marktex:active-heading', revision: config.revision, id: active });
}

function publishHeadings(force = false) {
  const headings = readHeadings();
  const signature = JSON.stringify(headings);
  if (force || signature !== headingSignature) {
    headingSignature = signature;
    send({ type: 'marktex:headings', revision: config.revision, headings });
  }
  publishActiveHeading();
}

function scheduleHeadings() {
  if (headingTimer !== null) window.clearTimeout(headingTimer);
  headingTimer = window.setTimeout(() => {
    headingTimer = null;
    publishHeadings();
  }, 60);
}

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
  const semanticAnchor = viewportAnchorAt(GOLDEN_TOP_RATIO);
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
    positionPreview(semanticAnchor.sourceLine, semanticAnchor.yRatio);
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
    invalidateAtlas();
    scheduleViewportState();
    send({ type: 'marktex:theme-applied', revision: config.revision, themeId });
  };
  invalidateAtlas();
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

// CSS Highlight API는 Range를 표시할 뿐 Crossnote의 DOM을 감싸거나 바꾸지 않는다.
type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

let searchQuery = '';
let searchRanges: Range[] = [];
let activeSearchIndex = -1;

function highlightRegistry(): HighlightRegistry | null {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;
}

function clearSearchHighlights() {
  const registry = highlightRegistry();
  registry?.delete('setdown-search-results');
  registry?.delete('setdown-search-active');
  searchQuery = '';
  searchRanges = [];
  activeSearchIndex = -1;
}

function buildSearchRanges(query: string): Range[] {
  const root = document.querySelector(PREVIEW_SELECTOR);
  if (!root || !query) return [];
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, [hidden]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const start = text.length;
    text += node.data;
    nodes.push({ node, start, end: text.length });
    current = walker.nextNode();
  }

  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const ranges: Range[] = [];
  let offset = 0;
  while (needle && ranges.length < 10_000) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    const end = found + needle.length;
    const startNode = nodes.find((entry) => entry.start <= found && entry.end > found);
    const endNode = nodes.find((entry) => entry.start < end && entry.end >= end);
    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode.node, found - startNode.start);
      range.setEnd(endNode.node, end - endNode.start);
      ranges.push(range);
    }
    offset = Math.max(end, found + 1);
  }
  return ranges;
}

function paintSearchHighlights() {
  const registry = highlightRegistry();
  const HighlightType = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  if (!registry || !HighlightType) return;
  registry.delete('setdown-search-results');
  registry.delete('setdown-search-active');
  if (searchRanges.length === 0) return;
  registry.set('setdown-search-results', new HighlightType(...searchRanges));
  if (activeSearchIndex >= 0) {
    registry.set('setdown-search-active', new HighlightType(searchRanges[activeSearchIndex]));
  }
}

function publishSearchResult() {
  send({
    type: 'marktex:find-result',
    revision: config.revision,
    activeMatch: activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0,
    matches: searchRanges.length,
  });
}

function performSearch(query: string, direction: 'forward' | 'backward', findNext: boolean) {
  if (!query) {
    clearSearchHighlights();
    publishSearchResult();
    return;
  }
  if (query !== searchQuery || !findNext) {
    searchQuery = query;
    searchRanges = buildSearchRanges(query);
    activeSearchIndex = searchRanges.length === 0
      ? -1
      : direction === 'backward' ? searchRanges.length - 1 : 0;
  } else if (searchRanges.length > 0) {
    const step = direction === 'backward' ? -1 : 1;
    activeSearchIndex = (activeSearchIndex + step + searchRanges.length) % searchRanges.length;
  }
  paintSearchHighlights();
  const active = searchRanges[activeSearchIndex];
  if (active) {
    const rect = active.getBoundingClientRect();
    if (rect.top < 48 || rect.bottom > window.innerHeight - 24) {
      active.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    }
  }
  publishSearchResult();
}

const searchStyle = document.createElement('style');
searchStyle.textContent = `
  ::highlight(setdown-search-results) { background: rgba(255, 210, 64, .58); color: inherit; }
  ::highlight(setdown-search-active) { background: #ff9f1c; color: #17130b; }
`;
document.head.append(searchStyle);

// ── <details> 접힘 상태 ─────────────────────────────────────────────
//
// 블록 패칭은 바뀐 블록의 DOM을 통째로 갈아 끼운다. 그 안에 있던 <details>는
// 새 element가 되므로 사용자가 펼쳐 둔 상태가 사라진다. 원문에는 그 상태가
// 없다. `open` 속성은 저자가 쓴 값이지 읽는 사람이 만든 값이 아니다.
//
// 그래서 이 탭의 preview page가 직접 기억한다. 탭마다 page가 하나이므로 이
// 표가 곧 탭별 상태이고, 탭 전환과 창 이동은 같은 page를 옮길 뿐이라 표도
// 그대로 따라간다.
type DisclosureState = {
  /** 사용자가 마지막으로 둔 상태. toggle을 들어서만 바뀐다. */
  open: boolean;
  /** 원문이 주장하던 상태. 갓 심어진 DOM에서만 읽는다. */
  authored: boolean;
};

const disclosureStates = new Map<string, DisclosureState>();
/** 복원하며 스스로 일으킨 toggle을 사용자의 조작으로 착각하지 않는다. */
let restoringDisclosures = false;

/**
 * summary 문구로 <details>를 가리킨다. 줄 번호는 위쪽을 고치면 밀리고, 순서만
 * 쓰면 <details>가 하나 늘 때 전부 어긋난다. 같은 문구가 여러 번 나오면
 * 나온 차례로 가른다.
 */
function disclosureKey(element: HTMLDetailsElement, seen: Map<string, number>): string {
  const label = (element.querySelector('summary')?.textContent ?? '')
    .trim().replace(/\s+/g, ' ').slice(0, 200);
  const nth = (seen.get(label) ?? 0) + 1;
  seen.set(label, nth);
  return `${label}\u0000${nth}`;
}

function eachDisclosure(visit: (element: HTMLDetailsElement, key: string) => void) {
  const seen = new Map<string, number>();
  for (const element of document.querySelectorAll('details')) {
    const details = element as HTMLDetailsElement;
    visit(details, disclosureKey(details, seen));
  }
}

/**
 * 갓 심어진 DOM에만 기억해 둔 상태를 되돌린다.
 *
 * `inserted`가 null이면 문서 전체가 새로 그려진 것으로 본다. 살아남은
 * element는 손대지 않는다. 그쪽의 `open`은 이미 사용자의 상태이고, 그것을
 * 원문의 주장과 견주면 사용자가 접어 둔 것을 저자의 뜻으로 오해한다.
 */
function applyDisclosures(inserted: Element[] | null) {
  restoringDisclosures = true;
  try {
    eachDisclosure((element, key) => {
      const fresh = inserted === null
        || inserted.some((node) => node === element || node.contains(element));
      if (!fresh) return;
      const known = disclosureStates.get(key);
      // 처음 보거나, 원문의 open이 지난번과 다르다. 저자의 뜻이 바뀐 것이다.
      if (!known || element.open !== known.authored) {
        disclosureStates.set(key, { open: element.open, authored: element.open });
        return;
      }
      if (element.open !== known.open) element.open = known.open;
    });
  } finally {
    restoringDisclosures = false;
  }
}

// toggle은 bubbling하지 않는다. capture 단계에서 받는다.
document.addEventListener('toggle', (event) => {
  if (restoringDisclosures) return;
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  eachDisclosure((element, key) => {
    if (element !== target) return;
    const known = disclosureStates.get(key);
    if (known) known.open = target.open;
    // 아직 본 적 없다면 방금 뒤집힌 것이므로 원문은 그 반대였다.
    else disclosureStates.set(key, { open: target.open, authored: !target.open });
  });
}, true);

let htmlUpdateSequence = 0;

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
  invalidateAtlas();
  scheduleHeadings();
  scheduleViewportState();
  // 새 본문이 부르는 font가 붙으면 모든 블록의 높이가 달라진다. 그때 색인과
  // 화면 보고를 한 번 다시 세운다.
  void document.fonts?.ready.then(() => {
    invalidateAtlas();
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
  invalidateAtlas();
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
  invalidateAtlas();
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
      parseLinePair(element.getAttribute('data-source-end'))?.[0],
      parseLinePair(element.getAttribute('data-source-lines'))?.[1],
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
    invalidateAtlas();
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
    publishSearchResult();
    return;
  }
  if (data.command === 'marktex:collect-headings') {
    publishHeadings(true);
    return;
  }
  if (data.command === 'marktex:scroll-to-heading') {
    if (typeof data.id !== 'string') return;
    let target = headingElements.get(data.id);
    if (!target) {
      hydrateAllDeferredHtml();
      readHeadings();
      target = headingElements.get(data.id);
    }
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    window.setTimeout(() => {
      publishActiveHeading();
      scheduleViewportState();
    }, 180);
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
    const band = readBand(data.band);
    if (!hydratedThroughSourceLine(sourceLine, band)) hydrateAllDeferredHtml();
    // 목표가 이미 설치된 접두에 있으면 뒤쪽 배치 추가는 그 위치를 바꾸지 않는다.
    // 그 mutation을 끝까지 관찰하며 position을 재적용하면, 사용자가 그 사이 직접
    // 스크롤한 것까지 수 초 뒤 과거 위치로 되돌려 버린다.
    const shouldSettle = data.settle !== false && deferredHtmlBlocks.length === 0;
    if (!shouldSettle) {
      positionPreview(sourceLine, ratio, band);
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
      positionPreview(sourceLine, ratio, band);
      window.requestAnimationFrame(() => send({
        type: 'marktex:preview-positioned',
        revision: config.revision,
        requestId: data.requestId,
      }));
    };
    const applyAndSettle = () => {
      if (finished) return;
      positionPreview(sourceLine, ratio, band);
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
    positionPreview(estimatedSourceLine, GOLDEN_TOP_RATIO);
  }
  scheduleViewportState();
  publishActiveHeading();
}, { passive: true });
window.addEventListener('resize', () => {
  invalidateAtlas();
  scheduleViewportState();
  publishActiveHeading();
});
window.addEventListener('load', () => {
  invalidateAtlas();
  scheduleViewportState();
}, true);
document.addEventListener('load', () => {
  invalidateAtlas();
  scheduleViewportState();
}, true);
document.addEventListener('DOMContentLoaded', () => {
  invalidateAtlas();
  scheduleViewportState();
  scheduleHeadings();
});

// lean page에는 Crossnote preview.js가 없으므로 webviewFinishLoading 신호도 없다.
// root와 carrier는 이 bundle보다 앞에 파싱되어 있어 여기서 곧바로 옮길 수 있다.
// full page는 기존 Crossnote 신호가 같은 함수를 호출한다.
if (document.body.dataset.setdownPreviewRuntime === 'lean') installInitialHtml();

const observer = new MutationObserver(() => {
  invalidateAtlas();
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
