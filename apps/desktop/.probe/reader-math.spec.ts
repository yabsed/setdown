import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, captureNativeMenus, chooseNativeMenu } from '../test/support/browser/browser-fixture';

// Exploration only: what a formula article looks like in reader mode and in its exports.
const out = process.env.PROBE_OUT!;
test('reader math probe', async () => {
  test.setTimeout(240_000);
  await mkdir(out, { recursive: true });
  const f = await fixture();
  const note = (label: string, value: unknown) => console.log(`== ${label} ${JSON.stringify(value)}`.slice(0, 2500));
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article-math`);
    await expect(f.page.getByRole('tab', { name: /Formula article/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    await f.page.waitForTimeout(1500);
    note('reader', await reader.evaluate(async element => {
      await document.fonts.ready;
      const carriers = [...element.querySelectorAll('span[data-setdown-math]')];
      const mathml = element.querySelector('.katex .katex-mathml'), svg = element.querySelector('.katex svg');
      return {
        carriers: carriers.map(c => ({ mode: c.getAttribute('data-setdown-math'), katex: !!c.querySelector(':scope > .katex, :scope > .katex-display'), box: [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)] })),
        mathmlStyle: mathml ? [getComputedStyle(mathml).position, getComputedStyle(mathml).width] : null,
        katexFont: element.querySelector('.katex') ? getComputedStyle(element.querySelector('.katex')!).fontFamily : null,
        fonts: [...document.fonts].filter(face => face.family.includes('KaTeX')).map(face => `${face.family} ${face.status}`).filter(name => name.endsWith('loaded')),
        svg: svg ? [Math.round(svg.getBoundingClientRect().width), Math.round(svg.getBoundingClientRect().height)] : null,
        pageMath: [...element.querySelectorAll('math')].filter(m => !m.closest('.katex')).map(m => m.outerHTML.slice(0, 120)),
        text: (element as HTMLElement).innerText.slice(0, 420),
      };
    }));
    await f.page.screenshot({ path: path.join(out, 'reader-math-1.png') });
    await reader.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await f.page.waitForTimeout(400);
    await f.page.screenshot({ path: path.join(out, 'reader-math-2.png') });
    const markdown = path.join(out, 'article.md'), pdf = path.join(out, 'article.pdf');
    await f.app.evaluate(({ dialog }, { markdown, pdf }) => {
      dialog.showSaveDialog = (async (_owner, options) => ({ canceled: false, filePath: options!.defaultPath!.endsWith('.pdf') ? pdf : markdown })) as typeof dialog.showSaveDialog;
    }, { markdown, pdf });
    const paragraph = reader.locator('p').filter({ hasText: 'Formula paragraph 11:' });
    const openReaderMenu = async () => {
      const generation = await f.app.evaluate(() => (globalThis as any).__browserTestMenuGeneration ?? 0);
      await paragraph.click({ button: 'right' });
      await expect.poll(() => f.app.evaluate(() => (globalThis as any).__browserTestMenuGeneration ?? 0)).toBe(generation + 1);
    };
    await openReaderMenu(); await chooseNativeMenu(f.app, ['Export to Markdown…']);
    await expect.poll(() => readFile(markdown, 'utf8').catch(() => '')).toContain('Formula paragraph 11:');
    note('markdown', (await readFile(markdown, 'utf8')).slice(0, 900));
    await openReaderMenu(); await chooseNativeMenu(f.app, ['Export to PDF…']);
    await expect.poll(() => readFile(pdf).then(data => data.subarray(0, 5).toString()).catch(() => ''), { timeout: 30_000 }).toBe('%PDF-');
    await f.page.waitForTimeout(500);
    const bytes = await readFile(pdf);
    note('pdf', { bytes: bytes.length, katexFonts: [...new Set(bytes.toString('latin1').match(/KaTeX_[A-Za-z0-9]+-[A-Za-z]+/g) ?? [])] });
    note('pdf text', execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).slice(0, 900));
    execFileSync('pdftoppm', ['-r', '80', '-png', '-f', '1', '-l', '1', pdf, path.join(out, 'article')]);
    note('errors', f.errors);
  } finally { await f.dispose(); }
});
