import { expect, test } from '@playwright/test';
import { fixture } from '../../support/browser/browser-fixture';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { previews } from '../../support/preview/preview-view';

test('both inactive Git reader buffers are discarded and restore the edited working tree', async () => {
  test.setTimeout(120_000);
  const f = await fixture(), exec = promisify(execFile);
  try {
    await exec('git', ['init'], { cwd: f.root });
    await writeFile(path.join(f.root, '.git/info/exclude'), 'config/\n');
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: f.root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: f.root });
    await exec('git', ['add', 'notes.md'], { cwd: f.root });
    await exec('git', ['commit', '-m', 'base'], { cwd: f.root });
    await writeFile(path.join(f.root, 'notes.md'), '# Memory comparison\n\nWorking tree.\n');
    await f.page.evaluate(root => window.marktex.restoreProjectFolder(root), f.root);
    await Promise.all([f.page.waitForEvent('load'), f.page.reload()]);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await f.page.locator('.scm-group').filter({ has: f.page.getByText('CHANGES', { exact: true }) }).getByRole('button', { name: 'notes.md', exact: true }).click();
    const editor = f.page.getByRole('textbox', { name: 'Current document', exact: true });
    await editor.press('Control+End'); await editor.pressSequentially('retained Git edit'); await editor.press('Escape');
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('retained Git edit');
    const ids = () => f.app.evaluate(async ({ webContents }) => {
      const result = await Promise.all(webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('marktex-preview:')).map(async wc =>
        await wc.executeJavaScript('Boolean(document.querySelector(".setdown-rendered-diff-split"))').catch(() => false) ? wc.id : null));
      return result.filter((id): id is number => id !== null);
    });
    await expect.poll(ids).toHaveLength(2); const old = await ids();
    await f.page.locator('.document-tab:not(.git-diff-tab)').click();
    await new Promise(resolve => setTimeout(resolve, 31_000));
    await f.page.evaluate(() => window.marktex.reclaimMemory!());
    await expect.poll(() => f.app.evaluate(({ webContents }, ids) => ids.some(id => !!webContents.fromId(id)), old)).toBe(false);
    await f.page.locator('.git-diff-tab').click();
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('retained Git edit');
    expect((await ids()).some(id => old.includes(id))).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('a discarded Markdown reader regenerates the latest edited revision and retains Undo', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  try {
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially(' memory edit'); await editor.press('Escape');
    const native = () => f.app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((view): view is Electron.WebContentsView =>
        'webContents' in view && view.getVisible() && (view as Electron.WebContentsView).webContents.getURL().startsWith('marktex-preview:'));
      return view?.webContents.id ?? null;
    });
    await expect.poll(native).not.toBeNull(); const old = (await native())!;
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/memory-active`);
    await expect(f.page.getByRole('tab', { name: /memory-active/ })).toHaveAttribute('aria-selected', 'true');
    await new Promise(resolve => setTimeout(resolve, 31_000));
    await f.page.evaluate(() => window.marktex.reclaimMemory!());
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), old)).toBe(false);
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect.poll(native).not.toBeNull(); expect(await native()).not.toBe(old);
    await expect.poll(async () => f.app.evaluate(async ({ webContents }, id) =>
      webContents.fromId(id!)?.executeJavaScript('document.body.innerText'), await native())).toContain('memory edit');
    await f.page.locator('.mode-toggle').click(); await editor.press('Control+z');
    await expect.poll(async () => (await f.page.evaluate(() => window.marktex.getDocument()))?.text ?? '').not.toContain('memory edit');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('pressure discards inactive web contents, restores history/scroll, and protects edits and beforeunload', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  try {
    const open = async (name: string) => {
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/memory-${name}`);
      const tab = f.page.getByRole('tab', { name: new RegExp(`memory-${name}`) }); await expect(tab).toBeVisible();
      await expect.poll(() => f.app.context().pages().some(page => page.url() === `${f.origin}/memory-${name}`)).toBe(true);
      return { tab, page: f.app.context().pages().find(page => page.url() === `${f.origin}/memory-${name}`)! };
    };
    const safe = await open('safe');
    await safe.page.locator('a').click(); await safe.page.waitForURL(`${f.origin}/memory-next`);
    await safe.page.evaluate(() => scrollTo(0, 700));
    const id = await f.page.getByRole('tab', { name: /memory-next/ }).getAttribute('data-tab-id');
    const old = await f.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, `${f.origin}/memory-next`);
    const edited = await open('edited'); await edited.page.locator('#draft').fill('Never discard this draft');
    const guarded = await open('guarded');
    // Electron owns beforeunload. Playwright must not answer the same native event.
    guarded.page.on('dialog', () => {});
    await guarded.page.locator('#guard').click();
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    const before = await f.page.evaluate(() => window.marktex.getMemorySnapshot!());
    // Exercise the production grace period, without faking clocks or enabling a test-only discard path.
    await new Promise(resolve => setTimeout(resolve, 31_000));
    await f.page.evaluate(() => window.marktex.reclaimMemory!());
    await expect(f.page.locator(`[data-tab-id="${id}"]`)).toHaveAttribute('data-sleeping', 'true');
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), old)).toBe(false);
    expect(await edited.page.locator('#draft').inputValue()).toBe('Never discard this draft');
    expect(guarded.page.isClosed()).toBe(false);
    const asleep = await f.page.evaluate(() => window.marktex.getMemorySnapshot!());
    expect(asleep.resources.sleepingWebPages).toBe(1);
    await f.page.locator(`[data-tab-id="${id}"]`).click();
    await expect(f.page.locator(`[data-tab-id="${id}"]`)).not.toHaveAttribute('data-sleeping', 'true');
    await expect.poll(() => f.app.context().pages().some(page => page.url() === `${f.origin}/memory-next`)).toBe(true);
    const restored = f.app.context().pages().find(page => page.url() === `${f.origin}/memory-next`)!;
    await expect.poll(() => restored.evaluate(() => scrollY)).toBe(700);
    const history = await f.page.evaluate(id => window.marktex.browser.history(id!), id);
    expect(history.entries.map(page => page.url)).toEqual([`${f.origin}/memory-safe`, `${f.origin}/memory-next`]);
    await test.info().attach('memory', { body: JSON.stringify({ before, asleep }, null, 2), contentType: 'application/json' });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
