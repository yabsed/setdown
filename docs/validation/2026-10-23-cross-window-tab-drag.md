# 창 사이 탭 이동과 파란 드롭 안내 — 2026-10-23

사용자가 보고한 파란 영역은 탭을 받을 그룹을 표시하는 드롭 안내다. 별도 오류 창은 아니다.
하지만 안내가 보이는 상태에서 놓아도 탭이 이동하지 않는 실패를 실제 Electron에서 재현했다.
웹 탭과 터미널 탭, 겹친 두 창, 탭 바를 거치지 않고 본문으로 들어가는 경로를 사용했다.

## 재현에서 확인한 원인

1. 다른 창의 웹/Markdown `WebContentsView`는 별도 네이티브 화면이다. 그 화면으로
   바로 진입하면 shell의 `dragover`가 오지 않아 드롭 대상을 정하지 못할 수 있다.
2. shell이 파란 안내와 `move`를 표시해도 실제 DOM `drop`이 빠지는 경우가 있었다.
   source에는 `dragend: move`가 왔고, receiver에는 좌표 `(0, 0)`의 `dragleave`만 왔다.
   기존 source의 detach 판단은 다른 창 위에서는 새 창을 만들지 않으므로 아무 이동도 일어나지 않았다.
3. `dragend`는 source에만 온다. receiver에서 끝을 알 수 없으면 파란 안내와 네이티브 화면의
   캡처 상태를 해제하지 못한다.
4. 캡처·두 paint frame·네이티브 화면 숨김이 drag 시작 뒤 완료되는 경로에서는
   포인터가 지나가던 네이티브 화면이 숨겨진 뒤 실제 release도 `none`으로 끝났다.
   숨김 완료를 기다린 별도 진단에서는 재현되지 않았으며, 정식 검사에는 이 대기를 넣지 않았다.
5. 같은 창의 그룹 경계를 빠르게 넘은 뒤 놓을 때 새 위치의 `dragover` 없이 release가 올 수
   있었다. 첫 진입인 `dragenter`에서도 새 안내를 계산하여 이전 strip 위치가 남지 않게 했다.
6. 창 밖에서 돌아오는 경로에는 비대상 제목 영역의 `dragover` 다음에 유효한 탭의 진입과
   `dragend: none`이 기록됐다. 이 경로에서 직전 거절 상태가 native transport에 남는 것으로
   판단해, 내부 탭 운반은 chrome을 지나갈 때도 승인하고 실제 배치는 안내 위치로 제한했다.

## 수정

- 탭을 누를 때 source 캡처를 먼저 준비한다. 실제 drag로 이어지면 유지하고,
  클릭/포인터 취소/blur로 끝나면 해제한다. 닫기·음소거 버튼은 준비를 시작하지 않는다.
- main이 유효한 transfer의 시작과 끝을 보이는 모든 shell에 공유한다. receiver도
  네이티브 화면을 미리 덮고, 이동·취소·source 종료·만료 때 안내와 캡처를 정리한다.
- receiver가 허용한 대상을 main에 기록한다. DOM drop이 빠져도 source의 종료 결과가
  `move`/`copy`이고 release가 마지막 receiver의 현재 창 안이면 그 안내 위치로 한 번만 claim한다.
- `dragenter`와 `dragover`가 같은 위치 판정을 사용한다. 경계를 빠르게 넘은 release도
  새로 들어간 탭 바/그룹의 안내를 따른다.
- 비대상 제목/주소 영역에서는 안내를 지우되 내부 탭 운반 상태는 유지한다. 그 영역에
  놓으면 여전히 이동·복사·새 창 분리 없이 취소한다. 전송 승인과 배치 승인을 분리한다.
- Esc와 `none`은 안내를 이동 승인으로 사용하지 않는다. 다른 영역으로 이탈, 숨겨진/최소화된/
  닫힌 창, 중복 claim, 다른 source의 요청도 승인하지 않는다. 창 밖 detach와 source 본문 중앙
  tear-off의 우선순위 및 늦게 도착한 정상 claim은 유지한다.

