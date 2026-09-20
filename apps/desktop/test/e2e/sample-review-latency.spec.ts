/** Diagnostic fixture for the real math-heavy sample; no latency pass/fail gate.
 * SETDOWN_PROFILE_REVIEW=1 optionally saves native CPU profiles in test output.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
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

test('sample math document immediate Escape diagnostics', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-row-escape-config-'));
  const file = path.join(root, 'review.md');
  let app: Application | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = await readFile(path.resolve('test/fixtures/sample.md'), 'utf8');
    await writeFile(file, text); await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + 'Working tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    await app.evaluate(({ app, ipcMain, webContents }) => {
      const state = globalThis as any;
      state.reviewTrace = [];
      const record = (kind: string, value: any) => state.reviewTrace.push({ t: Date.now(), kind, ...value });
      const watch = (contents: any) => {
        const send = contents.send.bind(contents);
        contents.send = (channel: string, ...args: any[]) => {
          const m = args[0];
          if (channel === 'preview:command') record('command', { id: contents.id,
            command: m?.command, revision: m?.revision, requestId: m?.requestId,
            bytes: m?.patch ? JSON.stringify(m.patch).length : undefined });
          return send(channel, ...args);
        };
      };
      webContents.getAllWebContents().forEach(watch);
      app.on('web-contents-created', (_event, contents) => watch(contents));
      ipcMain.on('preview:message', (event, m) => {
        if (['marktex:html-updated', 'marktex:review-prepared'].includes(m?.type))
          record('ack', { id: event.sender.id, type: m.type, revision: m.revision, requestId: m.requestId });
      });
      ipcMain.on('preview:show', (_event, m) => record('show', { tabId: m.tabId }));
    });
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
        window.__unchangedRowIndex = Array.from(document.querySelectorAll('.setdown-rendered-diff-row')).findIndex((row, i) => i > 20 && row.querySelector('.katex'));
        window.__unchangedReviewRow = document.querySelectorAll('.setdown-rendered-diff-row')[window.__unchangedRowIndex];
        window.__unchangedReviewMath = window.__unchangedReviewRow?.querySelector('.katex');
      })()`);
    }, resident.map((view) => view.id));
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    // Record the event in the shell; polling below only reads main-process metadata.
    // Reading native innerText during the timed interval would force layout.
    await page.evaluate(() => {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') (window as any).escapeAt = Date.now();
      }, { capture: true });
    });
    const samples: number[] = [];
    for (const addition of ['sample-prose-one', 'sample-prose-two', 'sample-math $\\sum_{i=1}^{n} i^2$', 'sample-prose-three']) {
      await editor.press('Control+End');
      await app.evaluate(async ({ webContents }, { ids, profile }) => {
        (globalThis as any).reviewTrace = [];
        if (!profile) return;
        for (const id of ids) {
          const d = webContents.fromId(id)!.debugger;
          if (!d.isAttached()) d.attach('1.3');
          await d.sendCommand('Profiler.enable');
          await d.sendCommand('Profiler.start');
        }
      }, { ids: resident.map(v => v.id), profile: process.env.SETDOWN_PROFILE_REVIEW === '1' });
      await page.keyboard.insertText(`\n${addition}`);
      const start = Date.now();
      await editor.press('Escape'); // Deliberately no idle/debounce wait after editing.
      await expect.poll(() => app!.evaluate(() => (globalThis as any).reviewTrace.some((e: any) => e.kind === 'show' && e.tabId)),
        { timeout: 30_000, intervals: [10, 20, 50] }).toBe(true);
      samples.push(Date.now() - start);
      if (process.env.SETDOWN_PROFILE_REVIEW === '1') {
        const profiles = await app.evaluate(async ({ webContents }, ids) => Promise.all(ids.map(async id => ({
          id, ...(await webContents.fromId(id)!.debugger.sendCommand('Profiler.stop')),
        }))), resident.map(v => v.id));
        await writeFile(test.info().outputPath(`native-${samples.length}.cpuprofile.json`), JSON.stringify(profiles));
      }
      const escapeAt = await page.evaluate(() => (window as any).escapeAt);
      const trace = await app.evaluate(() => (globalThis as any).reviewTrace);
      console.log(JSON.stringify({ addition, escapeAt, trace: trace.map((e: any) => ({ ...e, sinceEscape: e.t - escapeAt })) }));
      const visible = (await reviews(app)).find((view) => view.visible)!;
      expect(visible.text).toContain(addition.split(' $')[0]);
      const retained = await app.evaluate(async ({ webContents }, id) =>
        webContents.fromId(id)!.executeJavaScript(`({
          row: window.__unchangedReviewRow === document.querySelectorAll('.setdown-rendered-diff-row')[window.__unchangedRowIndex],
          math: !!window.__unchangedReviewMath && window.__unchangedReviewMath === document.querySelectorAll('.setdown-rendered-diff-row')[window.__unchangedRowIndex]?.querySelector('.katex'),
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
    console.log('Escape-to-native-show polling samples (ms; not pixels)', samples);
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
