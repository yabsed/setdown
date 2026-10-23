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
  1   | import { expect, test } from '@playwright/test';
  2   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  3   | import { pathToFileURL } from 'node:url';
  4   | import os from 'node:os';
  5   | import path from 'node:path';
  6   | import { pdfFixture } from '../../support/media/pdf-fixture';
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
  52  |   try {
  53  |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  54  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  55  |     const webTab = f.page.getByRole('tab', { name: /Research page/ });
  56  |     await expect(webTab).toHaveAttribute('aria-selected', 'true');
  57  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'web');
  58  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  59  |     const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
  60  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="unsent notes";window.keptObject={value:42};true');
  61  |     const requestCount = f.requests.filter(url => url === '/first').length;
  62  |     await f.page.getByRole('tab', { name: /notes.md/ }).click();
  63  |     await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  64  |     await webTab.click();
  65  |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value,node:typeof require,desktop:typeof window.marktex})'))
  66  |       .toEqual({ draft: 'unsent notes', value: 42, node: 'undefined', desktop: 'undefined' });
  67  |     expect(f.requests.filter(url => url === '/first').length).toBe(requestCount);
  68  |     await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
  69  |     await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  70  |     await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
  71  |     await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
  72  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/second`);
  73  |     await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
  74  |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  75  |     await f.page.getByRole('button', { name: 'Back', exact: true }).click();
  76  |     await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
  77  |     const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
  78  |     const tabBox = (await webTab.boundingBox())!;
  79  |     await f.page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
  80  |     await f.page.mouse.down();
  81  |     await f.page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
  82  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(0);
  83  |     await f.page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
  84  |       bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
  85  |     })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
  86  |     await expect(f.page.locator('.shell')).toHaveClass(/is-tab-dragging/);
  87  |     await f.page.mouse.move(box.x + box.width * .96, box.y + box.height / 2, { steps: 12 });
  88  |     await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
  89  |     await f.page.mouse.up();
  90  |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  91  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
  92  |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  93  |     await f.page.screenshot({ path: 'test-results/browser-split.png' });
  94  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="strip move draft";window.stripIdentity={value:73};true');
  95  |     const strip = f.page.locator('.tab-strip').first(), stripBox = (await strip.boundingBox())!;
  96  |     await webTab.dragTo(strip, { targetPosition: { x: stripBox.width - 16, y: 2 } });
> 97  |     await expect(f.page.locator('.editor-group')).toHaveCount(1);
      |                                                   ^ Error: expect(locator).toHaveCount(expected) failed
  98  |     await expect(f.page.locator('.tab-name')).toHaveText(['notes.md', 'Research page']);
  99  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(1);
  100 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
  101 |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,identity:window.stripIdentity.value})'))
  102 |       .toEqual({ draft: 'strip move draft', identity: 73 });
  103 | 
  104 |     expect(f.errors).toEqual([]);
  105 |   } finally { await f.dispose(); }
  106 | });
  107 | 
  108 | test('the first web page opens from a fresh empty workspace and popups preserve their opener', async () => {
  109 |   const f = await fixture(false);
  110 |   try {
  111 |     await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
  112 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  113 |     await expect(address).not.toBeFocused();
  114 |     await expect(address).toHaveValue('https://www.google.com/');
  115 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  116 |     await address.fill(`${f.origin}/first`);
  117 |     await address.press('Enter');
  118 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  119 |     await evaluatePage(f.app, f.origin, `window.child=window.open('about:blank');child.document.title='Live popup';child.document.body.innerHTML='<p>Popup content</p>';true`);
  120 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toBeVisible();
  121 |     expect(await evaluatePage(f.app, f.origin, 'child.opener===window')).toBe(true);
  122 |     await expect(f.page.getByRole('tab', { name: /Live popup/ })).toHaveAttribute('aria-selected', 'true');
  123 |     expect(f.errors).toEqual([]);
  124 |   } finally { await f.dispose(); }
  125 | });
  126 | 
  127 | test('closing an opener preserves child and descendant tabs with their live state', async () => {
  128 |   const f = await fixture();
  129 |   try {
  130 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  131 |     const parent = f.page.getByRole('tab', { name: /Research page/ });
  132 |     await expect(parent).toBeVisible();
  133 |     await evaluatePage(f.app, f.origin, `
  134 |       window.child = window.open('about:blank');
  135 |       child.document.title = 'Independent child';
  136 |       child.document.body.innerHTML = '<input id="draft">';
  137 |       child.document.querySelector('#draft').value = 'Unsent child draft';
  138 |       child.keptObject = { value: 42 };
  139 |       true;
  140 |     `);
  141 |     const child = f.page.getByRole('tab', { name: /Independent child/ });
  142 |     await expect(child).toBeVisible();
  143 |     const childId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent child')!.id);
  144 |     await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(`
  145 |       window.child = window.open('about:blank');
  146 |       child.document.title = 'Independent grandchild';
  147 |       child.document.body.innerHTML = '<input id="draft">';
  148 |       child.document.querySelector('#draft').value = 'Unsent grandchild draft';
  149 |       child.keptObject = { value: 73 };
  150 |       true;
  151 |     `), childId);
  152 |     const grandchild = f.page.getByRole('tab', { name: /Independent grandchild/ });
  153 |     await expect(grandchild).toBeVisible();
  154 |     const grandchildId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent grandchild')!.id);
  155 |     expect(await evaluatePage(f.app, f.origin, 'child.opener === window && child.child.opener === child')).toBe(true);
  156 |     const state = (id: number) => f.app.evaluate(async ({ webContents }, id) => {
  157 |       const wc = webContents.fromId(id);
  158 |       return wc ? wc.executeJavaScript('({ draft: document.querySelector("#draft").value, value: keptObject.value, openerDetached: opener === null })') : null;
  159 |     }, id);
  160 | 
  161 |     await parent.locator('.tab-close').click();
  162 |     await expect(parent).toHaveCount(0);
  163 |     await expect(child).toBeVisible();
  164 |     await expect(grandchild).toBeVisible();
  165 |     expect(await state(childId)).toEqual({ draft: 'Unsent child draft', value: 42, openerDetached: true });
  166 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: false });
  167 |     await child.click();
  168 |     await expect(child).toHaveAttribute('aria-selected', 'true');
  169 |     await child.locator('.tab-close').click();
  170 |     await expect(child).toHaveCount(0);
  171 |     await expect.poll(() => state(childId)).toBeNull();
  172 |     await expect(grandchild).toBeVisible();
  173 |     expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: true });
  174 |     await grandchild.locator('.tab-close').click();
  175 |     await expect(grandchild).toHaveCount(0);
  176 |     await expect.poll(() => state(grandchildId)).toBeNull();
  177 |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  178 |     expect(f.errors).toEqual([]);
  179 |   } finally { await f.dispose(); }
  180 | });
  181 | 
  182 | test('file URLs and web addresses replace the current tab, including PDFs outside the project', async () => {
  183 |   const f = await fixture();
  184 |   const downloads = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  185 |   const pdf = path.join(downloads, "'26년 하반기 서울대 JD_게시용 # %20.pdf");
  186 |   await writeFile(pdf, pdfFixture(2));
  187 |   try {
  188 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  189 |     await expect(selected).toContainText('notes.md');
  190 |     const id = (await selected.getAttribute('data-tab-id'))!;
  191 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  192 |     const original = path.join(f.root, 'notes.md');
  193 |     await expect(address).toHaveValue(pathToFileURL(original).href);
  194 |     const go = async (value: string) => { await address.fill(value); await address.press('Enter'); };
  195 |     await go(`${f.origin}/first`);
  196 |     await expect(selected).toContainText('Research page');
  197 |     const contentsId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
```