웹 탭은 같은 native page를, 터미널은 같은 PTY를 넘기므로 페이지 상태와 입력 중인 문장이 유지된다.
미리보기 엔진·Electron 버전·의존성·성능 허용 오차는 변경하지 않았다.

## 검증 기록

모든 GUI 실행은 Xvfb/private runtime/D-Bus 및 제거한 Wayland socket으로 격리했다.
새 재현·반복 회귀 시나리오는 실제 XTest 포인터와 키 입력을 사용하며 synthetic DOM drag,
retry, 느린 입력으로의 대체는 없다. 기존 계약 시나리오의 assertion을 유지하며,
CDP/OS 입력 불일치를 바로잡은 한 동작의 변경은 아래에 기록한다.
사용자의 Wayland desktop에 창을 띄우지 않았다. 별도 native Wayland compositor 검증은 하지 않았다.

- 최초 실제 재현: 웹/터미널 2 scenarios 실패. 이 결과와 이벤트·스크린샷을 보존한다.
- lifetime 공유만 적용한 중간 결과: 안내는 나타나지만 DOM drop 누락으로 이동 실패.
- 종료 승인 전달 후: 이동은 됐으나 빠른 웹 이동의 `none`이 남았다. 숨긴 준비 창의 생성을
  미루는 실험으로는 해결되지 않아 해당 변경은 원복했다.
- Esc 직후 같은 좌표를 즉시 누른 시험 입력이 X11 double-click으로 처리된 문제는 grab 좌표를
  바꾸어 해결했다. 이동 횟수·취소 시나리오·assertion·timeout은 그대로 유지했다.
- 캡처 시점 수정 후 정식 반복 검사: 2 scenarios 통과. 각 6회 이동 + 1회 Esc 취소,
  양쪽 안내/캡처 해제, 창 수, 같은 live page 및 미전송 터미널 입력을 검사했다.
- transfer manager 단위 검사 28개 통과. 이 검사는 아래 focused 603개에 포함된다.
- 첫 전체 계약은 199/200 GUI 통과였다. 웹 탭을 같은 창의 원래 그룹으로 되돌리는 검사에서
  CDP `mouse.down` 뒤 네이티브 화면 숨김이 실제 X11 cursor의 `buttons=0` mousemove를
  주입했고 두 번째 `dragstart`가 없었다. 이 return 동작은 실제 OS 입력으로 변경했다.
  pointer pacing은 0ms이며 assertion/timeout/이동 대상은 그대로다. 이어지는 실제 native
  검사에서 위 5번의 경계 진입 문제도 확인해 제품 코드를 수정했다.
- 경계 진입 수정 후 빠른 그룹 합치기와 웹/터미널 창 간 이동의 집중 검사 3개가 통과했다.
- 두 번째 전체 검사는 198/200 GUI 통과였다. iframe의 `-webkit-app-region`이 `no-drag`로
  바뀌지 않는 실패와 위 6번의 native return 실패를 확인했다. 페이지 preload의 초기 적용과 프레임 자체의 알림에 더해,
  같은 renderer process의 살아 있는 상위 프레임에도 확정된 자식의 frame token을 전달한다.
  상위 preload가 그 native frame에 USER-origin 규칙을 적용한다. 웹사이트에 API를 노출하거나
  작성된 DOM/style 속성을 덮어쓰지 않는다. 기존 클릭·새로고침 검사에 자식 탐색, 중첩 iframe,
  동적 교체 검사를 추가했다. 이 추가 수정의 검증 결과도 아래 최종 결과에 포함한다.
- 최종 수정 후 6개 시나리오 × 5회 독립 실행, 총 30개 모두 통과(1.7분). `--repeat-each 5`는
  실패를 재시도해 덮는 옵션이 아니다. 30개 중 하나라도 실패하면 전체 실패이며, retry는 0이다.
  [입력 기록·스크린샷](../../reports/cross-window-tab-drag-2026-10-23/stress-verified/)과
  [실행 로그](../../reports/cross-window-tab-drag-2026-10-23/stress-verified.log)를 보존한다.

