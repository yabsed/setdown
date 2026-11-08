import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';
import { findOverlay, findOverlayVisible } from '../../support/browser/browser-fixture';
import { dragTerminal } from '../../support/terminal/terminal-drag';
import { clickLocationAction } from '../../support/browser/location-controls';

test('Markdown find floats over the full scrolled viewport in a narrow zoomed split and preserves IME and focus', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-markdown-find-'));
  const file = path.join(root, 'reading.md'), other = path.join(root, 'other.txt');
  await writeFile(file, '# Reader\n\n' + Array.from({ length: 150 }, (_, i) => `문단 ${i} 검색어: 읽고 있는 위치와 가로 영역을 그대로 유지합니다.\n`).join('\n'));
  await writeFile(other, 'Other editor\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow(), reader = previews(app);
    await expect.poll(reader.hasVisible).toBe(true);
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
    const otherTab = page.getByRole('tab', { name: /other.txt/ });
    await dragTerminal(page, otherTab, page.locator('.group-body'), 'right');
    await page.getByRole('tab', { name: /reading.md/ }).click();
    await app.evaluate(({ Menu }) => { for (let i = 0; i < 3; i++) Menu.getApplicationMenu()!.getMenuItemById('menu-zoom-in')!.click(); });
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 130 });
    // App zoom reports its setting before the native layout IPC has settled.
    await expect.poll(async () => {
      const host = await page.locator('.preview-frames').boundingBox(), native = await reader.visibleBounds();
      return !!host && !!native && Math.abs(native.y - Math.round(host.y * 1.3)) <= 1
        && Math.abs(native.width - Math.round(host.width * 1.3)) <= 1;
    }).toBe(true);
    await reader.evaluate('scrollTo(0, 540); true');
    await expect.poll(() => reader.evaluate('Math.round(scrollY)')).toBe(540);
    const before = await reader.visibleBounds(), url = await reader.visibleUrl();
    await page.keyboard.press('Control+f');
    const panel = await findOverlay(app), input = panel.getByRole('textbox', { name: 'Find in rendered document' });
    await expect(input).toBeFocused(); await expect.poll(() => findOverlayVisible(app)).toBe(true);
    expect(await reader.visibleBounds()).toEqual(before); expect(await reader.visibleUrl()).toBe(url);
    expect(await reader.evaluate('Math.round(scrollY)')).toBe(540);
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.getURL().includes('browser-find-overlay=1'))!.getBounds());
    expect(bounds.x).toBeGreaterThanOrEqual(before!.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(before!.x + before!.width);
    expect(bounds.y).toBeGreaterThanOrEqual(before!.y); expect(bounds.height).toBeLessThan(90);
    expect(await panel.locator('.web-find-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await input.dispatchEvent('compositionstart'); await input.fill('검색어');
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    expect(await findOverlayVisible(app)).toBe(true); await expect(panel.locator('.find-count')).toHaveText('0 / 0');
    await input.dispatchEvent('compositionend', { data: '검색어' }); await expect(panel.locator('.find-count')).toHaveText('1 / 150');
    await input.press('Enter'); await expect(panel.locator('.find-count')).toHaveText('2 / 150');
    await input.press('Shift+Enter'); await expect(panel.locator('.find-count')).toHaveText('1 / 150');
    await input.fill(''); await expect(panel.locator('.find-count')).toHaveText('0 / 0');
    await reader.evaluate('scrollTo(0, 540); true');
    // WebContents screenshots omit native child views. Capture the private Xvfb
    // screen to include the document and floating panel as actually composed.
    const capture = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, isolatedX11) => {
      const owner = BrowserWindow.getAllWindows()[0], display = screen.getPrimaryDisplay();
      const image = isolatedX11 ? (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size }))
        .find(source => source.display_id === String(display.id))!.thumbnail : await owner.capturePage();
      return image.toPNG().toString('base64');
    }, process.env.SETDOWN_ISOLATED_DISPLAY === '1' && !process.env.WAYLAND_DISPLAY);
    expect(capture.length).toBeGreaterThan(1000);
    await writeFile(test.info().outputPath('markdown-floating-find.png'), Buffer.from(capture, 'base64'));
    await input.press('Escape'); await expect.poll(() => findOverlayVisible(app)).toBe(false);
    expect(await reader.visibleBounds()).toEqual(before); expect(await reader.evaluate('Math.round(scrollY)')).toBe(540);
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL().startsWith('marktex-preview:'))).toBe(true);
    await page.keyboard.press('Control+f'); await expect.poll(() => findOverlayVisible(app)).toBe(true);
    await app.evaluate(({ webContents }) => {
      const counters = globalThis as typeof globalThis & { __readerFocusEvents?: number };
      counters.__readerFocusEvents = 0;
      for (const wc of webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('marktex-preview:'))) {
        wc.on('focus', () => { counters.__readerFocusEvents!++; });
      }
    });
    const group = page.locator('.editor-group').filter({ has: page.getByRole('tab', { name: /reading.md/ }) });
    await clickLocationAction(app, page, 'Switch to Editor', group);
    await expect.poll(() => findOverlayVisible(app)).toBe(false);
    await expect(page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' })).toBeFocused();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __readerFocusEvents?: number }).__readerFocusEvents)).toBe(0);
    await page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }).press('Escape');
    await expect.poll(reader.hasVisible).toBe(true);
    await page.keyboard.press('Control+f'); await expect.poll(() => findOverlayVisible(app)).toBe(true);
    await otherTab.click(); await expect.poll(() => findOverlayVisible(app)).toBe(false);
    await expect(page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
