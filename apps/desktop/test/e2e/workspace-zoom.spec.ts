import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pdfFixture } from './pdf-fixture';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';

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

for (const extension of ['md', 'txt']) test(`text wheel zoom and app shortcuts have independent scopes in ${extension}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-zoom-'));
  const file = path.join(root, `document.${extension}`);
  await writeFile(file, '# Zoom\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}\n\n`).join(''));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const options = { args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } };
  let application = await electron.launch(options);
  try {
    const window = await application.firstWindow();
    await focusApplication(application);
    if (extension === 'md') await expect.poll(async () => (await state(application)).rows.some(row => row.visible)).toBe(true);
    else await expect(window.locator('.monaco-editor')).toBeVisible();
    const original = await state(application);
    const identity = original.rows.filter(row => row.visible).map(({ id, url }) => ({ id, url }));
    if (extension === 'md') await nativeWheel(application, true);
    else {
      await window.locator('.monaco-editor').hover();
      await window.keyboard.down('Control'); await window.mouse.wheel(0, -120); await window.keyboard.up('Control');
    }
    await expect.poll(() => window.evaluate(async () => (await window.marktex.getZoom()).text)).toBe(110);
    expect((await state(application)).factor).toBe(1);
    if (extension === 'md') {
      await expect.poll(async () => (await state(application)).rows.filter(row => row.visible).every(row => Math.abs(row.factor - 1.1) < .0001)).toBe(true);
      expect((await state(application)).rows.filter(row => row.visible).map(({ id, url }) => ({ id, url }))).toEqual(identity);
      await window.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    }
    await expect(window.locator('.monaco-editor')).toBeVisible();
    await expect.poll(() => window.locator('.monaco-editor .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(15.4, 1);
    await window.keyboard.press('Control+=');
    await expect.poll(async () => (await state(application)).factor).toBeCloseTo(1.1, 4);
    await window.keyboard.press('Control+-');
    await expect.poll(async () => (await state(application)).factor).toBe(1);
    await window.keyboard.press('Control+=');
    await window.keyboard.press('Control+0');
    await expect.poll(() => window.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(100);
    expect(await window.evaluate(async () => (await window.marktex.getZoom()).text)).toBe(110);
    await window.keyboard.press('Control+=');
    // Graceful close flushes preferences. A new process inherits both scopes.
    await disposeApplication(application);
    application = await electron.launch(options);
    const restored = await application.firstWindow();
    await focusApplication(application);
    await expect.poll(() => restored.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 110, text: 110 });
    await expect.poll(async () => (await state(application)).factor).toBeCloseTo(1.1, 4);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});

test('PDF and image wheel zoom preserve the cursor point, file state and fit mode across app zoom', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-media-zoom-'));
  const pdf = path.join(root, 'one.pdf'), other = path.join(root, 'two.pdf');
  const image = path.join(root, 'large.svg'), otherImage = path.join(root, 'other.svg');
  await writeFile(pdf, pdfFixture()); await writeFile(other, pdfFixture());
  for (const file of [image, otherImage]) await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="2400" height="1800" fill="skyblue"/></svg>');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', pdf], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const reader = page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(reader).toHaveAttribute('data-pdf-pages', '12');
    const pdfZoom = () => reader.getByRole('combobox', { name: 'PDF zoom' });
    await expect(pdfZoom()).toHaveValue('page-width');
    const width = await reader.locator('.page').first().evaluate(node => node.getBoundingClientRect().width);
    await page.keyboard.press('Control+=');
    await expect.poll(() => reader.locator('.page').first().evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(width - 20);
    await expect(pdfZoom()).toHaveValue('page-width');
    await page.keyboard.press('Control+0');
    await reader.getByRole('button', { name: '100%', exact: true }).click();
    const target = reader.locator('.page').first();
    const box = (await target.boundingBox())!;
    const point = { x: box.x + box.width * .45, y: box.y + 180 };
    const coordinate = () => target.evaluate((node, point) => {
      const r = node.getBoundingClientRect(); return [(point.x - r.left) / r.width, (point.y - r.top) / r.height];
    }, point);
    const before = await coordinate();
    await page.mouse.move(point.x, point.y); await page.keyboard.down('Control');
    await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
    await expect.poll(async () => Number(await pdfZoom().inputValue())).toBeGreaterThan(1);
    const after = await coordinate();
    expect(Math.abs(after[0] - before[0])).toBeLessThan(.005);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(.005);
    const savedPdfZoom = await pdfZoom().inputValue();
    expect((await state(app)).factor).toBe(1);
    expect(await page.evaluate(async () => (await window.marktex.getZoom()).text)).toBe(100);
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
    await expect(reader).toHaveAttribute('data-pdf-pages', '12'); await expect(pdfZoom()).toHaveValue('page-width');
    await page.getByRole('tab').filter({ hasText: 'one.pdf' }).click();
    await expect(pdfZoom()).toHaveValue(savedPdfZoom);
    await page.keyboard.press('Control+0'); await expect(pdfZoom()).toHaveValue(savedPdfZoom);
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), image);
    const imageReader = page.getByRole('region', { name: 'Image reader', exact: true });
    await expect(imageReader).toHaveAttribute('data-image-ready', 'true');
    await imageReader.getByRole('button', { name: '100%', exact: true }).click();
    const viewport = imageReader.getByRole('region', { name: 'Image canvas' });
    await viewport.evaluate(node => { node.scrollLeft = 500; node.scrollTop = 400; });
    const imageBox = (await viewport.boundingBox())!;
    const imagePoint = { x: imageBox.x + 240, y: imageBox.y + 210 };
    const imageCoordinate = () => imageReader.locator('img').evaluate((node, point) => {
      const r = node.getBoundingClientRect(); return [(point.x - r.left) / r.width, (point.y - r.top) / r.height];
    }, imagePoint);
    const imageBefore = await imageCoordinate();
    await page.mouse.move(imagePoint.x, imagePoint.y); await page.keyboard.down('Control');
    await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
    const imageZoom = () => imageReader.getByRole('combobox', { name: 'Image zoom' });
    await expect.poll(async () => Number(await imageZoom().inputValue())).toBeCloseTo(1.1, 4);
    const imageAfter = await imageCoordinate();
    expect(Math.abs(imageAfter[0] - imageBefore[0])).toBeLessThan(.001);
    expect(Math.abs(imageAfter[1] - imageBefore[1])).toBeLessThan(.001);
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), otherImage);
    await expect(imageReader).toHaveAttribute('data-image-ready', 'true'); await expect(imageZoom()).toHaveValue('fit');
    await page.getByRole('tab').filter({ hasText: 'large.svg' }).click();
    await expect(imageZoom()).toHaveValue('1.1');
    await page.keyboard.press('Control+='); await page.keyboard.press('Control+0');
    await expect(imageZoom()).toHaveValue('1.1');
    expect(await page.evaluate(async () => (await window.marktex.getZoom()).text)).toBe(100);
    await imageReader.getByRole('button', { name: 'Fit width', exact: true }).click();
    await expect(imageZoom()).toHaveValue('fit-width');
    const fitWidth = await imageReader.locator('img').evaluate(node => node.getBoundingClientRect().width);
    await page.keyboard.press('Control+=');
    await expect.poll(() => imageReader.locator('img').evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(fitWidth - 20);
    await expect(imageZoom()).toHaveValue('fit-width');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Git review, ordinary editors and a second window share text zoom without replacing models', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-zoom-'));
  const file = path.join(root, 'review.md');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  await writeFile(path.join(root, '.gitignore'), 'config/\n');
  await writeFile(file, '# Before\n\nText\n'); git('add', '.'); git('commit', '-m', 'base');
  await writeFile(file, '# After\n\nText\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
    const editor = page.getByRole('textbox', { name: 'Current document', exact: true });
    await expect(editor).toBeEditable();
    await editor.press('Control+End'); await editor.pressSequentially('Zoom undo sentinel');
    await page.locator('.git-diff-editor .monaco-editor').last().hover();
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
    await expect.poll(() => page.evaluate(async () => (await window.marktex.getZoom()).text)).toBe(110);
    await expect.poll(() => page.locator('.git-diff-editor .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(15.4, 1);
    // Text sizing must retain the editable model and undo stack.
    await editor.press('Control+z');
    await expect(page.locator('.git-diff-editor')).not.toContainText('Zoom undo sentinel');
    await page.getByRole('tab').filter({ hasText: 'review.md' }).first().click();
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await expect.poll(() => page.locator('.editor-surface .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(15.4, 1);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
    const shells = () => app.windows().filter(window => window.url().startsWith('file:'));
    await expect.poll(() => shells().length).toBe(2);
    const second = shells().find(window => window !== page)!;
    await expect.poll(() => second.evaluate(() => window.marktex.getZoom())).toMatchObject({ text: 110, app: 100 });
    await second.evaluate(() => window.marktex.executeApplicationMenuItem('menu-zoom-in'));
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom())).toMatchObject({ text: 110, app: 110 });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => Math.abs(window.webContents.getZoomFactor() - 1.1) < .0001))).toBe(true);
    await second.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reset-text-zoom'));
    await expect.poll(() => page.locator('.editor-surface .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(14);
    expect(await page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(110);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
