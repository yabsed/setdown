# 보고서 도입 기능 검증 — 2026-10-23

구현 범위는 [125개 항목 대조표](2026-10-23-editor-tools-implementation.md),
제품 사용법과 보존/용량 정책은 [Editor tools](../editor-tools.md)에 기록했다.
기준 commit은 `ebcc57f9d9366762bcde052e795415e139a3dbd4`이며 후보는 이 작업의 미커밋 소스다.

## 검사 환경과 실행 원칙

GUI와 benchmark는 `apps/desktop/scripts/with-isolated-display.sh`를 통해 별도 Xvfb,
private runtime directory, D-Bus session, 제거한 Wayland socket으로 실행한다.
사용자 desktop에는 창을 띄우지 않는다. 실제 Electron/Chromium을 실행하며 retry는 0이다.
원래 assert, timeout, benchmark 25% 및 50ms 이중 허용 오차를 유지한다.

## 검증 중 확인한 실패

- 최초 전체 검사: 196개 중 192개 통과. 독립 comparison 공존에 맞는 active source selector,
  Language Support의 process state selector, WT에서 ordinary view의 명시적 열기가 필요했다.
  이미지 full-detail 검사에서는 한 차례 5초 안에 2048px preview가 full detail로 바뀌지 않았다.
  이미지 크기 assertion/timeout은 변경하지 않았으며 독립 원인 확인과 후속 전체 검사에서 통과했다.
- 두 번째 전체 검사: 197개 중 195개 통과. renderer Reload의 comparison checkpoint 복원이
  빠진 것을 구현에서 수정했다. iframe의 provisional document에서 사라질 수 있는 drag 금지
  stylesheet는 committed DOM readiness에도 설치하도록 수정했다.
- 세 번째 전체 검사: 198개 중 196개 통과. 새 SCM 테스트가 배경 source view를 foreground
  `.editor-surface`에서만 찾던 것을 실제 `.group-editor-host`까지 검사하도록 수정했다.
  native return drag에서는 한 차례 OS dragend의 `dropEffect`가 `none`으로 돌아와 이동이 취소됐다.
  취소 semantics나 순서 assertion을 완화하지 않고 이벤트 기록을 보존했다.
- 최초 완전한 benchmark: 48개 중 2개 회귀. Git review의 preparation 0ms 첫
  capture가 편집 없음 910→1,332ms, 편집 있음 1,007→1,412ms였다.
  Working Tree를 열기 전에 일반 Monaco editor까지 로드하던 대기를 제거했다.
  비교 editor가 기존 live-document provider로 직접 같은 모델을 빌리므로
  native preview 준비와 Monaco 로드가 병행된다. 일반 editor 없이 공유 편집·Undo를
  검증하는 단위 검사를 추가했다. [첫 비교 원자료](../../reports/editor-tools-implementation-2026-10-23/benchmark-initial/comparison.json)를 보존했다.
- 재검증 환경: 일반 sandbox의 vendor Git 자식 프로세스가 `EPERM`으로 차단되어
  승인된 실행 환경에서 같은 빌드를 완료했다. 단위 검사의 임시 프로젝트 상위에서
  `/tmp/.git` 경계가 감지된 환경 의존 실패는 `TMPDIR=/var/tmp`로 분리해 확인했다.
  제품의 root 탐색이나 테스트 assertion은 변경하지 않았다.

각 실패 run의 로그와 native event 기록은
[검증 artifacts](../../reports/editor-tools-implementation-2026-10-23/)에 보존한다.
후속 통과는 이전의 간헐적 native cancellation이 모든 환경에서 제거됐다는 보장이 아니다.

## 최종 실행 결과

