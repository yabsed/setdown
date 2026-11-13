import { expect, test, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixture, captureNativeMenus, chooseNativeMenu, pageContextMenu } from '../../support/browser/browser-fixture';

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** The visible web tab's own page, driven with real (trusted) input. Another tab may show the same address. */
async function webPage(f: Fixture, url: string): Promise<Page> {
  let found: Page | undefined;
  await expect.poll(async () => {
    for (const page of f.app.context().pages().filter(page => page.url() === url).reverse()) {
      if (await page.evaluate(() => document.visibilityState === 'visible' && document.readyState === 'complete').catch(() => false)) { found = page; return true; }
    }
    return false;
  }).toBe(true);
  return found!;
}
let opened = 0;
/** Opens the form in a new tab under an address no other tab has. */
async function openForm(f: Fixture, origin: string, route = '/login'): Promise<Page> {
  const url = `${origin}${route}?tab=${++opened}`;
  await f.page.evaluate(url => window.marktex.openLink(url), url);
  return webPage(f, url);
}
async function signIn(f: Fixture, origin: string, username: string, password: string, route = '/login') {
  const page = await openForm(f, origin, route);
  await page.locator('#user').fill(username); await page.locator('#pass').fill(password);
  await page.locator('#go').click();
  await page.waitForURL(`${origin}/welcome`);
  return page;
}
const saved = (f: Fixture) => f.page.evaluate(() => window.marktex.browser.passwords());

