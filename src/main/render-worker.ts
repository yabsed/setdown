/**
 * Preview 조판을 메인 프로세스 밖에서 돌린다.
 *
 * markdown-it과 KaTeX는 동기 CPU 작업이고, 수식이 많은 문서에서 한 번에
 * 500ms 넘게 걸린다. 그동안 메인 프로세스는 IPC를 하나도 처리하지 못한다.
 * 타자마다 오는 `document:update-text`, 편집창 스크롤마다 오는
 * `preview:command`가 모두 그 뒤에 줄을 선다.
 *
 * 그래서 조판을 여기로 옮긴다. 걸리는 시간은 그대로지만 다른 코어에서
 * 흐르므로 메인이 멈추지 않는다. 그러면 체크포인트를 촘촘히 돌릴 수 있고,
 * 사용자가 Esc를 누를 때는 이미 최신본이 설치되어 있을 확률이 높아진다.
 *
 * 보안 경계도 함께 넘어온다. 이 프로세스는 요청이 실어 보낸 root 목록
 * 안에서만 파일을 읽는다.
 */
import { promises as fs, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Notebook, getDefaultNotebookConfig, utility } from 'crossnote';
import type { FileSystemApi, WebviewConfig } from 'crossnote';
import {
  codeThemeFile,
  normalizePreviewTheme,
  previewThemeBackground,
  previewThemeFile,
  type PreviewThemeId,
} from '../shared/preview-preferences';
import { lineCount } from '../shared/document-state';
import { installSourceAnchors, type MarkdownItLike } from './source-anchors';
import { previewRelativeReference } from './preview-resources';
import {
  diffPreviewBlocks,
  splitPreviewBlocks,
  type PreviewBlock,
  type PreviewBlockPatch,
} from '../shared/preview-blocks';
import { INITIAL_HTML_TEMPLATE_ID, canInlineInitialHtml } from '../shared/preview-install';

export type RenderWorkerRequest =
  | {
    kind: 'render';
    id: number;
    /** 어느 탭의 Preview인가. 직전 블록을 이 키로 들고 있는다. */
    tabId: string;
    text: string;
    revision: number;
    documentPath: string;
    themeId: string;
    /** 이 렌더가 읽어도 되는 디렉터리. 메인이 매번 실어 보낸다. */
    roots: string[];
    /** 대상 view가 이미 Preview 페이지를 띄우고 있는가. */
    hasPage: boolean;
  }
  | { kind: 'forget-notebooks' }
  | { kind: 'forget-tab'; tabId: string };

/**
 * 응답은 필요한 것만 담는다.
 *
 * 갱신일 때는 `patch`만 간다. 조판된 HTML은 워커가 계속 들고 있으므로 3.5MB를
 * 프로세스 밖으로 옮기지 않는다. 측정에서 그 전송만 21ms였고, 메인이 다시
 * 쪼개는 데 12ms가 더 들었다.
 */
export type RenderWorkerReply =
  | {
    kind: 'render';
    id: number;
    ok: true;
    totalLineCount: number;
    baseHref: string;
    themeId: PreviewThemeId;
    /** 첫 로드용 완성 페이지. 그때만 실린다. */
    template?: string;
    /** 페이지는 있으나 블록 기록이 없을 때. update-html로 통째로 심는다. */
    html?: string;
    /** 블록 기록이 있을 때. 바뀐 구간만. null이면 바뀐 것이 없다. */
    patch?: PreviewBlockPatch | null;
  }
  | { kind: 'render'; id: number; ok: false; message: string };

type CrossnoteModule = typeof import('crossnote');
type NotebookInstance = Awaited<ReturnType<CrossnoteModule['Notebook']['init']>>;

