import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';
import { waylandInput } from '../../support/electron/wayland-input';

async function fullscreenFixture() {
  const compositor = process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? await waylandInput() : null;
  // Create the compositor's virtual keyboard before XWayland admits the app;
  // its first key otherwise changes the keymap during the tested Escape.
  await compositor?.send({ keyDown: ['Shift_L'], keyUp: ['Shift_L'] });
  const f = await fixture().catch(async error => { await compositor?.close(); throw error; });
  const dispose = f.dispose;
  return Object.assign(f, { input: compositor ? compositor.send : nativeInput,
    async dispose() { try { await dispose(); } finally { await compositor?.close(); } } });
}
type Fixture = Awaited<ReturnType<typeof fullscreenFixture>>;

async function splitPlayer(f: Fixture, sibling: 'markdown' | 'web') {
  await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/fullscreen`);
  const tab = f.page.getByRole('tab', { name: /Fullscreen player/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const data = await f.page.evaluateHandle(() => new DataTransfer());
  await tab.dispatchEvent('dragstart', { dataTransfer: data });
  const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
  const point = { dataTransfer: data, clientX: box.x + box.width * .02, clientY: box.y + box.height / 2 };
  await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  await expect(f.page.locator('.editor-group')).toHaveCount(2);
  if (sibling === 'web') {
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).last();
    await address.fill(`${f.origin}/second`); await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  }
  await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/fullscreen`, 'presentedFrames')).toBeGreaterThan(2);
}

async function nativeState(f: Fixture) {
  const owner = await f.app.browserWindow(f.page);
  try { return await owner.evaluate((owner: Electron.BrowserWindow) => ({ fullscreen: owner.isFullScreen(), size: owner.getContentSize(),
      views: owner.contentView.children.filter(view => 'webContents' in view && view.getVisible())
        .map(view => ({ id: (view as Electron.WebContentsView).webContents.id,
          url: (view as Electron.WebContentsView).webContents.getURL(), bounds: view.getBounds() })).sort((a, b) => a.id - b.id) }));
  } finally { await owner.dispose(); }
}

async function clickPlayer(f: Fixture, embedded = false) {
  await expect.poll(async () => (await nativeState(f)).views.filter(view => view.url.startsWith(`${f.origin}/fullscreen`)).length).toBe(1);
  const click = await f.app.evaluate(async ({ BrowserWindow }, { origin, embedded }) => {
    const owner = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!;
    const view = owner.contentView.children.find(view => 'webContents' in view
      && (view as Electron.WebContentsView).webContents.getURL().startsWith(`${origin}/fullscreen`)) as Electron.WebContentsView;
    const wc = view.webContents, frame = embedded ? wc.mainFrame.framesInSubtree.find(frame => frame.url.endsWith('/fullscreen'))! : wc.mainFrame;
    const point = await frame.executeJavaScript(`(() => { const b = document.querySelector('#toggle').getBoundingClientRect();
      return {x:b.x + b.width/2,y:b.y + b.height/2}; })()`) as { x: number; y: number };
    if (embedded) {
      const iframe = await wc.executeJavaScript(`(() => {const b=document.querySelector('iframe').getBoundingClientRect();return {x:b.x,y:b.y};})()`);
      point.x += iframe.x; point.y += iframe.y;
    }
    const root = owner.getContentBounds(), bounds = view.getBounds(), zoom = wc.getZoomFactor();
    return { x: root.x + bounds.x + point.x * zoom, y: root.y + bounds.y + point.y * zoom };
  }, { origin: f.origin, embedded });
  await f.input({ pointer: [click], resetPointer: true });
  // A compositor may still be animating a fullscreen resize after reporting
  // its final bounds. Wait for actual pointer hit-testing before pressing.
  await expect.poll(() => f.app.evaluate(({ webContents }, { origin, embedded }) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(`${origin}/fullscreen`))!;
    const frame = embedded ? wc.mainFrame.framesInSubtree.find(frame => frame.url.endsWith('/fullscreen'))! : wc.mainFrame;
    return frame.executeJavaScript('document.querySelector("#toggle").matches(":hover")');
  }, { origin: f.origin, embedded }), `native pointer reaches player at ${JSON.stringify(click)}`).toBe(true);
  await f.input({ button: 'down' }); await f.input({ button: 'up' });
}

async function expectFullscreen(f: Fixture) {
  await expect.poll(async () => {
    const state = await nativeState(f);
    return { fullscreen: state.fullscreen, bounds: state.views.map(view => ({ ...view.bounds,
      width: view.bounds.width - state.size[0], height: view.bounds.height - state.size[1] })) };
  }).toEqual({ fullscreen: true, bounds: [{ x: 0, y: 0, width: 0, height: 0 }] });
  if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') {
    const display = await f.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);
    await expect.poll(async () => (await nativeState(f)).size).toEqual([display.width, display.height]);
  }
  await expect.poll(() => evaluatePage(f.app, `${f.origin}/fullscreen`, '!!document.fullscreenElement')).toBe(true);
}

