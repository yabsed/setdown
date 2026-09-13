/**
 * 렌더가 정보를 잃지 않게 만드는 곳.
 *
 * 추정을 잘 만드는 일과 engine이 가진 정보를 보존하는 일은 다르다. 여기서는
 * 후자만 한다. parser가 이미 아는 source range를 renderer가 끝까지 나르게
 * 해서, 사다리의 아래 단계를 쓸 일 자체를 줄인다.
 *
 * 수식은 추정하기 전에 정보를 잃지 않아야 한다.
 *
 * Crossnote의 block math parser는 이미 `token.map`을 갖고 있지만, 전용
 * renderer가 KaTeX/MathJax HTML만 돌려주기 때문에 일반 source-map plugin의
 * `*_open` 경로를 지나지 않는다. 그래서 `$$…$$`는 렌더된 DOM에서 원문 행을
 * 잃는다. 여기서는 parser가 아는 range를 renderer가 운반하도록 markdown-it
 * instance를 최소한으로 감싼다. (upstream Crossnote에 그대로 보낼 수 있는
 * 모양이다.)
 */

type MarkdownItToken = {
  type: string;
  map: [number, number] | null;
  meta?: Record<string, unknown> | null;
  children?: MarkdownItToken[] | null;
  content: string;
};

type RenderRule = (
  tokens: MarkdownItToken[],
  index: number,
  options: { sourceMap?: boolean },
  env: unknown,
  self: unknown,
) => string;

type InlineRule = (state: { src: string; pos: number; tokens: MarkdownItToken[] }, silent: boolean) => boolean;

export type MarkdownItLike = {
  core: {
    ruler: {
      push(name: string, rule: (state: { src: string; tokens: MarkdownItToken[] }) => void): void;
    };
  };
  inline: { ruler: { at(name: string, rule: InlineRule): void } };
  renderer: { rules: Record<string, RenderRule | undefined> };
};

const BLOCK_LINE = 'marktexBlockLine';
const SOURCE_START = 'marktexSourceStart';
const SOURCE_END = 'marktexSourceEnd';

/** 1-based line/column. `text` 안에서의 상대 위치다. */
export function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const safe = Math.max(0, Math.min(Math.round(Number(offset) || 0), text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < safe; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: safe - lineStart + 1 };
}

/**
 * inline token은 container marker(`> `, 목록 들여쓰기)가 벗겨진 본문만 갖는다.
 * 그 행이 원문 행의 접미사인 한, 벗겨진 길이만큼 열을 되돌릴 수 있다.
 */
export function absoluteColumn(
  sourceLineText: string,
  inlineLineText: string,
  column: number,
): number {
  if (sourceLineText.length >= inlineLineText.length && sourceLineText.endsWith(inlineLineText)) {
    return sourceLineText.length - inlineLineText.length + column;
  }
  return column;
}

/**
 * 행 목록을 두 벌만 기억한다.
 *
 * 아래 core rule은 inline 수식마다 원문 전체(`state.src`)와 그 문단
 * (`token.content`)에서 행을 꺼낸다. 매번 `split('\n')`을 다시 하면 수식
 * 하나당 문서 전체를 훑는 셈이 된다. 수식 766개짜리 문서의 재조판에서 이
 * 함수 하나가 CPU profile의 self time 1위였고, markdown-it 단계 34ms 중
 * 28ms를 썼다.
 *
 * 두 벌이면 충분하다. 번갈아 오는 것이 원문과 문단 둘뿐이다.
 */
let lastText: string | null = null;
let lastLines: string[] = [];
let previousText: string | null = null;
let previousLines: string[] = [];

function lineOf(text: string, line: number): string {
  if (text !== lastText) {
    if (text === previousText) {
      const lines = previousLines;
      previousText = lastText;
      previousLines = lastLines;
      lastText = text;
      lastLines = lines;
    } else {
      previousText = lastText;
      previousLines = lastLines;
      lastText = text;
      lastLines = text.split('\n');
    }
  }
  return lastLines[line - 1] ?? '';
}

/**
 * markdown-it의 내부 규칙 목록에서 이름으로 규칙을 찾는다. 없으면 null이며,
 * 그 경우 inline 수식은 문단 행까지만 정확해진다.
 */
