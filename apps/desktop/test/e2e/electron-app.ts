import { _electron as electron, expect } from '@playwright/test';

export type TestApplication = Awaited<ReturnType<typeof electron.launch>>;

/** CDP input can precede ready-to-show and does not establish native focus. */
export async function focusApplication(application: TestApplication): Promise<void> {
  await application.firstWindow();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
  // Wayland may ignore the first focus request while the window is still being
  // admitted by the compositor. Repeat the native request instead of merely
  // polling stale focus state; CDP keyboard/mouse input depends on this fence.
  await expect.poll(() => application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window?.isFocused()) {
      app.focus({ steal: true });
      window?.show(); window?.moveTop(); window?.focus(); window?.webContents.focus();
    }
    return window?.isFocused();
  })).toBe(true);
}

/**
 * 테스트 정리는 사용자 종료 흐름이 아니다. 창을 파괴해 저장 확인 UI를 우회하고
 * 남은 Electron process까지 기다려, E2E가 사람의 입력을 요구하지 않게 한다.
 */
export async function disposeApplication(application: TestApplication): Promise<void> {
  try {
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  } catch {
    // 테스트가 실제 종료 동작을 검증했다면 process가 이미 끝났을 수 있다.
  }
  await application.close().catch(() => undefined);
}
