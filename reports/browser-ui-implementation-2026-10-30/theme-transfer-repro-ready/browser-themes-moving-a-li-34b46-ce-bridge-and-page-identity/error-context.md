# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> moving a live themed tab to another window retains its resource bridge and page identity
- Location: test/e2e/browser/themes.spec.ts:111:1

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
  37  |     expect(f.requests.filter(url => url === '/theme.css').length).toBeGreaterThan(1);
  38  |     await evaluatePage(f.app, f.origin, `
  39  |       history.pushState({}, '', '/theme#next-article');
  40  |       const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://theme-assets.example/route.css'; document.head.append(link);
  41  |       const block = document.createElement('div'); block.id = 'route-external'; block.textContent = 'New article'; document.body.append(block); true;
  42  |     `);
  43  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#route-external")).backgroundColor'))
  44  |       .toBe(rgb(themeProfile(THEME_IDS.at(-1)!).palette.surface));
  45  |     // Chromium may coalesce the link and bridge fetch into one network request.
  46  |     // The inaccessible original sheet and generated rule prove bridge rendering.
  47  |     await expect.poll(() => evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style.darkreader--sync')).some(e => Array.from(e.sheet.cssRules).some(r => r.selectorText === '#route-external'))`)).toBe(true);
  48  |     expect(await evaluatePage(f.app, f.origin, `(() => { try { document.querySelector('link[href$="route.css"]').sheet.cssRules; return false; } catch(e) { return e.name === 'SecurityError'; } })()`)).toBe(true);
  49  |     expect(await evaluatePage(f.app, f.origin, 'keptNode === document.querySelector("#draft") && keptNode.value === "보존할 입력"')).toBe(true);
  50  |     expect(f.errors).toEqual([]);
  51  |   } finally { await f.dispose(); }
  52  | });
  53  | 
  54  | test('Theme menu toggles web colors live, preserves site exceptions and persists after restart', async () => {
  55  |   const f = await fixture();
  56  |   try {
  57  |     await externalStyles(f);
  58  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  59  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  60  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  61  |     const themed = rgb(themeProfile('solarized-light').palette.surface);
  62  |     const background = () => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor');
  63  |     await expect.poll(background).toBe(themed);
  64  |     const tabId = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
  65  |     await f.page.evaluate(tabId => window.marktex.browser.updateThemeSettings({ site: { tabId, original: true } }), tabId);
  66  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  67  |     await f.page.evaluate(origin => window.marktex.browser.updateThemeSettings({ restoreSite: origin }), f.origin);
  68  |     await expect.poll(background).toBe(themed);
  69  |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  70  |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  71  |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  72  |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  73  |     const toggle = menu.getByRole('menuitemcheckbox', { name: /Apply Theme to Web Pages$/ });
  74  |     await expect(toggle).toHaveAttribute('aria-checked', 'true');
  75  |     await toggle.click();
  76  |     await expect.poll(background).toBe('rgb(255, 255, 255)');
  77  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  78  |     await f.restart();
  79  |     expect(await f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'original', originalSites: [] });
  80  |     expect(await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.checked)).toBe(false);
  81  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-theme-web')!.click());
  82  |     await expect.poll(() => f.page.evaluate(() => window.marktex.browser.themeSettings())).toEqual({ mode: 'app', originalSites: [] });
  83  |     expect(f.errors).toEqual([]);
  84  |   } finally { await f.dispose(); }
  85  | });
  86  | 
  87  | test('strict script CSP retains CSSOM theme updates and restores original CSS', async () => {
  88  |   const f = await fixture();
  89  |   try {
  90  |     await externalStyles(f);
  91  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  92  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme-csp`);
  93  |     await expect(f.page.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  94  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#article")).backgroundColor'))
  95  |       .toBe(rgb(themeProfile('solarized-light').palette.surface));
  96  |     await evaluatePage(f.app, f.origin, `
  97  |       window.authoredSheet = Array.from(document.querySelectorAll('style')).find(e => !e.classList.contains('darkreader')).sheet;
  98  |       window.authoredRule = Array.from(authoredSheet.cssRules).find(r => r.selectorText === '#article, #sidebar');
  99  |       const control = document.createElement('div'); control.id = 'reference'; control.style.backgroundColor = '#004477'; document.body.append(control);
  100 |       authoredRule.style.setProperty('background-color', '#004477'); true;
  101 |     `);
  102 |     const colors = () => evaluatePage<string[]>(f.app, f.origin, `['#article','#reference'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`);
  103 |     await expect.poll(async () => { const [actual, reference] = await colors(); return actual === reference && actual !== 'rgb(0, 68, 119)'; }).toBe(true);
  104 |     await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
  105 |     await expect.poll(colors).toEqual(['rgb(0, 68, 119)', 'rgb(0, 68, 119)']);
  106 |     expect(await evaluatePage(f.app, f.origin, 'authoredRule.style.backgroundColor')).toBe('rgb(0, 68, 119)');
  107 |     expect(f.errors).toEqual([]);
  108 |   } finally { await f.dispose(); }
  109 | });
  110 | 
  111 | test('moving a live themed tab to another window retains its resource bridge and page identity', async () => {
  112 |   const f = await fixture();
  113 |   try {
  114 |     await externalStyles(f);
  115 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
  116 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme`);
  117 |     const tab = f.page.getByRole('tab', { name: /Theme fixture/ });
  118 |     await expect(tab).toBeVisible();
  119 |     const expected = rgb(themeProfile('solarized-light').palette.surface);
  120 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#external")).backgroundColor')).toBe(expected);
  121 |     await evaluatePage(f.app, f.origin, 'window.keptDraft = document.querySelector("#draft"); keptDraft.value = "이동 중 보존"; true');
  122 |     const nativeId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/theme`)!.id, f.origin);
  123 |     await tab.evaluate(element => {
  124 |       const dataTransfer = new DataTransfer();
  125 |       element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
  126 |       element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
  127 |       element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: 0, screenY: 0 }));
  128 |     });
  129 |     await expect(tab).toHaveCount(0);
  130 |     await expect.poll(() => f.app.windows().filter(page => page.url() === f.page.url()).length).toBe(2);
  131 |     const destination = f.app.windows().find(page => page !== f.page && page.url() === f.page.url())!;
  132 |     await expect(destination.getByRole('tab', { name: /Theme fixture/ })).toBeVisible();
  133 |     await evaluatePage(f.app, f.origin, `
  134 |       const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://theme-assets.example/route.css'; document.head.append(link);
  135 |       const block = document.createElement('div'); block.id = 'route-external'; document.body.append(block); true;
  136 |     `);
> 137 |     await expect.poll(() => evaluatePage(f.app, f.origin, `Array.from(document.querySelectorAll('style.darkreader--sync')).some(e => Array.from(e.sheet.cssRules).some(r => r.selectorText === '#route-external'))`)).toBe(true);
      |                                                                                                                                                                                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  138 |     expect(await evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#route-external")).backgroundColor')).toBe(expected);
  139 |     expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('keptDraft === document.querySelector("#draft") && keptDraft.value === "이동 중 보존"'), nativeId)).toBe(true);
  140 |     expect(f.requests.filter(url => url === '/theme')).toHaveLength(1);
  141 |     expect(f.errors).toEqual([]);
  142 |   } finally { await f.dispose(); }
  143 | });
  144 | 
```