for (const sibling of ['markdown', 'web'] as const) test(`video fullscreen covers the window and restores the live ${sibling} split`, async () => {
  const f = await fullscreenFixture();
  try {
    await splitPlayer(f, sibling);
    await f.app.evaluate(({ webContents }) => {
      const trace: unknown[] = []; (globalThis as any).fullscreenInput = trace;
      for (const wc of webContents.getAllWebContents()) {
        wc.on('before-input-event', (_event, input) => { if (input.key === 'Escape') trace.push({ id: wc.id, url: wc.getURL(), input }); });
        wc.on('focus', () => { trace.push({ focus: wc.id, url: wc.getURL() }); });
        wc.on('enter-html-full-screen', () => { trace.push({ enter: wc.id }); });
        wc.on('leave-html-full-screen', () => { trace.push({ leave: wc.id }); });
      }
    });
    if (sibling === 'web') {
      await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).first().click();
    }
    await evaluatePage(f.app, `${f.origin}/fullscreen`, 'document.querySelector("#draft").value="retained draft"; true');
    await expect.poll(async () => (await nativeState(f)).views.length).toBe(2);
    const initial = await nativeState(f);
    for (const exit of ['escape', 'button', 'window'] as const) {
      await clickPlayer(f);
      await expectFullscreen(f);
      const before = await evaluatePage<number>(f.app, `${f.origin}/fullscreen`, 'presentedFrames');
      await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/fullscreen`, 'presentedFrames')).toBeGreaterThan(before + 5);
      const owner = await f.app.browserWindow(f.page);
      if (exit === 'escape') {
        const capture = await f.app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, compositor) => {
          const window = BrowserWindow.getAllWindows()[0];
          const display = screen.getPrimaryDisplay();
          const view = window.contentView.children.find(view => 'webContents' in view && view.getVisible()) as Electron.WebContentsView;
          // Xvfb captures native composition. Mutter's screen capture needs an
          // interactive portal; there capture the visible video after checking
          // that its native view and OS window both fill the private monitor.
          const image = compositor ? await view.webContents.capturePage() :
            (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size }))
              .find(source => source.display_id === String(display.id))!.thumbnail;
          const size = image.getSize(), data = image.toBitmap();
          const box = compositor ? { x: 0, y: 0, ...size } : window.getContentBounds();
          const pixels = [[box.x + 5, box.y + 5], [box.x + box.width - 6, box.y + 5],
            [box.x + 5, box.y + box.height - 6], [box.x + box.width - 6, box.y + box.height - 6]]
            .map(([x, y]) => [...data.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 3)]);
          return { png: image.toPNG().toString('base64'), pixels };
        }, process.env.SETDOWN_TEST_DISPLAY === 'xwayland');
        await writeFile(test.info().outputPath(`fullscreen-${sibling}.png`), Buffer.from(capture.png, 'base64'));
        for (const [b, g, r] of capture.pixels) {
          expect(Math.abs(b - 72)).toBeLessThan(4); expect(Math.abs(g - 134)).toBeLessThan(4); expect(Math.abs(r - 22)).toBeLessThan(4);
        }
        await f.input({ keys: ['Escape'] });
      } else if (exit === 'button') await clickPlayer(f);
      else await owner.evaluate(window => window.setFullScreen(false));
      await owner.dispose();
      await expect.poll(() => evaluatePage(f.app, `${f.origin}/fullscreen`, '!!document.fullscreenElement'), `${exit} exits HTML fullscreen`).toBe(false);
      await expect.poll(() => nativeState(f)).toEqual(initial);
      await expect(f.page.locator('.editor-group')).toHaveCount(2);
      await expect(f.page.getByRole('button', { name: 'Exit reader mode', exact: true })).toHaveCount(0);
      expect(await evaluatePage(f.app, `${f.origin}/fullscreen`, 'document.querySelector("#draft").value')).toBe('retained draft');
    }
    // Entering video from an already fullscreen app must keep that OS mode.
    const owner = await f.app.browserWindow(f.page);
    await owner.evaluate(window => window.setFullScreen(true));
    await expect.poll(() => owner.evaluate(window => window.isFullScreen())).toBe(true);
    if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') {
      const display = await f.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);
      await expect.poll(() => owner.evaluate(window => window.getContentSize())).toEqual([display.width, display.height]);
    }
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await clickPlayer(f); await expectFullscreen(f);
    await f.input({ keys: ['Escape'] });
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/fullscreen`, '!!document.fullscreenElement')).toBe(false);
    expect(await owner.evaluate(window => window.isFullScreen())).toBe(true);
    await expect.poll(async () => (await nativeState(f)).views.length).toBe(2);
    await owner.evaluate(window => window.setFullScreen(false)); await owner.dispose();
    expect(f.errors).toEqual([]);
  } finally {
    await writeFile(test.info().outputPath('fullscreen-input.json'), JSON.stringify(await f.app.evaluate(async ({ webContents }) => ({
      events: (globalThis as any).fullscreenInput, focused: webContents.getFocusedWebContents()?.getURL(),
      player: await webContents.getAllWebContents().find(wc => wc.getURL().endsWith('/fullscreen'))?.executeJavaScript(
        '({clicks:window.fullscreenClicks,error:window.fullscreenError,fullscreen:!!document.fullscreenElement})'),
    })), null, 2));
    await f.dispose();
  }
});

