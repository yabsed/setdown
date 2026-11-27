import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { nativeInput } from '../../support/electron/native-input';
import { clearAddress } from '../../support/browser/location-controls';

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

test('a file chooser drags files into folders like any folder tab and keeps waiting for its answer', async () => {
  test.setTimeout(120_000);
  const fixture = await launch(async home => {
    await mkdir(path.join(home, 'sub'));
    await writeFile(path.join(home, 'data.bin'), 'binary\n');
  });
  const { home, app, page } = fixture;
  try {
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-open-folder'));
    const chooser = page.getByRole('tab', { name: /Open Folder/ });
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => labels(page)).toEqual(['sub', 'data.bin']);
    const over = await carry(fixture, 'data.bin', await screenPoint(fixture, await center(row(page, 'sub'))));
    await expect(status(page)).toContainText('Move into “sub”');
    await expect(row(page, 'sub')).toHaveClass(/drop-target/);
    await release(over);
    await expect.poll(() => readdir(path.join(home, 'sub'))).toEqual(['data.bin']);
    await expect.poll(() => labels(page)).toEqual(['sub']);
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    expect(fixture.errors).toEqual([]);
  } finally {
    await nativeInput({ button: 'up' }).catch(() => {});
    await page.screenshot({ path: test.info().outputPath('chooser-drag.png') }).catch(() => {});
    await disposeApplication(app); await rm(fixture.root, { recursive: true, force: true });
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

test('a folder tab outside the workspace copies its files into the Explorer folder under the pointer; workspace files still move', async () => {
  test.setTimeout(120_000);
  const fixture = await launch(async home => {
    await mkdir(path.join(home, 'Downloads'));
    await mkdir(path.join(home, 'work', 'inbox'), { recursive: true });
    await writeFile(path.join(home, 'Downloads', 'report.bin'), 'report\n');
    await writeFile(path.join(home, 'work', 'inside.bin'), 'inside\n');
  });
  const { home, app, page } = fixture;
  try {
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), path.join(home, 'work'));
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const inbox = page.getByRole('treeitem', { name: 'inbox', exact: true });
    await expect(inbox).toBeVisible();
    await focusApplication(app);
    const address = page.locator('.location-bar input').first();
    const browse = async (folder: string) => { await clearAddress(address); await address.fill(folder); await address.press('Enter'); };
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await browse(path.join(home, 'Downloads'));
    await expect.poll(() => labels(page)).toEqual(['report.bin']);

    // The open folder does not own Downloads: its file is copied in and stays where it was.
    let over = await carry(fixture, 'report.bin', await screenPoint(fixture, await center(inbox)));
    await expect(inbox).toHaveClass(/is-drop-target/);
    await release(over);
    await expect.poll(() => readdir(path.join(home, 'work', 'inbox'))).toEqual(['report.bin']);
    expect(await readFile(path.join(home, 'work', 'inbox', 'report.bin'), 'utf8')).toBe('report\n');
    expect(await readdir(path.join(home, 'Downloads'))).toEqual(['report.bin']);
    await expect(page.getByRole('treeitem', { name: 'report.bin', exact: true })).toBeVisible();
    await expect(page.locator('.project-error')).toHaveCount(0);

    // A folder tab showing the workspace drags the Explorer's own entries: they move.
    await browse(path.join(home, 'work'));
    await expect.poll(() => labels(page)).toEqual(['inbox', 'inside.bin']);
    over = await carry(fixture, 'inside.bin', await screenPoint(fixture, await center(inbox)));
    await expect(inbox).toHaveClass(/is-drop-target/);
    await release(over);
    await expect.poll(async () => (await readdir(path.join(home, 'work', 'inbox'))).sort()).toEqual(['inside.bin', 'report.bin']);
    await expect.poll(() => readdir(path.join(home, 'work'))).toEqual(['inbox']);
    await expect(page.locator('.project-error')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } finally {
    await nativeInput({ button: 'up' }).catch(() => {});
    await page.screenshot({ path: test.info().outputPath('folder-drag-explorer.png') }).catch(() => {});
    await disposeApplication(app); await rm(fixture.root, { recursive: true, force: true });
  }
});

const selectedNames = (page: Page) => list(page).locator('[role="option"][aria-selected="true"] .folder-label').allTextContents();
const marquee = (page: Page) => list(page).locator('.folder-marquee');

test('dragging on the background, or on a row beside its name, draws a box that selects what it touches', async () => {
  test.setTimeout(120_000);
  const names = ['alpha.md', 'beta.md', 'delta.md', 'gamma.md'];
  const fixture = await launch(async home => {
    await mkdir(path.join(home, 'sub'));
    for (const name of names) await writeFile(path.join(home, name), `# ${name}\n`);
  });
  const { home, page } = fixture;
  try {
    await expect.poll(() => labels(page)).toEqual(['sub', ...names]);
    const area = (await list(page).boundingBox())!;
    const middle = async (name: string) => { const box = (await row(page, name).boundingBox())!; return box.y + box.height / 2; };
    const gamma = (await row(page, 'gamma.md').boundingBox())!;
    // Real pointer input, from the empty space under the rows up into "beta.md".
    const from = { x: Math.round(area.x + area.width * .7), y: Math.round(gamma.y + gamma.height + 120) };
    const to = { x: Math.round(area.x + area.width * .3), y: Math.round(await middle('beta.md')) };
    await nativeInput({ pointer: [await screenPoint(fixture, from)], button: 'down' });
    await nativeInput({ pointer: [await screenPoint(fixture, { x: from.x - 30, y: from.y - 30 }), await screenPoint(fixture, to)] });
    await expect(marquee(page)).toBeVisible();
    await expect.poll(() => selectedNames(page)).toEqual(['beta.md', 'delta.md', 'gamma.md']);
    await expect(status(page)).toContainText('3 selected');
    // The box spans the press and the pointer.
    await expect.poll(async () => {
      const box = (await marquee(page).boundingBox())!;
      return [box.x - to.x, box.y - to.y, box.x + box.width - from.x, box.y + box.height - from.y].every(gap => Math.abs(gap) <= 1.5);
    }).toBe(true);
    await page.screenshot({ path: test.info().outputPath('folder-marquee.png') });
    await nativeInput({ button: 'up' });
    await expect(marquee(page)).toHaveCount(0);
    // The release is not a click on the background: it clears nothing.
    await expect(status(page)).toContainText('3 selected');
    expect(await selectedNames(page)).toEqual(['beta.md', 'delta.md', 'gamma.md']);
    // The keyboard continues from the box: its far end is the anchor, the pointer's end has the focus.
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(() => selectedNames(page)).toEqual(names);

    // The rest of a row is background too: a drag from the Kind column of "alpha.md" selects, and carries no file.
    const beside = { x: Math.round(area.x + area.width - 60), y: Math.round(await middle('alpha.md')) };
    await nativeInput({ pointer: [await screenPoint(fixture, beside)], button: 'down' });
    await nativeInput({ pointer: [await screenPoint(fixture, { x: beside.x - 12, y: beside.y + 10 }), await screenPoint(fixture, { x: beside.x - 200, y: await middle('delta.md') })] });
    await expect(marquee(page)).toBeVisible();
    await expect.poll(() => selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    await expect(status(page)).not.toContainText('Move into');
    await nativeInput({ button: 'up' });
    await expect(marquee(page)).toHaveCount(0);
    expect(await selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    expect((await readdir(home)).filter(name => !name.startsWith('.')).sort()).toEqual([...names, 'sub']);
    // Without a drag the same press is a click on the row.
    await nativeInput({ click: await screenPoint(fixture, { x: beside.x, y: await middle('gamma.md') }) });
    await expect.poll(() => selectedNames(page)).toEqual(['gamma.md']);
    // The name is still the handle that carries the file.
    const over = await carry(fixture, 'gamma.md', await screenPoint(fixture, await center(row(page, 'sub'))));
    await expect(status(page)).toContainText('Move into “sub”');
    await expect(marquee(page)).toHaveCount(0);
    await release(over);
    await expect.poll(() => readdir(path.join(home, 'sub'))).toEqual(['gamma.md']);
    await expect.poll(() => labels(page)).toEqual(['sub', 'alpha.md', 'beta.md', 'delta.md']);

    // Ctrl toggles what the box touches, Shift adds it, and Escape gives the selection back.
    const sweep = async (name: string) => {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, await middle(name), { steps: 4 });
      await expect(marquee(page)).toBeVisible();
    };
    await row(page, 'alpha.md').locator('.folder-label').click();
    await page.keyboard.down('Control');
    await sweep('beta.md');
    await expect.poll(() => selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    await page.mouse.up();
    await sweep('delta.md');
    await expect.poll(() => selectedNames(page)).toEqual(['alpha.md', 'beta.md']);
    await page.mouse.up(); await page.keyboard.up('Control');
    await page.keyboard.down('Shift');
    await sweep('delta.md');
    await expect.poll(() => selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    await page.mouse.up(); await page.keyboard.up('Shift');
    await sweep('delta.md');
    await expect.poll(() => selectedNames(page)).toEqual(['delta.md']);
    await page.keyboard.press('Escape');
    await expect(marquee(page)).toHaveCount(0);
    await expect.poll(() => selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    await page.mouse.up();
    expect(await selectedNames(page)).toEqual(['alpha.md', 'beta.md', 'delta.md']);
    // A box that touches nothing clears the selection, as a click on the background does.
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 3 });
    await expect(marquee(page)).toBeVisible();
    await expect.poll(() => selectedNames(page)).toEqual([]);
    await page.mouse.up();
    expect(fixture.errors).toEqual([]);
  } finally {
    await nativeInput({ button: 'up' }).catch(() => {});
    await page.mouse.up().catch(() => {});
    await page.screenshot({ path: test.info().outputPath('folder-marquee-end.png') }).catch(() => {});
    await disposeApplication(fixture.app); await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a box scrolls a folder longer than the pane to reach its rows, and selects cells in the grid', async () => {
  test.setTimeout(120_000);
  const names = Array.from({ length: 80 }, (_, index) => `file-${String(index).padStart(2, '0')}.txt`);
  const fixture = await launch(async home => { for (const name of names) await writeFile(path.join(home, name), `${name}\n`); });
  const { page } = fixture;
  const scroller = list(page).locator('.folder-rows');
  const scrollTop = () => scroller.evaluate(element => element.scrollTop);
  try {
    await expect(row(page, 'file-00.txt')).toBeVisible();
    await expect(status(page)).toContainText('80 items');
    const area = (await list(page).boundingBox())!;
    // Every row is under a name here: the only background is the rows themselves.
    const third = (await row(page, 'file-02.txt').boundingBox())!;
    const start = { x: Math.round(area.x + area.width - 60), y: Math.round(third.y + third.height / 2) };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x - 40, area.y + area.height + 30, { steps: 5 });
    await expect(marquee(page)).toBeVisible();
    // Held below the list, the pointer keeps the list scrolling to its end.
    await expect.poll(async () => { const top = await scrollTop(); return top > 0 && top === await scroller.evaluate(element => element.scrollHeight - element.clientHeight); }, { timeout: 15_000 }).toBe(true);
    await expect(status(page)).toContainText('78 selected');
    await expect(row(page, 'file-79.txt')).toHaveAttribute('aria-selected', 'true');
    // The box is anchored to the row it began on, which has scrolled out of view above.
    expect((await marquee(page).boundingBox())!.y).toBeLessThanOrEqual((await scroller.boundingBox())!.y);
    // Back up at the top edge the list scrolls the other way and the box shrinks to its first rows.
    await page.mouse.move(start.x - 40, (await scroller.boundingBox())!.y - 30, { steps: 5 });
    await expect.poll(scrollTop, { timeout: 15_000 }).toBe(0);
    await expect(status(page)).toContainText('3 selected');
    await page.mouse.up();
    await expect(marquee(page)).toHaveCount(0);
    expect(await selectedNames(page)).toEqual(['file-00.txt', 'file-01.txt', 'file-02.txt']);

    // Grid: the padding around a thumbnail is background, and a cell is taken once the box reaches its content.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+2');
    const cell = (name: string) => list(page).locator('.folder-cell').filter({ has: page.locator('.folder-label', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
    await expect(cell('file-00.txt')).toBeVisible();
    const columns = await list(page).locator('.folder-line').first().locator('.folder-cell').count();
    expect(columns).toBeGreaterThan(2);
    const first = (await cell('file-00.txt').boundingBox())!, below = (await cell(names[columns + 1]).boundingBox())!;
    await page.mouse.move(first.x + 2, first.y + first.height / 2); await page.mouse.down();
    await page.mouse.move(first.x + 5, first.y + first.height / 2 + 6, { steps: 2 });
    await expect(marquee(page)).toBeVisible();
    await expect.poll(() => selectedNames(page)).toEqual([]);
    await page.mouse.move(below.x + below.width / 2, below.y + below.height / 2, { steps: 4 });
    await expect.poll(() => selectedNames(page)).toEqual([names[0], names[1], names[columns], names[columns + 1]]);
    await page.screenshot({ path: test.info().outputPath('folder-marquee-grid.png') });
    await page.mouse.up();
    await expect(marquee(page)).toHaveCount(0);
    expect(await selectedNames(page)).toEqual([names[0], names[1], names[columns], names[columns + 1]]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await page.mouse.up().catch(() => {});
    await page.screenshot({ path: test.info().outputPath('folder-marquee-long-end.png') }).catch(() => {});
    await disposeApplication(fixture.app); await rm(fixture.root, { recursive: true, force: true });
  }
});
