# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> native Wayland document drag paints split and merge guides across windows without global coordinates
- Location: test/wayland/tab-drag.spec.ts:7:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-tab-id="50457e03-2662-43de-aedc-03877b543dac"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-tab-id="50457e03-2662-43de-aedc-03877b543dac"]') with timeout 5000ms
  - waiting for locator('[data-tab-id="50457e03-2662-43de-aedc-03877b543dac"]')

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "Untitled.md ×" [selected]:
          - text: Untitled.md
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file" [disabled]: ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-browser-ooobIa/config/Setdown/drafts/cdbaf1c7-85b8-49a0-a9a1-2ca24b959084/Untitled.md
    - button "Insert table"
    - button "Insert URL"
    - button "Switch to Viewer"
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Markdown source editor":
    - code:
      - textbox "Editor content"
- alert
- alert
```

# Test source

```ts
  10  |   const pages: Page[] = [f.page];
  11  |   const wire: string[] = [];
  12  |   f.app.process().stderr?.on('data', chunk => { for (const line of String(chunk).split('\n'))
  13  |     if (/data_offer|data_source|data_device|wl_keyboard.*key\(/.test(line)) wire.push(line); });
  14  |   try {
  15  |     await f.app.evaluate(({ ipcMain, webContents, app }) => {
  16  |       const trace: unknown[] = []; (globalThis as any).waylandDragTrace = trace;
  17  |       for (const channel of ['tabs:register-transfer', 'tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  18  |         ipcMain.on(channel, (event, value) => trace.push({ at: Date.now(), id: event.sender.id, channel, value }));
  19  |       const watch = (wc: Electron.WebContents) => {
  20  |         wc.on('focus', () => trace.push({ at: Date.now(), id: wc.id, type: 'focus' }));
  21  |         wc.on('blur', () => trace.push({ at: Date.now(), id: wc.id, type: 'blur' }));
  22  |         const send = wc.send.bind(wc);
  23  |         wc.send = (channel, ...args) => { if (channel === 'tabs:drag-state') trace.push({ at: Date.now(), id: wc.id, channel, value: args[0] }); return send(channel, ...args); };
  24  |       };
  25  |       for (const wc of webContents.getAllWebContents()) watch(wc);
  26  |       app.on('web-contents-created', (_event, wc) => watch(wc));
  27  |     });
  28  |     await input.send({ keyDown: ['Super_L'], keys: ['Left'], keyUp: ['Super_L'] });
  29  |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(960);
  30  |     if (moving === 'web') await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  31  |     else await f.page.locator('.new-tab-button').click();
  32  |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Research page/ : /notes.md/ });
  33  |     await expect(tab).toBeVisible();
  34  |     const id = (await tab.getAttribute('data-tab-id'))!;
  35  |     const nativeId = moving === 'web' ? await f.app.evaluate(async ({ webContents }, origin) => {
  36  |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  37  |       await wc.executeJavaScript('document.querySelector("#draft").value="PRESERVED_WAYLAND_FORM"'); return wc.id;
  38  |     }, f.origin) : null;
  39  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  40  |     const shells = async () => (await Promise.all(f.app.windows().filter(page => page.url() === f.page.url()).map(async page =>
  41  |       await page.locator('.shell').count().catch(() => 0) ? page : null))).filter(page => page !== null);
  42  |     await expect.poll(async () => (await shells()).length).toBe(2);
  43  |     const other = (await shells()).find(page => page !== f.page)!; pages.push(other);
  44  |     await expect(other.locator('.shell')).toBeVisible();
  45  |     await input.send({ keyDown: ['Super_L'], keys: ['Right'], keyUp: ['Super_L'] });
  46  |     await expect.poll(() => other.evaluate(() => innerWidth)).toBe(960);
  47  |     if (moving === 'web') await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  48  |     else await other.getByRole('button', { name: 'New Document', exact: true }).click();
  49  |     await expect(other.getByRole('tab', { name: moving === 'web' ? /Second page/ : /Untitled/ })).toBeVisible();
  50  |     const bounds = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  51  |       .filter(window => window.isVisible()).map(window => window.getBounds()));
  52  |     // Wayland reports identical global origins for physically separate windows.
  53  |     expect(bounds).toHaveLength(2); expect(bounds[0].x).toBe(bounds[1].x); expect(bounds[0].y).toBe(bounds[1].y);
  54  |     await writeFile(test.info().outputPath('wayland-reported-bounds.json'), JSON.stringify(bounds, null, 2));
  55  |     for (const page of pages) await page.evaluate(() => {
  56  |       const trace: unknown[] = []; (globalThis as any).waylandDomTrace = trace;
  57  |       for (const type of ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  58  |         const e = event as DragEvent;
  59  |         trace.push({ at: Date.now(), type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className,
  60  |           trusted: e.isTrusted, prevented: e.defaultPrevented, buttons: e.buttons, button: e.button,
  61  |           effect: e.dataTransfer?.dropEffect, allowed: e.dataTransfer?.effectAllowed, types: [...(e.dataTransfer?.types ?? [])] });
  62  |       });
  63  |     });
  64  |     let owner = 0;
  65  |     for (let round = 0; round < 40; round++) {
  66  |       console.log('Wayland drag round', round);
  67  |       const destination = 1 - owner, canceled = [2, 8, 20, 28].includes(round), strip = [4, 6, 9, 11].includes(round) || round >= 12 && round % 2 === 0;
  68  |       const source = pages[owner].locator(`[data-tab-id="${id}"]`);
  69  |       const box = (await source.boundingBox())!;
  70  |       const body = (await pages[destination].locator(strip ? '.tab-strip' : '.group-body').first().boundingBox())!;
  71  |       // Physical positions are known from our private compositor's tiling;
  72  |       // Electron global bounds deliberately cannot be used for this input.
  73  |       const from = { x: owner * 960 + box.x + 35 + (round % 4) * 12, y: box.y + 15 };
  74  |       const to = { x: destination * 960 + body.x + body.width * (round === 1 ? .92 : .5), y: body.y + (strip ? 15 : body.height * .5) };
  75  |       await input.send({ pointer: [from], button: 'down' });
  76  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
  77  |       await expect(pages[destination].locator(strip ? '.tab-drop-indicator' : '.group-drop-overlay')).toBeVisible();
  78  |       const nativeWindow = await f.app.browserWindow(pages[destination]);
  79  |       if (moving === 'web' && round === 0) {
  80  |         // Shell screenshots do not include sibling native web views. Inspect
  81  |         // and capture the actual transparent guide renderer above the page too.
  82  |         const nativeGuide = () => nativeWindow.evaluate(async window => {
  83  |           const layer = window.contentView.children.find((view: Electron.View) => 'webContents' in view
  84  |             && (view as Electron.WebContentsView).webContents.getURL().startsWith('data:text/html;charset=utf-8,')) as Electron.WebContentsView;
  85  |           if (!layer?.getVisible()) return null;
  86  |           return layer.webContents.executeJavaScript(`(() => {
  87  |             const guide = document.querySelector('.guide'); if (!guide) return null;
  88  |             const bounds = guide.getBoundingClientRect();
  89  |             return { width: bounds.width, height: bounds.height, fill: getComputedStyle(guide).backgroundColor,
  90  |               page: getComputedStyle(document.body).backgroundColor };
  91  |           })()`);
  92  |         });
  93  |         await expect.poll(nativeGuide).toMatchObject({ width: 960, height: expect.any(Number),
  94  |           fill: expect.stringMatching(/^rgba\(.+, 0\.\d+\)$/), page: 'rgba(0, 0, 0, 0)' });
  95  |         const nativeCapture = await nativeWindow.evaluate(async window => {
  96  |           const layer = window.contentView.children.find((view: Electron.View) => 'webContents' in view
  97  |             && (view as Electron.WebContentsView).webContents.getURL().startsWith('data:text/html;charset=utf-8,')) as Electron.WebContentsView;
  98  |           return (await layer.webContents.capturePage()).toPNG().toString('base64');
  99  |         });
  100 |         await writeFile(test.info().outputPath('native-guide-layer.png'), Buffer.from(nativeCapture, 'base64'));
  101 |       }
  102 |       if (round < 12) {
  103 |         const capture = await nativeWindow.evaluate(async window => (await window.capturePage()).toPNG().toString('base64'));
  104 |         await writeFile(test.info().outputPath(`guide-${round}.png`), Buffer.from(capture, 'base64'));
  105 |       }
  106 |       await nativeWindow.dispose();
  107 |       if (canceled) await input.send({ keys: ['Escape'] });
  108 |       await input.send({ button: 'up' });
  109 |       if (!canceled) {
> 110 |         await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  111 |         await expect(source).toHaveCount(0); owner = destination;
  112 |         if (round === 1) await expect(pages[owner].locator('.editor-group')).toHaveCount(2);
  113 |       } else await expect(source).toBeVisible();
  114 |       for (const page of pages) {
  115 |         await expect(page.locator('.group-drop-overlay')).toBeHidden();
  116 |         await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  117 |         await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  118 |       }
  119 |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  120 |     }
  121 |     if (nativeId) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), nativeId)).toBe('PRESERVED_WAYLAND_FORM');
  122 |     expect(f.errors).toEqual([]);
  123 |   } finally {
  124 |     await writeFile(test.info().outputPath('wayland-wire.log'), wire.join('\n'));
  125 |     await writeFile(test.info().outputPath('wayland-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).waylandDragTrace), null, 2));
  126 |     for (const [i, page] of pages.entries()) await writeFile(test.info().outputPath(`dom-${i}.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).waylandDomTrace ?? null), null, 2));
  127 |     await input.send({ keys: ['Escape'], button: 'up' });
  128 |     for (const [i, page] of pages.entries()) await page.screenshot({ path: test.info().outputPath(`final-${i}.png`) }).catch(() => {});
  129 |     await f.dispose(); await input.close();
  130 |   }
  131 | });
  132 | 
```