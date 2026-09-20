/** Cold Esc/double-click diagnostics. No timing gate or hidden DOM measurement.
 * SETDOWN_TRACE_CYCLES=1 records Chromium work; SETDOWN_CYCLES_IDLE_MS controls
 * the delay before the first Esc (default 0). Captures are not presentation fences.
 * SETDOWN_CYCLES_EDIT=1 inserts a new paragraph immediately before each Esc.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
test('sample math cold Esc and real double-click cycles', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-cycles-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-cycles-config-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const text = await readFile(path.resolve('test/fixtures/sample.md'), 'utf8');
    const file = path.join(root, 'sample.md');
    await writeFile(file, text);
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(file, text + '\nWorking tree\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
    const page = await app.firstWindow();
    await page.evaluate(async folder => (window as any).marktex.restoreProjectFolder(folder), root);
    await page.addInitScript(() => window.addEventListener('keydown', event => {
      if (event.key === 'Escape') (window as any).cycleEscapeAt = Date.now();
    }, { capture: true }));
    await page.reload();
    await app.evaluate(({ app, ipcMain, webContents, WebContentsView }) => {
      const state = globalThis as any;
      state.cycleTrace = [];
      const record = (kind: string, value: any) => state.cycleTrace.push({ t: Date.now(), kind, ...value });
      const watch = (contents: Electron.WebContents) => {
        const send = contents.send.bind(contents);
        contents.send = (channel, ...args) => {
          const m = args[0];
          if (channel === 'preview:command') record('command', { id: contents.id,
            command: m?.command, revision: m?.revision, requestId: m?.requestId, sourceLine: m?.sourceLine });
          return send(channel, ...args);
        };
        contents.on('did-finish-load', () => record('loaded', { id: contents.id }));
      };
      webContents.getAllWebContents().forEach(watch);
      app.on('web-contents-created', (_event, contents) => watch(contents));
      const visible = WebContentsView.prototype.setVisible;
      WebContentsView.prototype.setVisible = function (value) {
        visible.call(this, value);
        record('visible', { id: this.webContents.id, value, bounds: this.getBounds() });
      };
      ipcMain.on('preview:message', (event, m) => {
        if (['marktex:html-updated', 'marktex:review-prepared', 'edit-at-anchor'].includes(m?.type))
          record('ack', { id: event.sender.id, type: m.type, revision: m.revision, requestId: m.requestId });
      });
      ipcMain.on('preview:show', (_event, m) => record('show', { tabId: m.tabId }));
    });
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    if (process.env.SETDOWN_TRACE_CYCLES === '1') await app.evaluate(({ contentTracing }) =>
      contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink',
        'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] }));
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) })
      .locator('.git-change-open').click();
    const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await expect(editor).toBeEditable();
    const idle = Number(process.env.SETDOWN_CYCLES_IDLE_MS || 0);
    if (idle) await page.waitForTimeout(idle);
    // Optional geometry probe is kept out of the ordinary latency runs.
    const hiddenGeometry = process.env.SETDOWN_TRACE_CYCLES === '1'
      ? await app.evaluate(async ({ BrowserWindow }) => Promise.all(
        BrowserWindow.getAllWindows()[0].contentView.children.map(async view => {
          if (!('webContents' in view)) return null;
          return { id: view.webContents.id, bounds: view.getBounds(), visible: view.getVisible(),
            document: await view.webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight,
              review: !!document.querySelector('.setdown-rendered-diff-split'),
              fonts: document.fonts.status, visibility: document.visibilityState })`).catch(() => null) };
        }))) : undefined;
    const samples = [];
    for (let cycle = 1; cycle <= 5; cycle++) {
      if (process.env.SETDOWN_CYCLES_EDIT === '1') {
        await editor.press('Control+End');
        await page.keyboard.insertText(`\n\ncycle-edit-${cycle}`);
      }
      const traceStart = await app.evaluate(() => (globalThis as any).cycleTrace.length);
      await editor.press('Escape');
      const escapeAt = await page.evaluate(() => (window as any).cycleEscapeAt as number);
      // Main-process visibility checks cannot force the hidden document's layout.
      await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
        .contentView.children.some(v => 'webContents' in v && v.getVisible())),
      { timeout: 30_000, intervals: [10, 20, 50] }).toBe(true);
      const capture = await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v =>
          'webContents' in v && v.getVisible()) as Electron.WebContentsView;
        const start = Date.now();
        const image = await view.webContents.capturePage();
        return { id: view.webContents.id, start, end: Date.now(), empty: image.isEmpty() };
      });
      expect(capture.empty).toBe(false);
      const trace = await app.evaluate(() => (globalThis as any).cycleTrace);
      const afterEscape = trace.slice(traceStart);
      const show = afterEscape.find((e: any) => e.kind === 'show' && e.tabId);
      const sample = { cycle, escapeAt, showMs: show?.t - escapeAt,
        captureMs: capture.end - escapeAt, viewId: capture.id,
        trace: afterEscape.map((e: any) => ({ ...e, sinceEscape: e.t - escapeAt })) };
      samples.push(sample);
      console.log(JSON.stringify(sample));
      const content = await app.evaluate(({ webContents }, id) => webContents.fromId(id)!
        .executeJavaScript(`({ math: document.querySelectorAll('.katex').length,
          text: document.querySelector('.setdown-rendered-diff-split')?.textContent })`), capture.id);
      expect(content.math).toBeGreaterThan(100);
      if (process.env.SETDOWN_CYCLES_EDIT === '1') expect(content.text).toContain(`cycle-edit-${cycle}`);
      // Browser input uses CSS coordinates and does not depend on OS window focus.
      // Attach only after timing; do not dispatch a synthetic DOM dblclick event.
      await app.evaluate(async ({ webContents }, id) => {
        const contents = webContents.fromId(id)!;
        const point = await contents.executeJavaScript(
          '({ x: Math.round(innerWidth * .75), y: Math.round(innerHeight * .4) })');
        contents.debugger.attach('1.3');
        try {
          for (const clickCount of [1, 2]) {
            await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
              type: 'mousePressed', button: 'left', clickCount, ...point });
            await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseReleased', button: 'left', clickCount, ...point });
          }
        } finally { contents.debugger.detach(); }
      }, capture.id);
      try {
        await expect(page.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
      } catch (error) {
        await writeFile(test.info().outputPath('failed-cycle.json'), JSON.stringify({ samples,
          trace: await app.evaluate(() => (globalThis as any).cycleTrace) }, null, 2));
        throw error;
      }
      await expect(editor).toBeEditable();
    }
    if (process.env.SETDOWN_TRACE_CYCLES === '1') await app.evaluate(({ contentTracing }, file) =>
      contentTracing.stopRecording(file), test.info().outputPath('cycles-trace.json'));
    await writeFile(test.info().outputPath('cycles.json'), JSON.stringify({ idle,
      edits: process.env.SETDOWN_CYCLES_EDIT === '1', hiddenGeometry, samples,
      trace: await app.evaluate(() => (globalThis as any).cycleTrace) }, null, 2));
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
