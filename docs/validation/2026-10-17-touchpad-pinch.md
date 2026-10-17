# 터치패드 핀치 배율 검증

2026년 10월 17일, 탭 콘텐츠의 작은 핀치를 연속 배율로 반영하도록 수정했다. 실제 Electron의 Chromium 터치패드 입력 경로에서 2% 확대 제스처를 5회 보내면 일반 편집기와 Markdown 읽기 탭 모두 매회 배율이 증가한다. 작은 핀치의 누적 임계값을 제거했고, 플랫폼마다 달라질 수 있는 wheel tick 값에 의존하지 않는다.

## 동작과 범위

- 작은 픽셀 입력은 `exp(-deltaY / 100)`의 상대 배율로 처리하고, 소수점 배율을 보존한다. 큰 마우스 휠 입력과 줄·페이지 단위 입력은 기존 단계별 확대를 유지한다. Chromium의 핀치 변환은 [Chromium 구현](https://chromium.googlesource.com/chromium/src/+/297980d7a0e33b44dce6c727d7016345a80e33fa/content/browser/renderer_host/input/touchpad_pinch_event_queue.cc)에 설명되어 있다.
- 포인터가 놓인 탭으로 전달한다. 노트북 출력과 동영상도 포함하며, 탭을 바꿀 때 누적 입력이 넘어가지 않는다. 분할 화면의 동영상에 핀치해도 선택된 터미널의 배율은 바뀌지 않는다.
- 일반 문서·Git 검토·노트북·터미널·웹 페이지는 기존 탭별 범위인 50–300%를 유지한다. PDF·이미지는 기존 파일 배율과 커서 기준 확대를 사용한다. 주소창의 배율 표시는 반올림하고, 실제 배율과 저장 값은 소수점을 유지한다.
- 앱 전체 배율, 다른 탭, 편집기 Undo, 웹 입력값과 네이티브 뷰 수명을 유지한다. IPC는 검증된 소유자의 제한된 정수 단계 또는 유한한 0.5–2 상대 배율만 받는다.

주요 구현은 [입력 정규화](../../apps/desktop/src/core/wheel-zoom.ts), [탭별 라우팅](../../apps/desktop/src/preload/wheel-zoom.ts), [배율 상태](../../apps/desktop/src/main/windows/workspace-zoom.ts)에 있다. [현재 보장 사항](../preview-performance-contract.md)도 함께 갱신했다.

## 검증

Fedora 44에서 Xvfb, 독립 런타임 디렉터리와 D-Bus 세션을 사용했다. 사용자의 데스크톱에는 테스트 창을 띄우지 않았다. `Input.synthesizePinchGesture`의 `mouse` 입력 경로로 Chromium이 신뢰하는 핀치 이벤트를 생성했으며, Control 키나 DOM WheelEvent를 대신 주입하지 않았다. 실제 물리 터치패드와 Wayland의 제스처 전달 여부는 이 X11 자동화의 검증 범위 밖이다.

| 검사 | 결과 |
| --- | --- |
| 핀치 관련 Electron 검사 | 9개 통과. 웹·영상·문서·Git·PDF·이미지·노트북·터미널 포함 |
| 짧은 핀치 5회 | 편집기 5회 모두 반응, 네이티브 Markdown 읽기 5회 모두 반응 |
| 전체 미리보기 계약 단위 검사 | 70개 파일, 475개 테스트 통과 |
| 빌드 도구 검사 | 11개 통과 |
| 타입 검사와 제품 빌드 | 오류·Svelte 경고 0개 |
| 전체 미리보기 계약 Electron 검사 | 133개 통과, 재시도 없음 |

전체 명령은 `TMPDIR=/var/tmp/setdown-pinch-validation npm run test:preview-contract`이다. 첫 검사에서 공유 `/tmp/.git`이 기존 언어 루트 테스트의 임시 프로젝트 탐색에 간섭하여, 독립 임시 경로에서 전체 검사를 다시 실행했다. 제품 코드나 해당 검사의 단언은 바꾸지 않았다.

[전체 검사 로그](../../reports/touchpad-pinch-validation-2026-10-17/preview-contract.log.txt), [핀치 집중 검사 로그](../../reports/touchpad-pinch-validation-2026-10-17/pinch-e2e.log.txt)

## 미리보기 전환 성능

기준 커밋은 `a54c6aa`이며 `/tmp/setdown-pinch-base-a54c6aa`에 별도 체크아웃과 의존성을 설치하고 빌드했다. 후보 앱도 전체 계약 검사의 제품 빌드를 사용했다. 두 버전은 같은 격리 디스플레이에서 AB/BA 순서로 번갈아 실행한다. 각 버전 5회 반복, 반복마다 8개 시나리오에서 새로운 앱을 실행한다.

```sh
TMPDIR=/var/tmp/setdown-pinch-validation npm run bench:preview -- \
  --baseline /tmp/setdown-pinch-base-a54c6aa --skip-build \
  --output /home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/test-results/touchpad-pinch-20261017
```

첫 회·두 번째 회는 반복 간 중앙값이고, warm은 각 앱의 3–5회 중앙값을 다시 반복 간 중앙값으로 집계한다. Esc 측정은 최신 DOM 확인과 네이티브 캡처 readback을 포함하며 모니터 표시 시각이 아니다. 비교는 기존 기준인 25%와 50ms를 모두 초과할 때 회귀로 판정한다. 아래 수치는 ms, `기준 → 수정`이다.

80개 앱 실행을 완료했고, 48개 비교에서 성능 회귀는 0개였다.

| 문서 | 편집 | 준비 시간 | 측정 | 첫 회 | 두 번째 | warm |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown | 없음 | 0ms | Esc → 캡처 | 38.0 → 34.0 | 27.0 → 22.0 | 22.0 → 21.0 |
| Markdown | 없음 | 0ms | 더블클릭 → 편집 | 16.0 → 28.0 | 34.0 → 34.0 | 12.0 → 12.0 |
| Markdown | 있음 | 0ms | Esc → 캡처 | 439.0 → 439.0 | 94.0 → 102.0 | 92.0 → 91.0 |
| Markdown | 있음 | 0ms | 더블클릭 → 편집 | 21.0 → 21.0 | 17.0 → 13.0 | 13.0 → 13.0 |
| Markdown | 없음 | 3000ms | Esc → 캡처 | 44.0 → 40.0 | 20.0 → 22.0 | 23.0 → 26.0 |
| Markdown | 없음 | 3000ms | 더블클릭 → 편집 | 17.0 → 17.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| Markdown | 있음 | 3000ms | Esc → 캡처 | 109.0 → 111.0 | 104.0 → 100.0 | 90.0 → 89.0 |
| Markdown | 있음 | 3000ms | 더블클릭 → 편집 | 15.0 → 16.0 | 13.0 → 12.0 | 13.0 → 13.0 |
| Git 검토 | 없음 | 0ms | Esc → 캡처 | 1024.0 → 973.0 | 26.0 → 23.0 | 30.0 → 27.0 |
| Git 검토 | 없음 | 0ms | 더블클릭 → 편집 | 26.0 → 24.0 | 12.0 → 12.0 | 12.0 → 13.0 |
| Git 검토 | 있음 | 0ms | Esc → 캡처 | 1051.0 → 1031.0 | 1546.0 → 1533.0 | 183.0 → 186.0 |
| Git 검토 | 있음 | 0ms | 더블클릭 → 편집 | 22.0 → 23.0 | 22.0 → 20.0 | 18.0 → 19.0 |
| Git 검토 | 없음 | 3000ms | Esc → 캡처 | 29.0 → 26.0 | 21.0 → 22.0 | 19.0 → 20.0 |
| Git 검토 | 없음 | 3000ms | 더블클릭 → 편집 | 25.0 → 26.0 | 11.0 → 11.0 | 17.0 → 17.0 |
| Git 검토 | 있음 | 3000ms | Esc → 캡처 | 231.0 → 231.0 | 191.0 → 183.0 | 175.0 → 175.0 |
| Git 검토 | 있음 | 3000ms | 더블클릭 → 편집 | 23.0 → 22.0 | 18.0 → 18.0 | 18.0 → 18.0 |

[48개 비교와 원시 측정값](../../reports/touchpad-pinch-validation-2026-10-17/preview-comparison.json), [실행 로그](../../reports/touchpad-pinch-validation-2026-10-17/preview-benchmark.log.txt), [변경 파일 해시](../../reports/touchpad-pinch-validation-2026-10-17/source-sha256.json). 이 전환 성능 비교는 핀치의 프레임률 측정이 아니다.
