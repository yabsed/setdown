import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type Application = Awaited<ReturnType<typeof electron.launch>>;
async function reviews(app: Application) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    const data = await Promise.all((owner?.contentView.children ?? []).map(async (view) => {
      if (!('webContents' in view) || view.webContents.isDestroyed()) return null;
      const contents = view.webContents;
      if (!contents.getURL().startsWith('marktex-preview://document/')) return null;
      const result = await contents.executeJavaScript(`(() => {
        if (!document.querySelector('.setdown-rendered-diff-split')) return null;
        const target = Array.from(document.querySelectorAll('.setdown-rendered-diff-after [data-source-line]'))
          .find(el => el.textContent.includes('retained-latest'));
        const rect = target?.getBoundingClientRect();
        return { text: document.body.innerText, scroll: scrollY,
          targetVisible: !!rect && rect.bottom > 0 && rect.top < innerHeight && rect.width > 0 };
      })()`).catch(() => null);
      return result ? { id: contents.id, visible: view.getVisible(), ...result } : null;
    }));
    return data.filter((row) => row !== null);
  });
}
async function holdInstalls(app: Application, ids: number[]) {
  await app.evaluate(({ webContents }, targets) => {
    const state = globalThis as unknown as { held: (() => void)[]; restore: (() => void)[] };
    state.held = []; state.restore = [];
    for (const id of targets) {
      const contents = webContents.fromId(id)!;
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        const message = args[0] as { command?: string } | undefined;
        if (channel === 'preview:command' && ['marktex:update-html', 'marktex:patch-review-rows'].includes(message?.command ?? '')) {
          state.held.push(() => send(channel, ...args)); return;
        }
        send(channel, ...args);
      };
      state.restore.push(() => { contents.send = send; });
    }
  }, ids);
}
async function releaseInstalls(app: Application) {
  await app.evaluate(() => {
    const state = globalThis as unknown as { held: (() => void)[]; restore: (() => void)[] };
    state.restore.splice(0).forEach((restore) => restore());
    state.held.splice(0).forEach((send) => send());
  });
}

test('delayed edit-to-Esc keeps actual Monaco, then shows latest native review; further input cancels', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-retain-source-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-retain-source-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = '# Retained editor\n\n' + Array.from({ length: 100 }, (_, i) =>
      `Paragraph ${i + 1}, 한글, **Markdown** and $x_${i}+1$.\n\n`).join('');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['--no-sandbox', '.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } }).marktex.restoreProjectFolder(folder);
    }, root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    const source = page.locator('.git-diff-source-layer');
    await expect(editor).toBeEditable();
    await expect.poll(async () => (await reviews(app!)).length, { timeout: 30_000 }).toBe(2);
    const ids = (await reviews(app)).map((view) => view.id as number);
    await holdInstalls(app, ids);
    await editor.press('Control+End'); await editor.pressSequentially('\nretained-latest');
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { held: unknown[] }).held.length)).toBeGreaterThan(0);
    const element = await source.elementHandle();
    await editor.press('Escape'); await editor.press('Escape'); // native/DOM duplicate is harmless
    await expect(source).toBeVisible(); await expect(editor).toBeEditable(); await expect(editor).toBeFocused();
    await expect(page.getByText('Typesetting changes…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(page.getByText('Preparing Viewer…', { exact: true })).toBeVisible();
    expect((await reviews(app)).some((view) => view.visible)).toBe(false);
    expect(await element!.evaluate((el) => el === document.querySelector('.git-diff-source-layer'))).toBe(true);
    await releaseInstalls(app);
    await expect.poll(async () => (await reviews(app!)).find((view) => view.visible)?.text, { timeout: 20_000 }).toContain('retained-latest');
    await expect(page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect.poll(async () => (await reviews(app!)).find((view) => view.visible)?.targetVisible).toBe(true);
    expect((await reviews(app)).find((view) => view.visible)?.scroll).toBeGreaterThan(0);
    await expect(source).toHaveAttribute('inert', '');
    expect(await element!.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
    await expect(page.getByText('Typesetting changes…', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'View Source Diff' }).click();
    await expect(editor).toBeEditable(); await holdInstalls(app, ids);
    await editor.press('Control+End'); await editor.pressSequentially('\ncontinued-edit');
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { held: unknown[] }).held.length)).toBeGreaterThan(0);
    await editor.press('Escape'); await expect(source).toBeVisible();
    await editor.pressSequentially('-cancelled'); // must remain a live editor, not a screenshot/read-only proxy
    await releaseInstalls(app);
    await expect.poll(async () => (await reviews(app!)).some((view) => view.text.includes('continued-edit-cancelled')), { timeout: 20_000 }).toBe(true);
    await expect(source).toBeVisible(); await expect(editor).toBeEditable();
    expect((await reviews(app)).some((view) => view.visible)).toBe(false);
    await expect(page.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await expect(page.getByText('Typesetting changes…', { exact: true })).toHaveCount(0);
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
