import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type Application = Awaited<ReturnType<typeof electron.launch>>;
async function reviews(app: Application) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    const data = await Promise.all((owner?.contentView.children ?? []).map(async (view) => {
      if (!('webContents' in view)) return null;
      const contents = view.webContents;
      if (!contents.getURL().startsWith('marktex-preview://document/')) return null;
      const result = await contents.executeJavaScript(`(() => {
        if (!document.querySelector('.setdown-rendered-diff-split')) return null;
        window.__latencyContext ??= Math.random().toString(36);
        return { text: document.body.innerText, context: window.__latencyContext, scroll: scrollY };
      })()`).catch(() => null) as { text: string; context: string; scroll: number } | null;
      return result ? { id: contents.id, url: contents.getURL(), visible: view.getVisible(), ...result } : null;
    }));
    return data.filter((row): row is NonNullable<typeof row> => row !== null);
  });
}

test('review document styles preserve real math geometry across widths and zoom', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = await readFile(path.resolve('test/fixtures/sample.md'), 'utf8');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } })
        .marktex.restoreProjectFolder(folder);
    }, root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    await expect.poll(async () => (await reviews(app!)).length, { timeout: 30_000 }).toBe(2);
    await page.getByRole('button', { name: 'View Rendered Diff', exact: true }).click();
    await expect.poll(async () => (await reviews(app!)).some(v => v.visible)).toBe(true);
    for (const [width, zoom] of [[1100, 1], [680, 1], [1100, 1.25]]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.isVisible())!.setSize(width, 900), width);
      const visible = (await reviews(app)).find(v => v.visible)!;
      const result = await app.evaluate(async ({ webContents }, { id, zoom }) => {
        const contents = webContents.fromId(id)!;
        contents.setZoomFactor(zoom);
        return contents.executeJavaScript(`(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const source = document.querySelector('link[href*="/styles/preview.css"]');
          if (!source) throw Error('Missing document stylesheet');
          const uiUrl = source.href.replace('/styles/preview.css', '/webview/preview.css');
          if (document.querySelector('link[href="' + uiUrl + '"]')) throw Error('UI stylesheet still installed');
          const root = [...document.querySelectorAll('.setdown-rendered-diff-split, .setdown-rendered-diff-unified')]
            .find(el => el.getBoundingClientRect().width > 0);
          const nodes = [...root.querySelectorAll('h1,h2,h3,h4,p,li,pre,table,.katex,.katex-mathml')];
          const snapshot = () => nodes.map(node => {
            const r = node.getBoundingClientRect(), s = getComputedStyle(node);
            return { tag: node.tagName, cls: node.className,
              rect: [r.x + scrollX, r.y + scrollY, r.width, r.height].map(n => Math.round(n * 100) / 100),
              typography: [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.color,s.textAlign],
              display: s.display, visibility: s.visibility };
          });
          await document.fonts.ready;
          const optimized = snapshot();
          const link = document.createElement('link'); link.rel='stylesheet'; link.href=uiUrl;
          // Preserve the original cascade position before styles/preview.css.
          await new Promise((resolve, reject) => { link.onload=resolve; link.onerror=reject; source.before(link); });
          await document.fonts.ready;
          const original = snapshot();
          link.remove(); await document.fonts.ready;
          return { width: innerWidth, representation: root.className, nodes: nodes.length,
            math: root.querySelectorAll('.katex').length,
            differences: original.flatMap((old, i) => JSON.stringify(old) === JSON.stringify(optimized[i]) ? [] : [{old, optimized: optimized[i]}]).slice(0,10) };
        })()`);
      }, { id: visible.id, zoom });
      expect(result.math).toBeGreaterThan(700);
      expect(result.differences, JSON.stringify({ width, zoom, ...result })).toEqual([]);
    }
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
