import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5N8AAAAASUVORK5CYII=';
const notebook = () => ({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' }, custom: { keep: 'unchanged' } }, cells: [
  { id: 'intro', cell_type: 'markdown', metadata: {}, source: ['# Notebook\n', 'A **Markdown** cell. $x^2$\n\n![pixel](attachment:pixel.png)'], attachments: { 'pixel.png': { 'image/png': png } } },
  { id: 'define', cell_type: 'code', metadata: {}, source: ['numbers = [1, 2, 3]\n'], execution_count: 1,
    outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<b>Saved table</b><script>window.notebookInjected=true</script><iframe src="https://example.com"></iframe><svg onload="window.notebookInjected=true"></svg><div style="position:fixed;inset:0">safe text</div>', 'application/custom+json': { keep: 123 } } }] },
  { id: 'use', cell_type: 'code', metadata: {}, source: 'numbers.append(4)', execution_count: null, outputs: [] },
] });

test('notebook reading hierarchy keeps content, actions and focus distinct, including narrow split panes', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-reading-'));
  const file = path.join(root, 'reading.ipynb'), other = path.join(root, 'other.ipynb');
  const value = notebook();
  value.cells[0].source = ['## 출력에 남기는 오류 정보\n\n' + '오류는 고정된 분류와 건수로 요약한다. 상세 원인은 내부 오류 파일에서 확인한다. '.repeat(4) + '`numbers`는 코드에 정의된 값이다.'];
  value.cells[1].source = ['# A readable comment\nnumbers = [1, 2, 3]\n'];
  value.cells[1].outputs = [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: {
    'text/plain': 'Two-line 2.117', 'text/html': '<style>table{position:fixed}</style><table class="dataframe"><thead><tr><th>Model</th><th>Test RMSE</th><th>Note</th></tr></thead><tbody><tr><th>Two-line</th><td>2.117</td><td>other_error</td></tr></tbody></table>',
  } }] as any;
  await writeFile(file, JSON.stringify(value)); await writeFile(other, JSON.stringify(notebook()));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    const md = page.locator('[data-cell-id="intro"]'), code = page.locator('[data-cell-id="define"]');
    await expect(md.locator('.cell-markdown h2')).toHaveText('출력에 남기는 오류 정보');
    await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
    await expect(code.locator('.output-html td').last()).toHaveCSS('text-align', 'left');
    await expect(code.locator('.output-html style')).toHaveCount(0);
    const measure = await page.evaluate(() => {
      const prose = document.querySelector('.cell-markdown p')!, editor = document.querySelector('.cell-editor')!;
      return { prose: prose.getBoundingClientRect().width, editor: editor.getBoundingClientRect().width,
        proseFont: getComputedStyle(prose).fontFamily, inlineFont: getComputedStyle(prose.querySelector('code')!).fontFamily,
        codeFont: getComputedStyle(document.querySelector('.view-lines')!).fontFamily,
        tableFont: getComputedStyle(document.querySelector('.output-html td')!).fontFamily };
    });
    expect(measure.prose).toBeLessThanOrEqual(640.5); expect(measure.prose).toBeLessThan(measure.editor * .75);
    expect(measure.proseFont).not.toContain('D2Coding'); expect(measure.tableFont).not.toContain('D2Coding');
    expect(measure.inlineFont).toContain('D2Coding'); expect(measure.codeFont).toContain('D2Coding');
    await expect(md).toHaveCSS('border-top-width', '0px');
    await page.mouse.move(1, 1);
    await expect(code.locator('.cell-toolbar')).toHaveCSS('opacity', '0');
    const before = await code.boundingBox();
    await code.hover(); await expect(code.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
    expect(await code.boundingBox()).toEqual(before);
    const input = code.getByRole('textbox', { name: /Code cell editor/ });
    await input.focus(); await input.press('Control+Home');
    await expect(code.locator('.view-overlays .current-line')).toHaveCount(1);
    await expect(page.locator('[data-cell-id="use"] .view-overlays .current-line')).toHaveCount(0);
    await code.getByRole('button', { name: 'Select cell', exact: true }).click();
    await expect(code.locator('.view-overlays .current-line')).toHaveCount(0);
    await code.getByRole('combobox', { name: 'Output format' }).selectOption('text/plain');
    await expect(code.locator('.notebook-outputs pre')).toHaveText('Two-line 2.117');
    await expect(code.locator('.notebook-outputs pre')).toHaveCSS('font-family', /D2Coding/);
    await code.getByRole('combobox', { name: 'Output format' }).selectOption('');
    await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
    await code.getByRole('button', { name: 'Collapse cell output', exact: true }).click();
    await expect(code.locator('.notebook-outputs')).toHaveCount(0);
    await code.getByRole('button', { name: '▸ Show output', exact: true }).click();
    await expect(code.locator('.output-html table')).toBeVisible();
    // A keyboard path must reveal actions without needing hover or double-click.
    await md.getByRole('button', { name: 'Select cell', exact: true }).focus();
    await expect(md.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
    await md.getByRole('button', { name: 'Edit', exact: true }).focus(); await page.keyboard.press('Enter');
    const markdownEditor = md.getByRole('textbox', { name: /Markdown cell editor/ });
    await markdownEditor.press('Control+End'); await page.keyboard.insertText('\n\n키보드 편집 유지');
    await markdownEditor.press('Escape'); await expect(md.locator('.cell-markdown')).toContainText('키보드 편집 유지');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
    for (const theme of ['one-dark', 'github-light']) {
      await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim())).toBe(theme === 'one-dark' ? '#282c34' : '#ffffff');
      await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`reading-${theme}.png`) });
    }
    // Use a real group split: a narrow standalone window doesn't test pane-local sizing.
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
    await expect(page.getByRole('tab', { name: /other.ipynb/ })).toHaveAttribute('aria-selected', 'true');
    const data = await page.evaluateHandle(() => new DataTransfer());
    await page.getByRole('tab', { name: /other.ipynb/ }).dispatchEvent('dragstart', { dataTransfer: data });
    const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
    const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
    await body.dispatchEvent('dragover', point); await expect(page.locator('.group-drop-overlay')).toBeVisible();
    await body.dispatchEvent('drop', point); await data.dispose();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    // Notebook surfaces are retained siblings of the group chrome, keyed by tab.
    const tabId = await page.getByRole('tab', { name: /reading.ipynb/ }).getAttribute('data-tab-id');
    const surface = page.locator(`[data-notebook-tab="${tabId}"]`);
    await expect(page.locator('.notebook-content:not(.inactive)')).toHaveCount(2);
    expect((await surface.boundingBox())!.width).toBeLessThan(750);
    const toolbar = surface.locator('.notebook-toolbar');
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
    expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(toolbar.getByRole('button', { name: 'Outline', exact: true })).toBeHidden();
    await toolbar.getByRole('button', { name: 'Commands…', exact: true }).click();
    await surface.getByRole('button', { name: 'Toggle outline', exact: true }).click();
    await expect(surface.getByRole('navigation', { name: 'Notebook outline' })).toBeVisible();
    await expect(surface.getByRole('combobox', { name: 'Python environment', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('reading-split.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-config-'));
  const file = path.join(root, 'example.ipynb'), original = JSON.stringify(notebook(), null, 2) + '\n';
  await writeFile(file, original);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    page.on('pageerror', error => console.log('notebook renderer:', error));
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'notebook');
    await expect(page.locator('.notebook-cell')).toHaveCount(3);
    await expect(page.locator('.cell-markdown h1')).toHaveText('Notebook');
    await expect(page.locator('.cell-markdown img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.locator('.cell-markdown math')).toHaveCount(1);
    await expect(page.locator('.notebook-outputs')).toContainText('Saved table');
    expect(await page.locator('.notebook-outputs script, .notebook-outputs iframe, .notebook-outputs svg, .notebook-outputs [style]').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { notebookInjected?: boolean }).notebookInjected)).toBeUndefined();
    await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
    await page.evaluate(() => {
      const state = { starts: 0 }; (window as any).notebookConnections = state;
      window.marktex.language.onEvent(event => { if (event.type === 'status' && event.state === 'starting') state.starts++; });
    });
    const markdown = page.locator('[data-cell-id="intro"]');
    await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
    const markdownEditor = markdown.getByRole('textbox', { name: /Markdown cell editor/ });
    await markdownEditor.press('Control+End'); await markdownEditor.press('Enter');
    await page.keyboard.insertText('Latest preview text');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
    await markdownEditor.press('Escape');
    await expect(markdownEditor).toBeAttached();
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: '한' }); await cdp.detach();
    await markdownEditor.press('Escape');
    await expect(markdown.locator('.cell-markdown')).toContainText('Latest preview text한');
    // Restore the source using its retained text history before preservation assertions.
    await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
    await markdownEditor.press('Control+a'); await page.keyboard.insertText((notebook().cells[0].source as string[]).join(''));
    await markdownEditor.press('Escape');
    await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
      .dragTo(markdown, { targetPosition: { x: 40, y: 5 } });
    await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'use');
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
    await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'intro');
    const cell = page.locator('[data-cell-id="use"]'), editor = cell.getByRole('textbox', { name: /Code cell editor/ });
    const mountedEditor = await editor.elementHandle();
    await editor.press('Control+End'); await editor.press('Enter'); await editor.pressSequentially('numbers.');
    expect(await mountedEditor!.evaluate(element => element.isConnected)).toBe(true);
    await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('append', { timeout: 10_000 });
    await editor.press('Escape'); await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(42)');
    await editor.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(42)');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.metadata).toEqual(notebook().metadata); expect(saved.cells[0]).toEqual(notebook().cells[0]);
    expect(saved.cells[1].outputs).toEqual(notebook().cells[1].outputs);
    await cell.getByRole('button', { name: 'Delete cell', exact: true }).click();
    await expect(page.locator('.notebook-cell')).toHaveCount(2);
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
    await expect(page.locator('.notebook-cell')).toHaveCount(3);
    await expect(cell.locator('.view-lines')).toContainText('numbers.append(42)');
    // Cell text history is owned by the document, even when its view was deleted.
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toContain('numbers.');
    await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(7)');
    await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F12');
    await expect(page.locator('[data-cell-id="define"] .monaco-editor')).toHaveClass(/focused/, { timeout: 10_000 });
    expect(await page.evaluate(() => (window as any).notebookConnections.starts)).toBe(0);
    await page.screenshot({ path: test.info().outputPath('notebook.png') });
    await page.keyboard.press('Control+s');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('unsupported notebook versions remain read-only and byte-identical', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-invalid-')), config = path.join(root, 'config'), file = path.join(root, 'future.ipynb');
  const original = '{"nbformat": 9, "nbformat_minor": 0, "cells": [], "metadata": {"keep": 12345678901234567890}}';
  await writeFile(file, original);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('alert')).toContainText('Only nbformat 4');
    await expect(page.getByRole('button', { name: '+ Code', exact: true })).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await page.locator('.notebook-cell').count()).toBe(0);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('long cells grow with their contents and scroll only the notebook, including keyboard navigation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-scroll-')), file = path.join(root, 'long.ipynb');
  const lines = Array.from({ length: 120 }, (_, i) => `value_${i} = ${i}`);
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'long', cell_type: 'code', metadata: {}, source: lines.join('\n'), outputs: [], execution_count: null },
    { id: 'next', cell_type: 'markdown', metadata: {}, source: '# Next cell' },
  ] }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const cell = page.locator('[data-cell-id="long"]'), host = cell.locator('.cell-editor'), scroll = page.locator('.notebook-scroll');
    const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
    await expect(editor).toBeAttached();
    await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
    expect(await cell.locator('.editor-viewport').evaluate(node => node.clientHeight)).toBeLessThanOrEqual(await scroll.evaluate(node => node.clientHeight));
    expect(await cell.locator('.view-line').count()).toBeLessThan(80);
    const bounds = await host.boundingBox(); if (!bounds) throw Error('Missing cell bounds');
    await page.mouse.move(bounds.x + 150, bounds.y + 80); await page.mouse.wheel(0, 450);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    // Focus without Playwright scrolling the entire oversized textbox into view.
    await editor.focus(); await page.keyboard.press('Control+End');
    await expect(cell.locator('.view-line').filter({ hasText: 'value_119 = 119' })).toBeInViewport();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
    await page.keyboard.press('Control+Home');
    await expect(cell.locator('.view-line').filter({ hasText: /^value_0\s*=\s*0$/ })).toBeInViewport();
    // Removing content shrinks the cell; restoring it grows it again without a cap.
    // Delete the selection as one edit (typing quotes would create Monaco's own
    // auto-closing undo boundaries, unrelated to content-size restoration).
    await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
    await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeLessThan(150);
    await page.keyboard.press('Control+z');
    await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[0].source).toBe(lines.join('\n'));
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

