import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../apps/desktop');
const require = createRequire(path.join(appDir, 'package.json'));
const { _electron, expect } = require('@playwright/test');
const corpus = process.argv[2];
if (!corpus || process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Use the isolated-display wrapper and supply the corpus directory.');
const files = (await readdir(corpus)).filter(x => x.endsWith('.ipynb')).sort();
const results = [];
for (const name of files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-corpus-audit-'));
  const file = path.join(root, name), original = await readFile(path.join(corpus, name), 'utf8');
  await copyFile(path.join(corpus, name), file);
  const notebook = JSON.parse(original), result = { file: name, cells: [], errors: [] };
  const { ELECTRON_RUN_AS_NODE: ignored, ...env } = process.env;
  let app;
  try {
    const started = performance.now();
    app = await _electron.launch({ executablePath: require('electron'), chromiumSandbox: true, cwd: appDir,
      args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
    const page = await app.firstWindow();
    page.on('pageerror', e => result.errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await expect(page.locator('.notebook-scroll:not(.preparing)')).toBeVisible({ timeout: 60000 });
    result.openMs = Math.round(performance.now() - started);
    result.initial = await page.locator('.notebook-scroll').evaluate(node => ({ height: node.scrollHeight, viewport: node.clientHeight }));
    result.kernelAtOpen = await page.locator('.kernel-state').getAttribute('aria-label');
    await page.screenshot({ path: path.join(here, `${name.slice(0, 2)}-opening.png`) });
    let capturedTable = false, capturedImage = false;
    for (let i = 0; i < notebook.cells.length; i++) {
      const input = notebook.cells[i];
      const cell = page.locator(`[data-cell-id="${input.id}"]`);
      await cell.evaluate(node => { const scroll = node.closest('.notebook-scroll'); scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20; });
      if (input.cell_type === 'markdown') {
        await expect(cell.locator('.markdown-placeholder')).toHaveCount(0, { timeout: 30000 });
      } else {
        await expect(cell.locator('.monaco-editor')).toBeAttached({ timeout: 30000 });
      }
      // Allow layout/observer delivery, without retrying a failed scenario.
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const row = await cell.evaluate(node => ({
        kind: node.getAttribute('data-cell-kind'), height: node.getBoundingClientRect().height,
        markdownText: node.querySelector('.cell-markdown')?.textContent,
        math: node.querySelectorAll('math').length,
        mathErrors: [...node.querySelectorAll('.katex-error, .math-error, [role="alert"]')].map(x => x.textContent),
        codeHeight: node.querySelector('.cell-editor')?.getBoundingClientRect().height,
        codeWidth: node.querySelector('.cell-editor')?.getBoundingClientRect().width,
        tables: [], images: [],
      }));
      row.index = i + 1;
      if ((input.outputs ?? []).length) {
        await cell.locator('.notebook-outputs, .output-placeholder').evaluate(node => { const scroll = node.closest('.notebook-scroll'); scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20; });
        await expect(cell.locator('.notebook-outputs')).toBeAttached({ timeout: 30000 });
        await cell.locator('.notebook-outputs').evaluate(async node => { await Promise.all([...node.querySelectorAll('img')].map(img => img.decode().catch(() => {}))); });
        const rendered = await cell.locator('.notebook-outputs').evaluate(node => ({
          items: node.querySelectorAll('.output-item').length,
          notes: [...node.querySelectorAll('.output-note')].map(x => x.textContent),
          tables: [...node.querySelectorAll('table')].map(table => ({
            rows: table.rows.length, maxColumns: Math.max(...[...table.rows].map(r => r.cells.length)),
            width: table.getBoundingClientRect().width, height: table.getBoundingClientRect().height,
            viewport: table.closest('.output-body').clientWidth,
            text: table.textContent, styles: table.querySelectorAll('[style]').length,
            header: [...(table.tHead?.rows[0]?.cells ?? [])].map(x => x.textContent),
          })),
          images: [...node.querySelectorAll('img')].map(img => ({ complete: img.complete, width: img.naturalWidth,
            height: img.naturalHeight, shownWidth: img.getBoundingClientRect().width, shownHeight: img.getBoundingClientRect().height })),
        }));
        Object.assign(row, rendered);
        if (row.tables.length && !capturedTable) { await page.screenshot({ path: path.join(here, `${name.slice(0, 2)}-table.png`) }); capturedTable = true; }
        if (row.images.length && !capturedImage) { await page.screenshot({ path: path.join(here, `${name.slice(0, 2)}-image.png`) }); capturedImage = true; }
      }
      result.cells.push(row);
    }
    result.final = await page.locator('.notebook-scroll').evaluate(node => ({ height: node.scrollHeight, viewport: node.clientHeight }));
    result.kernelAtEnd = await page.locator('.kernel-state').getAttribute('aria-label');
    result.fileUnchanged = (await readFile(file, 'utf8')) === original;
    console.log(JSON.stringify({ file: name, openMs: result.openMs, scanned: result.cells.length,
      math: result.cells.reduce((n, c) => n + c.math, 0), tables: result.cells.reduce((n, c) => n + c.tables.length, 0),
      images: result.cells.reduce((n, c) => n + c.images.length, 0), initial: result.initial, final: result.final, errors: result.errors }));
  } catch (error) { result.failure = error.stack; console.error(name, error.message); }
  finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
    await rm(root, { recursive: true, force: true });
    results.push(result); await writeFile(path.join(here, 'electron-results.json'), JSON.stringify(results, null, 2) + '\n');
  }
}
if (results.some(r => r.failure)) process.exitCode = 1;
