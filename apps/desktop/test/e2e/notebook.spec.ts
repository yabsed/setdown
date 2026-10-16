import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { electron, disposeApplication, focusApplication } from './electron-app';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5N8AAAAASUVORK5CYII=';
const notebook = () => ({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' }, custom: { keep: 'unchanged' } }, cells: [
  { id: 'intro', cell_type: 'markdown', metadata: {}, source: ['# Notebook\n', 'A **Markdown** cell. $x^2$\n\n![pixel](attachment:pixel.png)'], attachments: { 'pixel.png': { 'image/png': png } } },
  { id: 'define', cell_type: 'code', metadata: {}, source: ['numbers = [1, 2, 3]\n'], execution_count: 1,
    outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<b>Saved table</b><script>window.notebookInjected=true</script><iframe src="https://example.com"></iframe><svg onload="window.notebookInjected=true"></svg><div style="position:fixed;inset:0">safe text</div>', 'application/custom+json': { keep: 123 } } }] },
  { id: 'use', cell_type: 'code', metadata: {}, source: 'numbers.append(4)', execution_count: null, outputs: [] },
] });

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
    await page.getByRole('button', { name: 'Python environment…', exact: true }).click();
    await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
    const cell = page.locator('[data-cell-id="use"]');
    await expect(cell.locator('.notebook-outputs')).toContainText('10', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await expect(cell.locator('.execution')).toHaveText('[2]');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].outputs[0]?.text).toContain('10');
    await page.getByRole('button', { name: 'Reset kernel', exact: true }).click();
    await expect(page.locator('.kernel-state')).toHaveText('stopped');
    await cell.getByRole('button', { name: 'Run cell', exact: true }).click();
    await expect(cell.locator('.notebook-outputs')).toContainText('NameError', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveText('idle');
    await page.keyboard.press('Control+s');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
