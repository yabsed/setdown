import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fixture, evaluatePage, closePromptLayer } from '../test/support/browser/browser-fixture';

// A look at the whole window, native pages included, while "Save Changes" is asked above a web
// page that keeps changing. Not a test of record: it writes pictures of the isolated display.
const run = promisify(execFile);
test('look: close prompt above a page that keeps drawing', async () => {
  const out = process.env.LOOK_DIR!; await mkdir(out, { recursive: true });
  const f = await fixture();
  try {
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially(' unsaved');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    // Something that visibly moves: a large counter of drawn frames and a bar that travels.
    await evaluatePage(f.app, f.origin, `(() => {
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:40px;top:120px;font:700 64px monospace;color:#b00020;background:#ffe;padding:12px;z-index:9';
      const bar = document.createElement('div'); bar.style.cssText = 'position:fixed;left:0;top:300px;width:60px;height:60px;background:#1565c0;z-index:9';
      document.body.append(box, bar); let n = 0;
      (function tick() { n++; box.textContent = 'frame ' + n; bar.style.left = (n * 3 % 900) + 'px'; requestAnimationFrame(tick); })();
      return true; })()`);
    await f.page.waitForTimeout(800);
    const shot = (name: string) => run('import', ['-window', 'root', path.join(out, name)]);
    await shot('1-before.png');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.close());
    const layer = await closePromptLayer(f.app);
    await expect(layer.locator('dialog[aria-labelledby="close-prompt-title"]')).toBeVisible();
    await f.page.waitForTimeout(600);
    await shot('2-asked.png');
    console.log('frames at 2:', await evaluatePage(f.app, f.origin, 'document.querySelector("div").textContent'));
    await f.page.waitForTimeout(1500);
    await shot('3-asked-later.png');
    console.log('frames at 3:', await evaluatePage(f.app, f.origin, 'document.querySelector("div").textContent'));
    await layer.keyboard.press('Escape');
    await f.page.waitForTimeout(600);
    await shot('4-cancelled.png');
  } finally { await f.dispose(); }
});
