# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook reading hierarchy keeps content, actions and focus distinct, including narrow split panes
- Location: test/e2e/notebook/notebook.spec.ts:16:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  locator('[data-notebook-tab="b67ae6f1-7a1c-49a7-8ec7-ac7ee80f65f4"]').locator('.notebook-toolbar').getByRole('button', { name: 'Outline', exact: true })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" locator('[data-notebook-tab="b67ae6f1-7a1c-49a7-8ec7-ac7ee80f65f4"]').locator('.notebook-toolbar').getByRole('button', { name: 'Outline', exact: true }) with timeout 5000ms
  - waiting for locator('[data-notebook-tab="b67ae6f1-7a1c-49a7-8ec7-ac7ee80f65f4"]').locator('.notebook-toolbar').getByRole('button', { name: 'Outline', exact: true })
    14 × locator resolved to <button aria-pressed="false" class="secondary-tool svelte-yxkx1d">Outline</button>
       - unexpected value "visible"

```

```yaml
- button "Outline"
```

# Test source

```ts
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
  35  |     await expect(code.locator('.output-html td').last()).toHaveCSS('text-align', 'right');
  36  |     await expect(code.locator('.output-html style')).toHaveCount(0);
  37  |     const measure = await page.evaluate(() => {
  38  |       const prose = document.querySelector('.cell-markdown p')!, editor = document.querySelector('.cell-editor')!;
  39  |       return { prose: prose.getBoundingClientRect().width, editor: editor.getBoundingClientRect().width,
  40  |         proseFont: getComputedStyle(prose).fontFamily, inlineFont: getComputedStyle(prose.querySelector('code')!).fontFamily,
  41  |         codeFont: getComputedStyle(document.querySelector('.view-lines')!).fontFamily,
  42  |         tableFont: getComputedStyle(document.querySelector('.output-html td')!).fontFamily };
  43  |     });
  44  |     expect(measure.prose).toBeGreaterThan(measure.editor * .95); expect(measure.prose).toBeLessThanOrEqual(measure.editor);
  45  |     expect(measure.proseFont).not.toContain('D2Coding'); expect(measure.tableFont).not.toContain('D2Coding');
  46  |     expect(measure.inlineFont).toBe(measure.codeFont); expect(measure.codeFont).toContain('monospace');
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
  59  |     await code.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  60  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('text/plain');
  61  |     await expect(code.locator('.notebook-outputs pre')).toHaveText('Two-line 2.117');
  62  |     await expect(code.locator('.notebook-outputs pre')).toHaveCSS('font-family', measure.codeFont);
  63  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('');
  64  |     await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
  65  |     await code.getByRole('combobox', { name: 'Output format' }).press('Escape');
  66  |     await code.getByRole('button', { name: 'More cell actions', exact: true }).click();
  67  |     await code.getByRole('button', { name: 'Collapse cell output', exact: true }).click();
  68  |     await expect(code.locator('.notebook-outputs')).toHaveCount(0);
  69  |     await code.getByRole('button', { name: '▸ Show output', exact: true }).click();
  70  |     await expect(code.locator('.output-html table')).toBeVisible();
  71  |     // A keyboard path must reveal actions without needing hover or double-click.
  72  |     await md.getByRole('button', { name: 'Select cell', exact: true }).focus();
  73  |     await expect(md.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  74  |     await md.getByRole('button', { name: 'Edit', exact: true }).focus(); await page.keyboard.press('Enter');
  75  |     const markdownEditor = md.getByRole('textbox', { name: /Markdown cell editor/ });
  76  |     await markdownEditor.press('Control+End'); await page.keyboard.insertText('\n\n키보드 편집 유지');
  77  |     await markdownEditor.press('Escape'); await expect(md.locator('.cell-markdown')).toContainText('키보드 편집 유지');
  78  |     await page.keyboard.press('Control+s');
  79  |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  80  |     for (const theme of ['one-dark', 'github-light']) {
  81  |       await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme);
  82  |       await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim())).toBe(theme === 'one-dark' ? '#282c34' : '#ffffff');
  83  |       await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`reading-${theme}.png`) });
  84  |     }
  85  |     // Use a real group split: a narrow standalone window doesn't test pane-local sizing.
  86  |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  87  |     await expect(page.getByRole('tab', { name: /other.ipynb/ })).toHaveAttribute('aria-selected', 'true');
  88  |     const data = await page.evaluateHandle(() => new DataTransfer());
  89  |     await page.getByRole('tab', { name: /other.ipynb/ }).dispatchEvent('dragstart', { dataTransfer: data });
  90  |     const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
  91  |     const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
  92  |     await body.dispatchEvent('dragover', point); await expect(page.locator('.group-drop-overlay')).toBeVisible();
  93  |     await body.dispatchEvent('drop', point); await data.dispose();
  94  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  95  |     // Notebook surfaces are retained siblings of the group chrome, keyed by tab.
  96  |     const tabId = await page.getByRole('tab', { name: /reading.ipynb/ }).getAttribute('data-tab-id');
  97  |     const surface = page.locator(`[data-notebook-tab="${tabId}"]`);
  98  |     await expect(page.locator('.notebook-content:not(.inactive)')).toHaveCount(2);
  99  |     expect((await surface.boundingBox())!.width).toBeLessThan(750);
  100 |     const toolbar = surface.locator('.notebook-toolbar');
  101 |     expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
  102 |     expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
