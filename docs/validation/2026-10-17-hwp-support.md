# HWP / HWPX 통합 검증

> 이 문서는 당시 검증 기록입니다. HWP 지원은 2026-10-30에 제거되었습니다. [현재 계약](../preview-performance-contract.md#hwp-support-removal--2026-10-30)을 참고하세요.

2026년 10월 17일, `214c26a165a58826dce2c70d79c511003723f182`가 고정한 HOP/RHWP를 재사용하여 Setdown에 HWP/HWPX 열기·편집·저장을 연결했다. 파서·조판·표 편집·Undo 엔진과 Studio 편집 UI는 vendor 소스를 사용하며, Setdown은 문서 수명과 파일 저장을 담당한다.

## 구현 범위

- 로컬 `WebContentsView`마다 RHWP 문서와 편집 기록을 유지한다. 탭 왕복과 창 이동에서 같은 실행 인스턴스를 사용한다.
- 확장자에 따라 HWP/HWPX 바이너리를 저장한다. 텍스트 모델과 UTF-8 저장 경로를 통하지 않는다.
- 내보낸 revision만 저장 완료로 인정하고, 디스크 버전·SHA-256·창 소유권을 다시 확인한 뒤 임시 파일을 rename한다. 보고된 변환 손실이 있는 원본 덮어쓰기를 거절한다.
- 한국어 IME, 저장·다른 이름 저장, 앱 메뉴, 주소 전환, 문서 배율, 읽기 위치, 외부 변경 알림과 닫기 확인을 연결한다.
- HOP의 배포 WASM과 고정 Studio를 로컬 번들로 만든다. 재배포 글꼴 고지를 포함하고, 원격 네트워크와 일반 데스크톱 API 접근을 차단한다.

[지원 범위와 제한](https://github.com/yabsed/setdown/blob/8b883667ba5e0414b0fd3320c9947a25dbb47c24/docs/hwp-support.md), [메인 문서 관리자](https://github.com/yabsed/setdown/blob/8b883667ba5e0414b0fd3320c9947a25dbb47c24/apps/desktop/src/main/hwp/hwp-manager.ts), [Studio 호스트](https://github.com/yabsed/setdown/blob/8b883667ba5e0414b0fd3320c9947a25dbb47c24/apps/desktop/hwp-runtime/main.ts), [구현 파일 43개의 SHA-256](../../reports/hwp-integration-2026-10-17/implementation-sha256.json)

## 기능과 회귀 검사

Linux의 격리 Xvfb·runtime directory·D-Bus 세션에서 실제 Electron 44.7.2를 실행했다. 사용자 데스크톱이나 Wayland 소켓은 사용하지 않았다.

| 실행 | 결과 |
| --- | --- |
| `npm test` | 132개 파일, 892개 단위 테스트 통과 |
| `npm run test:preview-contract` 단위 검사 | 75개 파일, 487개 테스트 통과 |
| 빌드 도구 검사 | 11개 통과 |
| TypeScript / Svelte / 제품 빌드 | 통과, Svelte 오류·경고 0개 |
| 계약의 Electron / Chromium 시나리오 | 145개 통과 |
| HWP/HWPX 집중 시나리오 | 2개 통과, 위 145개에도 포함 |

HWP와 HWPX 각각 엔진의 실제 빈 문서 템플릿에 한글 본문과 2×2 표를 넣고, 한글 조합 시작·완료, 조합 중 저장 거절, 실제 Ctrl+S, 저장 파일 재파싱, 셀 텍스트·표 구조 보존을 확인했다. 클립보드 복사, 다른 탭 왕복, 저장 후 Undo, 외부 변경 알림의 native view 경계와 충돌, Save As 취소·성공, 창 이동 후 Redo와 이전 창의 권한 거절, 닫기 취소도 검사했다. 주소로 같은 탭의 문서를 교체한 뒤 새 문서에만 저장되는지 검사했다.

손실 보고서를 테스트에서 주입해 원본 덮어쓰기를 거절하고 원본 바이트와 dirty 상태를 유지하는지 확인했다. 실제 비지원 요소를 엔진이 모두 탐지한다는 증거는 아니다. 테스트 개발 중에는 실제 탭 활성화와 새 native view 생성까지 기다리도록 검사 동기화를 수정했다. 자동 재시도, 기존 단언 축소, 성능 허용치 변경은 하지 않았다.

[전체 단위 검사 로그](../../reports/hwp-integration-2026-10-17/unit-tests.log.txt), [최종 계약 검사 로그](../../reports/hwp-integration-2026-10-17/preview-contract.log.txt), [집중 검사 로그](../../reports/hwp-integration-2026-10-17/hwp-editor.log.txt), [HWP 편집 화면](../../reports/hwp-integration-2026-10-17/editor-hwp.png), [HWPX 편집 화면](../../reports/hwp-integration-2026-10-17/editor-hwpx.png)

## 기존 미리보기 성능

기준은 구현 전 커밋 `51ad5d4e2b825df333c4ff57183d583c7e9a9791`의 별도 체크아웃 `/tmp/setdown-hwp-baseline-checkout`이다. 같은 lockfile에 따른 별도 의존성을 준비하고 기준 소스를 변경하지 않은 채 빌드했다. Electron 44.7.2 배포본과 브라우저 빌드 캐시는 독립 복사했으며 후보의 `node_modules` 또는 빌드 디렉터리를 공유하지 않았다. 기준·후보 제품 빌드는 모두 성공했다.

```sh
npm run bench:preview -- \
  --baseline /tmp/setdown-hwp-baseline-checkout \
  --output /home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/test-results/hwp-support-20261017
```

두 버전은 같은 가상 디스플레이에서 AB/BA 순서로 각 5회 실행했다. 각 반복은 Markdown·Git 검토 × 편집 유무 × 준비 시간 0·3000ms의 8개 시나리오를 새 프로세스와 프로필에서 실행한다. 각 시나리오는 5회 전환하며 첫 회·두 번째 회를 별도로, 3~5회는 warm 중앙값으로 집계한다. 아래 값은 반복 간 중앙값(ms), `기준 → 구현`이다. 준비 시간은 입력 전에 주는 시간이며 Esc 측정값에 더하지 않는다.

**80회 앱 실행, 48개 비교를 완료했고 25%와 50ms를 모두 초과하는 회귀는 0개였다.** 최신 내용 확인이나 native capture에 실패한 측정은 없다. 측정 중 하네스와 빌드 산출물의 해시도 유지됐다. Esc 값에는 polling·IPC·캡처 readback이 포함되며 모니터 표시 시각을 뜻하지 않는다.

| 문서 | 편집 | 준비 시간 | 측정 | 첫 회 | 두 번째 | warm |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown | 없음 | 0ms | Esc → 캡처 | 35.0 → 38.0 | 25.0 → 22.0 | 22.0 → 23.0 |
| Markdown | 없음 | 0ms | 더블클릭 → 편집 | 17.0 → 16.0 | 35.0 → 34.0 | 11.0 → 12.0 |
| Markdown | 있음 | 0ms | Esc → 캡처 | 441.0 → 440.0 | 101.0 → 96.0 | 93.0 → 94.0 |
| Markdown | 있음 | 0ms | 더블클릭 → 편집 | 18.0 → 20.0 | 13.0 → 16.0 | 14.0 → 14.0 |
| Markdown | 없음 | 3000ms | Esc → 캡처 | 45.0 → 42.0 | 20.0 → 20.0 | 21.0 → 19.0 |
| Markdown | 없음 | 3000ms | 더블클릭 → 편집 | 16.0 → 16.0 | 11.0 → 11.0 | 11.0 → 11.0 |
| Markdown | 있음 | 3000ms | Esc → 캡처 | 104.0 → 109.0 | 104.0 → 100.0 | 90.0 → 90.0 |
| Markdown | 있음 | 3000ms | 더블클릭 → 편집 | 19.0 → 20.0 | 16.0 → 13.0 | 13.0 → 13.0 |
| Git 검토 | 없음 | 0ms | Esc → 캡처 | 928.0 → 946.0 | 22.0 → 23.0 | 20.0 → 29.0 |
| Git 검토 | 없음 | 0ms | 더블클릭 → 편집 | 22.0 → 21.0 | 12.0 → 11.0 | 12.0 → 12.0 |
| Git 검토 | 있음 | 0ms | Esc → 캡처 | 972.0 → 983.0 | 1446.0 → 1446.0 | 176.0 → 176.0 |
| Git 검토 | 있음 | 0ms | 더블클릭 → 편집 | 25.0 → 24.0 | 21.0 → 21.0 | 18.0 → 17.0 |
| Git 검토 | 없음 | 3000ms | Esc → 캡처 | 28.0 → 26.0 | 23.0 → 21.0 | 17.0 → 18.0 |
| Git 검토 | 없음 | 3000ms | 더블클릭 → 편집 | 24.0 → 23.0 | 11.0 → 11.0 | 17.0 → 17.0 |
| Git 검토 | 있음 | 3000ms | Esc → 캡처 | 226.0 → 230.0 | 174.0 → 182.0 | 177.0 → 178.0 |
| Git 검토 | 있음 | 3000ms | 더블클릭 → 편집 | 20.0 → 22.0 | 18.0 → 17.0 | 17.0 → 17.0 |

[전체 비교 JSON](../../reports/hwp-integration-2026-10-17/preview-comparison.json), [성능 검사 로그](../../reports/hwp-integration-2026-10-17/preview-benchmark.log.txt), [기준 빌드 로그](../../reports/hwp-integration-2026-10-17/baseline-build.log.txt), [후보 빌드 로그](../../reports/hwp-integration-2026-10-17/candidate-build.log.txt)

## 검증의 한계

실제 한컴 한글에서의 독립 재열기, Windows GUI, OS IME 후보 창, 복잡한 실제 문서 전체의 시각적 동등성은 이번 검사로 입증하지 않았다. HWP 자체의 대형 문서 로딩·메모리 사용량을 재는 전용 성능 검사는 별도 과제이며 위 표는 기존 Markdown/Git 경로의 회귀 검사다.

128 MiB 이하 파일을 대상으로 하며 암호·DRM, 자동 저장·크래시 복구, PDF 내보내기, 프로젝트 본문 검색·텍스트 Git diff는 현재 범위에 포함하지 않는다. HWP 3는 원본 덮어쓰기를 막고 다른 형식의 사본 저장만 허용한다. 지원 세부 사항과 폰트 대체, 파일 교체의 경쟁 구간은 [지원 문서](https://github.com/yabsed/setdown/blob/8b883667ba5e0414b0fd3320c9947a25dbb47c24/docs/hwp-support.md)에 기록했다.
