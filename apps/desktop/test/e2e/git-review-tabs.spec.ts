import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';
import { previews } from './preview-view';

const exec = promisify(execFile);

type Application = Awaited<ReturnType<typeof electron.launch>>;

function shellHasKeyboardFocus(application: Application) {
  return application.evaluate(({ BrowserWindow, webContents }) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    return !!owner && webContents.getFocusedWebContents()?.id === owner.webContents.id;
  });
}

function diffPreviews(application: Application) {
  return application.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    if (!owner) return [];
    const rows = await Promise.all(owner.contentView.children.map(async (candidate) => {
      if (!('webContents' in candidate)) return null;
      const url = candidate.webContents.getURL();
      if (!url.startsWith('marktex-preview://document/')) return null;
      const renderedDiff = await candidate.webContents.executeJavaScript(
        'Boolean(document.querySelector(".setdown-rendered-diff-split"))',
      ).catch(() => false);
      return renderedDiff ? {
        id: candidate.webContents.id,
        url,
        visible: candidate.getVisible(),
        scrollY: await candidate.webContents.executeJavaScript('window.scrollY')
          .catch(() => 0),
        text: await candidate.webContents.executeJavaScript('document.body.innerText')
          .catch(() => ''),
      } : null;
    }));
    return rows.filter((row): row is NonNullable<typeof row> => !!row);
  });
}

