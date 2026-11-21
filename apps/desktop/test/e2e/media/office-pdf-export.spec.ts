import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication } from '../../support/electron/electron-app';
import { openApplicationMenu } from '../../support/electron/application-menu';

// The same generated and corpus documents as media/office-reader.spec.ts (see the fixture README).
const fixtures = path.join(import.meta.dirname, '../../fixtures/office');
const A4 = 210 / 297, WIDE = 16 / 9;
type ExportRecord = { asked: string[]; answer: null | ((value: unknown) => void); created: number; shown: number; focused: number };
/** What one page of a saved PDF shows in the app's own PDF reader. */
type Sheet = { text: string; ratio: number; ink: number; edge: number; box: number[] };

async function session(prefix: string, first: string, prepare?: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  for (const name of await readdir(fixtures)) if (/\.(docx?|xlsx?|pptx?|hwpx?)$/.test(name)) await copyFile(path.join(fixtures, name), path.join(root, name));
  await prepare?.(root);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(root, first)], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  await focusApplication(app);
  const page = await app.firstWindow();
  // The save dialog stays open until the test answers it; every window made, shown or focused from here on is counted.
  await app.evaluate(({ app, dialog }) => {
    const record: ExportRecord = { asked: [], answer: null, created: 0, shown: 0, focused: 0 };
    (globalThis as unknown as { officeExportTest: ExportRecord }).officeExportTest = record;
    dialog.showSaveDialog = ((_window: unknown, options: { defaultPath?: string }) => new Promise(resolve => {
      record.asked.push(options.defaultPath ?? ''); record.answer = resolve;
    })) as unknown as typeof dialog.showSaveDialog;
    app.on('browser-window-created', (_event, window) => {
      record.created++;
      window.on('show', () => { record.shown++; });
      window.on('focus', () => { record.focused++; });
    });
  });
  const reader = page.getByRole('region', { name: 'Office document reader', exact: true });
  const button = page.getByRole('button', { name: 'Save as PDF', exact: true });
  const tab = (name: string) => page.locator(`.document-tab[title="${path.join(root, name)}"]`);
  const record = () => app.evaluate(() => {
    const { asked, created, shown, focused } = (globalThis as unknown as { officeExportTest: ExportRecord }).officeExportTest;
    return { asked, created, shown, focused };
  });
  const answer = (value: { canceled: boolean; filePath?: string }) => app.evaluate((_electron, value) => {
    const record = (globalThis as unknown as { officeExportTest: ExportRecord }).officeExportTest;
    record.answer!(value); record.answer = null;
  }, value);
  const open = async (name: string, family: string) => {
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), path.join(root, name));
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(reader).toHaveAttribute('data-office-family', family);
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
  };
  /** Starts an export of the selected document and waits for its save dialog, which proposes a PDF beside the document. */
  const ask = async (name: string, via: 'button' | 'menu' = 'button') => {
    const before = (await record()).asked.length;
    if (via === 'button') await button.click();
    else {
      await openApplicationMenu(page, 'File');
      await page.getByRole('menuitem', { name: 'Export as PDF…', exact: true }).click();
    }
    await expect.poll(async () => (await record()).asked.length).toBe(before + 1);
    expect((await record()).asked.at(-1)).toBe(path.join(root, `${name.replace(/\.[^.]+$/, '')}.pdf`));
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', 'Saving PDF…');
  };
  /** Saves the selected document as PDF and returns the file once the export has finished. */
  const save = async (name: string, via: 'button' | 'menu' = 'button') => {
    const target = test.info().outputPath(`${name}.pdf`);
    await ask(name, via);
    await answer({ canceled: false, filePath: target });
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await expect(button).toHaveAttribute('title', 'Save as PDF');
    expect((await readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
    // The person keeps reading the same document, undisturbed.
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
    return target;
  };
  const unchanged = async () => {
    for (const name of await readdir(fixtures)) if (/\.(docx?|xlsx?|pptx?|hwpx?)$/.test(name))
      expect(await readFile(path.join(root, name)), name).toEqual(await readFile(path.join(fixtures, name)));
  };
  const dispose = async () => { await disposeApplication(app); await rm(root, { recursive: true, force: true }); };
  return { root, app, page, reader, button, tab, record, answer, open, ask, save, unchanged, dispose };
}

/** Reads the saved bytes back through the real PDF.js reader: page count, shape, text and where each page is painted. */
async function sheets(page: Page, file: string): Promise<Sheet[]> {
  await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(pdf).toHaveAttribute('data-pdf-pages', /^[1-9]\d*$/);
  const count = Number(await pdf.getAttribute('data-pdf-pages'));
  await pdf.getByRole('combobox', { name: 'PDF zoom', exact: true }).selectOption('page-fit');
  const result: Sheet[] = [];
  for (let number = 1; number <= count; number++) {
    const input = pdf.getByRole('spinbutton', { name: 'PDF page number' });
    await input.fill(String(number)); await input.press('Enter');
    const sheet = pdf.locator(`[data-page-number="${number}"]`);
    const canvas = sheet.locator('canvas');
    await expect(canvas).toBeVisible();
    // PDF.js appends this marker after the page and its text are rendered, also on pages without text.
    await expect(sheet.locator('.textLayer .endOfContent')).toBeAttached();
    // A font may draw "fi" as one ligature glyph; compare as a PDF reader's own search does.
    const text = (await sheet.locator('.textLayer').textContent() ?? '').normalize('NFKC');
    const paint = await canvas.evaluate((canvas: HTMLCanvasElement) => {
      const { width, height } = canvas;
      const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
      // The outer 2.5% of the page on every side: narrower than any margin these documents ask for.
      const x0 = Math.ceil(width * .025), y0 = Math.ceil(height * .025);
      let ink = 0, edge = 0, left = width, top = height, right = 0, bottom = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (data[at] > 235 && data[at + 1] > 235 && data[at + 2] > 235) continue;
        ink++;
        if (x < x0 || x >= width - x0 || y < y0 || y >= height - y0) edge++;
        left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      }
      // Where the page is painted, as fractions of the page: left, top, right, bottom.
      return { ratio: width / height, ink, edge, box: [left / width, top / height, right / width, bottom / height], png: canvas.toDataURL() };
    });
    await writeFile(test.info().outputPath(`${path.basename(file)}-page-${number}.png`), Buffer.from(paint.png.split(',')[1], 'base64'));
    result.push({ text, ratio: paint.ratio, ink: paint.ink, edge: paint.edge, box: paint.box });
  }
  return result;
}
const numbers = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), match => Number(match[1]));
const upTo = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

