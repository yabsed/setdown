import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { initialRecipe } from '../../../src/core/image/image-recipe';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="#ff0000"/><rect x="100" width="100" height="100" fill="#0000ff"/></svg>';
async function fixture(size?: { width: number; height: number }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-image-edit-')), file = path.join(root, 'photo.png');
  const image = sharp(Buffer.from(svg));
  if (size) image.resize(size.width, size.height);
  await writeFile(file, await image.png().toBuffer());
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  await focusApplication(app); const page = await app.firstWindow();
  const edit = page.locator('.image-editor').filter({ visible: true });
  await page.getByRole('button', { name: 'Edit image', exact: true }).click();
  await expect(edit.getByAltText('Edited preview')).toBeVisible();
  return { root, file, app, page, edit, dispose: async () => { await disposeApplication(app); await rm(root, { recursive: true, force: true }); } };
}

for (const [width, height, appZoom] of [[1281, 1037, 120], [921, 775, 130], [921, 775, 90]]) {
  test(`fit editing stays still without input at ${appZoom}% app zoom and ${width}×${height}`, async () => {
    const f = await fixture({ width: 1920, height: 1080 });
    try {
      await f.app.evaluate(({ BrowserWindow }, { width, height }) => {
        BrowserWindow.getAllWindows().find(w => w.isVisible())!.setSize(width, height);
      }, { width, height });
      await f.page.evaluate(steps => window.marktex.changeZoom(steps, 'app'), (appZoom - 100) / 10);
      await expect.poll(() => f.page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(appZoom);
      const geometry = async () => f.edit.evaluate(element => new Promise<Array<{ x: number; y: number; width: number; height: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }>>(resolve => {
        const viewport = element.querySelector<HTMLElement>('.preview')!, image = viewport.querySelector('img')!;
        const frames: Array<{ x: number; y: number; width: number; height: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }> = [];
        const sample = () => {
          const { x, y, width, height } = image.getBoundingClientRect();
          frames.push({ x, y, width, height, clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight,
            scrollWidth: viewport.scrollWidth, scrollHeight: viewport.scrollHeight });
          if (frames.length < 90) requestAnimationFrame(sample); else resolve(frames);
        };
        requestAnimationFrame(sample);
      }));
      const assertStill = async (name: string) => {
        const frames = await geometry();
        await writeFile(test.info().outputPath(`${name}.json`), JSON.stringify(frames, null, 2));
        const steady = frames.slice(20);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(Math.max(...steady.map(f => f[key])) - Math.min(...steady.map(f => f[key])), `${name}: ${key} drift`).toBeLessThan(1);
        for (const frame of steady) {
          expect(frame.scrollWidth - frame.clientWidth, `${name}: horizontal overflow`).toBeLessThanOrEqual(1);
          expect(frame.scrollHeight - frame.clientHeight, `${name}: vertical overflow`).toBeLessThanOrEqual(1);
        }
      };
      await assertStill('initial-fit');
      await f.edit.getByRole('button', { name: '100%', exact: true }).click();
      await f.edit.locator('.preview').evaluate(node => { node.scrollLeft = 137; node.scrollTop = 83; });
      await expect.poll(() => f.edit.locator('.preview').evaluate(node =>
        Math.abs(node.scrollLeft - 137) < 1 && Math.abs(node.scrollTop - 83) < 1)).toBe(true);
      await f.edit.getByRole('button', { name: 'Fit', exact: true }).click();
      await assertStill('return-to-fit');
      await expect(f.edit).toHaveAttribute('data-dirty', 'false');
      await expect(f.edit.getByLabel('Crop width', { exact: true })).toHaveValue('1920');
      await expect(f.edit.getByLabel('Crop height', { exact: true })).toHaveValue('1080');
      await f.page.screenshot({ path: test.info().outputPath('stable-fit.png') });
    } finally { await f.dispose(); }
  });
}

test('edits geometry and color, survives media eviction, exports correct pixels and keeps saved undo checkpoints', async () => {
  const f = await fixture();
  try {
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    await expect(f.edit.getByLabel('Output width')).toHaveValue('100');
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    await f.edit.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(f.edit.getByLabel('Output width')).toHaveValue('100');
    await f.edit.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(f.edit.getByLabel('Output width')).toHaveValue('200');
    await f.edit.getByRole('button', { name: 'Flip horizontal' }).click();
    // Rotate 180 then horizontal flip: original red half is again on the left.
    for (const [key, value] of Object.entries({ x: 0, y: 0, width: 100, height: 100 })) await f.edit.getByLabel(`Crop ${key}`, { exact: true }).fill(String(value));
    await f.edit.getByRole('button', { name: 'Apply crop' }).click();
    await f.edit.getByLabel('Output width').fill('50'); await f.edit.getByRole('button', { name: 'Apply size' }).click();
    await f.edit.getByLabel('brightness', { exact: true }).fill('0.1');
    await f.edit.getByLabel('brightness', { exact: true }).dispatchEvent('change');
    await expect(f.edit).toHaveAttribute('data-dirty', 'true');
    for (let i = 0; i < 4; i++) {
      const file = path.join(f.root, `other-${i}.png`); await writeFile(file, await readFile(f.file));
      await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
      await expect(f.page.getByRole('region', { name: 'Image reader', exact: true }).getByRole('img')).toHaveAttribute('alt', path.basename(file));
    }
    expect(await f.page.locator('.image-surface').count()).toBe(3);
    await f.page.getByRole('tab').filter({ hasText: 'photo.png' }).click();
    await expect(f.edit.getByLabel('Output width')).toHaveValue('50');
    await expect(f.edit.getByLabel('Crop width', { exact: true })).toHaveValue('100');
    await f.page.screenshot({ path: test.info().outputPath('image-editor.png') });
    await f.edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(f.edit).toHaveAttribute('data-dirty', 'false');
    const image = sharp(await readFile(f.file)); expect(await image.metadata()).toMatchObject({ width: 50, height: 50, format: 'png' });
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const center = (25 * 50 + 25) * info.channels; expect(data[center]).toBe(255); expect(data[center + 1]).toBeGreaterThan(20); expect(data[center + 2]).toBeLessThan(35);
    expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length)).toBe(1);
    await f.edit.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(f.edit).toHaveAttribute('data-dirty', 'true');
    await f.edit.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(f.edit).toHaveAttribute('data-dirty', 'false');
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    await f.page.keyboard.press('Control+z'); await expect(f.edit).toHaveAttribute('data-dirty', 'false');
    await f.page.keyboard.press('Control+Shift+z'); await expect(f.edit).toHaveAttribute('data-dirty', 'true');
    await f.page.keyboard.press('Control+s'); await expect(f.edit).toHaveAttribute('data-dirty', 'false');
  } finally { await f.dispose(); }
});

