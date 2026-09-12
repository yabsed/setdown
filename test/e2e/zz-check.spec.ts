import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'CHECKMARKERZZZ';

test('문서 표시 + Esc 지연', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-ck-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });
  const inPreview = (script: string) => application.evaluate(async ({ BrowserWindow }, source) => {
    const owner = BrowserWindow.getAllWindows().find((c) => c.isVisible())!;
    const view = owner.contentView.children.find((c) =>
      'webContents' in c && c.webContents.getURL().startsWith('marktex-preview://document/')
      && !c.webContents.getURL().includes('warmup-'))!;
    return (view as Electron.WebContentsView).webContents.executeJavaScript(source);
  }, script);
  try {
    const page = await application.firstWindow();
    page.on('pageerror', (error) => console.log('[pageerror]', error.message));
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.waitForTimeout(3000);
    const shown = await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((c) => c.isVisible())!;
      return owner.contentView.children.filter((c) => 'webContents' in c && c.getVisible()).length;
    });
    console.log(`보이는 preview view: ${shown}개`);

    await page.locator('.mode-toggle').click();
    await page.waitForTimeout(700);
    await page.locator('.monaco-editor').click({ position: { x: 120, y: 80 } });
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('PageDown'); await page.waitForTimeout(80); }
    await page.keyboard.press('End');
    await page.keyboard.type(` ${MARKER}`);
    await inPreview(`(() => {
      const root = document.querySelector('.markdown-preview[data-for="preview"]');
      window.__found = null; window.__start = Date.now();
      const check = () => {
        if (window.__found !== null) return;
        if (root.textContent.includes(${JSON.stringify(MARKER)})) {
          window.__found = Date.now() - window.__start; observer.disconnect();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      check(); return true;
    })()`);
    await page.getByRole('textbox', { name: 'Editor content' }).press('Escape');
    await page.waitForTimeout(3500);
    console.log(`RESULT Esc → 최신본: ${await inPreview('window.__found')}ms`);
    console.log('무결성:', JSON.stringify(await inPreview(
      "({katex: document.querySelectorAll('.katex').length, 본문: document.body.innerText.length, 블록: document.querySelector('.markdown-preview[data-for=\"preview\"]').children.length})")));
    const shownAfter = await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((c) => c.isVisible())!;
      return owner.contentView.children.filter((c) => 'webContents' in c && c.getVisible()).length;
    });
    console.log(`Esc 후 보이는 view: ${shownAfter}개`);
  } finally {
    await application.close().catch(() => {});
  }
});
