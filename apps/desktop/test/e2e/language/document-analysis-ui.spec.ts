import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

test('compact inspection has keyboard steps; project settings remain pinned while switching documents', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-ui-')), config = path.join(root, 'config');
  const projects = [path.join(root, 'alpha'), path.join(root, 'beta')], files = projects.map(p => path.join(p, 'main.py'));
  for (const [index, project] of projects.entries()) {
    await mkdir(path.join(project, '.git'), { recursive: true });
    await writeFile(path.join(project, 'pyproject.toml'), `[project]\nname = "fixture${index}"\nversion = "0.0.0"\n`);
    await writeFile(files[index], `value = ${index}\n`);
  }
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', files[0]], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const status = page.locator('.editor-group').first().getByRole('button', { name: /Language status:/ });
    await expect(status).toHaveAccessibleName('Language status: Python', { timeout: 20_000 });
    await expect(status.locator('.indicator')).toHaveCount(0);
    const leftInstance = page.locator('.group-monaco-instance').filter({ has: page.locator('.view-lines').filter({ hasText: 'value = 0' }) });
    const editor = leftInstance.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await page.keyboard.insertText('unsaved = 42');
    await status.click();
    const popup = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(popup).toContainText('Results received for this open file', { timeout: 20_000 });
    await expect(popup.getByRole('combobox')).toHaveCount(0);
    await expect(popup).not.toContainText(files[0]);
    await expect(popup).not.toContainText('Completion');
    expect((await popup.boundingBox())!.height).toBeLessThan(340);
    await page.screenshot({ path: testInfo.outputPath('compact-normal.png') });
    await popup.getByRole('button', { name: /^Document language/ }).click();
    await expect(popup.getByRole('combobox', { name: 'Language mode' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup.getByRole('combobox')).toHaveCount(0);
    await popup.locator('h3').dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    await expect(popup).toBeVisible();
    await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0); await expect(status).toBeFocused();
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-editor-commands'));
    const commands = page.getByRole('dialog', { name: 'Commands', exact: true });
    await commands.getByRole('searchbox').fill('Split editor right');
    await commands.getByRole('option').filter({ hasText: 'Split editor right' }).first().click();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), files[1]);
    await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
    const rightInstance = page.locator('.group-monaco-instance').filter({ has: page.locator('.view-lines').filter({ hasText: 'value = 1' }) });
    await expect(rightInstance.locator('.view-lines')).toContainText('value = 1');
    await status.click(); await popup.getByRole('button', { name: 'Details…', exact: true }).click();
    await expect(popup).toContainText(files[0]);
    await rightInstance.locator('.view-line').first().click({ position: { x: 25, y: 8 } });
    await expect(popup).toBeVisible(); await expect(popup).not.toContainText(files[1]);
    await popup.getByRole('button', { name: /^Python environment/ }).click();
    await expect(popup).toContainText('including other tabs and windows');
    const select = popup.getByRole('combobox', { name: 'Python environment' });
    const selected = await select.inputValue(); expect(selected).toBeTruthy(); await select.selectOption(selected);
    await expect(popup.getByRole('heading', { name: 'Code support' })).toBeVisible();
    const preferences = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
    expect(Object.keys(preferences.projects)).toEqual([projects[0]]);
    await popup.getByRole('button', { name: 'Details…', exact: true }).click();
    await popup.getByRole('button', { name: /^Pyright/ }).click();
    await popup.getByRole('button', { name: 'Project connection settings…', exact: true }).click();
    await expect(popup).toContainText(projects[0]); await expect(popup).not.toContainText(projects[1]);
    await expect(popup.getByRole('textbox', { name: 'Analysis Python interpreter' })).toBeVisible();
    await popup.getByRole('combobox', { name: 'Formatting provider' }).selectOption('off');
    await rightInstance.locator('.view-line').first().click({ position: { x: 25, y: 8 } }); await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await expect(popup).toContainText('Settings applied.');
    const connections = JSON.parse(await readFile(path.join(config, 'Setdown/language-servers.json'), 'utf8'));
    expect(connections.projects[projects[0]].pyright.formatting).toBe(false); expect(connections.projects[projects[1]]).toBeUndefined();
    const bounds = (await popup.boundingBox())!, group = (await page.locator('.editor-group').first().boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(group.x + group.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(group.y + group.height);
    await page.screenshot({ path: testInfo.outputPath('project-pinned.png') });
    await popup.getByRole('button', { name: 'Close language status', exact: true }).click();
    await expect(leftInstance.locator('.view-lines')).toContainText('unsaved = 42');
    await editor.press('Control+z'); await expect(leftInstance.locator('.view-lines')).not.toContainText('unsaved = 42');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const sidebar = page.getByRole('region', { name: 'Language Support', exact: true });
    await expect(sidebar.getByRole('searchbox')).toBeVisible();
    await expect(sidebar).not.toContainText('Document analysis');
    await page.locator('.editor-group').first().locator('.document-tab[aria-selected="true"] .tab-close').click();
    await expect(sidebar.getByRole('searchbox')).toBeVisible();
    await expect(sidebar).not.toContainText('This document was closed');
    expect(await readFile(files[0], 'utf8')).toBe('value = 0\n');
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('catalog-independent.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('a missing environment exposes the repair first and retains an issue indicator in a narrow group', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-missing-')), config = path.join(root, 'config'), project = path.join(root, 'project');
  const settings = path.join(config, 'Setdown'), file = path.join(project, 'main.py'), missing = path.join(project, '.venv/bin/python');
  await mkdir(settings, { recursive: true }); await mkdir(path.join(project, '.git'), { recursive: true });
  await writeFile(file, 'value = 1\n');
  await writeFile(path.join(settings, 'project-analysis.json'), JSON.stringify({ version: 1, projects: { [project]: { python: missing } } }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700));
    const status = page.getByRole('button', { name: /Language status:/ });
    await expect(status).toHaveAccessibleName(/Choose environment/, { timeout: 20_000 });
    await expect(status.locator('.indicator')).toHaveText('!');
    await status.click();
    const popup = page.getByRole('dialog', { name: 'Current file language support' });
    const action = popup.getByRole('button', { name: 'Choose environment…', exact: true });
    await expect(action).toBeVisible();
    expect(await popup.evaluate(el => el.scrollTop)).toBe(0);
    expect(await popup.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect((await action.boundingBox())!.y).toBeLessThan((await popup.getByRole('button', { name: /^Document language/ }).boundingBox())!.y);
    await expect(popup.getByRole('button', { name: /^Restart/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('compact-missing.png') });
    await action.click(); await expect(popup.getByRole('combobox', { name: 'Python environment' })).toBeVisible();
    await expect(popup).toContainText('Remove project override');
    await expect(popup).toContainText('Falls back to');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('closing the last view of a checked document retires its coverage from Problems', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-lifetime-')), config = path.join(root, 'config');
  const checked = path.join(root, 'checked.json'), plain = path.join(root, 'plain.txt');
  await mkdir(path.join(root, '.git')); await writeFile(checked, '{"value":1}\n'); await writeFile(plain, 'Plain text\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', checked], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const status = page.getByRole('button', { name: /Language status:/ });
    const support = page.getByRole('dialog', { name: 'Current file language support' });
    const problems = page.getByRole('dialog', { name: 'Problems · Open Files' });
    await status.click(); await support.getByRole('button', { name: 'Problems', exact: true }).click();
    await expect(problems).toContainText('No diagnostics reported by the active checks');
    await problems.getByRole('button', { name: 'Close language results' }).click();
    const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), plain);
    await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
    await expect(page.locator('.location-bar input')).toHaveValue(new URL(`file://${plain}`).href);
    await page.locator('.document-tab').filter({ hasText: 'checked.json' }).locator('.tab-close').click();
    await expect(page.locator('.document-tab').filter({ hasText: 'checked.json' })).toHaveCount(0);
    await status.click(); await support.getByRole('button', { name: 'Problems', exact: true }).click();
    await expect(problems).toContainText('Check code support to see which checks are active');
    await expect(problems).not.toContainText('by the active checks');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
