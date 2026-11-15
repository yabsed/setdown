import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../support/electron/electron-app';
import { waylandInput } from '../support/electron/wayland-input';

/**
 * On a Wayland desktop Setdown is an XWayland client, and most other
 * applications are native Wayland ones. A folder tab's file drag has to reach
 * them through the compositor's XDND bridge, so the receiver here is a native
 * Wayland process that knows nothing about the drag but what the compositor offers.
 */
type Fixture = { root: string; home: string; app: TestApplication; page: Page; errors: string[] };
async function launch(backend: 'x11' | 'wayland', prepare: (home: string) => Promise<void>): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-wayland-drag-'));
  const home = path.join(root, 'home');
  await mkdir(home, { recursive: true });
  await prepare(home);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: [`--ozone-platform=${backend}`, '.'], env: { ...env, HOME: home,
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await focusApplication(app);
  await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
  await expect(list(page)).toBeFocused();
  return { root, home, app, page, errors };
}
const list = (page: Page) => page.locator('.folder-content:not(.inactive) [data-folder-list]');
const row = (page: Page, name: string) => list(page).locator('.folder-row').filter({ has: page.locator('.folder-label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const labels = (page: Page) => list(page).locator('.folder-row .folder-label').allTextContents();
const status = (page: Page) => page.locator('.folder-content:not(.inactive) .folder-status');

if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') test('a folder tab drags files from XWayland into its own folders and into a native Wayland application', async () => {
  test.setTimeout(120_000);
  const input = await waylandInput();
  const fixtures: Fixture[] = [];
  try {
    const target = await launch('wayland', async home => { await mkdir(path.join(home, 'inbox')); });
    fixtures.push(target);
    expect(await target.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('wayland');
    // A native Wayland window does not know where it is; tiling puts it at a known place.
    await input.send({ keyDown: ['Super_L'], keys: ['Right'], keyUp: ['Super_L'] });
    await expect.poll(() => target.page.evaluate(() => innerWidth)).toBe(960);
    const source = await launch('x11', async home => {
      await mkdir(path.join(home, 'sub'));
      await writeFile(path.join(home, 'keep.bin'), 'keep\n');
      await writeFile(path.join(home, 'photo.bin'), 'photo\n');
    });
    fixtures.push(source);
    const owner = await source.app.browserWindow(source.page);
    await owner.evaluate(window => window.setBounds({ x: 0, y: 0, width: 900, height: 700 }));
    await expect.poll(() => owner.evaluate(window => window.getBounds().x)).toBe(0);
    await expect.poll(() => labels(source.page)).toEqual(['sub', 'keep.bin', 'photo.bin']);
    await expect.poll(() => labels(target.page)).toEqual(['inbox']);
    const fromSource = async (point: { x: number; y: number }) => {
      const bounds = await owner.evaluate(window => window.getContentBounds());
      return { x: bounds.x + point.x, y: bounds.y + point.y };
    };
    /** Press on a source row and carry it to a screen position; the caller releases. */
    const carry = async (name: string, to: { x: number; y: number }) => {
      const box = (await row(source.page, name).boundingBox())!;
      const from = await fromSource({ x: box.x + 70, y: box.y + box.height / 2 });
      await input.send({ pointer: [{ x: from.x - 30, y: from.y }, from], button: 'down' });
      await input.send({ pointer: [{ x: from.x + 10, y: from.y + 6 }, { x: from.x + 22, y: from.y + 14 },
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { x: to.x - 40, y: to.y - 3 }, { x: to.x - 4, y: to.y - 3 }, to] });
    };
    const release = async (over: { x: number; y: number }) => {
      await input.send({ pointer: [{ x: over.x + 2, y: over.y + 1 }, { x: over.x + 1, y: over.y }, over] });
      await input.send({ button: 'up' });
    };

    // Inside its own window the drag is still Setdown's own: the file moves into the folder under the pointer.
    const sub = (await row(source.page, 'sub').boundingBox())!;
    const overSub = await fromSource({ x: sub.x + sub.width / 2, y: sub.y + sub.height / 2 });
    await carry('keep.bin', overSub);
    await expect(status(source.page)).toContainText('Move into “sub”');
    await release(overSub);
    await expect.poll(() => readdir(path.join(source.home, 'sub'))).toEqual(['keep.bin']);
    await expect.poll(() => labels(source.page)).toEqual(['sub', 'photo.bin']);

    // Find the tiled Wayland window's origin with the pointer itself instead of assuming it.
    await target.page.evaluate(() => {
      addEventListener('mousemove', event => { (globalThis as { lastPointer?: { x: number; y: number } }).lastPointer = { x: event.clientX, y: event.clientY }; }, true);
    });
    await input.send({ pointer: [{ x: 1400, y: 500 }, { x: 1410, y: 510 }] });
    await expect.poll(() => target.page.evaluate(() => (globalThis as { lastPointer?: unknown }).lastPointer)).toBeTruthy();
    const seen = await target.page.evaluate(() => (globalThis as { lastPointer?: { x: number; y: number } }).lastPointer!);
    const inbox = (await row(target.page, 'inbox').boundingBox())!;
    const overInbox = { x: 1410 - seen.x + inbox.x + inbox.width / 2, y: 510 - seen.y + inbox.y + inbox.height / 2 };

    // The Wayland application sees real files while the pointer is over it. Escape gives the drag up.
    await carry('photo.bin', overInbox);
    await expect(status(target.page)).toContainText('into “inbox”');
    await expect(row(target.page, 'inbox')).toHaveClass(/drop-target/);
    // A real key press lasts: the compositor's drag grab swallows the release of a zero-length one.
    await input.send({ keyDown: ['Escape'] });
    await source.page.waitForTimeout(120);
    await input.send({ keyUp: ['Escape'] });
    await expect(row(target.page, 'inbox')).not.toHaveClass(/drop-target/);
    await release(overInbox);
    await source.page.waitForTimeout(500);
    expect(await readdir(path.join(target.home, 'inbox'))).toEqual([]);
    expect(await readFile(path.join(source.home, 'photo.bin'), 'utf8')).toBe('photo\n');

    // Dropped, the file arrives in the folder under the pointer with its contents.
    await carry('photo.bin', overInbox);
    await expect(status(target.page)).toContainText('into “inbox”');
    await release(overInbox);
    await expect.poll(() => readdir(path.join(target.home, 'inbox'))).toEqual(['photo.bin']);
    expect(await readFile(path.join(target.home, 'inbox', 'photo.bin'), 'utf8')).toBe('photo\n');
    await expect(source.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    expect(fixtures.flatMap(fixture => fixture.errors)).toEqual([]);
  } finally {
    await input.send({ button: 'up' }).catch(() => {});
    for (const [index, fixture] of fixtures.entries()) {
      await fixture.page.screenshot({ path: test.info().outputPath(`wayland-file-drag-${index}.png`) }).catch(() => {});
      await disposeApplication(fixture.app); await rm(fixture.root, { recursive: true, force: true });
    }
    await input.close();
  }
});
