import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('keeps one live preview WebContents through Esc and window transfer', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-zero-latency-e2e-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const sourcePage = await application.firstWindow();
    await expect(sourcePage.locator('.viewer-surface')).toBeVisible();

    const readInitial = () => application.evaluate(async ({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      const preview = owner?.contentView.children.find((candidate) =>
        'webContents' in candidate
        && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
      if (!owner || !preview || !('webContents' in preview)) return null;
      await preview.webContents.executeJavaScript(
        'window.__setdownTransferSentinel = 41; window.scrollTo(0, 240);',
      );
      return {
        ownerId: owner.webContents.id,
        previewId: preview.webContents.id,
        url: preview.webContents.getURL(),
      };
    });
    await expect.poll(readInitial).not.toBeNull();
    const initial = (await readInitial())!;

    await sourcePage.locator('.mode-toggle').click();
    await expect(sourcePage.locator('.editor-surface')).toBeVisible();
    await sourcePage.locator('.monaco-editor').click({ position: { x: 120, y: 80 } });
    await sourcePage.keyboard.type('zero latency checkpoint');
    await sourcePage.getByRole('textbox', { name: 'Editor content' }).press('Escape');
    await expect(sourcePage.locator('.viewer-surface')).toBeVisible();

    const afterEsc = await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      const preview = owner?.contentView.children.find((candidate) =>
        'webContents' in candidate
        && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
      return preview && 'webContents' in preview
        ? { previewId: preview.webContents.id, url: preview.webContents.getURL() }
        : null;
    });
    expect(afterEsc?.previewId).toBe(initial.previewId);
    expect(afterEsc?.url).toBe(initial.url);
    await application.evaluate(async ({ webContents }, previewId) => {
      await webContents.fromId(previewId)?.executeJavaScript('window.scrollTo(0, 240)');
    }, initial.previewId);
    await expect.poll(() => application.evaluate(async ({ webContents }, previewId) =>
      await webContents.fromId(previewId)?.executeJavaScript('window.scrollY'), initial.previewId))
      .toBeGreaterThan(0);
    await expect.poll(() => sourcePage.locator('.shell').evaluate((element) =>
      Number((element as HTMLElement).dataset.anchorLine) || 0)).toBeGreaterThan(1);

    await sourcePage.locator('.document-tab').evaluate((element) => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        screenX: 700,
        screenY: 460,
      }));
      element.dispatchEvent(new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        screenX: 700,
        screenY: 460,
      }));
    });

    await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((candidate) => candidate.isVisible()).length)).toBe(1);
    const readTransferred = () => application.evaluate(async ({ BrowserWindow }, ids) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.isVisible() && candidate.webContents.id !== ids.ownerId);
      const preview = owner?.contentView.children.find((candidate) =>
        'webContents' in candidate && candidate.webContents.id === ids.previewId);
      if (!owner || !preview || !('webContents' in preview)) return null;
      return {
        ownerId: owner.webContents.id,
        previewId: preview.webContents.id,
        sentinel: await preview.webContents.executeJavaScript(
          'window.__setdownTransferSentinel',
        ),
        scrollY: await preview.webContents.executeJavaScript('window.scrollY'),
        scrollDebug: await preview.webContents.executeJavaScript(
          'window.__setdownTransferScroll || null',
        ),
      };
    }, { ownerId: initial.ownerId, previewId: initial.previewId });
    await expect.poll(readTransferred, { timeout: 10_000 }).not.toBeNull();
    const transferred = (await readTransferred())!;
    expect(transferred.previewId).toBe(initial.previewId);
    expect(transferred.sentinel).toBe(41);
    await expect.poll(async () => (await readTransferred())?.scrollY ?? 0).toBeGreaterThan(0);
  } finally {
    await application.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});
