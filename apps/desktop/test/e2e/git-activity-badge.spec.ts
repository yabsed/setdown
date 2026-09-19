import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);

test('Git activity badge counts groups and refreshes without opening Source Control', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-badge-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-badge-config-'));
  const documentPath = path.join(root, 'note.md');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    await writeFile(documentPath, '# Base\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    application = await electron.launch({ args: ['.', documentPath], env: { ...environment, XDG_CONFIG_HOME: configRoot } });
    const window = await application.firstWindow();
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & { marktex: { restoreProjectFolder(path: string): Promise<unknown> } })
        .marktex.restoreProjectFolder(folderPath);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    const icon = window.getByRole('button', { name: 'Source Control', exact: true });
    const badge = icon.locator('.scm-activity-badge');
    await expect(badge).toHaveCount(0);
    // External document writes must update the icon while Explorer is selected.
    await writeFile(documentPath, '# Changed\n');
    await writeFile(path.join(root, 'second.md'), '# New document\n');
    await expect(badge).toHaveText('1'); // two files, but only one group
    await icon.click();
    const changed = window.locator('.scm-group').filter({ has: window.getByText('CHANGES', { exact: true }) });
    const staged = window.locator('.scm-group').filter({ has: window.getByText('STAGED CHANGES', { exact: true }) });
    await changed.getByRole('button', { name: 'Stage All', exact: true }).click();
    await expect(staged.locator('.git-change-open')).toHaveCount(2);
    await expect(badge).toHaveText('1');
    await writeFile(documentPath, '# Changed again\n');
    await expect(badge).toHaveText('2');
    await changed.getByRole('button', { name: 'Collapse CHANGES' }).click();
    await expect(badge).toHaveText('2');
    await changed.getByRole('button', { name: 'Expand CHANGES' }).click();
    await changed.getByRole('button', { name: 'Stage All', exact: true }).click();
    await expect(changed.locator('.git-change-open')).toHaveCount(0);
    await expect(badge).toHaveText('1');
    await window.getByRole('textbox', { name: 'Commit message' }).fill('both documents');
    await window.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(badge).toHaveCount(0);
  } finally {
    if (application) await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
