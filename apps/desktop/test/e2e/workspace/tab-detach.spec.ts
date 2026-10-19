import { electron } from '../../support/electron/electron-app';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from '../../support/preview/preview-view';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { nativeInput } from '../../support/electron/native-input';

async function shellWindows(application: Awaited<ReturnType<typeof electron.launch>>) {
  const candidates = application.windows();
  const matches = await Promise.all(candidates.map(async (page) =>
    await page.locator('#app').count().catch(() => 0) > 0 ? page : null));
  return matches.filter((page): page is NonNullable<typeof page> => page !== null);
}

for (const outcome of ['above', 'left', 'right', 'below', 'cancel', 'return'] as const)
test(`native drag ${outcome} the window after showing an insertion guide`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-native-detach-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  const page = await app.firstWindow();
  try {
    await focusApplication(app);
    const nativeWindow = await app.browserWindow(page);
    await nativeWindow.evaluate(window => window.setBounds({ x: 400, y: 300, width: 900, height: 650 }));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const inputs: unknown[] = [];
      (globalThis as any).dragInputs = inputs;
      BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => inputs.push(input));
      for (const name of ['tabs:detach-to-window', 'tabs:cancel-transfer']) ipcMain.on(name, (_event, value) => inputs.push({ name, value }));
    });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
    await page.locator('.new-tab-button').click();
    await expect(page.locator('.tab-name')).toHaveText(['Untitled.md', 'Untitled 2.md']);
    await page.evaluate(() => {
      const events: unknown[] = [];
      for (const type of ['dragstart', 'drag', 'dragover', 'dragleave', 'drop', 'dragend']) {
        window.addEventListener(type, event => {
          const e = event as DragEvent;
          events.push({ type, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY,
            effect: e.dataTransfer?.dropEffect, buttons: e.buttons, related: (e.relatedTarget as Element | null)?.className ?? null,
            window: { x: window.screenX, y: window.screenY, width: innerWidth, height: innerHeight } });
        }, true);
      }
      (window as typeof window & { detachEvents: unknown[] }).detachEvents = events;
    });
    const box = (await page.locator('.document-tab').last().boundingBox())!;
    const from = await nativeWindow.evaluate((window, box) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + (box.x + box.width / 2) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
    }, box);
    await nativeInput({ pointer: [from], button: 'down' });
    await nativeInput({ pointer: [10, 20, 30].map(dx => ({ x: from.x + dx, y: from.y })) });
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    // Jump straight out of the strip, as in a quick tear-off. No synthetic DOM
    // drag events stand in for the OS boundary, release, or cancellation.
    const outside = outcome === 'left' ? { x: 280, y: from.y }
      : outcome === 'right' ? { x: 1420, y: from.y }
      : { x: from.x + 30, y: outcome === 'below' ? 1030 : 180 };
    await nativeInput({ pointer: [outside] });
    if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
    if (outcome === 'return') {
      const first = (await page.locator('.document-tab').first().boundingBox())!;
      const back = await nativeWindow.evaluate((window, box) => {
        const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
        return { x: bounds.x + (box.x + 30) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
      }, first);
      await nativeInput({ pointer: [1, 2, 3, 4].map(step => ({
        x: outside.x + (back.x - outside.x) * step / 4, y: outside.y + (back.y - outside.y) * step / 4,
      })) });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
      await expect.poll(async () => (await page.locator('.tab-drop-indicator').boundingBox())!.x).toBeCloseTo(first.x - 1, 0);
    }
    await nativeInput({ button: 'up' });
    await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    if (outcome === 'cancel' || outcome === 'return') {
      await expect(page.locator('.tab-name')).toHaveText(outcome === 'cancel'
        ? ['Untitled.md', 'Untitled 2.md'] : ['Untitled 2.md', 'Untitled.md']);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    } else {
      await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
      await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
      const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
      await expect(detached.locator('.tab-name')).toHaveText(['Untitled 2.md']);
    }
    await nativeWindow.dispose();
  } finally {
    await nativeInput({ button: 'up' });
    const events = await page.evaluate(() => (window as typeof window & { detachEvents?: unknown[] }).detachEvents).catch(() => []);
    await writeFile(test.info().outputPath('drag-events.json'), JSON.stringify(events, null, 2));
    await writeFile(test.info().outputPath('native-inputs.json'), JSON.stringify(await app.evaluate(() => (globalThis as any).dragInputs), null, 2));
    await page.screenshot({ path: test.info().outputPath('source-window.png') }).catch(() => {});
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});

