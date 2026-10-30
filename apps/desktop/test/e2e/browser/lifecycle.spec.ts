import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

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
    const prompt = f.page.locator('dialog[aria-labelledby="close-prompt-title"]');
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

