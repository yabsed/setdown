# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/navigation.spec.ts >> web pages share document tabs, retain live state, navigate, bookmark, and split
- Location: test/e2e/browser/navigation.spec.ts:50:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.editor-group')
Expected: 1
Received: 2
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('.editor-group') with timeout 5000ms
  - waiting for locator('.editor-group')
    14 × locator resolved to 2 elements
       - unexpected value "2"

```

# Test source

```ts
  22  |     const go = async (url: string) => { await address.fill(url); await address.press('Enter'); };
  23  |     await go(`${f.origin}/first`);
  24  |     await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
  25  |     await go(pathToFileURL(path.join(f.root, 'notes.md')).href);
  26  |     await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
  27  |     await expect(address).toHaveValue(/^file:\/\//);
  28  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  29  |     await expect(address).toHaveValue(`${f.origin}/first`);
  30  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  31  |     await expect(address).toHaveValue(location);
  32  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
  33  |     await input().pressSequentially(`printf "$SETDOWN_SESSION" > '${f.root}/retained.txt'`); await input().press('Enter');
  34  |     await expect.poll(() => readFile(path.join(f.root, 'retained.txt'), 'utf8').catch(() => '')).toBe('retained');
  35  |     await f.page.getByRole('button', { name: 'Forward', exact: true }).click();
  36  |     await expect(address).toHaveValue(`${f.origin}/first`);
  37  |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  38  |     await f.page.getByRole('button', { name: 'Terminal', exact: true }).click();
  39  |     await f.page.locator('.terminal-list .select').filter({ hasText: 'Terminal 1' }).click();
  40  |     await expect(address).toHaveValue(location);
  41  |     await f.page.locator('.new-terminal-tab-button').click();
  42  |     await expect(f.page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute('aria-selected', 'true');
  43  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('100%');
  44  |     await f.page.getByRole('tab', { name: /Terminal 1/ }).click();
  45  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
  46  |     expect(f.errors).toEqual([]);
  47  |   } finally { await f.dispose(); }
  48  | });
  49  | 
  50  | test('web pages share document tabs, retain live state, navigate, bookmark, and split', async () => {
  51  |   test.setTimeout(90_000);
  52  |   const f = await fixture();
  53  |   await f.page.evaluate(() => {
  54  |     const events: unknown[] = []; (globalThis as any).navigationDragEvents = events;
  55  |     window.marktex.onTabDragState(state => events.push({ at: Date.now(), type: 'shared', ...state }));
  56  |     for (const type of ['pointerdown', 'pointercancel', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'focus', 'blur', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  57  |       const e = event as DragEvent;
  58  |       events.push({ at: Date.now(), type, target: (e.target as Element | null)?.className, x: e.clientX, y: e.clientY,
  59  |         screenX: e.screenX, screenY: e.screenY, effect: e.dataTransfer?.dropEffect, prevented: e.defaultPrevented, detail: e.detail, buttons: e.buttons,
  60  |         active: document.activeElement?.className, draggable: (e.target as Element | null)?.closest?.('[draggable]')?.getAttribute('draggable') });
  61  |     }, true);
  62  |   });
  63  |   try {
  64  |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  65  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  66  |     const webTab = f.page.getByRole('tab', { name: /Research page/ });
  67  |     await expect(webTab).toHaveAttribute('aria-selected', 'true');
  68  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'web');
  69  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  70  |     const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
  71  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="unsent notes";window.keptObject={value:42};true');
  72  |     const requestCount = f.requests.filter(url => url === '/first').length;
  73  |     await f.page.getByRole('tab', { name: /notes.md/ }).click();
  74  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  75  |     await webTab.click();
  76  |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value,node:typeof require,desktop:typeof window.marktex})'))
  77  |       .toEqual({ draft: 'unsent notes', value: 42, node: 'undefined', desktop: 'undefined' });
  78  |     expect(f.requests.filter(url => url === '/first').length).toBe(requestCount);
  79  |     await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
  80  |     await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  81  |     await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
  82  |     await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
  83  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/second`);
  84  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
  85  |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  86  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  87  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  88  |     const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
  89  |     const tabBox = (await webTab.boundingBox())!;
  90  |     await f.page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
  91  |     await f.page.mouse.down();
  92  |     await f.page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
  93  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(0);
  94  |     await f.page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
  95  |       bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
  96  |     })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
  97  |     await expect(f.page.locator('.shell')).toHaveClass(/is-tab-dragging/);
  98  |     await f.page.mouse.move(box.x + box.width * .96, box.y + box.height / 2, { steps: 12 });
  99  |     await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
  100 |     await f.page.mouse.up();
  101 |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  102 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
  103 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  104 |     await f.page.screenshot({ path: 'test-results/browser-split.png' });
  105 |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="strip move draft";window.stripIdentity={value:73};true');
  106 |     const strip = f.page.locator('.tab-strip').first(), stripBox = (await strip.boundingBox())!;
  107 |     // CDP mouse.down does not press the OS button. Hiding a native child can
  108 |     // then inject a real buttons=0 mousemove at the X11 cursor, canceling that
  109 |     // synthetic press before dragstart. Keep this fast return gesture native,
  110 |     // with no pointer pacing or readiness wait, so both input streams agree.
  111 |     const nativeWindow = await f.app.browserWindow(f.page), movingBox = (await webTab.boundingBox())!;
  112 |     const points = await nativeWindow.evaluate((window, { movingBox, stripBox }) => {
  113 |       const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  114 |       return { from: { x: b.x + (movingBox.x + movingBox.width / 2) * z, y: b.y + (movingBox.y + movingBox.height / 2) * z },
  115 |         to: { x: b.x + (stripBox.x + stripBox.width - 16) * z, y: b.y + (stripBox.y + 2) * z } };
  116 |     }, { movingBox, stripBox });
  117 |     await nativeInput({ pointer: [points.from], button: 'down', pointerIntervalMs: 0 });
  118 |     await nativeInput({ pointer: [{ x: points.from.x + 12, y: points.from.y }], pointerIntervalMs: 0 });
  119 |     await nativeInput({ pointer: [points.to], pointerIntervalMs: 0 });
  120 |     await nativeInput({ button: 'up' });
  121 |     await nativeWindow.dispose();
> 122 |     await expect(f.page.locator('.editor-group')).toHaveCount(1);
      |                                                   ^ Error: expect(locator).toHaveCount(expected) failed
  123 |     await expect(f.page.locator('.tab-name')).toHaveText(['notes.md', 'Research page']);
  124 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(1);
  125 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  126 |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,identity:window.stripIdentity.value})'))
  127 |       .toEqual({ draft: 'strip move draft', identity: 73 });
  128 | 
  129 |     expect(f.errors).toEqual([]);
  130 |   } finally {
  131 |     await writeFile(test.info().outputPath('navigation-drag.json'), JSON.stringify(await f.page.evaluate(() => (globalThis as any).navigationDragEvents ?? null), null, 2));
  132 |     await f.page.screenshot({ path: test.info().outputPath('navigation-final.png') });
  133 |     await f.dispose();
  134 |   }
  135 | });
  136 | 
  137 | test('the first web page opens from a fresh empty workspace and popups preserve their opener', async () => {
  138 |   const f = await fixture(false);
  139 |   try {
  140 |     await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
  141 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  142 |     await expect(address).not.toBeFocused();
  143 |     await expect(address).toHaveValue('https://www.google.com/');
  144 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  145 |     await address.fill(`${f.origin}/first`);
  146 |     await address.press('Enter');
  147 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  148 |     await evaluatePage(f.app, f.origin, `window.child=window.open('about:blank');child.document.title='Live popup';child.document.body.innerHTML='<p>Popup content</p>';true`);
  149 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toBeVisible();
  150 |     expect(await evaluatePage(f.app, f.origin, 'child.opener===window')).toBe(true);
  151 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toHaveAttribute('aria-selected', 'true');
  152 |     expect(f.errors).toEqual([]);
  153 |   } finally { await f.dispose(); }
  154 | });
  155 | 
  156 | test('closing an opener preserves child and descendant tabs with their live state', async () => {
  157 |   const f = await fixture();
  158 |   try {
  159 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  160 |     const parent = f.page.getByRole('tab', { name: /Research page/ });
  161 |     await expect(parent).toBeVisible();
  162 |     await evaluatePage(f.app, f.origin, `
  163 |       window.child = window.open('about:blank');
  164 |       child.document.title = 'Independent child';
  165 |       child.document.body.innerHTML = '<input id="draft">';
  166 |       child.document.querySelector('#draft').value = 'Unsent child draft';
  167 |       child.keptObject = { value: 42 };
  168 |       true;
  169 |     `);
  170 |     const child = f.page.getByRole('tab', { name: /Independent child/ });
  171 |     await expect(child).toBeVisible();
  172 |     const childId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent child')!.id);
  173 |     await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(`
  174 |       window.child = window.open('about:blank');
  175 |       child.document.title = 'Independent grandchild';
  176 |       child.document.body.innerHTML = '<input id="draft">';
  177 |       child.document.querySelector('#draft').value = 'Unsent grandchild draft';
  178 |       child.keptObject = { value: 73 };
  179 |       true;
  180 |     `), childId);
  181 |     const grandchild = f.page.getByRole('tab', { name: /Independent grandchild/ });
  182 |     await expect(grandchild).toBeVisible();
  183 |     const grandchildId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent grandchild')!.id);
  184 |     expect(await evaluatePage(f.app, f.origin, 'child.opener === window && child.child.opener === child')).toBe(true);
  185 |     const state = (id: number) => f.app.evaluate(async ({ webContents }, id) => {
  186 |       const wc = webContents.fromId(id);
  187 |       return wc ? wc.executeJavaScript('({ draft: document.querySelector("#draft").value, value: keptObject.value, openerDetached: opener === null })') : null;
  188 |     }, id);
  189 | 
  190 |     await parent.locator('.tab-close').click();
  191 |     await expect(parent).toHaveCount(0);
  192 |     await expect(child).toBeVisible();
  193 |     await expect(grandchild).toBeVisible();
  194 |     expect(await state(childId)).toEqual({ draft: 'Unsent child draft', value: 42, openerDetached: true });
  195 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: false });
  196 |     await child.click();
  197 |     await expect(child).toHaveAttribute('aria-selected', 'true');
  198 |     await child.locator('.tab-close').click();
  199 |     await expect(child).toHaveCount(0);
  200 |     await expect.poll(() => state(childId)).toBeNull();
  201 |     await expect(grandchild).toBeVisible();
  202 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: true });
  203 |     await grandchild.locator('.tab-close').click();
  204 |     await expect(grandchild).toHaveCount(0);
  205 |     await expect.poll(() => state(grandchildId)).toBeNull();
  206 |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  207 |     expect(f.errors).toEqual([]);
  208 |   } finally { await f.dispose(); }
  209 | });
  210 | 
  211 | test('file URLs and web addresses replace the current tab, including PDFs outside the project', async () => {
  212 |   const f = await fixture();
  213 |   const downloads = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  214 |   const pdf = path.join(downloads, "'26년 하반기 서울대 JD_게시용 # %20.pdf");
  215 |   await writeFile(pdf, pdfFixture(2));
  216 |   try {
  217 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  218 |     await expect(selected).toContainText('notes.md');
  219 |     const id = (await selected.getAttribute('data-tab-id'))!;
  220 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  221 |     const original = path.join(f.root, 'notes.md');
  222 |     await expect(address).toHaveValue(pathToFileURL(original).href);
```