test('fullscreen releases presentation on navigation, tab commands, closing and renderer failure', async () => {
  test.setTimeout(90_000);
  const f = await fullscreenFixture();
  try {
    await splitPlayer(f, 'markdown');
    const tab = f.page.getByRole('tab', { name: /Fullscreen player/ });
    const key = (keyCode: string, modifiers: Array<'control' | 'shift'> = []) => f.app.evaluate(({ webContents }, { origin, keyCode, modifiers }) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/fullscreen`)!;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }, { origin: f.origin, keyCode, modifiers });
    const enter = async () => { await clickPlayer(f); await expectFullscreen(f); };
    await enter(); await key('l', ['control']);
    await expect(f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first()).toBeFocused();
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/fullscreen`, '!!document.fullscreenElement')).toBe(false);
    await expect.poll(async () => (await nativeState(f)).fullscreen).toBe(false);
    await f.page.keyboard.press('Escape');
    await enter();
    await evaluatePage(f.app, `${f.origin}/fullscreen`, 'location.href="/first"; true');
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect.poll(async () => (await nativeState(f)).fullscreen).toBe(false);
    await expect.poll(async () => (await nativeState(f)).views.length).toBe(2);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first();
    await address.fill(`${f.origin}/fullscreen`); await address.press('Enter');
    await expect(tab).toBeVisible(); await enter();
    const renderer = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === `${origin}/fullscreen`)!.getOSProcessId(), f.origin);
    expect(renderer).toBeGreaterThan(0);
    process.kill(renderer, 'SIGKILL');
    await expect.poll(async () => (await nativeState(f)).fullscreen).toBe(false);
    await expect(f.page.getByRole('button', { name: 'Reload page', exact: true }).first()).toBeVisible();
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).first().click();
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/fullscreen`, 'presentedFrames')).toBeGreaterThan(2);
    await enter(); await key('w', ['control']);
    await expect(tab).toHaveCount(0);
    await expect.poll(async () => (await nativeState(f)).fullscreen).toBe(false);
    await expect(f.page.locator('.editor-group')).toHaveCount(1);
    await expect.poll(async () => (await nativeState(f)).views.map(view => view.url.startsWith('marktex-preview:'))).toEqual([true]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('embedded cross-origin players respect Chromium fullscreen policy and Escape', async () => {
  const f = await fullscreenFixture();
  try {
    for (const allowed of [false, true]) {
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/fullscreen-embed${allowed ? '' : '-denied'}`);
      await expect(f.page.getByRole('tab', { name: /Embedded player/ }).last()).toHaveAttribute('aria-selected', 'true');
      const frameState = () => f.app.evaluate(async ({ webContents }, origin) => {
        const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(`${origin}/fullscreen-embed`));
        return await wc?.mainFrame.framesInSubtree.find(frame => frame.url.endsWith('/fullscreen'))
          ?.executeJavaScript('({ fullscreen: !!document.fullscreenElement, error: window.fullscreenError, frames: window.presentedFrames })') as
          { fullscreen: boolean; error: string; frames: number } | undefined;
      }, f.origin);
      await expect.poll(async () => (await frameState())?.frames ?? 0).toBeGreaterThan(2);
      await clickPlayer(f, true);
      if (allowed) {
        await expectFullscreen(f);
        await f.input({ keys: ['Escape'] });
        await expect.poll(async () => (await frameState())?.fullscreen).toBe(false);
      } else {
        await expect.poll(async () => (await frameState())?.error).toBe('TypeError');
        expect((await nativeState(f)).fullscreen).toBe(false);
      }
      await f.page.getByRole('tab', { name: /Embedded player/ }).last().getByTitle('Close tab', { exact: true }).click();
    }
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
