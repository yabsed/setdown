# 노트북 스크롤 상단 잘림 수정 검증

수정 전 기준은 `b713013`이다. 긴 코드 셀을 스크롤하면 고정된 섹션 제목 아래에 30px 빈 띠가 남고 그 아래에서 코드가 잘려 보이는 문제를 수정했다.

## 원인과 변경

`NotebookSurface.svelte`는 스크롤 컨테이너에 위쪽 padding 30px를 적용했다. CSS sticky 편집기도 이 여백 아래에 고정됐지만, `NotebookCell.svelte`는 컨테이너의 맨 위를 기준으로 내부 스크롤 위치를 계산했다. 실제 Electron에서 스크롤 상단은 y=176, 편집기 상단은 y=206으로 측정됐다. [초기 진단 값](notebook-scroll-2026-10-22/initial-diagnosis.json).

시작 30px·끝 100px 여백을 스크롤 콘텐츠 안의 블록으로 옮겼다. 처음과 마지막의 공간은 유지하면서 긴 셀 내부에서는 편집기가 viewport 경계에 붙는다. 내부 스크롤 위치는 편집기와 셀의 실제 좌표 차이로 계산해, 셀 끝에서 고정 위치가 제한되는 경우도 일치시켰다.

변경 코드는 [NotebookSurface.svelte](../../apps/desktop/src/renderer/notebook/NotebookSurface.svelte)와 [NotebookCell.svelte](../../apps/desktop/src/renderer/notebook/NotebookCell.svelte)에 있다. 원본 노트북의 내용이나 저장 형식은 변경하지 않는다.

## 재현과 회귀 검사

[notebook.spec.ts](../../apps/desktop/test/e2e/notebook/notebook.spec.ts)에 확대율 90%·100%·130% 시나리오를 추가했다. `Tiles` 제목과 140줄 코드 셀을 사용해 다음을 확인한다.

- 처음과 맨 위로 돌아온 뒤에는 시작 여백 30px가 유지된다.
- 세 스크롤 위치에서 편집기 상하 경계가 viewport와 일치하고 코드 줄 위치가 논리적 위치와 1px 미만의 차이를 가진다.
- 창 크기를 바꾸거나 셀 끝까지 스크롤해도 위치가 일치하고 마지막 줄이 보인다.
- 검사 전후 디스크의 코드 셀 본문이 동일하다.

새 검사는 수정 전 빌드에서 **상단 간격 30px**로 실패했다. [수정 전 로그](notebook-scroll-2026-10-22/before.log.txt), [수정 전 화면](notebook-scroll-2026-10-22/before.png). 수정 후에는 세 확대율 모두 **상단 간격 0px**였다. 기존 긴 셀의 wheel·커서 이동·Undo 및 스크롤 중 한글 입력·검색 검사를 포함한 집중 검사 **5개가 통과**했다. [집중 검사 로그](notebook-scroll-2026-10-22/focused.log.txt).

아래 좌표 단위는 CSS px다.

| 앱 확대율 | 시작 여백 | 긴 셀 상단 간격 | 근거 |
| --- | ---: | ---: | --- |
| 90% | 30px | 0px | [좌표](notebook-scroll-2026-10-22/geometry-90.json), [화면](notebook-scroll-2026-10-22/after-90.png) |
| 100% | 30px | 0px | [좌표](notebook-scroll-2026-10-22/geometry-100.json), [화면](notebook-scroll-2026-10-22/after-100.png) |
| 130% | 30px | 0px | [좌표](notebook-scroll-2026-10-22/geometry-130.json), [화면](notebook-scroll-2026-10-22/after-130.png) |

첫 확대율 검사에서는 DOMRect 높이의 반올림을 줄 번호만큼 곱해 테스트가 약 1px의 누적 오차를 만들었다. 계산 기준을 Monaco의 논리적 CSS 줄 높이로 바로잡았으며 허용치 1px는 유지했다. [해당 실패 로그](notebook-scroll-2026-10-22/before-oracle-correction.log.txt). 기존 검사가 확인하던 셀 높이·커서 이동에 상단 빈 공간과 줄 좌표 검증을 추가했다.

## 전체 계약 검사

`npm run test:preview-contract`에서 단위 검사 554개와 tooling 검사 11개가 통과했다. TypeScript·Svelte 검사와 production build도 완료됐으며 Svelte 오류·경고는 0개다. GUI는 사용자 데스크톱과 분리된 Xvfb·runtime·D-Bus에서 실행했다. 실제 Electron 검사는 **192개 중 191개 통과·1개 실패**로 끝났다. 노트북 파일의 검사 12개는 모두 통과했다. [전체 실행 로그](notebook-scroll-2026-10-22/contract.log.txt).

전체 실행 중 `browser/layout.spec.ts`의 `website draggable CSS cannot consume home navigation input in web tab frames`가 실패했다. [실패 상세](notebook-scroll-2026-10-22/browser-failure-context.md). 상위 문서의 스타일은 `no-drag`였지만 iframe 내부는 `drag`로 남았다. 수정 전 빌드의 해당 단독 검사는 [통과했다](notebook-scroll-2026-10-22/browser-baseline-focused.log.txt). 관련 preload·manager·검사 소스와 빌드된 preload의 [SHA-256은 기준·변경본 사이에 동일하다](notebook-scroll-2026-10-22/browser-failure-source-comparison.json). 이번 노트북 변경과의 인과관계나 실패 조건은 확정하지 못했으며, 이 실패를 삭제하거나 재시도로 통과 처리하지 않는다. 따라서 전체 계약 검사를 통과했다고 주장하지 않는다.

## 미리보기 성능 비교