test('a submitted login is offered for saving, kept per exact origin, and filled only when the user picks it', async () => {
  test.setTimeout(120_000);
  const f = await fixture(false);
  try {
    await captureNativeMenus(f.app);
    const origin = f.origin, other = origin.replace('127.0.0.1', 'localhost');
    await signIn(f, origin, 'ann', 'first-secret');
    // The offer survives the navigation that a sign-in causes, and saves nothing by itself.
    const offer = f.page.getByRole('button', { name: 'Save password for ann', exact: true });
    await expect(offer).toBeVisible();
    expect((await saved(f)).entries).toEqual([]);
    await offer.click();
    await chooseNativeMenu(f.app, ['Save Password']);
    await expect(offer).toHaveCount(0);
    const list = await saved(f);
    expect(list.entries.map(({ origin, username }) => ({ origin, username }))).toEqual([{ origin, username: 'ann' }]);
    // A list never carries a password.
    expect(JSON.stringify(list)).not.toContain('first-secret');
    const id = list.entries[0].id;
    expect(await f.page.evaluate(id => window.marktex.browser.revealPassword(id), id)).toBe('first-secret');

    // Back on the form: the key appears, and nothing is in the fields until the user chooses.
    const login = await openForm(f, origin);
    const key = f.page.getByRole('button', { name: 'Fill a saved password', exact: true });
    await expect(key).toBeVisible();
    await expect(key).toHaveAttribute('title', /1 saved password fits this page/);
    expect(await login.evaluate(() => [(document.querySelector('#user') as HTMLInputElement).value, (document.querySelector('#pass') as HTMLInputElement).value])).toEqual(['', '']);
    await key.click();
    await chooseNativeMenu(f.app, ['Fill Password: ann']);
    await expect.poll(() => login.evaluate(() => [(document.querySelector('#user') as HTMLInputElement).value, (document.querySelector('#pass') as HTMLInputElement).value,
      (document.querySelector('#search') as HTMLInputElement).value])).toEqual(['ann', 'first-secret', '']);
    // The page's own handlers saw the change, as with typed input.
    expect(await login.evaluate(() => (window as unknown as { filled: string[] }).filled)).toEqual(['user', 'pass']);

    // Right-click in a field offers the same login for that field's frame.
    await login.evaluate(() => { for (const id of ['user', 'pass']) (document.getElementById(id) as HTMLInputElement).value = ''; });
    await pageContextMenu(f.app, origin, '#pass');
    await chooseNativeMenu(f.app, ['Fill Password: ann']);
    await expect.poll(() => login.evaluate(() => (document.querySelector('#pass') as HTMLInputElement).value)).toBe('first-secret');

    // Submitting what is already saved asks nothing. A "Show" toggle is not a submission.
    await login.locator('#show').click();
    await login.locator('#go').click(); await login.waitForURL(`${origin}/welcome`);
    await expect(f.page.getByRole('button', { name: /Save password/ })).toHaveCount(0);

    // A changed password is offered as an update of the same login.
    await signIn(f, origin, 'ann', 'second-secret');
    await f.page.getByRole('button', { name: 'Save password for ann', exact: true }).click();
    await chooseNativeMenu(f.app, ['Update Password']);
    await expect.poll(async () => (await saved(f)).entries.length).toBe(1);
    expect(await f.page.evaluate(id => window.marktex.browser.revealPassword(id), id)).toBe('second-secret');

    // Another origin on the same machine is another site: nothing to fill, and it can be declined for good.
    await openForm(f, other);
    await expect(f.page.getByRole('tab', { name: /Sign in/ }).last()).toHaveAttribute('aria-selected', 'true');
    await expect(key).toHaveCount(0);
    await signIn(f, other, 'bob', 'other-secret');
    await f.page.getByRole('button', { name: 'Save password for bob', exact: true }).click();
    await chooseNativeMenu(f.app, ['Never for This Site']);
    await expect.poll(async () => (await saved(f)).neverSave).toEqual([other]);
    await signIn(f, other, 'bob', 'other-secret');
    await expect(f.page.getByRole('button', { name: /Save password/ })).toHaveCount(0);
    expect((await saved(f)).entries.map(entry => entry.username)).toEqual(['ann']);

    // A sign-up form saves the new password.
    await signIn(f, origin, 'carol', 'new-secret', '/signup');
    await f.page.getByRole('button', { name: 'Save password for carol', exact: true }).click();
    await chooseNativeMenu(f.app, ['Not Now']);
    await expect(f.page.getByRole('button', { name: /Save password/ })).toHaveCount(0);
    expect((await saved(f)).entries.map(entry => entry.username)).toEqual(['ann']);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('saved passwords are managed in the Browser side view and move through a CSV file', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(() => window.marktex.browser.addPassword({ url: 'example.com/login', username: 'ann', password: 'p,w "1"' }));
    await f.page.evaluate(() => window.marktex.browser.addPassword({ url: 'http://localhost:3000', username: '', password: 'local' }));
    await expect(f.page.evaluate(() => window.marktex.browser.addPassword({ url: 'http://example.com', username: 'ann', password: 'x' }))).rejects.toThrow('HTTPS address');
    await expect(f.page.evaluate(() => window.marktex.browser.revealPassword('not-an-id'))).rejects.toThrow('Unknown password');

    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Passwords', exact: true }).click();
    const row = f.page.getByRole('group', { name: 'ann on https://example.com' });
    await expect(row).toBeVisible();
    await expect(f.page.locator('.passwords')).not.toContainText('p,w');
    await row.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(row.locator('code')).toHaveText('p,w "1"');
    await row.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(row.locator('code')).toHaveCount(0);
    await f.page.getByLabel('Search passwords').fill('localhost');
    await expect(row).toHaveCount(0);
    await expect(f.page.getByRole('group', { name: 'No user name on http://localhost:3000' })).toBeVisible();
    await f.page.getByLabel('Search passwords').fill('');

    // Export asks first (the file is plain text) and writes it for the owner only.
    const file = path.join(f.root, 'passwords.csv');
    await f.app.evaluate(({ dialog }, file) => {
      (globalThis as { asked?: string[] }).asked = [];
      dialog.showMessageBox = (async (_owner: unknown, options: Electron.MessageBoxOptions) => { (globalThis as { asked?: string[] }).asked!.push(options.message); return { response: options.buttons!.indexOf(options.message.startsWith('Export') ? 'Export' : 'Import'), checkboxChecked: false }; }) as typeof dialog.showMessageBox;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, file);
    await f.page.getByRole('button', { name: 'Export passwords…', exact: true }).click();
    await expect(f.page.locator('.passwords [role="status"]')).toContainText('Exported 2 passwords');
    const csv = await readFile(file, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('name,url,username,password,note');
    expect(csv).toContain('example.com,https://example.com/,ann,"p,w ""1""",');
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    // Remove one, change the other, then import the file: the missing login returns and the changed one is replaced.
    await row.getByRole('button', { name: 'Remove password', exact: true }).click();
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(row).toHaveCount(0);
    await f.page.evaluate(() => window.marktex.browser.addPassword({ url: 'http://localhost:3000', username: '', password: 'changed' }));
    await f.page.getByRole('button', { name: 'Import passwords…', exact: true }).click();
    await expect(f.page.locator('.passwords [role="status"]')).toHaveText('Imported 1 new and updated 1; skipped 0.');
    expect(await f.app.evaluate(() => (globalThis as { asked?: string[] }).asked)).toEqual(['Export 2 passwords as plain text?', 'Import 2 passwords?']);
    await expect(row).toBeVisible();
    const entries = (await saved(f)).entries;
    expect(await Promise.all(entries.map(entry => f.page.evaluate(id => window.marktex.browser.revealPassword(id), entry.id)))).toEqual(['local', 'p,w "1"']);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
