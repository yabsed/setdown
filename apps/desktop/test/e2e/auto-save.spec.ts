import { _electron as electron, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

async function launch(root: string, documentPath?: string) {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  return electron.launch({
    args: documentPath ? ['.', documentPath] : ['.'],
    env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') },
  });
}

/** Settings persist in the isolated XDG_CONFIG_HOME; always pin the state first. */
async function setAutoSave(page: Page, enabled: boolean) {
  if (await page.evaluate(() => window.marktex.getAutoSave()) !== enabled) {
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-auto-save'));
  }
  await expect.poll(() => page.evaluate(() => window.marktex.getAutoSave())).toBe(enabled);
}

async function autoSaveMenuChecked(page: Page) {
  const entries = await page.evaluate(() => window.marktex.getApplicationMenu('application-menu-edit'));
  return entries.find((entry) => entry.id === 'menu-auto-save')?.checked;
}

test('auto save writes edits after the debounce and stops when disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auto-save-e2e-'));
  const documentPath = path.join(root, 'document.md');
  await writeFile(documentPath, '# Auto Save\n', 'utf8');
  const application = await launch(root, documentPath);
  try {
    const window = await application.firstWindow();
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await setAutoSave(window, true);
    await expect.poll(() => autoSaveMenuChecked(window)).toBe(true);

    await window.locator('.mode-toggle').click();
    const editor = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    await editor.press('Control+End');
    await editor.pressSequentially('auto saved');
    await expect.poll(() => readFile(documentPath, 'utf8'), { timeout: 10_000 })
      .toContain('auto saved');

    await setAutoSave(window, false);
    await expect.poll(() => autoSaveMenuChecked(window)).toBe(false);
    await editor.pressSequentially(' manual only');
    await window.waitForTimeout(2_500);
    await expect(readFile(documentPath, 'utf8')).resolves.not.toContain('manual only');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});

test('auto save never opens a save dialog for an untitled document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auto-save-e2e-'));
  const application = await launch(root);
  try {
    const window = await application.firstWindow();
    // The command channel only works once the renderer finished its startup.
    await expect(window.locator('.shell')).toHaveAttribute('data-surface', 'empty');
    await window.evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-document'));
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await setAutoSave(window, true);

    const editor = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    await editor.pressSequentially('unsaved draft');
    await window.waitForTimeout(2_500);
    // A blocked window would swallow this input; the draft stays dirty instead.
    await editor.pressSequentially(' still typing');
    await expect(window.locator('.editor-surface')).toContainText('unsaved draft');
    await expect(window.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    expect(await readFile(path.join(root, 'config', 'Setdown', 'auto-save.json'), 'utf8'))
      .toContain('"enabled":true');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
