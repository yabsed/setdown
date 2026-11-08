import { expect, test } from '@playwright/test';
import { fixture } from '../../support/browser/browser-fixture';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeInput } from '../../support/electron/native-input';

test('compact address panels own input above live pages and work for Markdown, files, terminals and web', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 800));
    // A narrow pane can exist even when a platform enforces a larger window minimum.
    await f.page.evaluate(() => { const style = document.createElement('style'); style.textContent = '.editor-group{max-width:var(--test-group-width,300px)}'; document.head.append(style); });
    const open = async () => {
      const search = f.page.getByRole('button', { name: 'Open address and search' });
      await expect(search).toBeVisible();
      await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toBeHidden();
      await expect(search).toHaveText('');
      await expect(search.locator('svg')).toBeVisible();
      await search.scrollIntoViewIfNeeded();
      const box = (await search.boundingBox())!;
      // The inline address is replaced by a small icon, not an input-sized button.
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeLessThanOrEqual(32);
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
      const click = await f.app.evaluate(({ BrowserWindow }, box) => {
        const owner = BrowserWindow.getAllWindows()[0], frame = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
        return { x: frame.x + (box.x + box.width / 2) * zoom, y: frame.y + (box.y + box.height / 2) * zoom };
      }, box);
      await nativeInput({ click });
      await expect.poll(() => f.app.windows().some(p => p.url().includes('location-overlay=1'))).toBe(true);
      const panel = f.app.windows().find(p => p.url().includes('location-overlay=1'))!;
      expect(await panel.evaluate(() => innerWidth)).toBeLessThanOrEqual(280);
      await expect(panel.getByRole('textbox', { name: 'Search or enter an address' })).toBeFocused(); return panel;
    };
    let panel = await open();
    await expect(panel.getByRole('textbox')).toHaveValue(/notes\.md/);
    await expect(panel.getByText('Current address', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Copy current address' })).toHaveCount(0);
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-copy')!.click());
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('notes.md');
    await panel.getByRole('textbox').fill('');
    await f.app.evaluate(({ clipboard, Menu }) => {
      clipboard.writeText('https://example.com/pasted');
      Menu.getApplicationMenu()!.getMenuItemById('menu-paste')!.click();
    });
    await expect(panel.getByRole('textbox')).toHaveValue('https://example.com/pasted');
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-undo')!.click());
    await expect(panel.getByRole('textbox')).toHaveValue('');
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-redo')!.click());
    await expect(panel.getByRole('textbox')).toHaveValue('https://example.com/pasted');
    await f.app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()!.getMenuItemById('menu-select-all')!.click();
      Menu.getApplicationMenu()!.getMenuItemById('menu-copy')!.click();
    });
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/pasted');
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-cut')!.click());
    await expect(panel.getByRole('textbox')).toHaveValue('');
    await panel.getByRole('textbox').press('Escape');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    const file = path.join(f.root, 'plain.txt'); await writeFile(file, 'File contents');
    panel = await open(); await panel.getByRole('textbox').fill(file); await panel.getByRole('textbox').press('Enter');
    await expect(f.page.getByRole('tab', { name: /plain.txt/ })).toBeVisible();
    panel = await open(); await expect(panel.getByRole('textbox')).toHaveValue(/plain\.txt/); await panel.getByRole('textbox').press('Escape');
    await expect(f.page.getByRole('textbox', { name: 'Editor content', exact: true })).toBeFocused();
    await f.page.getByRole('button', { name: 'New terminal', exact: true }).click();
    panel = await open(); await expect(panel.getByRole('textbox')).toHaveValue(/^terminal:\/\//); await panel.getByRole('textbox').press('Escape');
    await expect(f.page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea')).toBeFocused();
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
    const width = async (pixels: number) => f.page.evaluate(pixels => document.documentElement.style.setProperty('--test-group-width', `${pixels}px`), pixels);
    await width(420);
    const bar = f.page.locator('.location-bar');
    await expect(bar.getByRole('button', { name: 'Open address and search' })).toBeVisible();
    const searchBounds = (await bar.getByRole('button', { name: 'Open address and search' }).boundingBox())!;
    const extensionsBounds = (await bar.getByRole('button', { name: 'Extensions menu' }).boundingBox())!;
    expect(extensionsBounds.x - (searchBounds.x + searchBounds.width)).toBeLessThanOrEqual(4);
    await expect(bar.getByRole('button', { name: 'More page actions' })).toHaveCount(0);
    for (const name of ['Extensions menu', 'Site controls', 'Bookmark page', 'Enter reader mode', 'Zoom website out', 'Reset website zoom', 'Zoom website in']) {
      const button = bar.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const bounds = (await button.boundingBox())!, container = (await bar.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(container.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(container.x + container.width);
    }
    await expect(bar.getByRole('button', { name: 'Passwords for this page' })).toHaveCount(0);
    expect(await f.page.evaluate(() => Object.keys(window.marktex.browser).filter(name => /password/i.test(name)))).toEqual([]);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    const library = f.page.getByRole('navigation', { name: 'Browser library' });
    await expect(library.getByRole('button')).toHaveText(['Bookmarks', 'History', 'Downloads', 'Extensions']);
    await f.page.locator('.browser-sidebar').screenshot({ path: test.info().outputPath('browser-sidebar.png') });
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.locator('.location-bar').screenshot({ path: test.info().outputPath('compact-search-button.png') });
    const web = f.app.windows().find(p => p.url() === `${f.origin}/first`)!;
    await web.locator('#draft').fill('Retain web input');
    await web.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
      const context = canvas.getContext('2d')!;
      setInterval(() => { context.fillStyle = '#168648'; context.fillRect(0, 0, 80, 40); }, 50);
      const video = document.createElement('video'); video.muted = true;
      video.srcObject = canvas.captureStream(20); document.body.append(video);
      (window as any).compactFrames = 0;
      const count = () => { (window as any).compactFrames++; video.requestVideoFrameCallback(count); };
      video.requestVideoFrameCallback(count); await video.play();
    });
    panel = await open(); await expect(panel.getByRole('textbox')).toHaveValue(`${f.origin}/first`);
    const input = panel.getByRole('textbox');
    const cdp = await f.app.context().newCDPSession(panel);
    await input.fill('');
    await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
    await expect(input).toHaveValue('한글'); await expect(input).toBeFocused();
    const frame = await web.evaluate(() => (window as any).compactFrames as number);
    await expect.poll(() => web.evaluate(() => (window as any).compactFrames as number)).toBeGreaterThan(frame + 5);
    await panel.screenshot({ path: test.info().outputPath('compact-search.png') });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await cdp.detach();
    await input.fill(''); await input.dispatchEvent('compositionstart'); await input.fill('한글'); await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(input).toHaveValue('한글'); expect(web.url()).toBe(`${f.origin}/first`);
    await input.dispatchEvent('compositionend', { data: '한글' });
    await input.press('Escape'); expect(await web.locator('#draft').inputValue()).toBe('Retain web input');
    await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
    await expect.poll(() => f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).toHaveLength(1);
    await width(900);
    const address = bar.getByRole('textbox', { name: 'Address or file path' });
    await expect(address).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Open address and search' })).toBeHidden();
    await expect(address).toHaveValue(`${f.origin}/first`);
    const originalWidth = (await address.boundingBox())!.width;
    await width(1000);
    await expect.poll(async () => (await address.boundingBox())!.width).toBeGreaterThan(originalWidth + 50);
    await bar.screenshot({ path: test.info().outputPath('expanded-address.png') });
    // A medium pane still has room for an editable address, including at the
    // app zoom used by the compact desktop toolbar.
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.3));
    await width(500);
    await expect(address).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Open address and search' })).toBeHidden();
    await address.focus();
    const inputStyle = await address.evaluate(element => {
      const style = getComputedStyle(element);
      return { height: style.height, border: style.borderTopWidth, color: style.borderTopColor, outline: style.outlineStyle };
    });
    await address.press('Escape');
    await f.page.screenshot({ path: test.info().outputPath('medium-address.png') });
    await width(420);
    panel = await open();
    expect(await panel.getByRole('textbox').evaluate(element => {
      const style = getComputedStyle(element);
      return { height: style.height, border: style.borderTopWidth, color: style.borderTopColor, outline: style.outlineStyle };
    })).toEqual(inputStyle);
    await panel.screenshot({ path: test.info().outputPath('compact-address-matched-height.png') });
    await panel.getByRole('textbox').press('Escape');
    await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${f.origin}/first`);
    await width(500);
    await expect(address).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Open address and search' })).toBeHidden();
    await width(420);
    panel = await open(); await panel.getByRole('textbox').fill(`${f.origin}/second`); await panel.getByRole('textbox').press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
