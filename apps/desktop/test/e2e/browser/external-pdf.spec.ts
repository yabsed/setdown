import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, captureNativeMenus, chooseNativeMenu } from '../../support/browser/browser-fixture';
import { pdfFixture } from '../../support/media/pdf-fixture';

test('extensionless external PDFs use Setdown search, outline, zoom, retained canvases and original-byte saving', async () => {
  const f = await fixture();
  try {
    await f.page.locator('.new-web-tab-button').click();
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    await address.fill(`${f.origin}/pdf-redirect`); await address.press('Enter');
    const pdf = f.page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(pdf).toHaveAttribute('data-pdf-pages', '12');
    await expect(address).toHaveValue(`${f.origin}/paper`);
    const id = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
    const token = await f.page.evaluate(async id => (await window.marktex.browser.create(id, 'about:blank')).pdf!.token, id);
    await expect(pdf.locator('canvas').first()).toBeVisible();
    await f.page.getByRole('button', { name: 'PDF outline', exact: true }).click();
    await f.page.getByRole('button', { name: 'Chapter Five', exact: true }).click();
    await expect(pdf).toHaveAttribute('data-pdf-page', '5');
    await f.page.getByRole('button', { name: 'PDF outline', exact: true }).click();
    await f.page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('1.5');
    await expect(f.page.getByRole('button', { name: 'Reset website zoom', exact: true })).toHaveText('150%');
    await f.page.keyboard.press('Control+f');
    const find = f.page.getByRole('searchbox', { name: 'Find in PDF' });
    await expect(find).toBeFocused(); await find.fill('searchable');
    await expect(pdf.locator('.pdf-matches')).toContainText('/ 300');
    await find.press('Escape');
    await f.page.getByRole('spinbutton', { name: 'PDF page number' }).fill('5');
    await f.page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await expect(pdf).toHaveAttribute('data-pdf-page', '5');
    await expect(pdf.locator('.page[data-page-number="5"] canvas')).toBeVisible();
    await pdf.locator('.page[data-page-number="5"] canvas').evaluate(node => (node as HTMLCanvasElement).dataset.retained = 'yes');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await f.page.locator(`.document-tab[data-tab-id="${id}"]`).click();
    await expect(pdf).toHaveAttribute('data-pdf-page', '5');
    await expect(pdf.locator('.page[data-page-number="5"] canvas')).toHaveAttribute('data-retained', 'yes');
    const text = pdf.locator('.page[data-page-number="5"] .textLayer span').first();
    await expect(text).toContainText('searchable');
    const box = (await text.boundingBox())!;
    await f.page.mouse.move(box.x + 4, box.y + box.height / 2); await f.page.mouse.down();
    await f.page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 }); await f.page.mouse.up();
    const selected = await f.page.evaluate(() => window.getSelection()!.toString());
    expect(selected).toContain('searchable');
    await f.page.keyboard.press('Control+c');
    await expect.poll(() => f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
    await captureNativeMenus(f.app);
    await f.app.evaluate(({ clipboard }) => clipboard.clear());
    await f.page.mouse.click(box.x + 24, box.y + box.height / 2, { button: 'right' });
    await expect.poll(() => f.app.evaluate(() => Boolean((globalThis as any).__browserTestMenu))).toBe(true);
    await chooseNativeMenu(f.app, ['Copy']);
    await expect.poll(() => f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
    await f.page.evaluate(() => window.getSelection()?.removeAllRanges());
    const output = path.join(f.root, 'saved.pdf');
    await f.app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
    await f.page.getByRole('button', { name: 'Save PDF', exact: true }).click();
    await expect.poll(() => readFile(output).then(bytes => bytes.equals(pdfFixture())).catch(() => false)).toBe(true);
    await f.page.screenshot({ path: test.info().outputPath('external-pdf.png') });
    await address.fill(`${f.origin}/second`); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Second page');
    await expect(pdf).toHaveCount(0);
    expect(await f.page.evaluate(async ({ id, token }) => {
      try { await window.marktex.browser.pdfRange(id, token, 0, 5); return 'accepted'; } catch { return 'rejected'; }
    }, { id, token })).toBe('rejected');
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(pdf).toHaveAttribute('data-pdf-pages', '12');
    await expect(f.page.getByRole('button', { name: 'Reset website zoom', exact: true })).toHaveText('150%');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('non-PDF pages remain websites and a failed PDF offers recovery', async () => {
  const f = await fixture(false);
  try {
    await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    await address.fill(`${f.origin}/looks-like.pdf`); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
    await expect(f.page.getByRole('region', { name: 'PDF reader' })).toHaveCount(0);
    await address.fill(`${f.origin}/broken-pdf`); await address.press('Enter');
    await expect(f.page.getByRole('heading', { name: 'Could not open this PDF' })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await f.page.getByRole('button', { name: 'Use browser PDF viewer' }).click();
    await expect(f.page.getByRole('heading', { name: 'Could not open this PDF' })).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
