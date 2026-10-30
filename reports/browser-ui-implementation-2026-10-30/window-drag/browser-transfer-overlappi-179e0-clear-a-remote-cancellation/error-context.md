# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/transfer.spec.ts >> overlapping windows accept repeated web body drops and clear a remote cancellation
- Location: test/e2e/browser/transfer.spec.ts:11:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { _electron, expect } from '@playwright/test';
  2  | import { createRequire } from 'node:module';
  3  | 
  4  | // Resolve the app's Electron, even when npm installs it inside the workspace.
  5  | const executablePath = createRequire(import.meta.url)('electron') as string;
  6  | export const electron = {
  7  |   launch: (options: Parameters<typeof _electron.launch>[0] = {}) => _electron.launch({ executablePath, chromiumSandbox: true, ...options }),
  8  | };
  9  | 
  10 | export type TestApplication = Awaited<ReturnType<typeof electron.launch>>;
  11 | 
  12 | /** CDP input can precede ready-to-show and does not establish native focus. */
  13 | export async function focusApplication(application: TestApplication): Promise<void> {
  14 |   await application.firstWindow();
> 15 |   await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
     |                                                                                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  16 |   // Wayland may ignore the first focus request while the window is still being
  17 |   // admitted by the compositor. Repeat the native request instead of merely
  18 |   // polling stale focus state; CDP keyboard/mouse input depends on this fence.
  19 |   await expect.poll(() => application.evaluate(({ app, BrowserWindow }) => {
  20 |     const window = BrowserWindow.getAllWindows()[0];
  21 |     if (!window?.isFocused()) {
  22 |       app.focus({ steal: true });
  23 |       window?.show(); window?.moveTop(); window?.focus(); window?.webContents.focus();
  24 |     }
  25 |     return window?.isFocused();
  26 |   })).toBe(true);
  27 | }
  28 | 
  29 | /**
  30 |  * 테스트 정리는 사용자 종료 흐름이 아니다. 창을 파괴해 저장 확인 UI를 우회하고
  31 |  * 남은 Electron process까지 기다려, E2E가 사람의 입력을 요구하지 않게 한다.
  32 |  */
  33 | export async function disposeApplication(application: TestApplication): Promise<void> {
  34 |   try {
  35 |     await application.evaluate(({ BrowserWindow }) => {
  36 |       for (const window of BrowserWindow.getAllWindows()) window.destroy();
  37 |     });
  38 |   } catch {
  39 |     // 테스트가 실제 종료 동작을 검증했다면 process가 이미 끝났을 수 있다.
  40 |   }
  41 |   await application.close().catch(() => undefined);
  42 | }
  43 | 
```