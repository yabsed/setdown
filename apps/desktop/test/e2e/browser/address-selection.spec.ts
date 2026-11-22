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

// Hangul is composed in the field, so its suggestions have to keep up before the text is committed.
const hangul = (f: Fixture) => f.page.evaluate(async origin => {
  for (const [item, title] of [['muhan', '무한도전'], ['refill', '무한 리필'], ['charger', '무선 충전'], ['jensen', '젠슨 황']]) await window.marktex.browser.bookmark(`${origin}/first?item=${item}`, title, true);
}, f.origin);
const titles = (options: Locator) => options.locator('strong').allTextContents().then(found => found.sort());
// Every text the field shows from now on, in order. A selection that is taken back shows up as a later entry.
const watchValue = (input: Locator) => input.evaluate((node: HTMLInputElement) => {
  const seen = [node.value]; (window as any).__shown = seen;
  setInterval(() => { if (node.value !== seen.at(-1)) seen.push(node.value); }, 4);
});
const shownSince = (input: Locator, value: string) => input.evaluate((_node, value) => { const seen = (window as any).__shown as string[]; return seen.slice(seen.indexOf(value)); }, value);
/** The last syllable of a word and the arrow key that ends it, as ibus-hangul delivers them (recorded
 * on X11 with the real input method, 2026-11-22): while the syllable is composed the field holds it;
 * the arrow key takes the composing text out, puts the same text back as plain text, and the key itself
 * follows within a millisecond. CDP input cannot keep that pace (each command waits for the renderer),
 * so the events are dispatched in one task: nothing they set off has been answered when the key arrives. */
const composeSyllable = (input: Locator, syllable: string) => input.evaluate((node: HTMLInputElement, syllable) => {
  node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  node.value += syllable; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
}, syllable);
const commitWithArrowDown = (input: Locator, syllable: string) => input.evaluate((node: HTMLInputElement, syllable) => {
  const text = node.value;
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'ArrowDown', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
  node.value = text.slice(0, -syllable.length); node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
  node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
  node.value = text; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
}, syllable);

