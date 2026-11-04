import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { electron, disposeApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

for (const review of [false, true]) test(`pasted AUROC math in ${review ? 'Git review' : 'ordinary reader'}`, async ({}, info) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auroc-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-auroc-config-'));
  const file = path.join(root, 'auroc.md');
  const source = await readFile(path.resolve('test/fixtures/pasted-auroc.md'), 'utf8');
  await writeFile(file, source);
  if (review) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'setdown@example.test'); git('config', 'user.name', 'Setdown Test');
    git('add', '.'); git('commit', '-m', 'AUROC');
    await writeFile(file, source + '\n추가: \\(x_2\\).\n');
  }
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow();
    const preview = previews(app);
    await expect(page.locator('.viewer-surface')).toBeVisible();
    if (review) {
      await page.evaluate(async root => {
        await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } }).marktex.restoreProjectFolder(root);
      }, root);
      await page.reload();
      await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
      await page.getByRole('button', { name: 'Source Control', exact: true }).click();
      await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).getByRole('button', { name: 'auroc.md', exact: true }).click();
      await page.getByRole('button', { name: 'View Rendered Diff', exact: true }).click();
    }
    const counts = () => app.evaluate(async ({ BrowserWindow }, review) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(view => 'webContents' in view && view.getVisible()) as Electron.WebContentsView[];
      return (await Promise.all(views.map(view => view.webContents.executeJavaScript(`(() => {
        if (!document.querySelector(${JSON.stringify(review ? '.setdown-rendered-diff-split' : '.markdown-preview')})) return null;
        if (${review}) return ['before', 'after'].map(side => document.querySelectorAll('.setdown-rendered-diff-split .setdown-rendered-diff-' + side + ' .katex').length);
        return [document.querySelectorAll('.katex').length];
      })()`)))).filter(value => value !== null).flat().sort((a, b) => a - b);
    }, review);
    await expect.poll(counts).toEqual(review ? [15, 16] : [15]);
    const evidence = await app.evaluate(async ({ BrowserWindow }, review) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(view => 'webContents' in view && view.getVisible()) as Electron.WebContentsView[];
      return Promise.all(views.map(async view => ({
        png: (await view.webContents.capturePage()).toPNG(),
        math: await view.webContents.executeJavaScript(`(() => {
          const root = document.querySelector(${JSON.stringify(review ? '.setdown-rendered-diff-split' : '.markdown-preview')});
          return {
          error: document.body.textContent.includes('ParseError'),
          subscript: root.querySelectorAll('msub').length,
          cases: root.querySelectorAll('mtable').length,
          trailing: document.body.textContent.includes('이후 문장도 남는다'),
          codeMath: document.querySelectorAll('code .katex').length,
          sizes: [...root.querySelectorAll('.katex')].map(node => {
            const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
          })
        }; })()`),
      })));
    }, review);
    for (const [index, result] of evidence.entries()) {
      await writeFile(info.outputPath(`math-${index}.png`), result.png);
      expect(result.math.error).toBe(false);
      expect(result.math.subscript).toBeGreaterThan(5);
      expect(result.math.cases).toBe(review ? 6 : 3);
      expect(result.math.trailing).toBe(true);
      expect(result.math.codeMath).toBe(0);
      for (const size of result.math.sizes) { expect(size.width).toBeGreaterThan(0); expect(size.height).toBeGreaterThan(0); }
    }
    if (!review) {
      // Exercise a real native double click on math, including source mapping.
      await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => 'webContents' in view && view.getVisible()) as Electron.WebContentsView;
        const point = await view.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('.katex').getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        view.webContents.debugger.attach('1.3');
        try {
          for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) {
            await view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount });
          }
        } finally { view.webContents.debugger.detach(); }
      });
      const editor = page.getByRole('textbox', { name: 'Editor content' });
      await expect(editor).toBeEditable();
      await expect(page.locator('.shell')).toHaveAttribute('data-anchor-line', '3');
      expect(await readFile(file, 'utf8')).toBe(source);
      await editor.press('Control+End');
      // Use actual paste on the isolated display. Simulated typing passes
      // through Monaco's bracket auto-closing and creates multiple undo groups.
      const addition = String.raw`추가: \\(x\_2\\).`;
      await app.evaluate(async ({ clipboard }, text) => { await clipboard.writeText(text); }, addition);
      await editor.press('Control+v');
      await expect.poll(() => page.evaluate(async () => (await window.marktex.getDocument())?.text))
        .toBe(source + addition);
      await editor.press('Escape');
      await expect.poll(() => preview.evaluate('document.querySelectorAll(".katex").length')).toBe(16);
      await page.locator('.mode-toggle').click();
      await expect(editor).toBeEditable();
      await editor.press('Control+z');
      await expect.poll(() => page.evaluate(async () => (await window.marktex.getDocument())?.text)).toBe(source);
      await editor.press('Escape');
      await expect.poll(() => preview.evaluate('document.querySelectorAll(".katex").length')).toBe(15);
    }
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
