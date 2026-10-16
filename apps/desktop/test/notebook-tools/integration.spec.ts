import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { electron, disposeApplication, focusApplication } from '../e2e/electron-app';

test('real nbconvert, Ruff, Jupytext, nbdime and JupyterLab integration', async () => {
  const toolsPython = process.env.SETDOWN_NOTEBOOK_TOOLS_PYTHON;
  if (!toolsPython) throw Error('Set SETDOWN_NOTEBOOK_TOOLS_PYTHON to the separate Python environment containing the notebook tools.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-external-tools-'));
  const file = path.join(root, 'experiment.ipynb');
  const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3 (ipykernel)', language: 'python' }, language_info: { name: 'python', file_extension: '.py' } }, cells: [
    { id: 'intro', cell_type: 'markdown', source: '# Experiment', metadata: {} },
    { id: 'code', cell_type: 'code', source: 'value=  1\nprint("DO_NOT_EXECUTE_EXPORT")', metadata: {}, outputs: [], execution_count: null },
  ] });
  await writeFile(file, source); execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'add', '.']); execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const data = await application.evaluate(({ app }) => app.getPath('userData'));
    await mkdir(data, { recursive: true }); await symlink(path.dirname(path.dirname(toolsPython)), path.join(data, 'notebook-tools'), 'dir');
    const page = await application.firstWindow(); await focusApplication(application); await expect(page.locator('.notebook-cell')).toHaveCount(2);
    const action = (action: string, text = source) => page.evaluate(async ({ file, source, action }) => (window as any).marktex.notebook.tool(file, source, action), { file, source: text, action });
    const formatted = await action('format'); expect(JSON.parse(formatted.source).cells[1].source.join('')).toContain('value = 1');
    for (const [actionName, extension] of [['export-html', 'html'], ['export-script', 'py'], ['export-markdown', 'md'], ['export-webpdf', 'pdf']]) {
      console.log('External tool:', actionName);
      const out = path.join(root, 'result.' + extension);
      await application.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, out);
      expect((await action(actionName)).path).toBe(out); const bytes = await readFile(out); expect(bytes.length).toBeGreaterThan(20);
      if (extension === 'pdf') expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    }
    expect(await readFile(file, 'utf8')).toBe(source);
    const diff = await action('diff', source.replace('value=  1', 'value=  2'));
    const response = await fetch(diff.url); expect(response.ok).toBe(true); expect(await response.text()).toContain('nbdime');
    const lab = await action('jupyterlab'); const labUrl = new URL(lab.url); expect(labUrl.pathname).toContain('experiment.ipynb');
    await expect.poll(() => application.context().pages().some(page => page.url().startsWith(labUrl.origin)), { timeout: 30_000 }).toBe(true);
    const labPage = application.context().pages().find(page => page.url().startsWith(labUrl.origin));
    expect(labPage).toBeDefined();
    await expect(labPage!.locator('.jp-LabShell')).toBeVisible({ timeout: 30_000 });
    const code = labPage!.locator('.jp-CodeCell .cm-content').first();
    await expect(code).toBeVisible();
    if (await labPage!.getByRole('dialog').isVisible()) {
      const dialog = labPage!.getByRole('dialog'); console.log('JupyterLab dialog:', await dialog.innerText());
      await dialog.getByRole('button', { name: 'Select', exact: true }).click();
    }
    await code.click();
    await expect(labPage!.getByRole('combobox', { name: 'Cell type' })).toHaveValue('code');
    await code.fill('import ipywidgets as widgets\nwidgets.IntSlider(value=7)'); await labPage!.getByRole('button', { name: 'Run this cell and advance (Shift+Enter)', exact: true }).click();
    await expect(labPage!.locator('.widget-slider')).toBeVisible({ timeout: 30_000 });
    await code.click(); await code.fill('import plotly.graph_objects as go\ngo.FigureWidget(data=[go.Bar(y=[1, 2])])'); await labPage!.getByRole('button', { name: 'Run this cell and advance (Shift+Enter)', exact: true }).click();
    await expect(labPage!.locator('.js-plotly-plot')).toBeVisible({ timeout: 30_000 });
    await labPage!.getByRole('button', { name: 'Enable Debugger', exact: true }).click(); await expect(labPage!.getByRole('button', { name: 'Disable Debugger', exact: true })).toBeVisible();
    labUrl.pathname = '/api/kernelspecs'; const kernels = await fetch(labUrl).then(r => r.json()) as any; expect(Object.keys(kernels.kernelspecs).some(name => name.startsWith('setdown-'))).toBe(true);
    // Running and debugging are owned by the real JupyterLab kernel service.
    labUrl.pathname = '/api/kernels'; const created = await fetch(labUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'python3' }) }); expect(created.status).toBe(201);
    await page.evaluate(async file => (window as any).marktex.notebook.cancelTools(file), file);
    await expect.poll(() => fetch(diff.url).then(() => false, () => true)).toBe(true);
    await expect.poll(() => fetch(lab.url).then(() => false, () => true)).toBe(true);
    const script = path.join(root, 'cells.py'); await writeFile(script, '# %% [markdown]\n# # Intro\n# %%\nx = 1\n# %%\nprint(x)');
    // Open the script through the normal document owner before calling conversion IPC.
    await page.evaluate(async script => (window as any).marktex.openLink('marktex-resource://file' + script), script);
    await expect(page.getByRole('tab', { name: /cells.py/ })).toBeVisible();
    const converted = path.join(root, 'cells-interactive.ipynb');
    await application.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, converted);
    await page.evaluate(async ({ script, source }) => (window as any).marktex.notebook.pythonCells(script, source), { script, source: await readFile(script, 'utf8') });
    expect(JSON.parse(await readFile(converted, 'utf8')).cells.map((cell: any) => cell.cell_type)).toEqual(['markdown', 'code', 'code']);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
