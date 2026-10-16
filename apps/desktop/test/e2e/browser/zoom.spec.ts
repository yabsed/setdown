import { expect, test } from '@playwright/test';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('browser Ctrl+wheel zooms websites and frames independently of the app and documents', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const firstTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0]
      .contentView.children.some(view => view.getVisible() && 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
    // Keep the actual view reference while hidden tabs detach from the window.
    // Continue checking the same native bounds, identity and zoom off-screen.
    const native = await f.app.evaluateHandle(({ BrowserWindow, webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      const window = BrowserWindow.getAllWindows()[0];
      const view = window.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.id === page.id) as Electron.WebContentsView;
      return { window, view };
    }, f.origin);
    const state = () => native.evaluate(({ window, view }) => ({ id: view.webContents.id,
      factor: view.webContents.getZoomFactor(), bounds: view.getBounds(), app: window.webContents.getZoomFactor() }));
    const wheel = async (deltaY: number, control = true, frame = false) => {
      await f.app.evaluate(async ({ webContents }, { origin, deltaY, control, frame }) => {
        const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
        const point = frame ? await page.executeJavaScript(`(()=>{
          const r=document.querySelector('iframe').getBoundingClientRect();
          return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : { x: 100, y: 20 };
        const factor = page.getZoomFactor();
        // Test the top-level surface first; (100,100) lands inside the iframe
        // before its compositor input region is registered. The explicit frame
        // case below separately verifies native wheel input inside the iframe.
        // Native input uses DIP; page wheel deltas are CSS pixels after zoom.
        const x = Math.round(point.x * factor), y = Math.round(point.y * factor);
        page.focus(); page.sendInputEvent({ type: 'mouseMove', x, y });
        page.sendInputEvent({ type: 'mouseWheel', x, y,
          deltaX: 0, deltaY: deltaY * factor, modifiers: control ? ['control'] : [], canScroll: true });
      }, { origin: f.origin, deltaY, control, frame });
    };
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="keep this";window.keptObject={value:42};true');
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const original = await state();
    const preferences = await f.page.evaluate(() => window.marktex.getZoom());
    await evaluatePage(f.app, f.origin, 'window.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:-120}));true');
    expect((await state()).factor).toBe(1);
    await wheel(120, false);
    expect((await state()).factor).toBe(1);
    await wheel(120);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
    await wheel(-120);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await wheel(40);
    expect((await state()).factor).toBeCloseTo(1, 4);
    await wheel(40);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await wheel(-80);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await wheel(120, true, true);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    expect(await state()).toEqual({ ...original, factor: expect.closeTo(1.1, 4) });
    expect(await f.page.evaluate(async () => { const { tabs, revision, ...scopes } = await window.marktex.getZoom(); return scopes; })).toEqual({ app: preferences.app, text: preferences.text, terminal: preferences.terminal });
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value})'))
      .toEqual({ draft: 'keep this', value: 42 });
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await firstTab.click();
    expect((await state()).factor).toBeCloseTo(1.1, 4);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toHaveAttribute('aria-selected', 'true');
    expect(await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === `${origin}/second`)!.getZoomFactor(), f.origin)).toBeCloseTo(1, 4);
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === 'https://www.google.com/')!.getZoomFactor())).toBeCloseTo(1, 4);
    await f.page.keyboard.press('Control+=');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.21, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await f.page.keyboard.press('Control+0');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await firstTab.click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.2, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('120%');
    expect(await evaluatePage(f.app, `${f.origin}/first`, 'document.querySelector("#draft").value')).toBe('keep this');
    await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await f.page.getByRole('button', { name: 'Zoom website out', exact: true }).click();
    await expect.poll(async () => (await state()).factor).toBeCloseTo(.9, 4);
    await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/first`, 'document.readyState')).toBe('complete');
    expect((await state()).factor).toBeCloseTo(1, 4);
    expect((await state()).id).toBe(original.id);
    await f.page.getByRole('tab', { name: /Second page/ }).click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

