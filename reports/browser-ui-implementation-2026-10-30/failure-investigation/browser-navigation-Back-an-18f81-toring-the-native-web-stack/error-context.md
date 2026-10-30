# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/navigation.spec.ts >> Back and Forward traverse file and web boundaries while restoring the native web stack
- Location: test/e2e/browser/navigation.spec.ts:288:1

# Error details

```
Error: Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  226 |     const contentsId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
  227 |     await go(pathToFileURL(pdf).href);
  228 |     await expect(selected).toContainText(path.basename(pdf));
  229 |     await expect(address).toHaveValue(pathToFileURL(pdf).href);
  230 |     const reader = f.page.getByRole('region', { name: 'PDF reader', exact: true });
  231 |     await expect(reader).toHaveAttribute('data-pdf-pages', '2');
  232 |     await expect(reader.locator('[data-page-number="1"] .textLayer')).toContainText('PDF page 1');
  233 |     await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), contentsId)).toBe(false);
  234 |     await go(`${f.origin}/second`);
  235 |     await expect(selected).toContainText('Second page');
  236 |     await expect(f.page.locator('.pdf-surface')).toHaveCount(0);
  237 |     await go(original); // Absolute paths remain accepted too.
  238 |     await expect(selected).toContainText('notes.md');
  239 |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  240 |     await expect(address).toHaveValue(pathToFileURL(original).href);
  241 |     await expect.poll(() => f.app.evaluate(async ({ BrowserWindow }) => {
  242 |       const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible());
  243 |       if (views.length !== 1) return '';
  244 |       return (views[0] as import('electron').WebContentsView).webContents.executeJavaScript('document.body.innerText');
  245 |     })).toContain('Keep the reader intact.');
  246 |     await go(pathToFileURL(path.join(downloads, 'missing.pdf')).href);
  247 |     await expect(f.page.locator('.location-error[role="alert"]')).toContainText('ENOENT');
  248 |     await expect(selected).toContainText('notes.md');
  249 |     await expect(selected).toHaveAttribute('data-tab-id', id);
  250 |     await expect(f.page.locator('.document-tab')).toHaveCount(1);
  251 |     expect(f.errors).toEqual([]);
  252 |   } finally { await f.dispose(); await rm(downloads, { recursive: true, force: true }); }
  253 | });
  254 | 
  255 | test('address navigation asks to save edited files and cancellation preserves the current tab', async () => {
  256 |   const f = await fixture();
  257 |   const file = path.join(f.root, 'edited.txt');
  258 |   await writeFile(file, 'Original text\n');
  259 |   try {
  260 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  261 |     await expect(selected).toContainText('notes.md');
  262 |     const id = (await selected.getAttribute('data-tab-id'))!;
  263 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  264 |     await address.fill(pathToFileURL(file).href); await address.press('Enter');
  265 |     await expect(selected).toContainText('edited.txt');
  266 |     const editor = f.page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  267 |     await editor.press('Control+End'); await editor.pressSequentially('unsaved marker');
  268 |     await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
  269 |     await address.fill(`${f.origin}/first`); await address.press('Enter');
  270 |     const prompt = f.page.getByRole('dialog', { name: 'Save Changes' });
  271 |     await expect(prompt).toBeVisible();
  272 |     await prompt.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  273 |     await expect(prompt).toHaveCount(0);
  274 |     await expect(selected).toContainText('edited.txt');
  275 |     await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
  276 |     await expect(address).toHaveValue(pathToFileURL(file).href);
  277 |     expect(await readFile(file, 'utf8')).not.toContain('unsaved marker');
  278 |     await address.fill(`${f.origin}/first`); await address.press('Enter');
  279 |     await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  280 |     await expect(selected).toContainText('Research page');
  281 |     expect(await readFile(file, 'utf8')).toContain('unsaved marker');
  282 |     await expect(selected).toHaveAttribute('data-tab-id', id);
  283 |     await expect(f.page.locator('.document-tab')).toHaveCount(1);
  284 |     expect(f.errors).toEqual([]);
  285 |   } finally { await f.dispose(); }
  286 | });
  287 | 
  288 | test('Back and Forward traverse file and web boundaries while restoring the native web stack', async () => {
  289 |   const f = await fixture();
  290 |   const pdf = path.join(f.root, 'history.pdf');
  291 |   await writeFile(pdf, pdfFixture(2));
  292 |   try {
  293 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  294 |     await expect(selected).toContainText('notes.md');
  295 |     const id = await selected.getAttribute('data-tab-id');
  296 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  297 |     const back = f.page.getByRole('button', { name: 'Back', exact: true });
  298 |     const forward = f.page.getByRole('button', { name: 'Forward', exact: true });
  299 |     await expect(back).toBeDisabled();
  300 |     await address.fill(`${f.origin}/first`); await address.press('Enter');
  301 |     await expect(selected).toContainText('Research page');
  302 |     await evaluatePage(f.app, f.origin, 'document.querySelector("a").click();true');
  303 |     await expect(address).toHaveValue(`${f.origin}/second`);
  304 |     await address.fill(pathToFileURL(pdf).href); await address.press('Enter');
  305 |     await expect(f.page.getByRole('region', { name: 'PDF reader', exact: true })).toHaveAttribute('data-pdf-pages', '2');
  306 |     await back.click();
  307 |     await expect(address).toHaveValue(`${f.origin}/second`);
  308 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/second');
  309 |     await back.click();
  310 |     await expect(address).toHaveValue(`${f.origin}/first`);
  311 |     // Input in the native page must also cross the last web entry into a file.
  312 |     await f.app.evaluate(({ webContents }, origin) => {
  313 |       const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  314 |       page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
  315 |       page.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
  316 |     }, f.origin);
  317 |     await expect(selected).toContainText('notes.md');
  318 |     await expect(address).toHaveValue(pathToFileURL(path.join(f.root, 'notes.md')).href);
  319 |     await expect(back).toBeDisabled();
  320 |     await forward.click(); await expect(address).toHaveValue(`${f.origin}/first`);
  321 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/first');
  322 |     await forward.click(); await expect(address).toHaveValue(`${f.origin}/second`);
  323 |     await forward.click(); await expect(selected).toContainText('history.pdf');
  324 |     await back.click(); await expect(address).toHaveValue(`${f.origin}/second`);
  325 |     await address.fill(`${f.origin}/new-branch`); await address.press('Enter');
> 326 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/new-branch');
      |                                                                                 ^ Error: Timeout 5000ms exceeded while waiting on the predicate
  327 |     await expect(forward).toBeDisabled();
  328 |     await expect(selected).toHaveAttribute('data-tab-id', id!);
  329 |     await expect(f.page.locator('.document-tab')).toHaveCount(1);
  330 |     expect(f.errors).toEqual([]);
  331 |   } finally { await f.dispose(); }
  332 | });
  333 | 
  334 | 
```