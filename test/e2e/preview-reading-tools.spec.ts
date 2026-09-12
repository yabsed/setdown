import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';

test('uses the rendered document for TOC, search, and Crossnote themes', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-reader-tools-e2e-'));
  const configRoot = path.join(temporaryRoot, 'config');
  const documentPath = path.join(temporaryRoot, 'reader-tools.md');
  await writeFile(documentPath, [
    '# 첫 번째 장',
    '',
    '검색대상 문장입니다.',
    '',
    '```text',
    `wide-${'0123456789'.repeat(180)}`,
    '```',
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
  let restartedApplication: Awaited<ReturnType<typeof electron.launch>> | null = null;

  try {
    const window = await application.firstWindow();
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect(window.locator('.reader-toolbar')).toHaveCount(0);
    await expect(window.locator('.product-titlebar')).toBeVisible();
    await expect(window.locator('.application-menu button')).toHaveText([
      'File', 'View', 'Insert', 'Edit', 'Window',
    ]);
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isMenuBarVisible())).toBe(false);
    await window.locator('.application-menu button', { hasText: 'View' }).click();
    await expect(window.locator('.application-menu-popup')).toBeVisible();
    await expect(window.locator('.application-menu-popup')).toContainText('Find in Preview');
    expect(await window.locator('.application-menu-popup').evaluate((element) => ({
      radius: getComputedStyle(element).borderRadius,
      background: getComputedStyle(element).backgroundColor,
      themedBackground: getComputedStyle(document.documentElement)
        .getPropertyValue('--app-raised-surface').trim(),
    }))).toEqual({
      radius: '3px',
      background: 'rgb(255, 255, 255)',
      themedBackground: '#ffffff',
    });
    await window.locator('.application-menu-popup button', { hasText: 'Find in Preview' }).click();
    await expect(window.locator('.application-menu-popup')).toBeHidden();
    await expect(window.locator('.preview-search')).toBeVisible();
    await window.locator('.find-close').click();
    await expect(window.locator('.preview-search')).toBeHidden();

    const reading = previews(application);
    await reading.evaluate('window.scrollTo(0, 0), true');
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-medium')?.click();
    });
    await expect.poll(() =>
      reading.evaluate('document.body.dataset.setdownPreviewTheme')).toBe('medium');
    expect(await reading.evaluate('Math.round(scrollY)')).toBe(0);

    await expect(window.locator('.tab-actions .toc-toggle')).toBeVisible();
    await expect(window.locator('.find-toggle')).toHaveCount(0);
    await expect(window.locator('.theme-picker')).toHaveCount(0);
    await window.locator('.toc-toggle').click();
    await expect(window.locator('.toc-panel')).toBeVisible();
    const tocBounds = await window.locator('.toc-panel').boundingBox();
    const previewBoundsWithToc = await window.locator('.preview-frames').boundingBox();
    expect(tocBounds).toBeTruthy();
    expect(previewBoundsWithToc).toBeTruthy();
    expect(tocBounds!.x).toBeGreaterThanOrEqual(
      previewBoundsWithToc!.x + previewBoundsWithToc!.width - 1,
    );
    await expect(window.locator('.toc-item')).toHaveCount(2);
    await expect(window.locator('.toc-item').nth(1)).toHaveText('두 번째 장');
    await window.locator('.toc-item').nth(1).click();

    expect(await reading.hasVisible()).toBe(true);
    expect(await reading.evaluate(`(() => {
      const preview = document.querySelector('.markdown-preview[data-for="preview"]');
      const wideCode = preview.querySelector('pre');
      return {
        documentHasHorizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        previewOverflowX: getComputedStyle(preview).overflowX,
        wideCodeScrollsLocally: wideCode.scrollWidth > wideCode.clientWidth,
      };
    })()`)).toEqual({
      documentHasHorizontalOverflow: false,
      previewOverflowX: 'hidden',
      wideCodeScrollsLocally: true,
    });
    await expect.poll(() => reading.evaluate('Math.round(scrollY)')).toBeGreaterThan(0);

    const previewBoundsBeforeFind = await window.locator('.preview-frames').boundingBox();
    // Zen mode에서 crossnote의 sidebar TOC는 감춰져 있어야 한다.
    await expect.poll(() => reading.evaluate(
      "document.querySelector('.md-sidebar-toc')?.className ?? 'none'",
    )).toMatch(/hidden|none/);
    await window.keyboard.press('Control+F');
    await expect(window.locator('.preview-search')).toBeVisible();
    await expect(window.locator('.preview-search input')).toBeFocused();
    const previewBoundsWithFind = await window.locator('.preview-frames').boundingBox();
    expect(previewBoundsWithFind).toEqual(previewBoundsBeforeFind);
    const searchBounds = await window.locator('.preview-search').boundingBox();
    const tocBoundsWhileFinding = await window.locator('.toc-panel').boundingBox();
    expect(searchBounds).toBeTruthy();
    expect(tocBoundsWhileFinding).toBeTruthy();
    expect(Math.abs((searchBounds?.x ?? 0) + (searchBounds?.width ?? 0)
      - (previewBoundsWithFind?.x ?? 0) - (previewBoundsWithFind?.width ?? 0) + 22))
      .toBeLessThanOrEqual(1);
    expect((searchBounds?.x ?? 0) + (searchBounds?.width ?? 0))
      .toBeLessThanOrEqual(tocBoundsWhileFinding?.x ?? 0);
    expect(await window.locator('.preview-search').evaluate((element) =>
      getComputedStyle(element).borderRadius)).toBe('3px');
    await window.locator('.preview-search input').fill('검색대상');
    await expect(window.locator('.find-count')).not.toHaveText('0 / 0');

    await window.locator('.new-tab-button').click();
    await expect(window.locator('.document-tab')).toHaveCount(2);
    await expect.poll(reading.count).toBe(2);
    await expect(window.locator('.editor-surface')).toBeVisible();
    await window.locator('.mode-toggle').click();
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect(window.locator('.toc-panel')).toBeHidden();
    await window.locator('.mode-toggle').click();
    await expect(window.locator('.editor-surface')).toBeVisible();
    await window.locator('.document-tab', { hasText: 'reader-tools.md' }).click();
    await expect(window.locator('.toc-panel')).toBeVisible();

    const beforeUrls = await reading.urls();
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click();
    });
    await expect.poll(() =>
      reading.evaluateAll<string>("document.body.dataset.setdownPreviewTheme || ''"),
    ).toEqual(['night', 'night']);
    await expect.poll(() => window.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      appearance: document.documentElement.dataset.appearance,
      shell: getComputedStyle(document.querySelector('.shell')!).backgroundColor,
      editor: getComputedStyle(document.querySelector('.monaco-editor')!).backgroundColor,
    }))).toEqual({
      theme: 'night',
      appearance: 'dark',
      shell: 'rgb(47, 52, 57)',
      editor: 'rgb(54, 59, 64)',
    });
    await window.locator('.application-menu button', { hasText: 'View' }).click();
    await expect(window.locator('.application-menu-popup')).toBeVisible();
    expect(await window.locator('.application-menu-popup').evaluate((element) =>
      getComputedStyle(element).backgroundColor)).toBe('rgb(65, 71, 77)');
    await window.locator('[data-menu-item-id="menu-theme"]').hover();
    await expect(window.locator('.application-submenu-popup')).toBeVisible();
    await expect(window.locator('.application-submenu-popup')).toContainText('Night');
    expect(await window.locator('.application-menu-popup').evaluate((element) =>
      element.scrollWidth <= element.clientWidth)).toBe(true);
    const submenuBounds = await window.locator('.application-submenu-popup').boundingBox();
    expect(submenuBounds).toBeTruthy();
    expect((submenuBounds?.x ?? 0) + (submenuBounds?.width ?? 0))
      .toBeLessThanOrEqual(await window.evaluate(() => innerWidth));
    await expect(window.locator('[data-menu-item-id="preview-theme-night"]'))
      .toHaveAttribute('aria-checked', 'true');
    await window.keyboard.press('Escape');
    await expect(window.locator('.application-menu-popup')).toBeHidden();
    const afterUrls = await reading.urls();
    expect(afterUrls).toEqual(beforeUrls);
    const semanticPosition = (await reading.evaluate<{
      visibleLine: number | null; anchorLine: number | null;
    }>(`(() => {
      const y = innerHeight * 0.382;
      const candidates = [...document.querySelectorAll('[data-source-line]')]
        .map((element) => ({
          line: Number(element.getAttribute('data-source-line')),
          rect: element.getBoundingClientRect(),
        }))
        .filter((entry) => entry.line > 0 && (entry.rect.width > 0 || entry.rect.height > 0));
      const covering = candidates.find((entry) => entry.rect.top <= y && entry.rect.bottom >= y);
      const previous = candidates.filter((entry) => entry.rect.bottom <= y).at(-1);
      const next = candidates.find((entry) => entry.rect.top >= y);
      const visibleLine = (covering || previous || next || {}).line ?? null;
      const anchorLine = Number(document.body.dataset.setdownThemeAnchorLine) || null;
      return { visibleLine, anchorLine };
    })()`))!;
    expect(semanticPosition.anchorLine).toBeTruthy();
    expect(semanticPosition.visibleLine).toBe(semanticPosition.anchorLine);
    expect(await window.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--preview-background').trim(),
    )).toBe('#363b40');
    await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const [width, height] = owner.getSize();
      owner.setSize(width + 120, height + 80);
    });
    // native view의 bounds가 DOM placeholder와 맞는지 본다.
    await expect.poll(async () => {
      const host = await window.locator('.preview-frames').boundingBox();
      const view = await reading.visibleBounds();
      return !!host && !!view
        && Math.abs(host.width - view.width) <= 1
        && Math.abs(host.height - view.height) <= 1;
    }).toBe(true);
    await expect(window.locator('.preview-search input')).toHaveValue('검색대상');
    await window.locator('.document-tab', { hasText: 'Untitled.md' }).click();
    await expect.poll(() =>
      reading.evaluateAll<string>("document.body.dataset.setdownPreviewTheme || ''"),
    ).toEqual(['night', 'night']);
    await expect(window.locator('.editor-surface')).toBeVisible();
    await window.locator('.monaco-editor').click({ position: { x: 120, y: 80 } });
    await window.keyboard.type('instant preview');
    await window.keyboard.press('Escape');
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect.poll(reading.hasVisible).toBe(true);
    await expect.poll(() => window.locator('.shell').evaluate((element) =>
      Number((element as HTMLElement).dataset.lastViewerFirstFrameMs) || 0)).toBeGreaterThan(0);
    const firstFrameMs = await window.locator('.shell').evaluate((element) =>
      Number((element as HTMLElement).dataset.lastViewerFirstFrameMs));
    expect(firstFrameMs).toBeLessThan(50);

    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.items
        .find((item) => item.label === 'File')?.submenu?.items
        .find((item) => item.label === 'New Window')?.click();
    });
    await expect.poll(() => application.windows().length).toBe(2);
    const secondWindow = application.windows().find((candidate) => candidate !== window)!;
    await secondWindow.locator('.empty-new').click();
    await expect(secondWindow.locator('.editor-surface')).toBeVisible();
    await secondWindow.locator('.mode-toggle').click();
    const secondPreview = previews(application, 1);
    await expect.poll(secondPreview.hasVisible).toBe(true);
    await expect.poll(() =>
      secondPreview.evaluate<string>("document.body.dataset.setdownPreviewTheme || ''")).toBe('night');
    await expect.poll(() => secondWindow.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      shell: getComputedStyle(document.querySelector('.shell')!).backgroundColor,
      editor: getComputedStyle(document.querySelector('.monaco-editor')!).backgroundColor,
    }))).toEqual({
      theme: 'night',
      shell: 'rgb(47, 52, 57)',
      editor: 'rgb(54, 59, 64)',
    });
    expect(await application.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.checked)).toBe(true);
    await secondWindow.close();

    await application.close();
    restartedApplication = await electron.launch({
      args: ['.', documentPath],
      env: { ...environment, XDG_CONFIG_HOME: configRoot },
    });
    const restartedWindow = await restartedApplication.firstWindow();
    const restartedPreview = previews(restartedApplication);
    await expect.poll(restartedPreview.count).toBeGreaterThan(0);
    await expect.poll(() =>
      restartedPreview.evaluate<string>("document.body.dataset.setdownPreviewTheme || ''")).toBe('night');
    await expect.poll(() => restartedWindow.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      appearance: document.documentElement.dataset.appearance,
      shell: getComputedStyle(document.querySelector('.shell')!).backgroundColor,
      editor: getComputedStyle(document.querySelector('.monaco-editor')!).backgroundColor,
    }))).toEqual({
      theme: 'night',
      appearance: 'dark',
      shell: 'rgb(47, 52, 57)',
      editor: 'rgb(54, 59, 64)',
    });
    expect(await restartedApplication.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.checked)).toBe(true);
  } finally {
    if (restartedApplication) await restartedApplication.close();
    else await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
