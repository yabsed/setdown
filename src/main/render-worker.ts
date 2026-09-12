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

export type RenderWorkerRequest =
  | {
    kind: 'render';
    id: number;
    text: string;
    revision: number;
    documentPath: string;
    themeId: string;
    /** 이 렌더가 읽어도 되는 디렉터리. 메인이 매번 실어 보낸다. */
    roots: string[];
  }
  | { kind: 'forget-notebooks' };

export type RenderWorkerReply =
  | {
    kind: 'render';
    id: number;
    ok: true;
    template: string;
    html: string;
    totalLineCount: number;
    baseHref: string;
    themeId: PreviewThemeId;
  }
  | { kind: 'render'; id: number; ok: false; message: string };

type CrossnoteModule = typeof import('crossnote');
type NotebookInstance = Awaited<ReturnType<CrossnoteModule['Notebook']['init']>>;

const notebookCaches = new Map<string, NotebookInstance>();
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
  installSourceAnchors(notebook.md as unknown as MarkdownItLike);
  notebookCaches.set(cacheKey, notebook);
  return notebook;
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
  return {
    template,
    html: previewFragmentFromTemplate(template),
    totalLineCount: lineCount(request.text),
    baseHref,
    themeId,
  };
}

const port = process.parentPort;
port.on('message', (event) => {
  const request = event.data as RenderWorkerRequest;
  if (!request) return;
  if (request.kind === 'forget-notebooks') {
    notebookCaches.clear();
    return;
  }
  if (request.kind !== 'render') return;
  render(request).then((result) => {
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
