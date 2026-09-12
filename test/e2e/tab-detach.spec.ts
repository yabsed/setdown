import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function shellWindows(application: Awaited<ReturnType<typeof electron.launch>>) {
  const candidates = application.windows();
  const matches = await Promise.all(candidates.map(async (page) =>
    await page.locator('#app').count() > 0 ? page : null));
  return matches.filter((page): page is NonNullable<typeof page> => page !== null);
}

test('detaching a tab restores its preview iframe at the same semantic position', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const sourceWindow = await application.firstWindow();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(1);
    await expect(sourceWindow.locator('.preview-frame')).toHaveCount(1);

    await sourceWindow.locator('.new-tab-button').click();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(2);
    await sourceWindow.locator('.document-tab', { hasText: 'sample.md' }).click();
    const activePreviewUrl = await sourceWindow.locator('.preview-frame.is-active')
      .getAttribute('src');
    expect(activePreviewUrl).toMatch(/^marktex-preview:\/\/document\//);
    await expect.poll(() => sourceWindow.frames().map((frame) => frame.url()))
      .toContain(activePreviewUrl);
    const sourcePreview = sourceWindow.frames().find((frame) =>
      frame.url() === activePreviewUrl)!;
    await expect.poll(() => sourcePreview.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

    // URL을 만든 뒤 동적으로 바꾼 전역 테마와 탭별 목차 상태가 모두
    // transfer 경계를 넘어가는지 확인한다.
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click();
    });
    await expect.poll(() => sourcePreview.evaluate(() =>
      document.body.dataset.setdownPreviewTheme)).toBe('night');
    await sourceWindow.locator('.toc-toggle').click();
    await expect(sourceWindow.locator('.toc-panel')).toBeVisible();

    // 실제 사용 상황과 같이 분리할 탭을 활성화한 상태에서 현재 DOM과
    // viewport를 기록한다.
    await expect.poll(() => sourcePreview.evaluate(() =>
      document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(0);
    await sourcePreview.evaluate(() =>
      window.scrollTo(0, Math.max(1, document.documentElement.scrollHeight * 0.55)));
    await expect.poll(() => sourcePreview.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect.poll(async () => Number(
      await sourceWindow.locator('.shell').getAttribute('data-anchor-line'),
    )).toBeGreaterThan(1);
    const anchorLine = Number(await sourceWindow.locator('.shell').getAttribute('data-anchor-line'));

    const draggedTypes = await sourceWindow.locator('.document-tab', { hasText: 'sample.md' })
      .evaluate((element) => {
        const dataTransfer = new DataTransfer();
        element.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          screenX: 640,
          screenY: 420,
        }));
        const types = [...dataTransfer.types];
        element.dispatchEvent(new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          screenX: 640,
          screenY: 420,
        }));
        return types;
      });

    expect(draggedTypes).toContain('application/x-setdown-tab');
    expect(draggedTypes).not.toContain('text/plain');
    await expect.poll(async () => (await shellWindows(application)).length).toBe(2);

    await expect(sourceWindow.locator('.tab-name')).toHaveText(['Untitled.md']);
    const detachedWindow = (await shellWindows(application)).find((window) => window !== sourceWindow);
    expect(detachedWindow).toBeTruthy();
    await expect(detachedWindow!.locator('.tab-name')).toHaveText(['sample.md']);
    await expect(detachedWindow!.locator('.shell'))
      .toHaveAttribute('data-last-transfer-used-snapshot', 'true');

    await expect(detachedWindow!.locator('.preview-frame')).toHaveCount(1);
    await expect(detachedWindow!.locator('.preview-frame'))
      .toHaveAttribute('src', activePreviewUrl!);
    await expect(detachedWindow!.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect.poll(async () => {
      const frame = detachedWindow!.frames().find((candidate) =>
        candidate.url().startsWith('marktex-preview:'));
      return frame?.evaluate(() =>
        document.body?.dataset.setdownPreviewTheme ?? '').catch(() => '') ?? '';
    }).toBe('night');
    await expect(detachedWindow!.locator('.toc-panel')).toBeVisible();
    const detachedPreview = detachedWindow!.frames().find((frame) =>
      frame.url().startsWith('marktex-preview:'))!;
    await expect.poll(() => detachedPreview.evaluate(() => {
      const y = innerHeight * 0.382;
      const candidates = [...document.querySelectorAll<HTMLElement>('[data-source-line]')];
      const covering = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= y && rect.bottom >= y;
      });
      return Number(covering?.dataset.sourceLine) || 0;
    })).toBe(anchorLine);

    await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle() ?? '')).toContain('sample.md');
  } finally {
    await application.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('detaching the middle tab leaves documents one and three in the original window', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const sourceWindow = await application.firstWindow();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(1);
    await sourceWindow.locator('.new-tab-button').click();
    await sourceWindow.locator('.new-tab-button').click();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(3);
    await sourceWindow.locator('.document-tab', { hasText: 'Untitled.md' }).click();

    await sourceWindow.locator('.document-tab', { hasText: 'Untitled.md' })
      .evaluate((element) => {
        const dataTransfer = new DataTransfer();
        element.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          screenX: 680,
          screenY: 460,
        }));
        element.dispatchEvent(new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          screenX: 680,
          screenY: 460,
        }));
      });

    await expect.poll(async () => (await shellWindows(application)).length).toBe(2);
    await expect(sourceWindow.locator('.tab-name')).toHaveText([
      'sample.md',
      'Untitled 2.md',
    ]);

    const detachedWindow = (await shellWindows(application)).find((window) => window !== sourceWindow);
    expect(detachedWindow).toBeTruthy();
    await expect(detachedWindow!.locator('.tab-name')).toHaveText(['Untitled.md']);

    const focusedTitle = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle());
    expect(focusedTitle).toContain('Untitled.md');
  } finally {
    await application.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});
