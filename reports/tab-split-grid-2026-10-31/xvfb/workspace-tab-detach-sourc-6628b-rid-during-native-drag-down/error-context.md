# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/tab-detach.spec.ts >> source group body follows the split grid during native drag: down
- Location: test/e2e/workspace/tab-detach.spec.ts:100:1

# Error details

```
Error: locator.boundingBox: Error: strict mode violation: locator('.editor-group').filter({ has: locator('.document-tab').last() }) resolved to 2 elements:
    1) <section class="editor-group" data-group-id="group-0" data-tab-kind="document" aria-label="Editor group">…</section> aka getByText('Untitled.md × ← → ↻ 100%')
    2) <section data-group-id="group-1" data-tab-kind="document" aria-label="Editor group" class="editor-group focused">…</section> aka getByText('Untitled 2.md × ← → ↻ 100%')

Call log:
  - waiting for locator('.editor-group').filter({ has: locator('.document-tab').last() })

```

# Test source

```ts
  61  |     await nativeInput({ pointer: [outside] });
  62  |     if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
  63  |     if (outcome === 'return') {
  64  |       const first = (await page.locator('.document-tab').first().boundingBox())!;
  65  |       const back = await nativeWindow.evaluate((window, box) => {
  66  |         const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  67  |         return { x: bounds.x + (box.x + 30) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
  68  |       }, first);
  69  |       await nativeInput({ pointer: [1, 2, 3, 4].map(step => ({
  70  |         x: outside.x + (back.x - outside.x) * step / 4, y: outside.y + (back.y - outside.y) * step / 4,
  71  |       })) });
  72  |       await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  73  |       await expect.poll(async () => (await page.locator('.tab-drop-indicator').boundingBox())!.x).toBeCloseTo(first.x - 1, 0);
  74  |     }
  75  |     await nativeInput({ button: 'up' });
  76  |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  77  |     if (outcome === 'cancel' || outcome === 'return') {
  78  |       await expect(page.locator('.tab-name')).toHaveText(outcome === 'cancel'
  79  |         ? ['Untitled.md', 'Untitled 2.md'] : ['Untitled 2.md', 'Untitled.md']);
  80  |       await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  81  |     } else {
  82  |       await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
  83  |       await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
  84  |       const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
  85  |       await expect(detached.locator('.tab-name')).toHaveText(['Untitled 2.md']);
  86  |     }
  87  |     await nativeWindow.dispose();
  88  |   } finally {
  89  |     await nativeInput({ button: 'up' });
  90  |     const events = await page.evaluate(() => (window as typeof window & { detachEvents?: unknown[] }).detachEvents).catch(() => []);
  91  |     await writeFile(test.info().outputPath('drag-events.json'), JSON.stringify(events, null, 2));
  92  |     await writeFile(test.info().outputPath('native-inputs.json'), JSON.stringify(await app.evaluate(() => (globalThis as any).dragInputs), null, 2));
  93  |     await page.screenshot({ path: test.info().outputPath('source-window.png') }).catch(() => {});
  94  |     await disposeApplication(app);
  95  |     await rm(root, { recursive: true, force: true });
  96  |   }
  97  | });
  98  | 
  99  | for (const outcome of ['down', 'cancel', 'return', 'split', 'sole'] as const)
  100 | test(`source group body follows the split grid during native drag: ${outcome}`, async () => {
  101 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-center-detach-'));
  102 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  103 |   const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  104 |   const page = await app.firstWindow();
  105 |   try {
  106 |     await focusApplication(app);
  107 |     const window = await app.browserWindow(page);
  108 |     await window.evaluate(window => window.setBounds({ x: 200, y: 150, width: 1000, height: 700 }));
  109 |     await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
  110 |     if (outcome !== 'sole') await page.locator('.new-tab-button').click();
  111 |     const tab = page.locator('.document-tab').last(), tabName = await tab.locator('.tab-name').innerText();
  112 |     const toScreen = (point: { x: number; y: number }) => window.evaluate((window, point) => {
  113 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  114 |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  115 |     }, point);
  116 |     const box = (await tab.boundingBox())!;
  117 |     const from = await toScreen({ x: box.x + 40, y: box.y + box.height / 2 });
  118 |     await nativeInput({ pointer: [from], button: 'down' });
  119 |     await nativeInput({ pointer: [10, 20, 30].map(dx => ({ x: from.x + dx, y: from.y })) });
  120 |     await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  121 |     const body = (await page.locator('.group-body').boundingBox())!;
  122 |     const edge = await toScreen({ x: body.x + body.width * .98, y: body.y + body.height / 2 });
  123 |     if (outcome !== 'sole') {
  124 |       await nativeInput({ pointer: [edge] });
  125 |       await expect(page.locator('.group-drop-overlay')).toBeVisible();
  126 |     }
  127 |     await nativeInput({ pointer: [await toScreen({ x: body.x + body.width / 2, y: body.y + body.height * .55 })] });
  128 |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  129 |     const overlay = page.locator('.group-drop-overlay');
  130 |     if (outcome === 'sole') await expect(overlay).toBeHidden();
  131 |     else {
  132 |       await expect(overlay).toBeVisible();
  133 |       const guide = (await overlay.boundingBox())!;
  134 |       expect(guide.x).toBeCloseTo(body.x, 0);
  135 |       expect(guide.y).toBeCloseTo(body.y + body.height / 2, 0);
  136 |       expect(guide.width).toBeCloseTo(body.width, 0);
  137 |       expect(guide.height).toBeCloseTo(body.height / 2, 0);
  138 |     }
  139 |     await page.screenshot({ path: test.info().outputPath('body-guide.png') });
  140 |     if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
  141 |     if (outcome === 'return') {
  142 |       const first = (await page.locator('.document-tab').first().boundingBox())!;
  143 |       await nativeInput({ pointer: [await toScreen({ x: first.x + 3, y: first.y + first.height / 2 })] });
  144 |       await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  145 |     }
  146 |     if (outcome === 'split') {
  147 |       await nativeInput({ pointer: [edge] });
  148 |       await expect(page.locator('.group-drop-overlay')).toBeVisible();
  149 |     }
  150 |     await nativeInput({ button: 'up' });
  151 |     if (outcome === 'sole') {
  152 |       await expect.poll(async () => (await shellWindows(app)).some(candidate => candidate !== page)).toBe(true);
  153 |       const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
  154 |       await expect(detached.locator('.tab-name')).toHaveText([tabName]);
  155 |       await expect.poll(() => page.isClosed()).toBe(true);
  156 |       await expect.poll(async () => (await shellWindows(app)).length).toBe(1);
  157 |     } else {
  158 |       await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  159 |       await expect(page.locator('.editor-group')).toHaveCount(outcome === 'split' || outcome === 'down' ? 2 : 1);
  160 |       if (outcome === 'split' || outcome === 'down') {
> 161 |         const moved = (await page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
      |                                                                                 ^ Error: locator.boundingBox: Error: strict mode violation: locator('.editor-group').filter({ has: locator('.document-tab').last() }) resolved to 2 elements:
  162 |         const remaining = (await page.locator('.editor-group').filter({ hasNot: tab }).boundingBox())!;
  163 |         expect(moved[outcome === 'split' ? 'x' : 'y']).toBeGreaterThan(remaining[outcome === 'split' ? 'x' : 'y']);
  164 |       }
  165 |       await expect(page.locator('.tab-name')).toHaveText(outcome === 'return'
  166 |         ? ['Untitled 2.md', 'Untitled.md'] : ['Untitled.md', 'Untitled 2.md']);
  167 |     }
  168 |     if (outcome !== 'sole') {
  169 |       await expect(page.locator('.group-drop-overlay')).toBeHidden();
  170 |       await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  171 |       await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  172 |     }
  173 |     await window.dispose();
  174 |   } finally {
  175 |     await nativeInput({ button: 'up' });
  176 |     await disposeApplication(app); await rm(root, { recursive: true, force: true });
  177 |   }
  178 | });
  179 | 
  180 | for (const dropArea of ['body', 'tab strip'] as const) test(`detaching a tab restores its preview at the same position via ${dropArea}`, async () => {
  181 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  182 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  183 |   const application = await electron.launch({
  184 |     args: ['.', path.resolve('test/fixtures/sample.md')],
  185 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  186 |   });
  187 | 
  188 |   try {
  189 |     const sourceWindow = await application.firstWindow();
  190 |     await expect(sourceWindow.locator('.document-tab')).toHaveCount(1);
  191 |     const sourcePreview = previews(application, { title: 'sample.md' });
  192 |     await expect.poll(sourcePreview.count).toBe(1);
  193 | 
  194 |     await sourceWindow.locator('.new-tab-button').click();
  195 |     await expect(sourceWindow.locator('.document-tab')).toHaveCount(2);
  196 |     await sourceWindow.locator('.document-tab', { hasText: 'sample.md' }).click();
  197 |     const activePreviewUrl = await sourcePreview.visibleUrl();
  198 |     expect(activePreviewUrl).toMatch(/^marktex-preview:\/\/document\//);
  199 |     await expect.poll(() => sourcePreview.evaluate('innerHeight')).toBeGreaterThan(0);
  200 | 
  201 |     // URL을 만든 뒤 동적으로 바꾼 전역 테마와 탭별 목차 상태가 모두
  202 |     // transfer 경계를 넘어가는지 확인한다.
  203 |     await application.evaluate(({ Menu }) => {
  204 |       Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click();
  205 |     });
  206 |     await expect.poll(() =>
  207 |       sourcePreview.evaluate('document.body.dataset.setdownPreviewTheme')).toBe('night');
  208 |     await sourceWindow.locator('.toc-toggle').click();
  209 |     await expect(sourceWindow.locator('.toc-panel')).toBeVisible();
  210 | 
  211 |     // 실제 사용 상황과 같이 분리할 탭을 활성화한 상태에서 현재 DOM과
  212 |     // viewport를 기록한다.
  213 |     await expect.poll(() => sourcePreview.evaluate(
  214 |       'document.documentElement.scrollHeight - innerHeight')).toBeGreaterThan(0);
  215 |     await sourcePreview.evaluate(
  216 |       'window.scrollTo(0, Math.max(1, document.documentElement.scrollHeight * 0.55)), true');
  217 |     await expect.poll(() => sourcePreview.evaluate('Math.round(scrollY)')).toBeGreaterThan(0);
  218 |     // 기준은 shell의 anchor가 아니라 "이동 직전 source가 실제로 보여 주던 줄"이다.
  219 |     // shell의 anchor는 scroll 이벤트를 따라 늦게 갱신되어, 이르게 읽으면
  220 |     // 옛 값을 집는다. 이동 전후로 같은 자리를 재는 것이 이 시험의 뜻이다.
  221 |     await expect.poll(() => sourcePreview.evaluate(`(() => {
  222 |       const y = innerHeight * 0.382;
  223 |       const covering = [...document.querySelectorAll('[data-source-line]')].find((element) => {
  224 |         const rect = element.getBoundingClientRect();
  225 |         return rect.top <= y && rect.bottom >= y;
  226 |       });
  227 |       return Number(covering && covering.dataset.sourceLine) || 0;
  228 |     })()`)).toBeGreaterThan(1);
  229 |     const anchorLine = Number(await sourcePreview.evaluate(`(() => {
  230 |       const y = innerHeight * 0.382;
  231 |       const covering = [...document.querySelectorAll('[data-source-line]')].find((element) => {
  232 |         const rect = element.getBoundingClientRect();
  233 |         return rect.top <= y && rect.bottom >= y;
  234 |       });
  235 |       return Number(covering && covering.dataset.sourceLine) || 0;
  236 |     })()`));
  237 | 
  238 |     const draggedTypes = await sourceWindow.locator('.document-tab', { hasText: 'sample.md' })
  239 |       .evaluate((element) => {
  240 |         const dataTransfer = new DataTransfer();
  241 |         element.dispatchEvent(new DragEvent('dragstart', {
  242 |           bubbles: true,
  243 |           cancelable: true,
  244 |           dataTransfer,
  245 |           screenX: 640,
  246 |           screenY: 420,
  247 |         }));
  248 |         const types = [...dataTransfer.types];
  249 |         element.dispatchEvent(new DragEvent('dragleave', {
  250 |           clientX: 120,
  251 |           clientY: 80,
  252 |           bubbles: true,
  253 |           cancelable: true,
  254 |           dataTransfer,
  255 |           relatedTarget: null,
  256 |         }));
  257 |         // VS Code and Firefox can accept the OS drag as a move even though the
  258 |         // drop did not happen in another Setdown window.
  259 |         Object.defineProperty(dataTransfer, 'dropEffect', { value: 'move', configurable: true });
  260 |         element.dispatchEvent(new DragEvent('dragend', {
  261 |           // Chromium can retain the last in-window client coordinates when the
```