test('saves Word documents as PDF from the address bar and the File menu, with margins on every page', async () => {
  test.setTimeout(180_000);
  const s = await session('setdown-office-pdf-word-', 'report.docx');
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    for (const [name, via] of [['report.docx', 'button'], ['report.doc', 'menu']] as const) {
      await s.open(name, 'word');
      const pages = await sheets(s.page, await s.save(name, via));
      // Several A4 sheets; every one keeps its margins clear, also where the text continues from the sheet before.
      expect(pages.length, name).toBeGreaterThanOrEqual(3);
      for (const [index, sheet] of pages.entries()) {
        expect(sheet.ratio, `${name} page ${index + 1}`).toBeCloseTo(A4, 2);
        expect(sheet.ink, `${name} page ${index + 1} has content`).toBeGreaterThan(0);
        expect(sheet.edge, `${name} page ${index + 1} margins`).toBe(0);
      }
      // The whole text, once and in order, as selectable text.
      const text = pages.map(sheet => sheet.text).join('\n');
      expect(pages[0].text).toContain('Unique marker: quokka-reading-room.');
      expect(pages.at(-1)!.text).toContain('Final marker: last-paragraph-of-the-fixture.');
      expect(numbers(text, /Paragraph (\d+):/g)).toEqual(upTo(120));
    }
    await s.unchanged();
  } finally { await s.dispose(); }
});

test('saves workbooks as PDF, every row once on upright A4', async () => {
  test.setTimeout(180_000);
  const s = await session('setdown-office-pdf-sheet-', 'budget.xlsx');
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    for (const name of ['budget.xlsx', 'budget.xls']) {
      await s.open(name, 'spreadsheet');
      const pages = await sheets(s.page, await s.save(name));
      // 61 rows at the sheet's own row height take two sheets.
      expect(pages.length, name).toBe(2);
      for (const [index, sheet] of pages.entries()) {
        expect(sheet.ratio, `${name} page ${index + 1}`).toBeCloseTo(A4, 2);
        expect(sheet.ink, `${name} page ${index + 1} has content`).toBeGreaterThan(0);
        expect(sheet.edge, `${name} page ${index + 1} margins`).toBe(0);
      }
      for (const heading of ['Item', 'Quarter', 'Amount']) expect(pages[0].text).toContain(heading);
      expect(numbers(pages.map(sheet => sheet.text).join('\n'), /Fixture row (\d+)/g)).toEqual(upTo(60));
      expect(pages[1].text).toContain('7500');
    }
    await s.unchanged();
  } finally { await s.dispose(); }
});

