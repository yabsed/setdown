import { _electron as electron, expect, test } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';
import { previews } from './preview-view';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const launch = async (file: string, config: string) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};

test('opens video files, streams them with range requests and prevents text saves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-videos-'));
  const mp4 = path.join(root, 'clip.mp4'), webm = path.join(root, 'clip.webm');
  await copyFile(path.join(fixtures, 'clip.mp4'), mp4);
  await copyFile(path.join(fixtures, 'clip.webm'), webm);
  const app = await launch(mp4, path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const reader = page.getByRole('region', { name: 'Video reader', exact: true });
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'video');
    await expect(reader).toHaveAttribute('data-video-ready', 'true');
    const video = reader.locator('video');
    const src = await video.getAttribute('src');
    expect(src).toMatch(/^marktex-resource:\/\/file\/.*clip\.mp4$/);
    expect(await video.evaluate((node: HTMLVideoElement) => [node.readyState, node.duration])).toEqual([4, 2]);
    expect(await previews(app).count()).toBe(0);
    // Seeking is answered by explicit partial responses, not a buffered file.
    const range = await page.evaluate(async (url) => {
      const response = await fetch(url!, { headers: { Range: 'bytes=0-99' } });
      return { status: response.status, size: (await response.arrayBuffer()).byteLength,
        contentRange: response.headers.get('content-range') };
    }, src);
    expect(range.status).toBe(206);
    expect(range.size).toBe(100);
    expect(range.contentRange).toMatch(/^bytes 0-99\/\d+$/);
    const before = await readFile(mp4);
    await page.keyboard.press('Control+s');
    expect(await readFile(mp4)).toEqual(before);
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), webm);
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'video');
    await expect(reader).toHaveAttribute('data-video-ready', 'true');
    await expect(reader.locator('video')).toHaveAttribute('src', /clip\.webm$/);
    expect(await page.locator('.video-surface').count()).toBe(2);
    const invalid = path.join(root, 'invalid.mp4'); await writeFile(invalid, 'not a video');
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), invalid);
    await expect(reader.getByRole('alert')).toContainText('Could not play this video');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('restores the playback position after restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-video-history-'));
  const file = path.join(root, 'clip.webm'), config = path.join(root, 'config');
  await copyFile(path.join(fixtures, 'clip.webm'), file);
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = () => page.getByRole('region', { name: 'Video reader', exact: true });
    await expect(reader()).toHaveAttribute('data-video-ready', 'true');
    await focusApplication(app);
    await reader().locator('video').evaluate((node: HTMLVideoElement) => {
      node.currentTime = 1;
      node.dispatchEvent(new Event('pause'));
    });
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition))
      .toMatchObject({ kind: 'video', time: 1 });
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await expect(reader()).toHaveAttribute('data-video-ready', 'true');
    await expect.poll(() => reader().locator('video').evaluate((node: HTMLVideoElement) => node.currentTime)).toBe(1);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
