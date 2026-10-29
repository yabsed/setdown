# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: project/explorer-selection.spec.ts >> Explorer modifier and keyboard selection, context actions, and a real multi-file folder drop preserve dirty text
- Location: ../../../../../apps/desktop/test/e2e/project/explorer-selection.spec.ts:187:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "UNSAVED_SELECTION"
Received string:    "a.txt original
"

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  127 |     expect(await readFile(path.join(root, 'destination', 'a copy.txt'), 'utf8')).toContain('original');
  128 |     await expect(selected(page)).toHaveText(['a copy.txt']);
  129 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  130 | });
  131 | 
  132 | test('Explorer rename selects basename, respects composition, and retains selection across sidebar switches and refresh', async () => {
  133 |   const { root, app, page } = await launch();
  134 |   try {
  135 |     await entry(page, 'a.txt').click({ button: 'right' });
  136 |     await page.getByRole('menuitem', { name: /^Rename\b/ }).click();
  137 |     const input = page.getByRole('textbox', { name: 'Rename entry', exact: true });
  138 |     await expect(input).toBeFocused();
  139 |     expect(await input.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
  140 |     await input.evaluate(node => {
  141 |       node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '가' }));
  142 |       node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
  143 |       node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  144 |     });
  145 |     await expect(input).toBeVisible();
  146 |     await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '가' })));
  147 |     await input.pressSequentially('zeta'); await input.press('Enter');
  148 |     await expect(entry(page, 'zeta.txt')).toBeVisible();
  149 |     await expect(selected(page)).toHaveText(['zeta.txt']);
  150 |     await page.getByRole('button', { name: 'Search', exact: true }).click();
  151 |     await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  152 |     await expect(selected(page)).toHaveText(['zeta.txt']);
  153 |     await writeFile(path.join(root, 'external.txt'), 'external');
  154 |     await expect(entry(page, 'external.txt')).toBeVisible();
  155 |     await expect(selected(page)).toHaveText(['zeta.txt']);
  156 |     await entry(page, 'zeta.txt').press('b');
  157 |     await expect(selected(page)).toHaveText(['b.txt']);
  158 | 
  159 |     // A real input owns Copy; it must not replace the pending file clipboard.
  160 |     await entry(page, 'b.txt').press('F2');
  161 |     const rename = page.getByRole('textbox', { name: 'Rename entry' });
  162 |     await rename.fill('plain-text.txt'); await rename.press('Control+a'); await rename.press('Control+c');
  163 |     await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('plain-text.txt');
  164 |     await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toBeNull();
  165 |     await rename.press('Escape');
  166 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  167 | });
  168 | 
  169 | test('a failed OS trash operation keeps the unsaved tab, text and selection', async () => {
  170 |   const { root, app, page } = await launch();
  171 |   try {
  172 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  173 |     await editor.press('Control+End'); await editor.pressSequentially('KEEP_UNSAVED');
  174 |     await app.evaluate(({ shell }) => { shell.trashItem = async () => { throw new Error('Simulated OS trash failure'); }; });
  175 |     await entry(page, 'a.txt').click({ button: 'right' });
  176 |     await page.getByRole('menuitem', { name: /^Move to Trash/ }).click();
  177 |     await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  178 |     await page.getByRole('button', { name: "Don't Save", exact: true }).click();
  179 |     await expect(page.locator('.project-error')).toContainText('Simulated OS trash failure');
  180 |     await expect(page.getByRole('tab', { name: /a\.txt/ })).toBeVisible();
  181 |     await expect(page.locator('.view-lines')).toContainText('KEEP_UNSAVED');
  182 |     await expect(selected(page)).toHaveText(['a.txt']);
  183 |     expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('a.txt original\n');
  184 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  185 | });
  186 | 
  187 | test('Explorer modifier and keyboard selection, context actions, and a real multi-file folder drop preserve dirty text', async () => {
  188 |   const { root, app, page } = await launch();
  189 |   try {
  190 |     await expect(page.getByRole('tree')).toHaveAttribute('aria-multiselectable', 'true');
  191 |     await entry(page, 'a.txt').click();
  192 |     await entry(page, 'c.txt').click({ modifiers: ['Control'] });
  193 |     await expect(selected(page)).toHaveText(['a.txt', 'c.txt']);
  194 |     // A modifier click only selects; it must not open or replace a preview.
  195 |     await expect(page.locator('.tab-name')).toHaveText(['a.txt']);
  196 |     await entry(page, 'b.txt').click({ modifiers: ['Shift'] });
  197 |     await expect(selected(page)).toHaveText(['b.txt', 'c.txt']);
  198 |     await entry(page, 'd.txt').click({ modifiers: ['Shift'] });
  199 |     await expect(selected(page)).toHaveText(['c.txt', 'd.txt']);
  200 |     await entry(page, 'c.txt').click({ modifiers: ['Control'] });
  201 |     await expect(selected(page)).toHaveText(['d.txt']);
  202 |     await entry(page, 'b.txt').press('Home');
  203 |     await page.keyboard.press('Control+a');
  204 |     await expect(selected(page)).toHaveCount(await page.locator('.explorer-row').count());
  205 |     await page.keyboard.press('Escape'); await expect(selected(page)).toHaveCount(0);
  206 |     await entry(page, 'a.txt').press('Space');
  207 |     await entry(page, 'a.txt').press('Shift+ArrowDown');
  208 |     await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  209 |     await entry(page, 'b.txt').click({ button: 'right' });
  210 |     await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  211 |     await expect(page.getByRole('menuitem', { name: /^Rename/ })).toHaveCount(0);
  212 |     await page.getByRole('menuitem', { name: /^Move to Trash/ }).click();
  213 |     await expect(page.getByRole('alertdialog')).toContainText('2 items');
  214 |     await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  215 |     await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  216 |     await entry(page, 'a.txt').press('Enter');
  217 |     await expect(page.locator('.tab-name')).toHaveText(['a.txt', 'b.txt']);
  218 |     await page.getByRole('tab', { name: /a\.txt/ }).click();
  219 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  220 |     await editor.press('Control+End'); await editor.pressSequentially('UNSAVED_SELECTION');
  221 |     await entry(page, 'b.txt').dragTo(entry(page, 'destination'));
  222 |     await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a.txt', 'b.txt']);
  223 |     await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  224 |     await expect(page.getByRole('tab', { name: /a\.txt/ })).toHaveAttribute('title', path.join(root, 'destination', 'a.txt'));
  225 |     await expect(page.locator('.view-lines')).toContainText('UNSAVED_SELECTION');
  226 |     await editor.press('Control+s');
> 227 |     await expect.poll(() => readFile(path.join(root, 'destination', 'a.txt'), 'utf8')).toContain('UNSAVED_SELECTION');
      |                                                                                        ^ Error: expect(received).toContain(expected) // indexOf
  228 |     expect((await readdir(root)).includes('a.txt')).toBe(false);
  229 |     await page.screenshot({ path: test.info().outputPath('selection-moved.png') });
  230 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  231 | });
  232 | 
  233 | test('Explorer batch conflicts leave all sources and destination contents intact', async () => {
  234 |   const { root, app, page } = await launch();
  235 |   try {
  236 |     await writeFile(path.join(root, 'destination', 'b.txt'), 'DO NOT OVERWRITE');
  237 |     await entry(page, 'a.txt').click(); await entry(page, 'b.txt').click({ modifiers: ['Control'] });
  238 |     await entry(page, 'b.txt').dragTo(entry(page, 'destination'));
  239 |     await expect(page.locator('.project-error')).toContainText('already exists');
  240 |     expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('a.txt original\n');
  241 |     expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toBe('b.txt original\n');
  242 |     expect(await readFile(path.join(root, 'destination', 'b.txt'), 'utf8')).toBe('DO NOT OVERWRITE');
  243 |     expect(await readdir(path.join(root, 'destination'))).toEqual(['b.txt']);
  244 |     await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  245 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  246 | });
  247 | 
  248 | test('dropping selected files on tab-strip padding opens every file in order as a pinned tab', async () => {
  249 |   const { root, app, page } = await launch();
  250 |   try {
  251 |     await entry(page, 'b.txt').click({ modifiers: ['Control'] });
  252 |     await entry(page, 'd.txt').click({ modifiers: ['Shift'] });
  253 |     await expect(selected(page)).toHaveText(['b.txt', 'c.txt', 'd.txt']);
  254 |     const strip = page.locator('.tab-strip');
  255 |     const box = (await strip.boundingBox())!;
  256 |     expect(await strip.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  257 |     await entry(page, 'c.txt').dragTo(strip, { targetPosition: { x: box.width / 2, y: 2 } });
  258 |     await expect(page.locator('.tab-name')).toHaveText(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  259 |     await expect(page.locator('.document-tab[data-preview="true"]')).toHaveCount(0);
  260 |     await expect(page.locator('.editor-group')).toHaveCount(1);
  261 |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  262 |     await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  263 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  264 | });
  265 | 
```