function findInlineRule(md: MarkdownItLike, name: string): InlineRule | null {
  const rules = (md.inline.ruler as unknown as { __rules__?: Array<{ name: string; fn: InlineRule }> })
    .__rules__;
  if (!Array.isArray(rules)) return null;
  const found = rules.find((rule) => rule?.name === name);
  return typeof found?.fn === 'function' ? found.fn : null;
}

/** 닫는 tag가 오지 않는 요소. */
const VOID_HTML_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const HTML_TAG = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;

/**
 * 이 조각 안에서 연 tag를 모두 이 조각 안에서 닫는가.
 *
 * markdown-it은 빈 줄에서 raw HTML을 끊는다. 그래서 아래 문서는 세 개의
 * html_block이 되고, `<details>`는 첫 조각에서 열려 세 번째 조각에서 닫힌다.
 *
 * ```
 * <details>
 * <summary>제목</summary>
 *
 * 본문
 *
 * </details>
 * ```
 *
 * 이런 조각을 `<div>`로 감싸면 `</div>`가 `<details>`를 그 자리에서 닫아,
 * 본문이 `<details>` 밖으로 빠져나가고 접히지 않는 문단이 된다.
 */
export function isSelfContainedHtmlBlock(content: string): boolean {
  const open: string[] = [];
  HTML_TAG.lastIndex = 0;
  for (let match = HTML_TAG.exec(content); match; match = HTML_TAG.exec(content)) {
    const [text, closing, opening, attributes] = match;
    if (text.startsWith('<!--')) continue;
    if (closing) {
      const depth = open.lastIndexOf(closing.toLowerCase());
      // 이 조각 밖에서 연 tag를 닫고 있다.
      if (depth === -1) return false;
      open.length = depth;
      continue;
    }
    const name = opening.toLowerCase();
    if (VOID_HTML_ELEMENTS.has(name) || /\/\s*$/.test(attributes ?? '')) continue;
    open.push(name);
  }
  return open.length === 0;
}

const LEADING_OPEN_TAG = /^\s*<[a-zA-Z][a-zA-Z0-9-]*/;

/**
 * 감쌀 수 없는 조각은 여는 tag에 직접 원문 행을 심는다. DOM 구조를 전혀
 * 건드리지 않으므로 여러 조각에 걸친 element도 온전히 남는다.
 */
export function injectSourceLine(html: string, line: number): string | null {
  const match = LEADING_OPEN_TAG.exec(html);
  if (!match) return null;
  const at = match[0].length;
  if (/\sdata-source-line=/.test(html.slice(0, at + 40))) return null;
  return `${html.slice(0, at)} data-source-line="${line}"${html.slice(at)}`;
}

/**
 * div 안에 넣어도 DOM이 깨지지 않는 raw HTML block인지 본다. `<tr>`이나
 * `<li>`처럼 부모가 정해진 조각은 감싸면 브라우저가 버린다.
 */
export function canWrapHtmlBlock(content: string): boolean {
  const match = /^\s*<([a-zA-Z][a-zA-Z0-9-]*)/.exec(content);
  if (!match) return false;
  const orphans = new Set([
    'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup',
    'li', 'dt', 'dd', 'option', 'optgroup', 'source', 'track', 'param',
    'figcaption', 'legend', 'summary', 'html', 'head', 'body',
  ]);
  return !orphans.has(match[1].toLowerCase());
}

/**
 * `notebook.md`에 source anchor를 심는다. 여러 번 불러도 안전하다.
 */