> 103 |     await expect(toolbar.getByRole('button', { name: 'Outline', exact: true })).toBeHidden();
      |                                                                                 ^ Error: expect(locator).toBeHidden() failed
  104 |     await toolbar.getByRole('button', { name: 'Commands…', exact: true }).click();
  105 |     await surface.getByRole('button', { name: 'Toggle outline', exact: true }).click();
  106 |     await expect(surface.getByRole('navigation', { name: 'Notebook outline' })).toBeVisible();
  107 |     await expect(surface.getByRole('combobox', { name: 'Python environment', exact: true })).toBeVisible();
  108 |     await page.screenshot({ path: test.info().outputPath('reading-split.png') });
  109 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  110 | });
  111 | 
  112 | test('notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion', async () => {
  113 |   test.setTimeout(90_000);
  114 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-config-'));
  115 |   const file = path.join(root, 'example.ipynb'), original = JSON.stringify(notebook(), null, 2) + '\n';
  116 |   await writeFile(file, original);
  117 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  118 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  119 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  120 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  121 |   try {
  122 |     const page = await application.firstWindow(); await focusApplication(application);
  123 |     page.on('pageerror', error => console.log('notebook renderer:', error));
  124 |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'notebook');
  125 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  126 |     await expect(page.locator('.cell-markdown h1')).toHaveText('Notebook');
  127 |     await expect(page.locator('.cell-markdown img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  128 |     await expect(page.locator('.cell-markdown math')).toHaveCount(1);
  129 |     await expect(page.locator('.notebook-outputs')).toContainText('Saved table');
  130 |     expect(await page.locator('.notebook-outputs script, .notebook-outputs iframe, .notebook-outputs svg, .notebook-outputs [style]').count()).toBe(0);
  131 |     expect(await page.evaluate(() => (window as unknown as { notebookInjected?: boolean }).notebookInjected)).toBeUndefined();
  132 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  133 |     await page.evaluate(() => {
  134 |       const state = { starts: 0 }; (window as any).notebookConnections = state;
  135 |       window.marktex.language.onEvent(event => { if (event.type === 'status' && event.state === 'starting') state.starts++; });
  136 |     });
  137 |     const markdown = page.locator('[data-cell-id="intro"]');
  138 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  139 |     const markdownEditor = markdown.getByRole('textbox', { name: /Markdown cell editor/ });
  140 |     await markdownEditor.press('Control+End'); await markdownEditor.press('Enter');
  141 |     await page.keyboard.insertText('Latest preview text');
  142 |     const cdp = await page.context().newCDPSession(page);
  143 |     await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  144 |     await markdownEditor.press('Escape');
  145 |     await expect(markdownEditor).toBeAttached();
  146 |     await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  147 |     await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  148 |     await cdp.send('Input.insertText', { text: '한' }); await cdp.detach();
  149 |     await markdownEditor.press('Escape');
  150 |     await expect(markdown.locator('.cell-markdown')).toContainText('Latest preview text한');
  151 |     // Restore the source using its retained text history before preservation assertions.
  152 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  153 |     await markdownEditor.press('Control+a'); await page.keyboard.insertText((notebook().cells[0].source as string[]).join(''));
  154 |     await markdownEditor.press('Escape');
  155 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
  156 |       .dragTo(markdown, { targetPosition: { x: 40, y: 5 } });
  157 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'use');
  158 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  159 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'intro');
  160 |     const cell = page.locator('[data-cell-id="use"]'), editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  161 |     const mountedEditor = await editor.elementHandle();
  162 |     await editor.press('Control+End'); await editor.press('Enter'); await editor.pressSequentially('numbers.');
  163 |     expect(await mountedEditor!.evaluate(element => element.isConnected)).toBe(true);
  164 |     await editor.press('Control+Space');
  165 |     await expect(page.locator('.suggest-widget.visible')).toContainText('append', { timeout: 10_000 });
  166 |     await editor.press('Escape'); await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(42)');
  167 |     await editor.press('Control+s');
  168 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(42)');
  169 |     const saved = JSON.parse(await readFile(file, 'utf8'));
  170 |     expect(saved.metadata).toEqual(notebook().metadata); expect(saved.cells[0]).toEqual(notebook().cells[0]);
  171 |     expect(saved.cells[1].outputs).toEqual(notebook().cells[1].outputs);
  172 |     await cell.getByRole('button', { name: 'Delete cell', exact: true }).click();
  173 |     await expect(page.locator('.notebook-cell')).toHaveCount(2);
  174 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  175 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  176 |     await expect(cell.locator('.view-lines')).toContainText('numbers.append(42)');
  177 |     // Cell text history is owned by the document, even when its view was deleted.
  178 |     await editor.press('Control+z'); await editor.press('Control+s');
  179 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toContain('numbers.');
  180 |     await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(7)');
  181 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F12');
  182 |     await expect(page.locator('[data-cell-id="define"] .monaco-editor')).toHaveClass(/focused/, { timeout: 10_000 });
  183 |     expect(await page.evaluate(() => (window as any).notebookConnections.starts)).toBe(0);
  184 |     await page.screenshot({ path: test.info().outputPath('notebook.png') });
  185 |     await page.keyboard.press('Control+s');
  186 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  187 | });
  188 | 
  189 | test('unsupported notebook versions remain read-only and byte-identical', async () => {
  190 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-invalid-')), config = path.join(root, 'config'), file = path.join(root, 'future.ipynb');
  191 |   const original = '{"nbformat": 9, "nbformat_minor": 0, "cells": [], "metadata": {"keep": 12345678901234567890}}';
  192 |   await writeFile(file, original);
  193 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  194 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  195 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  196 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  197 |   try {
  198 |     const page = await application.firstWindow();
  199 |     await expect(page.getByRole('alert')).toContainText('Only nbformat 4');
  200 |     await expect(page.getByRole('button', { name: '+ Code', exact: true })).toBeDisabled();
  201 |     expect(await readFile(file, 'utf8')).toBe(original);
  202 |     expect(await page.locator('.notebook-cell').count()).toBe(0);
  203 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
```