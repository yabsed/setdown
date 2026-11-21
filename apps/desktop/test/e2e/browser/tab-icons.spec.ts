import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication } from '../../support/electron/electron-app';
import { launchPlain } from '../../support/electron/plain-app';
import { pngFixture } from '../../support/media/png-fixture';
import { pdfFixture } from '../../support/media/pdf-fixture';

/** A square of one colour in the classic icon format; sites serve it or a PNG. */
function ico(size: number, [red, green, blue]: number[]): Buffer {
  const pixels = Buffer.alloc(size * size * 4, Buffer.from([blue, green, red, 255])), mask = Buffer.alloc(size * Math.ceil(size / 32) * 4);
  const bitmap = Buffer.alloc(40);
  bitmap.writeUInt32LE(40, 0); bitmap.writeInt32LE(size, 4); bitmap.writeInt32LE(size * 2, 8); bitmap.writeUInt16LE(1, 12); bitmap.writeUInt16LE(32, 14);
  bitmap.writeUInt32LE(pixels.length + mask.length, 20);
  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(1, 4); directory[6] = size; directory[7] = size;
  directory.writeUInt16LE(1, 10); directory.writeUInt16LE(32, 12); directory.writeUInt32LE(40 + pixels.length + mask.length, 14); directory.writeUInt32LE(22, 18);
  return Buffer.concat([directory, bitmap, pixels, mask]);
}
const ICONS = { ico: { type: 'image/x-icon', colour: [39, 174, 96], bytes: ico(16, [39, 174, 96]) }, png: { type: 'image/png', colour: [41, 128, 185], bytes: pngFixture(48, 48, [41, 128, 185]) } };

