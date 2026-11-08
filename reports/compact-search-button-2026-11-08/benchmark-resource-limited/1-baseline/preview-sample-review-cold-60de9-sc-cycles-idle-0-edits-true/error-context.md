# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview/sample-review-cold-cycles.spec.ts >> sample math cold Esc cycles idle=0 edits=true
- Location: ../../../../../home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/desktop/test/e2e/preview/sample-review-cold-cycles.spec.ts:22:39

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Test source

```ts
  6   |  * SETDOWN_CYCLES_EDIT=1 inserts a new paragraph immediately before each Esc.
  7   |  * SETDOWN_CYCLES_RETURN=button isolates Esc timing from native double-click delivery.
  8   |  */
  9   | import { execFile } from 'node:child_process';
  10  | import { promisify } from 'node:util';
  11  | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  12  | import os from 'node:os';
  13  | import path from 'node:path';
  14  | import { expect, test } from '@playwright/test';
  15  | import { disposeApplication } from '../../support/electron/electron-app';
  16  | import { cycleElectronExecutable, cycleSampleFixture, doubleClickPreview } from '../../support/preview/preview-cycle-input';
  17  | 
  18  | const exec = promisify(execFile);
  19  | const matrix = process.env.SETDOWN_BENCH_MATRIX === '1'
  20  |   ? [0, 3000].flatMap(idle => [false, true].map(edits => ({ idle, edits })))
  21  |   : [{ idle: Number(process.env.SETDOWN_CYCLES_IDLE_MS || 0), edits: process.env.SETDOWN_CYCLES_EDIT === '1' }];
  22  | for (const { idle, edits } of matrix) test(`sample math cold Esc cycles idle=${idle} edits=${edits}`, async () => {
  23  |   test.setTimeout(120_000);
  24  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-cycles-'));
  25  |   const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-cold-cycles-config-'));
  26  |   let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  27  |   try {
  28  |     await exec('git', ['init'], { cwd: root });
  29  |     await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  30  |     await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  31  |     const text = await readFile(cycleSampleFixture, 'utf8');
  32  |     const file = path.join(root, 'sample.md');
  33  |     await writeFile(file, text);
  34  |     await exec('git', ['add', '.'], { cwd: root });
  35  |     await exec('git', ['commit', '-m', 'base'], { cwd: root });
  36  |     await writeFile(file, text + '\nWorking tree\n');
  37  |     const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  38  |     app = await electron.launch({ executablePath: cycleElectronExecutable, args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
  39  |     const page = await app.firstWindow();
  40  |     await page.evaluate(async folder => (window as any).marktex.restoreProjectFolder(folder), root);
  41  |     await page.addInitScript(() => window.addEventListener('keydown', event => {
  42  |       if (event.key === 'Escape') (window as any).cycleEscapeAt = Date.now();
  43  |     }, { capture: true }));
  44  |     await page.reload();
  45  |     await app.evaluate(({ app, ipcMain, webContents, WebContentsView }) => {
  46  |       const state = globalThis as any;
  47  |       state.cycleTrace = [];
  48  |       const record = (kind: string, value: any) => state.cycleTrace.push({ t: Date.now(), kind, ...value });
  49  |       const watch = (contents: Electron.WebContents) => {
  50  |         const send = contents.send.bind(contents);
  51  |         contents.send = (channel, ...args) => {
  52  |           const m = args[0];
  53  |           if (channel === 'preview:command') record('command', { id: contents.id,
  54  |             command: m?.command, revision: m?.revision, requestId: m?.requestId, sourceLine: m?.sourceLine });
  55  |           return send(channel, ...args);
  56  |         };
  57  |         contents.on('did-finish-load', () => record('loaded', { id: contents.id }));
  58  |       };
  59  |       webContents.getAllWebContents().forEach(watch);
  60  |       app.on('web-contents-created', (_event, contents) => watch(contents));
  61  |       const visible = WebContentsView.prototype.setVisible;
  62  |       WebContentsView.prototype.setVisible = function (value) {
  63  |         visible.call(this, value);
  64  |         record('visible', { id: this.webContents.id, value, bounds: this.getBounds() });
  65  |       };
  66  |       ipcMain.on('preview:message', (event, m) => {
  67  |         if (['marktex:html-updated', 'marktex:review-prepared', 'edit-at-anchor'].includes(m?.type))
  68  |           record('ack', { id: event.sender.id, type: m.type, revision: m.revision, requestId: m.requestId });
  69  |       });
  70  |       ipcMain.on('preview:show', (_event, m) => record('show', { tabId: m.tabId }));
  71  |     });
  72  |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  73  |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  74  |     if (process.env.SETDOWN_TRACE_CYCLES === '1') await app.evaluate(({ contentTracing }) =>
  75  |       contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink',
  76  |         'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] }));
  77  |     await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) })
  78  |       .locator('.git-change-open').click();
  79  |     const editor = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
  80  |     await expect(editor).toBeEditable();
  81  |     if (idle) await page.waitForTimeout(idle);
  82  |     // Optional geometry probe is kept out of the ordinary latency runs.
  83  |     const hiddenGeometry = process.env.SETDOWN_TRACE_CYCLES === '1'
  84  |       ? await app.evaluate(async ({ BrowserWindow }) => Promise.all(
  85  |         BrowserWindow.getAllWindows()[0].contentView.children.map(async view => {
  86  |           if (!('webContents' in view)) return null;
  87  |           const contents = view.webContents as Electron.WebContents;
  88  |           return { id: contents.id, bounds: view.getBounds(), visible: view.getVisible(), zoom: contents.getZoomFactor(),
  89  |             document: await contents.executeJavaScript(`({ width: innerWidth, height: innerHeight,
  90  |               dpr: devicePixelRatio,
  91  |               review: !!document.querySelector('.setdown-rendered-diff-split'),
  92  |               fonts: document.fonts.status, visibility: document.visibilityState })`).catch(() => null) };
  93  |         }))) : undefined;
  94  |     const samples = [];
  95  |     for (let cycle = 1; cycle <= 5; cycle++) {
  96  |       if (edits) {
  97  |         await editor.press('Control+End');
  98  |         await page.keyboard.insertText(`\n\ncycle-edit-${cycle}`);
  99  |       }
  100 |       const traceStart = await app.evaluate(() => (globalThis as any).cycleTrace.length);
  101 |       await editor.press('Escape');
  102 |       const escapeAt = await page.evaluate(() => (window as any).cycleEscapeAt as number);
  103 |       // Main-process visibility checks cannot force the hidden document's layout.
  104 |       await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
  105 |         .contentView.children.some(v => 'webContents' in v && v.getVisible())),
> 106 |       { timeout: 30_000, intervals: [10, 20, 50] }).toBe(true);
      |                                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  107 |       const viewId = await app.evaluate(({ BrowserWindow }) => {
  108 |         const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v =>
  109 |           'webContents' in v && v.getVisible()) as Electron.WebContentsView;
  110 |         return view.webContents.id;
  111 |       });
  112 |       if (edits) await expect.poll(() => app!.evaluate(({ webContents }, id) =>
  113 |         webContents.fromId(id)!.executeJavaScript(
  114 |           "document.querySelector('.setdown-rendered-diff-split')?.textContent || ''"), viewId),
  115 |       { timeout: 30_000, intervals: [10, 20, 50] }).toContain(`cycle-edit-${cycle}`);
  116 |       const capture = await app.evaluate(async ({ webContents }, id) => {
  117 |         const contents = webContents.fromId(id)!;
  118 |         const start = Date.now();
  119 |         const image = await contents.capturePage();
  120 |         return { id, start, end: Date.now(), empty: image.isEmpty() };
  121 |       }, viewId);
  122 |       expect(capture.empty).toBe(false);
  123 |       const trace = await app.evaluate(() => (globalThis as any).cycleTrace);
  124 |       const afterEscape = trace.slice(traceStart);
  125 |       const show = afterEscape.find((e: any) => e.kind === 'show' && e.tabId);
  126 |       const sample = { cycle, escapeAt, showMs: show?.t - escapeAt,
  127 |         captureMs: capture.end - escapeAt, captureRequiresLatestContent: edits, viewId: capture.id,
  128 |         trace: afterEscape.map((e: any) => ({ ...e, sinceEscape: e.t - escapeAt })) };
  129 |       samples.push(sample);
  130 |       console.log(JSON.stringify(sample));
  131 |       const content = await app.evaluate(({ webContents }, id) => webContents.fromId(id)!
  132 |         .executeJavaScript(`({ math: document.querySelectorAll('.katex').length,
  133 |           width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  134 |           text: document.querySelector('.setdown-rendered-diff-split')?.textContent })`), capture.id);
  135 |       expect(content.math).toBeGreaterThan(100);
  136 |       Object.assign(sample, { geometry: { width: content.width, height: content.height, dpr: content.dpr } });
  137 |       if (edits) expect(content.text).toContain(`cycle-edit-${cycle}`);
  138 |       // Browser input uses CSS coordinates and does not depend on OS window focus.
  139 |       // Attach only after timing; do not dispatch a synthetic DOM dblclick event.
  140 |       let input: Awaited<ReturnType<typeof doubleClickPreview>> | undefined;
  141 |       if (process.env.SETDOWN_CYCLES_RETURN === 'button') {
  142 |         await page.getByRole('button', { name: 'View Source Diff' }).click();
  143 |       } else input = await doubleClickPreview(app, capture.id, true);
  144 |       try {
  145 |         await expect(page.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  146 |       } catch (error) {
  147 |         await writeFile(test.info().outputPath('failed-cycle.json'), JSON.stringify({ samples, input,
  148 |           delivered: await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.__cycleInput'), capture.id),
  149 |           trace: await app.evaluate(() => (globalThis as any).cycleTrace) }, null, 2));
  150 |         throw error;
  151 |       }
  152 |       await expect(editor).toBeEditable();
  153 |       if (input) Object.assign(sample, { doubleClickToEditorMs: Date.now() - input.at });
  154 |     }
  155 |     if (process.env.SETDOWN_TRACE_CYCLES === '1') await app.evaluate(({ contentTracing }, file) =>
  156 |       contentTracing.stopRecording(file), test.info().outputPath('cycles-trace.json'));
  157 |     await writeFile(test.info().outputPath('cycles.json'), JSON.stringify({ idle,
  158 |       returnMethod: process.env.SETDOWN_CYCLES_RETURN === 'button' ? 'button' : 'double-click',
  159 |       edits, hiddenGeometry, samples,
  160 |       trace: await app.evaluate(() => (globalThis as any).cycleTrace) }, null, 2));
  161 |   } finally {
  162 |     if (app) await disposeApplication(app);
  163 |     await rm(root, { recursive: true, force: true });
  164 |     await rm(config, { recursive: true, force: true });
  165 |   }
  166 | });
  167 | 
```