import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';
import { openApplicationMenu } from '../../support/electron/application-menu';
import { nativeInput } from '../../support/electron/native-input';
import { pdfFixture } from '../../support/media/pdf-fixture';
import { pngFixture } from '../../support/media/png-fixture';

const fixtures = path.join(import.meta.dirname, '../../fixtures');
const entry = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
/** A tab's file as the OS clipboard offers it to other applications. */
const offered = (app: TestApplication) => app.evaluate(async ({ clipboard }) => {
  const formats: Record<string, string> = {};
  for (const item of await clipboard.read()) for (const type of item.types) {
    const name = /format="([^"]+)"/.exec(type)?.[1] ?? type;
    if (!/uri-list|gnome-copied-files/.test(name)) continue;
    const data = await item.getType(type);
    formats[name] = 'text' in data ? await data.text() : '';
  }
  return formats;
});

async function launch() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-file-copy-'));
  // The copied files live outside the open folder, as a picture opened from Pictures does.
  const project = path.join(root, 'project'), outside = path.join(root, '바깥 files');
  await mkdir(path.join(project, 'inbox'), { recursive: true }); await mkdir(outside);
  await writeFile(path.join(project, 'notes.md'), '# Notes\n\nA text document keeps its text clipboard.\n');
  await writeFile(path.join(outside, 'banana.png'), pngFixture(64, 48, [241, 196, 15]));
  await writeFile(path.join(outside, 'paper.pdf'), pdfFixture(1));
  await copyFile(path.join(fixtures, 'media/clip.mp4'), path.join(outside, 'clip.mp4'));
  await copyFile(path.join(fixtures, 'office/report.docx'), path.join(outside, 'report.docx'));
  await copyFile(path.join(fixtures, 'office/table.hwp'), path.join(outside, 'table.hwp'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(project, 'notes.md')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), project);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(entry(page, 'inbox')).toBeVisible();
    await focusApplication(app);
    return { root, project, outside, app, page };
  } catch (error) { await disposeApplication(app); await rm(root, { recursive: true, force: true }); throw error; }
}
async function open(page: Page, file: string, ready: string) {
  await page.evaluate(file => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.locator('.document-tab[aria-selected="true"] .tab-name')).toHaveText(path.basename(file));
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
}
/** `click`: what someone looking at the file clicks, in its middle. The click selects nothing; on a video it would also play it, so its title is clicked. */
const FILES: Array<{ name: string; ready: string; click: string }> = [
  { name: 'banana.png', ready: '.image-surface:not(.inactive)[data-image-ready="true"]', click: '.image-surface:not(.inactive) .image-viewport' },
  { name: 'clip.mp4', ready: '.video-surface:not(.inactive)[data-video-ready="true"]', click: '.video-surface:not(.inactive) .video-toolbar' },
  { name: 'paper.pdf', ready: '.pdf-surface:not(.inactive) [data-page-number="1"] .textLayer', click: '.pdf-surface:not(.inactive) .pdf-host' },
  // A real Word document opens in the Word editor, for reading until someone edits it; nothing is selected by a click.
  { name: 'report.docx', ready: '.office-surface:not(.inactive)[data-office-ready="true"]', click: '.office-surface:not(.inactive) .word-host' },
  { name: 'table.hwp', ready: '.office-surface:not(.inactive)[data-office-ready="true"]', click: '.office-surface:not(.inactive) .office-host' },
];

test('Ctrl+C in an image, video, PDF or office tab copies the file, which pastes into the Explorer', async () => {
  test.setTimeout(120_000);
  const { root, project, outside, app, page } = await launch();
  try {
    for (const { name, ready, click } of FILES) {
      const file = path.join(outside, name);
      await open(page, file, ready);
      await app.evaluate(({ clipboard }) => clipboard.clear());
      expect(await page.evaluate(() => window.marktex.explorer.clipboard()), name).toBeNull();
      // The keyboard is in the Explorer after each paste, where Ctrl+C copies the tree's selection. The keys are real ones.
      await page.locator(click).click();
      await nativeInput({ chord: ['Control_L', 'c'] });
      await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard()), name).toEqual({ paths: [file], cut: false });
      const url = pathToFileURL(file).href;
      expect(await offered(app), name).toEqual({ 'text/uri-list': url, 'x-special/gnome-copied-files': `copy\n${url}` });
      await entry(page, 'inbox').click();
      await entry(page, 'inbox').press('Control+v');
      await expect.poll(async () => (await readdir(path.join(project, 'inbox'))).includes(name), name).toBe(true);
      expect(await readFile(path.join(project, 'inbox', name)), name).toEqual(await readFile(file));
      // Copying is not moving: the original stays.
      expect(await readFile(file)).toBeTruthy();
    }
    expect((await readdir(path.join(project, 'inbox'))).sort()).toEqual(FILES.map(file => file.name).sort());
    await expect(page.locator('.location-error')).toHaveCount(0);
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('file-copy.png') }).catch(() => {});
    throw error;
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Edit ▸ Copy and a tab\'s menu copy the file; a text document keeps its text Copy', async () => {
  test.setTimeout(90_000);
  const { root, project, outside, app, page } = await launch();
  try {
    const image = path.join(outside, 'banana.png'), notes = path.join(project, 'notes.md');
    await open(page, image, '.image-surface:not(.inactive)[data-image-ready="true"]');
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await openApplicationMenu(page, 'Edit');
    await page.getByRole('menuitem', { name: /^Copy\b/ }).click();
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toEqual({ paths: [image], cut: false });

    // Any file tab, selected or not, offers the file itself from its menu: here the Markdown document behind the image.
    const tab = (name: string) => page.locator('.document-tab').filter({ hasText: name });
    await tab('notes.md').click({ button: 'right' });
    await chooseNativeMenu(app, ['Copy']);
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toEqual({ paths: [notes], cut: false });
    await expect(tab('banana.png')).toHaveAttribute('aria-selected', 'true');
    await entry(page, 'inbox').click();
    await entry(page, 'inbox').press('Control+v');
    await expect.poll(() => readdir(path.join(project, 'inbox'))).toEqual(['notes.md']);

    // In the text document Ctrl+C is the editor's: the selected text, never the file.
    await tab('notes.md').click();
    await page.locator('.mode-toggle').click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+a');
    await nativeInput({ chord: ['Control_L', 'c'] });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('A text document keeps its text clipboard.');
    expect(await page.evaluate(() => window.marktex.explorer.clipboard())).toBeNull();
    await expect(page.locator('.location-error')).toHaveCount(0);
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('file-copy-menus.png') }).catch(() => {});
    throw error;
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
