import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { disposeApplication, electron, focusApplication } from '../../support/electron/electron-app';
import { launchPlain } from '../../support/electron/plain-app';

/** A square of one colour, as the two bitmap formats sites serve for their icon. */
function png(size: number, [red, green, blue]: number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([red, green, blue]))]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
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
const ICONS = { ico: { type: 'image/x-icon', colour: [39, 174, 96], bytes: ico(16, [39, 174, 96]) }, png: { type: 'image/png', colour: [41, 128, 185], bytes: png(48, [41, 128, 185]) } };

async function site() {
  const held: ServerResponse[] = [];
  const server = createServer((request, response) => {
    const name = (request.url ?? '').slice(1), icon = /^icon\.(ico|png)$/.exec(name)?.[1] as keyof typeof ICONS | undefined;
    // A page that keeps loading until the test lets its last resource finish.
    if (name === 'slow') { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Slow site</title><link rel="icon" href="/icon.png"><p>Loading.</p><img src="/held">'); return; }
    if (name === 'held') { held.push(response); return; }
    if (icon) { response.writeHead(200, { 'content-type': ICONS[icon].type }).end(ICONS[icon].bytes); return; }
    if (name === 'ico' || name === 'png') { response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Bitmap ${name}</title><link rel="icon" href="/icon.${name}"><p>${name}</p>`); return; }
    if (name === 'plain') { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Plain site</title><p>No icon.</p>'); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const release = () => { for (const response of held.splice(0)) response.writeHead(200, { 'content-type': 'image/png' }).end(ICONS.png.bytes); };
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, release,
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
    await expect(page.locator('.document-tab')).toHaveCount(8);
    expect(await page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => {
      const icons = [...tab.querySelectorAll('.file-type-icon, .tab-glyph, .tab-favicon')], name = tab.querySelector('.tab-name')!.getBoundingClientRect();
      const box = icons[0]?.getBoundingClientRect();
      return { icons: icons.length, width: box && Math.round(box.width), before: !!box && box.right <= name.left && box.left >= tab.getBoundingClientRect().left };
    }))).toEqual(Array.from({ length: 8 }, () => ({ icons: 1, width: 16, before: true })));
    expect((await strip.boundingBox())!.height).toBe(height);
    await page.screenshot({ path: test.info().outputPath('tab-icons.png'), clip: { x: 0, y: 0, width: 1280, height: 80 } });
  } finally { await disposeApplication(app); await web.close(); await rm(root, { recursive: true, force: true }); }
});