별도 checkout `/tmp/setdown-bugfix-base-2b85ddb`을 `b713013`으로 갱신하고 자체 `npm ci`와 production build를 수행했다. 경로 이름은 이전 검증에서 사용한 이름이며 실제 기준 커밋은 `b713013`이다. 변경본도 전체 production build를 완료한 뒤 동일한 가상 화면에서 비교했다. 양쪽 Electron은 44.7.2이며 의존성은 각자 설치되어 있다.

기본 설정 그대로 버전별 5회씩, 8개 시나리오에서 총 80회 앱을 실행했다. 기준·변경본 순서를 번갈아 배치했으며 같은 Xvfb 화면을 사용했다. 기존 기준인 **25%와 50ms를 모두 초과하는 증가**를 유지했다. 비교 결과: **48개 항목 중 0개 성능 회귀**, 측정 판정 `passed=true`. 이 판정은 아래 성능 측정에 한정되며 위 전체 계약 검사의 실패를 대체하지 않는다.

[비교 원본과 실행·빌드 식별 정보](notebook-scroll-2026-10-22/preview-comparison.json), [벤치마크 로그](notebook-scroll-2026-10-22/benchmark.log.txt). 개별 실행 JSON·로그는 `test-results/notebook-scroll-preview-20261022/`에 있다. 수정된 소스·회귀 검사의 [SHA-256](notebook-scroll-2026-10-22/source-sha256.json)도 보존했다.

수치는 **수정 전 → 수정 후**, 단위는 ms이며 5회 실행의 중앙값이다. warm은 각 앱의 3–5번째 전환 중앙값을 다시 실행 간 중앙값으로 집계한다. 최신 편집 내용을 확인한 실제 네이티브 capture와 브라우저 입력을 사용한다. 일반/Git 미리보기에 대한 회귀 검증이며 노트북 스크롤 CPU 성능 측정은 아니다.

### 준비 대기 제외: Esc → 최신 내용 capture

| 문서 | 편집 | 첫 전환 전 준비 대기 | 첫 번째 | 두 번째 | warm (3–5회) |
| --- | --- | ---: | ---: | ---: | ---: |
| 일반 Markdown | 없음 | 0ms | 42 → 35 | 22 → 22 | 23 → 22 |
| 일반 Markdown | 있음 | 0ms | 443 → 439 | 103 → 101 | 90 → 93 |
| 일반 Markdown | 없음 | 3000ms | 43 → 42 | 18 → 21 | 24 → 23 |
| 일반 Markdown | 있음 | 3000ms | 110 → 103 | 100 → 105 | 92 → 94 |
| Git review | 없음 | 0ms | 1021 → 1000 | 18 → 19 | 27 → 29 |
| Git review | 있음 | 0ms | 1093 → 1094 | 1592 → 1569 | 178 → 178 |
| Git review | 없음 | 3000ms | 26 → 25 | 22 → 21 | 16 → 19 |
| Git review | 있음 | 3000ms | 229 → 222 | 181 → 182 | 173 → 178 |

### Double-click → 편집 가능

| 문서 | 편집 | 첫 전환 전 준비 대기 | 첫 번째 | 두 번째 | warm (3–5회) |
| --- | --- | ---: | ---: | ---: | ---: |
| 일반 Markdown | 없음 | 0ms | 38 → 17 | 36 → 39 | 11 → 11 |
| 일반 Markdown | 있음 | 0ms | 15 → 19 | 13 → 14 | 14 → 13 |
| 일반 Markdown | 없음 | 3000ms | 16 → 16 | 12 → 12 | 11 → 11 |
| 일반 Markdown | 있음 | 3000ms | 19 → 20 | 16 → 16 | 14 → 13 |
| Git review | 없음 | 0ms | 23 → 23 | 12 → 11 | 13 → 12 |
| Git review | 있음 | 0ms | 15 → 15 | 21 → 22 | 19 → 20 |
| Git review | 없음 | 3000ms | 24 → 25 | 11 → 11 | 17 → 17 |
| Git review | 있음 | 3000ms | 22 → 13 | 17 → 18 | 17 → 16 |

### 준비 대기 포함: 대기 시작 → 첫 capture

첫 번째 열의 소요 시간에 설정된 준비 대기 0ms 또는 3000ms를 더했다. 이는 사용자 대기를 포함한 합계이며 CPU 준비 작업 자체의 실행 시간 측정은 아니다. 준비 대기는 첫 전환 전에만 존재하므로 두 번째·warm 값은 위와 같다. Double-click 측정 구간에는 이 준비 대기가 포함되지 않는다.

| 문서 | 편집 | 첫 전환 전 준비 대기 | 첫 번째 | 두 번째 | warm (3–5회) |
| --- | --- | ---: | ---: | ---: | ---: |
| 일반 Markdown | 없음 | 0ms | 42 → 35 | 22 → 22 | 23 → 22 |
| 일반 Markdown | 있음 | 0ms | 443 → 439 | 103 → 101 | 90 → 93 |
| 일반 Markdown | 없음 | 3000ms | 3043 → 3042 | 18 → 21 | 24 → 23 |
| 일반 Markdown | 있음 | 3000ms | 3110 → 3103 | 100 → 105 | 92 → 94 |
| Git review | 없음 | 0ms | 1021 → 1000 | 18 → 19 | 27 → 29 |
| Git review | 있음 | 0ms | 1093 → 1094 | 1592 → 1569 | 178 → 178 |
| Git review | 없음 | 3000ms | 3026 → 3025 | 22 → 21 | 16 → 19 |
| Git review | 있음 | 3000ms | 3229 → 3222 | 181 → 182 | 173 → 178 |