test('disk conflict preserves edits, canceled Save As stays dirty, and a delayed save preserves newer edits', async () => {
  const f = await fixture();
  try {
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    const external = await sharp({ create: { width: 60, height: 40, channels: 4, background: '#00ff00' } }).png().toBuffer();
    await writeFile(f.file, external);
    await expect(f.page.locator('.notice')).toBeVisible();
    await f.page.getByRole('button', { name: 'Keep My Changes', exact: true }).click();
    await f.edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(f.edit.getByRole('alert')).toContainText('changed on disk');
    await expect(f.edit).toHaveAttribute('data-dirty', 'true'); expect(await readFile(f.file)).toEqual(external);
    await f.app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
    await f.edit.getByRole('button', { name: 'Save As…' }).click(); await expect(f.edit.getByRole('button', { name: 'Save As…' })).toBeEnabled();
    await expect(f.edit).toHaveAttribute('data-dirty', 'true');
    const copy = path.join(f.root, 'copy.png');
    await f.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => new Promise(resolve => { (globalThis as any).finishImageSave = () => resolve({ canceled: false, filePath }); });
    }, copy);
    await f.edit.getByRole('button', { name: 'Save As…' }).click();
    await expect(f.edit.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    await f.app.evaluate(() => (globalThis as any).finishImageSave());
    await expect(f.page.getByRole('tab').filter({ hasText: 'copy.png' })).toBeVisible();
    await expect(f.edit).toHaveAttribute('data-dirty', 'true');
    expect(await sharp(await readFile(copy)).metadata()).toMatchObject({ width: 100, height: 200 });
    await expect(f.edit.getByLabel('Output width')).toHaveValue('200');
    await f.edit.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(f.edit).toHaveAttribute('data-dirty', 'false');
    expect(await readFile(f.file)).toEqual(external);
  } finally { await f.dispose(); }
});

