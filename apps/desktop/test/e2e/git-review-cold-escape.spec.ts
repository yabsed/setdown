import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type Application = Awaited<ReturnType<typeof electron.launch>>;
const CHANGE = 'Cold first Esc regression marker';

function inspectChanges(application: Application) {
  return application.evaluate(async ({ BrowserWindow }, marker) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    if (!owner) return [];
    const rows = await Promise.all(owner.contentView.children.map(async (view) => {
      if (!('webContents' in view) || view.webContents.isDestroyed()) return null;
      if (!view.webContents.getURL().startsWith('marktex-preview://document/')) return null;
      const geometry = await view.webContents.executeJavaScript(`(() => {
        const changed = Array.from(document.querySelectorAll(
          '.setdown-rendered-diff-after .setdown-diff-added'
        )).find((element) => element.textContent.includes(${JSON.stringify(marker)}));
        if (!changed) return null;
        const rect = changed.getBoundingClientRect();
        return {
          top: rect.top, bottom: rect.bottom, width: rect.width,
          viewportHeight: innerHeight, scrollY,
          inViewport: rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.top < innerHeight,
        };
      })()`).catch(() => null);
      return geometry ? { visible: view.getVisible(), ...geometry } : null;
    }));
    return rows.filter((row) => row !== null);
  }, CHANGE);
}

test('first Esc after editing and saving reveals the changed block without warming a Git viewer', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-escape-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-escape-config-'));
  const documentPath = path.join(root, 'notes.md');
  let application: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const paragraphs = Array.from({ length: 80 }, (_, index) =>
      `Unchanged paragraph ${index + 1}. This keeps the first change well below the viewport.`);
    await writeFile(documentPath, ['# Original document', ...paragraphs, 'Original ending.', '']
      .join('\n\n'), 'utf8');
    await exec('git', ['add', 'notes.md'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    application = await electron.launch({
      args: ['.', documentPath],
      env: { ...environment, XDG_CONFIG_HOME: configRoot },
    });
    const app = application;
    const window = await app.firstWindow();
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folderPath);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);

    // Reproduce the user workflow, not just a repo changed before app launch.
    await window.getByRole('button', { name: 'Switch to Editor' }).click();
    const editor = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End');
    await editor.pressSequentially(`\n\n${CHANGE}\n`);
    await editor.press('Control+s');
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain(CHANGE);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control' }).click();
    const changed = window.locator('.scm-group').filter({
      has: window.getByText('CHANGES', { exact: true }),
    });
    await changed.locator('.git-change-open').click();
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines')).toContainText(CHANGE);

    // The page may be prepared in the background, but no Git rendered surface
    // has ever been shown/measured. Do NOT warm another diff tab first.
    await expect.poll(async () => (await inspectChanges(app)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect((await inspectChanges(app)).some((row) => row?.visible)).toBe(false);
    const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await workingTreeEditor.press('Escape');
    await expect(window.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect.poll(async () => (await inspectChanges(app))
      .find((row) => row?.visible)?.inViewport, { timeout: 10_000 }).toBe(true);
    expect((await inspectChanges(app)).find((row) => row?.visible)?.scrollY).toBeGreaterThan(0);

    // The second transition must work too; it must not be required to prime the first.
    await window.getByRole('button', { name: 'View Source Diff' }).click();
    await workingTreeEditor.press('Escape');
    await expect.poll(async () => (await inspectChanges(app))
      .find((row) => row?.visible)?.inViewport).toBe(true);
  } finally {
    if (application) await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
