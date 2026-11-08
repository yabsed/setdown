import { expect, test } from '@playwright/test';
import { fixture } from '../../support/browser/browser-fixture';
import { previews } from '../../support/preview/preview-view';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

async function visibleId(f: Awaited<ReturnType<typeof fixture>>) {
  return f.app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && v.getVisible() && (v as Electron.WebContentsView).webContents.getURL().startsWith('marktex-preview:')) as Electron.WebContentsView | undefined;
    return view?.webContents.id ?? null;
  });
}
async function crash(f: Awaited<ReturnType<typeof fixture>>, id: number) {
  await f.app.evaluate(async ({ webContents }, id) => {
    const contents = webContents.fromId(id)!;
    const gone = new Promise<void>(resolve => contents.prependOnceListener('render-process-gone', () => resolve()));
    contents.forcefullyCrashRenderer(); await gone;
  }, id);
  await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), id)).toBe(false);
}
for (const phase of ['visible', 'source', 'hidden'] as const) test(`a crashed ${phase} Markdown reader recovers current text and Undo without reloading the file`, async () => {
  const f = await fixture();
  let stderr = ''; const capture = (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-32768); }; f.app.process().stderr?.on('data', capture);
  try {
    await expect.poll(() => visibleId(f)).not.toBeNull();
    const old = (await visibleId(f))!;
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content', exact: true });
    await editor.press('Control+End'); await editor.pressSequentially(' latest unsaved recovery text');
    if (phase !== 'source') await editor.press('Escape');
    if (phase === 'hidden') { await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`); await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible(); }
    await crash(f, old);
    if (phase === 'source') await editor.press('Escape');
    if (phase === 'hidden') await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect.poll(() => visibleId(f)).not.toBeNull(); expect(await visibleId(f)).not.toBe(old);
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('latest unsaved recovery text');
    await f.page.locator('.mode-toggle').click(); await editor.press('Control+z');
    await expect.poll(async () => (await f.page.evaluate(() => window.marktex.getDocument()))?.text).not.toContain('latest unsaved recovery text');
    expect(f.errors).toEqual([]);
  } finally {
    await test.info().attach('electron-stderr', { body: stderr, contentType: 'text/plain' });
    await test.info().attach('native-views', { body: JSON.stringify(await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().map(wc => ({ id: wc.id, crashed: wc.isCrashed(), url: wc.getURL(), listeners: wc.listenerCount('render-process-gone') }))).catch(() => null)), contentType: 'application/json' });
    await f.dispose();
  }
});
test('a repeated reader crash offers retry and source instead of a blank pane or crash loop', async () => {
  const f = await fixture();
  let stderr = ''; const capture = (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-32768); }; f.app.process().stderr?.on('data', capture);
  try {
    await expect.poll(() => visibleId(f)).not.toBeNull(); await crash(f, (await visibleId(f))!);
    await expect.poll(() => visibleId(f)).not.toBeNull(); await crash(f, (await visibleId(f))!);
    await expect(f.page.getByRole('button', { name: 'Retry preview' })).toBeVisible();
    expect(await visibleId(f)).toBeNull();
    await f.page.getByRole('button', { name: 'Retry preview' }).click();
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('Notes');
    await expect(f.page.getByRole('button', { name: 'Retry preview' })).toBeHidden();
    expect(f.errors).toEqual([]);
  } finally {
    await test.info().attach('electron-stderr', { body: stderr, contentType: 'text/plain' });
    await test.info().attach('native-views', { body: JSON.stringify(await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().map(wc => ({ id: wc.id, crashed: wc.isCrashed(), url: wc.getURL(), listeners: wc.listenerCount('render-process-gone') }))).catch(() => null)), contentType: 'application/json' });
    await f.dispose();
  }
});

test('Git reader failure replaces both native buffers and retains the editable working tree and Undo', async () => {
  const f = await fixture(), exec = promisify(execFile);
  try {
    await exec('git', ['init'], { cwd: f.root });
    await writeFile(path.join(f.root, '.git/info/exclude'), 'config/\n');
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: f.root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: f.root });
    await exec('git', ['add', 'notes.md'], { cwd: f.root }); await exec('git', ['commit', '-m', 'base'], { cwd: f.root });
    await writeFile(path.join(f.root, 'notes.md'), '# Recovery comparison\n\nWorking tree.\n');
    await f.page.evaluate(root => window.marktex.restoreProjectFolder(root), f.root);
    await Promise.all([f.page.waitForEvent('load'), f.page.reload()]);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await f.page.locator('.scm-group').filter({ has: f.page.getByText('CHANGES', { exact: true }) }).getByRole('button', { name: 'notes.md', exact: true }).click();
    const editor = f.page.getByRole('textbox', { name: 'Current document', exact: true });
    await editor.press('Control+End'); await editor.pressSequentially('retained Git recovery'); await editor.press('Escape');
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('retained Git recovery');
    const ids = await f.app.evaluate(async ({ webContents }) => (await Promise.all(webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('marktex-preview:')).map(async wc => await wc.executeJavaScript('Boolean(document.querySelector(".setdown-rendered-diff-split"))') ? wc.id : null))).filter((id): id is number => id !== null));
    expect(ids).toHaveLength(2);
    await crash(f, (await visibleId(f))!);
    await expect.poll(() => f.app.evaluate(({ webContents }, ids) => ids.some(id => !!webContents.fromId(id)), ids)).toBe(false);
    await expect.poll(() => previews(f.app).evaluate('document.body.innerText')).toContain('retained Git recovery');
    await f.page.getByRole('button', { name: 'View Source Diff', exact: true }).click();
    await editor.press('Control+z');
    await expect(f.page.locator('.git-diff-editor .monaco-editor').filter({ has: editor }).locator('.view-lines'))
      .not.toContainText('retained Git recovery');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
