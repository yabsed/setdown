import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu } from '../../support/browser/browser-fixture';

test('browser details: notification requests stay quiet, coalesce and expire with their document', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `window.permissionResults=[]; Notification.requestPermission().then(r=>permissionResults.push(r)); Notification.requestPermission().then(r=>permissionResults.push(r)); true`);
    const review = f.page.getByRole('button', { name: 'Review permissions: Notifications', exact: true });
    await expect(review).toBeVisible();
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'permissionResults.length')).toBe(0);
    await review.click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Deny']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'permissionResults')).toEqual(['denied', 'denied']);
    await expect(review).toHaveCount(0);
    await evaluatePage(f.app, f.origin, `Notification.requestPermission().then(r=>permissionResults.push(r)); true`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'permissionResults.length')).toBe(3);
    await expect(review).toHaveCount(0);
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, `Notification.requestPermission().then(r=>window.permissionResult=r);true`);
    await expect(review).toBeVisible(); await review.click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Allow for This Page']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.permissionResult')).toBe('granted');
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, `Notification.requestPermission();true`); await expect(review).toBeVisible();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(`${f.origin}/second`); await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible(); await expect(review).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: HTTP authentication is an owned opt-in prompt and error reload preserves its URL', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/private`);
    const signIn = f.page.getByRole('button', { name: 'Sign in to website', exact: true });
    await expect(signIn).toBeVisible(); await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await signIn.click();
    const prompt = f.page.getByRole('dialog', { name: 'Sign in to website', exact: true });
    await expect(prompt).toBeVisible(); await expect(prompt).toContainText(f.origin);
    await prompt.getByLabel('Username').fill('reader'); await prompt.getByLabel('Password', { exact: true }).fill('secret');
    await prompt.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(prompt).not.toBeVisible(); await expect(f.page.getByRole('tab', { name: /Private library/ })).toBeVisible();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(`${f.origin}/network-failure`); await address.press('Enter');
    await expect(f.page.locator('.browser-empty')).toBeVisible(); await expect(address).toHaveValue(`${f.origin}/network-failure`);
    const before = f.requests.filter(url => url === '/network-failure').length;
    await f.page.locator('.browser-empty').getByRole('button', { name: 'Reload page' }).click();
    await expect.poll(() => f.requests.filter(url => url === '/network-failure').length).toBeGreaterThan(before);
    await expect(address).toHaveValue(`${f.origin}/network-failure`);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: site reset preserves other sites and PDF completion leaves the active tab alone', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    const id = await web.getAttribute('data-tab-id');
    await evaluatePage(f.app, f.origin, `localStorage.setItem('draft','site data');document.cookie='fixture=local';true`);
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Retained bookmark', true), `${f.origin}/first`);
    await f.app.evaluate(async ({ session, dialog }, origin) => {
      await session.fromPartition('persist:setdown-browser').cookies.set({ url: 'https://unrelated.example/', name: 'fixture', value: 'keep' });
      dialog.showMessageBox = (async (_window, options) => {
        if (!options?.detail?.includes(origin)) throw Error('Site reset must identify the exact origin');
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, f.origin);
    await f.page.getByRole('button', { name: 'Site controls', exact: true }).click(); await chooseNativeMenu(f.app, ['Clear This Site’s Data…']);
    await expect.poll(() => evaluatePage(f.app, f.origin, `localStorage.getItem('draft')`)).toBe(null);
    expect(await evaluatePage(f.app, f.origin, 'document.cookie')).not.toContain('fixture=local');
    expect(await f.app.evaluate(async ({ session }) => (await session.fromPartition('persist:setdown-browser').cookies.get({ url: 'https://unrelated.example/' }))[0]?.value)).toBe('keep');
    expect(await f.page.evaluate(async url => (await window.marktex.browser.places(url, 'bookmarks')).some(place => place.url === url), `${f.origin}/first`)).toBe(true);
    const target = path.join(f.root, 'download.pdf');
    await f.app.evaluate(({ session }, target) => session.fromPartition('persist:setdown-browser').once('will-download', (_event, item) => item.setSavePath(target)), target);
    await evaluatePage(f.app, f.origin, `const link=document.createElement('a');link.href='/download-pdf';link.download='download.pdf';document.body.append(link);link.click();true`);
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.downloads()).some(item => item.name === 'download.pdf' && item.state === 'completed'))).toBe(true);
    await expect(web).toHaveAttribute('aria-selected', 'true'); expect(await web.getAttribute('data-tab-id')).toBe(id);
    expect((await readFile(target)).subarray(0, 4).toString()).toBe('%PDF');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('history deletion updates persistent places while preserving bookmarks and page state', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="retained";true');
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.getByRole('button', { name: 'Delete history: Research page', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place')).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('retained');
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    await f.page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Second page']);
    await f.page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await f.page.getByRole('group', { name: 'Confirm clear history' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Second page']);
    await f.page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await f.page.getByRole('button', { name: 'Clear all history', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place')).toHaveCount(0);
    const bookmark = await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'));
    expect(bookmark).toEqual([{ url: `${f.origin}/first`, title: 'Research page', bookmarked: true, lastVisit: 0, visits: 0 }]);
    // Close live pages before this persistence check; reopening a page should
    // normally record a new visit, while app startup itself opens no tabs.
    await f.page.evaluate(async () => {
      for (const page of await window.marktex.browser.restore()) await window.marktex.browser.close(page.id);
    });
    await f.restart();
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).toEqual(bookmark);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