| 검사 | 결과 |
| --- | --- |
| `TMPDIR=/var/tmp npm test --workspace @setdown/desktop` | 145 files, 997 tests 통과. 실제 Pyright/basedpyright/clangd 및 terminal 통합 포함. |
| `npm run test:preview-contract` | 90 files, 586 focused tests + tooling 11 tests + typecheck/build + 실제 Electron/Chromium 198 scenarios 통과. GUI 8.9분. |
| TypeScript / test TypeScript / Svelte | 오류 0, warning 0. |
| 격리 실행 | Xvfb/private runtime/D-Bus. GUI retry 0, 시나리오 생략 0. |
| `npm run bench:preview -- --baseline /tmp/setdown-vim-baseline --runs 5 --skip-build --output /tmp/setdown-vim-benchmark-verified` | 80개 새 앱, 48개 비교 조건 모두 통과. 원래 25% 및 50ms 이중 허용 오차 기준 회귀 0. |

[전체 단위·통합 로그](../../reports/editor-tools-implementation-2026-10-23/all-unit.log),
[최종 계약 로그](../../reports/editor-tools-implementation-2026-10-23/preview-contract.log),
[소스 SHA-256](../../reports/editor-tools-implementation-2026-10-23/source-sha256.json).
Focused 단위 검사는 전체 997개에 포함되므로 둘을 더한 총수로 소개하지 않는다.

추가 수용 시나리오에는 SCM file/comparison side-open과 대상 재사용, 가짜 ordinary tab 없는
WT 첫 열기, 일반+두 WT의 shared edit/Undo/save와 독립 native reader, 읽기 전용 history의
명령 disable, Unicode 구조 선택과 의미 반복, smart-search 취소 위치·case·snapshot history,
강제 종료와 외부 디스크 변경 뒤 두 그룹의 dirty recovery, 실제 notebook extraPaths/hover/negative
control이 포함된다. 기존 pointer/IME/zoom/외부 파일 변경/transfer 검사를 그대로 유지했다.

최초 benchmark 회귀 수정 후 전체 계약과 독립 baseline 비교가 모두 통과했다.
[48개 조건의 first/second/warm 중앙값 표](../../reports/editor-tools-implementation-2026-10-23/preview-medians.md),
[모든 표본·순서·환경·빌드 hash](../../reports/editor-tools-implementation-2026-10-23/comparison.json),
[측정 실행 로그](../../reports/editor-tools-implementation-2026-10-23/benchmark.log)를 보존했다.

Preparation 0ms에서 Git review 첫 capture 중앙값은 편집 없음 1,344→951ms,
편집 있음 1,024→988ms였다. 비편집 표본은 기준 919–1,375ms, 후보 909–1,371ms로
양쪽 모두 분산이 컸다. 이 결과는 정해진 중앙값 회귀 기준의 통과를 뜻하며, 모든 첫
열기가 1초 이내라는 보장이나 모든 조건에서 빨라졌다는 주장으로 해석하지 않는다.
원래 발견한 일반 editor 선행 로드를 제거한 뒤 모델 소유권·GUI·전체 비교를 다시 확인했다.

## 성능 비교 방법

별도 `/tmp/setdown-vim-baseline` checkout은 기준 commit과 일치하며 자체 설치 의존성과
Electron을 사용한다. 동일한 후보 harness/fixture, 동일한 가상 display에서 AB/BA 순서로
baseline/candidate를 번갈아 측정한다. 5회 반복 × 2버전 × 8시나리오 = 80개 새 앱이다.
각 앱의 5 cycles에서 first, second, warm(3–5의 median)을 따로 집계한다.
일반 Markdown/Git review, 편집 유무, preparation 0/3000ms, Esc/native capture와
실제 double-click→source의 48개 bucket 모두를 보고한다.
최종 비교의 `--skip-build`는 직전 전체 계약에서 만든 후보 빌드와 최초 비교에서 만든
독립 baseline 빌드를 그대로 사용한다. 측정 전후 두 빌드의 hash와 harness hash를
검사한다. 테스트·시나리오·측정 준비 시간을 생략하는 옵션이 아니다.
