import { expect, test } from '@playwright/test';
import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('clearing browsing data removes the chosen site data for every site, and keeps bookmarks and extension data', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    const url = `${f.origin}/first`;
    await f.page.evaluate(url => window.marktex.openLink(url), url);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
    // A user filter lives in the extension's own storage, next to the site data in the same session.
    await f.app.evaluate(async ({ webContents }) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage' && wc.getURL().endsWith('/background.html'))!;
      await background.executeJavaScript(`(async()=>{const {default:u}=await import('./js/background.js');await u.saveSelectedFilterLists([u.userFiltersPath]);await u.saveUserFilters("*/blocked.js$script\\n127.0.0.1##.ad\\n");await u.loadFilterLists();return true;})()`);
    });
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    const blocked = () => evaluatePage(f.app, f.origin, '({ad:getComputedStyle(document.querySelector(".ad")).display,blocked:!!window.blockedScript,allowed:!!window.allowedScript})');
    await expect.poll(blocked).toEqual({ ad: 'none', blocked: false, allowed: true });
    await evaluatePage(f.app, f.origin, 'document.cookie="session=abc; max-age=3600"; localStorage.setItem("draft","kept?"); indexedDB.open("site-db"); true');
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Research page', true), url);
    await f.page.evaluate(() => window.marktex.browser.addPassword({ url: 'https://example.com', username: 'ann', password: 'secret' }));
    const site = () => evaluatePage<{ cookie: string; stored: string | null; state: string }>(f.app, f.origin, '({cookie:document.cookie,stored:localStorage.getItem("draft"),state:document.readyState})');
    expect(await site()).toMatchObject({ cookie: 'session=abc', stored: 'kept?' });
    expect((await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).map(place => place.url)).toEqual([url]);

    await expect(f.page.evaluate(() => window.marktex.browser.clearData([]))).rejects.toThrow('Choose what to clear');
    await expect(f.page.evaluate(() => window.marktex.browser.clearData(['everything' as never]))).rejects.toThrow('Choose what to clear');
    expect(await site()).toMatchObject({ cookie: 'session=abc', stored: 'kept?' });

    // The menu command (Ctrl+Shift+Delete) opens the panel in the Browser side view.
    await f.app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('menu-clear-browsing-data')!;
      if (item.accelerator !== 'CmdOrCtrl+Shift+Delete') throw Error('Unexpected shortcut');
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
    });
    const panel = f.page.getByRole('group', { name: 'Clear browsing data' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Browsing history/ })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: /Cookies and site data/ })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: /Cached files/ })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: /Saved passwords/ })).not.toBeChecked();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await site()).toMatchObject({ cookie: 'session=abc', stored: 'kept?' });

    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await f.page.getByRole('button', { name: 'Clear browsing data…', exact: true }).click();
    f.requests.length = 0;
    await panel.getByRole('button', { name: 'Clear data', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Cleared browsing history, cookies and site data, cached files.');
    // The open page reloads instead of showing a session that no longer exists.
    await expect.poll(() => f.requests.includes('/first')).toBe(true);
    await expect.poll(site).toEqual({ cookie: '', stored: null, state: 'complete' });
    expect(await evaluatePage(f.app, f.origin, 'indexedDB.databases().then(list => list.map(db => db.name))')).toEqual([]);
    // Bookmarks, the unselected passwords and the extension's own data are untouched.
    expect((await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).map(place => place.url)).toEqual([url]);
    expect((await f.page.evaluate(() => window.marktex.browser.passwords())).entries.map(entry => entry.username)).toEqual(['ann']);
    await expect.poll(blocked).toEqual({ ad: 'none', blocked: false, allowed: true });
    expect(await f.app.evaluate(async ({ webContents }) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage' && wc.getURL().endsWith('/background.html'))!;
      return background.executeJavaScript(`(async()=>{const {default:u}=await import('./js/background.js');return (await u.loadUserFilters()).content;})()`);
    })).toContain('*/blocked.js$script');
    // The reload after clearing is a new visit; nothing older remains.
    await panel.getByRole('button', { name: 'Done', exact: true }).click();

    const result = await f.page.evaluate(() => window.marktex.browser.clearData(['passwords', 'downloads', 'site-settings', 'history']));
    expect(result).toEqual({ cleared: ['history', 'downloads', 'site-settings', 'passwords'], failed: [] });
    expect((await f.page.evaluate(() => window.marktex.browser.passwords())).entries).toEqual([]);
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    expect((await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).map(place => place.url)).toEqual([url]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
