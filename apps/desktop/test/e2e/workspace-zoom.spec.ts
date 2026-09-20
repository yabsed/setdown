import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

type Application = Awaited<ReturnType<typeof electron.launch>>;
async function state(application: Application) {
  return application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find(window => window.isVisible());
    if (!owner) throw new Error('No visible workspace');
    const rows = owner.contentView.children.flatMap(view => {
      if (!('webContents' in view)) return [];
      const contents = (view as Electron.WebContentsView).webContents;
      if (!contents.getURL().startsWith('marktex-preview://document/')) return [];
      return [{ id: contents.id, url: contents.getURL(), factor: contents.getZoomFactor(),
        visible: view.getVisible(), bounds: view.getBounds() }];
    });
    return { factor: owner.webContents.getZoomFactor(), size: owner.getContentSize(), rows };
  });
}
async function nativeWheel(application: Application, preview: boolean) {
  await application.evaluate(({ BrowserWindow }, usePreview) => {
    const owner = BrowserWindow.getAllWindows().find(window => window.isVisible());
    if (!owner) throw new Error('No visible workspace');
    const child = owner.contentView.children.find(view => view.getVisible() && 'webContents' in view);
    const contents = usePreview && child
      ? (child as Electron.WebContentsView).webContents : owner.webContents;
    contents.sendInputEvent({ type: 'mouseWheel', x: 100, y: 100,
      deltaX: 0, deltaY: 120, modifiers: ['control'], canScroll: true });
  }, preview);
}

for (const extension of ['md', 'txt']) test(`Ctrl+wheel zooms ${extension} without recreating document views`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-zoom-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-zoom-config-'));
  const file = path.join(root, `document.${extension}`);
  await writeFile(file, '# Zoom\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}\n\n`).join(''));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const window = await application.firstWindow();
    if (extension === 'md') await expect.poll(async () => (await state(application)).rows.some(row => row.visible)).toBe(true);
    else await expect(window.locator('.editor-surface')).toBeVisible();
    const original = await state(application);
    const identity = original.rows.filter(row => row.visible).map(({ id, url }) => ({ id, url }));
    await nativeWheel(application, false);
    await expect.poll(async () => (await state(application)).factor).not.toBe(original.factor);
    await expect.poll(async () => {
      const current = await state(application);
      return current.rows.every(row => Math.abs(row.factor - current.factor) < .0001);
    }).toBe(true);
    if (extension === 'md') {
      const beforePreviewWheel = (await state(application)).factor;
      await nativeWheel(application, true);
      await expect.poll(async () => (await state(application)).factor).not.toBe(beforePreviewWheel);
      expect((await state(application)).rows.filter(row => row.visible).map(({ id, url }) => ({ id, url }))).toEqual(identity);
    } else expect((await state(application)).rows).toHaveLength(0);
    await window.keyboard.press('Control+0');
    await expect.poll(async () => (await state(application)).factor).toBe(1);
    await expect.poll(async () => (await state(application)).rows.every(row => row.factor === 1)).toBe(true);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
