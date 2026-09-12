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
    await expect(window.locator('.reader-toolbar')).toBeVisible();

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

    await window.locator('.find-toggle').click();
    await window.locator('.preview-search input').fill('검색대상');
    await expect(window.locator('.find-count')).not.toHaveText('0 / 0');

    await window.locator('.theme-picker select').selectOption('night');
    await expect(window.locator('.theme-picker select')).toHaveValue('night');
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const preview = webContents.getAllWebContents()
        .find((contents) => contents.getURL().startsWith('marktex-preview:'));
      if (!preview) return '';
      return preview.executeJavaScript(
        `document.getElementById('crossnote-data')?.getAttribute('data-config') || ''`,
      );
    })).toContain('night.css');
    await expect(window.locator('.preview-search input')).toHaveValue('검색대상');
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
