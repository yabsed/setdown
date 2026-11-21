import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { fixture, evaluatePage, closePromptLayer } from '../../support/browser/browser-fixture';

test('browser details: hidden pages retain forms, mute remains accessible and closed tabs reopen without stale forms', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    // Playwright enables focus emulation on every attached page, which forces
    // document.visibilityState to "visible". Observe actual Blink visibility.
    const target = f.app.context().pages().find(page => page.url().startsWith(f.origin))!;
    // This must be the session that enabled the emulation: a new CDP session
    // cannot release another session's capturer. Confine Playwright's internal
    // adapter to this test; an API change fails here instead of faking visibility.
    const implementation = (target as any)._connection.toImpl(target);
    await implementation.delegate._mainFrameSession._client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const id = await web.getAttribute('data-tab-id');
    const identity = await evaluatePage(f.app, f.origin, `window.pageIdentity=crypto.randomUUID();document.querySelector('#draft').value='Keep my draft';pageIdentity`);
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.visibilityState')).toBe('hidden');
    await web.click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.visibilityState')).toBe('visible');
    expect(await evaluatePage(f.app, f.origin, `({id:pageIdentity,draft:document.querySelector('#draft').value})`)).toEqual({ id: identity, draft: 'Keep my draft' });
    await f.page.evaluate(id => window.marktex.browser.command(id!, 'mute'), id);
    await expect(web.getByRole('button', { name: 'Unmute tab' })).toBeVisible();
    await web.getByRole('button', { name: 'Unmute tab' }).click();
    await expect(web.getByRole('button', { name: 'Unmute tab' })).toHaveCount(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reload-no-cache'));
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.pageIdentity')).toBeUndefined();
    await expect(web).toHaveAttribute('data-tab-id', id!); await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await web.locator('.tab-close').click(); await expect(web).toHaveCount(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reopen-web'));
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(await web.getAttribute('data-tab-id')).not.toBe(id);
    expect(await evaluatePage(f.app, f.origin, `document.querySelector('#draft').value`)).toBe('');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: cancelling native beforeunload preserves the form and does not add a closed tab', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    // Electron's will-prevent-unload handler answers this dialog. Prevent
    // Playwright's automatic dismissal from racing that native answer.
    f.app.context().pages().find(page => page.url().startsWith(f.origin))!.on('dialog', () => {});
    const id = await web.getAttribute('data-tab-id');
    await f.app.evaluate(async ({ webContents, dialog }, origin) => {
      dialog.showMessageBoxSync = () => 0;
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript(`document.querySelector('#draft').value='unsaved form';window.onbeforeunload=()=>false;true`, true);
    }, f.origin);
    expect(await f.page.evaluate(id => window.marktex.browser.close(id!, true), id)).toBe(false);
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(await evaluatePage(f.app, f.origin, `document.querySelector('#draft').value`)).toBe('unsaved form');
    await f.page.evaluate(() => window.marktex.browser.reopen()); await expect(web).toHaveCount(1);
    await f.app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    expect(await f.page.evaluate(id => window.marktex.browser.close(id!, true), id)).toBe(true);
    await expect(web).toHaveCount(0); await f.page.evaluate(() => window.marktex.browser.reopen());
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('closing a window with audible web contents releases pages without main-process exceptions', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const id = await f.app.evaluate(async ({ webContents, BrowserWindow, dialog }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript(`(() => {
        const audio = window.testAudio = new AudioContext();
        const oscillator = audio.createOscillator(); oscillator.connect(audio.destination); oscillator.start();
        return audio.resume();
      })()`, true);
      // Keep the process inspectable after the real workspace closes. The
      // observer is not a workspace and cannot retain any of its browser tabs.
      (globalThis as any).__closeObserver = new BrowserWindow({ show: false });
      (globalThis as any).__closeErrors = [];
      process.on('uncaughtExceptionMonitor', error => (globalThis as any).__closeErrors.push(String(error)));
      dialog.showErrorBox = (title, content) => { (globalThis as any).__closeErrors.push(`${title}: ${content}`); };
      return wc.id;
    }, f.origin);
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isCurrentlyAudible(), id)).toBe(true);
    await f.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.close();
    });
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, id)).toBe(true);
    expect(await f.app.evaluate(() => (globalThis as any).__closeErrors)).toEqual([]);
  } finally { await f.dispose(); }
});