async function site() {
  const held: ServerResponse[] = [];
  let released = false;
  const server = createServer((request, response) => {
    const name = (request.url ?? '').slice(1), icon = /^icon\.(ico|png)$/.exec(name)?.[1] as keyof typeof ICONS | undefined;
    // A page that keeps loading until the test lets its last resource finish.
    if (name === 'slow') { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Slow site</title><link rel="icon" href="/icon.png"><p>Loading.</p><img src="/held">'); return; }
    if (name === 'held') { held.push(response); return; }
    if (icon) { response.writeHead(200, { 'content-type': ICONS[icon].type }).end(ICONS[icon].bytes); return; }
    if (name === 'ico' || name === 'png') { response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Bitmap ${name}</title><link rel="icon" href="/icon.${name}"><p>${name}</p>`); return; }
    if (name === 'paper.pdf') { response.writeHead(200, { 'content-type': 'application/pdf' }).end(pdfFixture(2)); return; }
    // Two pages of one site that declare the same icon, which the server keeps back until the test lets it go.
    if (name === 'first' || name === 'second') { response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>${name === 'first' ? 'First' : 'Second'} page</title><link rel="icon" href="/waiting.png"><p>${name}</p>`); return; }
    if (name === 'waiting.png') { if (released) response.writeHead(200, { 'content-type': 'image/png' }).end(ICONS.png.bytes); else held.push(response); return; }
    // A page that names its icon by a full address, as sites that share one icon do.
    if (name.startsWith('shared?icon=')) { response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Shared icon</title><link rel="icon" href="${decodeURIComponent(name.slice(12))}"><p>shared</p>`); return; }
    if (name === 'plain') { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Plain site</title><p>No icon.</p>'); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const release = () => { released = true; for (const response of held.splice(0)) response.writeHead(200, { 'content-type': 'image/png' }).end(ICONS.png.bytes); };
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, sibling: `http://localhost:${port}`, release, waiting: () => held.length,
    close: () => { release(); return new Promise<void>(resolve => server.close(() => resolve())); } };
}
const displaySwitches = process.env.SETDOWN_E2E_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu']
  : process.env.SETDOWN_TEST_DISPLAY === 'wayland' ? ['--ozone-platform=wayland']
  : process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? ['--ozone-platform=x11'] : [];

test('a site’s bitmap icon reaches its tab when no test driver keeps the decoding page awake', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-icons-'));
  const web = await site();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  // Icons are decoded in a page that is never shown. Under Playwright that page renders anyway, so this
  // application runs on its own and only its shell is asked what the tabs show.
  const app = await launchPlain([...displaySwitches, '.'], { ...env, XDG_CONFIG_HOME: path.join(root, 'config'), SETDOWN_NATIVE_DIALOGS: '1' });
  try {
    await expect.poll(() => app.evaluate<boolean>('typeof window.marktex?.openLink === "function"'), { timeout: 30_000 }).toBe(true);
    for (const kind of ['ico', 'png']) await app.evaluate(`window.marktex.openLink(${JSON.stringify(`${web.origin}/${kind}`)}).then(() => true)`);
    const icons = () => app.evaluate<Record<string, unknown>>(`(async () => {
      const out = {};
      for (const tab of document.querySelectorAll('.document-tab')) {
        const name = tab.querySelector('.tab-name')?.textContent ?? '', image = tab.querySelector('img.tab-favicon');
        if (!image) { out[name] = null; continue; }
        if (!image.complete) await new Promise(resolve => { image.onload = image.onerror = resolve; });
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        out[name] = { png: image.src.startsWith('data:image/png;base64,'), size: [image.naturalWidth, image.naturalHeight], pixel: [...context.getImageData(16, 16, 1, 1).data] };
      }
      return out;
    })()`);
    await expect.poll(icons, { timeout: 60_000 }).toEqual({
      'Bitmap ico': { png: true, size: [32, 32], pixel: [...ICONS.ico.colour, 255] },
      'Bitmap png': { png: true, size: [32, 32], pixel: [...ICONS.png.colour, 255] },
    });
  } finally { await app.close(); await web.close(); await rm(root, { recursive: true, force: true }); }
});

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

test('a site’s icon also labels the page gone to before it arrived, and a page of another site that names the same icon', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-icon-kept-'));
  const web = await site();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: [...displaySwitches, '.'], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config'), SETDOWN_NATIVE_DIALOGS: '0' } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    const address = page.getByRole('textbox', { name: 'Address or file path', exact: true });
    const go = async (url: string) => { await address.fill(url); await address.press('Enter'); };
    // The browser engine reports a page's icons once, and not again for a page that declares the same ones.
    // So the icon asked for by the first page has to reach the tab although the person has gone on by then.
    await page.evaluate(url => window.marktex.openLink(url), `${web.origin}/first`);
    // The first page of a session waits for the content blocker to start.
    await expect(tab(page, /First page/)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => web.waiting(), { timeout: 30_000 }).toBeGreaterThan(0);
    await go(`${web.origin}/second`);
    const second = tab(page, /Second page/);
    await expect(second).toBeVisible();
    await expect(second).not.toHaveAttribute('aria-busy');
    await expect(second.locator('svg[data-tab-icon="web"]')).toBeVisible();
    web.release();
    const icon = second.locator('img.tab-favicon');
    await expect(icon).toBeVisible();
    const picture = await icon.getAttribute('src');
    expect(picture).toMatch(/^data:image\/png;base64,/);

    // Another site (the same server under another host name) whose page names that very icon address:
    // nothing is reported for it, and the first site's icon was taken off when the site changed.
    await go(`${web.sibling}/shared?icon=${encodeURIComponent(`${web.origin}/waiting.png`)}`);
    const shared = tab(page, /Shared icon/);
    await expect(shared).toBeVisible();
    await expect(shared.locator('img.tab-favicon')).toHaveAttribute('src', picture!);
    await expect(shared.locator('svg')).toHaveCount(0);
    // A site with no icon at all keeps the plain globe, and the previous site's icon does not stay on it.
    await go(`${web.sibling}/plain`);
    const plain = tab(page, /Plain site/);
    await expect(plain.locator('svg[data-tab-icon="web"]')).toBeVisible();
    await expect(plain.locator('img.tab-favicon')).toHaveCount(0);
  } finally { await disposeApplication(app); await web.close(); await rm(root, { recursive: true, force: true }); }
});

