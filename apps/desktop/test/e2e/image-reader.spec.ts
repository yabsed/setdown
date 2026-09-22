import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { disposeApplication, focusApplication } from './electron-app';
import { previews } from './preview-view';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e05030"/><circle cx="600" cy="400" r="220" fill="#2050c0"/></svg>';
const launch = async (file: string, config: string) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};

test('opens every supported image format, preserves the bitmap across tab switches and prevents text saves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-images-'));
  const markdown = path.join(root, 'notes.md');
  await writeFile(markdown, '# Image notes');
  const files: string[] = [];
  for (const format of ['png', 'jpeg', 'webp', 'gif', 'avif', 'svg'] as const) {
    const file = path.join(root, `picture.${format}`); files.push(file);
    await writeFile(file, format === 'svg' ? svg : await sharp(Buffer.from(svg)).toFormat(format).toBuffer());
  }
  const jpg = path.join(root, 'picture.JPG'); await writeFile(jpg, await readFile(files[1])); files.push(jpg);
  const app = await launch(files[0], path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const reader = page.getByRole('region', { name: 'Image reader', exact: true });
    for (const file of files) {
      if (file !== files[0]) await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), file);
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'image');
      await expect(reader).toHaveAttribute('data-image-ready', 'true');
      await expect(reader.getByRole('img')).toHaveAttribute('alt', path.basename(file));
      expect(await reader.getByRole('img').evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([1200, 800]);
      await expect(reader.locator('.image-dimensions')).toHaveText('1200 × 800');
      if (file === files[0]) await page.screenshot({ path: test.info().outputPath('image-reader.png') });
      expect(await previews(app).count()).toBe(0);
      const before = await readFile(file);
      await page.keyboard.press('Control+s');
      expect(await readFile(file)).toEqual(before);
    }
    expect(await page.locator('.image-surface').count()).toBe(3);
    const image = await reader.getByRole('img').elementHandle();
    const url = await reader.getByRole('img').getAttribute('src');
    // Generating and opening every codec can outlive the compositor's initial
    // focus grant. Reading-position IPC deliberately ignores background
    // windows, so establish native focus again before the input under test.
    await focusApplication(app);
    await reader.getByRole('combobox', { name: 'Image zoom' }).selectOption('2');
    await reader.getByRole('button', { name: 'Rotate image' }).click();
    await reader.getByRole('region', { name: 'Image canvas' }).evaluate((node) => { node.scrollTop = 300; node.scrollLeft = 150; });
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'image', zoom: 2, rotation: 90 });
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
    await expect.poll(previews(app).hasVisible).toBe(true);
    await expect(reader).toBeHidden();
    await page.getByRole('tab').filter({ hasText: 'picture.JPG' }).click();
    await expect(reader.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('2');
    expect(await reader.getByRole('img').getAttribute('src')).toBe(url);
    expect(await image!.evaluate((node) => node.isConnected)).toBe(true);
    await page.getByRole('tab').filter({ hasText: 'picture.JPG' }).getByTitle('Close tab', { exact: true }).click();
    expect(await image!.evaluate((node) => node.isConnected)).toBe(false);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('restores image zoom, rotation and pan after restart; reloads changed content and reports invalid images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-image-history-'));
  const file = path.join(root, 'drawing.svg'), config = path.join(root, 'config');
  // Scripts embedded in an SVG must not execute in the shell.
  await writeFile(file, svg.replace('</svg>', '<script>parent.document.title="SVG SCRIPT EXECUTED"</script></svg>'));
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = () => page.getByRole('region', { name: 'Image reader', exact: true });
    await expect(reader()).toHaveAttribute('data-image-ready', 'true');
    expect(await page.title()).not.toBe('SVG SCRIPT EXECUTED');
    await reader().getByRole('combobox', { name: 'Image zoom' }).selectOption('2');
    await reader().getByRole('button', { name: 'Rotate image' }).click();
    const center = await reader().getByRole('region', { name: 'Image canvas' }).evaluate((node) => {
      node.scrollLeft = 220; node.scrollTop = 350;
      const stage = node.querySelector<HTMLElement>('.image-stage')!;
      return { centerX: (node.scrollLeft + node.clientWidth / 2) / parseFloat(stage.style.width),
        centerY: (node.scrollTop + node.clientHeight / 2) / parseFloat(stage.style.height) };
    });
    // Scroll events persist asynchronously. Wait for the actual pan, not the
    // preceding rotation's centered position, before comparing a restart.
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition))
      .toMatchObject({ kind: 'image', zoom: 2, rotation: 90, ...center });
    const position = await page.evaluate(async () => (await window.marktex.reloadDocument())!.readingPosition);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await expect(reader()).toHaveAttribute('data-image-ready', 'true');
    await expect(reader().getByRole('combobox', { name: 'Image zoom' })).toHaveValue('2');
    await expect(reader().getByRole('img')).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
    await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject(position!);
    await writeFile(file, svg.replace('width="1200" height="800"', 'width="600" height="400"'));
    // Read-only documents reload automatically on the file watcher notification.
    await expect(reader().locator('.image-dimensions')).toHaveText('600 × 400');
    const invalid = path.join(root, 'invalid.png'); await writeFile(invalid, 'not an image');
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), invalid);
    await expect(reader().getByRole('alert')).toContainText('Could not open this image');
    const unopened = path.join(root, 'unopened.png'); await writeFile(unopened, 'bytes');
    expect(await page.evaluate(async (file) => {
      try { await window.marktex.readImageBytes(file, { size: 5, mtimeMs: 0 }); return 'allowed'; }
      catch (error) { return String(error); }
    }, unopened)).toContain('not open in this window');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
