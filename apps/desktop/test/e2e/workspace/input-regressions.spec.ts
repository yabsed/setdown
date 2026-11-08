import { expect, test } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { electron, focusApplication, disposeApplication } from '../../support/electron/electron-app';
import { nativeInput } from '../../support/electron/native-input';
import { previews } from '../../support/preview/preview-view';

test('background Git refresh preserves the caret while typing in a newly opened review', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-caret-')), file = path.join(root, 'review.ts');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  await writeFile(path.join(root, '.gitignore'), 'config/\n');
  await writeFile(file, 'const value = 1;\n'); git('add', '.'); git('commit', '-m', 'base');
  await writeFile(file, 'const value = 2;\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    const editor = page.getByRole('textbox', { name: 'Current document', exact: true });
    await expect(editor).toBeEditable(); await editor.press('Control+End'); await editor.pressSequentially('prefix');
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers, previous = handlers.get('project:git-diff');
      (globalThis as any).__caretRefreshes = 0;
      handlers.set('project:git-diff', async (...args: unknown[]) => {
        const result = await previous(...args); (globalThis as any).__caretRefreshes++; return result;
      });
    });
    // Invoke the normal refresh action without moving native focus, as a file
    // watcher would. A real pointer click would blur/save the view and hide this race.
    await page.getByRole('button', { name: 'Refresh Source Control' }).evaluate(button => (button as HTMLButtonElement).click());
    await expect.poll(() => app.evaluate(() => (globalThis as any).__caretRefreshes)).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(editor).toBeFocused();
    await page.keyboard.type('_suffix');
    await expect(page.locator('.git-diff-editor')).toContainText('prefix_suffix');
    await editor.press('Control+a'); await editor.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('const value = 2;\nprefix_suffix');
    expect(await readFile(file, 'utf8')).toBe('const value = 2;\n');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('X11 pinch broker routes continuous zoom to shell and native content without changing app zoom', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pinch-'));
  const file = path.join(root, 'code.txt'), markdown = path.join(root, 'reader.md');
  await writeFile(file, 'Pinch this code\n'.repeat(80)); await writeFile(markdown, '# Pinch reader\n\nText.\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    for (const native of [false, true]) {
      if (native) await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
      if (native) await expect.poll(() => previews(app).hasVisible()).toBe(true);
      else await expect(page.locator('.monaco-editor')).toBeVisible();
      const id = (await page.getByRole('tab', { selected: true }).getAttribute('data-tab-id'))!;
      const zoom = () => page.evaluate(async id => (await window.marktex.getZoom()).tabs?.[id] ?? 100, id);
      // The helper connects to real isolated X11 and subscribes to XI2. Inject
      // its decoded wire messages to test the missing bridge through Chromium.
      // This does not pretend to reproduce a physical touchpad in Xvfb.
      for (const scale of [1.2, 1]) {
        await app.evaluate(({ BrowserWindow, screen }, scale) => {
          const owner = BrowserWindow.getAllWindows().find(window => window.isVisible())!;
          const processWithHandles = process as typeof process & { _getActiveHandles(): Array<{ spawnargs?: string[]; stdout?: NodeJS.EventEmitter; exitCode?: number | null }> };
          const helper = processWithHandles._getActiveHandles().find(handle => handle.spawnargs?.some(arg => arg.endsWith('x11-pinch.py')));
          if (!helper?.stdout || helper.exitCode !== null) throw Error('XI2 gesture helper is not running');
          const bounds = owner.getContentBounds();
          const point = screen.dipToScreenPoint({ x: bounds.x + 200, y: bounds.y + 210 });
          for (const [type, value] of [['begin', 1], ['update', scale], ['end', scale]] as const)
            helper.stdout.emit('data', Buffer.from(JSON.stringify({ type, device: 2, scale: value, ...point, cancelled: false }) + '\n'));
        }, scale === 1 ? 1 / 1.2 : scale);
        await expect.poll(zoom).toBeCloseTo(scale * 100, 4);
      }
      expect(await page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(100);
    }
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('cancelled Explorer file drags release the input shield and subsequent tab clicks and wheel scrolling', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-drag-input-'));
  for (const name of ['first.txt', 'second.txt']) await writeFile(path.join(root, name), Array.from({ length: 300 }, (_, i) => `${name} line ${i}`).join('\n'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(root, 'first.txt')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await page.getByRole('treeitem', { name: 'second.txt', exact: true }).dblclick();
    const toScreen = async (x: number, y: number) => app.evaluate(({ BrowserWindow }, point) => {
      const bounds = BrowserWindow.getAllWindows()[0].getContentBounds(); return { x: bounds.x + point.x, y: bounds.y + point.y };
    }, { x, y });
    for (const outcome of ['reject', 'escape']) {
      const row = (await page.getByRole('treeitem', { name: 'first.txt', exact: true }).boundingBox())!;
      const start = await toScreen(row.x + 70, row.y + row.height / 2);
      await nativeInput({ pointer: [start], button: 'down' });
      await nativeInput({ pointer: [{ x: start.x + 30, y: start.y + 10 }, await toScreen(600, 300)] });
      await expect(page.locator('.shell')).toHaveClass(/is-tab-dragging/);
      if (outcome === 'escape') await nativeInput({ keys: ['Escape'] });
      else await nativeInput({ pointer: [await toScreen(15, 75)] });
      await nativeInput({ button: 'up' });
      await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      const tab = page.getByRole('tab', { name: /second.txt/ });
      const bounds = (await tab.boundingBox())!;
      await nativeInput({ click: await toScreen(bounds.x + 30, bounds.y + 15) });
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const before = await page.locator('.monaco-editor .view-lines').last().textContent();
      await page.mouse.move(700, 350); await page.mouse.wheel(0, 600);
      await expect.poll(() => page.locator('.monaco-editor .view-lines').last().textContent()).not.toBe(before);
    }
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('distant notebook code and saved images stay in view while preceding outputs acquire height', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-cell-anchor-')), file = path.join(root, 'cells.ipynb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5N8AAAAASUVORK5CYII=';
  const cells = Array.from({ length: 40 }, (_, i) => ({ id: `cell-${i}`, cell_type: 'code', metadata: {}, execution_count: null,
    source: Array.from({ length: i % 5 + 1 }, (_, j) => `value_${i}_${j} = ${j}`).join('\n'),
    outputs: i === 28 ? [{ output_type: 'stream', name: 'stdout', text: 'Saved output\n'.repeat(150) }]
      : i === 30 ? [{ output_type: 'display_data', data: { 'image/png': png }, metadata: {} }] : [] }));
  const original = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells }); await writeFile(file, original);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await expect(page.locator('.notebook-scroll')).toHaveAttribute('aria-busy', 'false');
    const target = page.locator('[data-cell-id="cell-30"]');
    await target.evaluate(node => {
      const scroll = node.closest('.notebook-scroll')!;
      scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 180;
    });
    await expect(target.locator('.view-lines')).toContainText('value_30_0');
    await expect(target.locator('.notebook-outputs img')).toBeInViewport();
    await expect.poll(() => target.locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(page.locator('[data-cell-id="cell-28"]')).toHaveCSS('min-height', '35px');
    await page.waitForTimeout(500); // Observe late output layout after the target is ready.
    await expect(target.locator('.notebook-outputs img')).toBeInViewport();
    expect(await readFile(file, 'utf8')).toBe(original);
    await page.screenshot({ path: test.info().outputPath('stable-notebook-image.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
