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

test('raw HSL color tokens follow the cascade, not the last definition in the stylesheet', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/theme-tokens`);
    await expect(f.page.getByRole('tab', { name: /Token fixture/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, 'window.keptNode = document.querySelector("#draft"); keptNode.value = "보존할 입력"; true');
    const paint = () => evaluatePage<{ surfaces: string[]; scope: number; ratios: number[] }>(f.app, f.origin, `(() => {
      const lum = value => (value.match(/[\\d.]+/g) ?? []).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const style = selector => getComputedStyle(document.querySelector(selector));
      const ratio = (text, surface) => { const a = lum(style(text).color), b = lum(style(surface).backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      return { surfaces: ['body', '#page', '#panel', '#bubble'].map(selector => style(selector).backgroundColor),
        scope: lum(style('#scope').backgroundColor), ratios: [ratio('#text', '#page'), ratio('#scope', '#scope')] };
    })()`);
    for (const id of THEME_IDS) {
      await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
      // The light token set applies to the page: every surface is the app's,
      // whether the token is used directly, through aliases or inside a color.
      const surface = rgb(themeProfile(id).palette.surface);
      await expect.poll(async () => (await paint()).surfaces, id).toEqual([surface, surface, surface, surface]);
      // Only the subtree that selects the dark token set keeps a dark panel.
      await expect.poll(async () => { const { scope, ratios } = await paint(); return scope < .3 && ratios.every(ratio => ratio >= 4.5); }, id).toBe(true);
    }
    expect(await evaluatePage(f.app, f.origin, 'keptNode === document.querySelector("#draft") && keptNode.value === "보존할 입력"')).toBe(true);
    expect(f.requests.filter(url => url === '/theme-tokens')).toHaveLength(1);
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await expect.poll(async () => (await paint()).surfaces).toEqual(Array(4).fill('rgb(255, 255, 255)'));
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

test('actual dark and light surfaces keep readable text across themes and dynamic changes', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/contrast`);
    await expect.poll(() => f.app.context().pages().some(p => p.url() === `${f.origin}/contrast`)).toBe(true);
    await evaluatePage(f.app, f.origin, `document.body.innerHTML = '<section id="light"><span>Light secondary text</span></section><section id="dark"><span>Dark secondary text</span></section>';
      const style = document.createElement('style'); style.textContent = '#light{background:#fff;padding:30px;color:#666} #dark{background:#171717;padding:30px;color:#aaa}'; document.head.append(style); true;`);
    const ratios = () => evaluatePage<number[]>(f.app, f.origin, `['light','dark'].map(id => {
      const e = document.getElementById(id), text = e.firstChild;
      const lum = color => {const v=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4); return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
      const a=lum(getComputedStyle(e).backgroundColor),b=lum(getComputedStyle(text).webkitTextFillColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    })`);
    for (const id of THEME_IDS) {
      await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-'+id)!.click(), id);
      await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'app' }));
      await expect.poll(async () => (await ratios()).every(value => value >= 4.5)).toBe(true);
    }
    await evaluatePage(f.app, f.origin, `document.querySelector('#dark').style.backgroundColor='#eee'; document.querySelector('#dark span').textContent='Dynamic text'; true`);
    await expect.poll(async () => (await ratios()).every(value => value >= 4.5)).toBe(true);
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.querySelectorAll("[data-setdown-readable]").length')).toBe(0);
    expect(await evaluatePage(f.app, f.origin, "getComputedStyle(document.querySelector('#dark span')).color")).toBe('rgb(170, 170, 170)');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('relative and mixed sidebar colors retain text contrast when the panel opens and changes theme', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/sidebar-colors`);
    await expect.poll(() => f.app.context().pages().some(p => p.url() === `${f.origin}/sidebar-colors`)).toBe(true);
    // ChatGPT's public CSS (2026-11-09, /cdn/assets/7a4b47cacc9d.css)
    // paints its peeking sidebar with rgb(from ...), and its docked navigation
    // with color-mix(in oklab, ... 65%, transparent). No account content here.
    await evaluatePage(f.app, f.origin, `
      document.body.innerHTML = '<input id="draft"><main id="light">Article text</main><aside data-slate-sidebar-peeking="true"><nav class="sidebar-navigation"><h2>프로젝트</h2><a id="history" href="#conversation"><span>최근 대화</span></a><button id="action"><svg width="24" height="24"><path fill="currentColor" d="M2 2h20v20H2z"/></svg><span>새 대화</span></button></nav></aside>';
      const style = document.createElement('style'); style.textContent = \`
        body { margin: 20px; background: white; color: black; }
        #light { background: white; color: #666; padding: 24px; }
        aside { --color-surface: #171717; --color-surface-elevated-secondary: #171717;
          --app-shell-sidebar-popover-background: rgb(from var(--color-surface-elevated-secondary) r g b / 1);
          background: #171717; width: 320px; }
        .sidebar-navigation { padding: 24px; background-color: color-mix(in oklab, var(--color-surface) 65%, transparent); }
        [data-slate-sidebar-peeking=true] .sidebar-navigation { background-color: var(--app-shell-sidebar-popover-background); }
        h2 { color: white; }
        a, button { display: block; padding: 16px; color: #aaa; background: transparent; }
        #history span { color: color-mix(in oklab, #aaa 100%, transparent); }
      \`; document.head.append(style);
      window.keptDraft = document.querySelector('#draft'); keptDraft.value = '작성 중인 입력'; true;
    `);
    // Chromium paints the actual composed background into a fresh sRGB pixel;
    // this oracle accepts modern computed colors independently of our parser.
    const samples = () => evaluatePage<Array<{ color: string; background: string; ratio: number }>>(f.app, f.origin, `
      ['#light', '#history span', '#action span', '#action svg'].map(selector => {
        const element = document.querySelector(selector), chain = [];
        for (let e = element; e; e = e.parentElement) chain.push(e);
        const canvas = new OffscreenCanvas(1, 1), ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1);
        for (const e of chain.reverse()) { ctx.fillStyle = getComputedStyle(e).backgroundColor; ctx.fillRect(0, 0, 1, 1); }
        const background = [...ctx.getImageData(0, 0, 1, 1).data];
        const color = element instanceof SVGElement ? getComputedStyle(element).color : getComputedStyle(element).webkitTextFillColor;
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const foreground = [...ctx.getImageData(0, 0, 1, 1).data];
        const lum = c => c.slice(0,3).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
        const a = lum(foreground), b = lum(background);
        return { color, background: getComputedStyle(document.querySelector('.sidebar-navigation')).backgroundColor, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
      })`);
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-solarized-light')!.click());
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'app' }));
    await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#light")).backgroundColor'))
      .toBe(rgb(themeProfile('solarized-light').palette.surface));
    await expect.poll(async () => (await samples()).every(value => value.ratio >= 4.5)).toBe(true);
    const web = f.app.context().pages().find(p => p.url() === `${f.origin}/sidebar-colors`)!;
    await web.screenshot({ path: test.info().outputPath('relative-sidebar-solarized.png') });
    await evaluatePage(f.app, f.origin, `document.querySelector('aside').dataset.slateSidebarPeeking = 'false'; true`);
    await expect.poll(async () => (await samples()).every(value => value.ratio >= 4.5)).toBe(true);
    await test.info().attach('solarized-sidebar-colors', { body: JSON.stringify(await samples(), null, 2), contentType: 'application/json' });
    await evaluatePage(f.app, f.origin, `
      const label = document.createElement('span'); label.textContent = '동적으로 열린 대화';
      document.querySelector('#history').replaceChildren(label); true;
    `);
    await expect.poll(async () => (await samples()).every(value => value.ratio >= 4.5)).toBe(true);
    for (const id of THEME_IDS) {
      await f.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-'+id)!.click(), id);
      await expect.poll(() => evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#light")).backgroundColor'))
        .toBe(rgb(themeProfile(id).palette.surface));
      await expect.poll(async () => (await samples()).every(value => value.ratio >= 4.5)).toBe(true);
    }
    expect(await evaluatePage(f.app, f.origin, 'keptDraft === document.querySelector("#draft") && keptDraft.value === "작성 중인 입력"')).toBe(true);
    await f.page.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.querySelectorAll("[data-setdown-readable]").length')).toBe(0);
    expect(await evaluatePage(f.app, f.origin, 'getComputedStyle(document.querySelector("#action span")).color')).toBe('rgb(170, 170, 170)');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