for (const appZoom of [100, 130, 90]) test(`long notebook cells meet the scroll viewport without a blank strip at ${appZoom}% app zoom`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-sticky-')), file = path.join(root, 'sticky.ipynb');
  const source = Array.from({ length: 140 }, (_, index) => `value_${index} = ${index}`).join('\n');
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'heading', cell_type: 'markdown', metadata: {}, source: '### Tiles\n\nSection heading.' },
    { id: 'long', cell_type: 'code', metadata: {}, source, outputs: [], execution_count: null },
    { id: 'end', cell_type: 'markdown', metadata: {}, source: '## End\n\nAfter the long cell.' },
  ] }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1041, 801));
    await page.evaluate(steps => window.marktex.changeZoom(steps, 'app'), (appZoom - 100) / 10);
    await expect.poll(() => page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(appZoom);
    const scroll = page.locator('.notebook-scroll'), cell = page.locator('[data-cell-id="long"]');
    await expect(page.locator('[data-cell-id="heading"] h3')).toHaveText('Tiles');
    await expect.poll(() => cell.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(2500);
    const initial = await page.evaluate(() => {
      const scroll = document.querySelector('.notebook-scroll')!, heading = document.querySelector('[data-cell-id="heading"]')!;
      const frame = document.querySelector('[data-cell-id="long"] .cell-editor')!, line = frame.querySelector('.view-line')!;
      return { startGap: heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
        lineInset: line.getBoundingClientRect().top - frame.getBoundingClientRect().top };
    });
    expect(initial.startGap).toBeCloseTo(30, 0);
    const geometry = () => page.evaluate(lineInset => {
      const scroll = document.querySelector('.notebook-scroll')!.getBoundingClientRect();
      const frame = document.querySelector('[data-cell-id="long"] .cell-editor')!.getBoundingClientRect();
      const editor = document.querySelector('[data-cell-id="long"] .editor-viewport')!.getBoundingClientRect();
      const line = [...document.querySelectorAll('[data-cell-id="long"] .view-line')]
        .find(node => node.getBoundingClientRect().top >= scroll.top && node.getBoundingClientRect().bottom <= scroll.bottom);
      const rect = line?.getBoundingClientRect(), index = Number(/value_(\d+)/.exec(line?.textContent ?? '')?.[1]);
      // A zoomed DOMRect height is pixel-quantized; multiplying that rounding by
      // the line index invents drift. Monaco lays out lines in logical CSS pixels.
      const lineHeight = line ? parseFloat(getComputedStyle(line).lineHeight) : 0;
      return { gap: editor.top - scroll.top, bottomGap: editor.bottom - scroll.bottom, endGap: frame.bottom - editor.bottom,
        lineError: rect ? rect.top - (frame.top + lineInset + index * lineHeight) : Infinity, line: line?.textContent };
    }, initial.lineInset);
    for (const offset of [1100, 1257, 900]) {
      await scroll.evaluate((node, offset) => node.scrollTop = offset, offset);
      await expect(page.locator('.notebook-sticky')).toHaveText('Tiles');
      await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThan(1);
      await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThan(1);
      await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
    }
    await writeFile(test.info().outputPath('sticky-geometry.json'), JSON.stringify({ appZoom, initial, scrolled: await geometry() }, null, 2));
    await page.screenshot({ path: test.info().outputPath('sticky-scroll.png') });
    // The editor also follows a resized viewport while still inside the long cell.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(941, 701));
    await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
    await scroll.evaluate(node => {
      const frame = node.querySelector('[data-cell-id="long"] .cell-editor')!;
      node.scrollTop += frame.getBoundingClientRect().bottom - node.getBoundingClientRect().top - 100;
    });
    await expect.poll(async () => Math.abs((await geometry()).endGap)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
    await expect(cell.locator('.view-line').filter({ hasText: /^value_139\s*=\s*139$/ })).toBeInViewport();
    await scroll.evaluate(node => node.scrollTop = 0);
    await expect(page.locator('.notebook-sticky')).toHaveCount(0);
    await expect.poll(() => page.locator('[data-cell-id="heading"]').evaluate(node =>
      node.getBoundingClientRect().top - node.closest('.notebook-scroll')!.getBoundingClientRect().top)).toBeCloseTo(30, 0);
    expect(JSON.parse(await readFile(file, 'utf8')).cells[1].source).toBe(source);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('Python cells run in one kernel, persist results, and reset discards variables', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-run-')), file = path.join(root, 'run.ipynb');
  const value = notebook(); value.cells[2].source = 'numbers.append(4)\nprint(sum(numbers))';
  await writeFile(file, JSON.stringify(value));
  const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON
    ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.kernel-state')).toHaveText('stopped');
    await application.evaluate(({ dialog }, python) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] });
    }, python);
    await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
    await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
    const cell = page.locator('[data-cell-id="use"]');
    await expect(cell.locator('.notebook-outputs')).toContainText('10', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await expect(cell.locator('.execution')).toHaveText('[2]');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].outputs[0]?.text).toContain('10');
    await cell.getByRole('button', { name: 'Copy cell output', exact: true }).click();
    await expect(cell.locator('.output-feedback[role="status"]')).toHaveText('Copied');
    await expect(cell.locator('.output-feedback[role="status"]')).toBeVisible();
    expect((await application.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('10');
    // Cancel before window closing starts: variables must survive the canceled quit.
    await application.evaluate(({ app }) => { app.once('before-quit', event => event.preventDefault()); app.quit(); });
    const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
    await editor.press('Control+a'); await page.keyboard.insertText('import time\ntime.sleep(0.5)\nnumbers.append(4)\nprint(sum(numbers))');
    await editor.press('Shift+Enter');
    await expect(page.locator('.notebook-cell')).toHaveCount(4);
    const next = page.locator('.notebook-cell').nth(3);
    await expect(next.locator('.monaco-editor')).toHaveClass(/focused/);
    await page.keyboard.insertText('print(sum(numbers))'); await page.keyboard.press('Alt+Enter');
    await expect(page.locator('.notebook-cell')).toHaveCount(5);
    await expect(next.locator('.notebook-outputs')).toContainText('14', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');

    await page.getByRole('button', { name: 'Reset kernel', exact: true }).click();
    await expect(page.locator('.kernel-state')).toHaveText('stopped');
    await cell.getByRole('button', { name: 'Run cell', exact: true }).click();
    await expect(cell.locator('.notebook-outputs')).toContainText('NameError', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await page.keyboard.press('Control+s');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('native notebook analysis uses lightweight diagnostics with IPython and isolated cell ranges', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-analysis-')), file = path.join(root, 'analysis.ipynb');
  const sources = ['%who\nimport math\nimport asyncio\nimport only_a', 'await asyncio.sleep(0)\nprint(math.sqrt(9), only_a.VALUE)\ndisplay(1)\nget_ipython()', 'count: int = "wrong"'];
  const pythonA = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const pythonB = path.join(root, 'env-b', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  for (const name of ['.venv', 'env-b']) execFileSync(process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? 'python3', ['-m', 'venv', '--without-pip', '--system-site-packages', path.join(root, name)]);
  const packages = execFileSync(pythonA, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { encoding: 'utf8' }).trim();
  await mkdir(packages, { recursive: true }); await writeFile(path.join(packages, 'only_a.py'), 'VALUE = 42\n');
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: sources.map((source, i) => ({ id: `cell${i}`, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] })) }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
    await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption(pythonA);
    await page.evaluate(async ({ file, sources, pythonA, pythonB }) => {
      const api = (window as any).marktex.language;
      const state = (window as any).notebookAnalysis = { diagnostics: {} as Record<string, any>, connection: null, other: undefined };
      api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-other') state.other = event.diagnostics; });
      api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-probe') state.diagnostics[`${event.version}:${event.cell}`] = event; });
      state.connection = await api.open({ id: 'analysis-probe', generation: 'probe', path: file, python: pythonA, notebook: 'python', text: '', version: 1,
        cells: sources.map((text: string, i: number) => ({ id: `cell${i}`, version: 1, text })) });
      await api.open({ id: 'analysis-other', generation: 'other', path: file, python: pythonB, notebook: 'python', text: '', version: 1,
        cells: [{ id: 'only', version: 1, text: 'import only_a' }] });
    }, { file, sources, pythonA, pythonB });
    await expect.poll(() => page.evaluate(() => (window as any).notebookAnalysis.other?.some((d: any) => d.code === 'reportMissingImports')), { timeout: 30_000 }).toBe(true);
    const diagnostics = (version: number, id: string) => page.evaluate(({ version, id }) => (window as any).notebookAnalysis.diagnostics[`${version}:${id}`]?.diagnostics, { version, id });
    await expect.poll(() => diagnostics(1, 'cell0'), { timeout: 30_000 }).toEqual([]);
    await expect.poll(() => diagnostics(1, 'cell1'), { timeout: 30_000 }).toEqual([]);
    await expect.poll(() => diagnostics(1, 'cell2'), { timeout: 30_000 }).toEqual([]);
    await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 2, [
      { id: 'cell0', version: 2, text: 'values = [' }, { id: 'cell1', version: 2, text: 'print(missing_name)' }, { id: 'cell2', version: 2, text: 'count: int = 1' },
    ]); });
    await expect.poll(async () => (await diagnostics(2, 'cell0'))?.some((d: any) => d.severity === 1), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await diagnostics(2, 'cell1'))?.some((d: any) => d.code === 'reportUndefinedVariable' && d.severity === 2), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => diagnostics(2, 'cell2'), { timeout: 30_000 }).toEqual([]);
    await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 3, [
      { id: 'cell2', version: 3, text: 'numbers = [1, 2]' }, { id: 'cell1', version: 3, text: 'print(sum(numbers))' },
    ]); });
    await expect.poll(() => diagnostics(3, 'cell1'), { timeout: 30_000 }).toEqual([]);
    await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
    await expect(page.locator('[data-cell-id="cell1"] .notebook-outputs')).toContainText('42', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await page.evaluate(() => { (window as any).marktex.language.close('analysis-probe'); (window as any).marktex.language.close('analysis-other'); });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('scrolling preserves focused editors and measured output height; cell copy and reader search keep their scope', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-layout-')), file = path.join(root, 'layout.ipynb');
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Searchable heading\n\nUnique reader text.' },
    ...Array.from({ length: 35 }, (_, i) => ({ id: `code-${i}`, cell_type: 'code', metadata: { keep: i }, source: `value_${i} = ${i}`, execution_count: null,
      outputs: i ? [] : [{ output_type: 'stream', name: 'stdout', text: Array.from({ length: 100 }, (_, j) => `output ${j}`).join('\n') }] })),
  ] }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const first = page.locator('[data-cell-id="code-0"]'), editor = first.getByRole('textbox', { name: /Code cell editor/ }), scroll = page.locator('.notebook-scroll');
    await expect(first.locator('.notebook-outputs')).toContainText('output 99');
    await editor.focus(); const mounted = await editor.elementHandle();
    const ime = await page.context().newCDPSession(page);
    await ime.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
    const height = await first.evaluate(node => node.getBoundingClientRect().height);
    await scroll.evaluate(node => node.scrollTop = 3500);
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(3000);
    expect(await mounted!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
    expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
    await ime.send('Input.insertText', { text: '한' }); await ime.detach();
    await expect(first.locator('.view-lines')).toContainText('한');
    await page.locator('[data-cell-id="code-20"]').getByRole('button', { name: 'Select cell', exact: true }).click();
    await expect(first.locator('.monaco-editor')).toHaveCount(0);
    await expect(first.locator('.notebook-outputs')).toHaveCount(0);
    expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await expect(page.locator('.notebook-cell')).toHaveCount(37);
    await page.keyboard.press('Control+z'); await expect(page.locator('.notebook-cell')).toHaveCount(36);
    await page.keyboard.press('Control+f');
    const find = page.getByRole('textbox', { name: 'Find in notebook', exact: true });
    await find.fill('Unique reader'); await find.pressSequentially(' text');
    await expect(find).toHaveValue('Unique reader text');
    await find.press('Enter');
    await expect(find).toBeFocused();
    await writeFile(test.info().outputPath('search-geometry.json'), JSON.stringify(await page.evaluate(() => { const reader = document.querySelector('[data-cell-id="intro"] .cell-markdown')!; const scroll = document.querySelector('.notebook-scroll')!; return { reader: reader.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON(), top: scroll.scrollTop, window: { x: window.scrollX, y: window.scrollY }, search: document.querySelector('.notebook-search')?.textContent, value: (document.querySelector('.notebook-search input') as HTMLInputElement)?.value }; })));
    await expect(page.locator('[data-cell-id="intro"] .cell-markdown')).toBeInViewport();
    await expect(page.locator('[data-cell-id="intro"] .cell-editor')).toHaveCount(0);
    await expect(page.locator('.notebook-search')).toContainText('1/1');
    await page.screenshot({ path: test.info().outputPath('notebook-reform.png') });
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+s');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('notebook convenience commands preserve data through replace, split, clear and image export', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-tools-ui-')), file = path.join(root, 'convenience.ipynb');
  const value = notebook();
  value.cells[1].outputs = [{ output_type: 'display_data', metadata: {}, data: { 'image/png': png, 'text/plain': 'image-search-target' } }] as any;
  await writeFile(file, JSON.stringify(value));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
    await expect(page.locator('.notebook-cell')).toHaveCount(3);
    const command = async (label: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name: label, exact: true }).click(); };
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Notebook outline' })).toContainText('Notebook');
    await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeHidden();
    await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeVisible();
    await page.getByRole('button', { name: 'View full size' }).click(); await expect(page.getByRole('dialog', { name: 'Notebook image viewer' })).toBeVisible();
    await page.getByRole('button', { name: 'Close image', exact: true }).click();
    const imageFile = path.join(root, 'image.png');
    await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, imageFile);
    await page.getByRole('button', { name: 'Save image…', exact: true }).click();
    await expect.poll(async () => readFile(imageFile).then(data => data.toString('base64'), () => '')).toBe(png);
    await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Select cell', exact: true }).click(); await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('numbers');
    await page.getByRole('textbox', { name: 'Replace in notebook', exact: true }).fill('values');
    await page.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(page.locator('.notebook-notice')).toContainText('Replaced source matches'); await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('values.append(4)');
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(4)');
    await page.getByRole('combobox', { name: 'Notebook search scope' }).selectOption('outputs');
    await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('image-search-target');
    await page.getByRole('button', { name: 'Next notebook match' }).click(); await expect(page.locator('.search-snippet')).toContainText('image-search-target');
    await page.getByRole('button', { name: 'Close notebook search' }).click();
    const editor = page.locator('[data-cell-id="define"]').getByRole('textbox', { name: /Code cell editor/ });
    await editor.press('Control+Home'); await editor.press('ArrowRight');
    await command('Split cell at cursor'); await expect(page.locator('.notebook-cell')).toHaveCount(4);
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-cell')).toHaveCount(3);
    await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F2');
    await page.getByRole('textbox', { name: 'New symbol name' }).fill('renamed_numbers');
    await page.getByRole('button', { name: 'Rename across cells', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'New symbol name' })).toBeHidden(); await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('renamed_numbers.append(4)');
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
    await command('Clear all outputs'); await expect(page.locator('.notebook-outputs')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-outputs img')).toBeVisible();
    await page.keyboard.press('Control+s');
    expect(JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
    expect(errors).toEqual([]); await page.screenshot({ path: test.info().outputPath('notebook-convenience.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('notebook stdin, variables and restart-all use the live kernel with scoped state', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-variables-')), file = path.join(root, 'variables.ipynb');
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
    { id: 'input', cell_type: 'code', metadata: {}, source: 'answer = input("Name: ")\nitems = list(range(250))\nprint(answer)', execution_count: null, outputs: [] },
    { id: 'use', cell_type: 'code', metadata: {}, source: 'print(len(items))', execution_count: null, outputs: [] },
  ] }));
  const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await application.evaluate(({ dialog }, python) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] }); }, python);
    await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
    await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
    await page.getByRole('textbox', { name: 'Kernel input' }).fill('한글'); await page.getByRole('button', { name: 'Send input' }).click();
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await expect(page.locator('[data-cell-id="use"] .notebook-outputs')).toContainText('250');
    await page.getByRole('button', { name: 'Variables', exact: true }).click();
    const variables = page.getByRole('region', { name: 'Notebook variables' });
    await variables.getByRole('button', { name: 'items', exact: true }).click(); await expect(variables).toContainText('1–100 of 250');
    await variables.getByRole('button', { name: 'Next 100' }).click(); await expect(variables).toContainText('101–200 of 250');
    await variables.getByRole('button', { name: 'All variables' }).click(); await expect(variables.getByRole('button', { name: 'answer', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('button', { name: 'Restart kernel and run all', exact: true }).click();
    await expect(variables).toContainText('Variables are available when the local kernel is idle.');
    await page.getByRole('textbox', { name: 'Kernel input' }).fill('restart'); await page.getByRole('button', { name: 'Send input' }).click();
    await expect(page.locator('.kernel-state')).toHaveText('idle'); await expect(variables.getByRole('button', { name: 'items', exact: true })).toBeVisible();
    await expect(page.locator('[data-cell-id="use"] .execution')).toHaveText('[2]'); await page.keyboard.press('Control+s');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
