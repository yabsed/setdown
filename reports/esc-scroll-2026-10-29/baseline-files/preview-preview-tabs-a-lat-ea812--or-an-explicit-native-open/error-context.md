# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview/preview-tabs.spec.ts >> a late file read cannot replace the last selected file or an explicit native open
- Location: ../../../../../apps/desktop/test/e2e/preview/preview-tabs.spec.ts:136:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  59  |     await expect(tab(page, 'second.txt').getByLabel('Unsaved changes')).toBeVisible();
  60  |     await expect(page.getByRole('alertdialog')).toHaveCount(0);
  61  |     await tab(page, 'second.txt').click(); await editor.press('Control+S');
  62  |     await expect.poll(() => readFile(path.join(root, 'second.txt'), 'utf8')).toContain('unsaved marker');
  63  |     await expect(tab(page, 'second.txt').getByLabel('Unsaved changes')).toHaveCount(0);
  64  |     await browse(page, 'fourth.txt');
  65  |     await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'false');
  66  |     await expect(tab(page, 'third.txt')).toHaveCount(0);
  67  |     await expect(page.locator('.document-tab')).toHaveCount(3);
  68  |   } finally { await cleanup(app, root); }
  69  | });
  70  | 
  71  | test('double-click, middle-click, Enter and explicit open keep files without demoting existing tabs', async () => {
  72  |   const { root, app, page } = await launch();
  73  |   try {
  74  |     await browse(page, 'first.txt');
  75  |     await tab(page, 'first.txt').dblclick();
  76  |     await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
  77  |     await row(page, 'second.txt').dblclick();
  78  |     await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'false');
  79  |     await row(page, 'third.txt').click({ button: 'middle' });
  80  |     await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'false');
  81  |     await row(page, 'fourth.txt').press('Enter');
  82  |     await expect(tab(page, 'fourth.txt')).toHaveAttribute('data-preview', 'false');
  83  |     await browse(page, 'first.txt');
  84  |     await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
  85  |     await browse(page, 'reader.md');
  86  |     await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'true');
  87  |     // Native Open / external file requests use the document:opened boundary.
  88  |     const opened = await page.evaluate(file => window.marktex.openProjectFile(file), path.join(root, 'reader.md'));
  89  |     await app.evaluate(({ BrowserWindow }, document) => BrowserWindow.getAllWindows()[0].webContents
  90  |       .send('document:opened', document), opened);
  91  |     await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'false');
  92  |     await expect(page.locator('.document-tab')).toHaveCount(6);
  93  |     await row(page, 'reader.md').click({ button: 'right' });
  94  |     await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  95  |     await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'false');
  96  |     await page.getByRole('button', { name: 'New document', exact: true }).click();
  97  |     await expect(page.locator('.document-tab')).toHaveCount(7);
  98  |     const draft = page.locator('.document-tab[aria-selected="true"]');
  99  |     await expect(draft).toHaveAttribute('data-preview', 'false');
  100 |     const draftId = await draft.getAttribute('data-tab-id');
  101 |     await browse(page, 'keep.txt');
  102 |     await expect(page.locator(`[data-tab-id="${draftId}"]`)).toHaveAttribute('data-preview', 'false');
  103 |     await expect(page.locator('.document-tab')).toHaveCount(7);
  104 |   } finally { await cleanup(app, root); }
  105 | });
  106 | 
  107 | test('each group owns one preview and dragging a preview keeps its tab', async () => {
  108 |   const { root, app, page } = await launch();
  109 |   try {
  110 |     await browse(page, 'first.txt');
  111 |     const transfer = await page.evaluateHandle(() => new DataTransfer());
  112 |     await tab(page, 'first.txt').dispatchEvent('dragstart', { dataTransfer: transfer });
  113 |     const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
  114 |     const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: transfer };
  115 |     await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  116 |     await transfer.dispose();
  117 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  118 |     await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
  119 |     await browse(page, 'second.txt');
  120 |     await tab(page, 'keep.txt').click();
  121 |     await browse(page, 'third.txt');
  122 |     await expect(page.locator('.editor-group').first().locator('[data-preview="true"]')).toHaveText(/third\.txt/);
  123 |     await expect(page.locator('.editor-group').nth(1).locator('[data-preview="true"]')).toHaveText(/second\.txt/);
  124 |     await tab(page, 'first.txt').getByTitle('Close tab', { exact: true }).click();
  125 |     await tab(page, 'second.txt').click();
  126 |     await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
  127 |     const groupId = await tab(page, 'second.txt').evaluate(node => node.closest<HTMLElement>('.editor-group')!.dataset.groupId);
  128 |     await browse(page, 'fourth.txt');
  129 |     await expect(tab(page, 'second.txt')).toHaveCount(0);
  130 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  131 |     expect(await tab(page, 'fourth.txt').evaluate(node => node.closest<HTMLElement>('.editor-group')!.dataset.groupId)).toBe(groupId);
  132 |     await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'true');
  133 |   } finally { await cleanup(app, root); }
  134 | });
  135 | 
  136 | test('a late file read cannot replace the last selected file or an explicit native open', async () => {
  137 |   const { root, app, page } = await launch();
  138 |   try {
  139 |     await app.evaluate(({ ipcMain }, delayedPath) => {
  140 |       type Handler = (event: Electron.IpcMainInvokeEvent, file: string) => Promise<unknown>;
  141 |       const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })
  142 |         ._invokeHandlers.get('project:open-file')!;
  143 |       const state = { waiting: false, finished: false, release: () => {} };
  144 |       (globalThis as typeof globalThis & { heldOpen: typeof state }).heldOpen = state;
  145 |       ipcMain.removeHandler('project:open-file');
  146 |       ipcMain.handle('project:open-file', async (event, file: string) => {
  147 |         if (file.endsWith('/fourth.txt')) throw new Error('Test read failure');
  148 |         const result = await original(event, file);
  149 |         if (file === delayedPath) {
  150 |           state.waiting = true;
  151 |           await new Promise<void>(resolve => state.release = resolve);
  152 |           state.finished = true;
  153 |         }
  154 |         return result;
  155 |       });
  156 |     }, path.join(root, 'first.txt'));
  157 |     await row(page, 'first.txt').click();
  158 |     await expect.poll(() => app.evaluate(() =>
> 159 |       (globalThis as typeof globalThis & { heldOpen: { waiting: boolean } }).heldOpen.waiting)).toBe(true);
      |                                                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  160 |     await browse(page, 'second.txt');
  161 |     await app.evaluate(() => (globalThis as typeof globalThis & { heldOpen: { release(): void } }).heldOpen.release());
  162 |     await expect.poll(() => app.evaluate(() =>
  163 |       (globalThis as typeof globalThis & { heldOpen: { finished: boolean } }).heldOpen.finished)).toBe(true);
  164 |     await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  165 |     await expect(tab(page, 'first.txt')).toHaveCount(0);
  166 |     await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
  167 | 
  168 |     await app.evaluate(() => {
  169 |       const state = (globalThis as typeof globalThis & { heldOpen: { waiting: boolean; finished: boolean } }).heldOpen;
  170 |       state.waiting = false; state.finished = false;
  171 |     });
  172 |     await row(page, 'first.txt').click();
  173 |     await expect.poll(() => app.evaluate(() =>
  174 |       (globalThis as typeof globalThis & { heldOpen: { waiting: boolean } }).heldOpen.waiting)).toBe(true);
  175 |     const opened = await page.evaluate(file => window.marktex.openProjectFile(file), path.join(root, 'third.txt'));
  176 |     await app.evaluate(({ BrowserWindow }, document) => BrowserWindow.getAllWindows()[0].webContents
  177 |       .send('document:opened', document), opened);
  178 |     await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
  179 |     await app.evaluate(() => (globalThis as typeof globalThis & { heldOpen: { release(): void } }).heldOpen.release());
  180 |     await expect.poll(() => app.evaluate(() =>
  181 |       (globalThis as typeof globalThis & { heldOpen: { finished: boolean } }).heldOpen.finished)).toBe(true);
  182 |     await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  183 |     await expect(tab(page, 'first.txt')).toHaveCount(0);
  184 |     await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
  185 |     await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'false');
  186 |     await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'true');
  187 |     await row(page, 'fourth.txt').click();
  188 |     await expect(page.locator('.project-error')).toContainText('Test read failure');
  189 |     await expect(tab(page, 'fourth.txt')).toHaveCount(0);
  190 |     await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
  191 |   } finally { await cleanup(app, root); }
  192 | });
  193 | 
  194 | test('Explorer preview files share Back and Forward history and a new browse truncates the old branch', async () => {
  195 |   const { root, app, page } = await launch();
  196 |   try {
  197 |     await browse(page, 'first.txt');
  198 |     await browse(page, 'second.txt');
  199 |     await browse(page, 'third.txt');
  200 |     const id = (await tab(page, 'third.txt').getAttribute('data-tab-id'))!;
  201 |     const back = page.getByRole('button', { name: 'Back', exact: true });
  202 |     const forward = page.getByRole('button', { name: 'Forward', exact: true });
  203 |     await back.click(); await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
  204 |     await page.keyboard.press('Alt+ArrowLeft');
  205 |     await expect(tab(page, 'first.txt')).toHaveAttribute('aria-selected', 'true');
  206 |     await expect(tab(page, 'first.txt')).toHaveAttribute('data-tab-id', id);
  207 |     await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'true');
  208 |     await expect(back).toBeDisabled();
  209 |     await forward.click(); await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
  210 |     await browse(page, 'fourth.txt');
  211 |     await expect(forward).toBeDisabled();
  212 |     await back.click(); await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
  213 |     await expect(page.locator('.document-tab')).toHaveCount(2);
  214 |     await expect(tab(page, 'keep.txt')).toBeVisible();
  215 |   } finally { await cleanup(app, root); }
  216 | });
  217 | 
```