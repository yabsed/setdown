import { electron } from '../../support/electron/electron-app';
import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';
import { docxBytes, docxParagraphs, docxText, docxXml, writeDocxFixture } from '../../support/media/docx-fixture';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';

// report.docx is the LibreOffice-generated fixture the Office reader uses; the other
// documents are minimal packages written by the test itself.
const fixtures = path.join(import.meta.dirname, '../../fixtures/office');
const MARKER = 'Unique marker: quokka-reading-room.';
const launch = async (file: string | undefined, config: string) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: file ? ['.', file] : ['.'], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};
const word = (page: Page) => page.getByRole('region', { name: 'Word document', exact: true });
const ready = (page: Page) => expect(word(page)).toHaveAttribute('data-office-ready', 'true', { timeout: 30_000 });
const scroller = (page: Page) => word(page).locator('.docx-editor__scroll-container');
const scrolled = (page: Page) => scroller(page).evaluate(element => element.scrollTop);
async function report(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)), file = path.join(root, 'report.docx');
  await copyFile(path.join(fixtures, 'report.docx'), file);
  return { root, file, config: path.join(root, 'config') };
}
async function edit(page: Page) {
  await word(page).getByRole('button', { name: 'Edit document', exact: true }).click();
  await expect(word(page)).toHaveAttribute('data-docx-mode', 'edit');
}
/** Places the caret after the last character of the line that shows `text`. */
async function caretAfter(page: Page, text: string) {
  const line = word(page).getByText(text).first();
  await line.scrollIntoViewIfNeeded();
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await page.keyboard.press('End');
}
const dirtyTabs = (page: Page) => page.locator('.document-tab .tab-dirty');
const stubSaveDialog = (app: TestApplication, result: { canceled: boolean; filePath: string }) =>
  app.evaluate(({ dialog }, value) => { dialog.showSaveDialog = async () => value; }, result);

