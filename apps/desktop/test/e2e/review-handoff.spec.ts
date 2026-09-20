import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type Application = Awaited<ReturnType<typeof electron.launch>>;
async function reviews(app: Application, marker = '') {
  return app.evaluate(async ({ BrowserWindow }, text) => {
    const owner = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    const data = await Promise.all((owner?.contentView.children ?? []).map(async (view) => {
      if (!('webContents' in view) || view.webContents.isDestroyed()) return null;
      const contents = view.webContents;
      if (!contents.getURL().startsWith('marktex-preview://document/')) return null;
      const result = await contents.executeJavaScript(`(() => {
        if (!document.querySelector('.setdown-rendered-diff-split')) return null;
        const marker = ${JSON.stringify(text)};
        const element = Array.from(document.querySelectorAll('.setdown-rendered-diff-after [data-source-line]'))
          .find((node) => marker && node.textContent.includes(marker));
        const rect = element?.getBoundingClientRect();
        return { text: document.body.innerText, scroll: scrollY,
          inViewport: !!rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight };
      })()`).catch(() => null);
      return result ? { id: contents.id, visible: view.getVisible(), ...result } : null;
    }));
    return data.filter((row) => row !== null);
  }, marker);
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-handoff-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-handoff-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  const close = async () => {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true });
  };
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = '# Handoff fixture\n\n' + Array.from({ length: 80 }, (_, i) =>
      `Paragraph ${i + 1}, 한글, with $x_${i}+1$.\n\n`).join('');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
    // The test runner is isolated under Xvfb; this flag is NOT added to the app.
    app = await electron.launch({ args: ['--no-sandbox', '.', file], env: { ...env, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(path: string): Promise<unknown> } }).marktex.restoreProjectFolder(folder);
    }, root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await expect(editor).toBeEditable();
    await expect.poll(async () => (await reviews(app!)).length, { timeout: 30_000 }).toBe(2);
    return { app, page, editor, close };
  } catch (error) { await close(); throw error; }
}

async function hold(app: Application, marker: string) {
  const ids = (await reviews(app)).map((view) => view.id);
  await app.evaluate(({ webContents }, { ids, marker }) => {
    const state = globalThis as unknown as {
      handoff: { install: (() => void)[]; position: (() => void)[]; restore: (() => void)[] };
    };
    const held = state.handoff = { install: [], position: [], restore: [] };
    for (const id of ids) {
      const contents = webContents.fromId(id)!; const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        const message = args[0] as { command?: string; requestId?: unknown } | undefined;
        if (channel === 'preview:command') {
          if (['marktex:update-html', 'marktex:patch-review-rows'].includes(message?.command ?? '')
            && JSON.stringify(message).includes(marker)) { held.install.push(() => send(channel, ...args)); return; }
          if (message?.command === 'marktex:prepare-review'
            && typeof message.requestId === 'string' && message.requestId.startsWith('present:')) {
            held.position.push(() => send(channel, ...args)); return;
          }
        }
        send(channel, ...args);
      };
      held.restore.push(() => { contents.send = send; });
    }
  }, { ids, marker });
}
const heldCount = (app: Application, phase: 'install' | 'position') => app.evaluate((_electron, phase) =>
  (globalThis as unknown as { handoff: Record<string, unknown[]> }).handoff[phase].length, phase);
const release = (app: Application, phase: 'install' | 'position') => app.evaluate((_electron, phase) => {
  const state = (globalThis as unknown as { handoff: Record<string, (() => void)[]> }).handoff;
  if (phase === 'position') state.restore.forEach((restore) => restore());
  state[phase].splice(0).forEach((send) => send());
}, phase);

async function assertRetained(page: Page) {
  await expect(page.locator('.git-diff-source-layer')).toBeVisible();
  await expect(page.locator('.git-diff-preview-host .git-review-state')).toHaveCount(0);
  const frames = await page.evaluate(async () => {
    const result: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      const source = document.querySelector('.git-diff-source-layer')!;
      result.push(getComputedStyle(source).visibility === 'visible'
        && !document.querySelector('.git-diff-preview-host .git-review-state'));
    }
    return result;
  });
  expect(frames.every(Boolean)).toBe(true);
}

test('first edited Escape keeps real Monaco through installation and final positioning, then shows latest content', async () => {
  test.setTimeout(120_000);
  const f = await setup(); const marker = 'HANDOFF-LATEST-REVISION';
  try {
    await hold(f.app, marker);
    await f.editor.press('Control+End'); await f.page.keyboard.insertText(`\n${marker}`);
    await f.editor.evaluate((element) => { (window as unknown as { sourceNode: Element }).sourceNode = element; });
    await expect.poll(() => heldCount(f.app, 'install')).toBeGreaterThan(0);
    await f.editor.press('Escape'); await assertRetained(f.page);
    expect((await reviews(f.app)).some((view) => view.visible)).toBe(false);
    expect(await f.editor.evaluate((element) => element === (window as unknown as { sourceNode: Element }).sourceNode
      && element.contains(document.activeElement))).toBe(true);
    await release(f.app, 'install');
    await expect.poll(() => heldCount(f.app, 'position')).toBeGreaterThan(0);
    await assertRetained(f.page);
    await f.editor.press('Escape'); // Duplicate Escape does not restart the request.
    expect(await heldCount(f.app, 'position')).toBe(1);
    await release(f.app, 'position');
    await expect.poll(async () => (await reviews(f.app, marker)).find((view) => view.visible)?.inViewport,
      { timeout: 30_000 }).toBe(true);
    await expect(f.page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect(f.page.locator('.git-diff-source-layer')).not.toBeVisible();
    await expect(f.page.locator('.git-diff-preview-host .git-review-state')).toHaveCount(0);
  } finally { await f.close(); }
});

test('new source navigation cancels held handoff without losing the editor or triggering a late swap', async () => {
  test.setTimeout(120_000);
  const f = await setup(); const marker = 'HANDOFF-CANCEL-NAVIGATION';
  try {
    await hold(f.app, marker);
    await f.editor.press('Control+End'); await f.page.keyboard.insertText(`\n${marker}`);
    await expect.poll(() => heldCount(f.app, 'install')).toBeGreaterThan(0);
    await f.editor.press('Escape'); await release(f.app, 'install');
    await expect.poll(() => heldCount(f.app, 'position')).toBeGreaterThan(0);
    await f.editor.press('ArrowLeft');
    await release(f.app, 'position'); await assertRetained(f.page);
    expect((await reviews(f.app)).some((view) => view.visible)).toBe(false);
    await expect(f.editor).toBeEditable();
    await f.page.keyboard.insertText('X');
    await f.editor.press('Escape');
    await expect.poll(async () => (await reviews(f.app)).find((view) => view.visible)?.text,
      { timeout: 30_000 }).toContain('HANDOFF-CANCEL-NAVIGATIOXN');
  } finally { await f.close(); }
});
