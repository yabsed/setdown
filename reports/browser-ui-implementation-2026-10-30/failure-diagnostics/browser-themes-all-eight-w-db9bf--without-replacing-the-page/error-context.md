# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> all eight web themes cover light-dark surfaces and external CSS without replacing the page
- Location: test/e2e/browser/themes.spec.ts:17:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 1
Received:   1

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  3   | import { THEME_IDS, themeProfile } from '../../../src/core/theme/theme-catalog';
  4   | 
  5   | const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  6   | // Keep the upstream engine's private-address/CORS guards intact. Chromium's
  7   | // session protocol supplies an offline HTTPS asset without CORS response headers;
  8   | // both the page's link and the real isolated-preload resource bridge use it.
  9   | async function externalStyles(f: Awaited<ReturnType<typeof fixture>>) {
  10  |   await f.app.evaluate(({ session, net }, origin) => {
  11  |     session.fromPartition('persist:setdown-browser').protocol.handle('https', request =>
  12  |       /^https:\/\/theme-assets\.example\/(theme|route)\.css$/.test(request.url)
  13  |         ? net.fetch(`${origin}${new URL(request.url).pathname}`)
  14  |         : net.fetch(request, { bypassCustomProtocolHandlers: true }));
  15  |   }, f.origin);
  16  | }
  17  | test('all eight web themes cover light-dark surfaces and external CSS without replacing the page', async () => {
  18  |   const f = await fixture();
  19  |   try {
  20  |     await externalStyles(f);
  21  |     await f.app.evaluate(({ app }) => {
  22  |       (globalThis as any).__themeMessages = [];
  23  |       app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_event, ...details) => {
  24  |         (globalThis as any).__themeMessages.push(details);
  25  |       }));
  26  |     });
  27  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  28  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  29  |     await evaluatePage(f.app, f.origin, 'window.keptNode = document.querySelector("#draft"); keptNode.value = "보존할 입력"; scrollTo(0,600); true');
  30  |     for (const id of THEME_IDS) {
  31  |       await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
  32  |       const expected = rgb(themeProfile(id).palette.surface);
  33  |       await expect.poll(() => evaluatePage(f.app, f.origin, `['#article','#sidebar','#external'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`)).toEqual([expected, expected, expected]);
  34  |       expect(await evaluatePage(f.app, f.origin, '({same:keptNode===document.querySelector("#draft"),value:keptNode.value,scroll:scrollY})'))
  35  |         .toEqual({ same: true, value: '보존할 입력', scroll: 600 });
  36  |       await evaluatePage(f.app, f.origin, 'scrollTo(0,0)');
  37  |       const web = f.app.windows().find(page => page.url() === `${f.origin}/theme`)!;
  38  |       await web.screenshot({ path: test.info().outputPath(`${id}.png`) });
  39  |       await evaluatePage(f.app, f.origin, 'scrollTo(0,600)');
  40  |     }
  41  |     expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
  42  |     expect(f.requests.filter(url => url === '/theme.css').length).toBeGreaterThan(1);
  43  |     await evaluatePage(f.app, f.origin, `
  44  |       history.pushState({}, '', '/theme#next-article');
  45  |       const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://theme-assets.example/route.css'; document.head.append(link);
  46  |       const block = document.createElement('div'); block.id = 'route-external'; block.textContent = 'New article'; document.body.append(block); true;
  47  |     `);
  48  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#route-external")).backgroundColor'))
  49  |       .toBe(rgb(themeProfile(THEME_IDS.at(-1)!).palette.surface));
> 50  |     await expect.poll(() => f.requests.filter(url => url === '/route.css').length).toBeGreaterThan(1);
      |                                                                                    ^ Error: expect(received).toBeGreaterThan(expected)
  51  |     expect(await evaluatePage(f.app, f.origin, 'keptNode === document.querySelector("#draft") && keptNode.value === "보존할 입력"')).toBe(true);
  52  |     expect(f.errors).toEqual([]);
  53  |   } catch (error) {
  54  |     console.log('Theme diagnostics', JSON.stringify({ requests: f.requests,
  55  |       messages: await f.app.evaluate(() => (globalThis as any).__themeMessages),
  56  |       styles: await evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style,link')).map(e=>({tag:e.tagName,href:e.href,class:e.className,text:e.textContent,rules:(()=>{try{return Array.from(e.sheet?.cssRules??[]).map(r=>r.cssText)}catch{return null}})()}))`),
  57  |     }));
  58  |     throw error;
  59  |   } finally { await f.dispose(); }
  60  | });
  61  | 
  62  | test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  63  |   const f = await fixture();
  64  |   try {
  65  |     await externalStyles(f);
  66  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  67  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  68  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  69  |     const themed = rgb(themeProfile('solarized-light').palette.surface);
  70  |     const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
  71  |     await expect.poll(background).toBe(themed);
  72  |     const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
  73  |     await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
  74  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  75  |     await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
  76  |     await expect.poll(background).toBe(themed);
  77  |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  78  |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  79  |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  80  |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  81  |     const toggle = menu.getByRole('menuitemcheckbox', { name: /Apply Theme to Web Pages$/ });
  82  |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
  83  |     await toggle.click();
  84  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  85  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  86  |     await f.restart();
  87  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  88  |     expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
  89  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
  90  |     await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
  91  |     expect(f.errors).toEqual([]);
  92  |   } finally { await f.dispose(); }
  93  | });
  94  | 
  95  | test('strict script CSP retains CSSOM theme updates and restores original CSS', async () => {
  96  |   const f = await fixture();
  97  |   try {
  98  |     await externalStyles(f);
  99  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  100 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme-csp`);
  101 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  102 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor'))
  103 |       .toBe(rgb(themeProfile('solarized-light').palette.surface));
  104 |     await evaluatePage(f.app, f.origin, `
  105 |       window.authoredSheet = Array.from(document.querySelectorAll('style')).find(e => !e.classList.contains('darkreader')).sheet;
  106 |       window.authoredRule = Array.from(authoredSheet.cssRules).find(r => r.selectorText === '#article, #sidebar');
  107 |       const control = document.createElement('div'); control.id = 'reference'; control.style.backgroundColor = '#004477'; document.body.append(control);
  108 |       authoredRule.style.setProperty('background-color', '#004477'); true;
  109 |     `);
  110 |     const colors = () => evaluatePage<string[]>(f.app, f.origin, `['#article','#reference'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`);
  111 |     await expect.poll(async () => { const [actual, reference] = await colors(); return actual === reference && actual !== 'rgb(0, 68, 119)'; }).toBe(true);
  112 |     await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
  113 |     await expect.poll(colors).toEqual(['rgb(0, 68, 119)', 'rgb(0, 68, 119)']);
  114 |     expect(await evaluatePage(f.app, f.origin, 'authoredRule.style.backgroundColor')).toBe('rgb(0, 68, 119)');
  115 |     expect(f.errors).toEqual([]);
  116 |   } finally { await f.dispose(); }
  117 | });
  118 | 
```