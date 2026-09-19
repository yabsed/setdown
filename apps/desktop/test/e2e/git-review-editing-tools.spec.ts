import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
type Application = Awaited<ReturnType<typeof electron.launch>>;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-editing-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-editing-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  const cleanup = async () => {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  };
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    await writeFile(file, '# Base\n\nOriginal paragraph.\n');
    await exec('git', ['add', 'review.md'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, '# Staged\n\nOriginal paragraph.\n');
    await exec('git', ['add', 'review.md'], { cwd: root });
    await writeFile(file, '# Working Tree\n\nOriginal paragraph.\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } })
        .marktex.restoreProjectFolder(folder);
    }, root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const changed = page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) });
    await changed.locator('.git-change-open').filter({ hasText: 'review.md' }).click();
    const source = page.locator('.git-diff-editor').getByRole('textbox', { name: 'Current document', exact: true });
    await expect(source).toBeEditable();
    const buffer = () => page.evaluate(async () => (await (window as unknown as {
      marktex: { getDocument(): Promise<{ text: string } | null> };
    }).marktex.getDocument())?.text ?? '');
    return { root, file, app, page, source, buffer, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

test('Working Tree shares table/link popovers, Ctrl+K, smart paste and native image storage', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  const { app, page, source } = f;
  try {
    await expect(page.locator('.insert-table-button')).toBeVisible();
    await expect(page.locator('.insert-link-button')).toBeVisible();
    await source.press(`${mod}+End`);
    await page.locator('.insert-table-button').click();
    await page.locator('.table-size-cell[data-columns="2"][data-rows="2"]').click();
    await expect(page.locator('.table-popover')).toBeHidden();
    await expect.poll(f.buffer).toContain('| Column 1 | Column 2 |');
    const tableText = await f.buffer();

    await source.press(`${mod}+End`);
    await source.press(`${mod}+k`);
    await expect(page.locator('.link-popover')).toBeVisible();
    await page.locator('.link-destination').fill('www.example.com/docs');
    await page.locator('.link-label').fill('Documentation');
    await page.locator('.link-submit').click();
    await expect.poll(f.buffer).toContain('[Documentation](<https://www.example.com/docs>)');
    await source.press(`${mod}+z`);
    await expect.poll(f.buffer).toBe(tableText);
    await source.press(`${mod}+Shift+z`);
    await expect.poll(f.buffer).toContain('[Documentation](<https://www.example.com/docs>)');

    await source.press(`${mod}+End`);
    await source.pressSequentially('\nSelected label');
    await source.press('Shift+Home');
    await app.evaluate(({ clipboard }) => clipboard.writeText('https://example.com/selected'));
    await source.press(`${mod}+v`);
    await expect.poll(f.buffer).toContain('[Selected label](<https://example.com/selected>)');

    // Escape in an insertion popup closes the popup, not the source diff.
    await source.press(`${mod}+k`);
    await expect(page.locator('.link-popover')).toBeVisible();
    await page.locator('.link-destination').press('Escape');
    await expect(page.locator('.link-popover')).toBeHidden();
    await expect(source).toBeVisible();
    await expect(source).toBeFocused();

    const linked = path.join(f.root, 'linked file.txt');
    await writeFile(linked, 'A linked file');
    await source.press(`${mod}+End`);
    await page.locator('.insert-link-button').click();
    // Keep the actual file-link IPC/path logic; replace only the native chooser.
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
    }, linked);
    await page.getByRole('button', { name: 'Choose file', exact: true }).click();
    await expect(page.locator('.link-destination')).toHaveValue(/linked(?:%20| )file\.txt/);
    await page.locator('.link-submit').click();
    await expect.poll(f.buffer).toContain('linked');

    // Real Electron clipboard -> asset file -> modified Monaco -> live document.
    await source.press(`${mod}+End`);
    await app.evaluate(({ clipboard, nativeImage }) => clipboard.writeImage(nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGPU6LnEAANMDEgANwcATIYBjqzlNOgAAAAASUVORK5CYII=',
    )));
    await source.press(`${mod}+v`);
    await expect.poll(f.buffer).toMatch(/!\[[^\]]*\]\(/);
    await source.press(`${mod}+s`);
    await expect.poll(() => readFile(f.file, 'utf8')).toMatch(/!\[[^\]]*\]\(/);
    const markdown = await readFile(f.file, 'utf8');
    const imagePath = /!\[[^\]]*\]\(<?([^>\)]+)>?\)/.exec(markdown)?.[1];
    expect(imagePath).toBeTruthy();
    await access(path.resolve(f.root, decodeURIComponent(imagePath!)));
    expect((await exec('git', ['show', ':review.md'], { cwd: f.root })).stdout)
      .toBe('# Staged\n\nOriginal paragraph.\n');
    await source.press('Escape');
    await expect(page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect(page.locator('.insert-link-button')).toBeHidden();
  } finally { await f.cleanup(); }
});

test('read-only Index/original, commit text, ordinary Markdown and tab roundtrips stay isolated', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  try {
    const before = await f.buffer();
    const original = f.page.locator('.git-diff-editor').getByRole('textbox', { name: 'Staged version', exact: true });
    await f.app.evaluate(({ clipboard }) => clipboard.writeText('https://example.com/no-mutation'));
    await original.click(); await original.press(`${mod}+a`); await original.press(`${mod}+v`);
    expect(await f.buffer()).toBe(before);

    const message = f.page.getByRole('textbox', { name: 'Commit message', exact: true });
    await message.click(); await message.press(`${mod}+v`);
    await expect(message).toHaveValue('https://example.com/no-mutation');
    expect(await f.buffer()).toBe(before);

    const staged = f.page.locator('.scm-group').filter({ has: f.page.getByText('STAGED CHANGES', { exact: true }) });
    await staged.locator('.git-change-open').filter({ hasText: 'review.md' }).click();
    await expect(f.page.locator('.insert-link-button')).toBeHidden();
    await expect(f.page.locator('.insert-table-button')).toBeHidden();
    const index = f.page.locator('.git-diff-editor').getByRole('textbox', { name: 'Staged version', exact: true });
    await index.click(); await index.press(`${mod}+k`);
    await expect(f.page.locator('.link-popover')).toBeHidden();

    await f.page.locator('.document-tab:not(.git-diff-tab)').click();
    const edit = f.page.getByRole('button', { name: 'Switch to Editor' });
    if (await edit.isVisible()) await edit.click();
    await expect(f.page.locator('.insert-table-button')).toBeVisible();
    await f.page.locator('.insert-link-button').click();
    await expect(f.page.locator('.link-popover')).toBeVisible();
    await f.page.locator('.link-popover').getByRole('button', { name: 'Close', exact: true }).click();
    await f.page.locator('.git-diff-tab').filter({ hasText: '(Working Tree)' }).click();
    await expect(f.page.locator('.insert-link-button')).toBeVisible();
    await expect(f.source).toBeEditable();
  } finally { await f.cleanup(); }
});