test('saves slide decks as PDF, one slide to a page of the slide\'s shape', async () => {
  test.setTimeout(180_000);
  const s = await session('setdown-office-pdf-deck-', 'deck.pptx');
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    await s.open('deck.pptx', 'presentation');
    const modern = await sheets(s.page, await s.save('deck.pptx'));
    expect(modern.length).toBe(3);
    for (const [index, marker] of ['First slide marker: wombat-opening-slide', 'Second slide marker: wombat-second-slide', 'Third slide marker: wombat-third-slide'].entries()) {
      expect(modern[index].ratio, `slide ${index + 1}`).toBeCloseTo(WIDE, 1);
      expect(modern[index].text).toContain(marker);
      // Nothing of a neighbouring slide shares the page.
      expect(numbers(modern[index].text, /(\w+) slide marker:/g)).toHaveLength(1);
    }
    // A legacy deck is saved as the pictures the viewer draws of its slides.
    await s.open('deck.ppt', 'presentation');
    const legacy = await sheets(s.page, await s.save('deck.ppt'));
    expect(legacy.length).toBe(3);
    for (const [index, sheet] of legacy.entries()) {
      expect(sheet.ratio, `legacy slide ${index + 1}`).toBeCloseTo(WIDE, 1);
      expect(sheet.ink, `legacy slide ${index + 1} is drawn`).toBeGreaterThan(0);
    }
    await s.unchanged();
  } finally { await s.dispose(); }
});

test('saves Hangul documents as PDF on A4 with their text, margins and placed pictures', async () => {
  test.setTimeout(180_000);
  const s = await session('setdown-office-pdf-hangul-', 'table.hwp');
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    /** What the reader shows of the document's first sheet: its text, and where its pictures lie on it. */
    const shown = () => s.reader.evaluate(surface => {
      const root = surface.querySelector('.office-host')!.shadowRoot!;
      const sheet = root.querySelector('.hangul-page')!.getBoundingClientRect();
      const pictures = Array.from(root.querySelectorAll('.hangul-page img'), image => image.getBoundingClientRect());
      return { text: Array.from(root.querySelectorAll('.hangul-page'), page => page.textContent ?? '').join(''),
        pictures: pictures.length, box: [(Math.min(...pictures.map(box => box.left)) - sheet.left) / sheet.width, (Math.min(...pictures.map(box => box.top)) - sheet.top) / sheet.height,
          (Math.max(...pictures.map(box => box.right)) - sheet.left) / sheet.width, (Math.max(...pictures.map(box => box.bottom)) - sheet.top) / sheet.height] };
    });
    const dense = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');
    for (const [name, marker] of [['table.hwp', 'LMN'], ['sample.hwpx', '우리는']] as const) {
      await s.open(name, 'hangul');
      const reading = await shown();
      const pages = await sheets(s.page, await s.save(name));
      expect(pages.length, name).toBe(1);
      expect(pages[0].ratio, name).toBeCloseTo(A4, 2);
      expect(pages[0].edge, `${name} margins`).toBe(0);
      expect(pages[0].text).toContain(marker);
      expect(dense(pages[0].text), `${name} text`).toBe(dense(reading.text));
    }

    // Text that runs over several sheets keeps the page margins on each of them, and loses nothing at the breaks.
    await s.open('columns.hwpx', 'hangul');
    const reading = await shown();
    const pages = await sheets(s.page, await s.save('columns.hwpx'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const [index, sheet] of pages.entries()) {
      expect(sheet.ratio, `page ${index + 1}`).toBeCloseTo(A4, 2);
      expect(sheet.ink, `page ${index + 1} has content`).toBeGreaterThan(0);
      expect(sheet.edge, `page ${index + 1} margins`).toBe(0);
    }
    expect(dense(pages.map(sheet => sheet.text).join(''))).toBe(dense(reading.text));

    // Pictures placed on the sheet stay where the reader shows them.
    await s.open('pictures.hwp', 'hangul');
    const placed = await shown();
    expect(placed.pictures).toBeGreaterThan(0);
    const [picture] = await sheets(s.page, await s.save('pictures.hwp'));
    expect(picture.ratio).toBeCloseTo(A4, 2);
    // The pictures have clear borders of their own, so what is painted lies just inside the boxes the reader gives them.
    const [left, top, right, bottom] = placed.box, where = `painted ${picture.box} inside ${placed.box}`;
    expect(picture.box[0], where).toBeGreaterThan(left - .01); expect(picture.box[1], where).toBeGreaterThan(top - .01);
    expect(picture.box[2], where).toBeLessThan(right + .01); expect(picture.box[3], where).toBeLessThan(bottom + .01);
    expect(picture.box[2] - picture.box[0], where).toBeGreaterThan((right - left) * .7);
    expect(picture.box[3] - picture.box[1], where).toBeGreaterThan((bottom - top) * .7);
    await s.unchanged();
  } finally { await s.dispose(); }
});