test('opens a Word document for reading: read-only pages, tab zoom and in-document find', async () => {
  const { root, file, config } = await report('setdown-docx-read-');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = word(page);
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'office');
    await ready(page);
    await expect(reader).toHaveAttribute('data-office-family', 'word');
    await expect(reader).toHaveAttribute('data-docx-mode', 'view');
    const marker = reader.getByText(MARKER);
    await expect(marker).toBeVisible();
    // The document is drawn by the Word engine, not by a Markdown preview or the text editor.
    expect(await previews(app).count()).toBe(0);
    await expect(page.locator('.mode-toggle')).toBeHidden();
    await expect(reader.getByLabel('Page', { exact: true })).toHaveText(/^1 \/ \d+$/);

    // Reading never edits: input on the pages changes nothing and nothing becomes unsaved.
    const before = await readFile(file);
    const line = (await marker.boundingBox())!;
    await page.mouse.click(line.x + line.width - 3, line.y + line.height / 2);
    await page.keyboard.type('must-not-appear');
    await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
    await expect(marker).toBeVisible();
    await expect(reader.getByText('must-not-appear')).toHaveCount(0);
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);

    const reset = page.getByRole('button', { name: 'Reset document zoom', exact: true });
    const width = () => marker.evaluate(node => node.getBoundingClientRect().width);
    await expect(reset).toHaveText('100%');
    const initial = await width();
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click();
    await expect(reset).toHaveText('110%');
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(110);
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click();
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(120);
    await reset.click();
    await expect(reset).toHaveText('100%');
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(100);
    // Ctrl+wheel belongs to the tab zoom, not to a second zoom inside the engine.
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 5);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
    await expect(reset).not.toHaveText('100%');
    await expect.poll(async () => await width() > initial).toBe(true);
    await reset.click();
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(100);

    await page.keyboard.press('Control+f');
    const search = reader.getByPlaceholder('Search document');
    await expect(search).toBeFocused();
    await search.fill('quokka');
    const count = reader.getByRole('search').getByRole('status');
    await expect(count).toHaveText('1/1');
    await search.fill('Paragraph 4');
    await expect(count).toHaveText('1/11');
    await search.press('Enter');
    await expect(count).toHaveText('2/11');
    await expect.poll(() => scrolled(page)).toBeGreaterThan(500);
    await search.press('Shift+Enter');
    await expect(count).toHaveText('1/11');
    await search.fill('no-such-text');
    await expect(count).toHaveText('0/0');
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).not.toBeFocused();

    // Saving an unchanged document writes nothing; Save As is offered and can be declined.
    await page.keyboard.press('Control+s');
    await stubSaveDialog(app, { canceled: true, filePath: '' });
    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-save-as'));
    await expect(reader).toHaveAttribute('data-docx-saving', 'false');
    expect(await readFile(file)).toEqual(before);
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('edits a Word document, saves it in place and reopens the saved text', async () => {
  const { root, file, config } = await report('setdown-docx-edit-');
  let app = await launch(file, config), page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const reader = word(page);
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');

    // Character formatting follows the selection and shows in the toolbar.
    const heading = (await reader.getByText('Setdown Office fixture').first().boundingBox())!;
    await page.mouse.dblclick(heading.x + 30, heading.y + heading.height / 2);
    const italic = reader.getByRole('button', { name: 'Italic (Ctrl+I)', exact: true });
    await expect(reader.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(reader.getByLabel('Paragraph style')).toHaveValue('Heading1');
    await expect(reader.getByLabel('Font size')).toHaveValue('24');
    await expect(italic).toHaveAttribute('aria-pressed', 'false');
    await italic.click();
    await expect(italic).toHaveAttribute('aria-pressed', 'true');
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    await expect(dirtyTabs(page)).toHaveCount(1);

    await caretAfter(page, MARKER);
    await page.keyboard.type(' EDITED-one');
    const edited = reader.getByText(`${MARKER} EDITED-one`);
    await expect(edited).toBeVisible();
    // The engine's own history answers the keyboard.
    await page.keyboard.press('Control+z');
    await expect(edited).toHaveCount(0);
    await expect(reader.getByText(MARKER)).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(edited).toBeVisible();
    // The Edit menu reaches the same history, not Chromium's.
    const menu = (item: string) => page.evaluate(id => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem(id), item);
    await menu('menu-undo');
    await expect(edited).toHaveCount(0);
    await menu('menu-redo');
    await expect(edited).toBeVisible();
    // Nothing reaches the file before Save.
    expect(await readFile(file)).toEqual(original);

    await page.keyboard.press('Control+s');
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);
    expect(await docxText(file)).toContain(`${MARKER} EDITED-one\n`);
    expect(await docxXml(file)).toMatch(/<w:i(?: [^>]*)?\/>/);
    // A save is not an external change, and it keeps the caret where the writer was.
    await expect(page.locator('.notice').first()).toBeHidden();
    await expect(reader).toHaveAttribute('data-docx-mode', 'edit');
    await page.keyboard.type('!');
    await expect(reader.getByText(`${MARKER} EDITED-one!`)).toBeVisible();
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    await reader.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    expect(await docxText(file)).toContain(`${MARKER} EDITED-one!\n`);

    await reader.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(reader).toHaveAttribute('data-docx-mode', 'view');
    await expect(reader.getByRole('button', { name: 'Edit document', exact: true })).toBeVisible();
    expect(errors).toEqual([]);

    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await ready(page);
    await expect(word(page)).toHaveAttribute('data-docx-mode', 'view');
    await expect(word(page).getByText(`${MARKER} EDITED-one!`)).toBeVisible();
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'false');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Korean composition types into the document, Esc returns to reading only outside a composition, and a double click resumes editing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-docx-ime-')), file = path.join(root, '보고서.docx');
  await writeDocxFixture(file, ['한글 문서 첫 줄', '둘째 줄입니다.']);
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    const reader = word(page);
    await ready(page);
    await expect(reader.getByText('한글 문서 첫 줄')).toBeVisible();
    await edit(page);
    await caretAfter(page, '둘째 줄입니다.');
    const cdp = await page.context().newCDPSession(page);
    const preedit = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    // CDP drives Chromium's composition path: each syllable is held open before it is committed.
    for (const sequence of [['ㅎ', '하', '한'], ['ㄱ', '그', '글']]) {
      for (const step of sequence) await preedit(step);
      await cdp.send('Input.insertText', { text: sequence[2] });
    }
    await expect(reader.getByText('둘째 줄입니다.한글')).toBeVisible();
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    // Esc that ends a composition belongs to the input method.
    await preedit('ㅇ');
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-docx-mode', 'edit');
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.waitForTimeout(30); // compositionend settlement
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-docx-mode', 'view');
    // Unsaved edits stay in the tab while reading, and Save works from either mode.
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    await page.keyboard.press('Control+s');
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    expect(await docxText(file)).toBe('한글 문서 첫 줄\n둘째 줄입니다.한글');
    const first = (await reader.getByText('한글 문서 첫 줄').first().boundingBox())!;
    await page.mouse.dblclick(first.x + 20, first.y + first.height / 2);
    await expect(reader).toHaveAttribute('data-docx-mode', 'edit');
    await cdp.detach();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Save As writes a new document and moves the tab to it; closing an edited document asks first', async () => {
  const { root, file, config } = await report('setdown-docx-save-as-');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = word(page), copy = path.join(root, 'copy.docx');
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await caretAfter(page, MARKER);
    await page.keyboard.type(' COPY-one');
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    // A name without an extension becomes a Word document.
    await stubSaveDialog(app, { canceled: false, filePath: path.join(root, 'copy') });
    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-save-as'));
    await expect(page.locator(`.document-tab[title="${copy}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    expect(await readFile(file)).toEqual(original);
    expect(await docxText(copy)).toContain(`${MARKER} COPY-one\n`);
    // The same editing session continues in the renamed tab.
    await ready(page);
    await expect(reader).toHaveAttribute('data-docx-mode', 'edit');
    await expect(reader.getByText(`${MARKER} COPY-one`)).toBeVisible();
    await caretAfter(page, `${MARKER} COPY-one`);
    await page.keyboard.press('Control+z');
    await expect(reader.getByText(`${MARKER} COPY-one`)).toHaveCount(0);
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');

    const prompt = page.locator('dialog[aria-labelledby="close-prompt-title"]');
    // Synthetic key events never reach native menu accelerators; the menu item is the same command.
    const closeTab = () => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-close-tab'));
    await closeTab();
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('copy.docx');
    await prompt.locator('.close-cancel').click();
    await expect(prompt).toBeHidden();
    await expect(page.locator('.document-tab')).toHaveCount(1);
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');
    // Save from the prompt writes the edited package, then closes.
    await closeTab();
    await prompt.locator('.close-save').click();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    expect(await docxText(copy)).not.toContain('COPY-one');
    expect(await docxText(copy)).toContain(`${MARKER}\n`);
    expect(await readFile(file)).toEqual(original);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('keeps unsaved edits while other tabs are shown, restores the reading position, and never overwrites a file changed elsewhere', async () => {
  test.setTimeout(120_000);
  const { root, file, config } = await report('setdown-docx-session-');
  for (const name of ['budget.xlsx', 'deck.pptx', 'report.doc', 'budget.xls']) await copyFile(path.join(fixtures, name), path.join(root, name));
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    await ready(page);
    const tab = (name: string) => page.locator(`.document-tab[title="${path.join(root, name)}"]`);
    const open = async (name: string) => {
      await page.evaluate((target) => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${target}`), path.join(root, name));
      await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('region', { name: 'Office document reader', exact: true })).toHaveAttribute('data-office-ready', 'true', { timeout: 30_000 });
    };
    await edit(page);
    await caretAfter(page, MARKER);
    await page.keyboard.type(' KEPT-one');
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'true');
    // More media tabs than the surface cache keeps: the Word surface is unmounted, its session is not.
    for (const name of ['budget.xlsx', 'deck.pptx', 'report.doc', 'budget.xls']) await open(name);
    await expect(page.locator('.word-surface')).toHaveCount(0);
    await expect(dirtyTabs(page)).toHaveCount(1);
    await tab('report.docx').click();
    await ready(page);
    await expect(word(page)).toHaveAttribute('data-docx-mode', 'edit');
    await expect(word(page).getByText(`${MARKER} KEPT-one`)).toBeVisible();
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'true');
    // Undo still reaches the edit made before the surface was unmounted.
    await caretAfter(page, `${MARKER} KEPT-one`);
    await page.keyboard.press('Control+z');
    await expect(word(page).getByText(`${MARKER} KEPT-one`)).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(word(page).getByText(`${MARKER} KEPT-one`)).toBeVisible();

    // Another application replaces the file under the unsaved edits.
    const external = docxBytes(['Replaced by another application.', 'External marker: wombat-night-shift.']);
    await writeFile(file, external);
    const notice = page.locator('.notice').filter({ hasText: 'changed by another application' });
    await expect(notice).toBeVisible();
    const alerts: string[] = [];
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.accept(); });
    await page.keyboard.press('Control+s');
    await expect(word(page).getByRole('alert')).toContainText('changed on disk');
    expect(alerts.join('\n')).toContain('changed on disk');
    expect(await readFile(file)).toEqual(external);
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'true');
    // Reload takes the other application's version, and only after the writer agrees to drop the edits.
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    const confirm = page.getByRole('alertdialog').filter({ hasText: 'Replace unsaved edits' });
    await confirm.getByRole('button', { name: 'Keep Editing', exact: true }).click();
    await expect(word(page).getByText(`${MARKER} KEPT-one`)).toBeVisible();
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    await confirm.getByRole('button', { name: 'Reload from Disk', exact: true }).click();
    await expect(word(page).getByText('External marker: wombat-night-shift.')).toBeVisible();
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);
    await expect(notice).toBeHidden();
    // An unedited document simply follows the file.
    await copyFile(path.join(fixtures, 'report.docx'), file);
    await expect(word(page).getByText(MARKER)).toBeVisible();
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'false');

    await ready(page);
    await focusApplication(app);
    const box = (await scroller(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1800);
    await expect.poll(() => scrolled(page)).toBeGreaterThan(1000);
    const before = await scrolled(page);
    await expect.poll(() => page.evaluate(async () => {
      const position = (await (window as unknown as { marktex: MarkTexApi }).marktex.reloadDocument())?.readingPosition;
      return position?.kind === 'office' && position.top > 0;
    })).toBe(true);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await ready(page);
    await expect.poll(async () => Math.abs(await scrolled(page) - before)).toBeLessThan(before * .15);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a link in a Word document opens a Setdown browser tab, at once while reading and on request while editing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-docx-links-')), file = path.join(root, 'links.docx');
  const paragraphs = ['A paragraph before the link.', { text: 'external-document-link', link: 'https://setdown-link-test.invalid/document' }, 'A paragraph after the link.'];
  await writeDocxFixture(file, paragraphs);
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    await ready(page);
    const shell = page.url();
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const address = page.getByRole('textbox', { name: 'Address or file path' });
    await word(page).getByText('external-document-link').click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(address).toHaveValue('https://setdown-link-test.invalid/document');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    expect(await windows()).toBe(1);
    expect(page.url()).toBe(shell);

    await page.locator(`.document-tab[title="${file}"]`).click();
    await ready(page);
    await edit(page);
    // While editing, a click places the caret; the link is offered instead of followed.
    await word(page).getByText('external-document-link').click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'office');
    const offer = word(page).getByRole('dialog', { name: 'Link', exact: true });
    await expect(offer).toContainText('https://setdown-link-test.invalid/document');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await offer.getByRole('button', { name: 'Open link', exact: true }).click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(address).toHaveValue('https://setdown-link-test.invalid/document');
    expect(await windows()).toBe(1);
    expect(page.url()).toBe(shell);
    expect(await readFile(file)).toEqual(docxBytes(paragraphs));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('unsaved Word edits are recovered into a separate document after the process is lost', async () => {
  test.setTimeout(90_000);
  const { root, file, config } = await report('setdown-docx-recovery-');
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await caretAfter(page, MARKER);
    await page.keyboard.type(' RECOVERED-one');
    await expect(word(page)).toHaveAttribute('data-docx-dirty', 'true');
    const snapshots = () => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.filter(entry => entry.recovery).length));
    await expect.poll(snapshots, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('.notice').filter({ hasText: 'Recovery backup failed' })).toHaveCount(0);
    // Simulate process loss without a clean close or discard prompt.
    const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve())); app.process().kill('SIGKILL'); await exited;
    expect(await readFile(file)).toEqual(original);

    app = await launch(undefined, config); page = await app.firstWindow();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review Recovery', exact: true })).toBeVisible();
    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-editor-commands'));
    const commands = page.getByRole('dialog', { name: 'Commands', exact: true });
    await commands.getByRole('searchbox').fill('Restore a workspace or recovery snapshot');
    await commands.getByRole('option').filter({ hasText: 'Restore a workspace or recovery snapshot' }).first().click();
    await page.getByRole('dialog', { name: 'Workspace snapshots', exact: true }).getByRole('option').filter({ hasText: 'Unsaved workspace recovery' }).first().click();
    await page.getByRole('dialog', { name: 'Restore snapshot into additional groups?' }).getByRole('option', { name: /^Restore/ }).click();
    const details = page.getByRole('dialog', { name: 'Snapshot restore details' });
    await expect(details).toContainText('recovered as a separate file');
    await details.getByRole('searchbox').press('Escape');
    await ready(page);
    await expect(word(page).getByText(`${MARKER} RECOVERED-one`)).toBeVisible();
    await expect(page.locator('.document-tab[title*="Recovered-document.docx"]')).toHaveCount(1);
    expect(await readFile(file)).toEqual(original);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('toolbar commands write Word formatting, and the File menu saves it', async () => {
  const { root, file, config } = await report('setdown-docx-toolbar-');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = word(page);
    await ready(page);
    // Save and Save As are offered for a Word document, unlike the read-only Office formats.
    const entries = await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getApplicationMenu('application-menu-file'));
    expect(entries.filter(entry => ['save', 'menu-save-as'].includes(entry.id)).map(entry => entry.enabled)).toEqual([true, true]);
    await edit(page);
    const pressed = (name: string) => reader.getByRole('button', { name, exact: true });

    await caretAfter(page, 'Paragraph 1:');
    await expect(reader.getByLabel('Paragraph style')).not.toHaveValue('Heading2');
    await reader.getByLabel('Paragraph style').selectOption('Heading2');
    await expect(reader.getByLabel('Paragraph style')).toHaveValue('Heading2');

    await caretAfter(page, 'Paragraph 2:');
    await pressed('Center').click();
    await expect(pressed('Center')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed('Align left')).toHaveAttribute('aria-pressed', 'false');

    await caretAfter(page, 'Paragraph 3:');
    await pressed('Bulleted list').click();
    await expect(pressed('Bulleted list')).toHaveAttribute('aria-pressed', 'true');

    // A run property applies to the selected word and the toolbar reports it back.
    const fourth = (await reader.getByText('Paragraph 4:').first().boundingBox())!;
    await page.mouse.dblclick(fourth.x + 20, fourth.y + fourth.height / 2);
    await reader.getByLabel('Font size').selectOption('14');
    await expect(reader.getByLabel('Font size')).toHaveValue('14');
    await pressed('Underline (Ctrl+U)').click();
    await expect(pressed('Underline (Ctrl+U)')).toHaveAttribute('aria-pressed', 'true');

    await caretAfter(page, 'Paragraph 5:');
    await reader.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(reader).toHaveAttribute('data-docx-dirty', 'true');

    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('save'));
    await expect(reader).toHaveAttribute('data-docx-dirty', 'false');
    const paragraphs = await docxParagraphs(file);
    const paragraph = (start: string) => paragraphs.find(item => item.text.startsWith(start))!.xml;
    expect(paragraph('Paragraph 1:')).toMatch(/<w:pStyle w:val="Heading2"\/>/);
    expect(paragraph('Paragraph 2:')).toMatch(/<w:jc w:val="center"\/>/);
    expect(paragraph('Paragraph 3:')).toMatch(/<w:numPr>/);
    expect(paragraph('Paragraph 4:')).toMatch(/<w:sz w:val="28"\/>/);
    expect(paragraph('Paragraph 4:')).toMatch(/<w:u w:val="single"\/>/);
    expect(paragraph('Paragraph 6:')).not.toMatch(/<w:jc |<w:numPr>|<w:sz w:val="28"/);
    expect(await docxXml(file)).toMatch(/<w:tbl>[\s\S]*<w:tr[ >][\s\S]*<w:tc>/);
    // The untouched heading and marker survive the round trip.
    expect(await docxText(file)).toContain(`Setdown Office fixture\n${MARKER}\n`);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a file that is only named .docx stays with the read-only viewer and is never offered for editing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-docx-misnamed-')), file = path.join(root, 'renamed.docx');
  // A spreadsheet under a Word name: the Word engine would show it as an empty page that could be saved over the data.
  await copyFile(path.join(fixtures, 'budget.xlsx'), file);
  const garbage = path.join(root, 'damaged.docx'), bytes = Buffer.from('PK\u0003\u0004 this was never a Word document');
  await writeFile(garbage, bytes);
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    const viewer = page.getByRole('region', { name: 'Office document reader', exact: true });
    await expect(viewer).toHaveAttribute('data-office-family', 'word');
    await expect(word(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit document', exact: true })).toHaveCount(0);
    const entries = await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getApplicationMenu('application-menu-file'));
    expect(entries.filter(entry => ['save', 'menu-save-as'].includes(entry.id)).map(entry => entry.enabled)).toEqual([false, false]);
    await page.keyboard.press('Control+s');
    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-save-as'));
    await page.evaluate((target) => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${target}`), garbage);
    await expect(page.locator(`.document-tab[title="${garbage}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(word(page)).toHaveCount(0);
    await expect(viewer).toBeVisible();
    await expect(dirtyTabs(page)).toHaveCount(0);
    expect(await readFile(file)).toEqual(await readFile(path.join(fixtures, 'budget.xlsx')));
    expect(await readFile(garbage)).toEqual(bytes);

    // Once the file really is a Word document, the same tab becomes editable without being reopened.
    await copyFile(path.join(fixtures, 'report.docx'), garbage);
    await ready(page);
    await expect(word(page).getByText(MARKER)).toBeVisible();
    await expect(word(page).getByRole('button', { name: 'Edit document', exact: true })).toBeEnabled();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
