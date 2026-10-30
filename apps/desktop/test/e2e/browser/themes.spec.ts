import { expect, test } from '@playwright/test';
import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
import { THEME_IDS, themeProfile } from '../../../src/core/theme/theme-catalog';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
// Keep the upstream engine's private-address/CORS guards intact. Chromium's
// session protocol supplies an offline HTTPS asset without CORS response headers;
// both the page's link and the real isolated-preload resource bridge use it.
async function externalStyles(f: Awaited<ReturnType<typeof fixture>>) {
  await f.app.evaluate(async ({ session, net }, origin) => {
    await session.fromPartition('persist:setdown-browser').protocol.unhandle('https');
    session.fromPartition('persist:setdown-browser').protocol.handle('https', request =>
      /^https:\/\/theme-assets\.example\/(theme|route)\.css$/.test(request.url)
        ? net.fetch(`${origin}${new URL(request.url).pathname}`)
        : net.fetch(request, { bypassCustomProtocolHandlers: true }));
  }, f.origin);
}
test('all web themes cover light-dark surfaces and external CSS without replacing the page', async () => {
  const f = await fixture();
  try {
    await externalStyles(f);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
    await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, 'window.keptNode = document.querySelector("#draft"); keptNode.value = "보존할 입력"; scrollTo(0,600); true');
    for (const id of THEME_IDS) {
      await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
      const expected = rgb(themeProfile(id).palette.surface);
      await expect.poll(() => evaluatePage(f.app, f.origin, `['#article','#sidebar','#external'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`)).toEqual([expected, expected, expected]);
      expect(await evaluatePage(f.app, f.origin, '({same:keptNode===document.querySelector("#draft"),value:keptNode.value,scroll:scrollY})'))
        .toEqual({ same: true, value: '보존할 입력', scroll: 600 });
      await evaluatePage(f.app, f.origin, 'scrollTo(0,0)');
      const web = f.app.windows().find(page => page.url() === `${f.origin}/theme`)!;
      await web.screenshot({ path: test.info().outputPath(`${id}.png`) });
      await evaluatePage(f.app, f.origin, 'scrollTo(0,600)');
    }
    expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
    expect(f.requests.filter(url => url === '/theme.css').length).toBeGreaterThan(1);
    await evaluatePage(f.app, f.origin, `
      history.pushState({}, '', '/theme#next-article');
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://theme-assets.example/route.css'; document.head.append(link);
      const block = document.createElement('div'); block.id = 'route-external'; block.textContent = 'New article'; document.body.append(block); true;
    `);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#route-external")).backgroundColor'))
      .toBe(rgb(themeProfile(THEME_IDS.at(-1)!).palette.surface));
    // Chromium may coalesce the link and bridge fetch into one network request.
    // The inaccessible original sheet and generated rule prove bridge rendering.
    await expect.poll(() => evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style.darkreader--sync')).some(e => Array.from(e.sheet.cssRules).some(r => r.selectorText === '#route-external'))`)).toBe(true);
    expect(await evaluatePage(f.app, f.origin, `(() => { try { document.querySelector('link[href$="route.css"]').sheet.cssRules; return false; } catch(e) { return e.name === 'SecurityError'; } })()`)).toBe(true);
    expect(await evaluatePage(f.app, f.origin, 'keptNode === document.querySelector("#draft") && keptNode.value === "보존할 입력"')).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  const f = await fixture();
  try {
    await externalStyles(f);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
    await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    const themed = rgb(themeProfile('solarized-light').palette.surface);
    const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
    await expect.poll(background).toBe(themed);
    const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
    await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
    await expect.poll(background).toBe('rgb(255, 255, 255)');
    await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
    await expect.poll(background).toBe(themed);
    await f.page.getByRole('button', { name: 'View', exact: true }).click();
    await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
    const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
    await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
    const toggle = menu.getByRole('menuitemcheckbox', { name: /Apply Theme to Web Pages$/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect.poll(background).toBe('rgb(255, 255, 255)');
    expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
    await f.restart();
    expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
    expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
    await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('strict script CSP retains CSSOM theme updates and restores original CSS', async () => {
  const f = await fixture();
  try {
    await externalStyles(f);
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme-csp`);
    await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor'))
      .toBe(rgb(themeProfile('solarized-light').palette.surface));
    await evaluatePage(f.app, f.origin, `
      window.authoredSheet = Array.from(document.querySelectorAll('style')).find(e => !e.classList.contains('darkreader')).sheet;
      window.authoredRule = Array.from(authoredSheet.cssRules).find(r => r.selectorText === '#article, #sidebar');
      const control = document.createElement('div'); control.id = 'reference'; control.style.backgroundColor = '#004477'; document.body.append(control);
      authoredRule.style.setProperty('background-color', '#004477'); true;
    `);
    const colors = () => evaluatePage<string[]>(f.app, f.origin, `['#article','#reference'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`);
    await expect.poll(async () => { const [actual, reference] = await colors(); return actual === reference && actual !== 'rgb(0, 68, 119)'; }).toBe(true);
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await expect.poll(colors).toEqual(['rgb(0, 68, 119)', 'rgb(0, 68, 119)']);
    expect(await evaluatePage(f.app, f.origin, 'authoredRule.style.backgroundColor')).toBe('rgb(0, 68, 119)');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('moving a live themed tab to another window retains its resource bridge and page identity', async () => {
  const f = await fixture();
  try {
    await externalStyles(f);
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
    const tab = f.page.getByRole('tab', { name: /Theme fixture/ });
    await expect(tab).toBeVisible();
    const expected = rgb(themeProfile('solarized-light').palette.surface);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#external")).backgroundColor')).toBe(expected);
    await evaluatePage(f.app, f.origin, 'window.keptDraft = document.querySelector("#draft"); keptDraft.value = "이동 중 보존"; true');
    const nativeId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/theme`)!.id, f.origin);
    await tab.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: 0, screenY: 0 }));
    });
    await expect(tab).toHaveCount(0);
    await expect.poll(() => f.app.windows().filter(page => page.url() === f.page.url()).length).toBe(2);
    const destination = f.app.windows().find(page => page !== f.page && page.url() === f.page.url())!;
    await expect(destination.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://theme-assets.example/route.css'; document.head.append(link);
      const block = document.createElement('div'); block.id = 'route-external'; document.body.append(block); true;
    `);
    await expect.poll(() => evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style.darkreader--sync')).some(e => Array.from(e.sheet.cssRules).some(r => r.selectorText === '#route-external'))`)).toBe(true);
    expect(await evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#route-external")).backgroundColor')).toBe(expected);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('keptDraft === document.querySelector("#draft") && keptDraft.value === "이동 중 보존"'), nativeId)).toBe(true);
    expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
