import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fixture, evaluatePage } from '../../apps/desktop/test/support/browser/browser-fixture';

// Diagnostic observations, not regression acceptance tests. No personal profile.
test('observe transformed contrast and preview renderer loss', async () => {
  const f = await fixture();
  const observations: Record<string, unknown> = {};
  try {
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/contrast-probe`);
    await expect.poll(() => f.app.context().pages().some(p => p.url() === `${f.origin}/contrast-probe`)).toBe(true);
    await evaluatePage(f.app, f.origin, `
      document.body.innerHTML = '<section id="contrast-light"><p id="muted">Readable secondary text</p></section><section id="contrast-dark">White text on a dark surface</section>';
      const style = document.createElement('style'); style.textContent = '#contrast-light{background:#fff;color:#000;padding:30px} #muted{color:#666} #contrast-dark{background:#171717;color:#fff;padding:30px}'; document.head.append(style); true;
    `);
    const colors = () => evaluatePage(f.app, f.origin, `['#contrast-light','#muted','#contrast-dark'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {selector,foreground:s.color,background:s.backgroundColor}})`);
    observations.original = await colors();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'app' }));
    await expect.poll(async () => (await colors() as any[])[0].background).toBe('rgb(253, 246, 227)');
    observations.solarizedLight = await colors();
    await f.app.context().pages().find(p => p.url() === `${f.origin}/contrast-probe`)!.screenshot({ path: test.info().outputPath('contrast.png') });

    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    const visiblePreview = () => f.app.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && v.getVisible()
        && (v as Electron.WebContentsView).webContents.getURL().startsWith('marktex-preview:')) as Electron.WebContentsView | undefined;
      return child?.webContents.id ?? null;
    });
    await expect.poll(visiblePreview).not.toBeNull();
    const previewId = (await visiblePreview())!;
    observations.before = await f.app.evaluate(async ({ webContents }, id) => ({ id, text: await webContents.fromId(id)!.executeJavaScript('document.body.innerText') }), previewId);
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    observations.crash = await f.app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id)!;
      const gone = new Promise(resolve => contents.once('render-process-gone', (_event, details) => resolve(details)));
      contents.forcefullyCrashRenderer();
      const details = await gone;
      return { id, details, destroyed: contents.isDestroyed(), crashed: contents.isCrashed() };
    }, previewId);
    await editor.press('Escape');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    // Observe automatic recovery for a fixed interval. This is not a latency benchmark.
    await new Promise(resolve => setTimeout(resolve, 3000));
    observations.afterEsc = await f.app.evaluate(({ BrowserWindow, webContents }, id) => {
      const contents = webContents.fromId(id);
      const child = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id);
      return { id, exists: !!contents, destroyed: contents?.isDestroyed(), crashed: contents?.isCrashed(), visible: child?.getVisible(), bounds: child?.getBounds() };
    }, previewId);
    observations.source = await f.page.evaluate(() => window.marktex.getDocument());
    observations.shellErrors = f.errors;
    await f.page.screenshot({ path: test.info().outputPath('after-crash-escape.png') });
  } finally {
    await writeFile(test.info().outputPath('observations.json'), JSON.stringify(observations, null, 2) + '\n');
    await f.dispose();
  }
});

test('observe gray text on a dark surface contrast', async () => {
  const f = await fixture(false);
  const observations: Record<string, unknown> = {};
  try {
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/dark-contrast-probe`);
    await expect.poll(() => f.app.context().pages().some(p => p.url() === `${f.origin}/dark-contrast-probe`)).toBe(true);
    await evaluatePage(f.app, f.origin, `
      document.body.innerHTML = '<section id="light">Light surface <span class="muted">Secondary text</span></section><section id="dark">Dark surface <span class="muted">Secondary text</span></section>';
      const style = document.createElement('style'); style.textContent = '#light{background:#fff;color:#000;padding:30px} #dark{background:#171717;color:#fff;padding:30px} #light .muted{color:#666} #dark .muted{color:#aaa}'; document.head.append(style); true;
    `);
    const colors = () => evaluatePage(f.app, f.origin, `['#light','#light .muted','#dark','#dark .muted'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {selector,foreground:s.color,background:s.backgroundColor}})`);
    observations.original = await colors();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'app' }));
    await expect.poll(async () => (await colors() as any[])[0].background).toBe('rgb(253, 246, 227)');
    await expect.poll(async () => (await colors() as any[])[3].foreground).not.toBe('rgb(170, 170, 170)');
    observations.solarizedLight = await colors();
    await f.app.context().pages().find(p => p.url() === `${f.origin}/dark-contrast-probe`)!.screenshot({ path: test.info().outputPath('contrast.png') });
  } finally {
    await writeFile(test.info().outputPath('observations.json'), JSON.stringify(observations, null, 2) + '\n');
    await f.dispose();
  }
});