test('EXIF 1–8 export upright pixels once and rejects animated or unowned inputs', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  try {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const file = path.join(f.root, `orientation-${orientation}.jpg`), output = path.join(f.root, `upright-${orientation}.png`);
      await writeFile(file, await sharp(Buffer.from(svg)).jpeg({ quality: 100 }).withMetadata({ orientation }).toBuffer());
      await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
      await expect(f.page.getByRole('region', { name: 'Image reader', exact: true }).getByRole('img')).toHaveAttribute('alt', path.basename(file));
      await f.app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, output);
      const width = orientation >= 5 ? 100 : 200, height = orientation >= 5 ? 200 : 100;
      await f.page.evaluate(async ({ file, recipe }) => {
        const doc = (await window.marktex.reloadDocument())!;
        const source = await window.marktex.imageEdit.open(file, doc.diskVersion);
        try { await window.marktex.imageEdit.save({ sourceId: source.id, document: doc, recipe, revision: 1, saveAs: true }); }
        finally { window.marktex.imageEdit.release(source.id); }
      }, { file, recipe: initialRecipe(width, height, 'png') });
      const expected = await sharp(await readFile(file)).autoOrient().removeAlpha().raw().toBuffer();
      const actual = await sharp(await readFile(output)).removeAlpha().raw().toBuffer();
      expect(actual.length).toBe(expected.length);
      const difference = actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length;
      expect(difference).toBeLessThan(3);
    }
    const unowned = path.join(f.root, 'unowned.png'); await writeFile(unowned, await readFile(f.file));
    expect(await f.page.evaluate(async file => {
      try { await window.marktex.imageEdit.open(file, { size: 0, mtimeMs: 0 }); return 'allowed'; } catch (error) { return String(error); }
    }, unowned)).toContain('open PNG');
    const animated = path.join(f.root, 'animated.webp');
    const frames = Buffer.alloc(4 * 8 * 4);
    for (let i = 0; i < 32; i++) { frames[i * 4 + (i < 16 ? 0 : 2)] = 255; frames[i * 4 + 3] = 255; }
    const animation = await sharp(frames, { raw: { width: 4, height: 8, channels: 4, pageHeight: 4 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animation).metadata()).pages).toBe(2);
    await writeFile(animated, animation);
    await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), animated);
    await f.page.getByRole('button', { name: 'Edit image', exact: true }).click();
    await expect(f.page.getByRole('alert')).toContainText('Animated images cannot be edited');
  } finally { await f.dispose(); }
});

test('PNG/WebP keep alpha, JPEG flattens white, pointer crop survives resize and close saves binary content', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'alpha.png');
    await writeFile(file, await sharp({ create: { width: 240, height: 120, channels: 4, background: '#ff000080' } }).png().toBuffer());
    await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    await f.page.getByRole('button', { name: 'Edit image', exact: true }).click();
    await expect(f.edit.getByAltText('Edited preview')).toBeVisible();
    await f.edit.getByRole('button', { name: 'Select crop' }).click();
    const box = (await f.edit.getByAltText('Edited preview').boundingBox())!;
    await f.page.mouse.move(box.x + 60, box.y + 30); await f.page.mouse.down();
    await f.page.mouse.move(box.x + 180, box.y + 90); await f.page.mouse.up();
    await expect(f.edit.getByLabel('Crop x', { exact: true })).toHaveValue('60');
    await expect(f.edit.getByLabel('Crop width', { exact: true })).toHaveValue('120');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible())!.setSize(940, 700));
    await expect(f.edit.getByLabel('Crop width', { exact: true })).toHaveValue('120');
    await f.edit.getByRole('button', { name: 'Apply crop' }).click();
    for (const format of ['webp', 'jpeg', 'png'] as const) {
      const output = path.join(f.root, `saved.${format === 'jpeg' ? 'jpg' : format}`);
      await f.edit.getByLabel('Image format', { exact: true }).selectOption(format);
      await f.app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, output);
      await f.edit.getByRole('button', { name: 'Save As…' }).click();
      await expect(f.page.getByRole('tab').filter({ hasText: path.basename(output) })).toBeVisible();
      await expect(f.edit).toHaveAttribute('data-dirty', 'false');
      expect(await sharp(await readFile(output)).metadata()).toMatchObject({ width: 120, height: 60, format });
      const { data, info } = await sharp(await readFile(output)).raw().toBuffer({ resolveWithObject: true });
      if (format === 'jpeg') { expect(info.channels).toBe(3); expect(data[1]).toBeGreaterThan(120); expect(data[1]).toBeLessThan(135); }
      else { expect(info.channels).toBe(4); expect(data[3]).toBe(128); }
    }
    await f.edit.getByRole('button', { name: 'Rotate 90°' }).click();
    await f.page.getByRole('tab').filter({ hasText: 'saved.png' }).getByTitle('Close tab', { exact: true }).click();
    await f.page.getByRole('dialog', { name: 'Save Changes' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(f.page.getByRole('tab').filter({ hasText: 'saved.png' })).toHaveCount(0);
    expect(await sharp(await readFile(path.join(f.root, 'saved.png'))).metadata()).toMatchObject({ width: 60, height: 120 });
  } finally { await f.dispose(); }
});