for (const command of ['close', 'quit'] as const) test(`canceling ${command} preserves audible pages, confirmed exit releases them`, async () => {
  const f = await fixture();
  let stderr = '';
  f.app.process().stderr?.on('data', data => { stderr += String(data); });
  try {
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially(' unsaved');
    await expect(f.page.locator('.tab-dirty')).toHaveCount(1);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const id = await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      (globalThis as any).__audioConsole = [];
      wc.on('console-message', (_event, ...details) => (globalThis as any).__audioConsole.push(details));
      await wc.executeJavaScript(`(() => {
        const audio = window.testAudio = new AudioContext();
        const tone = audio.createOscillator(); tone.connect(audio.destination); tone.start(); return audio.resume();
      })()`, true);
      return wc.id;
    }, f.origin);
    const audible = () => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isCurrentlyAudible() ?? false, id);
    try { await expect.poll(audible).toBe(true); }
    catch (error) {
      await writeFile(test.info().outputPath('audio-diagnostics.json'), JSON.stringify({ stderr,
        native: await f.app.evaluate(({ webContents }, id) => {
          const wc = webContents.fromId(id);
          return { alive: !!wc, audible: wc?.isCurrentlyAudible(), muted: wc?.isAudioMuted(), console: (globalThis as any).__audioConsole };
        }, id),
        context: await evaluatePage(f.app, f.origin, '({state:testAudio.state,time:testAudio.currentTime,baseLatency:testAudio.baseLatency,outputLatency:testAudio.outputLatency})'),
      }, null, 2));
      throw error;
    }
    const close = () => f.app.evaluate(({ app, BrowserWindow }, command) => {
      if (command === 'quit') app.quit(); else BrowserWindow.getAllWindows()[0].close();
    }, command);
    await close();
    // A web page is showing, so the question is asked in the layer above it.
    const prompt = (await closePromptLayer(f.app)).locator('dialog[aria-labelledby="close-prompt-title"]');
    await expect(prompt).toBeVisible();
    await prompt.locator('.close-cancel').click();
    await expect(prompt).toBeHidden();
    await expect.poll(audible).toBe(true);
    expect(await evaluatePage(f.app, f.origin, 'window.testAudio.state')).toBe('running');
    await close(); await expect(prompt).toBeVisible();
    const exited = f.app.waitForEvent('close');
    await prompt.locator('.close-discard').click();
    await exited;
    expect(stderr).not.toMatch(/Uncaught Exception|Cannot read properties of undefined|Object has been destroyed/);
  } finally { await f.dispose(); }
});

test('the close prompt is asked above a live web page, which stays shown and keeps drawing', async () => {
  const f = await fixture();
  try {
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially(' unsaved');
    await expect(f.page.locator('.tab-dirty')).toHaveCount(1);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toHaveAttribute('aria-selected', 'true');
    // Observe Blink's own visibility, not the one Playwright's focus emulation reports (see the first test).
    const target = f.app.context().pages().find(page => page.url().startsWith(f.origin))!;
    const implementation = (target as any)._connection.toImpl(target);
    await implementation.delegate._mainFrameSession._client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    // A page that plays draws frame after frame. Count them.
    await evaluatePage(f.app, f.origin, `(function tick() { window.framesDrawn = (window.framesDrawn ?? 0) + 1; requestAnimationFrame(tick); })(); true`);
    const frames = () => evaluatePage<number>(f.app, f.origin, 'window.framesDrawn');
    const native = () => f.app.evaluate(({ BrowserWindow, webContents }, origin) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!;
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === `${origin}/first`)!;
      const children = window.contentView.children as Electron.WebContentsView[];
      const view = children.find(child => child.webContents === page), layer = children.find(child => child.webContents?.getURL().includes('close-prompt-overlay=1'));
      return { page: !!view && view.getVisible(), layer: !!layer && layer.getVisible(), layerAbove: !!view && !!layer && children.indexOf(layer) > children.indexOf(view),
        covers: !!layer && JSON.stringify(layer.getBounds()) === JSON.stringify({ x: 0, y: 0, width: window.getContentSize()[0], height: window.getContentSize()[1] }) };
    }, f.origin);
    expect(await native()).toMatchObject({ page: true, layer: false });
    const close = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.close());
    await close();
    const layer = await closePromptLayer(f.app), prompt = layer.locator('dialog[aria-labelledby="close-prompt-title"]');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Save changes to notes.md?');
    await expect(prompt.locator('.close-save')).toBeFocused();
    // The page was not hidden and no picture stands in its place; the shell shows no dialog of its own.
    expect(await native()).toEqual({ page: true, layer: true, layerAbove: true, covers: true });
    await expect(f.page.locator('dialog[aria-labelledby="close-prompt-title"]')).toBeHidden();
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'document.visibilityState')).toBe('visible');
    const before = await frames();
    await expect.poll(async () => await frames() - before).toBeGreaterThan(30);
    // The layer is see-through outside the dialog: the page shows through, dimmed.
    expect(await layer.evaluate(() => [document.documentElement, document.body].map(element => getComputedStyle(element).backgroundColor))).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    // Escape cancels, the layer goes away, and nothing was closed.
    await layer.keyboard.press('Escape');
    await expect(prompt).toBeHidden();
    await expect.poll(native).toEqual({ page: true, layer: false, layerAbove: false, covers: false });
    await expect(web).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.locator('.tab-dirty')).toHaveCount(1);
    // Asked again, "Don't Save" closes the window.
    await close();
    await expect(prompt).toBeVisible();
    const exited = f.app.waitForEvent('close');
    await prompt.locator('.close-discard').click();
    await exited;
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