test('new staged and working-tree reviews open source diff at the first change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-position-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-position-config-'));
  const documentPath = path.join(root, 'review.md');
  const unchanged = Array.from({ length: 45 }, (_, index) => `Shared preface ${index + 1}`);
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(documentPath, [
    '# Shared document', '', ...unchanged, '', '# Base', '', 'Tail', '',
  ].join('\n'), 'utf8');
  await exec('git', ['add', 'review.md'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(documentPath, [
    '# Shared document', '', ...unchanged, '', '# Staged', '', 'Tail', '',
  ].join('\n'), 'utf8');
  await exec('git', ['add', 'review.md'], { cwd: root });
  await writeFile(documentPath, [
    '# Shared document', '', ...unchanged, '', '# Staged', '', 'Working tree change', '',
    'Tail', '',
  ].join('\n'), 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
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
    await staged.locator('.git-change-open').click();
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
      .toContainText('Base');
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Staged');

    await changed.locator('.git-change-open').click();
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Working tree change');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});

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
  const filler = Array.from({ length: 90 }, (_, index) => `Filler paragraph ${index + 1}`);
  await writeFile(documentPath, [
    '# Staged', '', 'line one', 'line two', 'Working tree', '', 'Tail', '', ...filler, '',
  ].join('\n'), 'utf8');
  await exec('git', ['add', 'review.md'], { cwd: root });
  await writeFile(documentPath, [
    '# Staged', '', 'line one', 'line two', 'Working tree ?', '',
    'Inserted one', '', 'Inserted two', '', 'Tail', '', ...filler, '',
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
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
      .toContainText('Base');
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Staged');

    await changed.locator('.git-change-open').click();
    await expect(window.locator('.git-diff-tab')).toHaveCount(2);
    await expect(window.locator('.git-diff-tab').nth(0)).toContainText('review.md (Index)');
    await expect(window.locator('.git-diff-tab').nth(1)).toContainText('review.md (Working Tree)');
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Working tree ?');

    await window.getByRole('button', { name: 'View Rendered Diff' }).click();
    await window.locator('.git-diff-tab').nth(0).click();
    await window.getByRole('button', { name: 'View Rendered Diff' }).click();
    await window.locator('.git-diff-tab').nth(1).click();

    await window.locator('.git-diff-tab').nth(0).click();
    await expect(window.locator('.git-review-axis')).toHaveText('HEAD ↔ STAGED');
    await window.locator('.git-diff-tab').nth(1).click();
    await expect(window.locator('.git-review-axis')).toHaveText('STAGED ↔ CURRENT DOCUMENT');
    await expect(window.locator('.git-review-note')).toContainText('staged Index');
    await expect.poll(async () => (await diffPreviews(application)).length, { timeout: 20_000 })
      .toBe(2);
    const warmed = await diffPreviews(application);
    const warmedIdentity = warmed.map(({ id, url }) => ({ id, url }))
      .sort((left, right) => left.id - right.id);
    const firstFrame = await window.evaluate(async () => {
      const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
      const started = performance.now();
      tabs[0]?.click();
      return await new Promise<{ elapsed: number; axis: string; selected: boolean }>((resolve) => {
        requestAnimationFrame(() => resolve({
          elapsed: performance.now() - started,
          axis: document.querySelector('.git-review-axis')?.textContent ?? '',
          selected: tabs[0]?.getAttribute('aria-selected') === 'true',
        }));
      });
    });
    expect(firstFrame).toMatchObject({ axis: 'HEAD ↔ STAGED', selected: true });
    expect(firstFrame.elapsed).toBeLessThan(80);
    await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.text)
      .toContain('Base');
    await window.locator('.git-diff-tab').nth(1).click();
    await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.text)
      .toContain('Working tree');
    expect((await diffPreviews(application)).map(({ id, url }) => ({ id, url }))
      .sort((left, right) => left.id - right.id)).toEqual(warmedIdentity);
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
    await window.locator('.git-diff-tab').nth(0).click();
    await window.getByRole('button', { name: 'View Source Diff' }).click();
    await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
      .toContainText('Base');
    const sourceFirstFrame = await window.evaluate(async () => {
      const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
      const started = performance.now();
      tabs[1]?.click();
      return await new Promise<{ elapsed: number; text: string }>((resolve) => {
        requestAnimationFrame(() => resolve({
          elapsed: performance.now() - started,
          text: (document.querySelector('.modified-in-monaco-diff-editor .view-lines')
            ?.textContent ?? '').replace(/\s+/g, ' '),
        }));
      });
    });
    expect(sourceFirstFrame.elapsed).toBeLessThan(80);
    expect(sourceFirstFrame.text).toContain('Inserted one');
    const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await expect(workingTreeEditor).toBeEditable();
    await workingTreeEditor.press('Control+End');
    await workingTreeEditor.pressSequentially('\nShared draft');
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
    await expect.poll(async () => (await diffPreviews(application))
      .some((preview) => preview.text.includes('Shared draft')), { timeout: 20_000 }).toBe(true);
    await window.waitForTimeout(3_000);
    await expect(workingTreeEditor).toBeFocused();
    expect(await window.evaluate(() => document.hasFocus())).toBe(true);
    await expect.poll(() => shellHasKeyboardFocus(application)).toBe(true);
    await workingTreeEditor.pressSequentially(' continues');
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
      .toContainText('Shared draft continues');

    await workingTreeEditor.press('Escape');
    await expect(window.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.scrollY)
      .toBeGreaterThan(0);

    await window.locator('.document-tab:not(.git-diff-tab)').click();
    await expect.poll(reading.hasVisible).toBe(true);
    await expect.poll(() => reading.evaluate('document.body.innerText')).toContain('Shared draft');

    await changed.getByRole('button', { name: 'Stage All' }).click();
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared draft continues');
    await expect.poll(async () => (await exec('git', ['show', ':review.md'], { cwd: root })).stdout)
      .toContain('Shared draft continues');
    await expect(changed.locator('.git-change-open')).toHaveCount(0);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('returning from a review, discarding, and saving keep the document usable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-discard-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-discard-config-'));
  const documentPath = path.join(root, 'discard.md');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(documentPath, '# Base\n', 'utf8');
  await exec('git', ['add', 'discard.md'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(documentPath, '# Changed on disk\n', 'utf8');
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
    const changed = window.locator('.scm-group').filter({
      has: window.getByText('CHANGES', { exact: true }),
    });
    await changed.locator('.git-change-open').click();
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await workingTreeEditor.press('Control+End');
    await workingTreeEditor.pressSequentially('\nUnsaved buffer text');
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);

    await workingTreeEditor.press('Control+C');
    await window.locator('.document-tab:not(.git-diff-tab)').click();
    await expect(window.locator('.git-review')).toBeHidden();
    await expect(window.locator('.git-diff-editor')).toBeHidden();
    await expect.poll(reading.hasVisible).toBe(true);

    await window.locator('.git-diff-tab').click();
    await changed.getByRole('button', { name: 'Discard All Changes' }).click();
    await expect(window.getByText('Discard this change?', { exact: true })).toHaveCount(0);
    await window.locator('.document-tab:not(.git-diff-tab)').click();
    await window.getByRole('button', { name: 'Switch to Editor' }).click();
    await expect(window.locator('.editor-surface')).toBeVisible();
    await window.locator('.editor-surface .monaco-editor').click({ position: { x: 120, y: 80 } });
    const documentEditor = window.locator('.editor-surface')
      .getByRole('textbox', { name: 'Editor content' });
    await window.keyboard.press('Control+End');
    await window.keyboard.insertText('\nSaved after discard');

    await expect.poll(() => readFile(documentPath, 'utf8')).toBe('# Base\n');
    await expect(changed.locator('.git-change-open')).toHaveCount(0);
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
    await expect.poll(async () => (await reading.evaluateAll<string>('document.body.innerText'))
      .some((text) => text?.includes('Saved after discard')), { timeout: 20_000 }).toBe(true);
    await window.waitForTimeout(3_000);
    await expect(documentEditor).toBeFocused();
    expect(await window.evaluate(() => document.hasFocus())).toBe(true);
    await expect.poll(() => shellHasKeyboardFocus(application)).toBe(true);
    await documentEditor.pressSequentially(' continues');
    await window.keyboard.press('Control+S');
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Saved after discard continues');
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(0);
    await expect(documentEditor).toBeFocused();
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
