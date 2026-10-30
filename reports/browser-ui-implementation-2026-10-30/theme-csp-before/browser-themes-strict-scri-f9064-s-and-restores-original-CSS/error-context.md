# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> strict script CSP retains CSSOM theme updates and restores original CSS
- Location: test/e2e/browser/themes.spec.ts:86:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
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
  12  |       request.url === 'https://theme-assets.example/theme.css'
  13  |         ? net.fetch(`${origin}/theme.css`)
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
  43  |     expect(f.errors).toEqual([]);
  44  |   } catch (error) {
  45  |     console.log('Theme diagnostics', JSON.stringify({ requests: f.requests,
  46  |       messages: await f.app.evaluate(() => (globalThis as any).__themeMessages),
  47  |       styles: await evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style,link')).map(e=>({tag:e.tagName,href:e.href,class:e.className,text:e.textContent,rules:(()=>{try{return Array.from(e.sheet?.cssRules??[]).map(r=>r.cssText)}catch{return null}})()}))`),
  48  |     }));
  49  |     throw error;
  50  |   } finally { await f.dispose(); }
  51  | });
  52  | 
  53  | test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  54  |   const f = await fixture();
  55  |   try {
  56  |     await externalStyles(f);
  57  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  58  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  59  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  60  |     const themed = rgb(themeProfile('solarized-light').palette.surface);
  61  |     const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
  62  |     await expect.poll(background).toBe(themed);
  63  |     const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
  64  |     await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
  65  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  66  |     await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
  67  |     await expect.poll(background).toBe(themed);
  68  |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  69  |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  70  |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  71  |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  72  |     const toggle = menu.getByRole('menuitemcheckbox', { name: /Apply Theme to Web Pages$/ });
  73  |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
  74  |     await toggle.click();
  75  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  76  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  77  |     await f.restart();
  78  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  79  |     expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
  80  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
  81  |     await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
  82  |     expect(f.errors).toEqual([]);
  83  |   } finally { await f.dispose(); }
  84  | });
  85  | 
  86  | test('strict script CSP retains CSSOM theme updates and restores original CSS', async () => {
  87  |   const f = await fixture();
  88  |   try {
  89  |     await externalStyles(f);
  90  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  91  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme-csp`);
  92  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  93  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor'))
  94  |       .toBe(rgb(themeProfile('solarized-light').palette.surface));
  95  |     await evaluatePage(f.app, f.origin, `
  96  |       window.authoredSheet = Array.from(document.querySelectorAll('style')).find(e => !e.classList.contains('darkreader')).sheet;
  97  |       window.authoredRule = Array.from(authoredSheet.cssRules).find(r => r.selectorText === '#article, #sidebar');
  98  |       const control = document.createElement('div'); control.id = 'reference'; control.style.backgroundColor = '#004477'; document.body.append(control);
  99  |       authoredRule.style.setProperty('background-color', '#004477'); true;
  100 |     `);
  101 |     const colors = () => evaluatePage<string[]>(f.app, f.origin, `['#article','#reference'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`);
> 102 |     await expect.poll(async () => { const [actual, reference] = await colors(); return actual === reference && actual !== 'rgb(0, 68, 119)'; }).toBe(true);
      |                                                                                                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  103 |     await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
  104 |     await expect.poll(colors).toEqual(['rgb(0, 68, 119)', 'rgb(0, 68, 119)']);
  105 |     expect(await evaluatePage(f.app, f.origin, 'authoredRule.style.backgroundColor')).toBe('rgb(0, 68, 119)');
  106 |     expect(f.errors).toEqual([]);
  107 |   } finally { await f.dispose(); }
  108 | });
  109 | 
```