# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/editor-groups.spec.ts >> editing another visible source group preserves scroll and the newly clicked caret
- Location: test/e2e/workspace/editor-groups.spec.ts:242:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByRole('textbox', { name: 'Editor content' })
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" getByRole('textbox', { name: 'Editor content' }) with timeout 5000ms
  - waiting for getByRole('textbox', { name: 'Editor content' })
    13 × locator resolved to <div tabindex="0" role="textbox" autocorrect="off" autocomplete="off" spellcheck="false" autocapitalize="off" aria-required="false" aria-multiline="true" aria-autocomplete="both" class="native-edit-context" aria-label="Editor content" aria-roledescription="editor"></div>
       - unexpected value "hidden"

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "first.cpp ×" [selected]:
          - text: first.cpp
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-group-focus-WxtHz1/first.cpp
    - 'button "Language status: C++, Choose environment"': C++ · Choose environment
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Markdown source editor":
    - code:
      - textbox "Editor content"
- alert
- alert
```

# Test source

```ts
  184 |     const widthsBeforeResize = await nativeWidths();
  185 |     await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height * .3);
  186 |     await page.mouse.down();
  187 |     await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
  188 |     await page.mouse.move(sashBox.x + 75, sashBox.y + sashBox.height * .3);
  189 |     // The live native readers follow the boundary before pointer-up. A stretched
  190 |     // capture cannot satisfy this because its WebContentsView keeps the old box.
  191 |     await expect.poll(async () => (await nativeWidths())[0]).toBeGreaterThan(widthsBeforeResize[0] + 30);
  192 |     await expect.poll(visibleReaders).toBe(2);
  193 |     await page.mouse.up();
  194 |     await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
  195 |     await expect.poll(async () => (await page.locator('.editor-group').first().boundingBox())!.width).toBeGreaterThan(boxes[0].width + 30);
  196 |     await expect.poll(visibleReaders).toBe(2);
  197 |     await sash.dblclick({ position: { x: 2, y: 10 } });
  198 |     // Focusing the left source must leave the right reader and image in place.
  199 |     await page.locator('.document-tab').filter({ hasText: 'first.md' }).click();
  200 |     await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
  201 |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
  202 |     await expect.poll(visibleReaders).toBe(1);
  203 |     await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
  204 |     await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
  205 |     await expect.poll(() => page.locator('.monaco-editor:visible').count()).toBe(2);
  206 |     await page.screenshot({ path: 'test-results/editor-groups-source.png' });
  207 |     // Clicking an unfocused editor must retain keyboard focus after reparenting.
  208 |     await page.locator('.group-editor-host .monaco-editor:visible').click();
  209 |     await expect(page.locator('.editor-group.focused .tab-name')).toHaveText('first.md');
  210 |     await page.keyboard.press('Control+End'); await page.keyboard.type('Direct group edit');
  211 |     await expect(page.locator('.focused-content .view-lines')).toContainText('Direct group edit');
  212 |     await page.keyboard.press('Control+z');
  213 |     await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
  214 |     // Model changes and Undo survive group focus and moving a tab back.
  215 |     await page.locator('.focused-content .monaco-editor').click();
  216 |     await page.keyboard.press('Control+End'); await page.keyboard.type('\nSecond edit');
  217 |     await page.locator('.document-tab').filter({ hasText: 'first.md' }).click();
  218 |     await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
  219 |     await page.locator('.focused-content .monaco-editor').click();
  220 |     await expect(page.locator('.focused-content .view-lines')).toContainText('Second edit');
  221 |     await page.keyboard.press('Control+z');
  222 |     await expect(page.locator('.focused-content .view-lines')).not.toContainText('Second edit');
  223 |     await page.locator('.document-tab').filter({ hasText: 'picture.png' }).getByTitle('Close tab', { exact: true }).click();
  224 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  225 |     await drop(page, 'second.md', 0, 'strip');
  226 |     await expect(page.locator('.editor-group')).toHaveCount(1);
  227 |     // Fill a strip beyond its viewport; vertical wheel changes scrollLeft only.
  228 |     for (let i = 0; i < 14; i++) {
  229 |       const file = path.join(root, `document-${i}.txt`); await writeFile(file, `Document ${i}`); await open(page, file);
  230 |     }
  231 |     const list = page.locator('.tab-list');
  232 |     const selected = await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
  233 |     await list.evaluate(node => { node.scrollLeft = 0; });
  234 |     await list.hover(); await page.mouse.wheel(0, 500);
  235 |     await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  236 |     expect(await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id')).toBe(selected);
  237 |     await page.mouse.wheel(0, -2000);
  238 |     await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBe(0);
  239 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  240 | });
  241 | 
  242 | test('editing another visible source group preserves scroll and the newly clicked caret', async () => {
  243 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-group-focus-'));
  244 |   const first = path.join(root, 'first.cpp'), second = path.join(root, 'second.cpp');
  245 |   const source = (name: string) => Array.from({ length: 500 }, (_, i) => `// ${name} line ${i + 1}`).join('\n');
  246 |   await writeFile(first, source('first')); await writeFile(second, source('second'));
  247 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  248 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  249 |   const page = await app.firstWindow();
  250 |   const snapshot = (editor: Locator) => editor.evaluate(node => {
  251 |     const box = node.getBoundingClientRect();
  252 |     const lines = [...node.querySelectorAll<HTMLElement>('.line-numbers')]
  253 |       .map(line => ({ line: Number(line.textContent), y: line.getBoundingClientRect().y - box.y }))
  254 |       .filter(line => line.y >= 0 && line.y < box.height).sort((a, b) => a.y - b.y);
  255 |     return { firstLine: lines[0]?.line, offset: lines[0]?.y,
  256 |       cursor: Number(node.querySelector('.active-line-number')?.textContent) };
  257 |   });
  258 |   const scrollUp = async (editor: Locator, steps: number) => {
  259 |     await editor.locator('.monaco-editor').hover();
  260 |     // Chromium's native wheel input is normalized by Monaco into wheel steps.
  261 |     for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -120);
  262 |     await editor.evaluate(() => new Promise<void>(resolve => {
  263 |       let frames = 12;
  264 |       const settle = () => { if (--frames === 0) resolve(); else requestAnimationFrame(settle); };
  265 |       requestAnimationFrame(settle);
  266 |     }));
  267 |   };
  268 |   const clickLine = async (editor: Locator) => {
  269 |     const target = await editor.evaluate(node => {
  270 |       const box = node.getBoundingClientRect();
  271 |       const line = [...node.querySelectorAll<HTMLElement>('.line-numbers')]
  272 |         .find(line => {
  273 |           const y = line.getBoundingClientRect().y;
  274 |           return y > box.y + box.height * .6 && y < box.y + box.height * .7;
  275 |         })!;
  276 |       const rect = line.getBoundingClientRect();
  277 |       return { line: Number(line.textContent), x: box.x + 130, y: rect.y + rect.height / 2 };
  278 |     });
  279 |     await page.mouse.click(target.x, target.y);
  280 |     return target.line;
  281 |   };
  282 |   try {
  283 |     await focusApplication(app);
> 284 |     await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  285 |     await open(page, second); await drop(page, 'second.cpp', 0, 'right');
  286 |     await expect(page.locator('.monaco-editor:visible')).toHaveCount(2);
  287 |     await page.locator('.focused-content .group-monaco-instance').evaluate(node => { node.dataset.testEditor = 'second'; });
  288 |     const secondEditor = page.locator('[data-test-editor="second"]');
  289 |     await secondEditor.getByRole('textbox', { name: 'Editor content' }).press('Control+End');
  290 |     await page.keyboard.type(' SECOND_EDIT');
  291 |     await expect(secondEditor.locator('.view-lines')).toContainText('SECOND_EDIT');
  292 |     await page.getByRole('tab', { name: /first\.cpp/ }).click();
  293 |     await page.locator('.focused-content .group-monaco-instance').evaluate(node => { node.dataset.testEditor = 'first'; });
  294 |     const firstEditor = page.locator('[data-test-editor="first"]');
  295 |     await firstEditor.getByRole('textbox', { name: 'Editor content' }).press('Control+End');
  296 |     await page.keyboard.type(' FIRST_EDIT');
  297 |     await expect(firstEditor.locator('.view-lines')).toContainText('FIRST_EDIT');
  298 | 
  299 |     // Scrolling a still-visible background group changes its live viewport,
  300 |     // while its saved deactivation position still points at the end of the file.
  301 |     await scrollUp(secondEditor, 60);
  302 |     await expect.poll(async () => (await snapshot(secondEditor)).firstLine).toBeLessThan(400);
  303 |     const beforeFirst = await snapshot(firstEditor), beforeSecond = await snapshot(secondEditor);
  304 |     const clickedSecond = await clickLine(secondEditor);
  305 | 
  306 |     await expect(page.locator('.editor-group.focused .tab-name')).toHaveText('second.cpp');
  307 |     await expect.poll(() => snapshot(secondEditor)).toEqual({ ...beforeSecond, cursor: clickedSecond });
  308 |     expect(await snapshot(firstEditor)).toEqual(beforeFirst);
  309 |     await page.keyboard.type(' CLICKED_SECOND');
  310 |     await expect(secondEditor.locator('.view-lines')).toContainText('CLICKED_SECOND');
  311 | 
  312 |     // Repeat in the other direction after editing; a group focus change must
  313 |     // preserve both viewports and put input on the line the user just clicked.
  314 |     await scrollUp(firstEditor, 40);
  315 |     await expect.poll(async () => (await snapshot(firstEditor)).firstLine).toBeLessThan(450);
  316 |     const firstScrolled = await snapshot(firstEditor), secondEdited = await snapshot(secondEditor);
  317 |     const clickedFirst = await clickLine(firstEditor);
  318 |     await expect(page.locator('.editor-group.focused .tab-name')).toHaveText('first.cpp');
  319 |     await expect.poll(() => snapshot(firstEditor)).toEqual({ ...firstScrolled, cursor: clickedFirst });
  320 |     expect(await snapshot(secondEditor)).toEqual(secondEdited);
  321 |     await page.keyboard.type(' CLICKED_FIRST');
  322 |     await expect(firstEditor.locator('.view-lines')).toContainText('CLICKED_FIRST');
  323 |   } catch (error) {
  324 |     await page.screenshot({ path: test.info().outputPath('group-focus.png') }).catch(() => {});
  325 |     throw error;
  326 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  327 | });
  328 | 
  329 | test('real tab drags use strip padding and insertion positions while preserving source edits and Undo', async () => {
  330 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-strip-drop-'));
  331 |   const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt'), third = path.join(root, 'third.txt');
  332 |   for (const file of [first, second, third]) await writeFile(file, `${path.basename(file)} original\n`);
  333 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  334 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  335 |   const page = await app.firstWindow();
  336 |   try {
  337 |     await focusApplication(app); await open(page, second); await open(page, third);
  338 |     const thirdTab = page.getByRole('tab', { name: /third\.txt/ });
  339 |     await thirdTab.dragTo(page.getByRole('tab', { name: /first\.txt/ }), { targetPosition: { x: 5, y: 12 } });
  340 |     await expect(page.locator('.tab-name')).toHaveText(['third.txt', 'first.txt', 'second.txt']);
  341 |     await page.getByRole('tab', { name: /second\.txt/ }).click();
  342 |     const editor = page.locator('.focused-content').getByRole('textbox', { name: 'Editor content' });
  343 |     await editor.press('Control+End'); await editor.pressSequentially('KEEP_MY_UNDO');
  344 |     await drop(page, 'second.txt', 0, 'right');
  345 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  346 |     const strip = page.locator('.tab-strip').first();
  347 |     const box = (await strip.boundingBox())!;
  348 |     await page.getByRole('tab', { name: /second\.txt/ }).dragTo(strip, { targetPosition: { x: box.width - 16, y: 2 } });
  349 |     await expect(page.locator('.editor-group')).toHaveCount(1);
  350 |     await expect(page.locator('.tab-name')).toHaveText(['third.txt', 'first.txt', 'second.txt']);
  351 |     await expect(page.locator('.focused-content .view-lines')).toContainText('KEEP_MY_UNDO');
  352 |     await editor.press('Control+z');
  353 |     await expect(page.locator('.focused-content .view-lines')).not.toContainText('KEEP_MY_UNDO');
  354 |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  355 |     await expect(page.locator('.group-drop-overlay')).toBeHidden();
  356 |     await expect(page.locator('.tab-strip.is-drop-target')).toHaveCount(0);
  357 | 
  358 |     for (let i = 0; i < 12; i++) {
  359 |       const file = path.join(root, `overflow-${i}.txt`); await writeFile(file, `${i}`); await open(page, file);
  360 |     }
  361 |     const list = page.locator('.tab-list');
  362 |     await list.evaluate(node => node.scrollLeft = 0);
  363 |     const transfer = await page.evaluateHandle(() => new DataTransfer());
  364 |     await thirdTab.dispatchEvent('dragstart', { dataTransfer: transfer });
  365 |     const listBox = (await list.boundingBox())!;
  366 |     const hover = { clientX: listBox.x + listBox.width - 5, clientY: listBox.y + 12, dataTransfer: transfer };
  367 |     await list.dispatchEvent('dragover', hover);
  368 |     await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  369 |     // One dragover followed by a stationary pointer keeps scrolling the strip.
  370 |     await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
  371 |     await page.screenshot({ path: test.info().outputPath('tab-insertion.png') });
  372 |     await page.keyboard.press('Escape');
  373 |     await thirdTab.dispatchEvent('dragend', hover);
  374 |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  375 |     await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  376 |     const stoppedAt = await list.evaluate(node => node.scrollLeft);
  377 |     await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  378 |     expect(await list.evaluate(node => node.scrollLeft)).toBe(stoppedAt);
  379 |     await transfer.dispose();
  380 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  381 | });
  382 | 
  383 | for (const boundaryLeave of [false, true]) for (const [cell, x, y, side] of [
  384 |   [1, .125, .25, 'left'], [2, .375, .25, 'up'], [5, .625, .25, 'up'], [6, .875, .25, 'right'],
```