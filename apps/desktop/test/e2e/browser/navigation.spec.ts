import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { pdfFixture } from '../../support/media/pdf-fixture';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('terminal addresses navigate through web and files while sessions and tab zoom stay independent', async () => {
  const f = await fixture();
  try {
    await f.page.locator('.new-terminal-tab-button').click();
    await expect(f.page.getByRole('tab', { name: /Terminal 1/ })).toHaveAttribute('aria-selected', 'true');
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    const location = await address.inputValue(); expect(location).toMatch(/^terminal:\/\/[\da-f-]+$/);
    const input = () => f.page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
    await input().pressSequentially('export SETDOWN_SESSION=retained'); await input().press('Enter');
    await f.page.getByRole('button', { name: 'Zoom terminal in', exact: true }).click();
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    const go = async (url: string) => { await address.fill(url); await address.press('Enter'); };
    await go(`${f.origin}/first`);
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
    await go(pathToFileURL(path.join(f.root, 'notes.md')).href);
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
    await expect(address).toHaveValue(/^file:\/\//);
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(address).toHaveValue(location);
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    await input().pressSequentially(`printf "$SETDOWN_SESSION" > '${f.root}/retained.txt'`); await input().press('Enter');
    await expect.poll(() => readFile(path.join(f.root, 'retained.txt'), 'utf8').catch(() => '')).toBe('retained');
    await f.page.getByRole('button', { name: 'Forward', exact: true }).click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await f.page.locator('.terminal-list .select').filter({ hasText: 'Terminal 1' }).click();
    await expect(address).toHaveValue(location);
    await f.page.locator('.new-terminal-tab-button').click();
    await expect(f.page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('100%');
    await f.page.getByRole('tab', { name: /Terminal 1/ }).click();
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('web pages share document tabs, retain live state, navigate, bookmark, and split', async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  try {
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const webTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(webTab).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
    const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="unsent notes";window.keptObject={value:42};true');
    const requestCount = f.requests.filter(url => url === '/first').length;
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await webTab.click();
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value,node:typeof require,desktop:typeof window.marktex})'))
      .toEqual({ draft: 'unsent notes', value: 42, node: 'undefined', desktop: 'undefined' });
    expect(f.requests.filter(url => url === '/first').length).toBe(requestCount);
    await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/second`);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
    const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
    const tabBox = (await webTab.boundingBox())!;
    await f.page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
    await f.page.mouse.down();
    await f.page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(0);
    await f.page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
      bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
    })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
    await expect(f.page.locator('.shell')).toHaveClass(/is-tab-dragging/);
    await f.page.mouse.move(box.x + box.width * .96, box.y + box.height / 2, { steps: 12 });
    await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
    await f.page.mouse.up();
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
    await f.page.screenshot({ path: 'test-results/browser-split.png' });
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="strip move draft";window.stripIdentity={value:73};true');
    const strip = f.page.locator('.tab-strip').first(), stripBox = (await strip.boundingBox())!;
    await webTab.dragTo(strip, { targetPosition: { x: stripBox.width - 16, y: 2 } });
    await expect(f.page.locator('.editor-group')).toHaveCount(1);
    await expect(f.page.locator('.tab-name')).toHaveText(['notes.md', 'Research page']);
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(1);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,identity:window.stripIdentity.value})'))
      .toEqual({ draft: 'strip move draft', identity: 73 });

    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('the first web page opens from a fresh empty workspace and popups preserve their opener', async () => {
  const f = await fixture(false);
  try {
    await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(address).not.toBeFocused();
    await expect(address).toHaveValue('https://www.google.com/');
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    await address.fill(`${f.origin}/first`);
    await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `window.child=window.open('about:blank');child.document.title='Live popup';child.document.body.innerHTML='<p>Popup content</p>';true`);
    await expect(f.page.getByRole('tab', { name: /Live popup/ })).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'child.opener===window')).toBe(true);
    await expect(f.page.getByRole('tab', { name: /Live popup/ })).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('closing an opener preserves child and descendant tabs with their live state', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const parent = f.page.getByRole('tab', { name: /Research page/ });
    await expect(parent).toBeVisible();
    await evaluatePage(f.app, f.origin, `
      window.child = window.open('about:blank');
      child.document.title = 'Independent child';
      child.document.body.innerHTML = '<input id="draft">';
      child.document.querySelector('#draft').value = 'Unsent child draft';
      child.keptObject = { value: 42 };
      true;
    `);
    const child = f.page.getByRole('tab', { name: /Independent child/ });
    await expect(child).toBeVisible();
    const childId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent child')!.id);
    await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(`
      window.child = window.open('about:blank');
      child.document.title = 'Independent grandchild';
      child.document.body.innerHTML = '<input id="draft">';
      child.document.querySelector('#draft').value = 'Unsent grandchild draft';
      child.keptObject = { value: 73 };
      true;
    `), childId);
    const grandchild = f.page.getByRole('tab', { name: /Independent grandchild/ });
    await expect(grandchild).toBeVisible();
    const grandchildId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Independent grandchild')!.id);
    expect(await evaluatePage(f.app, f.origin, 'child.opener === window && child.child.opener === child')).toBe(true);
    const state = (id: number) => f.app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      return wc ? wc.executeJavaScript('({ draft: document.querySelector("#draft").value, value: keptObject.value, openerDetached: opener === null })') : null;
    }, id);

    await parent.locator('.tab-close').click();
    await expect(parent).toHaveCount(0);
    await expect(child).toBeVisible();
    await expect(grandchild).toBeVisible();
    expect(await state(childId)).toEqual({ draft: 'Unsent child draft', value: 42, openerDetached: true });
    expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: false });
    await child.click();
    await expect(child).toHaveAttribute('aria-selected', 'true');
    await child.locator('.tab-close').click();
    await expect(child).toHaveCount(0);
    await expect.poll(() => state(childId)).toBeNull();
    await expect(grandchild).toBeVisible();
    expect(await state(grandchildId)).toEqual({ draft: 'Unsent grandchild draft', value: 73, openerDetached: true });
    await grandchild.locator('.tab-close').click();
    await expect(grandchild).toHaveCount(0);
    await expect.poll(() => state(grandchildId)).toBeNull();
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('file URLs and web addresses replace the current tab, including PDFs outside the project', async () => {
  const f = await fixture();
  const downloads = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  const pdf = path.join(downloads, "'26년 하반기 서울대 JD_게시용 # %20.pdf");
  await writeFile(pdf, pdfFixture(2));
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = (await selected.getAttribute('data-tab-id'))!;
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const original = path.join(f.root, 'notes.md');
    await expect(address).toHaveValue(pathToFileURL(original).href);
    const go = async (value: string) => { await address.fill(value); await address.press('Enter'); };
    await go(`${f.origin}/first`);
    await expect(selected).toContainText('Research page');
    const contentsId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await go(pathToFileURL(pdf).href);
    await expect(selected).toContainText(path.basename(pdf));
    await expect(address).toHaveValue(pathToFileURL(pdf).href);
    const reader = f.page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(reader).toHaveAttribute('data-pdf-pages', '2');
    await expect(reader.locator('[data-page-number="1"] .textLayer')).toContainText('PDF page 1');
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), contentsId)).toBe(false);
    await go(`${f.origin}/second`);
    await expect(selected).toContainText('Second page');
    await expect(f.page.locator('.pdf-surface')).toHaveCount(0);
    await go(original); // Absolute paths remain accepted too.
    await expect(selected).toContainText('notes.md');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await expect(address).toHaveValue(pathToFileURL(original).href);
    await expect.poll(() => f.app.evaluate(async ({ BrowserWindow }) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible());
      if (views.length !== 1) return '';
      return (views[0] as import('electron').WebContentsView).webContents.executeJavaScript('document.body.innerText');
    })).toContain('Keep the reader intact.');
    await go(pathToFileURL(path.join(downloads, 'missing.pdf')).href);
    await expect(f.page.locator('.location-error[role="alert"]')).toContainText('ENOENT');
    await expect(selected).toContainText('notes.md');
    await expect(selected).toHaveAttribute('data-tab-id', id);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); await rm(downloads, { recursive: true, force: true }); }
});

test('address navigation asks to save edited files and cancellation preserves the current tab', async () => {
  const f = await fixture();
  const file = path.join(f.root, 'edited.txt');
  await writeFile(file, 'Original text\n');
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = (await selected.getAttribute('data-tab-id'))!;
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(pathToFileURL(file).href); await address.press('Enter');
    await expect(selected).toContainText('edited.txt');
    const editor = f.page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unsaved marker');
    await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    const prompt = f.page.getByRole('dialog', { name: 'Save Changes' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await expect(prompt).toHaveCount(0);
    await expect(selected).toContainText('edited.txt');
    await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
    await expect(address).toHaveValue(pathToFileURL(file).href);
    expect(await readFile(file, 'utf8')).not.toContain('unsaved marker');
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(selected).toContainText('Research page');
    expect(await readFile(file, 'utf8')).toContain('unsaved marker');
    await expect(selected).toHaveAttribute('data-tab-id', id);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Back and Forward traverse file and web boundaries while restoring the native web stack', async () => {
  const f = await fixture();
  const pdf = path.join(f.root, 'history.pdf');
  await writeFile(pdf, pdfFixture(2));
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = await selected.getAttribute('data-tab-id');
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const back = f.page.getByRole('button', { name: 'Back', exact: true });
    const forward = f.page.getByRole('button', { name: 'Forward', exact: true });
    await expect(back).toBeDisabled();
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await expect(selected).toContainText('Research page');
    await evaluatePage(f.app, f.origin, 'document.querySelector("a").click();true');
    await expect(address).toHaveValue(`${f.origin}/second`);
    await address.fill(pathToFileURL(pdf).href); await address.press('Enter');
    await expect(f.page.getByRole('region', { name: 'PDF reader', exact: true })).toHaveAttribute('data-pdf-pages', '2');
    await back.click();
    await expect(address).toHaveValue(`${f.origin}/second`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/second');
    await back.click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    // Input in the native page must also cross the last web entry into a file.
    await f.app.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
    }, f.origin);
    await expect(selected).toContainText('notes.md');
    await expect(address).toHaveValue(pathToFileURL(path.join(f.root, 'notes.md')).href);
    await expect(back).toBeDisabled();
    await forward.click(); await expect(address).toHaveValue(`${f.origin}/first`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/first');
    await forward.click(); await expect(address).toHaveValue(`${f.origin}/second`);
    await forward.click(); await expect(selected).toContainText('history.pdf');
    await back.click(); await expect(address).toHaveValue(`${f.origin}/second`);
    await address.fill(`${f.origin}/new-branch`); await address.press('Enter');
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/new-branch');
    await expect(forward).toBeDisabled();
    await expect(selected).toHaveAttribute('data-tab-id', id!);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

