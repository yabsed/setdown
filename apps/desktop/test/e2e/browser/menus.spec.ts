import { expect, test } from '@playwright/test';

import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu, pageContextMenu } from '../../support/browser/browser-fixture';

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

