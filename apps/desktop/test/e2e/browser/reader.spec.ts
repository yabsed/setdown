import { expect, test } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

test('reading surfaces offer native copy/search menus and local Markdown PDF export', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    const menu = async () => f.app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()
        && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith('marktex-preview:')) as Electron.WebContentsView;
      const wc = view.webContents; wc.focus();
      const point = await wc.executeJavaScript(`(() => { const p=document.querySelector('.markdown-preview p'); const range=document.createRange(); range.selectNodeContents(p); const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);const r=p.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
      await new Promise<void>(resolve => {
        wc.once('context-menu', () => resolve());
        wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
      });
    });
    await menu();
    await chooseNativeMenu(f.app, ['Copy']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Keep the reader intact.');
    await menu(); await chooseNativeMenu(f.app, ['Search Google']);
    await expect(f.page.getByRole('tab', { name: /Google/ })).toBeVisible();
    expect(await f.page.getByRole('textbox', { name: 'Address or file path' }).inputValue()).toContain('search?q=Keep%20the%20reader');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    const target = test.info().outputPath('notes.pdf');
    await f.app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog; }, target);
    await menu(); await chooseNativeMenu(f.app, ['Export to PDF…']);
    await expect.poll(() => readFile(target).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('web reader searches the visible article and exports its snapshot as Markdown and PDF', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    const tab = f.page.getByRole('tab', { name: /Long article/ }); await expect(tab).toBeVisible();
    const id = (await tab.getAttribute('data-tab-id'))!;
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    await expect(reader.getByRole('button')).toHaveCount(0);
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/article`)!;
      (globalThis as any).__readerNativeFind = 0;
      const find = wc.findInPage.bind(wc);
      wc.findInPage = (...args) => { (globalThis as any).__readerNativeFind++; return find(...args); };
    }, f.origin);
    await f.page.keyboard.press('Control+f');
    const find = f.page.getByRole('textbox', { name: 'Find in web page' });
    await expect(find).toBeFocused(); await find.fill('Paragraph ');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/40');
    await find.press('Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('2/40');
    await find.press('Shift+Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/40');
    await find.press('Shift+Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('40/40');
    await find.fill('Export to Markdown'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('0/0');
    await find.fill('Paragraph 39');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/1');
    expect(await f.app.evaluate(() => (globalThis as any).__readerNativeFind)).toBe(0);
    expect(await reader.evaluate((element, id) => {
      const highlight = CSS.highlights.get(`reader-${id}-active`)!;
      const range = [...highlight][0] as Range; const rect = range.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      return range.toString() === 'Paragraph 39' && rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    }, id)).toBe(true);
    await find.press('Escape'); await expect(reader).toBeFocused();
    const paragraph = reader.locator('p').filter({ hasText: 'Paragraph 39:' });
    await paragraph.evaluate(p => { const range = document.createRange(); range.selectNodeContents(p); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await paragraph.click({ button: 'right' }); await chooseNativeMenu(f.app, ['Copy']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Paragraph 39:');
    const markdown = test.info().outputPath('article.md'), pdf = test.info().outputPath('article.pdf');
    await f.app.evaluate(({ dialog }, { markdown, pdf }) => {
      dialog.showSaveDialog = (async (_owner, options) => ({ canceled: false, filePath: options!.defaultPath!.endsWith('.pdf') ? pdf : markdown })) as typeof dialog.showSaveDialog;
    }, { markdown, pdf });
    const openReaderMenu = async () => {
      const generation = await f.app.evaluate(() => (globalThis as any).__browserTestMenuGeneration ?? 0);
      await paragraph.click({ button: 'right' });
      await expect.poll(() => f.app.evaluate(() => (globalThis as any).__browserTestMenuGeneration ?? 0)).toBe(generation + 1);
    };
    await openReaderMenu(); await chooseNativeMenu(f.app, ['Export to Markdown…']);
    await expect.poll(() => readFile(markdown, 'utf8').catch(() => '')).toContain('Paragraph 39:');
    const text = await readFile(markdown, 'utf8'); expect(text).toContain('# The Long Article Title'); expect(text).toContain(`${f.origin}/article`);
    expect(text).not.toContain('Copyright noise');
    await openReaderMenu(); await chooseNativeMenu(f.app, ['Export to PDF…']);
    await expect.poll(() => readFile(pdf).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await expect(reader).toBeVisible(); await expect(tab).toHaveAttribute('aria-selected', 'true');
    await rm(pdf);
    await f.page.getByRole('button', { name: 'File', exact: true }).click();
    await expect(f.page.getByRole('menuitem', { name: 'Export as PDF…', exact: true })).toBeEnabled();
    await f.page.getByRole('menuitem', { name: 'Export as PDF…', exact: true }).click();
    await expect.poll(() => readFile(pdf).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await f.page.keyboard.press('Control+f'); await find.fill('Paragraph 39');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/1');
    await paragraph.dblclick(); await expect(reader).toHaveCount(0);
    await expect.poll(() => f.app.evaluate(() => (globalThis as any).__readerNativeFind)).toBeGreaterThan(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Namu reader extracts hashed div layouts, keeps tables and anchors and restores the live paragraph', async () => {
  const f = await fixture();
  try {
    const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
    const svgNoise = `<svg viewBox="0 0 24 24"><text>SVG icon noise</text><path d="M0 0h24v24H0z"/></svg>
      <img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" alt="SVG data icon">
      <img src="/icons/decoration.SVG?cache=1" alt="SVG file icon"><img src="/icons/diagram%2Esvgz" alt="Compressed SVG icon">
      <img src="${raster}" srcset="/icons/responsive.svg 2x" alt="Raster illustration">`;
    const markup = `<!doctype html><title>Fixture wiki - 나무위키</title>
        <style>body{margin:0}h1{height:80px}td{padding:12px}.leaf{margin-bottom:28px}</style><h1>Fixture wiki</h1><nav>Site navigation, edit, history</nav>
        <div class="random-root"><table><tr><th>Name</th><th>Value</th></tr><tr><td>Identity</td><td>Preserved table</td></tr></table>${svgNoise}<div id="toc"><a href="#s-1">1. Overview</a><a href="#s-2">2. More</a></div>
        <div class="hash-A"><div class="empty">&nbsp;</div><div class="hash-B"><h2><a id="s-1" href="#toc">1.</a><span id="Overview">Overview<a href="/edit/Fixture?section=1">[편집]</a></span></h2></div></div>
        ${Array.from({ length: 25 }, (_, i) => `<div class="layout-${i}"><div>&nbsp;</div><div class="leaf">Wiki paragraph ${i}: useful content in a leaf div, containing <a href="/w/Other">a wiki link</a>. Reading preserves paragraphs despite changing obfuscated CSS classes.</div></div>`).join('')}
        <h2><a id="s-2" href="#toc">2.</a>More</h2><details><summary>Folded section</summary><div>Folded wiki content must remain readable.</div></details><p id="fn-1">Footnote preserved.</p></div><aside>Recent changes sidebar noise</aside>`;
    let served = 0;
    const fallback = `<!doctype html><title>Fallback article</title><article><h1>Fallback article</h1>${svgNoise}
      ${Array.from({ length: 25 }, (_, i) => `<p>Fallback paragraph ${i}: an ordinary article without wiki section anchors must still filter SVG icons and retain readable text with its raster image. The normal Readability extraction path remains available for this page.</p>`).join('')}</article>`;
    await f.app.context().route('https://namu.wiki/**', route => {
      served++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().endsWith('/w/Fallback') ? fallback : markup });
    });
    await f.page.evaluate(() => window.marktex.openLink('https://namu.wiki/w/Fixture'));
    await expect(f.page.getByRole('tab', { name: /Fixture wiki/ })).toBeVisible();
    expect(served).toBeGreaterThan(0);
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true }); await expect(reader).toBeVisible();
    await expect(reader.locator('table')).toContainText('Preserved table');
    await expect(reader.locator('p').filter({ hasText: 'Wiki paragraph 20:' })).toBeVisible();
    await expect(reader.locator('a[href="https://namu.wiki/w/Other"]').first()).toBeAttached();
    await expect(reader.locator('details')).toHaveAttribute('open', '');
    await expect(reader.locator('svg')).toHaveCount(0);
    await expect(reader.getByRole('img', { name: /SVG.*icon/ })).toHaveCount(0);
    await expect(reader.getByRole('img', { name: 'Raster illustration' })).toHaveAttribute('src', raster);
    await expect(reader.getByRole('img', { name: 'Raster illustration' })).not.toHaveAttribute('srcset');
    await expect(reader).not.toContainText('SVG icon noise');
    const id = (await f.page.getByRole('tab', { name: /Fixture wiki/ }).getAttribute('data-tab-id'))!;
    const snapshot = await f.page.evaluate(id => window.marktex.browser.readerExtract(id), id);
    expect(snapshot!.article.content).not.toMatch(/<svg\b|data:image\/svg|\.svgz?(?:[?"'\s]|$)/i);
    await expect(reader).not.toContainText('[편집]'); await expect(reader).not.toContainText('Recent changes sidebar noise');
    const paragraph = reader.locator('p').filter({ hasText: 'Wiki paragraph 20:' });
    await paragraph.dblclick(); await expect(reader).toHaveCount(0);
    expect(await evaluatePage(f.app, 'https://namu.wiki/w/Fixture', `(() => { const p=[...document.querySelectorAll('.leaf')].find(p=>p.textContent.startsWith('Wiki paragraph 20:')); const r=p.getBoundingClientRect(); return r.bottom>0 && r.top<innerHeight; })()`)).toBe(true);
    expect(await evaluatePage(f.app, 'https://namu.wiki/w/Fixture', 'document.querySelectorAll("svg").length')).toBe(1);
    await f.page.evaluate(() => window.marktex.openLink('https://namu.wiki/w/Fallback'));
    await expect(f.page.getByRole('tab', { name: /Fallback article/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    await expect(reader).toBeVisible(); await expect(reader).toContainText('Fallback paragraph 24:');
    await expect(reader.locator('svg')).toHaveCount(0); await expect(reader).not.toContainText('SVG icon noise');
    await expect(reader.locator('img')).toHaveCount(1);
    await expect(reader.getByRole('img', { name: 'Raster illustration' })).toHaveAttribute('src', raster);
    await expect(reader.getByRole('img', { name: 'Raster illustration' })).not.toHaveAttribute('srcset');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Esc opens reader mode at the same block and double-click returns to the live page at the clicked block', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
    await expect.poll(() => evaluatePage<boolean>(f.app, f.origin,
      'document.readyState === "complete" && !!document.querySelector("[data-marker=\\"30\\"]")')).toBe(true);
    const before = await evaluatePage<{ marker: number }>(f.app, f.origin, `(() => {
      document.querySelector('#draft').value = 'keep me';
      const el = document.querySelector('[data-marker="18"]');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - innerHeight * 0.372 + 5);
      const golden = innerHeight * 0.372;
      const hit = [...document.querySelectorAll('[data-marker]')].find(p => {
        const rect = p.getBoundingClientRect(); return rect.top <= golden && rect.bottom > golden;
      });
      return { marker: hit ? Number(hit.dataset.marker) : -1 };
    })()`);
    expect(before.marker).toBe(18);
    await f.app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.getVisible()) as import('electron').WebContentsView;
      view.webContents.focus();
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    });
    const reader = f.page.locator('.web-reader');
    await expect(reader).toBeVisible();
    await expect(reader.locator('h1').first()).toContainText('Long article');
    await expect(reader).toContainText('The Long Article Title');
    await expect(reader).not.toContainText('Copyright noise');
    const look = await reader.evaluate(el => {
      const style = getComputedStyle(el);
      return { font: style.fontFamily, size: style.fontSize };
    });
    expect(look.font).toContain('D2Coding');
    expect(look.size).toBe('14px');
    await expect.poll(() => reader.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const golden = rect.top + el.clientHeight * 0.372;
      const hit = [...el.querySelectorAll('[data-setdown-block]')].find(block => {
        const bounds = block.getBoundingClientRect(); return bounds.top <= golden && bounds.bottom > golden;
      });
      return hit ? hit.textContent.trim().slice(0, 40) : '';
    })).toContain('Paragraph 18:');
    const target = reader.locator('[data-setdown-block]', { hasText: 'Paragraph 30:' }).first();
    await target.scrollIntoViewIfNeeded();
    await target.dblclick();
    await expect(reader).toHaveCount(0);
    await expect.poll(() => evaluatePage<{ value: string; ratio: number }>(f.app, f.origin, `(() => {
      const rect = document.querySelector('[data-marker="30"]').getBoundingClientRect();
      return { value: document.querySelector('#draft').value, ratio: rect.top / innerHeight };
    })()`)).toEqual(expect.objectContaining({ value: 'keep me' }));
    const after = await evaluatePage<{ ratio: number }>(f.app, f.origin,
      '({ ratio: document.querySelector("[data-marker=\\"30\\"]").getBoundingClientRect().top / innerHeight })');
    expect(after.ratio).toBeGreaterThan(-0.25);
    expect(after.ratio).toBeLessThan(0.5);
    // The address-bar toggle enters and leaves reader mode as well; leaving
    // via the button returns at the reader's published golden-line place.
    const toggle = f.page.getByRole('button', { name: 'Enter reader mode' });
    await toggle.click();
    await expect(reader).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Exit reader mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(await reader.locator('.web-reader-column').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(900);
    await reader.locator('[data-setdown-block]', { hasText: 'Paragraph 12:' }).first().scrollIntoViewIfNeeded();
    await f.page.waitForTimeout(150);
    const readerMarker = await reader.evaluate(el => {
      const golden = el.getBoundingClientRect().top + el.clientHeight * 0.372;
      let best = -1;
      for (const block of el.querySelectorAll('[data-setdown-block]')) {
        if (block.getBoundingClientRect().top > golden) break;
        best = Number(/Paragraph (\d+):/.exec(block.textContent)?.[1] ?? best);
      }
      return best;
    });
    // Paragraph 12 is on screen; the golden line can sit a few blocks either side of it.
    expect(Math.abs(readerMarker - 12)).toBeLessThanOrEqual(3);
    await f.page.getByRole('button', { name: 'Exit reader mode' }).click();
    await expect(reader).toHaveCount(0);
    // The golden line can fall in a paragraph gap, so land on the last
    // paragraph that started above it.
    const landedAt = () => evaluatePage<number>(f.app, f.origin, `(() => {
      const golden = innerHeight * 0.372;
      let best = -1;
      for (const p of document.querySelectorAll('[data-marker]')) {
        if (p.getBoundingClientRect().top > golden) break;
        best = Number(p.dataset.marker);
      }
      return best;
    })()`);
    // Page and reader typeset paragraphs at different heights, so the
    // golden-line paragraph can shift by a couple of blocks; it must stay
    // the passage the reader was showing, not the old position near 30.
    await expect.poll(async () => Math.abs((await landedAt()) - readerMarker)).toBeLessThanOrEqual(2);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('reader toolbar and wheel share the live website tab zoom while other Markdown tabs stay independent', async () => {
  const f = await fixture();
  try {
    const textReset = f.page.getByRole('button', { name: 'Reset text zoom', exact: true });
    await expect(textReset).toHaveText('100%');
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect(textReset).toHaveText('110%');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    const websiteReset = f.page.getByRole('button', { name: 'Reset website zoom', exact: true });
    await expect(websiteReset).toHaveText('100%');
    await expect(f.page.getByRole('button', { name: 'uBlock Origin', exact: true })).toHaveCount(0);
    const bookmark = f.page.getByRole('button', { name: 'Bookmark page', exact: true });
    const enter = f.page.getByRole('button', { name: 'Enter reader mode', exact: true });
    expect((await bookmark.boundingBox())!.x).toBeLessThan((await enter.boundingBox())!.x);
    expect((await enter.boundingBox())!.x).toBeLessThan((await websiteReset.boundingBox())!.x);
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect(websiteReset).toHaveText('110%');
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect(websiteReset).toHaveText('120%');
    // Shell zoom controls exist before native navigation commits. Wait for
    // the actual form before writing it; keep all zoom/identity assertions.
    await expect.poll(() => f.app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === `${origin}/article`);
      return page ? page.executeJavaScript('!!document.querySelector("#draft")') : false;
    }, f.origin)).toBe(true);
    await evaluatePage(f.app, f.origin, "document.querySelector('#draft').value = 'keep zoom state'");
    await enter.click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    await expect(websiteReset).toHaveCount(0);
    await expect(textReset).toHaveText('120%');
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect(textReset).toHaveText('130%');
    await expect.poll(() => reader.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(18.2, 2);
    await reader.hover();
    await f.page.keyboard.down('Control'); await f.page.mouse.wheel(0, -80); await f.page.keyboard.up('Control');
    await expect(textReset).toHaveText('140%');
    await expect.poll(() => f.page.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 100, text: 100, terminal: 100 });
    await f.page.screenshot({ path: test.info().outputPath('reader-toolbar.png') });
    await f.page.getByRole('button', { name: 'Exit reader mode', exact: true }).click();
    await expect(websiteReset).toHaveText('140%');
    expect(await evaluatePage(f.app, f.origin, "document.querySelector('#draft').value")).toBe('keep zoom state');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect(textReset).toHaveText('110%');
    await textReset.click(); await expect(textReset).toHaveText('100%');
    await f.page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect.poll(() => f.page.locator('.monaco-editor .view-line').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(15.4, 1);
    await f.page.screenshot({ path: test.info().outputPath('markdown-toolbar.png') });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('native Markdown reader shortcuts select the address and go back to the previous file', async () => {
  const f = await fixture();
  const previous = path.join(f.root, 'previous.txt');
  await writeFile(previous, 'Previous file content\n');
  try {
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
    await address.fill(previous); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('previous.txt');
    await address.fill(path.join(f.root, 'notes.md')); await address.press('Enter');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
      .contentView.children.filter(v => v.getVisible()).length)).toBe(1);
    const send = async (keyCode: string, modifier: 'control' | 'alt') => {
      await f.app.evaluate(({ BrowserWindow }, { keyCode, modifier }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.getVisible()) as import('electron').WebContentsView;
        view.webContents.focus();
        view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] });
        view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] });
      }, { keyCode, modifier });
    };
    await send('L', 'control');
    await expect(address).toBeFocused();
    expect(await address.evaluate(input => {
      const value = input as HTMLInputElement;
      return value.selectionStart === 0 && value.selectionEnd === value.value.length;
    })).toBe(true);
    await send('Left', 'alt');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('previous.txt');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('web Reader keeps location controls stationary and the compact extension strip available', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
    const positions = () => f.page.locator('.location-bar').evaluate(bar => [...bar.querySelectorAll('.location-icon, .extensions-button, .page-zoom, input')].map(node => {
      const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const before = await positions();
    const button = f.page.getByRole('button', { name: 'Extensions menu', exact: true });
    const address = (await f.page.getByRole('textbox', { name: 'Address or file path' }).boundingBox())!;
    const site = (await f.page.getByRole('button', { name: 'Site controls', exact: true }).boundingBox())!;
    const extension = (await button.boundingBox())!;
    expect(extension.x).toBeGreaterThanOrEqual(address.x + address.width);
    expect(extension.x + extension.width).toBeLessThanOrEqual(site.x);
    expect(await button.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await f.page.getByRole('button', { name: 'Enter reader mode', exact: true }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    expect(await positions()).toEqual(before);
    await button.click();
    await expect.poll(() => f.app.windows().some(page => page.url().endsWith('/extension-panel.html'))).toBe(true);
    const panel = f.app.windows().find(page => page.url().endsWith('/extension-panel.html'))!;
    await expect(panel.getByRole('toolbar', { name: 'Extensions' })).toBeVisible();
    await expect(panel.locator('header, .label')).toHaveCount(0);
    expect(await panel.locator('html').evaluate(node => getComputedStyle(node).backgroundColor))
      .toBe(await f.page.locator('.location-bar').evaluate(node => getComputedStyle(node).backgroundColor));
    await expect.poll(() => f.app.evaluate(({ BrowserWindow, WebContentsView, webContents }) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const view = owner.contentView.children.find(view => view instanceof WebContentsView && view.webContents.getURL().endsWith('/extension-panel.html')) as Electron.WebContentsView | undefined;
      return { visible: view?.getVisible(), focused: webContents.getFocusedWebContents() === view?.webContents };
    })).toEqual({ visible: true, focused: true });
    await nativeInput({ keys: ['Escape'] });
    await expect.poll(() => f.app.windows().some(page => page.url().endsWith('/extension-panel.html'))).toBe(false);
    await expect(reader).toBeVisible();
    const state = await f.app.evaluate(({ BrowserWindow, WebContentsView, webContents }, origin) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const page = owner.contentView.children.find(view => view instanceof WebContentsView && view.webContents.getURL() === `${origin}/article`);
      return { hidden: !page || !page.getVisible(), shellFocused: webContents.getFocusedWebContents() === owner.webContents };
    }, f.origin);
    expect(state).toEqual({ hidden: true, shellFocused: true });
    await f.page.getByRole('button', { name: 'Exit reader mode', exact: true }).click();
    await expect(reader).toHaveCount(0);
    expect(await positions()).toEqual(before);
    for (const theme of ['paper', 'night']) {
      await f.page.evaluate(theme => window.marktex.executeApplicationMenuItem(`preview-theme-${theme}`), theme);
      await expect.poll(() => f.page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      await button.click();
      await expect.poll(() => f.app.windows().some(page => page.url().endsWith('/extension-panel.html'))).toBe(true);
      const themed = f.app.windows().find(page => page.url().endsWith('/extension-panel.html'))!;
      await expect(themed.getByRole('toolbar', { name: 'Extensions' })).toBeVisible();
      expect(await themed.locator('html').evaluate(node => getComputedStyle(node).backgroundColor))
        .toBe(await f.page.locator('.location-bar').evaluate(node => getComputedStyle(node).backgroundColor));
      await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL().endsWith('/extension-panel.html'))).toBe(true);
      await nativeInput({ keys: ['Escape'] });
      await expect.poll(() => f.app.windows().some(page => page.url().endsWith('/extension-panel.html'))).toBe(false);
    }
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