const notebookCaches = new Map<string, NotebookInstance>();
/** 탭마다 지금 Preview에 설치되어 있는 블록. 다음 갱신의 비교 대상이다. */
const installedBlocks = new Map<string, PreviewBlock[]>();
const crossnoteOut = path.resolve(path.dirname(require.resolve('crossnote')), '..');
let allowedRoots: string[] = [];
let activeRoot: string | null = null;

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function assertReadablePath(candidate: string): string {
  const resolved = canonicalPath(candidate);
  const roots = [crossnoteOut, activeRoot, ...allowedRoots]
    .filter((root): root is string => !!root);
  if (!roots.some((root) => isInside(canonicalPath(root), resolved))) {
    throw new Error('The preview attempted to read outside the document folder.');
  }
  return resolved;
}

/**
 * 경로를 URL의 path로 그대로 실어 보낸다. 통째로 encoding하면 stylesheet 안의
 * 상대 참조(KaTeX의 `fonts/...`)가 엉뚱한 곳을 가리킨다.
 */
function resourceUrl(filePath: string): string {
  const { pathname } = pathToFileURL(path.resolve(filePath));
  const trailingSeparator = /[\\/]$/.test(filePath) ? '/' : '';
  return `marktex-resource://file${pathname}${trailingSeparator}`;
}

/**
 * Crossnote의 sanitizer는 사용자 콘텐츠의 custom protocol media URL을 지운다.
 * 문서 폴더 안 파일은 상대 URL로 두면 통과하고, preview의 <base>가 푼다.
 */
function previewFileReference(filePath: string): string {
  const absolute = canonicalPath(filePath);
  if (activeRoot) {
    const relative = previewRelativeReference(canonicalPath(activeRoot), absolute);
    if (relative !== null) return relative;
  }
  return resourceUrl(absolute);
}

function createReadOnlyFileSystem(root: string): FileSystemApi {
  const checked = (candidate: string) => {
    const absolute = path.resolve(candidate);
    if (!isInside(root, absolute)) throw new Error('Path escapes the document folder.');
    if (absolute.split(path.sep).includes('.crossnote')) {
      throw new Error('Per-folder Crossnote configuration is disabled for untrusted documents.');
    }
    return assertReadablePath(absolute);
  };

  return {
    readFile: async (candidate, encoding = 'utf8') =>
      (await fs.readFile(checked(candidate), encoding)).toString(),
    writeFile: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
    mkdir: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
    exists: async (candidate) => {
      if (path.resolve(candidate).split(path.sep).includes('.crossnote')) return false;
      try {
        await fs.access(checked(candidate));
        return true;
      } catch {
        return false;
      }
    },
    stat: async (candidate) => {
      const stats = await fs.lstat(checked(candidate));
      return {
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        size: stats.size,
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        isSymbolicLink: () => stats.isSymbolicLink(),
      };
    },
    readdir: async (candidate) => fs.readdir(checked(candidate)),
    unlink: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
  };
}

async function getNotebook(
  filePath: string,
  themeId: PreviewThemeId,
): Promise<NotebookInstance> {
  const root = canonicalPath(path.dirname(filePath));
  activeRoot = root;
  const cacheKey = `${root}\0${themeId}`;
  const cached = notebookCaches.get(cacheKey);
  // KaTeX 결과가 이 notebook 안에 캐시된다. 한 번 덥혀 두면 같은 수식을 다시
  // 렌더하지 않으므로, 이 캐시를 버리지 않는 것이 성능의 핵심이다.
  if (cached) return cached;

  const defaults = getDefaultNotebookConfig();
  const notebook = await Notebook.init({
    notebookPath: root,
    fs: createReadOnlyFileSystem(root),
    config: {
      ...defaults,
      markdownParser: 'markdown-it',
      previewTheme: previewThemeFile(themeId),
      codeBlockTheme: 'auto.css',
      mathRenderingOption: 'KaTeX',
      enablePreviewZenMode: true,
      enablePreviewContextMenu: false,
      enableScriptExecution: false,
      enableHTML5Embed: false,
      includeInHeader: '',
      globalCss: '',
      protocolsWhiteList:
        'http://, https://, file://, marktex-resource://, mailto:, tel:',
    },
  });
  notebook.previewScriptsEnabled = false;
  // 순서가 중요하다. 지연 삽입이 안쪽(원래 KaTeX renderer)을 감싸고,
  // source anchor가 그 바깥을 감싸야 자리표시자에 행·열이 붙는다.
  installDeferredMath(notebook.md as unknown as MarkdownItLike);
  installSourceAnchors(notebook.md as unknown as MarkdownItLike);
  notebookCaches.set(cacheKey, notebook);
  return notebook;
}

