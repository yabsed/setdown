import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';
import { docxParts } from '../../support/media/docx-fixture';
import { OUTLINE_SAMPLE, deckWithMetafile, emfBytes } from '../../support/media/metafile-fixture';
import { pptxParts, pptxWith, readPptxSlides, xmlContent } from '../../support/media/pptx-fixture';
import { shippedFontsOnly } from '../../support/media/shipped-fonts';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';

// deck.pptx and links.pptx are the LibreOffice-generated fixtures the Office reader uses; other decks are derived from them.
const fixtures = path.join(import.meta.dirname, '../../fixtures/office');
const MARKERS = ['First slide marker: wombat-opening-slide', 'Second slide marker: wombat-second-slide', 'Third slide marker: wombat-third-slide'];
/** A picture file with a size of its own: an opaque PNG of one colour. */
function png(width: number, height: number, [red, green, blue]: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: width }, () => Buffer.from([red, green, blue]))]);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PICTURE = png(120, 80, [40, 120, 200]);
const launch = async (file: string | undefined, config: string, extra: Record<string, string> = {}) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: file ? ['.', file] : ['.'], env: { ...env, ...extra, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};
const deck = (page: Page) => page.getByRole('region', { name: 'Presentation', exact: true });
const ready = (page: Page) => expect(deck(page)).toHaveAttribute('data-office-ready', 'true', { timeout: 30_000 });
/** The slides as the list shows them: the whole surface while reading, the rail while editing. */
const slides = (page: Page) => deck(page).locator('.deck-slide');
const stage = (page: Page) => deck(page).locator('.deck-stage');
const input = (page: Page) => deck(page).locator('textarea.pptx-surface__input');
// The engine draws a line as several text elements (one for each word of Hangul), so text is read joined.
const drawn = (page: Page, area: 'stage' | number = 'stage') =>
  (area === 'stage' ? stage(page) : slides(page).nth(area)).locator('text').allTextContents().then(parts => parts.join(''));
const menu = (page: Page, item: string) => page.evaluate(id => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem(id), item);
async function copyOf(prefix: string, fixture = 'deck.pptx', name = fixture) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)), file = path.join(root, name);
  await copyFile(path.join(fixtures, fixture), file);
  return { root, file, config: path.join(root, 'config') };
}
async function edit(page: Page) {
  await deck(page).getByRole('button', { name: 'Edit presentation', exact: true }).click();
  await expect(deck(page)).toHaveAttribute('data-pptx-mode', 'edit');
  await expect(stage(page).locator('text').first()).toBeVisible();
}
/** Where the stage draws the end of `text`: the box of the element that holds its last characters. */
const endOf = (page: Page, text: string) => stage(page).evaluate((element, wanted) => {
  let joined = '';
  for (const piece of element.querySelectorAll('text')) {
    joined += piece.textContent ?? '';
    if (joined.endsWith(wanted)) { const box = piece.getBoundingClientRect(); return { right: box.right, middle: box.top + box.height / 2 }; }
  }
  return null;
}, text);
/** Places the caret after the last character of the line that ends with `text`. */
async function caretAfter(page: Page, text: string) {
  await expect.poll(() => endOf(page, text)).not.toBeNull();
  const at = (await endOf(page, text))!;
  await page.mouse.click(at.right - 3, at.middle);
  await expect(input(page)).toBeFocused();
  await page.keyboard.press('End');
}
const dirtyTabs = (page: Page) => page.locator('.document-tab .tab-dirty');
const stubSaveDialog = (app: TestApplication, result: { canceled: boolean; filePath: string }) =>
  app.evaluate(({ dialog }, value) => { dialog.showSaveDialog = async () => value; }, result);
/** Every part of the saved deck except `edited` says what it said in `original`; nothing was added or dropped but `added`. */
async function expectOtherPartsKept(file: string, original: Buffer, edited: string[], added: RegExp = /^$/) {
  const before = docxParts(original), after = await pptxParts(file);
  expect([...after.keys()].filter(name => !added.test(name)).sort()).toEqual([...before.keys()].sort());
  for (const [name, content] of before) {
    if (edited.includes(name)) continue;
    const saved = after.get(name)!;
    if (/\.(xml|rels)$/.test(name)) expect(xmlContent(saved.toString('utf8')), name).toBe(xmlContent(content.toString('utf8')));
    else expect(saved.equals(content), name).toBe(true);
  }
}

