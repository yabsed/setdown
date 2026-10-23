import { electron } from '../../support/electron/electron-app';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

const exec = promisify(execFile);

test('SCM row menus stay styled, unclipped and keyboard accessible in light and dark themes', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-menu-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-menu-config-'));
  const names = Array.from({ length: 24 }, (_, index) => `notes-${String(index).padStart(2, '0')}.md`);
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await Promise.all(names.map(name => writeFile(path.join(root, name), '# Base\n')));
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await Promise.all(names.map(name => writeFile(path.join(root, name), '# Changed\n')));
  await exec('git', ['add', names[0]], { cwd: root });
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(root, names[0])], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
    await Promise.all([page.waitForEvent('load'), page.reload()]); await focusApplication(app);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await expect(page.locator('.git-change')).toHaveCount(names.length);
    const more = page.getByRole('button', { name: `Actions for ${names.at(-1)}`, exact: true });
    const list = page.locator('.scm-groups');
    for (const theme of ['paper', 'night']) {
      await page.evaluate(theme => window.marktex.executeApplicationMenuItem(`preview-theme-${theme}`), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await more.scrollIntoViewIfNeeded(); await page.mouse.move(400, 100);
      expect(await more.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await more.locator('svg').evaluate(node => ({ width: node.getBoundingClientRect().width, fill: getComputedStyle(node).fill })))
        .toEqual({ width: 16, fill: await more.evaluate(node => getComputedStyle(node).color) });
      const scrollBefore = await list.evaluate(node => node.scrollTop);
      await more.click();
      const menu = page.getByRole('menu', { name: `Actions for ${names.at(-1)}`, exact: true });
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      expect(await list.evaluate(node => node.scrollTop)).toBe(scrollBefore);
      await expect.poll(previews(app).hasVisible).toBe(false);
      // DOM visibility alone does not detect overflow clipping. Every item must
      // receive real pointer input, including the last item outside the list.
      expect(await menu.getByRole('menuitem').evaluateAll(nodes => nodes.every(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.height >= 28 && [bounds.left + 3, bounds.right - 3].every(x =>
          [bounds.top + 3, bounds.bottom - 3].every(y => node.contains(document.elementFromPoint(x, y))));
      }))).toBe(true);
      const menuBounds = (await menu.boundingBox())!, listBounds = (await list.boundingBox())!;
      expect(menuBounds.y + menuBounds.height).toBeGreaterThan(listBounds.y + listBounds.height);
      expect(await menu.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`scm-menu-${theme}.png`) });
      await page.keyboard.press('End'); await expect(menu.getByRole('menuitem').last()).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(more).toBeFocused();
      await expect.poll(previews(app).hasVisible).toBe(true);
      await more.click(); await page.getByText('SOURCE CONTROL', { exact: true }).click(); await expect(menu).toHaveCount(0);
      await expect.poll(previews(app).hasVisible).toBe(true);
    }
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('SCM offers file and comparison side opens, reuses the target group, and keeps shared edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-side-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-side-config-'));
  const file = path.join(root, 'review.txt');
  await exec('git', ['init'], { cwd: root }); await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(file, 'base\n'); await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(file, 'working\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
    await Promise.all([page.waitForEvent('load'), page.reload()]); await focusApplication(application);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click(); await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const more = page.getByRole('button', { name: 'Actions for review.txt', exact: true });
    await more.click(); await page.getByRole('menuitem', { name: 'Open File', exact: true }).click();
    const ordinary = page.locator('.document-tab:not(.git-diff-tab)'); await expect(ordinary).toHaveCount(1);
    for (let i = 0; i < 2; i++) {
      await ordinary.click(); await more.click(); await page.getByRole('menuitem', { name: 'Open Changes to the Side', exact: true }).click();
      await expect(page.locator('.editor-group')).toHaveCount(2); await expect(page.locator('.git-diff-tab')).toHaveCount(1);
    }
    const source = page.locator('.modified-in-monaco-diff-editor').getByRole('textbox'); await source.press('Control+End'); await source.pressSequentially('shared');
    await expect(page.locator('.editor-surface .view-lines, .group-editor-host .view-lines')).toContainText('shared');
    await page.getByRole('button', { name: 'Open File to the Side', exact: true }).click();
    await expect(page.locator('.editor-group')).toHaveCount(3); await expect(page.locator('.document-tab:not(.git-diff-tab)')).toHaveCount(2);
    await page.locator('.git-diff-tab .tab-close').click(); await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(page.locator('.editor-surface .view-lines, .group-editor-host .view-lines')).toHaveCount(2);
    for (const content of await page.locator('.editor-surface .view-lines, .group-editor-host .view-lines').all()) await expect(content).toContainText('shared');
    expect(await readFile(file, 'utf8')).toBe('working\n');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('first Working Tree opens directly in Monaco without an ordinary Viewer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-config-'));
  const documentPath = path.join(root, 'review.md');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(documentPath, '# Original\n\n$$x^2 + y^2 = z^2$$\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(documentPath, '# Working tree\n\n$$x^2 + y^2 = z^2$$\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({ args: ['.'], env: { ...environment, XDG_CONFIG_HOME: configRoot } });
  try {
    const window = await application.firstWindow();
    window.on('pageerror', error => console.error('Renderer failure:', error));
    window.on('console', message => { if (message.type() === 'error') console.error('Renderer console:', message.text()); });
    await window.evaluate(async (folder) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folder);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await focusApplication(application);
    // A synthetic/native dragend may report screen (0, 0). Keep the window
    // away from the screen origin so that an in-window cancel cannot be
    // mistaken for a detach based on that sentinel coordinate.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())?.setPosition(120, 80);
    });
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control', exact: true }).click();
    await application.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { reviewOpeningShows: string[] };
      state.reviewOpeningShows = [];
      ipcMain.on('preview:show', (_event, request: { tabId: string | null }) => {
        if (request.tabId) state.reviewOpeningShows.push(request.tabId);
      });
    });
    await window.locator('.git-change-open').click();
    const modified = window.locator('.modified-in-monaco-diff-editor');
    await expect(modified.locator('.view-lines')).toContainText('Working tree');
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    const shown = () => application.evaluate(() =>
      (globalThis as typeof globalThis & { reviewOpeningShows: string[] }).reviewOpeningShows);
    expect(await shown()).toEqual([]);

    const source = modified.getByRole('textbox');
    await source.press('Control+End');
    await source.pressSequentially('\nShared edit');
    await expect(window.locator('.document-tab:not(.git-diff-tab)')).toHaveCount(0);
    await expect(window.locator('.git-diff-tab .tab-dirty')).toHaveCount(1);
    // The ordinary editor must borrow the exact same model/history on first use.
    await window.evaluate(file => globalThis.window.marktex.openLink(`marktex-resource://file${file}`), documentPath);
    await expect.poll(previews(application).hasVisible).toBe(true);
    await window.getByRole('button', { name: 'Switch to Editor' }).click();
    const ordinary = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(window.locator('.editor-surface .view-lines')).toContainText('Shared edit');
    await ordinary.press('Control+z');
    await expect(window.locator('.editor-surface .view-lines')).not.toContainText('Shared edit');
    await ordinary.press('Control+Shift+z');
    await ordinary.press('Control+s');
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared edit');

    await window.locator('.git-change-open').click();
    await expect(modified.locator('.view-lines')).toContainText('Shared edit');
    await window.getByRole('button', { name: 'View Rendered Diff' }).click();
    await expect.poll(previews(application).hasVisible).toBe(true);
    const ordinaryTab = window.locator('.document-tab:not(.git-diff-tab)');
    const drag = await window.evaluateHandle(() => new DataTransfer());
    await ordinaryTab.dispatchEvent('dragstart', { dataTransfer: drag });
    await expect.poll(previews(application).hasVisible).toBe(false);
    await ordinaryTab.dispatchEvent('dragend', { dataTransfer: drag, clientX: 100, clientY: 100 });
    await drag.dispose();
    await expect(window.locator('.git-diff-tab')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(previews(application).hasVisible).toBe(true);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('two Working Tree groups and an ordinary view share edits, Undo and independent native readers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-groups-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-groups-config-'));
  const file = path.join(root, 'shared.md');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(file, '# Base\n\nOriginal.\n');
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(file, '# Working\n\nShared content.\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
    await Promise.all([page.waitForEvent('load'), page.reload()]); await focusApplication(app);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.git-change-open').click();
    await expect(page.locator('.git-diff-tab')).toHaveCount(1);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-editor-commands'));
    const commands = page.getByRole('dialog', { name: 'Commands', exact: true });
    await commands.getByRole('searchbox').fill('Split editor right');
    await commands.getByRole('option').filter({ hasText: 'Split editor right' }).click();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(page.locator('.git-diff-tab')).toHaveCount(2);
    const panes = page.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor');
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(1).locator('.view-lines:not([monaco-view-zone])')).toContainText('Shared content.');
    const right = panes.nth(1).getByRole('textbox');
    await right.press('Control+End'); await right.pressSequentially('\nShared across all views');
    await expect(panes.nth(0).locator('.view-lines:not([monaco-view-zone])')).toContainText('Shared across all views');
    await expect(page.locator('.tab-dirty')).toHaveCount(3);
    await page.locator('.document-tab:not(.git-diff-tab)').click();
    await expect.poll(previews(app).hasVisible).toBe(true);
    await page.getByRole('button', { name: 'Switch to Editor' }).click();
    const ordinary = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(page.locator('.editor-surface .view-lines')).toContainText('Shared across all views');
    await ordinary.press('Control+z');
    await expect(page.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor .view-lines:not([monaco-view-zone])')).not.toContainText('Shared across all views');
    await ordinary.press('Control+Shift+z'); await ordinary.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('Shared across all views');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    // Both review views can be rendered at once, and closing one cannot hide the other.
    await page.locator('.git-diff-tab').nth(0).click();
    await page.getByRole('button', { name: 'View Rendered Diff' }).click();
    await page.locator('.git-diff-tab').nth(1).click();
    await page.getByRole('button', { name: 'View Rendered Diff' }).click();
    const readers = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible()).map(view => view.getBounds()));
    await expect.poll(async () => (await readers()).length).toBe(2);
    const boxes = (await readers()).sort((a, b) => a.x - b.x);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
    await page.locator('.git-diff-tab').nth(0).locator('.tab-close').click();
    await expect(page.locator('.git-diff-tab')).toHaveCount(1);
    await expect.poll(async () => (await readers()).length).toBe(1);
    expect(errors).toEqual([]);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});
