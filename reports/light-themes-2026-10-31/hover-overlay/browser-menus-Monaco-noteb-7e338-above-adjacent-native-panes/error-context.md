# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/menus.spec.ts >> Monaco notebook hovers use the context-menu cover above adjacent native panes
- Location: test/e2e/browser/menus.spec.ts:73:54

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
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
  57  |     await expect(f.page.locator('.quick-input-widget')).toBeHidden();
  58  |     await expect.poll(nativeVisible).toBe(true);
  59  |     await expect(frozen).toHaveCount(0);
  60  |     expect(await evaluatePage(f.app, f.origin, '({identity:window.__menuIdentity, draft:document.querySelector("#draft").value})')).toEqual({ identity, draft: 'Unsaved draft' });
  61  |
  62  |     const input = editor.getByRole('textbox', { name: surface === 'notebook' ? 'Code cell editor' : 'Editor content', exact: true });
  63  |     await input.focus(); await input.press('Shift+F10');
  64  |     await expect(menu).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
  65  |     await f.page.keyboard.press('Escape');
  66  |     await expect(menu).toBeHidden(); await expect.poll(nativeVisible).toBe(true);
  67  |     await expect(frozen).toHaveCount(0);
  68  |     await expect(input).toBeFocused();
  69  |     expect(f.errors).toEqual([]);
  70  |   } finally { await f.dispose(); }
  71  | });
  72  |
  73  | for (const surface of ['text', 'notebook'] as const) test(`Monaco ${surface} hovers use the context-menu cover above adjacent native panes`, async ({}, info) => {
  74  |   const f = await fixture(false);
  75  |   try {
  76  |     const file = path.join(f.root, surface === 'text' ? 'heading.html' : 'heading.ipynb');
  77  |     const source = `${'\n'.repeat(8)}${' '.repeat(45)}<h1>Heading</h1>\n`;
  78  |     await writeFile(file, surface === 'text' ? source : JSON.stringify({ nbformat: 4, nbformat_minor: 5,
  79  |       metadata: { language_info: { name: 'html' } }, cells: [
  80  |         { id: 'heading', cell_type: 'code', source, metadata: {}, execution_count: null, outputs: [] },
  81  |       ] }));
  82  |     await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  83  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  84  |     const tab = f.page.getByRole('tab', { name: /Research page/ });
  85  |     const data = await f.page.evaluateHandle(() => new DataTransfer());
  86  |     await tab.dispatchEvent('dragstart', { dataTransfer: data });
  87  |     const body = f.page.locator('.group-body'), bounds = (await body.boundingBox())!;
  88  |     const point = { dataTransfer: data, clientX: bounds.x + bounds.width - 5, clientY: bounds.y + bounds.height / 2 };
  89  |     await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  90  |     await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  91  |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  92  |     const identity = await evaluatePage(f.app, f.origin,
  93  |       'window.keptDraft = document.querySelector("#draft"); keptDraft.value = "keep native input"; window.keptPage = crypto.randomUUID(); keptPage');
  94  |     const nativeVisible = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
  95  |       .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin) && view.getVisible()), f.origin);
  96  |     const frozen = f.page.locator('.group-body[data-browser-frozen="true"]');
  97  |     await expect.poll(nativeVisible).toBe(true);
  98  |     await f.page.getByRole('tab', { name: /heading\./ }).click();
  99  |     const heading = f.page.locator('.view-line span span').filter({ hasText: /^h1$/ }).first();
  100 |     const hover = f.page.locator('.monaco-resizable-hover:visible');
  101 |     const toScreen = (point: { x: number; y: number }) => f.app.evaluate(({ BrowserWindow }, point) => {
  102 |       const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
  103 |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  104 |     }, point);
  105 |     await heading.hover();
  106 |     await expect(hover).toContainText('The h1 element');
