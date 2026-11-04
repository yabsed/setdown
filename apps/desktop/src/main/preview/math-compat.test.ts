import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Notebook, getDefaultNotebookConfig, type FileSystemApi } from 'crossnote';
import { installMathCompatibility, previewMathDelimiters } from './math-compat';
import { installSourceAnchors, type MarkdownItLike } from './source-anchors';

const fs: FileSystemApi = {
  readFile: async () => { throw Error('no file'); }, writeFile: async () => {}, mkdir: async () => {},
  exists: async () => false, readdir: async () => [], unlink: async () => {},
  stat: async () => ({ mtimeMs: 0, ctimeMs: 0, size: 0,
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }),
};
let notebook: Notebook;
const render = (source: string) => notebook.md.render(source);
const mathCount = (html: string) => (html.match(/class="katex"/g) ?? []).length;
const formulas = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">(.*?)<\/annotation>/gs)].map(match => match[1]);

beforeAll(async () => {
  notebook = await Notebook.init({ notebookPath: '/tmp', fs, config: {
    ...getDefaultNotebookConfig(), ...previewMathDelimiters, mathRenderingOption: 'KaTeX', enableScriptExecution: false,
  } });
  installMathCompatibility(notebook.md as unknown as Parameters<typeof installMathCompatibility>[0]);
  installSourceAnchors(notebook.md as unknown as MarkdownItLike);
});

test.each([
  String.raw`$S_+$`, String.raw`$$S_+$$`, String.raw`\(S_+\)`, String.raw`\[S_+\]`,
  String.raw`\\(S\_+\\)`, String.raw`\\[S\_+\\]`,
])('renders supported delimiters and actual subscripts: %s', source => {
  const html = render(source);
  expect(mathCount(html)).toBe(1);
  expect(html).toContain('<msub>');
  expect(formulas(html)).toEqual(['S_+']);
});

test('preserves literal TeX escapes in ordinary bracket and dollar math', () => {
  const body = String.raw`\text{literal\_name}\quad\{x\}\!\,\%`;
  for (const [open, close] of [['$', '$'], [String.raw`\(`, String.raw`\)`]]) {
    expect(formulas(render(open + body + close))).toEqual([body]);
  }
});

test.each([2, 3, 4])('pasted cases preserve row separators with %i backslashes', count => {
  const body = String.raw`\begin{cases}1 & S\ge t` + '\\'.repeat(count) + String.raw` 0 & S\<t\end{cases}`;
  const html = render(String.raw`\\[ ` + body + String.raw` \\]`);
  expect(mathCount(html)).toBe(1);
  expect(formulas(html)[0]).toContain(String.raw`\\ 0 &amp; S&lt;t`);
});

test('adjacent display formulas and trailing prose survive block parsing', () => {
  for (const [open, close] of previewMathDelimiters.mathBlockDelimiters.slice(1)) {
    const html = render(`${open}a${close}${open}b${close} 끝`);
    expect(formulas(html)).toEqual(['a', 'b']);
    expect(html).toContain('끝');
  }
});

test('multiline bracket math stays together inside quotes and lists', () => {
  for (const source of [String.raw`> \[
> a
> =
> b
> \]`, String.raw`- 항목

  \\[
  S\_+
  =
  S\_-
  \\]`]) {
    const html = render(source);
    expect(mathCount(html)).toBe(1);
    expect(html).not.toContain('<h');
    expect(html).toContain('data-source-lines=');
  }
});

test('code, links, unmatched delimiters and prose escapes remain literal', () => {
  const source = ['`\\\\(S\\_+\\\\)`', '```tex', '\\\\[x\\\\]', '```',
    '    \\[x\\]', '', '[link](https://example.com/a_(b))', '', String.raw`\\(unclosed`, '', String.raw`\*\*literal\*\*`].join('\n');
  const html = render(source);
  expect(mathCount(html)).toBe(0);
  expect(html).toContain('https://example.com/a_(b)');
  expect(html).toContain('**literal**');
});

test('source anchors refer to the untouched escaped input', () => {
  const source = String.raw`앞 \\(S\_+\\) 뒤 \(x\)`;
  const html = render(source);
  expect(html).toContain('data-source-start="1:3"');
  expect(html).toContain(`data-source-end="1:${source.indexOf(' 뒤') + 1}"`);
  expect(html).toContain(`data-source-start="1:${source.indexOf('\\(x') + 1}"`);
});

test('AUROC example renders through the complete Crossnote pipeline', async () => {
  const source = readFileSync('test/fixtures/pasted-auroc.md', 'utf8');
  const result = await notebook.getNoteMarkdownEngine('/tmp/auroc.md').parseMD(source, {
    isForPreview: true, useRelativeFilePath: false, hideFrontMatter: true,
  });
  expect(mathCount(result.html)).toBe(15);
  expect(result.html).not.toContain('ParseError');
  expect(result.html).toContain('이후 문장도 남는다');
  expect(result.html).toContain('<msub>');
  expect(result.html).toContain('<mtable');
});