/**
 * 수식을 cheerio 뒤로 미룬다.
 *
 * crossnote의 `parseMD`는 조판된 HTML을 통째로 `cheerio.load`로 DOM에 올린
 * 뒤 enhancer 일곱 개를 돌린다. 수식 문서에서 그 HTML은 1.3MB이고 **91%가
 * KaTeX 마크업**인데, enhancer 중 어느 것도 그걸 쳐다보지 않는다. 측정으로
 * cheerio 왕복만 90ms였다.
 *
 * 그래서 markdown-it 단계에서는 빈 자리표시자만 남기고, crossnote가 다 지나간
 * 뒤에 KaTeX HTML을 되돌려 넣는다. KaTeX 출력 자체는 손대지 않으므로 결과는
 * 같고, cheerio가 다루는 문서만 10배 작아진다.
 */
const MATH_PLACEHOLDER = /<span\b[^>]*\bdata-marktex-math="(\d+)"[^>]*><\/span>/g;
/**
 * template 안에서 본문은 `data-html` 속성에 엔티티 인코딩되어 들어간다.
 * 그쪽은 인코딩된 자리표시자를 인코딩된 KaTeX로 바꿔야 한다.
 */
const ENCODED_MATH_PLACEHOLDER =
  /&lt;span data-marktex-math=&quot;(\d+)&quot;&gt;&lt;\/span&gt;/g;
let deferredMath: string[] = [];