test('every tab leads with an icon: the file type, a terminal, a folder, the website, or a spinner while it loads', async () => {
  test.skip(process.platform === 'win32', 'The terminal tab starts a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-kinds-'));
  const home = path.join(root, 'home');
  await mkdir(path.join(home, 'project'), { recursive: true });
  const file = (name: string) => path.join(home, 'project', name);
  await writeFile(file('notes.md'), '# Notes\n'); await writeFile(file('main.ts'), 'export {};\n'); await writeFile(file('LICENSE'), 'text\n');
  const web = await site();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: [...displaySwitches, '.', file('notes.md')], env: { ...env, HOME: home, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    await expect(tab(page, /notes\.md/)).toBeVisible();
    const strip = page.locator('.tab-strip').first(), height = (await strip.boundingBox())!.height;
    for (const name of ['main.ts', 'LICENSE']) {
      await page.evaluate(target => window.marktex.openLink(`marktex-resource://file${target}`), file(name));
      await expect(tab(page, new RegExp(name.replace('.', '\\.')))).toHaveAttribute('aria-selected', 'true');
    }
    // A document wears the icon the Explorer and the folder tab give the same file: the Seti set, by extension or name.
    const seti = JSON.parse(await readFile(new URL('../../../src/core/files/seti-icons.json', import.meta.url), 'utf8')) as
      { extensions: Record<string, string>; names: Record<string, string>; icons: Record<string, { character: string }> };
    const expected = { 'notes.md': seti.extensions.md, 'main.ts': seti.extensions.ts, LICENSE: seti.names.license };
    expect(new Set(Object.values(expected)).size).toBe(3);
    for (const [name, id] of Object.entries(expected)) {
      const icon = tab(page, new RegExp(name.replace('.', '\\.'))).locator('.file-type-icon');
      await expect(icon).toHaveAttribute('data-file-icon', id);
      await expect(icon).toHaveText(seti.icons[id].character);
    }

    await page.getByRole('button', { name: 'New terminal', exact: true }).click();
    await expect(tab(page, /^Terminal 1/).locator('svg[data-tab-icon="terminal"]')).toBeVisible();
    await page.getByRole('button', { name: 'New folder tab', exact: true }).click();
    const folder = page.locator('.document-tab[aria-selected="true"]');
    await expect(folder.locator('svg[data-tab-icon="folder"]')).toBeVisible();
    // A site without an icon of its own still has one: the tab strip never shows a bare title.
    await page.evaluate(url => window.marktex.openLink(url), `${web.origin}/plain`);
    await expect(tab(page, /Plain site/).locator('svg[data-tab-icon="web"]')).toBeVisible();
    await page.evaluate(url => window.marktex.openLink(url), `${web.origin}/png`);
    const site = tab(page, /Bitmap png/);
    await expect(site.locator('img.tab-favicon')).toBeVisible();
    await expect(site.locator('svg')).toHaveCount(0);

    // A PDF read from the web is a document, not a site's page: its tab wears the file type's icon,
    // the one the same file has when it is opened from a folder.
    await page.evaluate(url => window.marktex.openLink(url), `${web.origin}/paper.pdf`);
    const paper = tab(page, /paper\.pdf/), paperIcon = paper.locator('.file-type-icon');
    await expect(paperIcon).toHaveAttribute('data-file-icon', seti.extensions.pdf, { timeout: 30_000 });
    await expect(paperIcon).toHaveText(seti.icons[seti.extensions.pdf].character);
    await expect(paper.locator('svg, img.tab-favicon')).toHaveCount(0);

    // While a page loads, a turning spinner stands where its icon will be; the title carries no marker.
    await page.evaluate(url => window.marktex.openLink(url), `${web.origin}/slow`);
    const slow = tab(page, /Slow site/), spinner = slow.locator('svg[data-tab-icon="loading"]');
    await expect(spinner).toBeVisible();
    await expect(slow).toHaveAttribute('aria-busy', 'true');
    await expect(slow.locator('.tab-name')).toHaveText('Slow site');
    await expect(slow.locator('.tab-favicon, svg[data-tab-icon="web"]')).toHaveCount(0);
    expect(await spinner.evaluate(node => node.getAnimations().map(animation => animation.playState))).toEqual(['running']);
    web.release();
    await expect(slow.locator('img.tab-favicon')).toBeVisible();
    await expect(spinner).toHaveCount(0);
    await expect(slow).not.toHaveAttribute('aria-busy');

    // One icon per tab, 16px wide, left of the title, and the strip keeps its height.
    await expect(page.locator('.document-tab')).toHaveCount(9);
    expect(await page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => {
      const icons = [...tab.querySelectorAll('.file-type-icon, .tab-glyph, .tab-favicon')], name = tab.querySelector('.tab-name')!.getBoundingClientRect();
      const box = icons[0]?.getBoundingClientRect();
      return { icons: icons.length, width: box && Math.round(box.width), before: !!box && box.right <= name.left && box.left >= tab.getBoundingClientRect().left };
    }))).toEqual(Array.from({ length: 9 }, () => ({ icons: 1, width: 16, before: true })));
    expect((await strip.boundingBox())!.height).toBe(height);
    await page.screenshot({ path: test.info().outputPath('tab-icons.png'), clip: { x: 0, y: 0, width: 1280, height: 80 } });
  } finally { await disposeApplication(app); await web.close(); await rm(root, { recursive: true, force: true }); }
});
