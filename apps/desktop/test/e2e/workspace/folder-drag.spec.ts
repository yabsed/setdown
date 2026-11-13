import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { nativeInput } from '../../support/electron/native-input';

/**
 * Folder-tab drags are OS file drags, so these specs use real pointer input:
 * synthetic DragEvents cannot carry files to a web page or to another process.
 */
type Fixture = { root: string; home: string; app: TestApplication; page: Page; errors: string[] };
async function launch(prepare: (home: string) => Promise<void>): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-drag-'));
  const home = path.join(root, 'home');
  await mkdir(home, { recursive: true });
  await prepare(home);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, HOME: home, XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => { errors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });
  await focusApplication(app);
  await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
  await expect(list(page)).toBeFocused();
  return { root, home, app, page, errors };
}
const list = (page: Page) => page.locator('.folder-content:not(.inactive) [data-folder-list]');
const row = (page: Page, name: string) => list(page).locator('.folder-row').filter({ has: page.locator('.folder-label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const labels = (page: Page) => list(page).locator('.folder-row .folder-label').allTextContents();
const status = (page: Page) => page.locator('.folder-content:not(.inactive) .folder-status');

async function screenPoint(fixture: Fixture, point: { x: number; y: number }) {
  const owner = await fixture.app.browserWindow(fixture.page);
  return owner.evaluate((window, point) => {
    const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
    return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  }, point);
}
const center = async (locator: Locator) => { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
/** Press on a row and carry it to a screen position; the caller asserts the hover feedback, then releases. */
async function carry(fixture: Fixture, name: string, to: { x: number; y: number }) {
  const box = (await row(fixture.page, name).boundingBox())!;
  const from = await screenPoint(fixture, { x: box.x + 70, y: box.y + box.height / 2 });
  await nativeInput({ pointer: [from], button: 'down' });
  await nativeInput({ pointer: [{ x: from.x + 10, y: from.y + 6 }, { x: from.x + 22, y: from.y + 14 },
    { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { x: to.x - 4, y: to.y - 3 }, to] });
  return to;
}
/**
 * An X11 drag source drops with the answer to its previous pointer position.
 * A hand keeps producing positions over the target; do the same once the
 * target has shown that it accepts, then let go.
 */
async function release(over: { x: number; y: number }) {
  await nativeInput({ pointer: [{ x: over.x + 2, y: over.y + 1 }, { x: over.x + 1, y: over.y }, over] });
  await nativeInput({ button: 'up' });
}

test('a folder tab drags files into folders, onto a web page as real files, and onto a tab strip', async () => {
  test.setTimeout(120_000);
  // While Electron runs an OS drag the main process answers nothing, so the page reports its own hover.
  let hovered = false;
  const server = createServer((request, response) => {
    if (request.url === '/over') { hovered = true; response.end(); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><title>Drop page</title><body style="margin:0;height:100vh"><script>
      let over = false;
      addEventListener('dragover', event => { event.preventDefault(); if (!over) { over = true; void fetch('/over'); } });
      addEventListener('drop', async event => {
        event.preventDefault();
        const files = [...event.dataTransfer.files];
        const texts = await Promise.all(files.map(file => file.text()));
        document.title = 'dropped ' + files.map((file, index) => file.name + '=' + texts[index].trim()).sort().join(',');
      });
    </script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixture = await launch(async home => {
    await mkdir(path.join(home, 'sub'));
    await writeFile(path.join(home, 'alpha.md'), '# Alpha\n');
    await writeFile(path.join(home, 'data.bin'), 'binary\n');
  });
  const { home, app, page } = fixture;
  try {
    await expect.poll(() => labels(page)).toEqual(['sub', 'alpha.md', 'data.bin']);
    // A plain file moves into the folder under the pointer.
    let over = await carry(fixture, 'data.bin', await screenPoint(fixture, await center(row(page, 'sub'))));
    await expect(status(page)).toContainText('Move into “sub”');
    await expect(row(page, 'sub')).toHaveClass(/drop-target/);
    await release(over);
    await expect.poll(() => readdir(path.join(home, 'sub'))).toEqual(['data.bin']);
    await expect.poll(() => labels(page)).toEqual(['sub', 'alpha.md']);
    await expect(status(page)).not.toContainText('Move into');
    // So does a document: over a folder tab it is a file transfer, not a tab placement.
    over = await carry(fixture, 'alpha.md', await screenPoint(fixture, await center(row(page, 'sub'))));
    await expect(status(page)).toContainText('Move into “sub”');
    await release(over);
    await expect.poll(async () => (await readdir(path.join(home, 'sub'))).sort()).toEqual(['alpha.md', 'data.bin']);
    await expect.poll(() => labels(page)).toEqual(['sub']);
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);

    // Put a web page beside the folder tab.
    await row(page, 'sub').dblclick();
    await expect.poll(() => labels(page)).toEqual(['alpha.md', 'data.bin']);
    await page.evaluate(url => window.marktex.openLink(url), `http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await expect(page.getByRole('tab', { name: /Drop page/ })).toHaveAttribute('aria-selected', 'true');
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.getByRole('tab', { name: /^sub/ }).dispatchEvent('dragstart', { dataTransfer: transfer });
    const body = (await page.locator('.group-body').first().boundingBox())!;
    const edge = { clientX: body.x + body.width * .98, clientY: body.y + body.height / 2, dataTransfer: transfer };
    await page.locator('.group-body').first().dispatchEvent('dragover', edge);
    await page.locator('.group-body').first().dispatchEvent('drop', edge);
    await transfer.dispose();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(() => labels(page)).toEqual(['alpha.md', 'data.bin']);

    // The page receives the files themselves, including a document that could also open as a tab.
    const title = () => app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find(contents => contents.getURL().startsWith('http://127.0.0.1'))?.getTitle());
    await row(page, 'alpha.md').click();
    await row(page, 'data.bin').click({ modifiers: ['Control'] });
    over = await carry(fixture, 'data.bin', await screenPoint(fixture, await center(page.locator('.group-body').first())));
    await expect.poll(() => hovered).toBe(true);
    await release(over);
    await expect.poll(title).toBe('dropped alpha.md=# Alpha,data.bin=binary');
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    expect((await readdir(path.join(home, 'sub'))).sort()).toEqual(['alpha.md', 'data.bin']);

    // A document dropped on a tab strip opens there, as an Explorer file does.
    const strip = (await page.locator('.tab-strip').first().boundingBox())!;
    await row(page, 'alpha.md').click();
    over = await carry(fixture, 'alpha.md', await screenPoint(fixture, { x: strip.x + strip.width * .6, y: strip.y + strip.height / 2 }));
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    await release(over);
    await expect(page.locator('.editor-group').first().getByRole('tab', { name: /alpha\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    expect(await readFile(path.join(home, 'sub', 'alpha.md'), 'utf8')).toBe('# Alpha\n');
    expect(fixture.errors).toEqual([]);
  } finally {
    await nativeInput({ button: 'up' }).catch(() => {});
    await page.screenshot({ path: test.info().outputPath('folder-drag.png') }).catch(() => {});
    await disposeApplication(app); server.close(); await rm(fixture.root, { recursive: true, force: true });
  }
});

test('files dragged in from another application move into the folder under the pointer instead of opening', async () => {
  test.setTimeout(120_000);
  const source = await launch(async home => {
    await writeFile(path.join(home, 'outgoing.txt'), 'outgoing\n');
    await writeFile(path.join(home, 'photo.bin'), 'photo\n');
  });
  const target = await launch(async home => { await mkdir(path.join(home, 'inbox')); }).catch(async error => {
    await disposeApplication(source.app); await rm(source.root, { recursive: true, force: true }); throw error;
  });
  try {
    // Two processes side by side: the receiver knows nothing about the drag but its OS payload.
    for (const [fixture, x] of [[source, 0], [target, 940]] as const) {
      const owner = await fixture.app.browserWindow(fixture.page);
      await owner.evaluate((window, x) => window.setBounds({ x, y: 0, width: 900, height: 700 }), x);
      await expect.poll(() => owner.evaluate(window => window.getBounds().x)).toBe(x);
    }
    await expect.poll(() => labels(source.page)).toEqual(['outgoing.txt', 'photo.bin']);
    await expect.poll(() => labels(target.page)).toEqual(['inbox']);

    let over = await carry(source, 'photo.bin', await screenPoint(target, await center(row(target.page, 'inbox'))));
    await expect(status(target.page)).toContainText('Drop into “inbox”');
    await expect(row(target.page, 'inbox')).toHaveClass(/drop-target/);
    await release(over);
    await expect.poll(() => readdir(path.join(target.home, 'inbox'))).toEqual(['photo.bin']);
    await expect.poll(() => readdir(source.home)).not.toContain('photo.bin');
    await expect.poll(() => labels(source.page)).toEqual(['outgoing.txt']);

    // An openable document dropped on the list itself lands in the listed folder; it is not opened as a tab.
    const empty = (await list(target.page).boundingBox())!;
    over = await carry(source, 'outgoing.txt', await screenPoint(target, { x: empty.x + empty.width / 2, y: empty.y + empty.height - 80 }));
    await expect(status(target.page)).toContainText('Drop into “Home”');
    await release(over);
    await expect.poll(async () => (await readdir(target.home)).filter(name => !name.startsWith('.')).sort()).toEqual(['inbox', 'outgoing.txt']);
    expect(await readFile(path.join(target.home, 'outgoing.txt'), 'utf8')).toBe('outgoing\n');
    await expect.poll(async () => (await readdir(source.home)).filter(name => !name.startsWith('.'))).toEqual([]);
    await expect(row(target.page, 'outgoing.txt')).toHaveAttribute('aria-selected', 'true');
    await expect(target.page.getByRole('tab')).toHaveCount(1);
    await expect(source.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    expect([...source.errors, ...target.errors]).toEqual([]);
  } finally {
    await nativeInput({ button: 'up' }).catch(() => {});
    await target.page.screenshot({ path: test.info().outputPath('folder-drop-target.png') }).catch(() => {});
    await disposeApplication(source.app); await disposeApplication(target.app);
    await rm(source.root, { recursive: true, force: true }); await rm(target.root, { recursive: true, force: true });
  }
});