> 107 |     await expect.poll(nativeVisible).toBe(false);
      |                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  108 |     await expect(frozen).toHaveCount(1);
  109 |     const popup = (await hover.boundingBox())!, web = (await frozen.boundingBox())!;
  110 |     expect(popup.x + popup.width).toBeGreaterThan(web.x + 30);
  111 |     expect(popup.y).toBeGreaterThan(web.y);
  112 |     await f.page.screenshot({ path: info.outputPath(`html-hover-above-web-${surface}.png`) });
  113 |     // OS input in the overlap proves the native view cannot obscure/intercept
  114 |     // the popup. CDP locator clicks alone bypass native hit testing.
  115 |     await hover.evaluate(node => node.addEventListener('pointerdown', () => { (window as any).__hoverHit = true; }));
  116 |     await nativeInput({ click: await toScreen({ x: popup.x + popup.width - 10, y: popup.y + popup.height / 2 }) });
  117 |     await expect.poll(() => f.page.evaluate(() => (window as any).__hoverHit)).toBe(true);
  118 |     const link = hover.locator('a').filter({ hasText: 'MDN' });
  119 |     await link.evaluate(node => node.addEventListener('click', event => {
  120 |       event.preventDefault(); event.stopPropagation(); (window as any).__hoverLinkClicked = true;
  121 |     }, { capture: true }));
  122 |     const linkBox = (await link.boundingBox())!;
  123 |     await nativeInput({ click: await toScreen({ x: linkBox.x + linkBox.width / 2, y: linkBox.y + linkBox.height / 2 }) });
  124 |     await expect.poll(() => f.page.evaluate(() => (window as any).__hoverLinkClicked)).toBe(true);
  125 |     await f.page.mouse.move(1, 1);
  126 |     await expect(hover).toBeHidden(); await expect.poll(nativeVisible).toBe(true); await expect(frozen).toHaveCount(0);
  127 |     // Reopen and hand off to a context menu. Nested covers must restore once,
  128 |     // without leaving the web pane hidden when the last popup closes.
  129 |     await heading.hover(); await expect(hover).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
  130 |     await heading.click({ button: 'right' });
  131 |     const menu = f.page.locator('.monaco-menu-container .monaco-menu');
  132 |     await expect(menu).toBeVisible(); await expect.poll(nativeVisible).toBe(false);
  133 |     await f.page.keyboard.press('Escape');
  134 |     await expect(menu).toBeHidden(); await expect.poll(nativeVisible).toBe(true); await expect(frozen).toHaveCount(0);
  135 |     expect(await evaluatePage(f.app, f.origin, '({ id: keptPage, same: keptDraft === document.querySelector("#draft"), value: keptDraft.value })'))
  136 |       .toEqual({ id: identity, same: true, value: 'keep native input' });
  137 |     expect(f.errors).toEqual([]);
  138 |   } finally { await f.dispose(); }
  139 | });
  140 |
  141 | test('browser details: native image copying and link menus preserve pixels, URLs and source ownership', async () => {
  142 |   const f = await fixture();
  143 |   try {
  144 |     await captureNativeMenus(f.app);
  145 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  146 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  147 |     await evaluatePage(f.app, f.origin, `(() => {
  148 |       const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;
  149 |       const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);
  150 |       const image=new Image();image.id='copy-target';image.src=canvas.toDataURL();image.style='display:block;width:100px;height:50px';
  151 |       document.body.prepend(image);return image.decode();
  152 |     })()`);
  153 |     const id = await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
  154 |     await f.page.evaluate(id => window.marktex.browser.command(id!, 'zoom-in'), id);
  155 |     await f.app.evaluate(({ clipboard }) => clipboard.clear());
  156 |     await pageContextMenu(f.app, f.origin, '#copy-target'); await chooseNativeMenu(f.app, ['Copy Image']);
  157 |     await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
  158 |     await expect.poll(() => f.page.evaluate(async () => {
  159 |       const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
  160 |       if (!item) return null;
  161 |       const bitmap = await createImageBitmap(await item.getType('image/png'));
  162 |       const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  163 |       const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
  164 |       const copied = { width: bitmap.width, height: bitmap.height, pixel: [...context.getImageData(0, 0, 1, 1).data] };
  165 |       bitmap.close(); return copied;
  166 |     })).toEqual({ width: 20, height: 10, pixel: [255, 0, 0, 255] });
  167 |     await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Copy Link Address']);
  168 |     expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${f.origin}/second`);
  169 |     await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Open Link in New Tab']);
  170 |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  171 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  172 |     // Keep a stale native menu through a real navigation: it cannot copy data
  173 |     // or operate on the replacement document.
  174 |     await pageContextMenu(f.app, `${f.origin}/first`, '#copy-target');
  175 |     await f.app.evaluate(async ({ webContents }, origin) => {
  176 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  177 |       await wc.loadURL(`${origin}/second?replacement`);
  178 |     }, f.origin);
  179 |     await f.app.evaluate(({ clipboard }) => clipboard.clear());
  180 |     await chooseNativeMenu(f.app, ['Copy Image']);
  181 |     expect(await f.app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(false);
  182 |     expect(f.errors).toEqual([]);
  183 |   } finally { await f.dispose(); }
  184 | });
  185 |
  186 | for (const surface of ['markdown', 'web'] as const) test(`Explorer menus cover native ${surface} panels and restore their live state`, async () => {
  187 |   const f = await fixture();
  188 |   try {
  189 |     await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
  190 |     await f.page.reload();
  191 |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  192 |     await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
  193 |     const row = f.page.locator('.explorer-row').filter({ hasText: 'notes.md' });
  194 |     await expect(row).toBeVisible();
  195 |     if (surface === 'web') {
  196 |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  197 |       const tab = f.page.getByRole('tab', { name: /Research page/ });
  198 |       await expect(tab).toBeVisible();
  199 |       await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="Unsaved web input";true');
  200 |       const data = await f.page.evaluateHandle(() => new DataTransfer());
  201 |       await tab.dispatchEvent('dragstart', { dataTransfer: data });
  202 |       const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
  203 |       const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
  204 |       await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  205 |       await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  206 |     }
  207 |     const visible = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
```
