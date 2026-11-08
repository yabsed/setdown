import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { electron, disposeApplication, focusApplication } from '../../apps/desktop/test/support/electron/electron-app';

const cells = [
  { id: 'define', source: 'from typing import Literal\ndef choose(mode: Literal["fast", "safe"]) -> str:\n    return mode' },
  { id: 'invalid', source: 'print(choose("turbo"))' },
  { id: 'valid', source: 'print(choose("fast"))' },
];
for (const mode of ['default', 'basic'] as const) test(`real notebook Literal diagnostics and kernel execution: ${mode}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-vision-'));
  const file = path.join(root, 'literal.ipynb');
  const python = execFileSync('python3', ['-c', 'import sys, ipykernel; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' }, kernelspec: { name: 'python3', language: 'python', display_name: 'Python 3' } },
    cells: cells.map(cell => ({ ...cell, cell_type: 'code', metadata: {}, execution_count: null, outputs: [] })) };
  await writeFile(file, JSON.stringify(notebook));
  if (mode === 'basic') await writeFile(path.join(root, 'pyrightconfig.json'), JSON.stringify({ typeCheckingMode: 'basic' }));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  let log = '';
  app.process().stderr?.on('data', chunk => log += String(chunk));
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents, send = wc.send;
      (globalThis as any).__notebookProbeEvents = [];
      wc.send = function(channel: string, ...args: any[]) {
        if (channel === 'language:event') (globalThis as any).__notebookProbeEvents.push(args[0]);
        return send.call(this, channel, ...args);
      };
      BrowserWindow.getAllWindows()[0].setSize(1400, 1000);
    });
    await page.reload();
    await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
    const environments = page.getByRole('combobox', { name: 'Python environment', exact: true });
    await environments.selectOption(python);
    await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
    const diagnostics = () => app.evaluate(() => (globalThis as any).__notebookProbeEvents.filter((e: any) => e.type === 'diagnostics' && e.cell === 'invalid').at(-1));
    await expect.poll(diagnostics, { timeout: 30_000 }).toBeTruthy();
    if (mode === 'basic') {
      await expect.poll(async () => (await diagnostics())?.diagnostics.some((d: any) => d.code === 'reportArgumentType'), { timeout: 30_000 }).toBe(true);
      await expect(page.locator('[data-cell-id="invalid"] .squiggly-error')).toHaveCount(1);
    } else {
      expect((await diagnostics()).diagnostics).toEqual([]);
      await expect(page.locator('[data-cell-id="invalid"] .squiggly-error')).toHaveCount(0);
    }
    await expect(page.locator('[data-cell-id="valid"] .squiggly-error')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('before-execution.png') });
    const before = await diagnostics();
    await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
    await expect(page.locator('[data-cell-id="invalid"] .notebook-outputs')).toContainText('turbo', { timeout: 60_000 });
    await expect(page.locator('[data-cell-id="valid"] .notebook-outputs')).toContainText('fast', { timeout: 60_000 });
    await expect(page.locator('.kernel-state')).toHaveAttribute('aria-label', 'Kernel idle');
    await page.screenshot({ path: test.info().outputPath('after-execution.png') });
    let problemsText: string | undefined;
    if (mode === 'basic') {
      const plain = path.join(root, 'clean.py'); await writeFile(plain, 'pass\n');
      await page.evaluate(file => (window as any).marktex.openLink(`marktex-resource://file${file}`), plain);
      await expect.poll(() => app.evaluate(() => (globalThis as any).__notebookProbeEvents.some((e: any) =>
        e.type === 'diagnostics' && !e.cell && e.server === 'pyright')), { timeout: 30_000 }).toBe(true);
      const status = page.getByRole('button', { name: /Language status:/ });
      await status.click();
      await page.getByRole('dialog', { name: 'Current file language support' }).getByRole('button', { name: 'Problems', exact: true }).click();
      const problems = page.getByRole('dialog', { name: 'Problems · Open Files' });
      await expect(problems).toHaveAttribute('aria-busy', 'false');
      await expect(problems.locator('.result')).toHaveCount(0);
      problemsText = await problems.innerText();
      await page.screenshot({ path: test.info().outputPath('problems-omits-notebook.png') });
    }
    await writeFile(test.info().outputPath('observations.json'), JSON.stringify({ mode, python, notebook, diagnosticEvent: before,
      invalidCallExecuted: 'turbo', validCallExecuted: 'fast', problemsText,
      events: await app.evaluate(() => (globalThis as any).__notebookProbeEvents) }, null, 2));
  } finally {
    await writeFile(test.info().outputPath('electron.log'), log);
    await disposeApplication(app); await rm(root, { recursive: true, force: true });
  }
});