/** `previewFragmentFromTemplate`의 디코딩과 짝이 되는 인코딩. */
function encodeForTemplateAttribute(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function installDeferredMath(md: MarkdownItLike) {
  const marked = md as MarkdownItLike & { __marktexDeferredMath?: boolean };
  if (marked.__marktexDeferredMath) return;
  marked.__marktexDeferredMath = true;
  const rules = (md as unknown as { renderer: { rules: Record<string, unknown> } }).renderer.rules;
  const original = rules.math as ((...args: unknown[]) => string) | undefined;
  if (!original) return;
  rules.math = (...args: unknown[]) => {
    const slot = deferredMath.push(original(...args)) - 1;
    return `<span data-marktex-math="${slot}"></span>`;
  };
}

function restoreDeferredMath(html: string): string {
  if (deferredMath.length === 0) return html;
  return html.replace(MATH_PLACEHOLDER, (whole, slot: string) =>
    deferredMath[Number(slot)] ?? whole,
  );
}

function restoreDeferredMathInTemplate(template: string): string {
  if (deferredMath.length === 0) return template;
  const encoded: string[] = [];
  return template.replace(ENCODED_MATH_PLACEHOLDER, (whole, slot: string) => {
    const index = Number(slot);
    const source = deferredMath[index];
    if (source === undefined) return whole;
    encoded[index] ??= encodeForTemplateAttribute(source);
    return encoded[index];
  });
}

/**
 * 첫 로드 페이지에서 본문이 두 번 파싱되는 구조를 없앤다.
 *
 * crossnote의 template은 조판된 본문을 `<body data-html="...">`에 엔티티
 * 인코딩해 싣고, 브라우저의 preview runtime이 그것을 다시 sanitize한 뒤
 * `innerHTML`로 심는다. 같은 본문을 속성으로 한 번, 마크업으로 또 한 번
 * 파싱하는 것이다. 수식 문서에서 그 속성만 2.1MB였다.
 *
 * 대신 본문을 `<head>`의 `<template>`에 진짜 마크업으로 싣는다. 파서는
 * 문서를 읽으면서 이것을 fragment로 한 번만 만들고, bridge는 그 node를
 * 자리만 옮긴다. 다시 파싱하지도, 문자열로 되돌리지도 않는다.
 */
function inlineInitialHtml(template: string, html: string): string {
  const bodyTag = /<body\b[^>]*>/i.exec(template);
  if (!bodyTag) return restoreDeferredMathInTemplate(template);
  const attributeAt = bodyTag[0].search(/\sdata-html="/i);
  if (attributeAt < 0) return restoreDeferredMathInTemplate(template);
  const start = bodyTag.index + attributeAt;
  // `escape(html)`을 거친 값이라 속성 안에 따옴표가 남아 있지 않다.
  const valueAt = template.indexOf('"', start);
  const end = template.indexOf('"', valueAt + 1);
  if (valueAt < 0 || end < 0) return restoreDeferredMathInTemplate(template);

  const withoutBody = template.slice(0, start) + template.slice(end + 1);
  const headEnd = withoutBody.search(/<\/head>/i);
  if (headEnd < 0) return restoreDeferredMathInTemplate(template);
  const carrier = `<template id="${INITIAL_HTML_TEMPLATE_ID}">${html}</template>`;
  return withoutBody.slice(0, headEnd) + carrier + withoutBody.slice(headEnd);
}

let bridgeSourceCache: string | null = null;

function bridgeSource(): string {
  if (bridgeSourceCache === null) {
    const bundle = readFileSync(path.join(__dirname, 'preview-bridge.js'), 'utf8');
    bridgeSourceCache = bundle.replace(/<\/script/gi, '<\\/script');
  }
  return bridgeSourceCache;
}

function previewBridgeScript(
  totalLines: number,
  documentIsBlank: boolean,
  revision: number,
  themeId: PreviewThemeId,
): string {
  const config = JSON.stringify({
    totalLineCount: totalLines,
    documentIsBlank,
    revision,
    themeId,
  });
  return `<script>window.__marktexPreview = ${config};</script>
<script>${bridgeSource()}</script>`;
}

function previewFragmentFromTemplate(template: string): string {
  const encoded = template.match(/<body\b[^>]*\bdata-html="([^"]*)"/i)?.[1] ?? '';
  return encoded
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function previewStyles(themeId: PreviewThemeId): string {
  return `<style>
      /* theme stylesheet가 적용되기 전 첫 frame이 흰색으로 칠해지지 않게
         한다. 새 문서를 열 때 보이던 흰 섬광의 원인이다. bridge가 theme을
         바꿀 때 이 값을 함께 갱신한다. */
      html, body { background: ${previewThemeBackground(themeId)}; }
      [data-source-line] { cursor: text; }
      /* crossnote의 로딩 overlay.
         crossnote는 자기 \`updateHtml\` 경로가 끝나야 이 overlay를 걷는데,
         본문 설치는 이 앱이 직접 한다. 그래서 그 상태는 영원히 풀리지 않고,
         5초 뒤에는 "Something is wrong."까지 띄운다. 조판 중임을 알리는
         화면은 host가 이미 그리므로 여기서는 감춘다. */
      .markdown-preview.z-50 { display: none !important; }
      .topbar, footer, .footer { display: none !important; }
      html, body { max-width: 100%; overflow-x: hidden !important; }
      /* Preview 자체는 문서 전체를 칠하고, 폭이 긴 콘텐츠만 지역적으로 스크롤한다. */
      .markdown-preview {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 100vh !important;
        padding-bottom: 5rem !important;
        overflow-x: hidden !important;
        overflow-y: visible !important;
      }
      .markdown-preview pre,
      .markdown-preview .katex-display,
      .markdown-preview .MathJax_Display,
      .markdown-preview .crossnote-html-source {
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
      }
      .markdown-preview table {
        display: block;
        max-width: 100%;
        overflow-x: auto;
      }
      .markdown-preview img,
      .markdown-preview video,
      .markdown-preview svg { max-width: 100%; height: auto; }
      .markdown-preview p,
      .markdown-preview li,
      .markdown-preview blockquote { overflow-wrap: break-word; }
      /* 수식이 나르는 source wrapper는 조판을 바꾸지 않는다. */
      .crossnote-math-source, .crossnote-html-source { display: block; }
      .crossnote-inline-math-source { display: inline; }
    </style>`;
}

utility.useExternalAddFileProtocolFunction((filePath: string) =>
  previewFileReference(filePath),
);

async function render(request: Extract<RenderWorkerRequest, { kind: 'render' }>) {
  allowedRoots = Array.isArray(request.roots) ? request.roots.filter(Boolean) : [];
  deferredMath = [];
  const themeId = normalizePreviewTheme(request.themeId);
  const renderPath = request.documentPath;
  const notebook = await getNotebook(renderPath, themeId);
  const engine = notebook.getNoteMarkdownEngine(renderPath);
  const baseHref = resourceUrl(path.join(path.dirname(renderPath), path.sep));
  const config: WebviewConfig = {
    ...notebook.config,
    sourceUri: resourceUrl(renderPath),
    cursorLine: 0,
    scrollSync: true,
    isVSCode: false,
    enablePreviewZenMode: true,
    enablePreviewContextMenu: false,
  };
  const template = await engine.generateHTMLTemplateForPreview({
    inputString: request.text.length > 0 ? request.text : '\n',
    config,
    vscodePreviewPanel: {} as never,
    head: `<base href="${baseHref}">`,
    scripts: previewBridgeScript(
      lineCount(request.text),
      request.text.trim().length === 0,
      request.revision,
      themeId,
    ),
    styles: previewStyles(themeId),
  });
  // crossnote가 다 지나간 뒤에 수식을 되돌려 넣는다.
  const html = restoreDeferredMath(previewFragmentFromTemplate(template));
  const blocks = splitPreviewBlocks(html);
  const previous = installedBlocks.get(request.tabId);
  installedBlocks.set(request.tabId, blocks);

  const common = { totalLineCount: lineCount(request.text), baseHref, themeId };
  if (!request.hasPage) {
    // 첫 로드. 완성된 페이지가 필요하므로 이때만 template을 만들어 보낸다.
    // 본문을 `<template>`으로 실을 수 있으면 그 편이 한 번만 파싱된다.
    // 브라우저에서 그려지는 도해가 든 문서만 예전 경로로 보낸다.
    const page = canInlineInitialHtml(html)
      ? inlineInitialHtml(template, html)
      : restoreDeferredMathInTemplate(template);
    return { ...common, template: page, html };
  }
  if (!previous) {
    // 예비 view를 넘겨받은 경우처럼 페이지는 있으나 기록이 없다.
    return { ...common, html };
  }
  return { ...common, patch: diffPreviewBlocks(previous, blocks) };
}

/**
 * 조판은 한 번에 하나씩 한다. 수식 표가 모듈 수준이라 겹치면 섞인다.
 * crossnote 자체도 재진입을 가정하지 않는다.
 */
let renderQueue: Promise<unknown> = Promise.resolve();

const port = process.parentPort;
port.on('message', (event) => {
  const request = event.data as RenderWorkerRequest;
  if (!request) return;
  if (request.kind === 'forget-notebooks') {
    notebookCaches.clear();
    return;
  }
  if (request.kind === 'forget-tab') {
    installedBlocks.delete(request.tabId);
    return;
  }
  if (request.kind !== 'render') return;
  renderQueue = renderQueue.then(() => render(request)).then((result) => {
    port.postMessage({ kind: 'render', id: request.id, ok: true, ...result });
  }).catch((error: unknown) => {
    port.postMessage({
      kind: 'render',
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
