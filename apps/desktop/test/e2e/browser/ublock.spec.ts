import { expect, test } from '@playwright/test';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('bundled uBlock blocks requests, scripts and frame cosmetics, and enforces response-header filters', async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
    // uBO aliases chrome to browser on startup. Both names must retain the
    // augmented APIs in Chromium versions exposing a separate browser object.
    expect(await f.app.evaluate(async ({ webContents }) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      return background.executeJavaScript(`({same:browser===chrome,
        badge:typeof browser.browserAction.setBadgeBackgroundColor,
        css:typeof browser.tabs.insertCSS, managed:typeof browser.storage.managed})`);
    })).toEqual({ same: true, badge: 'function', css: 'function', managed: 'undefined' });
    const filters = "*/blocked.js$script\n127.0.0.1##.ad\n127.0.0.1##.frame-ad\n127.0.0.1##+js(set-constant, probeFlag, true)\n*/csp$csp=script-src 'none'\n";
    await f.app.evaluate(async ({ webContents }, filters) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage' && wc.getURL().endsWith('/background.html'))!;
      await background.executeJavaScript(`(async()=>{const {default:u}=await import('./js/background.js');await u.saveSelectedFilterLists([u.userFiltersPath]);await u.saveUserFilters(${JSON.stringify(filters)});await u.loadFilterLists();return true;})()`);
    }, filters);
    f.requests.length = 0;
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, '({ad:getComputedStyle(document.querySelector(".ad")).display, frame:getComputedStyle(document.querySelector("iframe").contentDocument.querySelector(".frame-ad")).display, flag:window.probeFlag, blocked:!!window.blockedScript,allowed:!!window.allowedScript})'))
      .toEqual({ ad: 'none', frame: 'none', flag: true, blocked: false, allowed: true });
    expect(f.requests).not.toContain('/blocked.js');
    // Actual frame user styles can be removed without navigating the page.
    expect(await f.app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      const frame = page.mainFrame.frames.find(frame => frame.url.endsWith('/frame'))!;
      const args = JSON.stringify([page.id, { frameId: frame.frameTreeNodeId, code: '.removable{display:none!important}' }]);
      await background.executeJavaScript(`chrome.tabs.insertCSS(...${args})`);
      const hidden = await frame.executeJavaScript('getComputedStyle(document.querySelector(".removable")).display');
      await background.executeJavaScript(`chrome.tabs.removeCSS(...${args})`);
      const shown = await frame.executeJavaScript('getComputedStyle(document.querySelector(".removable")).display');
      return { hidden, shown };
    }, f.origin)).toEqual({ hidden: 'none', shown: 'block' });
    await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/csp`);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
    await expect.poll(() => evaluatePage(f.app, f.origin, '({url:location.pathname,allowed:!!window.allowedScript})')).toEqual({ url: '/csp', allowed: false });
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('navigation', { name: 'Browser library' }).getByRole('button', { name: 'Extensions' }).click();
    await f.page.locator('.extension').filter({ has: f.page.locator('.extension-name', { hasText: 'uBlock Origin' }) })
      .getByRole('button', { name: 'Popup', exact: true }).click();
    await expect.poll(() => f.app.evaluate(async ({ webContents }) => {
      const popup = webContents.getAllWebContents().find(wc => wc.getURL().includes('/popup-fenix.html'));
      return popup && popup.mainFrame.executeJavaScript('document.querySelector("#hostname")?.textContent');
    })).toContain('127.0.0.1');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('uBlock migrates the recursive managed cache and preserves filtering across restarts', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  const filters = '*/blocked.js$script\n127.0.0.1##.ad\n';
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(async ({ webContents }, filters) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      await background.executeJavaScript(`(async()=>{
        const {default:u}=await import('./js/background.js');
        await u.saveSelectedFilterLists([u.userFiltersPath]);
        await u.saveUserFilters(${JSON.stringify(filters)});
        u.userSettings.showIconBadge=false;await u.saveUserSettings();await u.loadFilterLists();
        // Reproduce the old adapter's nested cache without a multi-GB fixture.
        let cache={payload:'x'.repeat(65536)};
        for(let i=0;i<6;i++)cache={cachedManagedStorage:cache,previous:cache};
        await new Promise(resolve=>chrome.storage.local.set({cachedManagedStorage:cache},resolve));
      })()`);
    }, filters);
    for (let cycle = 0; cycle < 3; cycle++) {
      f.requests.length = 0;
      await f.restart();
      await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
      expect(await evaluatePage(f.app, f.origin, '({ad:getComputedStyle(document.querySelector(".ad")).display,blocked:!!window.blockedScript,allowed:!!window.allowedScript})'))
        .toEqual({ ad: 'none', blocked: false, allowed: true });
      expect(f.requests).not.toContain('/blocked.js');
      expect(await f.app.evaluate(async ({ webContents }) => {
        const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
        return background.executeJavaScript(`(async()=>{
          const {default:u}=await import('./js/background.js');
          return {managed:typeof chrome.storage.managed,badge:u.userSettings.showIconBadge,
            filters:(await u.loadUserFilters()).content,
            cacheBytes:await new Promise(resolve=>chrome.storage.local.getBytesInUse('cachedManagedStorage',resolve))};
        })()`);
      })).toEqual({ managed: 'undefined', badge: false, filters: filters.trim(), cacheBytes: 0 });
    }
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

