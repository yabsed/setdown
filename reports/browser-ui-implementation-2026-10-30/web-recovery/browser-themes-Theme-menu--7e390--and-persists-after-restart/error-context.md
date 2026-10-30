# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> Theme menu toggles web colors live, preserves site exceptions and persists after restart
- Location: test/e2e/browser/themes.spec.ts:29:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('menuitemcheckbox', { name: 'Apply Theme to Web Pages', exact: true })
Expected: "true"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('menuitemcheckbox', { name: 'Apply Theme to Web Pages', exact: true }) with timeout 5000ms
  - waiting for getByRole('menuitemcheckbox', { name: 'Apply Theme to Web Pages', exact: true })

```

```yaml
- main:
  - navigation "Application menu":
    - button "File"
    - button "View" [expanded]
    - button "Edit"
    - button "Window"
  - menu:
    - 'menuitem "Toggle Terminal Ctrl+`"'
    - menuitem "Toggle Folder Tools"
    - menuitem "Toggle Viewer / Editor Ctrl+E" [disabled]
    - menuitem "Next Tab Ctrl+Tab"
    - menuitem "Previous Tab Ctrl+Shift+Tab"
    - menuitem "Find Ctrl+F"
    - menuitem "Theme ›"
    - menuitem "Reload Ctrl+R"
    - menuitem "Reload Without Cache Ctrl+Shift+R"
    - menuitem "Toggle Developer Tools Ctrl+Shift+I"
    - menuitem "Reset App Zoom Ctrl+0"
    - menuitem "Zoom In Ctrl++"
    - menuitem "Zoom Out Ctrl+-"
  - menu:
    - menuitemradio "GitHub Light"
    - menuitemradio "Paper"
    - menuitemradio "Medium"
    - menuitemradio "• Solarized Light" [checked]
    - menuitemradio "GitHub Dark"
    - menuitemradio "Night"
    - menuitemradio "One Dark"
    - menuitemradio "Solarized Dark"
    - menuitemcheckbox "✓ Apply Theme to Web Pages" [checked]
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
  9  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  10 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  11 |     await evaluatePage(f.app, f.origin, 'window.keptNode = document.querySelector("#draft"); keptNode.value = "보존할 입력"; scrollTo(0,600); true');
  12 |     for (const id of THEME_IDS) {
  13 |       await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
  14 |       const expected = rgb(themeProfile(id).palette.surface);
  15 |       await expect.poll(() => evaluatePage(f.app, f.origin, `['#article','#sidebar','#external'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`)).toEqual([expected, expected, expected]);
  16 |       expect(await evaluatePage(f.app, f.origin, '({same:keptNode===document.querySelector("#draft"),value:keptNode.value,scroll:scrollY})'))
  17 |         .toEqual({ same: true, value: '보존할 입력', scroll: 600 });
  18 |       await evaluatePage(f.app, f.origin, 'scrollTo(0,0)');
  19 |       const web = f.app.windows().find(page => page.url() === `${f.origin}/theme`)!;
  20 |       await web.screenshot({ path: test.info().outputPath(`${id}.png`) });
  21 |       await evaluatePage(f.app, f.origin, 'scrollTo(0,600)');
  22 |     }
  23 |     expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
  24 |     expect(f.requests.filter(url => url === '/theme.css').length).toBeGreaterThan(1);
  25 |     expect(f.errors).toEqual([]);
  26 |   } finally { await f.dispose(); }
  27 | });
  28 | 
  29 | test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  30 |   const f = await fixture();
  31 |   try {
  32 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  33 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  34 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  35 |     const themed = rgb(themeProfile('solarized-light').palette.surface);
  36 |     const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
  37 |     await expect.poll(background).toBe(themed);
  38 |     const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
  39 |     await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
  40 |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  41 |     await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
  42 |     await expect.poll(background).toBe(themed);
  43 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  44 |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  45 |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  46 |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  47 |     const toggle = menu.getByRole('menuitemcheckbox', { name: 'Apply Theme to Web Pages', exact: true });
> 48 |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
     |                          ^ Error: expect(locator).toHaveAttribute(expected) failed
  49 |     await toggle.click();
  50 |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  51 |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  52 |     await f.restart();
  53 |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  54 |     expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
  55 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
  56 |     await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
  57 |     expect(f.errors).toEqual([]);
  58 |   } finally { await f.dispose(); }
  59 | });
  60 | 
```