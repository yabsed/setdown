import { _electron as electron, expect, test } from '@playwright/test';
import type { WebContentsView } from 'electron';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';
import type { DocumentSnapshot } from '../../src/protocol/desktop-api';

type Application = Awaited<ReturnType<typeof electron.launch>>;
async function visiblePreview(application: Application) {
  return application.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find(candidate => candidate.isVisible());
    if (!owner) return null;
    const preview = (owner.contentView.children as WebContentsView[]).find(candidate =>
      'webContents' in candidate && candidate.getVisible()
      && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
    if (!preview) return null;
    return { id: preview.webContents.id, url: preview.webContents.getURL(),
      text: String(await preview.webContents.executeJavaScript('document.body.innerText')) };
  });
}

test('text startup, Esc and save never create a Markdown preview and preserve BOM/CRLF', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-text-e2e-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-text-config-'));
  const file = path.join(root, 'memo.txt');
  await writeFile(file, '\uFEFFText workspace\r\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
  try {
    const window = await application.firstWindow();
    await expect(window.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await expect(window.locator('.shell')).toHaveAttribute('data-document-kind', 'text');
    await expect(window.getByRole('button', { name: 'Switch to Viewer', exact: true })).toHaveCount(0);
    const editor = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End');
    await editor.pressSequentially('tail');
    await editor.press('Escape');
    await expect(window.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await editor.press('Control+S');
    await expect.poll(async () => (await readFile(file)).toString('hex'))
      .toBe(Buffer.from('\uFEFFText workspace\r\ntail').toString('hex'));
    const pages = await application.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter(contents => contents.getURL().startsWith('marktex-preview://document/')).length);
    expect(pages).toBe(0);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('warm Markdown native page survives opening and editing a C++ tab', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-mixed-e2e-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-mixed-config-'));
  const markdown = path.join(root, 'report.md');
  const source = path.join(root, 'main.cpp');
  await writeFile(markdown, '# Markdown fastpath marker\n\n$$x^2 + y^2$$\n');
  await writeFile(source, 'int main() { return 0; }\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({ args: ['.', markdown], env: { ...environment, XDG_CONFIG_HOME: config } });
  try {
    const window = await application.firstWindow();
    await expect.poll(async () => (await visiblePreview(application))?.text, { timeout: 20_000 })
      .toContain('Markdown fastpath marker');
    const original = await visiblePreview(application);
    const text = await readFile(source, 'utf8');
    const disk = await stat(source);
    const opened: DocumentSnapshot = { path: source, name: 'main.cpp', text, savedText: text,
      revision: 0, savedRevision: 0, diskVersion: { mtimeMs: disk.mtimeMs, size: disk.size },
      isUntitled: false, encoding: 'utf8', eol: 'lf' };
    // Exercise the same document-open event used by native menus; the first
    // test separately covers the real command-line decoder and save path.
    await application.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows().find(candidate => candidate.isVisible())?.webContents.send('document:opened', document);
    }, opened);
    await expect(window.locator('.shell')).toHaveAttribute('data-document-kind', 'text');
    const editor = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End');
    await editor.pressSequentially('// changed');
    await window.getByRole('tab', { name: /report\.md/ }).click();
    await expect.poll(async () => (await visiblePreview(application))?.id).toBe(original?.id);
    expect((await visiblePreview(application))?.url).toBe(original?.url);
    await expect(window.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