export function installSourceAnchors(md: MarkdownItLike): void {
  const marked = md as MarkdownItLike & { __marktexSourceAnchors?: boolean };
  if (marked.__marktexSourceAnchors) return;
  marked.__marktexSourceAnchors = true;

  // 1. inline 수식이 원문 안에서 시작하고 끝나는 offset을 token에 남긴다.
  const originalMath = findInlineRule(md, 'math');
  if (originalMath) {
    md.inline.ruler.at('math', (state, silent) => {
      const start = state.pos;
      const before = state.tokens.length;
      const matched = originalMath(state, silent);
      if (matched && !silent && state.tokens.length > before) {
        const token = state.tokens[state.tokens.length - 1];
        if (token && token.type === 'math') {
          token.meta = { ...(token.meta ?? {}), [SOURCE_START]: start, [SOURCE_END]: state.pos };
        }
      }
      return matched;
    });
  }

  // 2. offset을 문서 전체 기준의 행·열로 옮긴다. inline token의 `map`은
  //    container 보정이 끝난 값이므로 그대로 더하면 된다.
  md.core.ruler.push('marktex_math_source', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.map || !token.children) continue;
      const blockLine = token.map[0] + 1;
      for (const child of token.children) {
        if (child.type !== 'math') continue;
        const meta: Record<string, unknown> = { ...(child.meta ?? {}), [BLOCK_LINE]: blockLine };
        const startOffset = child.meta?.[SOURCE_START];
        const endOffset = child.meta?.[SOURCE_END];
        if (typeof startOffset === 'number') {
          const start = offsetToLineColumn(token.content, startOffset);
          const line = blockLine + start.line - 1;
          const column = absoluteColumn(
            lineOf(state.src, line),
            lineOf(token.content, start.line),
            start.column,
          );
          meta[SOURCE_START] = { line, column };
          if (typeof endOffset === 'number') {
            const end = offsetToLineColumn(token.content, endOffset);
            const endLine = blockLine + end.line - 1;
            meta[SOURCE_END] = {
              line: endLine,
              column: absoluteColumn(
                lineOf(state.src, endLine),
                lineOf(token.content, end.line),
                end.column,
              ),
            };
          }
        } else {
          delete meta[SOURCE_START];
          delete meta[SOURCE_END];
        }
        child.meta = meta;
      }
    }
  });

  // 3. block 수식: parser가 아는 range를 wrapper로 운반한다.
  const renderMathBlock = md.renderer.rules.math_block;
  if (renderMathBlock) {
    md.renderer.rules.math_block = (tokens, index, options, env, self) => {
      const html = renderMathBlock(tokens, index, options, env, self);
      const map = tokens[index]?.map;
      if (!options?.sourceMap || !map) return html;
      const start = map[0] + 1;
      const end = Math.max(start, map[1]);
      return (
        `<div class="crossnote-math-source" data-source-line="${start}"` +
        ` data-source-lines="${start}-${end}">${html}</div>`
      );
    };
  }

  // 4. inline 수식: 부모 문단 행, 알 수 있으면 delimiter의 열까지.
  const renderMath = md.renderer.rules.math;
  if (renderMath) {
    md.renderer.rules.math = (tokens, index, options, env, self) => {
      const html = renderMath(tokens, index, options, env, self);
      const meta = tokens[index]?.meta ?? {};
      const blockLine = meta[BLOCK_LINE];
      if (!options?.sourceMap || typeof blockLine !== 'number') return html;
      const start = meta[SOURCE_START] as { line: number; column: number } | undefined;
      const end = meta[SOURCE_END] as { line: number; column: number } | undefined;
      const attributes = start
        ? `data-source-line="${start.line}" data-source-start="${start.line}:${start.column}"` +
          (end ? ` data-source-end="${end.line}:${end.column}"` : '')
        : `data-source-line="${blockLine}"`;
      return `<span class="crossnote-inline-math-source" ${attributes}>${html}</span>`;
    };
  }

  // 5. raw HTML block: markdown-it은 `*_open` token을 만들지 않으므로 일반
  //    source-map plugin이 닿지 않는다. 안에 든 수식이나 표를 눌렀을 때
  //    최소한 그 HTML block의 범위로는 갈 수 있게 한다.
  const renderHtmlBlock = md.renderer.rules.html_block;
  if (renderHtmlBlock) {
    md.renderer.rules.html_block = (tokens, index, options, env, self) => {
      const html = renderHtmlBlock(tokens, index, options, env, self);
      const token = tokens[index];
      const map = token?.map;
      if (!options?.sourceMap || !map) return html;
      const content = token.content ?? '';
      const start = map[0] + 1;
      const end = Math.max(start, map[1]);
      // 조각 하나로 끝나지 않는 HTML은 감싸면 그 자리에서 닫혀 버린다.
      // 그럴 때는 여는 tag에 행 번호만 얹고 구조는 그대로 둔다.
      if (!isSelfContainedHtmlBlock(content)) return injectSourceLine(html, start) ?? html;
      if (!canWrapHtmlBlock(content)) return html;
      return (
        `<div class="crossnote-html-source" data-source-line="${start}"` +
        ` data-source-lines="${start}-${end}">${html}</div>`
      );
    };
  }
}
