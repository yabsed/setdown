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
    const owner = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    const data = await Promise.all((owner?.contentView.children ?? []).map(async (view) => {
      if (!('webContents' in view)) return null;
      const contents = view.webContents;
      if (!contents.getURL().startsWith('marktex-preview://document/')) return null;
      const result = await contents.executeJavaScript(`(() => {
        if (!document.querySelector('.setdown-rendered-diff-split')) return null;
        window.__latencyContext ??= Math.random().toString(36);
        return { text: document.body.innerText, context: window.__latencyContext, scroll: scrollY };
      })()`).catch(() => null) as { text: string; context: string; scroll: number } | null;
      return result ? { id: contents.id, url: contents.getURL(), visible: view.getVisible(), ...result } : null;
    }));
    return data.filter((row): row is NonNullable<typeof row> => row !== null);
  });
}

test('warm Esc presents actual content while the next installation is held', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-instant-escape-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-instant-escape-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = '# Latency fixture\n\n' + Array.from({ length: 120 }, (_, i) =>
      `Paragraph ${i + 1} with **Markdown** and $x_${i}+1$.\n\n`).join('');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } }).marktex.restoreProjectFolder(folder);
    }, root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await expect.poll(async () => (await reviews(app!)).length, { timeout: 30_000 }).toBe(2);
    for (const addition of ['warm-one', 'warm-two']) {
      await editor.press('Control+End'); await editor.pressSequentially(`\n${addition}`);
      await expect.poll(async () => (await reviews(app!)).some((view) => view.text.includes(addition)), { timeout: 30_000 }).toBe(true);
    }
    await expect.poll(async () => (await reviews(app!)).length).toBe(2);
    const before = (await reviews(app)).map(({ id, url, context }) => ({ id, url, context })).sort((a, b) => a.id - b.id);
    await app.evaluate(({ webContents }, ids) => {
      const state = globalThis as unknown as { held: (() => void)[]; restore: (() => void)[] };
      state.held = []; state.restore = [];
      for (const id of ids) {
        const contents = webContents.fromId(id)!;
        const send = contents.send.bind(contents);
        contents.send = (channel: string, ...args: unknown[]) => {
          const message = args[0] as { command?: string; html?: string } | undefined;
          if (channel === 'preview:command'
            && ['marktex:update-html', 'marktex:patch-review-rows'].includes(message?.command ?? '')
            && JSON.stringify(message).includes('held-installation')) { state.held.push(() => send(channel, ...args)); return; }
          send(channel, ...args);
        };
        state.restore.push(() => { contents.send = send; });
      }
    }, before.map((view) => view.id));
    await editor.pressSequentially('\nheld-installation');
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { held: unknown[] }).held.length)).toBeGreaterThan(0);
    await editor.press('Escape');
    await expect(page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    // The new update is still held. A loader/class toggle is not sufficient:
    // assert the native front's contents and capture an actual nonempty frame.
    const shown = (await reviews(app)).find((view) => view.visible);
    expect(shown?.text).toContain('warm-');
    expect(shown?.text).not.toContain('held-installation');
    expect(await app.evaluate(async ({ webContents }, id) => {
      return !(await webContents.fromId(id)!.capturePage()).isEmpty();
    }, shown!.id)).toBe(true);
    await app.evaluate(() => {
      const state = globalThis as unknown as { held: (() => void)[]; restore: (() => void)[] };
      state.restore.forEach((restore) => restore()); state.held.splice(0).forEach((send) => send());
    });
    await expect.poll(async () => (await reviews(app!)).find((view) => view.visible)?.text).toContain('held-installation');
    const after = (await reviews(app)).map(({ id, url, context }) => ({ id, url, context })).sort((a, b) => a.id - b.id);
    expect(after).toEqual(before);
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('edit immediately followed by Esc uses row patches and retains unchanged native-page DOM', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = '# Row identity\n\n' + Array.from({ length: 120 }, (_, i) =>
      `Paragraph ${i + 1}, 한글, **bold**, and $x_${i}+1$.\n\n`).join('');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
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
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    await expect.poll(async () => (await reviews(app!)).length, { timeout: 30_000 }).toBe(2);
    const resident = await reviews(app);
    await app.evaluate(async ({ webContents }, ids) => {
      for (const id of ids) await webContents.fromId(id)!.executeJavaScript(`(() => {
        window.__unchangedReviewRow = document.querySelectorAll('.setdown-rendered-diff-row')[30];
        window.__unchangedReviewMath = window.__unchangedReviewRow?.querySelector('.katex');
      })()`);
    }, resident.map((view) => view.id));
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    const samples: number[] = [];
    for (const addition of ['row-patch-first', 'row-patch-second']) {
      await editor.press('Control+End');
      await editor.pressSequentially(`\n${addition}`);
      const start = Date.now();
      await editor.press('Escape'); // Deliberately no idle/debounce wait after editing.
      await expect.poll(async () => (await reviews(app!)).find((view) => view.visible)?.text,
        { timeout: 30_000 }).toContain(addition);
      samples.push(Date.now() - start);
      const visible = (await reviews(app)).find((view) => view.visible)!;
      const retained = await app.evaluate(async ({ webContents }, id) =>
        webContents.fromId(id)!.executeJavaScript(`({
          row: window.__unchangedReviewRow === document.querySelectorAll('.setdown-rendered-diff-row')[30],
          math: !!window.__unchangedReviewMath && window.__unchangedReviewMath === document.querySelectorAll('.setdown-rendered-diff-row')[30]?.querySelector('.katex'),
          revision: Number(document.body.dataset.lastReviewPatchRevision || 0),
          kept: Number(document.body.dataset.lastReviewPatchRetainedRows || 0)
        })`), visible.id);
      expect(retained).toMatchObject({ row: true, math: true });
      expect(retained.revision).toBeGreaterThan(0);
      expect(retained.kept).toBeGreaterThan(100);
      expect(visible.url).toBe(resident.find((view) => view.id === visible.id)?.url);
      await page.getByRole('button', { name: 'View Source Diff' }).click();
      await expect(editor).toBeEditable();
    }
    // Diagnostic only: includes polling/IPC overhead; not a compositor P95 claim.
    console.log('edit-to-latest-review sampling (ms)', samples);
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
