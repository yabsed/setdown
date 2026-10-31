import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeInput } from '../../support/electron/native-input';

import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu, pageContextMenu } from '../../support/browser/browser-fixture';

for (const surface of ['text', 'notebook'] as const) test(`Monaco ${surface} context menus stay above adjacent native browser panes`, async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    const file = path.join(f.root, surface === 'text' ? 'code.py' : 'cells.ipynb');
    const source = 'answer = 42\nprint(answer)';
    await writeFile(file, surface === 'text' ? source : JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
      { id: 'code', cell_type: 'code', source, metadata: {}, execution_count: null, outputs: [] },
    ] }));
    await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', surface === 'text' ? 'editor' : 'notebook');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toBeVisible();
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await tab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
    const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    const identity = await evaluatePage(f.app, f.origin, 'window.__menuIdentity = crypto.randomUUID(); document.querySelector("#draft").value="Unsaved draft"; window.__menuIdentity');
    const nativeVisible = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin) && view.getVisible()), f.origin);
    await expect.poll(nativeVisible).toBe(true);
    const editor = f.page.locator('.monaco-editor:visible').first(), box = (await editor.boundingBox())!;
    await editor.click({ button: 'right', position: { x: box.width - 25, y: 40 } });
    const menu = f.page.locator('.monaco-menu-container .monaco-menu');
    await expect(menu).toBeVisible();
    await expect.poll(nativeVisible).toBe(false);
    const frozen = f.page.locator('.group-body[data-browser-frozen="true"]');
    await expect(frozen).toHaveCount(1);
    const webBounds = (await frozen.boundingBox())!, menuBounds = (await menu.boundingBox())!;
    expect(menuBounds.x + menuBounds.width).toBeGreaterThan(webBounds.x + 30);
    await f.page.screenshot({ path: test.info().outputPath(`monaco-context-menu-${surface}.png`) });
    // OS input must hit the shell menu in the part previously covered by the
    // native browser. CDP locator clicks alone would bypass that hit testing.
    const action = menu.getByRole('menuitem', { name: /Command Palette/ });
    const actionBounds = (await action.boundingBox())!;
    const hit = { x: Math.max(webBounds.x + 15, actionBounds.x + actionBounds.width - 15), y: actionBounds.y + actionBounds.height / 2 };
    expect(hit.x).toBeLessThan(actionBounds.x + actionBounds.width);
    const nativePoint = await f.app.evaluate(({ BrowserWindow }, point) => {
      const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, hit);
    await nativeInput({ click: nativePoint });
    await expect(menu).toBeHidden();
    await expect(f.page.locator('.quick-input-widget')).toBeVisible();
    await f.page.keyboard.press('Escape');
    await expect(f.page.locator('.quick-input-widget')).toBeHidden();
    await expect.poll(nativeVisible).toBe(true);
    await expect(frozen).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, '({identity:window.__menuIdentity, draft:document.querySelector("#draft").value})')).toEqual({ identity, draft: 'Unsaved draft' });

    const input = editor.getByRole('textbox', { name: surface === 'notebook' ? 'Code cell editor' : 'Editor content', exact: true });
    await input.focus(); await input.press('Shift+F10');
    await expect(menu).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
    await f.page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect.poll(nativeVisible).toBe(true);
    await expect(frozen).toHaveCount(0);
    await expect(input).toBeFocused();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

