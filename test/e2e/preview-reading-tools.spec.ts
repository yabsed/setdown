import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('uses the rendered document for TOC, search, and Crossnote themes', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-reader-tools-e2e-'));
  const configRoot = path.join(temporaryRoot, 'config');
  const documentPath = path.join(temporaryRoot, 'reader-tools.md');
  await writeFile(documentPath, [
    '# 첫 번째 장',
    '',
    '검색대상 문장입니다.',
    '',
    ...Array.from({ length: 80 }, (_, index) => `본문 ${index + 1}`),
    '',
    '## 두 번째 장',
    '',
    '검색대상 문장이 한 번 더 있습니다.',
    '',
    ...Array.from({ length: 80 }, (_, index) => `뒷부분 ${index + 1}`),
  ].join('\n'), 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect(window.locator('.reader-toolbar')).toBeHidden();

    await expect(window.locator('.tab-actions .toc-toggle')).toBeVisible();
    await expect(window.locator('.find-toggle')).toHaveCount(0);
    await expect(window.locator('.theme-picker')).toHaveCount(0);
    await window.locator('.toc-toggle').click();
    await expect(window.locator('.toc-panel')).toBeVisible();
    await expect(window.locator('.toc-item')).toHaveCount(2);
    await expect(window.locator('.toc-item').nth(1)).toHaveText('두 번째 장');
    await window.locator('.toc-item').nth(1).click();

    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const preview = webContents.getAllWebContents()
        .find((contents) => contents.getURL().startsWith('marktex-preview:'));
      return preview ? preview.executeJavaScript('window.scrollY') : 0;
    })).toBeGreaterThan(0);
    const readingPreviewId = await application.evaluate(async ({ webContents }) => {
      const previews = webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:'));
      for (const preview of previews) {
        if (await preview.executeJavaScript('window.scrollY') > 0) return preview.id;
      }
      throw new Error('Scrolled preview not found');
    });

    await window.keyboard.press('Control+F');
    await expect(window.locator('.reader-toolbar')).toBeVisible();
    await expect(window.locator('.preview-search input')).toBeFocused();
    await window.locator('.preview-search input').fill('검색대상');
    await expect(window.locator('.find-count')).not.toHaveText('0 / 0');

    await window.locator('.new-tab-button').click();
    await expect(window.locator('.document-tab')).toHaveCount(2);
    await expect.poll(() => application.evaluate(({ webContents }) =>
      webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:')).length,
    )).toBe(2);
    await window.locator('.document-tab', { hasText: 'reader-tools.md' }).click();

    const beforeTheme = await application.evaluate(async ({ webContents }) =>
      Promise.all(webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:'))
        .map(async (contents) => ({
          id: contents.id,
          url: contents.getURL(),
          scrollY: await contents.executeJavaScript('window.scrollY'),
        }))),
    );
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click();
    });
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const previews = webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:'));
      return Promise.all(previews.map((preview) => preview.executeJavaScript(
        `document.body.dataset.setdownPreviewTheme || ''`,
      )));
    })).toEqual(['night', 'night']);
    const afterTheme = await application.evaluate(async ({ webContents }) =>
      Promise.all(webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:'))
        .map(async (contents) => ({
          id: contents.id,
          url: contents.getURL(),
          scrollY: await contents.executeJavaScript('window.scrollY'),
          semanticPosition: await contents.executeJavaScript(`(() => {
            const y = innerHeight * 0.382;
            const candidates = [...document.querySelectorAll('[data-source-line]')]
              .map((element) => ({
                line: Number(element.getAttribute('data-source-line')),
                rect: element.getBoundingClientRect(),
              }))
              .filter(({ line, rect }) => line > 0 && (rect.width > 0 || rect.height > 0));
            const covering = candidates.find(({ rect }) => rect.top <= y && rect.bottom >= y);
            const previous = candidates.filter(({ rect }) => rect.bottom <= y).at(-1);
            const next = candidates.find(({ rect }) => rect.top >= y);
            const visibleLine = covering?.line ?? previous?.line ?? next?.line ?? null;
            const anchorLine = Number(document.body.dataset.setdownThemeAnchorLine) || null;
            return { visibleLine, anchorLine };
          })()`),
        }))),
    );
    expect(afterTheme.map(({ id, url }) => ({ id, url })))
      .toEqual(beforeTheme.map(({ id, url }) => ({ id, url })));
    const readingPosition = afterTheme.find(({ id }) => id === readingPreviewId)
      ?.semanticPosition;
    expect(readingPosition?.anchorLine).toBeTruthy();
    expect(readingPosition?.visibleLine).toBe(readingPosition?.anchorLine);
    expect(await window.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--preview-background').trim(),
    )).toBe('#363b40');
    await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const [width, height] = owner.getSize();
      owner.setSize(width + 120, height + 80);
    });
    const readResizedPreview = () => application.evaluate(
      ({ BrowserWindow, WebContentsView }, id) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const preview = owner.contentView.children.find((child) =>
        child instanceof WebContentsView && child.webContents.id === id);
      const bounds = preview?.getBounds();
      const content = owner.getContentBounds();
      return {
        background: owner.getBackgroundColor().toLowerCase(),
        rightGap: bounds ? content.width - bounds.x - bounds.width : -1,
        bottomGap: bounds ? content.height - bounds.y - bounds.height : -1,
      };
    }, readingPreviewId);
    await expect.poll(async () => {
      const state = await readResizedPreview();
      return state.background === '#363b40'
        && Math.abs(state.rightGap) <= 1
        && Math.abs(state.bottomGap) <= 1;
    }).toBe(true);
    const resizedPreview = await readResizedPreview();
    expect(Math.abs(resizedPreview.rightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(resizedPreview.bottomGap)).toBeLessThanOrEqual(1);
    await expect(window.locator('.preview-search input')).toHaveValue('검색대상');
    await window.locator('.document-tab', { hasText: 'Untitled.md' }).click();
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const previews = webContents.getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('marktex-preview:'));
      return Promise.all(previews.map((preview) => preview.executeJavaScript(
        `document.body.dataset.setdownPreviewTheme || ''`,
      )));
    })).toEqual(['night', 'night']);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