test('suggestions follow Hangul while it is composed, and the arrow key that commits it selects a row for good', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await seed(f); await hangul(f);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await address.click();
    const popup = await overlay(f), options = popup.getByRole('option');
    await expect(options.first()).toBeVisible();
    await address.evaluate(input => {
      const log = (window as any).__hangul = { ends: 0, blur: 0 };
      input.addEventListener('compositionend', () => { log.ends++; }); input.addEventListener('blur', () => { log.blur++; });
    });
    // Chromium's own composition path first: the rows change under a composition that stays open.
    const cdp = await f.app.context().newCDPSession(f.page);
    const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    // A lone consonant begins every syllable that starts with it: 젠 and 전.
    await compose('ㅈ'); await expect.poll(() => titles(options)).toEqual(['무선 충전', '무한도전', '젠슨 황']);
    await compose('젠'); await expect.poll(() => titles(options)).toEqual(['젠슨 황']);
    // 뭏 is 무한 half typed: its final consonant is the next syllable's first.
    await compose('뭏'); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    expect(await f.page.evaluate(() => (window as any).__hangul)).toEqual({ ends: 0, blur: 0 });
    await expect(address).toBeFocused(); await expect(address).toHaveValue('뭏');
    await compose(''); await cdp.send('Input.insertText', { text: '무' }); await cdp.detach();
    await expect.poll(() => titles(options)).toEqual(['무선 충전', '무한 리필', '무한도전']);
    await composeSyllable(address, '한');
    await expect(address).toHaveValue('무한'); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    const first = (await options.locator('small').allTextContents())[0];
    await watchValue(address);
    await commitWithArrowDown(address, '한');
    await expect(address).toHaveValue(first); await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    // The rows were already those of 무한: nothing arrives later to take the selection back.
    await f.page.waitForTimeout(400);
    expect(await shownSince(address, first)).toEqual([first]);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true'); expect(await titles(options)).toEqual(['무한 리필', '무한도전']);
    await address.press('ArrowUp'); await expect(address).toHaveValue('무한');
    // The same key pressed before the rows of the syllable arrive walks those rows, not the ones on screen.
    const refill = `${f.origin}/first?item=refill`;
    await address.fill('무'); await expect.poll(() => titles(options)).toEqual(['무선 충전', '무한 리필', '무한도전']);
    await composeSyllable(address, '한'); await commitWithArrowDown(address, '한');
    const chosen = popup.locator('[role="option"][aria-selected="true"] strong');
    await expect(chosen).toHaveText(/^무한/); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    await f.page.waitForTimeout(400);
    await expect(chosen).toHaveText(/^무한/); await expect(address).toHaveValue(/item=(muhan|refill)$/);
    // Latin typing has the same race when the key follows the last letter at once.
    await address.fill('무한 리'); await address.press('ArrowDown');
    await expect(address).toHaveValue(refill); await expect(options.locator('small')).toHaveText([refill]);
    await f.page.waitForTimeout(400);
    await expect(address).toHaveValue(refill); await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await address.press('Enter');
    await expect.poll(() => f.app.windows().some(page => page.url() === refill)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('the compact address panel follows Hangul the same way', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 800));
    await f.page.evaluate(() => { const style = document.createElement('style'); style.textContent = '.editor-group{max-width:300px}'; document.head.append(style); });
    await seed(f); await hangul(f);
    const search = f.page.getByRole('button', { name: 'Open address and search' });
    await expect(search).toBeVisible(); await search.scrollIntoViewIfNeeded();
    const box = (await search.boundingBox())!;
    await nativeInput({ click: await f.app.evaluate(({ BrowserWindow }, box) => {
      const owner = BrowserWindow.getAllWindows()[0], frame = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
      return { x: frame.x + (box.x + box.width / 2) * zoom, y: frame.y + (box.y + box.height / 2) * zoom };
    }, box) });
    const panel = await overlay(f), input = panel.getByRole('textbox', { name: 'Search or enter an address' }), options = panel.getByRole('option');
    await expect(input).toBeFocused();
    await input.evaluate(node => {
      const log = (window as any).__hangul = { ends: 0, blur: 0 };
      node.addEventListener('compositionend', () => { log.ends++; }); node.addEventListener('blur', () => { log.blur++; });
    });
    await input.fill('');
    const cdp = await f.app.context().newCDPSession(panel);
    const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await compose('젠'); await expect.poll(() => titles(options)).toEqual(['젠슨 황']);
    await compose('뭏'); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    expect(await panel.evaluate(() => (window as any).__hangul)).toEqual({ ends: 0, blur: 0 });
    await expect(input).toBeFocused();
    await compose(''); await cdp.send('Input.insertText', { text: '무' }); await cdp.detach();
    await expect.poll(() => titles(options)).toEqual(['무선 충전', '무한 리필', '무한도전']);
    await composeSyllable(input, '한');
    await expect(input).toHaveValue('무한'); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    const first = (await options.locator('small').allTextContents())[0];
    await watchValue(input);
    // The panel's rows come from the shell: its edits are still on their way there when the key arrives.
    await commitWithArrowDown(input, '한');
    await expect(input).toHaveValue(first); await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await panel.waitForTimeout(400);
    expect(await shownSince(input, first)).toEqual([first]);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp'); await expect(input).toHaveValue('무한');
    // Pressed before the rows of the syllable arrive, the key walks those rows.
    await input.fill('무'); await expect.poll(() => titles(options)).toEqual(['무선 충전', '무한 리필', '무한도전']);
    await composeSyllable(input, '한'); await commitWithArrowDown(input, '한');
    const chosen = panel.locator('[role="option"][aria-selected="true"] strong');
    await expect(chosen).toHaveText(/^무한/); await expect.poll(() => titles(options)).toEqual(['무한 리필', '무한도전']);
    await panel.waitForTimeout(400);
    await expect(chosen).toHaveText(/^무한/); await expect(input).toHaveValue(/item=(muhan|refill)$/);
    const picked = await input.inputValue();
    await input.press('Enter');
    await expect.poll(() => f.app.windows().some(page => page.url() === picked)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
