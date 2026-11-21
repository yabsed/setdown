import { expect, test, type Locator } from '@playwright/test';
import { fixture } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const seed = (f: Fixture) => f.page.evaluate(async origin => {
  for (const name of ['alpha', 'beta', 'gamma']) await window.marktex.browser.bookmark(`${origin}/first?item=${name}`, `Destination ${name}`, true);
}, f.origin);
// Rows of an earlier query can still be on screen; wait for the ones this query answers.
const destinations = async (options: Locator) => {
  await expect(options.locator('strong')).toHaveText([/^Destination /, /^Destination /, /^Destination /]);
  return options.locator('small').allTextContents();
};
const overlay = async (f: Fixture) => {
  await expect.poll(() => f.app.windows().some(page => page.url().includes('location-overlay=1'))).toBe(true);
  return f.app.windows().find(page => page.url().includes('location-overlay=1'))!;
};

test('arrow keys show the selected suggestion in the address field and return to the typed text', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await seed(f);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    await address.click(); await address.fill('Destination');
    const popup = await overlay(f), options = popup.getByRole('option');
    const urls = await destinations(options);
    expect([...urls].sort()).toEqual(['alpha', 'beta', 'gamma'].map(name => `${f.origin}/first?item=${name}`));
    const chosen = popup.locator('[role="option"][aria-selected="true"]');
    await address.press('ArrowDown');
    await expect(address).toHaveValue(urls[0]); await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    // The field stays an ordinary input: the caret follows the shown address.
    expect(await address.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([urls[0].length, urls[0].length]);
    await address.press('ArrowDown');
    await expect(address).toHaveValue(urls[1]); await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    // The chosen row is outlined in the text colour; a background tint alone is lost in dark themes.
    await expect(options.nth(1)).toHaveCSS('outline-style', 'solid');
    expect(await options.nth(1).evaluate(row => getComputedStyle(row).outlineColor === getComputedStyle(row).color)).toBe(true);
    await expect(options.nth(0)).toHaveCSS('outline-style', 'none');
    await address.press('ArrowUp'); await expect(address).toHaveValue(urls[0]);
    // Past either end of the list the typed text comes back, and the list is still its list.
    await address.press('ArrowUp');
    await expect(address).toHaveValue('Destination'); await expect(chosen).toHaveCount(0); await expect(options).toHaveCount(3);
    await address.press('ArrowUp');
    await expect(address).toHaveValue(urls[2]); await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
    await address.press('ArrowDown');
    await expect(address).toHaveValue('Destination'); await expect(chosen).toHaveCount(0);
    await expect(address).toBeFocused();
    await popup.screenshot({ path: test.info().outputPath('typed-text.png') });
    // Editing the shown address is typing again: Enter opens the edited text, not the row it came from.
    await address.press('ArrowDown'); await expect(address).toHaveValue(urls[0]);
    await f.page.locator('.location-bar').screenshot({ path: test.info().outputPath('selected-address.png') });
    await address.pressSequentially('&edited=1'); await address.press('Enter');
    await expect(address).toHaveValue(`${urls[0]}&edited=1`);
    await expect.poll(() => f.app.windows().some(page => page.url() === `${urls[0]}&edited=1`)).toBe(true);
    // Enter on a selected row opens that row.
    // (A hidden popup keeps its last rows, so this query has a list of its own to wait for.)
    const gamma = `${f.origin}/first?item=gamma`;
    await address.click(); await address.fill('Destination gamma');
    await expect(options.locator('small')).toHaveText([gamma]);
    await address.press('ArrowDown'); await expect(address).toHaveValue(gamma);
    await address.press('Enter');
    await expect(address).toHaveValue(gamma);
    await expect.poll(() => f.app.windows().some(page => page.url() === gamma)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('the compact address panel shows the selected suggestion in its own field', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 800));
    await f.page.evaluate(() => { const style = document.createElement('style'); style.textContent = '.editor-group{max-width:300px}'; document.head.append(style); });
    await seed(f);
    const search = f.page.getByRole('button', { name: 'Open address and search' });
    await expect(search).toBeVisible(); await search.scrollIntoViewIfNeeded();
    const box = (await search.boundingBox())!;
    await nativeInput({ click: await f.app.evaluate(({ BrowserWindow }, box) => {
      const owner = BrowserWindow.getAllWindows()[0], frame = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
      return { x: frame.x + (box.x + box.width / 2) * zoom, y: frame.y + (box.y + box.height / 2) * zoom };
    }, box) });
    const panel = await overlay(f), input = panel.getByRole('textbox', { name: 'Search or enter an address' }), options = panel.getByRole('option');
    await expect(input).toBeFocused();
    await input.fill('Destination');
    const urls = await destinations(options);
    await input.press('ArrowDown');
    await expect(input).toHaveValue(urls[0]); await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    // The shown address is not a new query: the rows stay those of the typed text.
    await expect(options.locator('small')).toHaveText(urls);
    await input.press('ArrowUp');
    await expect(input).toHaveValue('Destination'); await expect(panel.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
    await input.press('ArrowUp'); await expect(input).toHaveValue(urls[2]);
    await input.press('ArrowUp'); await expect(input).toHaveValue(urls[1]);
    await panel.screenshot({ path: test.info().outputPath('compact-selected-address.png') });
    await input.press('Enter');
    await expect.poll(() => f.app.windows().some(page => page.url() === urls[1])).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
