import { expect, test, type Locator } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const exec = promisify(execFile);
const png = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
async function pixels(image: Locator, width: number, height: number, color: number[]) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0);
    return { width: element.naturalWidth, height: element.naturalHeight, color: [...context.getImageData(0, 0, 1, 1).data] };
  })).toEqual({ width, height, color });
}

test('image reviews show real HEAD, index, working and historical pixels with shared tab zoom', async () => {
  test.setTimeout(120_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-image-diff-'));
  const root = path.join(temporary, 'repo');
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init', '-b', 'main', root]);
    await git('config', 'user.name', 'Image Test'); await git('config', 'user.email', 'image@example.test');
    const file = path.join(root, 'photo.png');
    const red = await png(120, 80, '#ff0000'), green = await png(140, 85, '#00ff00'), blue = await png(160, 90, '#0000ff');
    await writeFile(file, red); await git('add', '.'); await git('commit', '-m', 'Original image');
    await writeFile(file, green); await git('commit', '-am', 'Updated image');
    const second = (await git('rev-parse', 'HEAD')).stdout.trim();
    await writeFile(file, red); await git('add', '.'); await writeFile(file, blue);
    await writeFile(path.join(root, 'new.webp'), await sharp(red).webp({ lossless: true }).toBuffer());
    await writeFile(path.join(root, 'broken.png'), 'not an image');
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload(); await focusApplication(app);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const open = async (name: string, staged = false) => {
      const group = page.locator('.scm-group').filter({ has: page.locator('.scm-heading strong', { hasText: staged ? /^STAGED CHANGES$/ : /^CHANGES$/ }) });
      await group.locator('.git-change-open').filter({ has: page.locator('.git-change-name', { hasText: name }) }).click();
    };
    const comparison = page.getByRole('region', { name: 'Image comparison', exact: true });
    const original = comparison.getByRole('region', { name: 'Original image', exact: true });
    const modified = comparison.getByRole('region', { name: 'Modified image', exact: true });
    await open('photo.png');
    await pixels(original.locator('img'), 120, 80, [255, 0, 0, 255]);
    await pixels(modified.locator('img'), 160, 90, [0, 0, 255, 255]);
    await expect(original).toContainText('INDEX'); await expect(modified).toContainText('Working Tree');
    await comparison.getByLabel('Image comparison zoom').selectOption('2');
    await expect(original.locator('img')).toHaveCSS('width', '240px');
    await expect(modified.locator('img')).toHaveCSS('width', '320px');
    await comparison.getByLabel('Image comparison zoom').selectOption('fit');
    await expect(original.locator('img')).toHaveCSS('width', '120px');
    await modified.locator('img').hover();
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
    await expect(page.getByRole('button', { name: 'Reset text zoom', exact: true })).toHaveText('110%');
    await expect(original.locator('img')).toHaveCSS('width', '132px');
    await expect(modified.locator('img')).toHaveCSS('width', '176px');
    await page.getByRole('button', { name: 'Reset text zoom', exact: true }).click();
    await expect(comparison.getByLabel('Image comparison zoom')).toHaveValue('1');
    await expect(modified.locator('img')).toHaveCSS('width', '160px');
    await page.screenshot({ path: test.info().outputPath('image-working-diff.png') });
    await open('photo.png', true);
    await pixels(original.locator('img'), 140, 85, [0, 255, 0, 255]);
    await pixels(modified.locator('img'), 120, 80, [255, 0, 0, 255]);
    await expect(original).toContainText('HEAD'); await expect(modified).toContainText('INDEX');
    await open('new.webp'); await expect(original).toContainText('No image in this version.');
    await pixels(modified.locator('img'), 120, 80, [255, 0, 0, 255]);
    await open('broken.png'); await expect(modified).toContainText('could not be decoded');
    await rm(file); await page.getByRole('button', { name: 'Refresh Source Control' }).click();
    await open('photo.png'); await expect(modified).toContainText('No image in this version.');
    await pixels(original.locator('img'), 120, 80, [255, 0, 0, 255]);
    const graph = page.locator('web-git-graph');
    await graph.locator(`.row[data-oid="${second}"]`).click();
    await graph.locator('.tree-file').click();
    await pixels(original.locator('img'), 120, 80, [255, 0, 0, 255]);
    await pixels(modified.locator('img'), 140, 85, [0, 255, 0, 255]);
    await expect(page.getByRole('button', { name: 'View Rendered Diff' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('image-history-diff.png') });
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(errors).toEqual([]);
  } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
});
