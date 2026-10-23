# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/navigation.spec.ts >> web pages share document tabs, retain live state, navigate, bookmark, and split
- Location: test/e2e/browser/navigation.spec.ts:49:1

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
  7   | 
  8   | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  9   | 
  10  | test('terminal addresses navigate through web and files while sessions and tab zoom stay independent', async () => {
  11  |   const f = await fixture();
  12  |   try {
  13  |     await f.page.locator('.new-terminal-tab-button').click();
  14  |     await expect(f.page.getByRole('tab', { name: /Terminal 1/ })).toHaveAttribute('aria-selected', 'true');
  15  |     const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
  16  |     const location = await address.inputValue(); expect(location).toMatch(/^terminal:\/\/[\da-f-]+$/);
  17  |     const input = () => f.page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  18  |     await input().pressSequentially('export SETDOWN_SESSION=retained'); await input().press('Enter');
  19  |     await f.page.getByRole('button', { name: 'Zoom terminal in', exact: true }).click();
  20  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
  21  |     const go = async (url: string) => { await address.fill(url); await address.press('Enter'); };
  22  |     await go(`${f.origin}/first`);
  23  |     await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
  24  |     await go(pathToFileURL(path.join(f.root, 'notes.md')).href);
  25  |     await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
  26  |     await expect(address).toHaveValue(/^file:\/\//);
  27  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  28  |     await expect(address).toHaveValue(`${f.origin}/first`);
  29  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  30  |     await expect(address).toHaveValue(location);
  31  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
  32  |     await input().pressSequentially(`printf "$SETDOWN_SESSION" > '${f.root}/retained.txt'`); await input().press('Enter');
  33  |     await expect.poll(() => readFile(path.join(f.root, 'retained.txt'), 'utf8').catch(() => '')).toBe('retained');
  34  |     await f.page.getByRole('button', { name: 'Forward', exact: true }).click();
  35  |     await expect(address).toHaveValue(`${f.origin}/first`);
  36  |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  37  |     await f.page.getByRole('button', { name: 'Terminal', exact: true }).click();
  38  |     await f.page.locator('.terminal-list .select').filter({ hasText: 'Terminal 1' }).click();
  39  |     await expect(address).toHaveValue(location);
  40  |     await f.page.locator('.new-terminal-tab-button').click();
  41  |     await expect(f.page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute('aria-selected', 'true');
  42  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('100%');
  43  |     await f.page.getByRole('tab', { name: /Terminal 1/ }).click();
  44  |     await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
  45  |     expect(f.errors).toEqual([]);
  46  |   } finally { await f.dispose(); }
  47  | });
  48  | 
  49  | test('web pages share document tabs, retain live state, navigate, bookmark, and split', async () => {
  50  |   test.setTimeout(90_000);
  51  |   const f = await fixture();
  52  |   await f.page.evaluate(() => {
  53  |     const events: unknown[] = []; (globalThis as any).navigationDragEvents = events;
  54  |     window.marktex.onTabDragState(state => events.push({ at: Date.now(), type: 'shared', ...state }));
  55  |     for (const type of ['pointerdown', 'pointercancel', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'focus', 'blur', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  56  |       const e = event as DragEvent;
  57  |       events.push({ at: Date.now(), type, target: (e.target as Element | null)?.className, x: e.clientX, y: e.clientY,
  58  |         screenX: e.screenX, screenY: e.screenY, effect: e.dataTransfer?.dropEffect, prevented: e.defaultPrevented, detail: e.detail, buttons: e.buttons,
  59  |         active: document.activeElement?.className, draggable: (e.target as Element | null)?.closest?.('[draggable]')?.getAttribute('draggable') });
  60  |     }, true);
  61  |   });
  62  |   try {
  63  |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  64  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  65  |     const webTab = f.page.getByRole('tab', { name: /Research page/ });
  66  |     await expect(webTab).toHaveAttribute('aria-selected', 'true');
  67  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'web');
  68  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  69  |     const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
  70  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="unsent notes";window.keptObject={value:42};true');
  71  |     const requestCount = f.requests.filter(url => url === '/first').length;
  72  |     await f.page.getByRole('tab', { name: /notes.md/ }).click();
  73  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  74  |     await webTab.click();
  75  |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value,node:typeof require,desktop:typeof window.marktex})'))
  76  |       .toEqual({ draft: 'unsent notes', value: 42, node: 'undefined', desktop: 'undefined' });
  77  |     expect(f.requests.filter(url => url === '/first').length).toBe(requestCount);
  78  |     await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
  79  |     await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  80  |     await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
  81  |     await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
  82  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/second`);
  83  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
  84  |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  85  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  86  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  87  |     const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
  88  |     const tabBox = (await webTab.boundingBox())!;
  89  |     await f.page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
  90  |     await f.page.mouse.down();
  91  |     await f.page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
  92  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(0);
  93  |     await f.page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
  94  |       bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
  95  |     })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
  96  |     await expect(f.page.locator('.shell')).toHaveClass(/is-tab-dragging/);
  97  |     await f.page.mouse.move(box.x + box.width * .96, box.y + box.height / 2, { steps: 12 });
  98  |     await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
  99  |     await f.page.mouse.up();
  100 |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  101 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
  102 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  103 |     await f.page.screenshot({ path: 'test-results/browser-split.png' });
  104 |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="strip move draft";window.stripIdentity={value:73};true');
  105 |     const strip = f.page.locator('.tab-strip').first(), stripBox = (await strip.boundingBox())!;
  106 |     await webTab.dragTo(strip, { targetPosition: { x: stripBox.width - 16, y: 2 } });
> 107 |     await expect(f.page.locator('.editor-group')).toHaveCount(1);
      |                                                   ^ Error: expect(locator).toHaveCount(expected) failed
  108 |     await expect(f.page.locator('.tab-name')).toHaveText(['notes.md', 'Research page']);
  109 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(1);
  110 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  111 |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,identity:window.stripIdentity.value})'))
  112 |       .toEqual({ draft: 'strip move draft', identity: 73 });
  113 | 
  114 |     expect(f.errors).toEqual([]);
  115 |   } finally {
  116 |     await writeFile(test.info().outputPath('navigation-drag.json'), JSON.stringify(await f.page.evaluate(() => (globalThis as any).navigationDragEvents ?? null), null, 2));
  117 |     await f.page.screenshot({ path: test.info().outputPath('navigation-final.png') });
  118 |     await f.dispose();
  119 |   }
  120 | });
  121 | 
  122 | test('the first web page opens from a fresh empty workspace and popups preserve their opener', async () => {
  123 |   const f = await fixture(false);
  124 |   try {
  125 |     await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
  126 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  127 |     await expect(address).not.toBeFocused();
  128 |     await expect(address).toHaveValue('https://www.google.com/');
  129 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  130 |     await address.fill(`${f.origin}/first`);
  131 |     await address.press('Enter');
  132 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  133 |     await evaluatePage(f.app, f.origin, `window.child=window.open('about:blank');child.document.title='Live popup';child.document.body.innerHTML='<p>Popup content</p>';true`);
  134 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toBeVisible();
  135 |     expect(await evaluatePage(f.app, f.origin, 'child.opener===window')).toBe(true);
  136 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toHaveAttribute('aria-selected', 'true');
  137 |     expect(f.errors).toEqual([]);
  138 |   } finally { await f.dispose(); }
  139 | });
  140 | 
  141 | test('closing an opener preserves child and descendant tabs with their live state', async () => {
  142 |   const f = await fixture();
  143 |   try {
  144 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  145 |     const parent = f.page.getByRole('tab', { name: /Research page/ });
  146 |     await expect(parent).toBeVisible();
  147 |     await evaluatePage(f.app, f.origin, `
  148 |       window.child = window.open('about:blank');
  149 |       child.document.title = 'Independent child';
  150 |       child.document.body.innerHTML = '<input id="draft">';
  151 |       child.document.querySelector('#draft').value = 'Unsent child draft';
  152 |       child.keptObject = { value: 42 };
  153 |       true;
  154 |     `);
  155 |     const child = f.page.getByRole('tab', { name: /Independent child/ });
  156 |     await expect(child).toBeVisible();
  157 |     const childId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent child')!.id);
  158 |     await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(`
  159 |       window.child = window.open('about:blank');
  160 |       child.document.title = 'Independent grandchild';
  161 |       child.document.body.innerHTML = '<input id="draft">';
  162 |       child.document.querySelector('#draft').value = 'Unsent grandchild draft';
  163 |       child.keptObject = { value: 73 };
  164 |       true;
  165 |     `), childId);
  166 |     const grandchild = f.page.getByRole('tab', { name: /Independent grandchild/ });
  167 |     await expect(grandchild).toBeVisible();
  168 |     const grandchildId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent grandchild')!.id);
  169 |     expect(await evaluatePage(f.app, f.origin, 'child.opener === window && child.child.opener === child')).toBe(true);
  170 |     const state = (id: number) => f.app.evaluate(async ({ webContents }, id) => {
  171 |       const wc = webContents.fromId(id);
  172 |       return wc ? wc.executeJavaScript('({ draft: document.querySelector("#draft").value, value: keptObject.value, openerDetached: opener === null })') : null;
  173 |     }, id);
  174 | 
  175 |     await parent.locator('.tab-close').click();
  176 |     await expect(parent).toHaveCount(0);
  177 |     await expect(child).toBeVisible();
  178 |     await expect(grandchild).toBeVisible();
  179 |     expect(await state(childId)).toEqual({ draft: 'Unsent child draft', value: 42, openerDetached: true });
  180 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: false });
  181 |     await child.click();
  182 |     await expect(child).toHaveAttribute('aria-selected', 'true');
  183 |     await child.locator('.tab-close').click();
  184 |     await expect(child).toHaveCount(0);
  185 |     await expect.poll(() => state(childId)).toBeNull();
  186 |     await expect(grandchild).toBeVisible();
  187 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: true });
  188 |     await grandchild.locator('.tab-close').click();
  189 |     await expect(grandchild).toHaveCount(0);
  190 |     await expect.poll(() => state(grandchildId)).toBeNull();
  191 |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  192 |     expect(f.errors).toEqual([]);
  193 |   } finally { await f.dispose(); }
  194 | });
  195 | 
  196 | test('file URLs and web addresses replace the current tab, including PDFs outside the project', async () => {
  197 |   const f = await fixture();
  198 |   const downloads = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  199 |   const pdf = path.join(downloads, "'26년 하반기 서울대 JD_게시용 # %20.pdf");
  200 |   await writeFile(pdf, pdfFixture(2));
  201 |   try {
  202 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  203 |     await expect(selected).toContainText('notes.md');
  204 |     const id = (await selected.getAttribute('data-tab-id'))!;
  205 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  206 |     const original = path.join(f.root, 'notes.md');
  207 |     await expect(address).toHaveValue(pathToFileURL(original).href);
```