for (const outcome of ['detach', 'cancel', 'return', 'split', 'sole'] as const)
test(`source group center clears the guide during native drag: ${outcome}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-center-detach-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  const page = await app.firstWindow();
  try {
    await focusApplication(app);
    const window = await app.browserWindow(page);
    await window.evaluate(window => window.setBounds({ x: 200, y: 150, width: 1000, height: 700 }));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
    if (outcome !== 'sole') await page.locator('.new-tab-button').click();
    const tab = page.locator('.document-tab').last(), tabName = await tab.locator('.tab-name').innerText();
    const toScreen = (point: { x: number; y: number }) => window.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    const box = (await tab.boundingBox())!;
    const from = await toScreen({ x: box.x + 40, y: box.y + box.height / 2 });
    await nativeInput({ pointer: [from], button: 'down' });
    await nativeInput({ pointer: [10, 20, 30].map(dx => ({ x: from.x + dx, y: from.y })) });
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    const body = (await page.locator('.group-body').boundingBox())!;
    const edge = await toScreen({ x: body.x + body.width * .98, y: body.y + body.height / 2 });
    if (outcome !== 'sole') {
      await nativeInput({ pointer: [edge] });
      await expect(page.locator('.group-drop-overlay')).toBeVisible();
    }
    await nativeInput({ pointer: [await toScreen({ x: body.x + body.width / 2, y: body.y + body.height / 2 })] });
    // Feedback must disappear before release, while the OS drag is still held.
    await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    await expect(page.locator('.group-drop-overlay')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('center-no-guide.png') });
    if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
    if (outcome === 'return') {
      const first = (await page.locator('.document-tab').first().boundingBox())!;
      await nativeInput({ pointer: [await toScreen({ x: first.x + 3, y: first.y + first.height / 2 })] });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    }
    if (outcome === 'split') {
      await nativeInput({ pointer: [edge] });
      await expect(page.locator('.group-drop-overlay')).toBeVisible();
    }
    await nativeInput({ button: 'up' });
    if (outcome === 'detach' || outcome === 'sole') {
      await expect.poll(async () => (await shellWindows(app)).some(candidate => candidate !== page)).toBe(true);
      const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
      await expect(detached.locator('.tab-name')).toHaveText([tabName]);
      if (outcome === 'sole') {
        await expect.poll(() => page.isClosed()).toBe(true);
        await expect.poll(async () => (await shellWindows(app)).length).toBe(1);
      } else {
        await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
        await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
      }
    } else {
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await expect(page.locator('.editor-group')).toHaveCount(outcome === 'split' ? 2 : 1);
      await expect(page.locator('.tab-name')).toHaveText(outcome === 'return'
        ? ['Untitled 2.md', 'Untitled.md'] : ['Untitled.md', 'Untitled 2.md']);
    }
    if (outcome !== 'sole') {
      await expect(page.locator('.group-drop-overlay')).toBeHidden();
      await expect(page.locator('.tab-drop-indicator')).toBeHidden();
      await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    }
    await window.dispose();
  } finally {
    await nativeInput({ button: 'up' });
    await disposeApplication(app); await rm(root, { recursive: true, force: true });
  }
});

for (const dropArea of ['body', 'tab strip'] as const) test(`detaching a tab restores its preview at the same position via ${dropArea}`, async () => {
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
        element.dispatchEvent(new DragEvent('dragleave', {
          clientX: 120,
          clientY: 80,
          bubbles: true,
          cancelable: true,
          dataTransfer,
          relatedTarget: null,
        }));
        // VS Code and Firefox can accept the OS drag as a move even though the
        // drop did not happen in another Setdown window.
        Object.defineProperty(dataTransfer, 'dropEffect', { value: 'move', configurable: true });
        element.dispatchEvent(new DragEvent('dragend', {
          // Chromium can retain the last in-window client coordinates when the
          // OS drag ends outside the BrowserWindow.
          clientX: 120,
          clientY: 80,
          bubbles: true,
          cancelable: true,
          dataTransfer,
          screenX: 640,
          screenY: 420,
        }));
        return { types, dropEffect: dataTransfer.dropEffect };
      });

    expect(draggedTypes.types).toContain('application/x-setdown-tab');
    expect(draggedTypes.types).not.toContain('text/plain');
    expect(draggedTypes.dropEffect).toBe('move');
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

    // Some Wayland/compositor sessions report no focused BrowserWindow even
    // after Electron's explicit focus(). Verify ownership where focus reporting
    // is available, as in the multi-tab detach case below.
    const reportsFocus = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isFocused()));
    if (reportsFocus) {
      await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getFocusedWindow()?.getTitle() ?? '')).toContain('sample.md');
    }

    // Move the tab back to the original window. Force source dragend to reach
    // main before the destination drop claim, reproducing the cross-renderer
    // IPC order seen in the screencast.
    const transferId = await detachedWindow!.locator('.document-tab', { hasText: 'sample.md' })
      .evaluate((element) => {
        const dataTransfer = new DataTransfer();
        element.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true, cancelable: true, dataTransfer, screenX: 640, screenY: 420,
        }));
        return dataTransfer.getData('application/x-setdown-tab');
      });
    expect(transferId).not.toBe('');
    const destinationTransfer = await sourceWindow.evaluateHandle((id) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/x-setdown-tab', id);
      return dataTransfer;
    }, transferId);
    const target = sourceWindow.locator(dropArea === 'body' ? '.group-body' : '.tab-strip').first();
    const targetBox = (await target.boundingBox())!;
    const point = { clientX: targetBox.x + targetBox.width / 2,
      clientY: targetBox.y + (dropArea === 'body' ? targetBox.height / 2 : 2), dataTransfer: destinationTransfer };
    await target.dispatchEvent('dragover', point);
    await expect(sourceWindow.locator(dropArea === 'body' ? '.group-drop-overlay' : '.tab-drop-indicator')).toBeVisible();
    if (dropArea === 'tab strip') expect(await target.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
    const targetNativeWindow = await application.browserWindow(sourceWindow);
    const screenPoint = await targetNativeWindow.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, { x: point.clientX, y: point.clientY });
    await targetNativeWindow.dispose();
    await detachedWindow!.locator('.document-tab', { hasText: 'sample.md' }).evaluate((element, screenPoint) => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true, cancelable: true, dataTransfer, relatedTarget: null,
      }));
      element.dispatchEvent(new DragEvent('dragend', {
        bubbles: true, cancelable: true, dataTransfer,
        clientX: -1, clientY: 80, screenX: screenPoint.x, screenY: screenPoint.y,
      }));
    }, screenPoint);
    // Deliberately exceed the old 120ms arbitration window. A delayed target
    // must still win, without even briefly showing a third window.
    await sourceWindow.waitForTimeout(500);
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
    await target.dispatchEvent('drop', point);
    await destinationTransfer.dispose();

    await expect.poll(async () => (await shellWindows(application)).length).toBe(1);
    await expect(sourceWindow.locator('.tab-name')).toHaveText(['Untitled.md', 'sample.md']);
    await expect.poll(sourcePreview.visibleUrl).toBe(activePreviewUrl);
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
        element.dispatchEvent(new DragEvent('dragleave', {
          clientX: 120,
          clientY: 80,
          bubbles: true,
          cancelable: true,
          dataTransfer,
          relatedTarget: null,
        }));
        element.dispatchEvent(new DragEvent('dragend', {
          clientX: 120,
          clientY: 80,
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

for (const coordinates of ['client', 'screen'] as const) for (const effect of ['none', 'move'] as const) {
  test(`outside ${coordinates} dragend overrides a stale guide with dropEffect=${effect}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-stale-guide-'));
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
    try {
      const page = await app.firstWindow();
      await focusApplication(app);
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
      await page.locator('.new-tab-button').click();
      const source = page.locator('.document-tab').last();
      const data = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent('dragstart', { dataTransfer: data });
      const box = (await source.boundingBox())!;
      const point = { dataTransfer: data, clientX: box.x + 20, clientY: box.y + box.height / 2 };
      await source.dispatchEvent('dragover', point);
      // A native leave can carry the last point over the strip. Preserve the
      // guide for an internal boundary, but let actual completion supersede it.
      await source.dispatchEvent('dragleave', { ...point, relatedTarget: null });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
      await data.evaluate((transfer, effect) => Object.defineProperty(transfer, 'dropEffect', { value: effect }), effect);
      const outside = await page.evaluate(() => ({ screenX: window.screenX + 200, screenY: window.screenY - 100 }));
      await source.dispatchEvent('dragend', {
        ...point,
        ...(coordinates === 'client' ? { clientY: -100 } : outside),
      });
      await data.dispose();
      await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
      await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
      const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
      await expect(detached.locator('.tab-name')).toHaveText(['Untitled 2.md']);
      await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    } finally {
      await disposeApplication(app);
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const completion of ['drop', 'dragend'] as const) test(`accepted center tear-off retains its position across native ${completion}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-center-native-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
    await page.locator('.new-tab-button').click();
    const source = page.locator('.document-tab').last();
    const data = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer: data });
    const body = (await page.locator('.group-body').boundingBox())!;
    const point = await page.evaluate(body => ({ clientX: body.x + body.width / 2, clientY: body.y + body.height / 2,
      screenX: window.screenX + body.x + body.width / 2, screenY: window.screenY + body.y + body.height / 2 }), body);
    await source.dispatchEvent('dragover', { ...point, dataTransfer: data });
    await expect(page.locator('.group-drop-overlay')).toBeHidden();
    await source.dispatchEvent('dragleave', { ...point, dataTransfer: data, relatedTarget: null });
    await data.evaluate(transfer => Object.defineProperty(transfer, 'dropEffect', { value: 'move' }));
    await source.dispatchEvent(completion, { dataTransfer: data, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
    await data.dispose();
    await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
    const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
    await expect(detached.locator('.tab-name')).toHaveText(['Untitled 2.md']);
    const nativeWindow = await app.browserWindow(detached);
    expect(await nativeWindow.evaluate(window => window.getPosition())).toEqual([Math.round(point.screenX - 120), Math.round(point.screenY - 18)]);
    await nativeWindow.dispose();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

for (const completion of ['drop', 'dragend'] as const) {
  for (const guide of ['tab strip', 'other group', 'other group body', 'split'] as const) {
    test(`the painted ${guide} guide owns placement on ${completion} after an internal native leave`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-guide-'));
      const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
      const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
      try {
        const page = await app.firstWindow();
        await focusApplication(app);
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
        for (let i = 0; i < 2; i++) await page.locator('.new-tab-button').click();
        await expect(page.locator('.tab-name')).toHaveText(['Untitled.md', 'Untitled 2.md', 'Untitled 3.md']);
        if (guide === 'other group' || guide === 'other group body') {
          const setupData = await page.evaluateHandle(() => new DataTransfer());
          await page.locator('.document-tab').first().dispatchEvent('dragstart', { dataTransfer: setupData });
          const body = page.locator('.group-body');
          const box = (await body.boundingBox())!;
          const point = { dataTransfer: setupData, clientX: box.x + box.width - 2, clientY: box.y + box.height / 2 };
          await body.dispatchEvent('dragover', point);
          await body.dispatchEvent('drop', point);
          await setupData.dispose();
          await expect(page.locator('.editor-group')).toHaveCount(2);
        }
        const source = page.locator('.document-tab').filter({ hasText: 'Untitled 3.md' });
        const sourceId = await source.getAttribute('data-tab-id');
        const data = await page.evaluateHandle(() => new DataTransfer());
        await source.dispatchEvent('dragstart', { dataTransfer: data });
        const target = guide === 'other group' || guide === 'other group body'
          ? page.locator('.editor-group').nth(1).locator(guide === 'other group body' ? '.group-body' : '.document-tab').first()
          : page.locator(guide === 'tab strip' ? '.document-tab' : '.group-body').first();
        const box = (await target.boundingBox())!;
        const point = { clientX: box.x + (guide === 'other group body' ? box.width / 2 : 2), clientY: box.y + box.height / 2, dataTransfer: data };
        await target.dispatchEvent('dragover', point);
        const painted = page.locator(guide === 'split' || guide === 'other group body' ? '.group-drop-overlay' : '.tab-drop-indicator');
        await expect(painted).toBeVisible();
        const guideBox = (await painted.boundingBox())!;
        // Native child boundaries report relatedTarget=null without leaving the
        // window. Neither that notification nor stale completion coordinates
        // may replace the placement that the user was actually shown.
        await source.dispatchEvent('dragleave', { ...point, relatedTarget: null });
        await expect(painted).toBeVisible();
        expect(await painted.boundingBox()).toEqual(guideBox);
        if (completion === 'dragend') {
          // Model an accepted native move whose drop never reached the shell.
          // A constructed DataTransfer otherwise retains "none" (cancellation).
          await data.evaluate(transfer => Object.defineProperty(transfer, 'dropEffect', { value: 'move' }));
        }
        await source.dispatchEvent(completion, { dataTransfer: data, clientX: 0, clientY: 0 });
        if (completion === 'drop') await source.dispatchEvent('dragend', { dataTransfer: data });
        await data.dispose();
        await expect(page.locator('.editor-group')).toHaveCount(guide === 'tab strip' ? 1 : 2);
        if (guide === 'tab strip') {
          await expect(page.locator('.tab-name')).toHaveText(['Untitled 3.md', 'Untitled.md', 'Untitled 2.md']);
        } else if (guide === 'other group' || guide === 'other group body') {
          await expect(page.locator('.editor-group').nth(0).locator('.tab-name')).toHaveText(['Untitled 2.md']);
          await expect(page.locator('.editor-group').nth(1).locator('.tab-name')).toHaveText(guide === 'other group body'
            ? ['Untitled.md', 'Untitled 3.md'] : ['Untitled 3.md', 'Untitled.md']);
        } else {
          const movedGroup = page.locator('.editor-group').filter({ has: page.locator(`[data-tab-id="${sourceId}"]`) });
          await expect(movedGroup.locator('.tab-name')).toHaveText(['Untitled 3.md']);
          const remaining = page.locator('.editor-group').filter({ has: page.locator('.tab-name').filter({ hasText: /^Untitled\.md$/ }) });
          expect((await movedGroup.boundingBox())!.x).toBeLessThan((await remaining.boundingBox())!.x);
        }
        await expect(painted).toBeHidden();
        // Wait past main's detach arbitration: no visible or prepared window
        // may survive a completed local placement.
        await page.waitForTimeout(300);
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      } finally {
        await disposeApplication(app);
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

test('a guide is cleared by cancellation, a rejected area, or a real window exit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-guide-clear-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
    await page.locator('.new-tab-button').click();
    for (const outcome of ['cancel', 'reject', 'outside'] as const) {
      const source = page.locator('.document-tab').last();
      const data = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent('dragstart', { dataTransfer: data });
      const box = (await page.locator('.document-tab').first().boundingBox())!;
      await source.dispatchEvent('dragover', { dataTransfer: data, clientX: box.x + 2, clientY: box.y + box.height / 2 });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
      if (outcome === 'cancel') await page.keyboard.press('Escape');
      else await source.dispatchEvent(outcome === 'reject' ? 'dragover' : 'dragleave', {
        dataTransfer: data, clientX: outcome === 'outside' ? -10 : 0, clientY: 0, relatedTarget: null,
      });
      await expect(page.locator('.tab-drop-indicator')).toBeHidden();
      await source.dispatchEvent('dragend', { dataTransfer: data,
        clientX: outcome === 'outside' ? -10 : box.x, clientY: box.y, screenX: 700, screenY: 400 });
      await data.dispose();
      if (outcome === 'outside') {
        await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
        await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
      } else {
        await page.waitForTimeout(300);
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
        await expect(page.locator('.tab-name')).toHaveText(['Untitled.md', 'Untitled 2.md']);
      }
    }
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});

test('pointer release follows the insertion guide and Escape cancels it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-guide-pointer-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    await page.evaluate(() => {
      (window as any).pointerDragEvents = [];
      for (const type of ['dragover', 'dragleave', 'drop', 'dragend', 'keydown']) window.addEventListener(type, event => {
        const e = event as DragEvent;
        (window as any).pointerDragEvents.push({ type, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY, effect: e.dataTransfer?.dropEffect,
          key: (event as KeyboardEvent).key, buttons: e.buttons, window: { x: window.screenX, y: window.screenY, width: innerWidth, height: innerHeight } });
      }, true);
    });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
    for (let i = 0; i < 2; i++) await page.locator('.new-tab-button').click();
    const nativeWindow = await app.browserWindow(page);
    const toScreen = (point: { x: number; y: number }) => nativeWindow.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    for (const cancel of [true, false]) {
      const from = (await page.locator('.document-tab').last().boundingBox())!;
      const to = (await page.locator('.document-tab').first().boundingBox())!;
      const start = await toScreen({ x: from.x + from.width / 2, y: from.y + from.height / 2 });
      const finish = await toScreen({ x: to.x + 30, y: to.y + to.height / 2 });
      await nativeInput({ pointer: [start], button: 'down' });
      await nativeInput({ pointer: Array.from({ length: 15 }, (_, i) => ({ x: start.x + (finish.x - start.x) * (i + 1) / 15, y: finish.y })) });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
      await page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true, clientX: point.x, clientY: point.y, relatedTarget: null,
      })), { x: to.x + 30, y: to.y + to.height / 2 });
      await expect(page.locator('.tab-drop-indicator')).toBeVisible();
      if (cancel) await nativeInput({ keys: ['Escape'] });
      await nativeInput({ button: 'up' });
      await expect(page.locator('.tab-drop-indicator')).toBeHidden();
      await expect(page.locator('.tab-name')).toHaveText(cancel
        ? ['Untitled.md', 'Untitled 2.md', 'Untitled 3.md']
        : ['Untitled 3.md', 'Untitled.md', 'Untitled 2.md']);
      await page.waitForTimeout(300);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    }
    await nativeWindow.dispose();
  } finally {
    await nativeInput({ button: 'up' });
    const page = app.windows()[0];
    if (page && !page.isClosed()) await writeFile(test.info().outputPath('drag-events.json'), JSON.stringify(await page.evaluate(() => (window as any).pointerDragEvents), null, 2));
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