test('prepares the PDF in a hidden, offline window, one export per document at a time', async () => {
  test.setTimeout(120_000);
  let hits = 0;
  const server = createServer((_request, response) => { hits++; response.end('reached'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/font.woff2`;
  const s = await session('setdown-office-pdf-window-', 'report.docx');
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    const focused = () => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.isFocused()));
    const target = test.info().outputPath('report.docx.pdf');
    await s.ask('report.docx');
    // While one export of this document is under way, asking again starts no second one.
    await s.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-export-pdf'));
    await s.page.keyboard.press('Control+f');
    await expect(s.reader.getByPlaceholder('Search document')).toBeFocused();
    expect((await s.record()).asked).toHaveLength(1);
    await s.answer({ canceled: false, filePath: target });
    await expect(s.button).toBeEnabled({ timeout: 60_000 });
    expect((await readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
    // One window did the work without ever being shown or focused, and it is gone again.
    expect(await s.record()).toMatchObject({ created: 1, shown: 0, focused: 0 });
    expect(await focused()).toEqual([true]);
    await expect(s.reader.getByPlaceholder('Search document')).toBeFocused();

    // Nothing in the export's own session reaches the network; a session without that rule shows the request would arrive.
    const fetched = (partition: string) => s.app.evaluate(async ({ session }, { partition, url }) => {
      try { return `status ${(await session.fromPartition(partition).fetch(url)).status}`; } catch (error) { return String(error); }
    }, { partition, url });
    expect(await fetched('office-export')).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(hits).toBe(0);
    expect(await fetched('office-export-control')).toBe('status 200');
    expect(hits).toBe(1);
    await s.unchanged();
  } finally { await s.dispose(); await new Promise(resolve => server.close(resolve)); }
});

test('a cancelled or failed export writes nothing and says why', async () => {
  test.setTimeout(120_000);
  // The first half of a real document: a Word archive without its directory.
  const s = await session('setdown-office-pdf-failure-', 'report.docx',
    async root => writeFile(path.join(root, 'damaged.docx'), (await readFile(path.join(fixtures, 'report.docx'))).subarray(0, 3000)));
  try {
    await expect(s.reader).toHaveAttribute('data-office-ready', 'true');
    const target = test.info().outputPath('never.pdf');
    await s.ask('report.docx');
    await s.answer({ canceled: true });
    await expect(s.button).toBeEnabled();
    expect((await s.record()).created).toBe(0);

    // A document the viewer cannot read is reported, not saved as an empty or partial PDF.
    await s.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), path.join(s.root, 'damaged.docx'));
    await expect(s.tab('damaged.docx')).toHaveAttribute('aria-selected', 'true');
    await expect(s.reader.getByText('Could not display this document', { exact: false })).toBeVisible();
    await s.ask('damaged.docx');
    const alert = s.page.waitForEvent('dialog');
    await s.answer({ canceled: false, filePath: target });
    const dialog = await alert;
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toMatch(/^Could not export the PDF\.\n\S/);
    expect(dialog.message()).not.toContain('remote method');
    await dialog.accept();
    await expect(s.button).toBeEnabled();
    expect(await stat(target).catch(() => null)).toBeNull();
    expect(await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await s.unchanged();
  } finally { await s.dispose(); }
});
