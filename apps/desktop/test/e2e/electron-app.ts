import { _electron as electron } from '@playwright/test';

export type TestApplication = Awaited<ReturnType<typeof electron.launch>>;

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