for (const surface of ['text', 'notebook'] as const) test(`Monaco ${surface} hovers use the context-menu cover above adjacent native panes`, async ({}, info) => {
  const f = await fixture(false);
  try {
    const file = path.join(f.root, surface === 'text' ? 'heading.html' : 'heading.ipynb');
    const source = `${'\n'.repeat(8)}${' '.repeat(45)}<h1>Heading</h1>\n`;
    await writeFile(file, surface === 'text' ? source : JSON.stringify({ nbformat: 4, nbformat_minor: 5,
      metadata: { language_info: { name: 'html' } }, cells: [
        { id: 'heading', cell_type: 'code', source, metadata: {}, execution_count: null, outputs: [] },
      ] }));
    await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await tab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = f.page.locator('.group-body'), bounds = (await body.boundingBox())!;
    const point = { dataTransfer: data, clientX: bounds.x + bounds.width - 5, clientY: bounds.y + bounds.height / 2 };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    const identity = await evaluatePage(f.app, f.origin,
      'window.keptDraft = document.querySelector("#draft"); keptDraft.value = "keep native input"; window.keptPage = crypto.randomUUID(); keptPage');
    const nativeVisible = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin) && view.getVisible()), f.origin);
    const frozen = f.page.locator('.group-body[data-browser-frozen="true"]');
    await expect.poll(nativeVisible).toBe(true);
    await f.page.getByRole('tab', { name: /heading\./ }).click();
    const heading = f.page.locator('.view-line span span').filter({ hasText: /^h1$/ }).first();
    const hover = f.page.locator('.monaco-resizable-hover:visible');
    const toScreen = (point: { x: number; y: number }) => f.app.evaluate(({ BrowserWindow }, point) => {
      const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    const headingBox = (await heading.boundingBox())!;
    await nativeInput({ pointer: [await toScreen({ x: headingBox.x + headingBox.width / 2, y: headingBox.y + headingBox.height / 2 })] });
    await expect(hover).toContainText('The h1 element');
    await expect.poll(nativeVisible).toBe(false);
    await expect(frozen).toHaveCount(1);
    const popup = (await hover.boundingBox())!, web = (await frozen.boundingBox())!;
    expect(popup.x + popup.width).toBeGreaterThan(web.x + 30);
    expect(popup.y).toBeGreaterThan(web.y);
    await f.page.screenshot({ path: info.outputPath(`html-hover-above-web-${surface}.png`) });
    // OS input in the overlap proves the native view cannot obscure/intercept
    // the popup. CDP locator clicks alone bypass native hit testing.
    await hover.evaluate(node => node.addEventListener('pointerdown', () => { (window as any).__hoverHit = true; }));
    await nativeInput({ click: await toScreen({ x: popup.x + popup.width - 10, y: popup.y + popup.height / 2 }) });
    await expect.poll(() => f.page.evaluate(() => (window as any).__hoverHit)).toBe(true);
    const link = hover.locator('a').filter({ hasText: 'MDN' });
    await link.evaluate(node => node.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); (window as any).__hoverLinkClicked = true;
    }, { capture: true }));
    const linkBox = (await link.boundingBox())!;
    await nativeInput({ click: await toScreen({ x: linkBox.x + linkBox.width / 2, y: linkBox.y + linkBox.height / 2 }) });
    await expect.poll(() => f.page.evaluate(() => (window as any).__hoverLinkClicked)).toBe(true);
    await nativeInput({ pointer: [await toScreen({ x: 1, y: 1 })] });
    await expect(hover).toBeHidden(); await expect.poll(nativeVisible).toBe(true); await expect(frozen).toHaveCount(0);
    // Reopen and hand off to a context menu. Nested covers must restore once,
    // without leaving the web pane hidden when the last popup closes.
    await nativeInput({ pointer: [await toScreen({ x: headingBox.x + headingBox.width / 2, y: headingBox.y + headingBox.height / 2 })] }); await expect(hover).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
    await heading.click({ button: 'right' });
    const menu = f.page.locator('.monaco-menu-container .monaco-menu');
    await expect(menu).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
    await f.page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect.poll(nativeVisible).toBe(true); await expect(frozen).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, '({ id: keptPage, same: keptDraft === document.querySelector("#draft"), value: keptDraft.value })'))
      .toEqual({ id: identity, same: true, value: 'keep native input' });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: native image copying and link menus preserve pixels, URLs and source ownership', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `(() => {
      const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);
      const image=new Image();image.id='copy-target';image.src=canvas.toDataURL();image.style='display:block;width:100px;height:50px';
      document.body.prepend(image);return image.decode();
    })()`);
    const id = await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
    await f.page.evaluate(id => window.marktex.browser.command(id!, 'zoom-in'), id);
    await f.app.evaluate(({ clipboard }) => clipboard.clear());
    await pageContextMenu(f.app, f.origin, '#copy-target'); await chooseNativeMenu(f.app, ['Copy Image']);
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await expect.poll(() => f.page.evaluate(async () => {
      const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
      if (!item) return null;
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
      const copied = { width: bitmap.width, height: bitmap.height, pixel: [...context.getImageData(0, 0, 1, 1).data] };
      bitmap.close(); return copied;
    })).toEqual({ width: 20, height: 10, pixel: [255, 0, 0, 255] });
    await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Copy Link Address']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${f.origin}/second`);
    await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Open Link in New Tab']);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    // Keep a stale native menu through a real navigation: it cannot copy data
    // or operate on the replacement document.
    await pageContextMenu(f.app, `${f.origin}/first`, '#copy-target');
    await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.loadURL(`${origin}/second?replacement`);
    }, f.origin);
    await f.app.evaluate(({ clipboard }) => clipboard.clear());
    await chooseNativeMenu(f.app, ['Copy Image']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

for (const surface of ['markdown', 'web'] as const) test(`Explorer menus cover native ${surface} panels and restore their live state`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const row = f.page.locator('.explorer-row').filter({ hasText: 'notes.md' });
    await expect(row).toBeVisible();
    if (surface === 'web') {
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      const tab = f.page.getByRole('tab', { name: /Research page/ });
      await expect(tab).toBeVisible();
      await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="Unsaved web input";true');
      const data = await f.page.evaluateHandle(() => new DataTransfer());
      await tab.dispatchEvent('dragstart', { dataTransfer: data });
      const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
      const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
      await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
      await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    }
    const visible = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible()).length);
    const count = surface === 'web' ? 2 : 1;
    await expect.poll(visible).toBe(count);
    const identities = () => f.app.evaluate(async ({ BrowserWindow }) => Promise.all(
      BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).map(async view => {
        const contents = (view as Electron.WebContentsView).webContents;
        const identity = await contents.executeJavaScript('window.__explorerMenuIdentity ??= crypto.randomUUID()');
        return { id: contents.id, url: contents.getURL(), identity };
      }))).then(rows => rows.sort((a, b) => a.id - b.id));
    const original = await identities();
    const frozen = surface === 'web' ? '.group-body[data-browser-frozen="true"]' : '.preview-frames[data-frozen="true"]';
    const openMenu = async () => {
      const bounds = (await row.boundingBox())!;
      await row.click({ button: 'right', position: { x: bounds.width - 20, y: bounds.height / 2 } });
      const menu = f.page.locator('.project-context-menu');
      await expect(menu).toBeVisible();
      await expect.poll(visible).toBe(0);
      await expect(f.page.locator(frozen)).toHaveCount(1);
      expect(await f.page.locator(frozen).evaluate(node => getComputedStyle(node).backgroundImage)).not.toBe('none');
      const menuBounds = (await menu.boundingBox())!;
      const panelBounds = (await f.page.locator('.group-body').first().boundingBox())!;
      expect(menuBounds.x + menuBounds.width).toBeGreaterThan(panelBounds.x + 60);
      return menu;
    };
    const restored = async () => {
      await expect.poll(visible).toBe(count);
      await expect.poll(identities).toEqual(original);
      await expect(f.page.locator(frozen)).toHaveCount(0);
      if (surface === 'web') expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('Unsaved web input');
    };
    await openMenu();
    await f.page.screenshot({ path: `test-results/explorer-context-menu-${surface}.png` });
    await f.page.keyboard.press('Escape');
    await expect(f.page.locator('.project-context-menu')).toHaveCount(0);
    await restored();

    const menu = await openMenu();
    const rename = menu.getByRole('menuitem', { name: /Rename/ }), renameBounds = (await rename.boundingBox())!;
    await rename.click({ position: { x: renameBounds.width - 5, y: renameBounds.height / 2 } });
    await expect(f.page.getByRole('textbox', { name: 'Rename entry' })).toBeFocused();
    await restored();
    await expect(f.page.getByRole('textbox', { name: 'Rename entry' })).toBeFocused();
    await f.page.getByRole('textbox', { name: 'Rename entry' }).press('Escape');

    await openMenu();
    await f.page.getByRole('menuitem', { name: /Move to Trash/ }).click();
    await expect(f.page.getByRole('alertdialog')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await restored();

    await f.page.getByRole('button', { name: 'More Actions', exact: true }).click();
    await expect(f.page.locator('.side-view-menu')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await expect(f.page.locator('.side-view-menu')).toBeHidden();
    await restored();
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await expect(f.page.locator('.side-view-menu')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(f.page.locator('.side-view-menu')).toHaveCount(0);
    await restored();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

