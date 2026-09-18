import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

function stderrOf(application: Awaited<ReturnType<typeof electron.launch>>) {
  let output = '';
  application.process().stderr?.on('data', (chunk) => output += String(chunk));
  return () => output;
}

test('closes a clean window without touching destroyed WebContents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clean-close-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('test/fixtures/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') },
  });
  const stderr = stderrOf(application);

  try {
    const window = await application.firstWindow();
    const closed = window.waitForEvent('close');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stderr()).not.toContain('Object has been destroyed');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});

test('uses the Setdown close prompt for dirty tabs and windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-close-prompt-'));
  const documentPath = path.join(root, 'closing.md');
  await writeFile(documentPath, '# Closing\n', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') },
  });
  const stderr = stderrOf(application);

  try {
    const window = await application.firstWindow();
    await window.locator('.mode-toggle').click();
    const editor = window.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End');
    await editor.pressSequentially('\nchanged');
    await expect(window.locator('.tab-dirty')).toHaveCount(1);

    await window.locator('.tab-close').click();
    const prompt = window.locator('.close-prompt-dialog');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('heading')).toHaveText('Save Changes');
    const promptBounds = await prompt.boundingBox();
    expect(promptBounds?.width).toBeLessThanOrEqual(402);
    expect(promptBounds?.height).toBeLessThan(220);
    await expect(prompt.locator('.close-document-list')).toHaveCount(0);
    await expect(prompt.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(prompt.getByRole('button', { name: "Don't Save", exact: true })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Cancel' }).first()).toBeVisible();
    await expect(prompt.locator('.close-discard')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await prompt.locator('.close-cancel').click();
    await expect(prompt).toBeHidden();
    await expect(window.locator('.document-tab')).toHaveCount(1);

    await editor.press('Escape');
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect(prompt).toBeVisible();
    await expect(prompt.locator('.close-prompt-body')).toContainText('closing.md');

    const closed = window.waitForEvent('close');
    await prompt.locator('.close-discard').click();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stderr()).not.toContain('Object has been destroyed');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
