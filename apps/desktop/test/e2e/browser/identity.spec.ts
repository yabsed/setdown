import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('websites see Chrome’s user agent; the sign-in host gets Firefox’s without disturbing extensions', async () => {
  // The sign-in host resolves to the fixture's own TLS server: its requests are seen as sent and none reaches Google.
  const f = await fixture(true, undefined, { secureHosts: ['accounts.google.com'] });
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const chrome = /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/;
    const scripted = await evaluatePage<string>(f.app, f.origin, 'navigator.userAgent');
    expect(scripted).toMatch(chrome);
    // The server and scripts see the same identity for documents, frames and subresources.
    for (const url of ['/first', '/frame', '/allowed.js']) {
      await expect.poll(() => f.headers.get(url)?.['user-agent']).toBe(scripted);
    }
    // The shell itself is not a website; libraries there may still recognize Electron.
    expect(await f.page.evaluate(() => navigator.userAgent)).toContain('Electron/');

    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill('https://accounts.google.com/signin'); await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Sign in/ })).toBeVisible();
    await expect.poll(() => evaluatePage(f.app, 'https://accounts.google.com', 'window.signInScript === true')).toBe(true);
    // The document and what it loads both go out as Firefox, which sends no client hints.
    for (const url of ['/signin', '/signin.js']) {
      const received = f.headers.get(url)!;
      expect(received.host).toBe('accounts.google.com');
      expect(received['user-agent']).toMatch(/^Mozilla\/5\.0 \([^)]+; rv:(\d{3})\.0\) Gecko\/20100101 Firefox\/\1\.0$/);
      expect(Object.keys(received).filter(name => name.startsWith('sec-ch-ua'))).toEqual([]);
    }
    // Every other host keeps the browser's own identity.
    await address.fill(`${f.origin}/second`); await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await expect.poll(() => f.headers.get('/second')?.['user-agent']).toBe(scripted);

    // The rule's carrier is not a user extension, and uBlock's request rules still apply beside it.
    const extensions = await f.page.evaluate(() => window.marktex.browser.extensions());
    expect(extensions.map(item => item.name)).toEqual(['uBlock Origin']);
    const id = await f.page.getByRole('tab', { name: /Second page/ }).getAttribute('data-tab-id');
    expect((await f.page.evaluate(tab => window.marktex.browser.extensionActions(tab), id!)).map(item => item.title)).toEqual([expect.stringContaining('uBlock')]);
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
    await f.app.evaluate(async ({ webContents }) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage' && wc.getURL().endsWith('/background.html'))!;
      await background.executeJavaScript(`(async()=>{const {default:u}=await import('./js/background.js');await u.saveSelectedFilterLists([u.userFiltersPath]);await u.saveUserFilters("*/blocked.js$script\\n");await u.loadFilterLists();return true;})()`);
    });
    f.requests.length = 0;
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/second`, '({ blocked: !!window.blockedScript, allowed: !!window.allowedScript })')).toEqual({ blocked: false, allowed: true });
    expect(f.requests).toContain('/allowed.js');
    expect(f.requests).not.toContain('/blocked.js');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('a web address on the command line opens as a web tab, and a second launch hands its address to the running window', async () => {
  const f = await fixture(false, undefined, { args: origin => [`${origin}/first`, '--not-an-address=https://ignored.example/'] });
  try {
    const first = f.page.getByRole('tab', { name: /Research page/ });
    await expect(first).toBeVisible(); await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    await expect.poll(() => evaluatePage<string>(f.app, `${f.origin}/first`, 'document.readyState')).toBe('complete');

    // What the desktop does for a link once Setdown is the default browser.
    await f.launchAgain(`${f.origin}/second`);
    const second = f.page.getByRole('tab', { name: /Second page/ });
    await expect(second).toBeVisible(); await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toBeVisible();
    expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(1);

    // Several addresses of one request: the last is shown. Anything that is not a web address is not opened as a page.
    await f.launchAgain(`${f.origin}/article`, 'javascript:alert(1)', 'https://user:secret@credentials.invalid/', `${f.origin}/icon-page`);
    const icon = f.page.getByRole('tab', { name: /Icon page/ });
    await expect(icon).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
    await expect(f.page.locator('.document-tab')).toHaveCount(4);
    // A desktop entry that takes addresses receives files as file: URLs; a document and an address of one request both open.
    await f.launchAgain(pathToFileURL(path.join(f.root, 'notes.md')).href, `${f.origin}/article-figure`);
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await expect(f.page.getByRole('tab', { name: /Figure article/ })).toBeVisible();
    await expect(f.page.locator('.document-tab')).toHaveCount(6);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('a web tab shows its site’s icon, and never another site’s', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/icon-page`);
    const tab = f.page.getByRole('tab', { name: /Icon page/ });
    await expect(tab).toBeVisible();
    const icon = tab.locator('img.tab-favicon');
    await expect(icon).toBeVisible();
    // The shell receives a small PNG re-encoded in the sandbox, not the website's bytes.
    expect(await icon.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await icon.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return { size: [image.naturalWidth, image.naturalHeight], pixel: [...context.getImageData(16, 16, 1, 1).data] };
    })).toEqual({ size: [32, 32], pixel: [192, 57, 43, 255] });
    const box = (await icon.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([16, 16]);
    // Document tabs have no site icon.
    await expect(f.page.getByRole('tab', { name: /notes.md/ }).locator('img')).toHaveCount(0);

    // The same site without a declared icon: the old one goes once the page's own lookup finds none.
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    const plain = f.page.getByRole('tab', { name: /Research page/ });
    await expect(plain).toBeVisible();
    await expect.poll(() => f.requests.includes('/favicon.ico')).toBe(true);
    await expect(plain.locator('img.tab-favicon')).toHaveCount(0);

    await address.fill(`${f.origin}/icon-page`); await address.press('Enter');
    await expect(tab.locator('img.tab-favicon')).toBeVisible();
    // Another site never wears this one's icon, not even while it loads.
    const other = f.origin.replace('127.0.0.1', 'localhost');
    await address.fill(`${other}/second`); await address.press('Enter');
    const second = f.page.getByRole('tab', { name: /Second page/ });
    await expect(second).toBeVisible();
    await expect(second.locator('img.tab-favicon')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Set as Default Browser changes the desktop’s handler only when asked and only for an installed entry', async () => {
  test.skip(process.platform !== 'linux', 'The desktop entry registration is the Linux path.');
  const entry = (root: string) => path.join(root, 'data', 'applications', 'setdown.desktop');
  const browser = '[Desktop Entry]\nType=Application\nName=Other Browser\nExec=/bin/true %U\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n';
  const defaults = '[Default Applications]\nx-scheme-handler/http=other-browser.desktop\nx-scheme-handler/https=other-browser.desktop\ntext/markdown=other-editor.desktop\n';
  // Without scheme handlers: what an installation from before this feature left behind.
  const desktopEntry = (web: boolean) => `[Desktop Entry]\nType=Application\nName=Setdown\nExec=${process.execPath} ${web ? '%U' : '%F'}\nTryExec=${process.execPath}\n`
    + `MimeType=text/markdown;${web ? 'x-scheme-handler/http;x-scheme-handler/https;' : ''}\n`;
  const f = await fixture(true, undefined, {
    env: root => ({ XDG_DATA_HOME: path.join(root, 'data'), XDG_DATA_DIRS: path.join(root, 'system-data') }),
    prepare: async root => {
      // A private desktop: Setdown's entry, another browser that is the current default, and nothing of the user's.
      for (const directory of [path.dirname(entry(root)), path.join(root, 'system-data', 'applications'), path.join(root, 'config')]) await mkdir(directory, { recursive: true });
      await writeFile(entry(root), desktopEntry(false));
      await writeFile(path.join(root, 'system-data', 'applications', 'other-browser.desktop'), browser);
      await writeFile(path.join(root, 'config', 'mimeapps.list'), defaults);
    },
  });
  try {
    const associations = () => readFile(path.join(f.root, 'config', 'mimeapps.list'), 'utf8').catch(() => '');
    const choose = (response: number) => f.app.evaluate(async ({ Menu, BrowserWindow, dialog }, response) => {
      const messages: Array<{ message: string; detail?: string; buttons?: string[] }> = [];
      const original = dialog.showMessageBox;
      dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
        messages.push({ message: options.message, detail: options.detail, buttons: options.buttons });
        return { response: options.buttons && options.buttons.length > 1 ? response : 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      const item = Menu.getApplicationMenu()!.getMenuItemById('menu-default-browser')!;
      if (item.label !== 'Set as Default Browser…') throw Error('Unexpected menu label');
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
      // The command is asynchronous; its last dialog ends it.
      const deadline = Date.now() + 15_000;
      let settled = 0;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const last = messages.at(-1);
        if (last && (last.buttons?.length ?? 1) === 1) break;
        if (last && response === 0 && ++settled > 3) break;
      }
      dialog.showMessageBox = original;
      return messages;
    }, response);

    expect(await choose(1)).toEqual([expect.objectContaining({ message: 'Setdown cannot be made the default browser yet.' })]);
    expect(await associations()).not.toContain('setdown.desktop');

    await writeFile(entry(f.root), desktopEntry(true));
    // Declining the question changes nothing.
    expect(await choose(0)).toEqual([expect.objectContaining({ message: 'Make Setdown your default browser?', buttons: ['Cancel', 'Make Default'],
      detail: expect.stringContaining('Current default: other-browser.desktop') })]);
    expect(await associations()).toBe(defaults);

    const accepted = await choose(1);
    expect(accepted.map(item => item.message)).toEqual(['Make Setdown your default browser?', 'Setdown is now your default browser.']);
    const list = await associations();
    expect(list).toContain('x-scheme-handler/http=setdown.desktop');
    expect(list).toContain('x-scheme-handler/https=setdown.desktop');
    // Only the two web schemes: no document type is taken over by this command.
    expect(list.split('\n').filter(line => line.includes('setdown.desktop'))).toHaveLength(2);
    expect(list).toContain('text/markdown=other-editor.desktop');
    expect(list).not.toContain('other-browser.desktop');
    expect(await choose(1)).toEqual([expect.objectContaining({ message: 'Setdown is your default browser.' })]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('location comes from the desktop’s own service on Linux', async () => {
  test.skip(process.platform !== 'linux', 'Windows and macOS use the system location provider by default.');
  const f = await fixture();
  try {
    expect(await f.app.evaluate(({ app }) => app.commandLine.getSwitchValue('enable-features')))
      .toContain('LocationProviderManager:LocationProviderManagerMode/PlatformOnly');
  } finally { await f.dispose(); }
});
