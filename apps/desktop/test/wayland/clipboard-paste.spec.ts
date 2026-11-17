import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../support/electron/electron-app';
import { waylandInput } from '../support/electron/wayland-input';
import { pngFixture } from '../support/media/png-fixture';

/**
 * On a Wayland desktop Setdown is an XWayland client, while the browser, image
 * viewer or file manager an image is copied in is usually a native Wayland
 * one. Their clipboard reaches Setdown only through the compositor's selection
 * bridge, as whatever formats that application offered: pixels with no file
 * behind them, or a list of files. Paste has to make a file of either.
 *
 * The copying application here is a second, native Wayland process. It shares
 * nothing with the pasting one but the compositor.
 */
type Fixture = { root: string; home: string; app: TestApplication; page: Page; errors: string[] };
async function launch(backend: 'x11' | 'wayland', prepare: (home: string) => Promise<void> = async () => {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-wayland-paste-'));
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
const failure = (page: Page) => page.locator('.folder-content:not(.inactive) .folder-error');
const pngSize = (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null;

type Scenario = {
  name: string;
  prepare?(home: string): Promise<void>;
  /** Runs in the focused native Wayland application, after a real key press gave it an input serial. */
  copy(source: Fixture, input: Awaited<ReturnType<typeof waylandInput>>): Promise<void>;
  pasted(target: Fixture, source: Fixture): Promise<void>;
};
const photo = pngFixture(64, 48, [41, 128, 185]);
const scenarios: Scenario[] = [{
  name: 'image data copied in a native Wayland application becomes a new image file',
  // What a browser's “Copy image” or a screenshot tool owns: pixels and the tag they came from.
  copy: source => source.app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(bytes, 'base64')], { type: 'image/png' }),
      'text/html': '<img src="https://example.com/gallery/harbour%20at%20dusk.webp">' })]);
  }, pngFixture(320, 200, [192, 57, 43]).toString('base64')),
  async pasted(target) {
    await expect(row(target.page, 'harbour at dusk.png')).toHaveAttribute('aria-selected', 'true');
    expect(pngSize(await readFile(path.join(target.home, 'harbour at dusk.png')))).toEqual([320, 200]);
    // Pasting again never replaces the first file.
    await list(target.page).focus();
    await target.page.keyboard.press('Control+v');
    await expect(row(target.page, 'harbour at dusk 2.png')).toHaveAttribute('aria-selected', 'true');
    expect((await readdir(target.home)).filter(name => name.endsWith('.png')).sort()).toEqual(['harbour at dusk 2.png', 'harbour at dusk.png']);
  },
}, {
  name: 'image files copied in a native Wayland application are copied with their names and bytes',
  async prepare(home) {
    await writeFile(path.join(home, '여름 사진.png'), photo);
    await writeFile(path.join(home, 'second shot.png'), pngFixture(8, 8, [39, 174, 96]));
  },
  async copy(source, input) {
    await row(source.page, '여름 사진.png').click();
    await row(source.page, 'second shot.png').click({ modifiers: ['Control'] });
    // The physical shortcut, as in a file manager.
    await input.send({ keyDown: ['Control_L'], keys: ['c'], keyUp: ['Control_L'] });
    await expect.poll(() => source.page.evaluate(() => window.marktex.explorer.clipboard()).then(value => value?.paths.length)).toBe(2);
  },
  async pasted(target, source) {
    await expect.poll(async () => (await readdir(target.home)).filter(name => name.endsWith('.png')).sort()).toEqual(['second shot.png', '여름 사진.png']);
    expect(await readFile(path.join(target.home, '여름 사진.png'))).toEqual(photo);
    // Copied, not moved.
    expect(await readFile(path.join(source.home, '여름 사진.png'))).toEqual(photo);
  },
}];

if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') for (const scenario of scenarios) test(`pasting into an XWayland folder tab: ${scenario.name}`, async () => {
  test.setTimeout(120_000);
  const input = await waylandInput();
  const fixtures: Fixture[] = [];
  try {
    const source = await launch('wayland', scenario.prepare);
    fixtures.push(source);
    expect(await source.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('wayland');
    // A Wayland client may own the clipboard only while it has keyboard focus and a
    // recent input serial. The first key gives the private seat its keyboard; wait
    // until a real key press has actually reached this application.
    await source.page.evaluate(() => addEventListener('keydown', event => { if (event.isTrusted) (globalThis as { realKey?: boolean }).realKey = true; }, true));
    await expect.poll(async () => {
      await input.send({ keys: ['Shift_L'] });
      return source.page.evaluate(() => (globalThis as { realKey?: boolean }).realKey === true);
    }).toBe(true);
    await scenario.copy(source, input);

    const target = await launch('x11');
    fixtures.push(target);
    expect(await target.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('x11');
    // The folder menu offers Paste for what the other application copied.
    await expect.poll(() => target.page.evaluate(() => window.marktex.explorer.clipboard()).then(value => !!value),
      { message: `clipboard formats: ${await target.app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap(item => item.types).join(', '))}` }).toBe(true);
    await list(target.page).focus();
    await target.page.keyboard.press('Control+v');
    await scenario.pasted(target, source);
    await expect(failure(target.page)).toHaveCount(0);
    expect(fixtures.flatMap(fixture => fixture.errors)).toEqual([]);
  } finally {
    for (const [index, fixture] of fixtures.entries()) {
      await fixture.page.screenshot({ path: test.info().outputPath(`wayland-clipboard-paste-${index}.png`) }).catch(() => {});
      await disposeApplication(fixture.app); await rm(fixture.root, { recursive: true, force: true });
    }
    await input.close();
  }
});