test('1, 6 and 24 MP previews resolve full detail at 100%; 48 MP editing is rejected before decode', async () => {
  test.setTimeout(120_000);
  const f = await fixture();
  const timings: Array<{ pixels: number; openMs: number; detailMs: number }> = [];
  try {
    for (const [width, height] of [[1000, 1000], [3000, 2000], [6000, 4000]]) {
      const file = path.join(f.root, `${width}.png`);
      await writeFile(file, await sharp({ create: { width, height, channels: 3, background: '#8060c0' } }).png().toBuffer());
      await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
      const opened = Date.now();
      await f.page.getByRole('button', { name: 'Edit image', exact: true }).click();
      await expect(f.edit.getByAltText('Edited preview')).toBeVisible();
      const detail = Date.now();
      await f.edit.getByRole('button', { name: '100%', exact: true }).click();
      await expect(f.edit.getByAltText('Edited preview')).toHaveJSProperty('naturalWidth', width);
      await expect(f.edit).toHaveAttribute('data-rendering', 'false');
      timings.push({ pixels: width * height, openMs: detail - opened, detailMs: Date.now() - detail });
      expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    }
    const tooLarge = path.join(f.root, '48mp.png');
    await writeFile(tooLarge, await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#8060c0' } }).png().toBuffer());
    await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), tooLarge);
    await f.page.getByRole('button', { name: 'Edit image', exact: true }).click();
    await expect(f.page.getByRole('alert')).toContainText(/pixel limit|24 megapixels/);
    await test.info().attach('image-size-timings.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  } finally { await f.dispose(); }
});

test('hidden full-resolution rendering preserves native focus and an unfinished Korean composition', async () => {
  const f = await fixture();
  try {
    const cdp = await f.page.context().newCDPSession(f.page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const input = f.page.locator('.location-bar input:visible'); await input.click(); await input.fill('');
    await f.page.evaluate(() => {
      const log = { blur: 0, starts: 0, ends: 0 }; (window as any).imageImeLog = log;
      const input = document.activeElement!;
      input.addEventListener('blur', () => log.blur++); window.addEventListener('blur', () => log.blur++);
      input.addEventListener('compositionstart', () => log.starts++); input.addEventListener('compositionend', () => log.ends++);
    });
    await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
    await f.page.evaluate(async ({ file, recipe }) => {
      const doc = (await window.marktex.reloadDocument())!;
      const source = await window.marktex.imageEdit.open(file, doc.diskVersion);
      try {
        const bytes = await window.marktex.imageEdit.render(source.id, recipe);
        if (!bytes.length) throw Error('No rendered pixels.');
      } finally { window.marktex.imageEdit.release(source.id); }
    }, { file: f.file, recipe: initialRecipe(200, 100, 'png') });
    expect(await f.page.evaluate(() => (window as any).imageImeLog)).toEqual({ blur: 0, starts: 1, ends: 0 });
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await expect(input).toHaveValue('한');
    await cdp.send('Input.insertText', { text: '한' });
    await expect(input).toHaveValue('한');
    expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.isVisible())).toBe(true);
    await cdp.detach();
  } finally { await f.dispose(); }
});

test('releasing an original cancels a stalled export and destroys its hidden window', async () => {
  const f = await fixture();
  try {
    const recipe = initialRecipe(200, 100, 'png');
    const sourceId = await f.page.evaluate(async ({ file, recipe }) => {
      const doc = (await window.marktex.reloadDocument())!;
      const source = await window.marktex.imageEdit.open(file, doc.diskVersion);
      await window.marktex.imageEdit.render(source.id, recipe);
      return source.id;
    }, { file: f.file, recipe });
    // Hold a real export renderer at its job request to deterministically model
    // a stalled decoder. Source release must not wait for the 90-second timeout.
    await f.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('image-export:job');
      ipcMain.handle('image-export:job', () => {
        (globalThis as any).imageJobWaiting = true; return new Promise(() => {});
      });
    });
    await f.page.evaluate(({ sourceId, recipe }) => {
      (window as any).pendingImageRender = window.marktex.imageEdit.render(sourceId, recipe).then(() => 'unexpected success', error => String(error));
    }, { sourceId, recipe });
    await expect.poll(() => f.app.evaluate(() => (globalThis as any).imageJobWaiting)).toBe(true);
    expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length)).toBe(1);
    await f.page.evaluate(sourceId => window.marktex.imageEdit.release(sourceId), sourceId);
    expect(await f.page.evaluate(() => (window as any).pendingImageRender)).toContain('no longer open');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally { await f.dispose(); }
});
