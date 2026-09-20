import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { Notebook, getDefaultNotebookConfig } from 'crossnote';
import { installSourceAnchors, type MarkdownItLike } from './source-anchors';
import { DeferredMath } from './deferred-math';
import { installFastBlockMath, type BlockMathParser, type BlockMathConfig } from './fast-block-math';

const require = createRequire(import.meta.url);
const out = path.resolve(path.dirname(require.resolve('crossnote')), '..');
const version: string = JSON.parse(readFileSync(path.join(out, '..', 'package.json'), 'utf8')).version;
const corpus = [
  'Before.\n\n$$x^2$$\n\nAfter.',
  String.raw`$$
\begin{pmatrix}a&b\\c&d\end{pmatrix}
$$`,
  '> $$\n> x = y\n> $$\n\nTail.',
  '- Item\n\n  $$\n  a + b\n  $$\n\nTail.',
  '$$x\\$$y$$\n\n$$z$$', '$$x\\\n$$', '$$unclosed\ntext',
  'One $x<y$ two $n!$ three.\n\n$$\\frac{a}{b}$$',
  '```text\n$$not math$$\n```\n\n$$x$$',
  '<table><tr><td>$a^2$</td></tr></table>\n\n$$b$$',
  '$$\r\na+b\r\n$$\r\n', '$$$$\n\nAfter.',
  '$$\\unknowncommand{x}$$', '$$\\text{<img src=x onerror=alert(1)>}$$',
];
const decode = (template: string) => (template.match(/<body\b[^>]*\bdata-html="([^"]*)"/i)?.[1] ?? '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function withPair(run: (base: Notebook, next: Notebook, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-block-math-test-'));
  try {
    const make = () => Notebook.init({ notebookPath: root, config: {
      ...getDefaultNotebookConfig(), enableScriptExecution: false, includeInHeader: '', globalCss: '',
    } });
    const base = await make(); const next = await make();
    assert.equal(version, '0.9.35', 'Revalidate the fast path when upgrading Crossnote');
    assert.equal(installFastBlockMath(next.md as unknown as BlockMathParser,
      () => next.config as unknown as BlockMathConfig, version), true);
    await run(base, next, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function defer(notebook: Notebook, blocks: boolean): DeferredMath {
  const deferred = new DeferredMath();
  const md = notebook.md as unknown as MarkdownItLike;
  const allowed = () => notebook.config.mathRenderingOption === 'KaTeX' && !notebook.config.katexConfig?.trust;
  if (blocks) deferred.install(md, allowed);
  else {
    const inline = { renderer: { rules: { math: md.renderer.rules.math } } } as unknown as MarkdownItLike;
    deferred.install(inline, allowed);
    md.renderer.rules.math = inline.renderer.rules.math;
  }
  installSourceAnchors(md);
  return deferred;
}

test('actual Crossnote token streams, maps and rendered output match the original rule', async () => {
  await withPair(async (base, next) => {
    installSourceAnchors(base.md as unknown as MarkdownItLike);
    installSourceAnchors(next.md as unknown as MarkdownItLike);
    for (const text of corpus) {
      assert.deepEqual(next.md.parse(text, {}), base.md.parse(text, {}));
      assert.equal(next.md.render(text), base.md.render(text));
    }
    for (const notebook of [base, next]) notebook.config.mathRenderingOption = 'None';
    assert.equal(next.md.render('$$x$$'), base.md.render('$$x$$'));
    for (const notebook of [base, next]) {
      notebook.config.mathRenderingOption = 'KaTeX';
      notebook.config.mathBlockDelimiters = [['\\[', '\\]'], ['$$', '$$']];
    }
    assert.equal(next.md.render('\\[\nx+y\n\\]'), base.md.render('\\[\nx+y\n\\]'));
  });
}, 30_000);

test('full Crossnote sanitizer/enhancers and encoded-page fallback preserve math and source ranges', async () => {
  await withPair(async (base, next, root) => {
    const baseline = defer(base, false); const optimized = defer(next, true);
    const render = async (notebook: Notebook, math: DeferredMath, text: string) => {
      math.reset();
      const template = await notebook.getNoteMarkdownEngine(path.join(root, 'notes.md')).generateHTMLTemplateForPreview({
        inputString: text, config: { ...notebook.config, sourceUri: `file://${root}/notes.md`, isVSCode: false },
        vscodePreviewPanel: {} as never, head: '', scripts: '', styles: '',
      });
      const html = math.restore(decode(template));
      assert.equal(decode(math.restoreTemplate(template)), html);
      assert.ok(!html.includes('data-marktex-math='), 'No internal placeholder may escape restoration');
      return html;
    };
    for (const text of corpus) assert.equal(await render(next, optimized, text), await render(base, baseline, text));
    // Repeat after an ordinary edit with warm KaTeX caches and many block formulas.
    const long = Array.from({ length: 32 }, (_, i) => `Paragraph ${i}.\n\n$$\\frac{a_${i % 4}}{b}$$\n`).join('\n');
    for (const suffix of ['first', 'edited', 'edited again']) {
      assert.equal(await render(next, optimized, long + suffix), await render(base, baseline, long + suffix));
    }
  });
}, 60_000);
