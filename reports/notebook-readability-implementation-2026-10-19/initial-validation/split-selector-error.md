# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook reading hierarchy keeps content, actions and focus distinct, including narrow split panes
- Location: test/e2e/notebook/notebook.spec.ts:16:1

# Error details

```
TimeoutError: locator.boundingBox: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.editor-group').first().locator('.notebook-toolbar')

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
  3   | import os from 'node:os';
  4   | import path from 'node:path';
  5   | import { execFileSync } from 'node:child_process';
  6   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  7   | 
  8   | const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5N8AAAAASUVORK5CYII=';
  9   | const notebook = () => ({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' }, custom: { keep: 'unchanged' } }, cells: [
  10  |   { id: 'intro', cell_type: 'markdown', metadata: {}, source: ['# Notebook\n', 'A **Markdown** cell. $x^2$\n\n![pixel](attachment:pixel.png)'], attachments: { 'pixel.png': { 'image/png': png } } },
  11  |   { id: 'define', cell_type: 'code', metadata: {}, source: ['numbers = [1, 2, 3]\n'], execution_count: 1,
  12  |     outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<b>Saved table</b><script>window.notebookInjected=true</script><iframe src="https://example.com"></iframe><svg onload="window.notebookInjected=true"></svg><div style="position:fixed;inset:0">safe text</div>', 'application/custom+json': { keep: 123 } } }] },
  13  |   { id: 'use', cell_type: 'code', metadata: {}, source: 'numbers.append(4)', execution_count: null, outputs: [] },
  14  | ] });
  15  | 
  16  | test('notebook reading hierarchy keeps content, actions and focus distinct, including narrow split panes', async () => {
  17  |   test.setTimeout(90_000);
  18  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-reading-'));
  19  |   const file = path.join(root, 'reading.ipynb'), other = path.join(root, 'other.ipynb');
  20  |   const value = notebook();
  21  |   value.cells[0].source = ['## 출력에 남기는 오류 정보\n\n' + '오류는 고정된 분류와 건수로 요약한다. 상세 원인은 내부 오류 파일에서 확인한다. '.repeat(4) + '`numbers`는 코드에 정의된 값이다.'];
  22  |   value.cells[1].source = ['# A readable comment\nnumbers = [1, 2, 3]\n'];
  23  |   value.cells[1].outputs = [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: {
  24  |     'text/plain': 'Two-line 2.117', 'text/html': '<style>table{position:fixed}</style><table class="dataframe"><thead><tr><th>Model</th><th>Test RMSE</th><th>Note</th></tr></thead><tbody><tr><th>Two-line</th><td>2.117</td><td>other_error</td></tr></tbody></table>',
  25  |   } }] as any;
  26  |   await writeFile(file, JSON.stringify(value)); await writeFile(other, JSON.stringify(notebook()));
  27  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  28  |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  29  |   try {
  30  |     const page = await application.firstWindow(); await focusApplication(application);
  31  |     await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  32  |     const md = page.locator('[data-cell-id="intro"]'), code = page.locator('[data-cell-id="define"]');
  33  |     await expect(md.locator('.cell-markdown h2')).toHaveText('출력에 남기는 오류 정보');
  34  |     await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
  35  |     await expect(code.locator('.output-html td').last()).toHaveCSS('text-align', 'left');
  36  |     await expect(code.locator('.output-html style')).toHaveCount(0);
  37  |     const measure = await page.evaluate(() => {
  38  |       const prose = document.querySelector('.cell-markdown p')!, editor = document.querySelector('.cell-editor')!;
  39  |       return { prose: prose.getBoundingClientRect().width, editor: editor.getBoundingClientRect().width,
  40  |         proseFont: getComputedStyle(prose).fontFamily, inlineFont: getComputedStyle(prose.querySelector('code')!).fontFamily,
  41  |         codeFont: getComputedStyle(document.querySelector('.view-lines')!).fontFamily,
  42  |         tableFont: getComputedStyle(document.querySelector('.output-html td')!).fontFamily };
  43  |     });
  44  |     expect(measure.prose).toBeLessThanOrEqual(640.5); expect(measure.prose).toBeLessThan(measure.editor * .75);
  45  |     expect(measure.proseFont).not.toContain('D2Coding'); expect(measure.tableFont).not.toContain('D2Coding');
  46  |     expect(measure.inlineFont).toContain('D2Coding'); expect(measure.codeFont).toContain('D2Coding');
  47  |     await expect(md).toHaveCSS('border-top-width', '0px');
  48  |     await page.mouse.move(1, 1);
  49  |     await expect(code.locator('.cell-toolbar')).toHaveCSS('opacity', '0');
  50  |     const before = await code.boundingBox();
  51  |     await code.hover(); await expect(code.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  52  |     expect(await code.boundingBox()).toEqual(before);
  53  |     const input = code.getByRole('textbox', { name: /Code cell editor/ });
  54  |     await input.focus(); await input.press('Control+Home');
  55  |     await expect(code.locator('.view-overlays .current-line')).toHaveCount(1);
  56  |     await expect(page.locator('[data-cell-id="use"] .view-overlays .current-line')).toHaveCount(0);
  57  |     await code.getByRole('button', { name: 'Select cell', exact: true }).click();
  58  |     await expect(code.locator('.view-overlays .current-line')).toHaveCount(0);
  59  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('text/plain');
  60  |     await expect(code.locator('.notebook-outputs pre')).toHaveText('Two-line 2.117');
  61  |     await expect(code.locator('.notebook-outputs pre')).toHaveCSS('font-family', /D2Coding/);
  62  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('');
  63  |     await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
  64  |     await code.getByRole('button', { name: 'Collapse cell output', exact: true }).click();
  65  |     await expect(code.locator('.notebook-outputs')).toHaveCount(0);
  66  |     await code.getByRole('button', { name: '▸ Show output', exact: true }).click();
  67  |     await expect(code.locator('.output-html table')).toBeVisible();
  68  |     // A keyboard path must reveal actions without needing hover or double-click.
  69  |     await md.getByRole('button', { name: 'Select cell', exact: true }).focus();
  70  |     await expect(md.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  71  |     await md.getByRole('button', { name: 'Edit', exact: true }).focus(); await page.keyboard.press('Enter');
  72  |     const markdownEditor = md.getByRole('textbox', { name: /Markdown cell editor/ });
  73  |     await markdownEditor.press('Control+End'); await page.keyboard.insertText('\n\n키보드 편집 유지');
  74  |     await markdownEditor.press('Escape'); await expect(md.locator('.cell-markdown')).toContainText('키보드 편집 유지');
  75  |     await page.keyboard.press('Control+s');
  76  |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  77  |     for (const theme of ['one-dark', 'github-light']) {
  78  |       await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme);
  79  |       await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim())).toBe(theme === 'one-dark' ? '#282c34' : '#ffffff');
  80  |       await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`reading-${theme}.png`) });
  81  |     }
  82  |     // Use a real group split: a narrow standalone window doesn't test pane-local sizing.
  83  |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  84  |     await expect(page.getByRole('tab', { name: /other.ipynb/ })).toHaveAttribute('aria-selected', 'true');
  85  |     const data = await page.evaluateHandle(() => new DataTransfer());
  86  |     await page.getByRole('tab', { name: /other.ipynb/ }).dispatchEvent('dragstart', { dataTransfer: data });
  87  |     const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
  88  |     const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
  89  |     await body.dispatchEvent('dragover', point); await expect(page.locator('.group-drop-overlay')).toBeVisible();
  90  |     await body.dispatchEvent('drop', point); await data.dispose();
  91  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  92  |     const group = page.locator('.editor-group').first();
  93  |     const toolbar = group.locator('.notebook-toolbar');
> 94  |     expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
      |                           ^ TimeoutError: locator.boundingBox: Timeout 30000ms exceeded.
  95  |     expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  96  |     await expect(toolbar.getByRole('button', { name: 'Outline', exact: true })).toBeHidden();
  97  |     await toolbar.getByRole('button', { name: 'Commands…', exact: true }).click();
  98  |     await group.getByRole('button', { name: 'Toggle outline', exact: true }).click();
  99  |     await expect(group.getByRole('navigation', { name: 'Notebook outline' })).toBeVisible();
  100 |     await expect(group.getByRole('combobox', { name: 'Python environment', exact: true })).toBeVisible();
  101 |     await page.screenshot({ path: test.info().outputPath('reading-split.png') });
  102 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  103 | });
  104 | 
  105 | test('notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion', async () => {
  106 |   test.setTimeout(90_000);
  107 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-config-'));
  108 |   const file = path.join(root, 'example.ipynb'), original = JSON.stringify(notebook(), null, 2) + '\n';
  109 |   await writeFile(file, original);
  110 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  111 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  112 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  113 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  114 |   try {
  115 |     const page = await application.firstWindow(); await focusApplication(application);
  116 |     page.on('pageerror', error => console.log('notebook renderer:', error));
  117 |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'notebook');
  118 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  119 |     await expect(page.locator('.cell-markdown h1')).toHaveText('Notebook');
  120 |     await expect(page.locator('.cell-markdown img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  121 |     await expect(page.locator('.cell-markdown math')).toHaveCount(1);
  122 |     await expect(page.locator('.notebook-outputs')).toContainText('Saved table');
  123 |     expect(await page.locator('.notebook-outputs script, .notebook-outputs iframe, .notebook-outputs svg, .notebook-outputs [style]').count()).toBe(0);
  124 |     expect(await page.evaluate(() => (window as unknown as { notebookInjected?: boolean }).notebookInjected)).toBeUndefined();
  125 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  126 |     await page.evaluate(() => {
  127 |       const state = { starts: 0 }; (window as any).notebookConnections = state;
  128 |       window.marktex.language.onEvent(event => { if (event.type === 'status' && event.state === 'starting') state.starts++; });
  129 |     });
  130 |     const markdown = page.locator('[data-cell-id="intro"]');
  131 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  132 |     const markdownEditor = markdown.getByRole('textbox', { name: /Markdown cell editor/ });
  133 |     await markdownEditor.press('Control+End'); await markdownEditor.press('Enter');
  134 |     await page.keyboard.insertText('Latest preview text');
  135 |     const cdp = await page.context().newCDPSession(page);
  136 |     await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  137 |     await markdownEditor.press('Escape');
  138 |     await expect(markdownEditor).toBeAttached();
  139 |     await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  140 |     await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  141 |     await cdp.send('Input.insertText', { text: '한' }); await cdp.detach();
  142 |     await markdownEditor.press('Escape');
  143 |     await expect(markdown.locator('.cell-markdown')).toContainText('Latest preview text한');
  144 |     // Restore the source using its retained text history before preservation assertions.
  145 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  146 |     await markdownEditor.press('Control+a'); await page.keyboard.insertText((notebook().cells[0].source as string[]).join(''));
  147 |     await markdownEditor.press('Escape');
  148 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
  149 |       .dragTo(markdown, { targetPosition: { x: 40, y: 5 } });
  150 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'use');
  151 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  152 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'intro');
  153 |     const cell = page.locator('[data-cell-id="use"]'), editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  154 |     const mountedEditor = await editor.elementHandle();
  155 |     await editor.press('Control+End'); await editor.press('Enter'); await editor.pressSequentially('numbers.');
  156 |     expect(await mountedEditor!.evaluate(element => element.isConnected)).toBe(true);
  157 |     await editor.press('Control+Space');
  158 |     await expect(page.locator('.suggest-widget.visible')).toContainText('append', { timeout: 10_000 });
  159 |     await editor.press('Escape'); await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(42)');
  160 |     await editor.press('Control+s');
  161 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(42)');
  162 |     const saved = JSON.parse(await readFile(file, 'utf8'));
  163 |     expect(saved.metadata).toEqual(notebook().metadata); expect(saved.cells[0]).toEqual(notebook().cells[0]);
  164 |     expect(saved.cells[1].outputs).toEqual(notebook().cells[1].outputs);
  165 |     await cell.getByRole('button', { name: 'Delete cell', exact: true }).click();
  166 |     await expect(page.locator('.notebook-cell')).toHaveCount(2);
  167 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  168 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  169 |     await expect(cell.locator('.view-lines')).toContainText('numbers.append(42)');
  170 |     // Cell text history is owned by the document, even when its view was deleted.
  171 |     await editor.press('Control+z'); await editor.press('Control+s');
  172 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toContain('numbers.');
  173 |     await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(7)');
  174 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F12');
  175 |     await expect(page.locator('[data-cell-id="define"] .monaco-editor')).toHaveClass(/focused/, { timeout: 10_000 });
  176 |     expect(await page.evaluate(() => (window as any).notebookConnections.starts)).toBe(0);
  177 |     await page.screenshot({ path: test.info().outputPath('notebook.png') });
  178 |     await page.keyboard.press('Control+s');
  179 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  180 | });
  181 | 
  182 | test('unsupported notebook versions remain read-only and byte-identical', async () => {
  183 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-invalid-')), config = path.join(root, 'config'), file = path.join(root, 'future.ipynb');
  184 |   const original = '{"nbformat": 9, "nbformat_minor": 0, "cells": [], "metadata": {"keep": 12345678901234567890}}';
  185 |   await writeFile(file, original);
  186 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  187 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  188 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  189 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  190 |   try {
  191 |     const page = await application.firstWindow();
  192 |     await expect(page.getByRole('alert')).toContainText('Only nbformat 4');
  193 |     await expect(page.getByRole('button', { name: '+ Code', exact: true })).toBeDisabled();
  194 |     expect(await readFile(file, 'utf8')).toBe(original);
```