# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/editor-groups.spec.ts >> real Markdown tab drag cell 3 splits left with native boundary leave=false
- Location: test/e2e/workspace/editor-groups.spec.ts:387:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('.group-drop-overlay')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('.group-drop-overlay') with timeout 5000ms
  - waiting for locator('.group-drop-overlay')
    14 × locator resolved to <div hidden="" class="group-drop-overlay"></div>
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
        - tab "first.md ×":
          - text: first.md
          - button "×"
        - tab "second.md ×" [selected]:
          - text: second.md
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-native-split-EiqvEg/second.md
    - button "Open outline"
    - button "Switch to Editor"
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Rendered Markdown"
- alert
- alert
```

# Test source

```ts
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
  385 |   [3, .125, .75, 'left'], [4, .375, .75, 'down'], [7, .625, .75, 'down'], [8, .875, .75, 'right'],
  386 | ] as const)
  387 | test(`real Markdown tab drag cell ${cell} splits ${side} with native boundary leave=${boundaryLeave}`, async () => {
  388 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-native-split-'));
  389 |   const first = path.join(root, 'first.md'), second = path.join(root, 'second.md');
  390 |   await writeFile(first, '# First native reader\n\nKeep this document.\n');
  391 |   await writeFile(second, '# Second native reader\n\nMove this document.\n');
  392 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  393 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  394 |   const page = await app.firstWindow();
  395 |   try {
  396 |     await focusApplication(app); await open(page, second);
  397 |     await page.evaluate(() => {
  398 |       const events: unknown[] = [];
  399 |       for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) {
  400 |         window.addEventListener(type, event => {
  401 |           const e = event as DragEvent;
  402 |           events.push({ type, x: e.clientX, y: e.clientY, related: (e.relatedTarget as Element | null)?.className ?? null,
  403 |             target: (e.target as Element | null)?.className, dragging: document.querySelector('.shell')?.classList.contains('is-tab-dragging') });
  404 |         }, true);
  405 |       }
  406 |       (window as typeof window & { splitDragEvents: unknown[] }).splitDragEvents = events;
  407 |     });
  408 |     const tab = page.getByRole('tab', { name: /second\.md/ });
  409 |     const body = page.locator('.group-body').first();
  410 |     const bounds = (await body.boundingBox())!;
  411 |     const tabBox = (await tab.boundingBox())!;
  412 |     await page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
  413 |     await page.mouse.down();
  414 |     await page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
  415 |     if (boundaryLeave) {
  416 |       // Native child-surface boundaries can produce a null relatedTarget even
  417 |       // inside the window. Reproduce that platform signal during a real drag.
  418 |       await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length)).toBe(0);
  419 |       await page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
  420 |         bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
  421 |       })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
  422 |       await expect(page.locator('.shell')).toHaveClass(/is-tab-dragging/);
  423 |       expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length)).toBe(0);
  424 |     }
  425 |     await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y, { steps: 12 });
  426 |     const overlay = page.locator('.group-drop-overlay');