test('opens a presentation for reading: every slide in one list, tab zoom and find', async () => {
  const { root, file, config } = await copyOf('setdown-pptx-read-');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = deck(page);
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'office');
    await ready(page);
    await expect(reader).toHaveAttribute('data-office-family', 'presentation');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    await expect(reader).toHaveAttribute('data-pptx-slides', '3');
    await expect(slides(page)).toHaveCount(3);
    for (const [index, marker] of MARKERS.entries()) await expect.poll(() => drawn(page, index)).toContain(marker);
    // The deck is drawn by the presentation engine, not by a Markdown preview, the text editor or the read-only viewer.
    expect(await previews(app).count()).toBe(0);
    await expect(page.locator('.mode-toggle')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Office document reader', exact: true })).toHaveCount(0);
    // The tab shows Setdown's own drawing for presentations: the Seti icon font has none.
    const icon = page.locator('.document-tab .file-type-icon').first();
    await expect(icon).toHaveAttribute('data-file-icon', '_powerpoint');
    const glyph = (await icon.locator('svg').boundingBox())!;
    expect(glyph.width).toBeGreaterThan(8);
    expect(glyph.height).toBeGreaterThan(8);

    // Reading never edits: input on a slide changes nothing and nothing becomes unsaved.
    const before = await readFile(file);
    const first = (await slides(page).first().boundingBox())!;
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 3);
    await page.keyboard.type('must-not-appear');
    await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
    expect(await drawn(page, 0)).not.toContain('must-not-appear');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);

    const reset = page.getByRole('button', { name: 'Reset document zoom', exact: true });
    const width = () => slides(page).first().evaluate(node => node.getBoundingClientRect().width);
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

    await page.keyboard.press('Control+f');
    const search = reader.getByPlaceholder('Search presentation');
    await expect(search).toBeFocused();
    await search.fill('wombat');
    const count = reader.getByRole('search').getByRole('status');
    await expect(count).toHaveText('1/3');
    await expect(slides(page).nth(0)).toHaveClass(/\bfound\b/);
    await search.press('Enter');
    await expect(count).toHaveText('2/3');
    await expect(slides(page).nth(1)).toHaveClass(/\bfound\b/);
    await expect(slides(page).nth(0)).not.toHaveClass(/\bfound\b/);
    await search.press('Shift+Enter');
    await expect(count).toHaveText('1/3');
    await search.fill('no-such-text');
    await expect(count).toHaveText('0/0');
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).not.toBeFocused();
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');

    // Saving an unchanged deck writes nothing; Save As is offered and can be declined.
    await page.keyboard.press('Control+s');
    await stubSaveDialog(app, { canceled: true, filePath: '' });
    await menu(page, 'menu-save-as');
    await expect(reader).toHaveAttribute('data-pptx-saving', 'false');
    expect(await readFile(file)).toEqual(before);
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('edits a slide, saves the deck in place and reopens the saved text', async () => {
  const { root, file, config } = await copyOf('setdown-pptx-edit-');
  let app = await launch(file, config), page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const reader = deck(page);
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    await expect(reader).toHaveAttribute('data-pptx-slide', '1');

    await caretAfter(page, MARKERS[0]);
    await page.keyboard.insertText(' EDITED-one');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} EDITED-one`);
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    await expect(dirtyTabs(page)).toHaveCount(1);
    // The list beside the stage is the same deck: it shows the edit as it is made.
    await expect.poll(() => drawn(page, 0)).toContain(`${MARKERS[0]} EDITED-one`);
    // The engine's own history answers the keyboard.
    await page.keyboard.press('Control+z');
    await expect.poll(() => drawn(page)).not.toContain('EDITED-one');
    await expect.poll(() => drawn(page)).toContain(MARKERS[0]);
    await page.keyboard.press('Control+y');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} EDITED-one`);
    // The Edit menu reaches the same history, not Chromium's.
    await menu(page, 'menu-undo');
    await expect.poll(() => drawn(page)).not.toContain('EDITED-one');
    await menu(page, 'menu-redo');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} EDITED-one`);
    // Nothing reaches the file before Save.
    expect(await readFile(file)).toEqual(original);

    await page.keyboard.press('Control+s');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);
    let saved = await readPptxSlides(file);
    expect(saved.map(slide => slide.paragraphs.filter(Boolean).at(-1))).toEqual([`${MARKERS[0]} EDITED-one`, MARKERS[1], MARKERS[2]]);
    // The engine writes every XML part again; each part it did not edit still says what it said.
    await expectOtherPartsKept(file, original, [saved[0].part]);
    // A save is not an external change, and it keeps the caret where the writer was.
    await expect(page.locator('.notice').first()).toBeHidden();
    await expect(reader).toHaveAttribute('data-pptx-mode', 'edit');
    await page.keyboard.type('!');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} EDITED-one!`);
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    await reader.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    saved = await readPptxSlides(file);
    expect(saved[0].paragraphs).toContain(`${MARKERS[0]} EDITED-one!`);

    await reader.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    await expect(reader.getByRole('button', { name: 'Edit presentation', exact: true })).toBeVisible();
    await expect.poll(() => drawn(page, 0)).toContain(`${MARKERS[0]} EDITED-one!`);
    expect(errors).toEqual([]);

    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await ready(page);
    await expect(deck(page)).toHaveAttribute('data-pptx-mode', 'view');
    await expect.poll(() => drawn(page, 0)).toContain(`${MARKERS[0]} EDITED-one!`);
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'false');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Korean composition types into a slide, one Esc returns to reading only outside a composition, and a double click on text resumes editing there', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-ime-')), file = path.join(root, '발표.pptx');
  const first = '한글슬라이드첫줄';
  await writeFile(file, pptxWith(await readFile(path.join(fixtures, 'deck.pptx')), (name, xml) => name === 'ppt/slides/slide1.xml' ? xml.replace(MARKERS[0], first) : undefined));
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    const reader = deck(page);
    await ready(page);
    await expect.poll(() => drawn(page, 0)).toContain(first);
    await edit(page);
    // The slide takes the keyboard as soon as editing starts: Esc needs no click first.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.deck-stage'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    await edit(page);

    await caretAfter(page, first);
    const cdp = await page.context().newCDPSession(page);
    const preedit = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    // CDP drives Chromium's composition path: each syllable is held open before it is committed.
    for (const sequence of [['ㅎ', '하', '한'], ['ㄱ', '그', '글']]) {
      for (const step of sequence) await preedit(step);
      await cdp.send('Input.insertText', { text: sequence[2] });
    }
    await expect.poll(() => drawn(page)).toContain(`${first}한글`);
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    // Esc that ends a composition belongs to the input method.
    await preedit('ㅇ');
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'edit');
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.waitForTimeout(30); // compositionend settlement
    // One press from inside a text box: the engine's own steps (text, shape, nothing) are not asked of the reader.
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    // Unsaved edits stay in the tab while reading, and Save works from either mode.
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    await page.keyboard.press('Control+s');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    expect((await readPptxSlides(file))[0].paragraphs).toContain(`${first}한글`);

    // A double click on the text of another slide: editing starts on that slide with the caret in that text.
    const target = slides(page).nth(1).getByText(MARKERS[1]).first();
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width - 6, box.y + box.height / 2);
    await expect(reader).toHaveAttribute('data-pptx-mode', 'edit');
    await expect(reader).toHaveAttribute('data-pptx-slide', '2');
    await expect(input(page)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[1]}Z`);
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-pptx-mode', 'view');
    // Reading shows the slide that was being edited, and the list has the keyboard for scrolling.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.deck-slides'))).toBe(true);
    await expect(slides(page).nth(1)).toBeInViewport();
    await cdp.detach();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Save As writes a new presentation and moves the tab to it; closing an edited presentation asks first', async () => {
  const { root, file, config } = await copyOf('setdown-pptx-save-as-');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = deck(page), copy = path.join(root, 'copy.pptx');
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await caretAfter(page, MARKERS[0]);
    await page.keyboard.insertText(' COPY-one');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    // A name without an extension becomes a presentation.
    await stubSaveDialog(app, { canceled: false, filePath: path.join(root, 'copy') });
    await menu(page, 'menu-save-as');
    await expect(page.locator(`.document-tab[title="${copy}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    expect(await readFile(file)).toEqual(original);
    expect((await readPptxSlides(copy))[0].paragraphs).toContain(`${MARKERS[0]} COPY-one`);
    // The same editing session continues in the renamed tab.
    await ready(page);
    await expect(reader).toHaveAttribute('data-pptx-mode', 'edit');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} COPY-one`);
    await caretAfter(page, `${MARKERS[0]} COPY-one`);
    await page.keyboard.press('Control+z');
    await expect.poll(() => drawn(page)).not.toContain('COPY-one');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');

    const prompt = page.locator('dialog[aria-labelledby="close-prompt-title"]');
    // Synthetic key events never reach native menu accelerators; the menu item is the same command.
    const closeTab = () => menu(page, 'menu-close-tab');
    await closeTab();
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('copy.pptx');
    await prompt.locator('.close-cancel').click();
    await expect(prompt).toBeHidden();
    await expect(page.locator('.document-tab')).toHaveCount(1);
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    // Save from the prompt writes the edited package, then closes.
    await closeTab();
    await prompt.locator('.close-save').click();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    const paragraphs = (await readPptxSlides(copy))[0].paragraphs;
    expect(paragraphs).toContain(MARKERS[0]);
    expect(paragraphs.join('\n')).not.toContain('COPY-one');
    expect(await readFile(file)).toEqual(original);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('keeps unsaved slide edits while other tabs are shown, restores the reading position, and never overwrites a file changed elsewhere', async () => {
  test.setTimeout(120_000);
  const { root, file, config } = await copyOf('setdown-pptx-session-');
  const others = ['budget.xlsx', 'deck.ppt', 'report.doc', 'budget.xls'];
  for (const name of others) await copyFile(path.join(fixtures, name), path.join(root, name));
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
    await caretAfter(page, MARKERS[0]);
    await page.keyboard.insertText(' KEPT-one');
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'true');
    // More media tabs than the surface cache keeps: the presentation surface is unmounted, its session is not.
    for (const name of others) await open(name);
    await expect(page.locator('.deck-surface')).toHaveCount(0);
    await expect(dirtyTabs(page)).toHaveCount(1);
    await tab('deck.pptx').click();
    await ready(page);
    await expect(deck(page)).toHaveAttribute('data-pptx-mode', 'edit');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} KEPT-one`);
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'true');
    // Undo still reaches the edit made before the surface was unmounted.
    await caretAfter(page, `${MARKERS[0]} KEPT-one`);
    await page.keyboard.press('Control+z');
    await expect.poll(() => drawn(page)).not.toContain('KEPT-one');
    await page.keyboard.press('Control+y');
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} KEPT-one`);

    // Another application replaces the file under the unsaved edits.
    const external = pptxWith(await readFile(path.join(fixtures, 'deck.pptx')), (name, xml) => name === 'ppt/slides/slide1.xml' ? xml.replace(MARKERS[0], 'External marker: quokka-night-shift') : undefined);
    await writeFile(file, external);
    const notice = page.locator('.notice').filter({ hasText: 'changed by another application' });
    await expect(notice).toBeVisible();
    const alerts: string[] = [];
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.accept(); });
    await page.keyboard.press('Control+s');
    await expect(deck(page).getByRole('alert')).toContainText('changed on disk');
    expect(alerts.join('\n')).toContain('changed on disk');
    expect(await readFile(file)).toEqual(external);
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'true');
    // Reload takes the other application's version, and only after the writer agrees to drop the edits.
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    const confirm = page.getByRole('alertdialog').filter({ hasText: 'Replace unsaved edits' });
    await confirm.getByRole('button', { name: 'Keep Editing', exact: true }).click();
    await expect.poll(() => drawn(page)).toContain(`${MARKERS[0]} KEPT-one`);
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    await confirm.getByRole('button', { name: 'Reload from Disk', exact: true }).click();
    await expect.poll(() => drawn(page, 0)).toContain('External marker: quokka-night-shift');
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'false');
    await expect(dirtyTabs(page)).toHaveCount(0);
    await expect(notice).toBeHidden();
    // An unedited deck simply follows the file.
    await copyFile(path.join(fixtures, 'deck.pptx'), file);
    await expect.poll(() => drawn(page, 0)).toContain(MARKERS[0]);
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'false');

    // The place in the list is kept across a restart.
    if (await deck(page).getAttribute('data-pptx-mode') === 'edit') await deck(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(deck(page)).toHaveAttribute('data-pptx-mode', 'view');
    await ready(page);
    await focusApplication(app);
    const list = deck(page).locator('.deck-slides'), scrolled = () => deck(page).locator('.deck-slides').evaluate(element => element.scrollTop);
    const box = (await list.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 900);
    await expect.poll(scrolled).toBeGreaterThan(600);
    const before = await scrolled();
    await expect.poll(() => page.evaluate(async () => {
      const position = (await (window as unknown as { marktex: MarkTexApi }).marktex.reloadDocument())?.readingPosition;
      return position?.kind === 'office' && position.top > 0;
    })).toBe(true);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await ready(page);
    await expect.poll(async () => Math.abs(await scrolled() - before)).toBeLessThan(before * .15);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a link on a slide opens a Setdown browser tab while reading, and is only text while editing', async () => {
  const { root, file, config } = await copyOf('setdown-pptx-links-', 'links.pptx');
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    await ready(page);
    const original = await readFile(file);
    const shell = page.url();
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const address = page.getByRole('textbox', { name: 'Address or file path' });
    // A click beside the link follows nothing.
    const slide = (await slides(page).first().boundingBox())!;
    await page.mouse.click(slide.x + slide.width - 20, slide.y + slide.height - 20);
    await expect(page.locator('.document-tab')).toHaveCount(1);
    await slides(page).first().getByText('external-slide-link').first().click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(address).toHaveValue('https://setdown-link-test.invalid/slide');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    expect(await windows()).toBe(1);
    expect(page.url()).toBe(shell);

    await page.locator(`.document-tab[title="${file}"]`).click();
    await ready(page);
    await edit(page);
    // While editing, a click places the caret. (The engine's own layer takes the pointer above the drawing.)
    const link = (await stage(page).getByText('external-slide-link').first().boundingBox())!;
    await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
    await expect(input(page)).toBeFocused();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'office');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    expect(await windows()).toBe(1);
    expect(await readFile(file)).toEqual(original);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('unsaved slide edits are recovered into a separate presentation after the process is lost', async () => {
  test.setTimeout(90_000);
  const { root, file, config } = await copyOf('setdown-pptx-recovery-');
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    await ready(page);
    const original = await readFile(file);
    await edit(page);
    await caretAfter(page, MARKERS[0]);
    await page.keyboard.insertText(' RECOVERED-one');
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'true');
    const snapshots = () => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.filter(entry => entry.recovery).length));
    await expect.poll(snapshots, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('.notice').filter({ hasText: 'Recovery backup failed' })).toHaveCount(0);
    // Simulate process loss without a clean close or discard prompt.
    const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve())); app.process().kill('SIGKILL'); await exited;
    expect(await readFile(file)).toEqual(original);

    app = await launch(undefined, config); page = await app.firstWindow();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review Recovery', exact: true })).toBeVisible();
    await menu(page, 'menu-editor-commands');
    const commands = page.getByRole('dialog', { name: 'Commands', exact: true });
    await commands.getByRole('searchbox').fill('Restore a workspace or recovery snapshot');
    await commands.getByRole('option').filter({ hasText: 'Restore a workspace or recovery snapshot' }).first().click();
    await page.getByRole('dialog', { name: 'Workspace snapshots', exact: true }).getByRole('option').filter({ hasText: 'Unsaved workspace recovery' }).first().click();
    await page.getByRole('dialog', { name: 'Restore snapshot into additional groups?' }).getByRole('option', { name: /^Restore/ }).click();
    const details = page.getByRole('dialog', { name: 'Snapshot restore details' });
    await expect(details).toContainText('recovered as a separate file');
    await details.getByRole('searchbox').press('Escape');
    await ready(page);
    await expect.poll(() => drawn(page, 0)).toContain(`${MARKERS[0]} RECOVERED-one`);
    await expect(page.locator('.document-tab[title*="Recovered-document.pptx"]')).toHaveCount(1);
    expect(await readFile(file)).toEqual(original);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('the toolbar formats text and adds a text box, a shape, a table, a picture and slides, and the File menu saves them', async () => {
  const { root, file, config } = await copyOf('setdown-pptx-toolbar-');
  const picture = path.join(root, 'dot.png');
  await writeFile(picture, PICTURE);
  const app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = deck(page);
    await ready(page);
    const original = await readFile(file);
    // Save and Save As are offered for a presentation, unlike the read-only Office formats.
    const entries = await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getApplicationMenu('application-menu-file'));
    expect(entries.filter(entry => ['save', 'menu-save-as'].includes(entry.id)).map(entry => entry.enabled)).toEqual([true, true]);
    await edit(page);
    const pressed = (name: string) => reader.getByRole('button', { name, exact: true });
    // Nothing is selected yet: text commands wait for a caret.
    await expect(pressed('Center')).toBeDisabled();

    await caretAfter(page, MARKERS[0]);
    await pressed('Center').click();
    await expect(pressed('Center')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed('Align left')).toHaveAttribute('aria-pressed', 'false');
    // A run property applies to the selected text and the toolbar reports it back.
    await page.keyboard.press('Control+a');
    const bold = reader.getByRole('button', { name: /^Bold/ });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await reader.getByLabel('Font size').selectOption('32');
    await expect(reader.getByLabel('Font size')).toHaveValue('32');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');

    // What is added is selected: a new text box holds the caret, so typing goes into it.
    await reader.getByRole('button', { name: 'Text box', exact: true }).click();
    await expect(input(page)).toBeFocused();
    await page.keyboard.type('Fresh box: quokka');
    await expect.poll(() => drawn(page)).toContain('Fresh box: quokka');
    await reader.getByLabel('Insert shape').selectOption('ellipse');
    await expect(reader.getByLabel('Insert shape')).toHaveValue('');
    await reader.getByLabel('Insert shape').selectOption('arrow');
    await reader.getByRole('button', { name: 'Table', exact: true }).click();
    await reader.getByLabel('Picture file').setInputFiles(picture);
    await expect(stage(page).locator('image')).toHaveCount(1);
    await expect(reader.getByRole('alert')).toHaveCount(0);

    // Slides: a new one follows the current one and becomes current, a copy follows its original, Delete removes the current one.
    await reader.getByRole('button', { name: 'New slide', exact: true }).click();
    await expect(reader).toHaveAttribute('data-pptx-slides', '4');
    await expect(reader).toHaveAttribute('data-pptx-slide', '2');
    await slides(page).nth(3).click();
    await expect(reader).toHaveAttribute('data-pptx-slide', '4');
    await reader.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(reader).toHaveAttribute('data-pptx-slides', '5');
    await expect.poll(() => drawn(page, 4)).toContain(MARKERS[2]);
    await slides(page).nth(2).click();
    await expect(reader).toHaveAttribute('data-pptx-slide', '3');
    await reader.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(reader).toHaveAttribute('data-pptx-slides', '4');

    await menu(page, 'save');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    const saved = await readPptxSlides(file);
    expect(saved).toHaveLength(4);
    const first = saved[0].xml;
    expect(first).toMatch(/<a:pPr\b[^>]*\balgn="ctr"/);
    expect(first).toMatch(/<a:rPr\b[^>]*\bb="1"/);
    expect(first).toMatch(/<a:rPr\b[^>]*\bsz="3200"/);
    expect(saved[0].paragraphs).toEqual(expect.arrayContaining(['Setdown deck fixture', MARKERS[0], 'Fresh box: quokka']));
    expect(first).toMatch(/<a:prstGeom\b[^>]*\bprst="ellipse"/);
    expect(first).toMatch(/<p:cxnSp>/);
    expect(first).toMatch(/<a:tbl>[\s\S]*<a:tr\b[\s\S]*<a:tc\b/);
    expect(first).toMatch(/<p:pic>/);
    const parts = await pptxParts(file);
    const media = [...parts.keys()].filter(name => name.startsWith('ppt/media/'));
    expect(media).toHaveLength(1);
    expect(parts.get(media[0])!.equals(PICTURE)).toBe(true);
    // The second slide was deleted; the new empty slide and the two third slides remain.
    expect(saved.map(slide => slide.paragraphs.filter(Boolean).at(-1) ?? '')).toEqual([expect.any(String), '', MARKERS[2], MARKERS[2]]);
    expect(docxParts(original).size).toBeLessThan(parts.size);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a machine with no Korean font draws Korean slide text with the packaged face', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-fonts-')), file = path.join(root, 'korean.pptx');
  // The text names a family that Windows and Hangul Office bring and this machine does not have.
  await writeFile(file, pptxWith(await readFile(path.join(fixtures, 'deck.pptx')), (name, xml) => name === 'ppt/slides/slide1.xml'
    ? xml.replace(MARKERS[0], '맑은고딕글꼴').replace(/<a:latin typeface="[^"]*"/g, '<a:latin typeface="맑은 고딕"').replace(/<a:ea typeface="[^"]*"/g, '<a:ea typeface="맑은 고딕"') : undefined));
  // Only the packaged Latin substitutes are installed: no installed font has a Hangul glyph.
  const app = await launch(file, path.join(root, 'config'), await shippedFontsOnly(root, ['@docx-editor.dev/fonts'])), page = await app.firstWindow();
  const warnings: string[] = [];
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text()); });
  try {
    await ready(page);
    await expect.poll(() => drawn(page, 0)).toContain('맑은고딕글꼴');
    const glyphs = await slides(page).first().evaluate(async element => {
      await document.fonts.ready;
      const text = [...element.querySelectorAll('text')].find(node => node.textContent?.includes('맑은'))!;
      const family = getComputedStyle(text).fontFamily.split(',')[0].trim();
      /** One character as a font paints it on its own. */
      const picture = (font: string, character: string) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: 48, height: 48 }), context = canvas.getContext('2d')!;
        context.font = font;
        context.fillText(character, 6, 36);
        return context.getImageData(0, 0, 48, 48).data.join('');
      };
      const own = ['맑', '은', '고'].map(character => picture(`32px ${family}`, character));
      const installed = ['맑', '은', '고'].map(character => picture('32px sans-serif', character));
      return { family, own: new Set(own).size, installed: new Set(installed).size, shared: own.filter(image => installed.includes(image)).length, box: text.getBoundingClientRect().width };
    });
    expect(glyphs.family).toMatch(/^"?pptx-/);
    // No installed font has Hangul: every syllable is the same stand-in box there.
    expect(glyphs.installed).toBe(1);
    // The face the engine drew the slide with has a glyph of its own for each syllable.
    expect(glyphs.own).toBe(3);
    expect(glyphs.shared).toBe(0);
    expect(glyphs.box).toBeGreaterThan(20);
    await page.screenshot({ path: test.info().outputPath('korean-slide.png') });
    // The file keeps the family it was written with.
    await edit(page);
    await caretAfter(page, '맑은고딕글꼴');
    await page.keyboard.insertText('추가');
    await page.keyboard.press('Control+s');
    await expect(deck(page)).toHaveAttribute('data-pptx-dirty', 'false');
    const saved = (await readPptxSlides(file))[0];
    expect(saved.paragraphs).toContain('맑은고딕글꼴추가');
    expect(saved.xml).toContain('typeface="맑은 고딕"');
    expect(warnings.filter(text => /font/i.test(text))).toEqual([]);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('an EMF picture on a slide is drawn as its outline: lines and curves of one figure, filled once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-metafile-')), file = path.join(root, 'outline.pptx');
  const { size, calls, colour, painted, clear } = OUTLINE_SAMPLE;
  await writeFile(file, deckWithMetafile(await readFile(path.join(fixtures, 'deck.pptx')), emfBytes(size.width, size.height, calls), size));
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    await ready(page);
    const picture = slides(page).first().locator('image').first();
    await expect(picture).toBeVisible();
    const box = (await picture.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(size.width / size.height, 1);
    // The picture as the slide shows it, read back at one pixel per metafile unit.
    const pixels = await picture.evaluate(async (node, sample) => {
      const image = new Image();
      image.src = node.getAttribute('href') ?? node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
      await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), sample.size);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, sample.size.width, sample.size.height);
      const read = ([x, y]: readonly [number, number]) => Array.from(context.getImageData(x, y, 1, 1).data);
      return { painted: sample.painted.map(read), clear: sample.clear.map(read) };
    }, { size, painted, clear });
    const fill = [colour >> 16 & 0xff, colour >> 8 & 0xff, colour & 0xff, 255];
    expect(pixels.painted).toEqual(painted.map(() => fill));
    expect(pixels.clear).toEqual(clear.map(() => [0, 0, 0, 0]));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a presentation with unsaved edits is exported as a PDF only after it is saved', async () => {
  const f = await copyOf('setdown-pptx-pdf-');
  const app = await launch(f.file, f.config), page = await app.firstWindow();
  try {
    const reader = deck(page);
    await ready(page);
    await edit(page);
    await caretAfter(page, MARKERS[0]);
    await page.keyboard.insertText(' UNSAVED');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'true');
    await app.evaluate(({ dialog }) => {
      const counter = globalThis as unknown as { pdfSaveDialogs: number };
      counter.pdfSaveDialogs = 0;
      dialog.showSaveDialog = async () => { counter.pdfSaveDialogs++; return { canceled: true, filePath: '' }; };
    });
    const dialogs = () => app.evaluate(() => (globalThis as unknown as { pdfSaveDialogs: number }).pdfSaveDialogs);
    const alerts: string[] = [];
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.accept(); });
    // The PDF is made from the file on disk: exporting now would leave the edit out without saying so.
    await menu(page, 'menu-export-pdf');
    await expect.poll(() => alerts.length).toBe(1);
    expect(alerts[0]).toMatch(/^Save the document before exporting it as a PDF\./);
    expect(await dialogs()).toBe(0);
    await page.keyboard.press('Control+s');
    await expect(reader).toHaveAttribute('data-pptx-dirty', 'false');
    await menu(page, 'menu-export-pdf');
    await expect.poll(dialogs, { timeout: 30_000 }).toBe(1);
    expect(alerts).toHaveLength(1);
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});

test('a file that is only named .pptx stays with the read-only viewer and is never offered for editing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-misnamed-')), file = path.join(root, 'renamed.pptx');
  // A spreadsheet under a presentation name: the engine would show it as an empty deck that could be saved over the data.
  await copyFile(path.join(fixtures, 'budget.xlsx'), file);
  const garbage = path.join(root, 'damaged.pptx'), bytes = Buffer.from('PK\u0003\u0004 this was never a presentation');
  await writeFile(garbage, bytes);
  const app = await launch(file, path.join(root, 'config')), page = await app.firstWindow();
  try {
    const viewer = page.getByRole('region', { name: 'Office document reader', exact: true });
    await expect(viewer).toHaveAttribute('data-office-family', 'presentation');
    await expect(deck(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit presentation', exact: true })).toHaveCount(0);
    const entries = await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getApplicationMenu('application-menu-file'));
    expect(entries.filter(entry => ['save', 'menu-save-as'].includes(entry.id)).map(entry => entry.enabled)).toEqual([false, false]);
    await page.keyboard.press('Control+s');
    await menu(page, 'menu-save-as');
    await page.evaluate((target) => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${target}`), garbage);
    await expect(page.locator(`.document-tab[title="${garbage}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(deck(page)).toHaveCount(0);
    await expect(viewer).toBeVisible();
    await expect(dirtyTabs(page)).toHaveCount(0);
    expect(await readFile(file)).toEqual(await readFile(path.join(fixtures, 'budget.xlsx')));
    expect(await readFile(garbage)).toEqual(bytes);

    // Once the file really is a presentation, the same tab becomes editable without being reopened.
    await copyFile(path.join(fixtures, 'deck.pptx'), garbage);
    await ready(page);
    await expect.poll(() => drawn(page, 0)).toContain(MARKERS[0]);
    await expect(deck(page).getByRole('button', { name: 'Edit presentation', exact: true })).toBeEnabled();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
