# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/zoom.spec.ts >> browser Ctrl+wheel zooms websites and frames independently of the app and documents
- Location: test/e2e/browser/zoom.spec.ts:6:1

# Error details

```
Error: expect(received).toBeCloseTo(expected, precision)

Expected: 1.1
Received: 1

Expected precision:    4
Expected difference: < 0.00005
Received difference:   0.10000000000000009

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { pinch } from '../../support/electron/pinch';
  2   | import { expect, test } from '@playwright/test';
  3   | 
  4   | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  5   | 
  6   | test('browser Ctrl+wheel zooms websites and frames independently of the app and documents', async () => {
  7   |   const f = await fixture();
  8   |   try {
  9   |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  10  |     const firstTab = f.page.getByRole('tab', { name: /Research page/ });
  11  |     await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  12  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  13  |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0]
  14  |       .contentView.children.some(view => view.getVisible() && 'webContents' in view
  15  |         && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
  16  |     // Keep the actual view reference while hidden tabs detach from the window.
  17  |     // Continue checking the same native bounds, identity and zoom off-screen.
  18  |     const native = await f.app.evaluateHandle(({ BrowserWindow, webContents }, origin) => {
  19  |       const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  20  |       const window = BrowserWindow.getAllWindows()[0];
  21  |       const view = window.contentView.children.find(view => 'webContents' in view
  22  |         && (view as Electron.WebContentsView).webContents.id === page.id) as Electron.WebContentsView;
  23  |       return { window, view };
  24  |     }, f.origin);
  25  |     const state = () => native.evaluate(({ window, view }) => ({ id: view.webContents.id,
  26  |       factor: view.webContents.getZoomFactor(), bounds: view.getBounds(), app: window.webContents.getZoomFactor() }));
  27  |     const wheel = async (deltaY: number, control = true, frame = false) => {
  28  |       await f.app.evaluate(async ({ webContents }, { origin, deltaY, control, frame }) => {
  29  |         const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  30  |         // A changed getZoomFactor() precedes the compositor's child-frame hit
  31  |         // regions. Establish the new native frame before the one iframe input.
  32  |         if (frame && (await page.capturePage()).isEmpty()) throw Error('The zoomed browser frame is not ready');
  33  |         const point = frame ? await page.executeJavaScript(`(()=>{
  34  |           const r=document.querySelector('iframe').getBoundingClientRect();
  35  |           return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : { x: 100, y: 20 };
  36  |         const factor = page.getZoomFactor();
  37  |         // Test the top-level surface first; (100,100) lands inside the iframe
  38  |         // before its compositor input region is registered. The explicit frame
  39  |         // case below separately verifies native wheel input inside the iframe.
  40  |         // Native input uses DIP; page wheel deltas are CSS pixels after zoom.
  41  |         const x = Math.round(point.x * factor), y = Math.round(point.y * factor);
  42  |         page.focus(); page.sendInputEvent({ type: 'mouseMove', x, y });
  43  |         page.sendInputEvent({ type: 'mouseWheel', x, y,
  44  |           deltaX: 0, deltaY: deltaY * factor, modifiers: control ? ['control'] : [], canScroll: true });
  45  |       }, { origin: f.origin, deltaY, control, frame });
  46  |     };
  47  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="keep this";window.keptObject={value:42};true');
  48  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
  49  |     await evaluatePage(f.app, f.origin, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  50  |     const original = await state();
  51  |     // Like wheel() below, target the top-level page rather than the iframe's
  52  |     // not-yet-registered compositor input region. Frame input is checked below.
  53  |     await pinch(f.app, 1.3, undefined, f.origin, { x: 180, y: 20 });
  54  |     await expect.poll(async () => (await state()).factor).toBeGreaterThan(1);
  55  |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  56  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  57  |     const preferences = await f.page.evaluate(() => window.marktex.getZoom());
  58  |     await evaluatePage(f.app, f.origin, 'window.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:-120}));true');
  59  |     expect((await state()).factor).toBe(1);
  60  |     await wheel(120, false);
  61  |     expect((await state()).factor).toBe(1);
  62  |     await wheel(120);
  63  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  64  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
  65  |     await wheel(-120);
  66  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  67  |     await wheel(40);
  68  |     expect((await state()).factor).toBeCloseTo(1, 4);
  69  |     await wheel(40);
  70  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  71  |     await wheel(-80);
  72  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  73  |     await wheel(120, true, true);
> 74  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
      |                                                           ^ Error: expect(received).toBeCloseTo(expected, precision)
  75  |     expect(await state()).toEqual({ ...original, factor: expect.closeTo(1.1, 4) });
  76  |     expect(await f.page.evaluate(async () => { const { tabs, revision, ...scopes } = await window.marktex.getZoom(); return scopes; })).toEqual({ app: preferences.app, text: preferences.text, terminal: preferences.terminal });
  77  |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value})'))
  78  |       .toEqual({ draft: 'keep this', value: 42 });
  79  |     await f.page.getByRole('tab', { name: /notes.md/ }).click();
  80  |     await firstTab.click();
  81  |     expect((await state()).factor).toBeCloseTo(1.1, 4);
  82  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  83  |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toHaveAttribute('aria-selected', 'true');
  84  |     expect(await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
  85  |       .find(wc => wc.getURL() === `${origin}/second`)!.getZoomFactor(), f.origin)).toBeCloseTo(1, 4);
  86  |     await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
  87  |     await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveAttribute('aria-selected', 'true');
  88  |     await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getAllWebContents()
  89  |       .find(wc => wc.getURL() === 'https://www.google.com/')!.getZoomFactor())).toBeCloseTo(1, 4);
  90  |     await f.page.keyboard.press('Control+=');
  91  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.21, 4);
  92  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  93  |     await f.page.keyboard.press('Control+0');
  94  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  95  |     await firstTab.click();
  96  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
  97  |     await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
  98  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.2, 4);
  99  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('120%');
  100 |     expect(await evaluatePage(f.app, `${f.origin}/first`, 'document.querySelector("#draft").value')).toBe('keep this');
  101 |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  102 |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  103 |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  104 |     await f.page.getByRole('button', { name: 'Zoom website out', exact: true }).click();
  105 |     await expect.poll(async () => (await state()).factor).toBeCloseTo(.9, 4);
  106 |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  107 |     await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
  108 |     await expect.poll(() => evaluatePage(f.app, `${f.origin}/first`, 'document.readyState')).toBe('complete');
  109 |     expect((await state()).factor).toBeCloseTo(1, 4);
  110 |     expect((await state()).id).toBe(original.id);
  111 |     await f.page.getByRole('tab', { name: /Second page/ }).click();
  112 |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  113 |     expect(f.errors).toEqual([]);
  114 |   } finally { await f.dispose(); }
  115 | });
  116 | 
  117 | 
```