# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview/document-preparation.spec.ts >> Esc presents the final scroll position without a later jump (prepared: true)
- Location: ../../../../../apps/desktop/test/e2e/preview/document-preparation.spec.ts:163:39

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 2
Received array:  [{"band": [], "command": "marktex:position-preview", "requestId": 2, "settle": false, "sourceLine": 137, "topRatio": 0.9380281690140845}, {"band": [], "command": "marktex:position-preview", "requestId": 3, "settle": false, "sourceLine": 137, "topRatio": 0.9380281690140845}]
```

# Test source

```ts
  110 |   const line = text.slice(0, text.indexOf('## Target')).split('\n').length;
  111 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  112 |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  113 |   try {
  114 |     const page = await app.firstWindow();
  115 |     await expect(page.locator('.document-tab')).toHaveCount(1);
  116 |     const id = (await page.locator('.document-tab').getAttribute('data-tab-id'))!;
  117 |     const read = (script: string) => app.evaluate(async ({ BrowserWindow }, script) => {
  118 |       const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()) as Electron.WebContentsView;
  119 |       return view ? view.webContents.executeJavaScript(script) : null;
  120 |     }, script);
  121 |     await expect.poll(() => read('!!document.querySelector("details")')).toBe(true);
  122 |     const position = async () => {
  123 |       await page.evaluate(({ id, line }) => window.marktex.sendPreviewCommand(id,
  124 |         { command: 'marktex:position-preview', sourceLine: line, topRatio: .3, settle: false }), { id, line });
  125 |       await expect.poll(() => read('Math.abs(document.querySelector("h2").getBoundingClientRect().top - innerHeight * .3)')).toBeLessThan(2);
  126 |     };
  127 |     await position();
  128 |     // Reuse existing geometry, then alter native details layout without changing
  129 |     // the Markdown revision or viewport. The next source position must remeasure.
  130 |     await read('document.querySelector("details").open = true; true');
  131 |     await position();
  132 |     await read('document.querySelector("details").open = false; true');
  133 |     await position();
  134 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  135 | });
  136 | 
  137 | test('an owned background reader can prepare without changing the foreground document', async () => {
  138 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-background-reader-'));
  139 |   const first = path.join(root, 'first.md'), second = path.join(root, 'second.md');
  140 |   await writeFile(first, '# First reader\n'); await writeFile(second, '# Second reader\n');
  141 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  142 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  143 |   try {
  144 |     const page = await app.firstWindow();
  145 |     await expect(page.getByRole('tab', { name: /first.md/ })).toBeVisible();
  146 |     const id = (await page.getByRole('tab', { name: /first.md/ }).getAttribute('data-tab-id'))!;
  147 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
  148 |     await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
  149 |     const result = await page.evaluate(async ({ id, first }) => {
  150 |       const theme = await window.marktex.getTheme();
  151 |       const result = await window.marktex.preparePreview(id, '# First reader\n', 0, first, theme.id);
  152 |       return { result, document: await window.marktex.getDocument() };
  153 |     }, { id, first });
  154 |     expect(result.result.url).toMatch(/^marktex-preview:\/\/document\//);
  155 |     expect(result.document?.path).toBe(second);
  156 |     expect(result.document?.text).toBe('# Second reader\n');
  157 |     await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
  158 | 
  159 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  160 | });
  161 | 
  162 | 
  163 | for (const prepared of [false, true]) test(`Esc presents the final scroll position without a later jump (prepared: ${prepared})`, async () => {
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
  174 |     const read = (script: string) => app.evaluate(async ({ BrowserWindow }, script) => {
  175 |       const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
  176 |         'webContents' in candidate && (candidate.webContents as Electron.WebContents).getURL().startsWith('marktex-preview://document/')
  177 |         && !(candidate.webContents as Electron.WebContents).getURL().includes('/warmup-')) as Electron.WebContentsView;
  178 |       return view ? view.webContents.executeJavaScript(script) : null;
  179 |     }, script);
  180 |     await expect.poll(() => read('document.body.dataset.setdownHydration')).toBe('complete');
  181 |     await page.locator('.mode-toggle').click();
  182 |     const editor = page.getByRole('textbox', { name: 'Editor content' });
  183 |     await expect(editor).toBeEditable();
  184 |     await editor.press('Control+Home');
  185 |     for (let index = 0; index < 6; index++) await editor.press('PageDown');
  186 |     // Let Monaco's smooth PageDown movement finish before taking the Esc anchor.
  187 |     await page.waitForTimeout(400);
  188 |     await page.keyboard.insertText('\n\nESC_POSITION_MARKER\n\n');
  189 |     if (prepared) await expect.poll(() => read('document.querySelector(".markdown-preview").textContent.includes("ESC_POSITION_MARKER")')).toBe(true);
  190 |     await read(`window.escFrames = []; window.escCommands = [];
  191 |       window.escRecording = false;
  192 |       addEventListener('message', event => {
  193 |         if (event.data?.command === 'marktex:position-preview' && event.data.requestId) escCommands.push(event.data);
  194 |         if (event.data?.command === 'marktex:resume-hydration' && !escRecording) {
  195 |           escRecording = true;
  196 |           const record = () => {
  197 |             escFrames.push({ y: scrollY, latest: document.querySelector('.markdown-preview').textContent.includes('ESC_POSITION_MARKER') });
  198 |             if (escFrames.length < 30) requestAnimationFrame(record);
  199 |           };
  200 |           requestAnimationFrame(record);
  201 |         }
  202 |       });`);
  203 |     await editor.press('Escape');
  204 |     await expect(page.locator('.viewer-surface')).toBeVisible();
  205 |     await expect.poll(() => read('escFrames.length'), { timeout: 10_000 }).toBe(30);
  206 |     const recorded = await read('({ frames: escFrames, commands: escCommands })') as {
  207 |       frames: Array<{ y: number; latest: boolean }>; commands: unknown[];
  208 |     };
  209 |     await writeFile(test.info().outputPath('esc-frames.json'), JSON.stringify(recorded, null, 2));
> 210 |     expect(recorded.commands).toHaveLength(1);
      |                               ^ Error: expect(received).toHaveLength(expected)
  211 |     expect(recorded.frames.every(frame => frame.latest)).toBe(true);
  212 |     const offsets = recorded.frames.map(frame => frame.y);
  213 |     expect(Math.min(...offsets)).toBeGreaterThan(1000);
  214 |     expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(1);
  215 |     const capture = await app.evaluate(async ({ BrowserWindow }) => {
  216 |       const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
  217 |         'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView;
  218 |       return (await view.webContents.capturePage()).toPNG();
  219 |     });
  220 |     await writeFile(test.info().outputPath('esc-reader.png'), capture);
  221 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  222 | });
  223 | 
```