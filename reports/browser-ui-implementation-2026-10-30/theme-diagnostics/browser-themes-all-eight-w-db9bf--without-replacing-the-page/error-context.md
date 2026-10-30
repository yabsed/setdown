# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> all eight web themes cover light-dark surfaces and external CSS without replacing the page
- Location: test/e2e/browser/themes.spec.ts:6:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Array [
    "rgb(243, 242, 238)",
    "rgb(243, 242, 238)",
-   "rgb(243, 242, 238)",
+   "rgb(255, 255, 255)",
  ]

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  3  | import { THEME_IDS, themeProfile } from '../../../src/core/theme/theme-catalog';
  4  | 
  5  | const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  6  | test('all eight web themes cover light-dark surfaces and external CSS without replacing the page', async () => {
  7  |   const f = await fixture();
  8  |   try {
  9  |     await f.app.evaluate(({ app }) => {
  10 |       (globalThis as any).__themeMessages = [];
  11 |       app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_event, details) => {
  12 |         (globalThis as any).__themeMessages.push(details);
  13 |       }));
  14 |     });
  15 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  16 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  17 |     await evaluatePage(f.app, f.origin, 'window.keptNode = document.querySelector("#draft"); keptNode.value = "보존할 입력"; scrollTo(0,600); true');
  18 |     for (const id of THEME_IDS) {
  19 |       await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
  20 |       const expected = rgb(themeProfile(id).palette.surface);
> 21 |       await expect.poll(() => evaluatePage(f.app, f.origin, `['#article','#sidebar','#external'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`)).toEqual([expected, expected, expected]);
     |                                                                                                                                                                         ^ Error: expect(received).toEqual(expected) // deep equality
  22 |       expect(await evaluatePage(f.app, f.origin, '({same:keptNode===document.querySelector("#draft"),value:keptNode.value,scroll:scrollY})'))
  23 |         .toEqual({ same: true, value: '보존할 입력', scroll: 600 });
  24 |       await evaluatePage(f.app, f.origin, 'scrollTo(0,0)');
  25 |       const web = f.app.windows().find(page => page.url() === `${f.origin}/theme`)!;
  26 |       await web.screenshot({ path: test.info().outputPath(`${id}.png`) });
  27 |       await evaluatePage(f.app, f.origin, 'scrollTo(0,600)');
  28 |     }
  29 |     expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
  30 |     expect(f.requests.filter(url => url === '/theme.css').length).toBeGreaterThan(1);
  31 |     expect(f.errors).toEqual([]);
  32 |   } catch (error) {
  33 |     console.log('Theme diagnostics', JSON.stringify({ requests: f.requests,
  34 |       messages: await f.app.evaluate(() => (globalThis as any).__themeMessages),
  35 |       styles: await evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style,link')).map(e=>({tag:e.tagName,href:e.href,class:e.className,text:e.textContent,rules:(()=>{try{return Array.from(e.sheet?.cssRules??[]).map(r=>r.cssText)}catch{return null}})()}))`),
  36 |     }));
  37 |     throw error;
  38 |   } finally { await f.dispose(); }
  39 | });
  40 | 
  41 | test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  42 |   const f = await fixture();
  43 |   try {
  44 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  45 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  46 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  47 |     const themed = rgb(themeProfile('solarized-light').palette.surface);
  48 |     const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
  49 |     await expect.poll(background).toBe(themed);
  50 |     const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
  51 |     await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
  52 |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  53 |     await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
  54 |     await expect.poll(background).toBe(themed);
  55 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  56 |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  57 |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  58 |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  59 |     const toggle = menu.getByRole('menuitemcheckbox', { name: /Apply Theme to Web Pages$/ });
  60 |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
  61 |     await toggle.click();
  62 |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  63 |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  64 |     await f.restart();
  65 |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  66 |     expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
  67 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
  68 |     await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
  69 |     expect(f.errors).toEqual([]);
  70 |   } finally { await f.dispose(); }
  71 | });
  72 | 
```