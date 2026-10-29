# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/zoom.spec.ts >> browser Ctrl+wheel zooms websites and frames independently of the app and documents
- Location: test/e2e/browser/zoom.spec.ts:6:1

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
  30  |         const point = frame ? await page.executeJavaScript(`(()=>{
  31  |           const r=document.querySelector('iframe').getBoundingClientRect();
  32  |           return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : { x: 100, y: 20 };
  33  |         const factor = page.getZoomFactor();
  34  |         // Test the top-level surface first; (100,100) lands inside the iframe
  35  |         // before its compositor input region is registered. The explicit frame
  36  |         // case below separately verifies native wheel input inside the iframe.
  37  |         // Native input uses DIP; page wheel deltas are CSS pixels after zoom.
  38  |         const x = Math.round(point.x * factor), y = Math.round(point.y * factor);
  39  |         page.focus(); page.sendInputEvent({ type: 'mouseMove', x, y });
  40  |         page.sendInputEvent({ type: 'mouseWheel', x, y,
  41  |           deltaX: 0, deltaY: deltaY * factor, modifiers: control ? ['control'] : [], canScroll: true });
  42  |       }, { origin: f.origin, deltaY, control, frame });
  43  |     };
  44  |     await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="keep this";window.keptObject={value:42};true');
  45  |     await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
  46  |     await evaluatePage(f.app, f.origin, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  47  |     const original = await state();
  48  |     await pinch(f.app, 1.3, undefined, f.origin);
> 49  |     await expect.poll(async () => (await state()).factor).toBeGreaterThan(1);
      |                                                           ^ Error: expect(received).toBeGreaterThan(expected)
  50  |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  51  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  52  |     const preferences = await f.page.evaluate(() => window.marktex.getZoom());
  53  |     await evaluatePage(f.app, f.origin, 'window.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:-120}));true');
  54  |     expect((await state()).factor).toBe(1);
  55  |     await wheel(120, false);
  56  |     expect((await state()).factor).toBe(1);
  57  |     await wheel(120);
  58  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  59  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
  60  |     await wheel(-120);
  61  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  62  |     await wheel(40);
  63  |     expect((await state()).factor).toBeCloseTo(1, 4);
  64  |     await wheel(40);
  65  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  66  |     await wheel(-80);
  67  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  68  |     await wheel(120, true, true);
  69  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  70  |     expect(await state()).toEqual({ ...original, factor: expect.closeTo(1.1, 4) });
  71  |     expect(await f.page.evaluate(async () => { const { tabs, revision, ...scopes } = await window.marktex.getZoom(); return scopes; })).toEqual({ app: preferences.app, text: preferences.text, terminal: preferences.terminal });
  72  |     expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value})'))
  73  |       .toEqual({ draft: 'keep this', value: 42 });
  74  |     await f.page.getByRole('tab', { name: /notes.md/ }).click();
  75  |     await firstTab.click();
  76  |     expect((await state()).factor).toBeCloseTo(1.1, 4);
  77  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  78  |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toHaveAttribute('aria-selected', 'true');
  79  |     expect(await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
  80  |       .find(wc => wc.getURL() === `${origin}/second`)!.getZoomFactor(), f.origin)).toBeCloseTo(1, 4);
  81  |     await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
  82  |     await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveAttribute('aria-selected', 'true');
  83  |     await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getAllWebContents()
  84  |       .find(wc => wc.getURL() === 'https://www.google.com/')!.getZoomFactor())).toBeCloseTo(1, 4);
  85  |     await f.page.keyboard.press('Control+=');
  86  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.21, 4);
  87  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  88  |     await f.page.keyboard.press('Control+0');
  89  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
  90  |     await firstTab.click();
  91  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
  92  |     await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
  93  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1.2, 4);
  94  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('120%');
  95  |     expect(await evaluatePage(f.app, `${f.origin}/first`, 'document.querySelector("#draft").value')).toBe('keep this');
  96  |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  97  |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  98  |     await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
  99  |     await f.page.getByRole('button', { name: 'Zoom website out', exact: true }).click();
  100 |     await expect.poll(async () => (await state()).factor).toBeCloseTo(.9, 4);
  101 |     await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
  102 |     await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
  103 |     await expect.poll(() => evaluatePage(f.app, `${f.origin}/first`, 'document.readyState')).toBe('complete');
  104 |     expect((await state()).factor).toBeCloseTo(1, 4);
  105 |     expect((await state()).id).toBe(original.id);
  106 |     await f.page.getByRole('tab', { name: /Second page/ }).click();
  107 |     await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
  108 |     expect(f.errors).toEqual([]);
  109 |   } finally { await f.dispose(); }
  110 | });
  111 | 
  112 | 
```