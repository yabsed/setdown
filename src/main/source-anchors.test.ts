import { beforeAll, describe, expect, test } from 'vitest';
import { Notebook, getDefaultNotebookConfig } from 'crossnote';
import type { FileSystemApi } from 'crossnote';
import {
  absoluteColumn,
  canWrapHtmlBlock,
  injectSourceLine,
  installSourceAnchors,
  isSelfContainedHtmlBlock,
  offsetToLineColumn,
  type MarkdownItLike,
} from './source-anchors';

describe('순수 계산', () => {
  test('offset을 1-based 행·열로 옮긴다', () => {
    expect(offsetToLineColumn('abc\ndef', 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn('abc\ndef', 5)).toEqual({ line: 2, column: 2 });
    expect(offsetToLineColumn('abc\ndef', 999)).toEqual({ line: 2, column: 4 });
    expect(offsetToLineColumn('abc', Number.NaN)).toEqual({ line: 1, column: 1 });
  });

  test('조각 하나로 닫히는 HTML만 self-contained다', () => {
    expect(isSelfContainedHtmlBlock('<table><tr><td>a</td></tr></table>')).toBe(true);
    expect(isSelfContainedHtmlBlock('<img src="a.png">')).toBe(true);
    expect(isSelfContainedHtmlBlock('<br/>')).toBe(true);
    expect(isSelfContainedHtmlBlock('<!-- <div> -->')).toBe(true);
    expect(isSelfContainedHtmlBlock('<details>\n<summary>x</summary>')).toBe(false);
    expect(isSelfContainedHtmlBlock('</details>')).toBe(false);
    expect(isSelfContainedHtmlBlock('<div a="<b>">x</div>')).toBe(true);
  });

  test('여는 tag에 행 번호를 심는다', () => {
    expect(injectSourceLine('<details>\n<summary>x</summary>', 5))
      .toBe('<details data-source-line="5">\n<summary>x</summary>');
    expect(injectSourceLine('<details open>', 5)).toBe('<details data-source-line="5" open>');
    expect(injectSourceLine('</details>', 5)).toBeNull();
    expect(injectSourceLine('<p data-source-line="2">x</p>', 5)).toBeNull();
  });

  test('container marker가 벗겨진 만큼 열을 되돌린다', () => {
    expect(absoluteColumn('> 인용 $x$', '인용 $x$', 4)).toBe(6);
    expect(absoluteColumn('전혀 다른 줄', '인용', 4)).toBe(4);
  });

  test('부모가 정해진 조각은 감싸지 않는다', () => {
    expect(canWrapHtmlBlock('<table>\n<tr><td>a</td></tr>\n</table>')).toBe(true);
    expect(canWrapHtmlBlock('<tr><td>a</td></tr>')).toBe(false);
    expect(canWrapHtmlBlock('<li>a</li>')).toBe(false);
    expect(canWrapHtmlBlock('  not html')).toBe(false);
  });
});

const readOnlyFs: FileSystemApi = {
  readFile: async () => {
    throw new Error('no file');
  },
  writeFile: async () => {},
  mkdir: async () => {},
  exists: async () => false,
  stat: async () => ({
    mtimeMs: 0,
    ctimeMs: 0,
    size: 0,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  }),
  readdir: async () => [],
  unlink: async () => {},
};

/**
 * 수식 fixture는 KaTeX와 MathJax 양쪽에서 같은 표를 돈다. 조판 결과가 아니라
 * source range가 살아남는지만 본다.
 */
describe.each(['KaTeX', 'MathJax'] as const)('%s 수식의 source range', (mathRenderingOption) => {
  let render: (markdown: string) => string;

  beforeAll(async () => {
    const notebook = await Notebook.init({
      notebookPath: '/tmp',
      fs: readOnlyFs,
      config: { ...getDefaultNotebookConfig(), mathRenderingOption },
    });
    installSourceAnchors(notebook.md as unknown as MarkdownItLike);
    render = (markdown: string) => notebook.md.render(markdown);
  });

  test('독립 수식은 opening delimiter 행과 block 범위를 나른다', () => {
    const html = render('# 위\n\n문장\n\n$$\nE=mc^2\n$$\n\n아래\n');
    expect(html).toContain('data-source-line="5" data-source-lines="5-7"');
  });

  test('blockquote 안의 수식은 container 보정된 행을 쓴다', () => {
    const html = render('> 인용\n>\n> $$\n> a+b\n> $$\n');
    expect(html).toContain('data-source-line="3" data-source-lines="3-5"');
  });

  test('목록 안의 수식도 실제 원문 행을 가리킨다', () => {
    const html = render('- 항목\n\n  $$\n  c^2\n  $$\n');
    expect(html).toContain('data-source-line="3" data-source-lines="3-5"');
  });

  test('여러 행짜리 문단의 인라인 수식은 delimiter 열까지 안다', () => {
    const html = render('첫 줄\n둘째 줄에 $z_1$ 있고\n셋째 줄에 $z_2$ 있다\n');
    expect(html).toContain('data-source-start="2:7"');
    expect(html).toContain('data-source-start="3:7"');
  });

  test('raw HTML block은 최소한 자기 범위를 남긴다', () => {
    const html = render('<table>\n<tr><td>$y^2$</td></tr>\n</table>\n');
    expect(html).toContain('class="crossnote-html-source" data-source-line="1"');
  });

  test('빈 줄로 끊긴 details는 본문을 품은 채로 남는다', () => {
    const html = render('<details>\n<summary>제목</summary>\n\n본문 문단\n\n</details>\n');
    // div로 감싸면 </div>가 <details>를 닫아 본문이 밖으로 빠져나간다.
    expect(html).not.toContain('crossnote-html-source');
    expect(html).toContain('<details data-source-line="1">');
    const opened = html.indexOf('<details');
    const closed = html.indexOf('</details>');
    expect(closed).toBeGreaterThan(opened);
    expect(html.slice(opened, closed)).toContain('본문 문단');
  });

  test('code fence 안의 달러는 수식이 아니다', () => {
    const html = render('```\n$$\nnot math\n$$\n```\n');
    expect(html).not.toContain('crossnote-math-source');
  });
});
