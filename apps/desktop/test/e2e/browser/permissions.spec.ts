import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { fixture, evaluatePage, captureNativeMenus, chooseNativeMenu } from '../../support/browser/browser-fixture';
import type { TestApplication } from '../../support/electron/electron-app';

/** Run a script in the frame of a page whose address starts with `frame`. `gesture` stands in for the user's click. */
async function evaluateFrame<T>(app: TestApplication, top: string, frame: string, script: string, gesture = false): Promise<T> {
  return app.evaluate(async ({ webContents }, { top, frame, script, gesture }) => {
    const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(top) && wc.getType() !== 'backgroundPage');
    const target = page?.mainFrame.framesInSubtree.find(item => item.url.startsWith(frame));
    if (!target) throw Error('Frame not found');
    return target.executeJavaScript(script, gesture) as Promise<T>;
  }, { top, frame, script, gesture });
}
const store = async (app: TestApplication) => path.join(await app.evaluate(({ app }) => app.getPath('userData')), 'browser-site-permissions.json');
const remembered = async (app: TestApplication) => JSON.parse(await readFile(await store(app), 'utf8')) as { version: number; sites: Record<string, Record<string, string>> };

test('a remembered answer holds for the site across documents, tabs and restarts until it is reset', async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    const review = () => f.page.getByRole('button', { name: 'Review permissions: Notifications', exact: true });
    const ask = 'Notification.requestPermission().then(result => { window.permissionResult = result; }); true';
    const result = (url: string) => evaluatePage<string | undefined>(f.app, url, 'window.permissionResult');
    const first = `${f.origin}/first`, second = `${f.origin}/second`, article = `${f.origin}/article`;
    const reloaded = async (url: string, reload: () => Promise<unknown>) => {
      await evaluatePage(f.app, url, 'window.beforeReload = true');
      await reload();
      await expect.poll(() => evaluatePage(f.app, url, 'document.readyState === "complete" && !window.beforeReload')).toBe(true);
    };

    await f.page.evaluate(url => window.marktex.openLink(url), first);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, first, ask);
    await review().click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Always Allow on This Site']);
    await expect.poll(() => result(first)).toBe('granted');
    expect(await remembered(f.app)).toEqual({ version: 1, sites: { [f.origin]: { notifications: 'allow' } } });
    expect((await stat(await store(f.app))).mode & 0o777).toBe(0o600);

    // A new document of the site is not asked again.
    await reloaded(first, () => f.page.getByRole('button', { name: 'Reload page', exact: true }).click());
    expect(await evaluatePage(f.app, first, 'Notification.permission')).toBe('granted');
    await evaluatePage(f.app, first, ask);
    await expect.poll(() => result(first)).toBe('granted');
    await expect(review()).toHaveCount(0);
    // Nor is another tab of the site.
    await f.page.evaluate(url => window.marktex.openLink(url), second);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await evaluatePage(f.app, second, ask);
    await expect.poll(() => result(second)).toBe('granted');
    await expect(review()).toHaveCount(0);

    await f.restart();
    await f.page.evaluate(url => window.marktex.openLink(url), article);
    await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
    await evaluatePage(f.app, article, ask);
    await expect.poll(() => result(article)).toBe('granted');
    await expect(review()).toHaveCount(0);

    // Resetting the site forgets the standing answer: the site asks again.
    await reloaded(article, async () => {
      await f.page.getByRole('button', { name: 'Site controls', exact: true }).click();
      await chooseNativeMenu(f.app, ['Reset Site Permissions']);
    });
    expect((await remembered(f.app)).sites).toEqual({});
    await evaluatePage(f.app, article, ask);
    await expect(review()).toBeVisible();
    expect(await result(article)).toBeUndefined();
    await review().click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Always Block on This Site']);
    await expect.poll(() => result(article)).toBe('denied');
    expect((await remembered(f.app)).sites).toEqual({ [f.origin]: { notifications: 'deny' } });
    // A standing block answers later documents without showing a request.
    await reloaded(article, () => f.page.getByRole('button', { name: 'Reload page', exact: true }).click());
    await evaluatePage(f.app, article, ask);
    await expect.poll(() => result(article)).toBe('denied');
    await expect(review()).toHaveCount(0);

    // Clearing site settings forgets every site's answers.
    await reloaded(article, () => f.page.evaluate(() => window.marktex.browser.clearData(['site-settings'])));
    expect((await remembered(f.app)).sites).toEqual({});
    await evaluatePage(f.app, article, ask);
    await expect(review()).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('an embedded site asks under both names, and location and clipboard reading are asked like camera and microphone', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    const embedded = f.origin.replace('127.0.0.1', 'localhost');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/embed`);
    await expect(f.page.getByRole('tab', { name: /Embedding page/ })).toBeVisible();
    await expect.poll(() => evaluateFrame<string>(f.app, f.origin, embedded, 'document.readyState').catch(() => 'missing')).toBe('complete');
    // A fixed position set before anything asks: the page is answered from it, and no location service is consulted.
    await f.app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin) && wc.getType() !== 'backgroundPage')!;
      page.debugger.attach('1.3');
      await page.debugger.sendCommand('Emulation.setGeolocationOverride', { latitude: 37.5, longitude: 127, accuracy: 10 });
    }, f.origin);
    const locate = `navigator.geolocation.getCurrentPosition(position => { window.position = [position.coords.latitude, position.coords.longitude]; },
      error => { window.position = 'error ' + error.code; }); true`;
    const location = f.page.getByRole('button', { name: 'Review permissions: Location', exact: true });

    await evaluateFrame(f.app, f.origin, embedded, locate);
    await expect(location).toBeVisible();
    expect(await evaluateFrame(f.app, f.origin, embedded, 'window.position ?? null')).toBeNull();
    await location.click();
    await chooseNativeMenu(f.app, [`Location · ${embedded} in ${f.origin}`, 'Always Allow on This Site']);
    await expect.poll(() => evaluateFrame(f.app, f.origin, embedded, 'window.position')).toEqual([37.5, 127]);
    // Remembered for that site inside this page only.
    expect((await remembered(f.app)).sites).toEqual({ [`${embedded} ${f.origin}`]: { geolocation: 'allow' } });

    // The embedded site's answer is not the page's own.
    await evaluatePage(f.app, f.origin, locate);
    await expect(location).toBeVisible();
    await location.click();
    await chooseNativeMenu(f.app, [`Location · ${f.origin}`, 'Deny']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.position')).toBe('error 1');
    expect((await remembered(f.app)).sites).toEqual({ [`${embedded} ${f.origin}`]: { geolocation: 'allow' } });

    // Clipboard reading used to be refused outright.
    await f.app.evaluate(({ clipboard, webContents }, origin) => {
      clipboard.writeText('from the clipboard');
      webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin) && wc.getType() !== 'backgroundPage')!.focus();
    }, f.origin);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.hasFocus()')).toBe(true);
    await evaluateFrame(f.app, f.origin, f.origin, `navigator.clipboard.readText().then(text => { window.clip = text; }, error => { window.clip = 'error ' + error.name; }); true`, true);
    const clipboard = f.page.getByRole('button', { name: 'Review permissions: Clipboard', exact: true });
    await expect(clipboard).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'window.clip')).toBeUndefined();
    await clipboard.click();
    await chooseNativeMenu(f.app, [`Clipboard · ${f.origin}`, 'Allow for This Page']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.clip')).toBe('from the clipboard');
    expect(await evaluatePage(f.app, f.origin, 'navigator.permissions.query({ name: "clipboard-read" }).then(status => status.state)')).toBe('granted');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('screen sharing is asked every time and shares only the screen or window the user picks', async () => {
  test.skip(process.platform !== 'linux' || process.env.SETDOWN_TEST_DISPLAY === 'wayland' || process.env.SETDOWN_TEST_DISPLAY === 'xwayland',
    'A Wayland desktop shows its own picker; this covers Setdown’s list.');
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const screen = await f.app.evaluate(async ({ desktopCapturer }) => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }))[0].name);
    const review = f.page.getByRole('button', { name: 'Review permissions: Screen Sharing', exact: true });
    const request = `window.share = undefined; navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
      window.shared = stream; window.share = stream.getVideoTracks().map(track => track.readyState).join(); }, error => { window.share = error.name; }); true`;
    const share = () => evaluateFrame(f.app, f.origin, f.origin, request, true);
    const outcome = () => evaluatePage<string | undefined>(f.app, f.origin, 'window.share');
    const permission = `Screen Sharing · ${f.origin}`;

    // The page's click alone shares nothing and opens nothing.
    await share();
    await expect(review).toBeVisible();
    expect(await outcome()).toBeUndefined();
    await review.click();
    await chooseNativeMenu(f.app, [permission, 'Deny']);
    await expect.poll(outcome).toBe('NotAllowedError');

    // A refusal ended that request only. Allowing is for one request, and the user then picks what to share.
    await share();
    await expect(review).toBeVisible();
    await review.click();
    const overlay = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
    await overlay.getByRole('menuitem', { name: permission, exact: true }).click();
    await expect(overlay.getByRole('menuitem', { name: 'Always Allow on This Site', exact: true })).toHaveCount(0);
    await expect(overlay.getByRole('menuitem', { name: 'Allow for This Page', exact: true })).toHaveCount(0);
    await overlay.getByRole('menuitem', { name: 'Allow Once', exact: true }).click();
    await expect(overlay.getByRole('menuitem', { name: `Share with ${f.origin}`, exact: true })).toBeDisabled();
    expect(await outcome()).toBeUndefined();
    await chooseNativeMenu(f.app, [screen]);
    await expect.poll(outcome).toBe('live');
    expect(await evaluatePage(f.app, f.origin, 'window.shared.getAudioTracks().length')).toBe(0);
    await evaluatePage(f.app, f.origin, 'window.shared.getTracks().forEach(track => track.stop()); true');

    // The allowance was for that request: the next one asks again, and closing the list shares nothing.
    await share();
    await expect(review).toBeVisible();
    expect(await outcome()).toBeUndefined();
    await review.click();
    await chooseNativeMenu(f.app, [permission, 'Allow Once']);
    await chooseNativeMenu(f.app, ['Don’t Share']);
    // Electron reports a declined list as an aborted request, not as a refused permission.
    await expect.poll(outcome).toBe('AbortError');

    // The old whole-screen constraint has no list of its own, so it too waits for the user and never rides on an earlier answer.
    await evaluatePage(f.app, f.origin, `window.legacy = undefined; navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } })
      .then(stream => { stream.getTracks().forEach(track => track.stop()); window.legacy = 'captured'; }, error => { window.legacy = error.name; }); true`);
    await expect(review).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'window.legacy')).toBeUndefined();
    await review.click();
    await chooseNativeMenu(f.app, [permission, 'Always Block on This Site']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.legacy')).toBe('NotAllowedError');
    expect((await remembered(f.app)).sites).toEqual({ [f.origin]: { 'display-capture': 'deny' } });
    // A standing block answers without a request.
    await share();
    await expect.poll(outcome).toBe('NotAllowedError');
    await expect(review).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
