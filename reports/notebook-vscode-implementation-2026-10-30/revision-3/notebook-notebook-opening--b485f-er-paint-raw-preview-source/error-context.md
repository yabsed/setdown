# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> opening and switching notebooks and Markdown Escape never paint raw preview source
- Location: test/e2e/notebook/notebook.spec.ts:660:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "editor-placeholder svelte-1ig84k",
+   "editor-placeholder svelte-1ig84k",
+ ]
```

# Test source

```ts
  599 |     await intro.getByRole('button', { name: 'Edit', exact: true }).click();
  600 |     await intro.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  601 |     await expect(code).toBeFocused();
  602 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  603 |     await code.press('Enter');
  604 |     const editor = code.getByRole('textbox', { name: /Code cell editor/ });
  605 |     await editor.press('Control+Home'); await editor.press('End');
  606 |     const horizontal = () => code.locator('.view-lines').evaluate(node => node.getBoundingClientRect().left - node.closest('.cell-editor')!.getBoundingClientRect().left);
  607 |     await expect.poll(horizontal).toBeLessThan(-500);
  608 |     const before = await horizontal();
  609 |     await scroll.evaluate(node => node.scrollTop += 300);
  610 |     await expect.poll(horizontal).toBeCloseTo(before, 0);
  611 |     const unwrappedHeight = await code.locator('.cell-editor').evaluate(node => node.clientHeight);
  612 |     await command('Toggle code word wrap');
  613 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(unwrappedHeight + 100);
  614 |     await command('Toggle code word wrap');
  615 |     // Restore the long line to the viewport so the horizontal scrollbar is present
  616 |     // in both height measurements (Monaco measures visible line widths).
  617 |     await editor.press('Control+Home'); await editor.press('End');
  618 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBe(unwrappedHeight);
  619 |     await code.locator('.execution').click();
  620 |     await command('Toggle cell line numbers'); await expect(code.locator('.line-numbers').first()).toBeVisible();
  621 |     await code.locator('.output-placeholder, .notebook-outputs').scrollIntoViewIfNeeded();
  622 |     // HTML precedes raster fallbacks, but the original MIME bundle remains intact.
  623 |     await expect(code.locator('.output-html table')).toBeVisible();
  624 |     await expect(code.locator('.notebook-outputs img')).toHaveCount(0);
  625 |     const measures = [];
  626 |     for (const width of [420, 560, 780]) {
  627 |       await code.locator('.output-body').evaluate((node, width) => { node.style.width = `${width + 16}px`; node.style.boxSizing = 'border-box'; }, width);
  628 |       const result = await code.locator('.output-body').evaluate(node => {
  629 |         const table = node.querySelector('table')!, label = table.querySelector('tbody th')!;
  630 |         const word = label.firstChild!, range = document.createRange(); range.setStart(word, 0); range.setEnd(word, 8);
  631 |         return { tableWidth: table.getBoundingClientRect().width, tableHeight: table.getBoundingClientRect().height,
  632 |           wordLines: range.getClientRects().length, overflow: node.scrollWidth > node.clientWidth,
  633 |           bodyHeight: node.clientHeight, tableBottom: table.getBoundingClientRect().bottom - node.getBoundingClientRect().top };
  634 |       });
  635 |       expect(result.wordLines).toBe(1); expect(result.tableHeight).toBeLessThan(340);
  636 |       if (width === 420) expect(result.overflow).toBe(true);
  637 |       // No permanent action footer under the output; only padding and a scrollbar.
  638 |       expect(result.bodyHeight - result.tableBottom).toBeLessThan(25);
  639 |       measures.push({ width, ...result });
  640 |       await code.locator('.output-body').screenshot({ path: test.info().outputPath(`dataframe-${width}.png`) });
  641 |     }
  642 |     await writeFile(test.info().outputPath('dataframe-geometry.json'), JSON.stringify(measures, null, 2));
  643 |     await code.getByRole('button', { name: 'More cell actions', exact: true }).click();
  644 |     await page.keyboard.press('Delete'); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  645 |     await page.keyboard.press('Escape'); await expect(code.getByRole('button', { name: 'More cell actions', exact: true })).toBeFocused();
  646 |     await end.getByRole('button', { name: 'Edit', exact: true }).click();
  647 |     await end.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  648 |     await expect(page.locator('.notebook-cell')).toHaveCount(4);
  649 |     const added = page.locator('.notebook-cell').last();
  650 |     await expect(added).toHaveAttribute('data-cell-kind', 'markdown');
  651 |     await expect(added.getByRole('textbox', { name: /Markdown cell editor/ })).toBeFocused();
  652 |     await page.keyboard.press('Alt+Enter');
  653 |     await expect(page.locator('.notebook-cell')).toHaveCount(5);
  654 |     await expect(page.locator('.notebook-cell').last()).toHaveAttribute('data-cell-kind', 'code');
  655 |     await page.keyboard.press('Control+s');
  656 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  657 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  658 | });
  659 | 
  660 | test('opening and switching notebooks and Markdown Escape never paint raw preview source', async () => {
  661 |   test.setTimeout(90_000);
  662 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-presentation-'));
  663 |   const first = path.join(root, 'first.ipynb'), second = path.join(root, 'second.ipynb');
  664 |   const value = notebook(); await writeFile(first, JSON.stringify(value));
  665 |   value.cells[0].source = ['# Second notebook\n\nA **rendered** introduction.']; await writeFile(second, JSON.stringify(value));
  666 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  667 |   const application = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  668 |   try {
  669 |     const page = await application.firstWindow(); await focusApplication(application);
  670 |     await page.addInitScript(() => {
  671 |       const result = { visibleFrames: 0, rawFrames: [] as string[] }; (window as any).notebookPaints = result;
  672 |       function frame() {
  673 |         for (const surface of document.querySelectorAll('.notebook-content:not(.inactive) .notebook-scroll')) {
  674 |           if (getComputedStyle(surface).visibility === 'hidden') continue;
  675 |           result.visibleFrames++;
  676 |           const bounds = surface.getBoundingClientRect();
  677 |           for (const node of surface.querySelectorAll('.cell-markdown > pre, .markdown-placeholder, .editor-placeholder')) {
  678 |             const rect = node.getBoundingClientRect();
  679 |             if (rect.height && rect.bottom > bounds.top && rect.top < bounds.bottom) result.rawFrames.push(node.className || node.textContent || 'raw');
  680 |           }
  681 |         }
  682 |         requestAnimationFrame(frame);
  683 |       }
  684 |       requestAnimationFrame(frame);
  685 |     });
  686 |     await page.reload();
  687 |     await expect(page.locator('.notebook-scroll:not(.preparing) h1')).toHaveText('Notebook');
  688 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
  689 |     const visible = page.locator('.notebook-content:not(.inactive)');
  690 |     await expect(visible.locator('.notebook-scroll:not(.preparing) h1')).toHaveText('Second notebook');
  691 |     const md = visible.locator('[data-cell-id="intro"]');
  692 |     await md.getByRole('button', { name: 'Edit', exact: true }).click();
  693 |     const editor = md.getByRole('textbox', { name: /Markdown cell editor/ });
  694 |     await editor.press('Control+End'); await page.keyboard.insertText('\n\nLatest rendered revision.'); await editor.press('Escape');
  695 |     await expect(md.locator('.cell-markdown')).toContainText('Latest rendered revision.');
  696 |     await page.getByRole('tab', { name: /first.ipynb/ }).click();
  697 |     await expect(visible.locator('h1')).toHaveText('Notebook');
  698 |     await expect.poll(() => page.evaluate(() => (window as any).notebookPaints.visibleFrames)).toBeGreaterThan(10);
> 699 |     expect(await page.evaluate(() => (window as any).notebookPaints.rawFrames)).toEqual([]);
      |                                                                                 ^ Error: expect(received).toEqual(expected) // deep equality
  700 |     await writeFile(test.info().outputPath('presentation-frames.json'), JSON.stringify(await page.evaluate(() => (window as any).notebookPaints), null, 2));
  701 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  702 | });
  703 | 
```