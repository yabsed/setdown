# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/editor-groups.spec.ts >> wheel scrolls without selection; nested groups retain live native readers and collapse on close
- Location: test/e2e/workspace/editor-groups.spec.ts:29:1

# Error details

```
Error: locator.boundingBox: Error: strict mode violation: locator('[data-group-id="group-1"]') resolved to 5 elements:
    1) <section class="editor-group" data-group-id="group-1" data-tab-kind="document" aria-label="Editor group">…</section> aka getByText('second.md × ← → ↻ 100%')
    2) <nav class="tab-strip" data-group-id="group-1" aria-label="Open documents">…</nav> aka locator('nav').filter({ hasText: 'second.md ×' })
    3) <div data-group-id="group-1" class="location-bar svelte-1gz7xv1">…</div> aka getByText('← → ↻ 100%').nth(1)
    4) <div class="group-body" data-group-id="group-1" data-zoom-tab="050adc60-5b8e-457b-adb2-482779a0f081">…</div> aka locator('section:nth-child(2) > .group-body')
    5) <div data-group-id="group-1" class="group-editor-host">…</div> aka locator('section:nth-child(2) > .group-body > .group-editor-host')

Call log:
  - waiting for locator('[data-group-id="group-1"]')

```

# Test source

```ts
  43  |     .filter(view => view.getVisible()).length);
  44  |   try {
  45  |     await expect.poll(visibleReaders).toBe(1);
  46  |     await open(page, second);
  47  |     await expect.poll(visibleReaders).toBe(1);
  48  |     await drop(page, 'second.md', 0, 'right');
  49  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  50  |     await expect.poll(visibleReaders).toBe(2);
  51  |     await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => Promise.all(
  52  |       BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible())
  53  |         .map(view => (view as WebContentsView).webContents.executeJavaScript('document.body.innerText')),
  54  |     ))).toEqual(expect.arrayContaining([expect.stringContaining('First reader'), expect.stringContaining('Second reader')]));
  55  |     await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  56  | 
  57  |     // A terminal group must never be covered by either native reader, including
  58  |     // during BrowserWindow resizing and background-view bounds updates.
  59  |     await page.locator('.new-terminal-tab-button').nth(1).click();
  60  |     const terminal = page.getByRole('region', { name: 'Terminal', exact: true });
  61  |     await expect(terminal).toBeVisible();
  62  |     const terminalId = await page.locator('.document-tab[aria-selected="true"]').last().getAttribute('data-tab-id');
  63  |     await dragTerminal(page, page.locator(`[data-tab-id="${terminalId}"]`), page.locator('.group-body').nth(1), 'down');
  64  |     await expect(page.locator('.editor-group')).toHaveCount(3);
  65  |     await expect.poll(visibleReaders).toBe(2);
  66  |     const nativeLayoutMatches = async () => {
  67  |       const bodies = await page.locator('.editor-group:not([data-tab-kind="terminal"]) .group-body').evaluateAll(nodes => nodes.map(node => {
  68  |         const box = node.getBoundingClientRect();
  69  |         return { x: box.x, y: box.y, width: box.width, height: box.height };
  70  |       }).sort((a, b) => a.x - b.x || a.y - b.y));
  71  |       const native = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  72  |         .filter(view => view.getVisible()).map(view => view.getBounds())
  73  |         .sort((a, b) => a.x - b.x || a.y - b.y));
  74  |       const panel = await terminal.boundingBox();
  75  |       return !!panel && bodies.length === native.length && bodies.every((body, index) => {
  76  |         const view = native[index];
  77  |         return Math.abs(body.x - view.x) <= 1 && Math.abs(body.y - view.y) <= 1
  78  |           && Math.abs(body.width - view.width) <= 1 && Math.abs(body.height - view.height) <= 1
  79  |           && (view.x + view.width <= panel.x + 1 || view.y + view.height <= panel.y + 1);
  80  |       });
  81  |     };
  82  |     await expect.poll(nativeLayoutMatches).toBe(true);
  83  |     const terminalTop = (await terminal.boundingBox())!.y;
  84  |     const liveResizeSamples = await app.evaluate(async ({ BrowserWindow }) => {
  85  |       const owner = BrowserWindow.getAllWindows()[0];
  86  |       const [startWidth, height] = owner.getSize();
  87  |       const samples: Array<Array<{ x: number; y: number; width: number; height: number }>> = [];
  88  |       const sample = () => samples.push(owner.contentView.children.filter(view => view.getVisible())
  89  |         .map(view => view.getBounds()).sort((a, b) => a.x - b.x || a.y - b.y));
  90  |       owner.on('resize', sample);
  91  |       for (const width of [startWidth + 180, startWidth - 140, startWidth + 60]) {
  92  |         owner.setSize(width, height);
  93  |         await new Promise(resolve => setTimeout(resolve, 80));
  94  |       }
  95  |       owner.off('resize', sample);
  96  |       return samples;
  97  |     });
  98  |     expect(liveResizeSamples.length).toBeGreaterThan(0);
  99  |     for (const sample of liveResizeSamples) {
  100 |       expect(sample).toHaveLength(2);
  101 |       expect(sample[0].x + sample[0].width).toBeLessThanOrEqual(sample[1].x + 1);
  102 |       expect(sample[1].y + sample[1].height).toBeLessThanOrEqual(terminalTop + 1);
  103 |     }
  104 |     for (const [width, height] of [[980, 720], [1220, 840], [1080, 760]]) {
  105 |       await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
  106 |       await expect.poll(nativeLayoutMatches).toBe(true);
  107 |       await expect.poll(visibleReaders).toBe(2);
  108 |     }
  109 |     await page.locator(`[data-tab-id="${terminalId}"]`).getByTitle('Close tab', { exact: true }).click();
  110 |     await expect(terminal).toBeHidden();
  111 | 
  112 |     // Opening a project file by dropping it in group 2 must never first paint a
  113 |     // tab in the focused/default group and move it on the next task.
  114 |     await page.evaluate(() => {
  115 |       const observed: string[] = [];
  116 |       const record = () => document.querySelectorAll<HTMLElement>('.editor-group').forEach(group => {
  117 |         if ([...group.querySelectorAll('.tab-name')].some(tab => tab.textContent === 'third.md')) {
  118 |           const id = group.dataset.groupId ?? '';
  119 |           if (observed.at(-1) !== id) observed.push(id);
  120 |         }
  121 |       });
  122 |       new MutationObserver(record).observe(document.querySelector('.editor-area')!, { subtree: true, childList: true, characterData: true });
  123 |       (window as typeof window & { __thirdTabGroups?: string[] }).__thirdTabGroups = observed;
  124 |     });
  125 |     const targetGroupId = await page.locator('.editor-group').nth(1).getAttribute('data-group-id');
  126 |     const targetBody = page.locator('.group-body').nth(1);
  127 |     const targetBox = (await targetBody.boundingBox())!;
  128 |     const fileTransfer = await page.evaluateHandle(file => {
  129 |       const transfer = new DataTransfer(); transfer.setData('application/x-setdown-project-file', file); return transfer;
  130 |     }, third);
  131 |     const filePoint = { clientX: targetBox.x + targetBox.width / 2, clientY: targetBox.y + targetBox.height * .55,
  132 |       dataTransfer: fileTransfer };
  133 |     await targetBody.dispatchEvent('dragover', filePoint);
  134 |     await targetBody.dispatchEvent('drop', filePoint);
  135 |     await expect(page.getByRole('tab', { name: /third\.md/ })).toHaveAttribute('aria-selected', 'true');
  136 |     await expect(page.locator('.editor-group')).toHaveCount(3);
  137 |     const openedGroup = page.locator('.editor-group').filter({ has: page.getByRole('tab', { name: /third\.md/ }) });
  138 |     const openedGroupId = await openedGroup.getAttribute('data-group-id');
  139 |     expect(openedGroupId).not.toBe(targetGroupId);
  140 |     await expect.poll(() => page.evaluate(() =>
  141 |       (window as typeof window & { __thirdTabGroups?: string[] }).__thirdTabGroups ?? [])).toEqual([openedGroupId]);
  142 |     const openedBounds = (await openedGroup.boundingBox())!;
> 143 |     const retainedBounds = (await page.locator(`[data-group-id="${targetGroupId}"]`).boundingBox())!;
      |                                                                                      ^ Error: locator.boundingBox: Error: strict mode violation: locator('[data-group-id="group-1"]') resolved to 5 elements:
  144 |     expect(openedBounds.x).toBeCloseTo(retainedBounds.x, 0);
  145 |     expect(openedBounds.width).toBeCloseTo(retainedBounds.width, 0);
  146 |     expect(openedBounds.y).toBeGreaterThan(retainedBounds.y);
  147 |     await page.getByRole('tab', { name: /third\.md/ }).getByTitle('Close tab', { exact: true }).click();
  148 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  149 |     await fileTransfer.dispose();
  150 | 
  151 |     // DOM menus cover native readers only after every visible group has a
  152 |     // painted replacement, so neither the focused nor background group blanks.
  153 |     await page.getByRole('button', { name: 'View', exact: true }).click();
  154 |     await expect(page.locator('.preview-frames[data-frozen="true"]')).toBeVisible();
  155 |     await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(1);
  156 |     expect(await page.locator('.group-body[data-native-preview-frozen="true"]').evaluate(node =>
  157 |       getComputedStyle(node).backgroundImage)).not.toBe('none');
  158 |     await page.keyboard.press('Escape');
  159 |     await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
  160 |     await expect.poll(visibleReaders).toBe(2);
  161 |     await open(page, image);
  162 |     await drop(page, 'picture.png', 1, 'down');
  163 |     await expect(page.locator('.editor-group')).toHaveCount(3);
  164 |     await expect.poll(visibleReaders).toBe(2);
  165 |     await expect(page.getByRole('region', { name: 'Image reader', exact: true })).toBeVisible();
  166 |     const boxes = await page.locator('.editor-group').evaluateAll(nodes => nodes.map(node => {
  167 |       const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  168 |     }));
  169 |     expect(boxes[0].width).toBeCloseTo(boxes[1].width, 0);
  170 |     expect(boxes[0].height).toBeCloseTo(boxes[1].height * 2, 0);
  171 |     expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
  172 |     const imageBounds = (await page.getByRole('region', { name: 'Image reader', exact: true }).boundingBox())!;
  173 |     const imageBody = (await page.locator('.group-body').nth(2).boundingBox())!;
  174 |     expect(imageBounds.x).toBeCloseTo(imageBody.x, 0);
  175 |     expect(imageBounds.y).toBeCloseTo(imageBody.y, 0);
  176 |     expect(imageBounds.width).toBeCloseTo(imageBody.width, 0);
  177 |     expect(imageBounds.height).toBeCloseTo(imageBody.height, 0);
  178 |     await page.screenshot({ path: 'test-results/editor-groups.png' });
  179 |     const sash = page.locator('.group-sash.vertical');
  180 |     // Grab the vertical boundary away from its intersection with the horizontal sash.
  181 |     const sashBox = (await sash.boundingBox())!;
  182 |     const nativeWidths = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  183 |       .filter(view => view.getVisible()).map(view => view.getBounds()).sort((a, b) => a.x - b.x).map(box => box.width));
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
```