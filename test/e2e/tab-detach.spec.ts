import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function previewWebContentsIds(application: Awaited<ReturnType<typeof electron.launch>>) {
  return application.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((contents) => contents.getURL().startsWith('marktex-preview:'))
    .map((contents) => contents.id));
}

async function shellWindows(application: Awaited<ReturnType<typeof electron.launch>>) {
  const candidates = application.windows();
  const matches = await Promise.all(candidates.map(async (page) =>
    await page.locator('#app').count() > 0 ? page : null));
  return matches.filter((page): page is NonNullable<typeof page> => page !== null);
}

test('detaching a tab reparents the same preview WebContents without losing scroll', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const sourceWindow = await application.firstWindow();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(1);
    await expect.poll(() => previewWebContentsIds(application)).toHaveLength(1);
    const [previewId] = await previewWebContentsIds(application);

    await sourceWindow.locator('.new-tab-button').click();
    await expect(sourceWindow.locator('.document-tab')).toHaveCount(2);
    await sourceWindow.locator('.document-tab', { hasText: 'sample.md' }).click();
    await expect.poll(() => application.evaluate(async ({ webContents }, id) => {
      const preview = webContents.fromId(id);
      return preview ? preview.executeJavaScript('window.innerHeight') : 0;
    }, previewId)).toBeGreaterThan(0);

    // 실제 사용 상황과 같이 분리할 탭을 활성화한 상태에서 현재 DOM과
    // viewport를 기록한다.
    const scrollBefore = await application.evaluate(async ({ webContents }, id) => {
      const preview = webContents.fromId(id);
      if (!preview) throw new Error('preview WebContents not found');
      return preview.executeJavaScript(`(() => {
        window.scrollTo(0, Math.max(1, document.documentElement.scrollHeight * 0.55));
        window.__setdownDetachIdentity = 'preserved';
        return { y: window.scrollY, height: window.innerHeight, scrollHeight: document.documentElement.scrollHeight };
      })()`);
    }, previewId);
    expect(scrollBefore.y).toBeGreaterThan(0);

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

    const readPreviewState = () => application.evaluate(async ({ webContents }, id) => {
      const preview = webContents.fromId(id);
      if (!preview) return null;
      return preview.executeJavaScript(`({
        identity: window.__setdownDetachIdentity,
        scrollY: window.scrollY,
        height: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      })`);
    }, previewId);
    const previewState = await readPreviewState();
    expect(previewState?.identity).toBe('preserved');
    await expect.poll(async () => {
      const state = await readPreviewState();
      return Math.abs((state?.scrollY ?? 0) - scrollBefore.y);
    }).toBeLessThan(2);

    const focusedTitle = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle());
    expect(focusedTitle).toContain('sample.md');
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
