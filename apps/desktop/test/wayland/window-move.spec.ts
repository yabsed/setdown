import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication } from '../support/electron/electron-app';
import { waylandInput } from '../support/electron/wayland-input';

// Only the compatibility run can read a window's position back: there the app is an X11 client of the
// private compositor, which moves it as a desktop's window manager does.
if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') test('the free end of the top strip moves the window, right up to the window buttons', async () => {
  const input = await waylandInput();
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-window-move-'));
  await writeFile(path.join(root, 'one.txt'), 'one\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['--ozone-platform=x11', '.', path.join(root, 'one.txt')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } })
    .catch(async error => { await input.close(); throw error; });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('tab', { name: /one\.txt/ })).toBeVisible();
    await focusApplication(app);
    const owner = await app.browserWindow(page);
    const free = await page.evaluate(() => {
      const area = (navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay.getTitlebarAreaRect();
      return area.x + area.width;
    });
    const width = await page.evaluate(() => innerWidth);
    expect(free).toBeLessThan(width);
    const bounds = () => owner.evaluate(window => window.getBounds());
    const screen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const content = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: content.x + point.x * zoom, y: content.y + point.y * zoom };
    }, point);
    const press = async (point: { x: number; y: number }, by: { x: number; y: number }) => {
      const from = await screen(point);
      await input.send({ pointer: [from], button: 'down' });
      await input.send({ pointer: [{ x: from.x + by.x / 4, y: from.y + by.y / 4 }, { x: from.x + by.x / 2, y: from.y + by.y / 2 }, { x: from.x + by.x, y: from.y + by.y }] });
      await input.send({ button: 'up' });
    };
    // A person's pointer is over the window before it presses. The page seeing it there is the proof;
    // a press sent in the same instant as the pointer's first arrival is not delivered as a window move.
    // The pointer is shown again until the page has seen it, as focusApplication repeats its focus request.
    const tab = (await page.getByRole('tab', { name: /one\.txt/ }).boundingBox())!;
    const over = await screen({ x: tab.x + 30, y: tab.y + tab.height / 2 });
    await page.evaluate(() => addEventListener('mousemove', () => { document.documentElement.dataset.pointerSeen = 'true'; }, { once: true }));
    await expect.poll(async () => {
      await input.send({ pointer: [{ x: over.x - 5, y: over.y }, over] });
      return page.evaluate(() => document.documentElement.dataset.pointerSeen);
    }).toBe('true');

    // Right beside the window buttons, in the strip's top padding, and the middle of the free end.
    // The window manager takes over within the pointer's first steps and the window follows the rest of the way.
    for (const point of [{ x: free - 3, y: 18 }, { x: free - 40, y: 1 }, { x: free - 60, y: 18 }]) {
      const before = await bounds();
      await press(point, { x: -60, y: 40 });
      await expect.poll(async () => { const after = await bounds(); return { left: before.x - after.x >= 25, down: after.y - before.y >= 15, size: [after.width, after.height] }; },
        { message: `pressed at ${point.x},${point.y}` }).toEqual({ left: true, down: true, size: [before.width, before.height] });
    }
  } finally {
    await disposeApplication(app); await input.close();
    await rm(root, { recursive: true, force: true });
  }
});
