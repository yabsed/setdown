import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication } from './electron-app';

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
    args: ['.', path.resolve('test/fixtures/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const sourceWindow = await application.firstWindow();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(1);
    const sourcePreview = previews(application, { title: 'sample.md' });
    await expect.poll(sourcePreview.count).toBe(1);

    await sourceWindow.locator('.new-tab-button').click();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(2);
    await sourceWindow.locator('.document-tab', { hasText: 'sample.md' }).click();
    const activePreviewUrl = await sourcePreview.visibleUrl();
    expect(activePreviewUrl).toMatch(/^marktex-preview:\/\/document\//);
    await expect.poll(() => sourcePreview.evaluate('innerHeight')).toBeGreaterThan(0);

    // URL을 만든 뒤 동적으로 바꾼 전역 테마와 탭별 목차 상태가 모두
    // transfer 경계를 넘어가는지 확인한다.
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click();
    });
    await expect.poll(() =>
      sourcePreview.evaluate('document.body.dataset.setdownPreviewTheme')).toBe('night');
    await sourceWindow.locator('.toc-toggle').click();
    await expect(sourceWindow.locator('.toc-panel')).toBeVisible();

    // 실제 사용 상황과 같이 분리할 탭을 활성화한 상태에서 현재 DOM과
    // viewport를 기록한다.
    await expect.poll(() => sourcePreview.evaluate(
      'document.documentElement.scrollHeight - innerHeight')).toBeGreaterThan(0);
    await sourcePreview.evaluate(
      'window.scrollTo(0, Math.max(1, document.documentElement.scrollHeight * 0.55)), true');
    await expect.poll(() => sourcePreview.evaluate('Math.round(scrollY)')).toBeGreaterThan(0);
    // 기준은 shell의 anchor가 아니라 "이동 직전 source가 실제로 보여 주던 줄"이다.
    // shell의 anchor는 scroll 이벤트를 따라 늦게 갱신되어, 이르게 읽으면
    // 옛 값을 집는다. 이동 전후로 같은 자리를 재는 것이 이 시험의 뜻이다.
    await expect.poll(() => sourcePreview.evaluate(`(() => {
      const y = innerHeight * 0.382;
      const covering = [...document.querySelectorAll('[data-source-line]')].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= y && rect.bottom >= y;
      });
      return Number(covering && covering.dataset.sourceLine) || 0;
    })()`)).toBeGreaterThan(1);
    const anchorLine = Number(await sourcePreview.evaluate(`(() => {
      const y = innerHeight * 0.382;
      const covering = [...document.querySelectorAll('[data-source-line]')].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= y && rect.bottom >= y;
      });
      return Number(covering && covering.dataset.sourceLine) || 0;
    })()`));

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
          clientX: -10, // Outside the workspace; an in-window drop now joins/splits groups.
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
    // 조판된 WebContents 자체를 인계하므로 스냅샷으로 대신하지 않는다.
    await expect(detachedWindow!.locator('.shell'))
      .toHaveAttribute('data-last-transfer-used-snapshot', 'false');

    const detachedPreview = previews(application, { title: 'sample.md' });
    await expect.poll(detachedPreview.count).toBe(1);
    // 같은 WebContents가 그대로 옮겨졌으므로 URL이 유지된다.
    await expect.poll(detachedPreview.visibleUrl).toBe(activePreviewUrl);
    await expect(detachedWindow!.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect.poll(() =>
      detachedPreview.evaluate('document.body.dataset.setdownPreviewTheme')).toBe('night');
    await expect(detachedWindow!.locator('.toc-panel')).toBeVisible();
    await expect.poll(() => detachedPreview.evaluate(`(() => {
      const y = innerHeight * 0.382;
      const covering = [...document.querySelectorAll('[data-source-line]')].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= y && rect.bottom >= y;
      });
      return Number(covering && covering.dataset.sourceLine) || 0;
    })()`)).toBe(anchorLine);

    await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle() ?? '')).toContain('sample.md');
  } finally {
    await disposeApplication(application);
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('detaching the middle tab leaves documents one and three in the original window', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('test/fixtures/sample.md')],
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
          clientX: -10, // Outside the workspace; an in-window drop now joins/splits groups.
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

    // 창 포커스는 compositor가 정한다. Wayland 세션에서는 focus()를 명시적으로
    // 불러도 어떤 창도 포커스를 보고하지 않으므로(측정으로 확인), 보고가
    // 가능한 환경에서만 확인한다.
    const reportsFocus = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isFocused()));
    if (reportsFocus) {
      await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getFocusedWindow()?.getTitle() ?? ''),
      { timeout: 10000 }).toContain('Untitled.md');
    }
  } finally {
    await disposeApplication(application);
    await rm(configRoot, { recursive: true, force: true });
  }
});
