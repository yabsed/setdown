# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview/document-preparation.spec.ts >> auto save after edited Esc keeps the native reader in place without an external-change notice
- Location: ../../../../../apps/desktop/test/e2e/preview/document-preparation.spec.ts:163:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 15

- Array []
+ Array [
+   Array [
+     Object {
+       "diskVersion": Object {
+         "ctimeMs": 1793283301139.2886,
+         "dev": 39,
+         "ino": 11751984,
+         "mtimeMs": 1793283301138.2886,
+         "size": 33951,
+       },
+       "path": "/var/tmp/setdown-esc-position-GwNCs8/sample.md",
+       "unavailable": false,
+     },
+   ],
+ ]
```

# Test source

```ts
  135 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  136 | });
  137 | 
  138 | test('an owned background reader can prepare without changing the foreground document', async () => {
  139 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-background-reader-'));
  140 |   const first = path.join(root, 'first.md'), second = path.join(root, 'second.md');
  141 |   await writeFile(first, '# First reader\n'); await writeFile(second, '# Second reader\n');
  142 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  143 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  144 |   try {
  145 |     const page = await app.firstWindow();
  146 |     await expect(page.getByRole('tab', { name: /first.md/ })).toBeVisible();
  147 |     const id = (await page.getByRole('tab', { name: /first.md/ }).getAttribute('data-tab-id'))!;
  148 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
  149 |     await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
  150 |     const result = await page.evaluate(async ({ id, first }) => {
  151 |       const theme = await window.marktex.getTheme();
  152 |       const result = await window.marktex.preparePreview(id, '# First reader\n', 0, first, theme.id);
  153 |       return { result, document: await window.marktex.getDocument() };
  154 |     }, { id, first });
  155 |     expect(result.result.url).toMatch(/^marktex-preview:\/\/document\//);
  156 |     expect(result.document?.path).toBe(second);
  157 |     expect(result.document?.text).toBe('# Second reader\n');
  158 |     await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
  159 | 
  160 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  161 | });
  162 | 
  163 | test('auto save after edited Esc keeps the native reader in place without an external-change notice', async () => {
  164 |   test.setTimeout(60_000);
  165 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-esc-position-'));
  166 |   const file = path.join(root, 'sample.md');
  167 |   await writeFile(file, await readFile(path.resolve('test/fixtures/sample.md')));
  168 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  169 |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  170 |   try {
  171 |     const page = await app.firstWindow();
  172 |     await focusApplication(app);
  173 |     await expect(page.locator('.viewer-surface')).toBeVisible();
  174 |     await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-auto-save'));
  175 |     expect(await page.evaluate(() => window.marktex.getAutoSave())).toBe(true);
  176 |     const read = (script: string) => app.evaluate(async ({ BrowserWindow }, script) => {
  177 |       const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
  178 |         'webContents' in candidate && (candidate.webContents as Electron.WebContents).getURL().startsWith('marktex-preview://document/')
  179 |         && !(candidate.webContents as Electron.WebContents).getURL().includes('/warmup-')) as Electron.WebContentsView;
  180 |       return view ? view.webContents.executeJavaScript(script) : null;
  181 |     }, script);
  182 |     await expect.poll(() => read('document.body.dataset.setdownHydration')).toBe('complete');
  183 |     await read('scrollTo(0, 2500)');
  184 |     const id = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0].contentView.children
  185 |       .find(candidate => 'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView).webContents.id);
  186 |     await doubleClickPreview(app, id, false);
  187 |     await app.evaluate(({ BrowserWindow, webContents }, id) => {
  188 |       const owner = BrowserWindow.getAllWindows()[0];
  189 |       const view = owner.contentView.children.find(candidate => 'webContents' in candidate && candidate.webContents === webContents.fromId(id))!;
  190 |       const trace = { bounds: [] as Electron.Rectangle[], externalChanges: [] as unknown[] };
  191 |       (globalThis as any).escNativeTrace = trace;
  192 |       const setBounds = view.setBounds.bind(view), setVisible = view.setVisible.bind(view);
  193 |       view.setBounds = bounds => { if (view.getVisible()) trace.bounds.push(bounds); setBounds(bounds); };
  194 |       view.setVisible = visible => { if (visible) trace.bounds.push(view.getBounds()); setVisible(visible); };
  195 |       const send = owner.webContents.send.bind(owner.webContents);
  196 |       owner.webContents.send = (channel, ...args) => {
  197 |         if (channel === 'document:external-change') trace.externalChanges.push(args);
  198 |         send(channel, ...args);
  199 |       };
  200 |     }, id);
  201 |     const editor = page.getByRole('textbox', { name: 'Editor content' });
  202 |     await expect(editor).toBeEditable();
  203 |     await editor.press('End');
  204 |     await page.keyboard.insertText('\n\nESC_POSITION_MARKER\n\n');
  205 |     await page.waitForTimeout(400);
  206 |     await expect.poll(() => read('document.querySelector(".markdown-preview").textContent.includes("ESC_POSITION_MARKER")')).toBe(true);
  207 |     await read(`window.escFrames = []; window.escCommands = [];
  208 |       window.escRecording = false;
  209 |       addEventListener('message', event => {
  210 |         if (event.data?.command === 'marktex:position-preview' && event.data.requestId) escCommands.push(event.data);
  211 |         if (event.data?.command === 'marktex:resume-hydration' && !escRecording) {
  212 |           escRecording = true;
  213 |           const record = () => {
  214 |             escFrames.push({ y: scrollY, latest: document.querySelector('.markdown-preview').textContent.includes('ESC_POSITION_MARKER') });
  215 |             if (escFrames.length < 180) requestAnimationFrame(record);
  216 |           };
  217 |           requestAnimationFrame(record);
  218 |         }
  219 |       });`);
  220 |     await editor.press('Escape');
  221 |     await expect(page.locator('.viewer-surface')).toBeVisible();
  222 |     await expect.poll(() => read('escFrames.length'), { timeout: 10_000 }).toBe(180);
  223 |     const recorded = await read('({ frames: escFrames, commands: escCommands })') as {
  224 |       frames: Array<{ y: number; latest: boolean }>; commands: unknown[];
  225 |     };
  226 |     await writeFile(test.info().outputPath('esc-frames.json'), JSON.stringify(recorded, null, 2));
  227 |     expect(recorded.frames.every(frame => frame.latest)).toBe(true);
  228 |     const offsets = recorded.frames.map(frame => frame.y);
  229 |     expect(Math.min(...offsets)).toBeGreaterThan(1000);
  230 |     expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(1);
  231 |     await expect.poll(() => readFile(file, 'utf8')).toContain('ESC_POSITION_MARKER');
  232 |     await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
  233 |     const native = await app.evaluate(() => (globalThis as any).escNativeTrace) as { bounds: Electron.Rectangle[]; externalChanges: unknown[] };
  234 |     await writeFile(test.info().outputPath('esc-native.json'), JSON.stringify(native, null, 2));
> 235 |     expect(native.externalChanges).toEqual([]);
      |                                    ^ Error: expect(received).toEqual(expected) // deep equality
  236 |     expect(native.bounds.length).toBeGreaterThan(0);
  237 |     for (const bounds of native.bounds) expect(bounds).toEqual(native.bounds[0]);
  238 |     const capture = await app.evaluate(async ({ BrowserWindow }) => {
  239 |       const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
  240 |         'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView;
  241 |       return (await view.webContents.capturePage()).toPNG();
  242 |     });
  243 |     await writeFile(test.info().outputPath('esc-reader.png'), capture);
  244 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  245 | });
  246 | 
```