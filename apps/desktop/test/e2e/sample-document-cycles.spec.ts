/** Ordinary Markdown Esc diagnostics, without timing gates. Each test launches
 * a fresh app. Capture includes polling/IPC/readback, not monitor presentation.
 * The ordinary document opens in reader mode before the first source edit.
 * SETDOWN_DOCUMENT_READER_IDLE_MS waits in that reader before entering source.
 * SETDOWN_TRACE_DOCUMENT_CYCLES=1 enables a separate Chromium trace run.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

for (const idle of [0, 3000]) for (const edits of [false, true]) {
  test(`ordinary sample math cycles idle=${idle} edits=${edits}`, async () => {
    test.setTimeout(120_000);
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-document-cycles-'));
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    const samples: Record<string, unknown>[] = [];
    const readerIdle = Number(process.env.SETDOWN_DOCUMENT_READER_IDLE_MS || 0);
    try {
      const file = path.join(root, 'sample.md');
      await writeFile(file, await readFile(path.resolve('test/fixtures/sample.md')));
      const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
      app = await electron.launch({ args: ['.', file],
        env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') } });
      const page = await app.firstWindow();
      await page.evaluate(() => window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          (window as any).cycleEscapeAt = Date.now();
          console.timeStamp('document-cycle-escape');
        }
      }, { capture: true }));
      await app.evaluate(({ ipcMain, webContents }) => {
        const state = globalThis as any;
        state.documentCycleTrace = [];
        const record = (kind: string, value: any) =>
          state.documentCycleTrace.push({ t: Date.now(), kind, ...value });
        for (const contents of webContents.getAllWebContents()) {
          const send = contents.send.bind(contents);
          contents.send = (channel, ...args) => {
            if (channel === 'preview:command') record('command', {
              id: contents.id, command: args[0]?.command, revision: args[0]?.revision });
            return send(channel, ...args);
          };
        }
        ipcMain.on('preview:show', (_event, message) => record('show', { tabId: message.tabId }));
        ipcMain.on('preview:message', (event, message) => {
          if (['marktex:html-updated', 'edit-at-anchor'].includes(message?.type))
            record('ack', { id: event.sender.id, type: message.type, revision: message.revision });
        });
      });
      await expect(page.locator('.viewer-surface')).toBeVisible();
      if (readerIdle) await page.waitForTimeout(readerIdle);
      await page.locator('.mode-toggle').click();
      const editor = page.getByRole('textbox', { name: 'Editor content' });
      await expect(editor).toBeEditable();
      if (process.env.SETDOWN_TRACE_DOCUMENT_CYCLES === '1') await app.evaluate(({ contentTracing }) =>
        contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink',
          'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] }));
      if (idle) await page.waitForTimeout(idle);
      if (process.env.SETDOWN_TRACE_DOCUMENT_CYCLES === '1') console.log('hidden-document',
        await app.evaluate(async ({ BrowserWindow }) => Promise.all(BrowserWindow.getAllWindows()[0]
          .contentView.children.map(async view => 'webContents' in view ? {
            bounds: view.getBounds(), visible: view.getVisible(),
            geometry: await view.webContents.executeJavaScript(`({ width:innerWidth, height:innerHeight,
              visibility:document.visibilityState, pending:document.body.dataset.setdownPendingBlockCount })`).catch(() => null),
          } : null))));

      for (let cycle = 1; cycle <= 5; cycle++) {
        const marker = `document-cycle-edit-${cycle}`;
        if (edits) {
          await editor.press('Control+End');
          await page.keyboard.insertText(`\n\n${marker}`);
        }
        const traceStart = await app.evaluate(() => (globalThis as any).documentCycleTrace.length);
        await editor.press('Escape');
        const escapeAt = await page.evaluate(() => (window as any).cycleEscapeAt as number);
        await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
          .contentView.children.some(view => 'webContents' in view && view.getVisible())),
        { timeout: 30_000, intervals: [10, 20, 50] }).toBe(true);
        const viewId = await app.evaluate(({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
            'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView;
          return view.webContents.id;
        });
        // For edits, wait for the appended paragraph before making the only
        // capture. Back-to-back captures can add readback scheduling delay.
        if (edits) await expect.poll(() => app!.evaluate(({ webContents }, id) =>
          webContents.fromId(id)!.executeJavaScript(
            "document.querySelector('.markdown-preview')?.textContent || ''"), viewId),
        { timeout: 30_000, intervals: [10, 20, 50] }).toContain(marker);
        const capture = await app.evaluate(async ({ webContents }, id) => {
          const image = await webContents.fromId(id)!.capturePage();
          return { id, end: Date.now(), empty: image.isEmpty() };
        }, viewId);
        expect(capture.empty).toBe(false);
        const readContent = () => app!.evaluate(({ webContents }, id) => webContents.fromId(id)!
          .executeJavaScript(`({ math: document.querySelectorAll('.katex').length,
            text: document.querySelector('.markdown-preview')?.textContent || '',
            width: innerWidth, height: innerHeight })`), capture.id);
        const content = await readContent();
        if (edits) expect(content.text).toContain(marker);
        await expect.poll(async () => (await readContent()).math).toBeGreaterThan(100);
        const trace = (await app.evaluate(() => (globalThis as any).documentCycleTrace)).slice(traceStart);
        const show = trace.find((event: any) => event.kind === 'show' && event.tabId);
        const sample = { cycle, escapeAt, showMs: show?.t - escapeAt,
          captureMs: capture.end - escapeAt, captureRequiresLatestContent: edits,
          mathAtPostCaptureRead: content.math,
          viewId: capture.id, geometry: { width: content.width, height: content.height },
          trace: trace.map((event: any) => ({ ...event, sinceEscape: event.t - escapeAt })) };
        samples.push(sample);

        // Deliver browser mouse input after measurement, without a synthetic DOM event.
        const doubleClickAt = await app.evaluate(async ({ webContents }, id) => {
          const contents = webContents.fromId(id)!;
          await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const point = await contents.executeJavaScript(
            '({ x: Math.round(innerWidth * .5), y: Math.round(innerHeight * .4) })');
          contents.debugger.attach('1.3');
          let at = 0;
          try {
            await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
            for (const clickCount of [1, 2]) {
              if (clickCount === 2) at = Date.now();
              await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
                type: 'mousePressed', button: 'left', buttons: 1, clickCount, ...point });
              await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseReleased', button: 'left', buttons: 0, clickCount, ...point });
            }
          } finally { contents.debugger.detach(); }
          return at;
        }, capture.id);
        await expect(editor).toBeEditable();
        await expect(page.locator('.editor-surface')).toBeVisible();
        Object.assign(sample, { doubleClickToEditorMs: Date.now() - doubleClickAt });
        console.log(JSON.stringify({ ...sample, trace: undefined }));
      }
      if (process.env.SETDOWN_TRACE_DOCUMENT_CYCLES === '1') await app.evaluate(({ contentTracing }, file) =>
        contentTracing.stopRecording(file), test.info().outputPath('document-cycles-trace.json'));
    } finally {
      const trace = app ? await app.evaluate(() => (globalThis as any).documentCycleTrace)
        .catch(() => undefined) : undefined;
      await writeFile(test.info().outputPath('document-cycles.json'), JSON.stringify({ readerIdle, idle, edits, samples, trace }, null, 2));
      if (app) await disposeApplication(app);
      await rm(root, { recursive: true, force: true });
    }
  });
}