프레임 식별과 USER-origin CSS는 Electron의
[webFrame 공식 API](https://www.electronjs.org/docs/latest/api/web-frame#webframefindframebytokenframetoken)를
사용한다. 이전 전체 실행의 실패를 통과로 집계하지 않으며, 원자료를 따로 보존한다.

코드의 보존 조건은 [workspace 계약](../contracts/workspace.md#editor-groups)에 추가했다.
위 원인은 이 저장소의 입력·IPC·네이티브 가시성 기록에 근거한다. Electron의 일반적인
WebContentsView 구조는 [공식 문서](https://www.electronjs.org/docs/latest/api/web-contents-view)를
참고했으며, 다른 버전의 upstream 이슈를 이번 실패의 확정 원인으로 간주하지 않는다.

## 최종 결과

| 검사 | 결과 |
| --- | --- |
| `npm run test:preview-contract` | 90 files / 603 focused tests, tooling 11 tests, typecheck/build, 실제 Electron/Chromium 200 scenarios 모두 통과. GUI 9.0분. |
| TypeScript / test TypeScript / Svelte | 오류 0. Svelte 경고 0. |
| 6개 관련 GUI 시나리오의 5회 독립 반복 | 30/30 통과. 창 간 반복 이동, 빠른 그룹 합치기, 밖에서 돌아오기, Esc 취소, iframe 탐색/교체 포함. |
| 비교 benchmark | 5회 × 2빌드 × 8시나리오 = 80개 새 앱. 48/48 비교 통과, 회귀 0. 기존 25%와 50ms 이중 허용 오차 유지. |
| 소스 동일성 | 최종 빌드 이후와 benchmark 종료 후 665개 소스·검사·빌드 입력의 SHA-256 일치. |

[전체 계약 로그](../../reports/cross-window-tab-drag-2026-10-23/preview-contract.log),
[GUI artifacts](../../reports/cross-window-tab-drag-2026-10-23/contract-verified/),
[소스 SHA-256](../../reports/cross-window-tab-drag-2026-10-23/source-sha256.json)을 보존했다.
이전 두 전체 실행은 각각 199/200, 198/200으로 실패했으며 최종 통과 결과와 구분했다.

성능 명령:

```sh
npm run bench:preview -- --baseline /tmp/setdown-vim-baseline --runs 5 --skip-build --output /tmp/setdown-cross-window-benchmark
```

별도 기준 checkout은 `ebcc57f9d9366762bcde052e795415e139a3dbd4`와 자체 설치 의존성·Electron을
사용했다. 후보는 같은 HEAD의 보고서 도입 구현과 이번 입력 수정까지 포함한 작업 트리다.
따라서 이번 드래그 수정만 분리한 성능 비교는 아니다. 두 빌드 모두 Electron 44.7.2이며
같은 가상 display에서 동일한 후보 harness/fixture로 AB/BA 순서를 번갈아 실행했다.
`--skip-build`는 직전 전체 계약에서 검증한 후보 빌드와 이미 준비된 독립 기준 빌드를 재사용한다.
측정 전후 빌드와 harness hash 검사를 통과했으며, 측정 중 다른 GUI 검사나 빌드를 실행하지 않았다.

일반 Markdown/Git review, 편집 없음/있음, 준비 시간 0/3000ms 각각에 대해
첫 번째·두 번째·warm(앱별 3–5 cycle 중앙값의 중앙값)을 따로 보고했다.
Esc→최신 내용의 nonempty native capture와 실제 double-click→source의 모든 조건이 포함된다.
이 값은 polling·IPC·capture readback을 포함하며 모니터 표시 timestamp가 아니다.

[48개 조건의 중앙값 표](../../reports/cross-window-tab-drag-2026-10-23/preview-medians.md),
[표본·순서·환경·빌드 hash](../../reports/cross-window-tab-drag-2026-10-23/comparison.json),
[모든 실행 원자료](../../reports/cross-window-tab-drag-2026-10-23/benchmark/),
[benchmark 로그](../../reports/cross-window-tab-drag-2026-10-23/benchmark.log).
