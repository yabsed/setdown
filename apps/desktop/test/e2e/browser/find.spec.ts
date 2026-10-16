import { expect, test } from '@playwright/test';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('browser details: page find discards cleared searches and Escape respects editable controls', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `document.body.insertAdjacentHTML('beforeend','<p>needle needle</p>');document.querySelector('#draft').focus();true`);
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!; wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }, f.origin);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'document.activeElement.id')).toBe('draft');
    await f.page.evaluate(() => window.dispatchEvent(new Event('setdown:browser-find')));
    const finder = f.page.getByRole('textbox', { name: 'Find in web page' });
    await expect(finder).toBeFocused(); await finder.fill('needle');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/2');
    await finder.fill(''); await expect(f.page.locator('.location-bar .find-count')).toHaveText('0/0');
    await finder.dispatchEvent('keydown', { key: 'Escape', isComposing: true }); await expect(finder).toBeVisible();
    await finder.press('Escape'); await expect(finder).toHaveCount(0);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

