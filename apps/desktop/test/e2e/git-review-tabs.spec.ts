import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';
import { previews } from './preview-view';

const exec = promisify(execFile);

test('keeps staged and live working-tree reviews in separate tabs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-tabs-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-config-'));
  const documentPath = path.join(root, 'review.md');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(documentPath, '# Base\n', 'utf8');
  await exec('git', ['add', 'review.md'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(documentPath, [
    '# Staged', '', 'line one', 'line two', 'Working tree', '', 'Tail', '',
  ].join('\n'), 'utf8');
  await exec('git', ['add', 'review.md'], { cwd: root });
  await writeFile(documentPath, [
    '# Staged', '', 'line one', 'line two', 'Working tree ?', '',
    'Inserted one', '', 'Inserted two', '', 'Tail', '',
  ].join('\n'), 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
    const reading = previews(application);
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folderPath);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control' }).click();

    const staged = window.locator('.scm-group').filter({
      has: window.getByText('STAGED CHANGES', { exact: true }),
    });
    const changed = window.locator('.scm-group').filter({
      has: window.getByText('CHANGES', { exact: true }),
    });
    await expect(staged.locator('.git-change-open')).toContainText('review.md');
    await expect(changed.locator('.git-change-open')).toContainText('review.md');

    await staged.locator('.git-change-open').click();
    await expect(window.locator('.git-diff-tab')).toHaveCount(1);
    await expect(window.locator('.git-diff-tab')).toContainText('review.md (Index)');

    await changed.locator('.git-change-open').click();
    await expect(window.locator('.git-diff-tab')).toHaveCount(2);
    await expect(window.locator('.git-diff-tab').nth(0)).toContainText('review.md (Index)');
    await expect(window.locator('.git-diff-tab').nth(1)).toContainText('review.md (Working Tree)');

    await window.locator('.git-diff-tab').nth(0).click();
    await expect(window.locator('.git-review-axis')).toHaveText('HEAD ↔ STAGED');
    await window.locator('.git-diff-tab').nth(1).click();
    await expect(window.locator('.git-review-axis')).toHaveText('STAGED ↔ CURRENT DOCUMENT');
    await expect(window.locator('.git-review-note')).toContainText('staged Index');
    const renderedBefore = `Array.from(document.querySelectorAll('.setdown-rendered-diff-before'))
      .map((node) => node.textContent).join(' ')`;
    const renderedAfter = `Array.from(document.querySelectorAll('.setdown-rendered-diff-after'))
      .map((node) => node.textContent).join(' ')`;
    await expect.poll(() => reading.evaluate<string>(renderedBefore)).toContain('Staged');
    expect(await reading.evaluate<string>(renderedBefore)).not.toContain('Base');
    await expect.poll(() => reading.evaluate<string>(renderedAfter)).toContain('Working tree');
    const alignment = await reading.evaluate<{
      display: string; changed: number; tail: number;
    }>(`(() => {
      const split = document.querySelector('.setdown-rendered-diff-split');
      const before = document.querySelector('.setdown-diff-removed');
      const after = document.querySelector('.setdown-diff-added');
      const tails = Array.from(document.querySelectorAll('.setdown-rendered-diff-split p'))
        .filter((node) => node.textContent?.trim() === 'Tail');
      return {
        display: split ? getComputedStyle(split).display : '',
        changed: before && after
          ? Math.abs(before.getBoundingClientRect().top - after.getBoundingClientRect().top) : -1,
        tail: tails.length === 2
          ? Math.abs(tails[0].getBoundingClientRect().top - tails[1].getBoundingClientRect().top) : -1,
      };
    })()`);
    expect(alignment).toMatchObject({ display: 'block' });
    expect(alignment?.changed).toBeLessThan(2);
    expect(alignment?.tail).toBeLessThan(2);

    await window.getByRole('button', { name: 'View Source Diff' }).click();
    await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
      .toContainText('Staged');
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Working tree');
    const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await expect(workingTreeEditor).toBeEditable();
    await workingTreeEditor.press('Control+End');
    await workingTreeEditor.pressSequentially('\nShared draft');
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);

    await window.locator('.document-tab:not(.git-diff-tab)').click();
    await expect.poll(reading.hasVisible).toBe(true);
    await expect.poll(() => reading.evaluate('document.body.innerText')).toContain('Shared draft');

    await changed.getByRole('button', { name: 'Stage All' }).click();
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared draft');
    await expect.poll(async () => (await exec('git', ['show', ':review.md'], { cwd: root })).stdout)
      .toContain('Shared draft');
    await expect(changed.locator('.git-change-open')).toHaveCount(0);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
