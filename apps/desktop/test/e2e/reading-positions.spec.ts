import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';
import { pdfFixture } from './pdf-fixture';
import { previews } from './preview-view';

const launch = async (file: string, config: string) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};
async function snapshotOnFailure(page: Page) {
  await page.screenshot({ path: test.info().outputPath('reading.png') }).catch(() => {});
  await test.info().attach('dom', { body: await page.locator('body').innerText().catch(() => ''), contentType: 'text/plain' });
}

test('PDF reader restores page coordinates and zoom across restart, and supports search and outline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-'));
  const file = path.join(root, 'reading.pdf');
  const config = path.join(root, 'config');
  await writeFile(file, pdfFixture());
  let app = await launch(file, config);
  let page = await app.firstWindow();
  try {
    const pdf = () => page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(pdf()).toHaveAttribute('data-pdf-pages', '12');
    await expect(pdf().locator('canvas').first()).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'pdf');
    expect(await previews(app).count()).toBe(0);
    await page.getByRole('button', { name: 'PDF outline', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter Five', exact: true }).click();
    await expect(pdf()).toHaveAttribute('data-pdf-page', '5');
    await page.getByRole('button', { name: 'PDF outline', exact: true }).click();
    await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('1.5');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('7');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await expect(pdf()).toHaveAttribute('data-pdf-page', '7');
    const scroll = () => page.getByRole('document', { name: 'PDF pages' });
    await scroll().evaluate((node) => { node.scrollTop += 220; });
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'pdf', page: 7, zoom: 1.5 });
    const position = await page.evaluate(async () => (await window.marktex.reloadDocument())!.readingPosition);
    await page.getByRole('button', { name: 'Rotate PDF' }).click();
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ rotation: 90 });
    // Return to original rotation to make coordinate comparison straightforward.
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Rotate PDF' }).click();
    await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('7');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await scroll().evaluate((node) => { node.scrollTop += 170; });
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ page: 7, rotation: 0 });
    expect(position?.kind).toBe('pdf');
    const history = await app.evaluate(({ app }) => app.getPath('userData') + '/reading-positions.json');
    await app.close(); // User-like quit, including renderer's final history flush.
    const saved = JSON.parse(await readFile(history, 'utf8')).records.find((record: { path: string }) => record.path === file).position;
    app = await launch(file, config); page = await app.firstWindow();
    await expect(pdf()).toHaveAttribute('data-pdf-page', '7');
    await expect(page.getByRole('combobox', { name: 'PDF zoom' })).toHaveValue('1.5');
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject(saved!);
    await page.getByRole('searchbox', { name: 'Find in PDF' }).fill('searchable');
    await expect(page.locator('.pdf-matches')).toContainText('/ 300');
    await page.keyboard.press('Control+S');
    expect(await readFile(file)).toEqual(pdfFixture());
    await snapshotOnFailure(page);
  } catch (error) { await snapshotOnFailure(page); throw error; }
  finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('text cursor and scroll survive closing the tab and restarting Setdown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-text-position-'));
  const file = path.join(root, 'reading.txt');
  const config = path.join(root, 'config');
  await writeFile(file, Array.from({ length: 400 }, (_, index) => `Line ${index + 1}: reading position`).join('\n'));
  let app = await launch(file, config);
  let page = await app.firstWindow();
  try {
    const editor = () => page.getByRole('textbox', { name: 'Editor content' });
    await expect(editor()).toBeVisible();
    await editor().press('Control+End');
    for (let i = 0; i < 30; i++) await editor().press('ArrowUp');
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'text', surface: 'editor', anchor: { sourceLine: 370 } });
    await page.getByTitle('Close tab', { exact: true }).click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'empty');
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), file);
    // Reopen through the existing document-open notification path.
    await expect(editor()).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText(/Line\s+370:/);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await expect(editor()).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText(/Line\s+370:/);
  } catch (error) { await snapshotOnFailure(page); throw error; }
  finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a PDF beyond the initial byte range keeps its position across Markdown tab switches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-tabs-'));
  const file = path.join(root, 'large.pdf');
  const markdown = path.join(root, 'notes.md');
  const bytes = pdfFixture(100);
  expect(bytes.length).toBeGreaterThan(65536);
  await writeFile(file, bytes); await writeFile(markdown, '# Notes\n\nMarkdown remains readable.');
  const app = await launch(file, path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(pdf).toHaveAttribute('data-pdf-pages', '100');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('98');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await expect(pdf.locator('[data-page-number="98"] canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'pdf', page: 98 });
    const originalCanvas = await pdf.locator('[data-page-number="98"] canvas').elementHandle();
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
    await expect.poll(previews(app).hasVisible).toBe(true);
    await expect.poll(() => previews(app).evaluate('document.body.innerText')).toContain('Markdown remains readable.');
    await expect(pdf).toBeHidden();
    await page.getByRole('tab').filter({ hasText: 'large.pdf' }).click();
    await expect(pdf).toHaveAttribute('data-pdf-page', '98');
    await expect(pdf.locator('[data-page-number="98"] canvas')).toBeVisible();
    await expect.poll(previews(app).hasVisible).toBe(false);
    expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected
      && canvas === document.querySelector('.pdf-host')?.shadowRoot?.querySelector('[data-page-number="98"] canvas'))).toBe(true);
    await page.getByRole('tab').filter({ hasText: 'large.pdf' }).getByTitle('Close tab', { exact: true }).click();
    await expect.poll(previews(app).hasVisible).toBe(true);
    expect(await readFile(file)).toEqual(bytes);
  } catch (error) { await snapshotOnFailure(page); throw error; }
  finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Markdown restores its source anchor after restarting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-markdown-position-'));
  const file = path.join(root, 'reading.md');
  const config = path.join(root, 'config');
  await writeFile(file, Array.from({ length: 90 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.\n`).join('\n'));
  let app = await launch(file, config);
  let page = await app.firstWindow();
  try {
    let reader = previews(app);
    await expect.poll(reader.hasVisible).toBe(true);
    await expect.poll(() => reader.evaluate('document.documentElement.scrollHeight')).toBeGreaterThan(5000);
    await reader.evaluate('window.scrollTo(0, 5000)');
    await expect.poll(() => page.evaluate(async () => {
      const position = (await window.marktex.reloadDocument())?.readingPosition;
      return position?.kind === 'text' ? position.anchor.sourceLine : 0;
    })).toBeGreaterThan(100);
    const saved = await page.evaluate(async () => (await window.marktex.reloadDocument())!.readingPosition);
    expect(saved?.kind === 'text' && saved.anchor.sourceLine).toBeGreaterThan(100);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow(); reader = previews(app);
    await expect.poll(reader.hasVisible).toBe(true);
    await expect.poll(() => reader.evaluate('window.scrollY')).toBeGreaterThan(2000);
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'text', surface: 'viewer', anchor: { sourceLine: saved?.kind === 'text' ? saved.anchor.sourceLine : 0 } });
  } catch (error) { await snapshotOnFailure(page); throw error; }
  finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