> 427 |     await expect(overlay).toBeVisible();
      |                           ^ Error: expect(locator).toBeVisible() failed
  428 |     const guide = (await overlay.boundingBox())!;
  429 |     const horizontal = side === 'left' || side === 'right';
  430 |     expect(guide.x).toBeCloseTo(bounds.x + (side === 'right' ? bounds.width / 2 : 0), 0);
  431 |     expect(guide.y).toBeCloseTo(bounds.y + (side === 'down' ? bounds.height / 2 : 0), 0);
  432 |     expect(guide.width).toBeCloseTo(bounds.width / (horizontal ? 2 : 1), 0);
  433 |     expect(guide.height).toBeCloseTo(bounds.height / (horizontal ? 1 : 2), 0);
  434 |     await page.mouse.up();
  435 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  436 |     await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length)).toBe(2);
  437 |     const moved = (await page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  438 |     const remaining = (await page.locator('.editor-group').filter({ hasNot: tab }).boundingBox())!;
  439 |     const axis = horizontal ? 'x' : 'y';
  440 |     if (side === 'left' || side === 'up') expect(moved[axis]).toBeLessThan(remaining[axis]);
  441 |     else expect(moved[axis]).toBeGreaterThan(remaining[axis]);
  442 |     expect(moved[horizontal ? 'width' : 'height']).toBeCloseTo(remaining[horizontal ? 'width' : 'height'], 0);
  443 |     await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => Promise.all(
  444 |       BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible())
  445 |         .map(view => (view as WebContentsView).webContents.executeJavaScript('document.body.innerText')),
  446 |     ))).toEqual(expect.arrayContaining([expect.stringContaining('First native reader'), expect.stringContaining('Second native reader')]));
  447 |     await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  448 |     await expect(page.locator('.group-drop-overlay')).toBeHidden();
  449 |   } finally {
  450 |     await page.mouse.up().catch(() => {});
  451 |     const events = await page.evaluate(() => (window as typeof window & { splitDragEvents?: unknown[] }).splitDragEvents).catch(() => []);
  452 |     await writeFile(test.info().outputPath('drag-events.json'), JSON.stringify(events, null, 2));
  453 |     await page.screenshot({ path: test.info().outputPath('native-split.png') }).catch(() => {});
  454 |     await disposeApplication(app); await rm(root, { recursive: true, force: true });
  455 |   }
  456 | });
  457 | 
  458 | test('Monaco find tooltip stays stable while hovering Close', async () => {
  459 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-find-hover-'));
  460 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  461 |   const app = await electron.launch({ args: ['.', path.resolve('test/fixtures/sample.md')],
  462 |     env: { ...env, XDG_CONFIG_HOME: root } });
  463 |   try {
  464 |     const page = await app.firstWindow();
  465 |     await focusApplication(app);
  466 |     await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(710, 500));
  467 |     await page.locator('.new-tab-button').click();
  468 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  469 |     await editor.pressSequentially('dasfdsaf');
  470 |     await editor.press('Control+f');
  471 |     const find = page.locator('.find-widget.visible');
  472 |     await find.getByRole('textbox', { name: 'Find', exact: true }).fill('dasfdsaf');
  473 |     const sampleHover = async (name: string) => {
  474 |       const close = find.getByRole('button', { name: /^Close/ });
  475 |       await close.hover();
  476 |       await expect(page.locator('.monaco-hover.workbench-hover')).toHaveText('Close (Escape)');
  477 |       await expect(page.locator('.monaco-hover.workbench-hover')).toBeVisible();
  478 |       const stability = await close.evaluate(async element => {
  479 |         const rect = element.getBoundingClientRect();
  480 |         const hover = document.querySelector('.monaco-hover.workbench-hover')!;
  481 |         const initialRect = hover.getBoundingClientRect();
  482 |         const focused = document.activeElement;
  483 |         const start = performance.now();
  484 |         let frames = 0, replacements = 0, intercepted = 0, resized = 0, clipped = 0, focusChanges = 0;
  485 |         await new Promise<void>(resolve => {
  486 |           const frame = () => {
  487 |             frames++;
  488 |             if (document.querySelector('.monaco-hover.workbench-hover') !== hover) replacements++;
  489 |             if (document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) !== element) intercepted++;
  490 |             const currentRect = hover.getBoundingClientRect();
  491 |             if (currentRect.width !== initialRect.width || currentRect.height !== initialRect.height) resized++;
  492 |             // Playwright visibility alone does not catch ancestor clipping.
  493 |             for (const x of [currentRect.left + 4, currentRect.right - 4]) {
  494 |               for (const y of [currentRect.top + 4, currentRect.bottom - 4]) {
  495 |                 if (!hover.contains(document.elementFromPoint(x, y))) clipped++;
  496 |               }
  497 |             }
  498 |             if (document.activeElement !== focused) focusChanges++;
  499 |             if (performance.now() - start >= 1500) resolve();
  500 |             else requestAnimationFrame(frame);
  501 |           };
  502 |           frame();
  503 |         });
  504 |         return { frames, replacements, intercepted, resized, clipped, focusChanges };
  505 |       });
  506 |       await writeFile(test.info().outputPath(`${name}.json`), JSON.stringify(stability, null, 2));
  507 |       await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  508 |       expect(stability.frames).toBeGreaterThan(1);
  509 |       expect(stability).toMatchObject({ replacements: 0, intercepted: 0, resized: 0, clipped: 0, focusChanges: 0 });
  510 |       await page.mouse.move(15, 400);
  511 |       await expect(page.locator('.monaco-hover.workbench-hover')).toBeHidden();
  512 |     };
  513 |     await sampleHover('single');
  514 |     await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 700));
  515 |     await drop(page, 'Untitled.md', 0, 'right');
  516 |     await editor.press('Control+f');
  517 |     await find.getByRole('textbox', { name: 'Find', exact: true }).fill('dasfdsaf');
  518 |     await sampleHover('split-active');
  519 |     await find.getByRole('button', { name: /^Close/ }).click();
  520 |     await expect(page.locator('.find-widget.visible')).toHaveCount(0);
  521 |   } finally {
  522 |     await disposeApplication(app);
  523 |     await rm(root, { recursive: true, force: true });
  524 |   }
  525 | });
  526 | 
  527 | test('Monaco find closes with its X button and keeps editor input usable', async () => {
```