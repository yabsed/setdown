# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/menus.spec.ts >> Monaco notebook context menus stay above adjacent native browser panes
- Location: test/e2e/browser/menus.spec.ts:8:54

# Error details

```
Error: locator.focus: Error: strict mode violation: locator('.monaco-editor:visible').first().getByRole('textbox') resolved to 2 elements:
    1) <textarea wrap="off" tabindex="0" data-mprt="7" role="textbox" autocorrect="off" autocomplete="off" spellcheck="false" autocapitalize="off" aria-required="false" aria-multiline="true" aria-autocomplete="both" aria-label="Code cell editor" aria-roledescription="editor" class="inputarea monaco-mouse-cursor-text"></textarea> aka getByRole('textbox', { name: 'Code cell editor' })
    2) <input wrap="off" type="text" class="input" placeholder="" autocorrect="off" spellcheck="false" autocapitalize="off" aria-controls="quickInput_list" aria-describedby="quickInput_message" aria-label="Type to narrow down results."/> aka getByRole('textbox', { name: 'Type to narrow down results.' })

Call log:
  - waiting for locator('.monaco-editor:visible').first().getByRole('textbox')

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { writeFile } from 'node:fs/promises';
  3   | import path from 'node:path';
  4   | import { nativeInput } from '../../support/electron/native-input';
  5   | 
  6   | import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu, pageContextMenu } from '../../support/browser/browser-fixture';
  7   | 
  8   | for (const surface of ['text', 'notebook'] as const) test(`Monaco ${surface} context menus stay above adjacent native browser panes`, async () => {
  9   |   const f = await fixture();
  10  |   try {
  11  |     await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
  12  |     const file = path.join(f.root, surface === 'text' ? 'code.py' : 'cells.ipynb');
  13  |     const source = 'answer = 42\nprint(answer)';
  14  |     await writeFile(file, surface === 'text' ? source : JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  15  |       { id: 'code', cell_type: 'code', source, metadata: {}, execution_count: null, outputs: [] },
  16  |     ] }));
  17  |     await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  18  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', surface === 'text' ? 'editor' : 'notebook');
  19  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  20  |     const tab = f.page.getByRole('tab', { name: /Research page/ });
  21  |     await expect(tab).toBeVisible();
  22  |     const data = await f.page.evaluateHandle(() => new DataTransfer());
  23  |     await tab.dispatchEvent('dragstart', { dataTransfer: data });
  24  |     const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
  25  |     const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
  26  |     await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  27  |     await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  28  |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  29  |     const identity = await evaluatePage(f.app, f.origin, 'window.__menuIdentity = crypto.randomUUID(); document.querySelector("#draft").value="Unsaved draft"; window.__menuIdentity');
  30  |     const nativeVisible = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
  31  |       .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin) && view.getVisible()), f.origin);
  32  |     await expect.poll(nativeVisible).toBe(true);
  33  |     const editor = f.page.locator('.monaco-editor:visible').first(), box = (await editor.boundingBox())!;
  34  |     await editor.click({ button: 'right', position: { x: box.width - 25, y: 40 } });
  35  |     const menu = f.page.locator('.monaco-menu-container .monaco-menu');
  36  |     await expect(menu).toBeVisible();
  37  |     await expect.poll(nativeVisible).toBe(false);
  38  |     const frozen = f.page.locator('.group-body[data-browser-frozen="true"]');
  39  |     await expect(frozen).toHaveCount(1);
  40  |     const webBounds = (await frozen.boundingBox())!, menuBounds = (await menu.boundingBox())!;
  41  |     expect(menuBounds.x + menuBounds.width).toBeGreaterThan(webBounds.x + 30);
  42  |     await f.page.screenshot({ path: test.info().outputPath(`monaco-context-menu-${surface}.png`) });
  43  |     // OS input must hit the shell menu in the part previously covered by the
  44  |     // native browser. CDP locator clicks alone would bypass that hit testing.
  45  |     const action = menu.getByRole('menuitem', { name: /Command Palette/ });
  46  |     const actionBounds = (await action.boundingBox())!;
  47  |     const hit = { x: Math.max(webBounds.x + 15, actionBounds.x + actionBounds.width - 15), y: actionBounds.y + actionBounds.height / 2 };
  48  |     expect(hit.x).toBeLessThan(actionBounds.x + actionBounds.width);
  49  |     const nativePoint = await f.app.evaluate(({ BrowserWindow }, point) => {
  50  |       const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
  51  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  52  |     }, hit);
  53  |     await nativeInput({ click: nativePoint });
  54  |     await expect(menu).toBeHidden();
  55  |     await expect(f.page.locator('.quick-input-widget')).toBeVisible();
  56  |     await f.page.keyboard.press('Escape');
  57  |     await expect.poll(nativeVisible).toBe(true);
  58  |     await expect(frozen).toHaveCount(0);
  59  |     expect(await evaluatePage(f.app, f.origin, '({identity:window.__menuIdentity, draft:document.querySelector("#draft").value})')).toEqual({ identity, draft: 'Unsaved draft' });
  60  | 
  61  |     const input = editor.getByRole('textbox');
> 62  |     await input.focus(); await input.press('Shift+F10');
      |                 ^ Error: locator.focus: Error: strict mode violation: locator('.monaco-editor:visible').first().getByRole('textbox') resolved to 2 elements:
  63  |     await expect(menu).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
  64  |     await f.page.keyboard.press('Escape');
  65  |     await expect(menu).toBeHidden(); await expect.poll(nativeVisible).toBe(true);
  66  |     await expect(frozen).toHaveCount(0);
  67  |     await expect(input).toBeFocused();
  68  |     expect(f.errors).toEqual([]);
  69  |   } finally { await f.dispose(); }
  70  | });
  71  | 
  72  | test('browser details: native image copying and link menus preserve pixels, URLs and source ownership', async () => {
  73  |   const f = await fixture();
  74  |   try {
  75  |     await captureNativeMenus(f.app);
  76  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  77  |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  78  |     await evaluatePage(f.app, f.origin, `(() => {
  79  |       const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;
  80  |       const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);
  81  |       const image=new Image();image.id='copy-target';image.src=canvas.toDataURL();image.style='display:block;width:100px;height:50px';
  82  |       document.body.prepend(image);return image.decode();
  83  |     })()`);
  84  |     const id = await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
  85  |     await f.page.evaluate(id => window.marktex.browser.command(id!, 'zoom-in'), id);
  86  |     await f.app.evaluate(({ clipboard }) => clipboard.clear());
  87  |     await pageContextMenu(f.app, f.origin, '#copy-target'); await chooseNativeMenu(f.app, ['Copy Image']);
  88  |     await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
  89  |     await expect.poll(() => f.page.evaluate(async () => {
  90  |       const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
  91  |       if (!item) return null;
  92  |       const bitmap = await createImageBitmap(await item.getType('image/png'));
  93  |       const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  94  |       const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
  95  |       const copied = { width: bitmap.width, height: bitmap.height, pixel: [...context.getImageData(0, 0, 1, 1).data] };
  96  |       bitmap.close(); return copied;
  97  |     })).toEqual({ width: 20, height: 10, pixel: [255, 0, 0, 255] });
  98  |     await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Copy Link Address']);
  99  |     expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${f.origin}/second`);
  100 |     await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Open Link in New Tab']);
  101 |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  102 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  103 |     // Keep a stale native menu through a real navigation: it cannot copy data
  104 |     // or operate on the replacement document.
  105 |     await pageContextMenu(f.app, `${f.origin}/first`, '#copy-target');
  106 |     await f.app.evaluate(async ({ webContents }, origin) => {
  107 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  108 |       await wc.loadURL(`${origin}/second?replacement`);
  109 |     }, f.origin);
  110 |     await f.app.evaluate(({ clipboard }) => clipboard.clear());
  111 |     await chooseNativeMenu(f.app, ['Copy Image']);
  112 |     expect(await f.app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(false);
  113 |     expect(f.errors).toEqual([]);
  114 |   } finally { await f.dispose(); }
  115 | });
  116 | 
  117 | for (const surface of ['markdown', 'web'] as const) test(`Explorer menus cover native ${surface} panels and restore their live state`, async () => {
  118 |   const f = await fixture();
  119 |   try {
  120 |     await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
  121 |     await f.page.reload();
  122 |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  123 |     await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
  124 |     const row = f.page.locator('.explorer-row').filter({ hasText: 'notes.md' });
  125 |     await expect(row).toBeVisible();
  126 |     if (surface === 'web') {
  127 |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  128 |       const tab = f.page.getByRole('tab', { name: /Research page/ });
  129 |       await expect(tab).toBeVisible();
  130 |       await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="Unsaved web input";true');
  131 |       const data = await f.page.evaluateHandle(() => new DataTransfer());
  132 |       await tab.dispatchEvent('dragstart', { dataTransfer: data });
  133 |       const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
  134 |       const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
  135 |       await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  136 |       await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  137 |     }
  138 |     const visible = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  139 |       .filter(view => view.getVisible()).length);
  140 |     const count = surface === 'web' ? 2 : 1;
  141 |     await expect.poll(visible).toBe(count);
  142 |     const identities = () => f.app.evaluate(async ({ BrowserWindow }) => Promise.all(
  143 |       BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).map(async view => {
  144 |         const contents = (view as Electron.WebContentsView).webContents;
  145 |         const identity = await contents.executeJavaScript('window.__explorerMenuIdentity ??= crypto.randomUUID()');
  146 |         return { id: contents.id, url: contents.getURL(), identity };
  147 |       }))).then(rows => rows.sort((a, b) => a.id - b.id));
  148 |     const original = await identities();
  149 |     const frozen = surface === 'web' ? '.group-body[data-browser-frozen="true"]' : '.preview-frames[data-frozen="true"]';
  150 |     const openMenu = async () => {
  151 |       const bounds = (await row.boundingBox())!;
  152 |       await row.click({ button: 'right', position: { x: bounds.width - 20, y: bounds.height / 2 } });
  153 |       const menu = f.page.locator('.project-context-menu');
  154 |       await expect(menu).toBeVisible();
  155 |       await expect.poll(visible).toBe(0);
  156 |       await expect(f.page.locator(frozen)).toHaveCount(1);
  157 |       expect(await f.page.locator(frozen).evaluate(node => getComputedStyle(node).backgroundImage)).not.toBe('none');
  158 |       const menuBounds = (await menu.boundingBox())!;
  159 |       const panelBounds = (await f.page.locator('.group-body').first().boundingBox())!;
  160 |       expect(menuBounds.x + menuBounds.width).toBeGreaterThan(panelBounds.x + 60);
  161 |       return menu;
  162 |     };
```