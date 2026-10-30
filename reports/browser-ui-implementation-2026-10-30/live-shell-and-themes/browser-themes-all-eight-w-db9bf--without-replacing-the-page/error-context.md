# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> all eight web themes cover light-dark surfaces and external CSS without replacing the page
- Location: test/e2e/browser/themes.spec.ts:6:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('tab', { name: /Theme fixture/ })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('tab', { name: /Theme fixture/ }) with timeout 5000ms
  - waiting for getByRole('tab', { name: /Theme fixture/ })

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "notes.md ×" [selected]:
          - text: notes.md
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-browser-uIBlWJ/notes.md
    - button "Open outline"
    - button "Switch to Editor"
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Rendered Markdown"
- alert
- alert
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
> 10 |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
     |                                                                      ^ Error: expect(locator).toBeVisible() failed
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
  48 |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
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