**일반 Markdown 탭의 전환 지연 개선**

Git 비교에 적용했던 문서 전용 스타일과 숨겨진 viewport 준비가 일반 탭에는 빠져 있었다.
`57729a8` 이후 working tree에서 이 경로를 일반 탭에도 적용하고, 초기 준비를 작은 작업으로
나눴다. [변경 전 측정](sample-document-latency-2026-09-21.md)과 같은 수식 766개
`apps/desktop/test/fixtures/sample.md`, viewport 1080×744를 사용했다.

**측정 결과**

각 조건마다 새 앱 3회, 실행당 Esc → 실제 브라우저 더블클릭 5사이클이다.
아래는 Esc keydown부터 캡처 완료까지 중앙값(ms)이다. 편집 조건은 문서 끝에 문단을
추가한 직후 Esc를 누르고, 최신 문단의 DOM 설치를 확인한 다음 한 번 캡처한다.

| 조건 | 변경 전: 1 / 2 / 3 / 4 / 5회 | 변경 후: 1 / 2 / 3 / 4 / 5회 |
| --- | --- | --- |
| 추가 대기 없이 매번 수정 | 1129 / 264 / 247 / 245 / 230 | **436 / 100 / 99 / 92 / 89** |
| 편집 화면에서 3초 준비, 매번 수정 | 1034 / 251 / 251 / 289 / 247 | **128 / 98 / 86 / 101 / 100** |
| 추가 대기 없이 수정 없음 | 60 / 34 / 30 / 26 / 24 | 118 / 37 / 36 / 22 / 24 |
| 편집 화면에서 3초 준비, 수정 없음 | 58 / 31 / 27 / 24 / 23 | 74 / 26 / 26 / 28 / 29 |

첫 수정의 감소는 추가 대기 없이 약 61%, 3초 준비 후 약 88%다.
파일 로딩 직후 수정한 첫 Esc는 여전히 410–785ms였다. 3초 준비 후에는 99–138ms였다.
즉 모든 cold 전환을 100ms 안에 끝냈다는 결과는 아니다.

수정 없는 첫 Esc의 중앙값은 **60 → 118ms로 늘었다**. 초기 준비 작업과 겹치는 비용이
남아 있다. 세 실행의 범위는 변경 전 58–146ms, 변경 후 64–120ms라 표본을 넘어선
분포 주장은 하지 않는다. 3초 준비 후 수정 없는 경우도 58 → 74ms로 소폭 증가했다.
이때 변경 전에는 본문 수식이 일부만 설치돼 있었지만 변경 후에는 766개가 준비돼 있다.
따라서 이 작업을 모든 개별 경로의 개선으로 보고하지 않는다.

수정 없는 cold 더블클릭 복귀는 중앙값 **210 / 359 / 29 / 31 / 31ms →
36 / 54 / 63 / 34 / 28ms**였다. 준비 중 첫 두 번의 큰 지연이 줄었다.
더블클릭 시간은 두 번째 mousePressed 전송부터 편집 화면 확인까지이며 확인/IPC 비용을 포함한다.

**무엇을 바꿨는가**

1. Lean 문서에서도 Crossnote의 `webview/preview.css`를 제외한다. 테마, 문서, 코드,
   callout, KaTeX/MathML 스타일은 유지한다. Crossnote 브라우저 런타임이 필요한
   Mermaid 등은 기존 full runtime을 사용한다.
2. 편집 화면에서 reader의 실제 bounds를 main에 전달한다. main은 소유권·크기를
   검증하고 native bounds와 Chromium desktop viewport를 준비한다. 숨겨진 navigation은
   기존처럼 분리하고, 완료된 현재 navigation에만 준비를 재적용한다. visibility나 focus를
   바꾸지 않는다. 목차가 열려 있으면 숨긴 reader의 목차 폭도 유지한다.
3. 남은 본문은 animation frame을 기다리지 않고 작은 timer task로 나눠 설치·배치한다.
   기본 배치 제한은 8블록/64KiB이고, 단일 큰 블록은 쪼개지 않는다. 빠른 Esc/더블클릭이
   작업 사이에 처리될 수 있게 한다. 문서 교체나 즉시 전체 본문이 필요한 위치 이동은
   예약된 작업을 취소한다. 새 문서의 첫 화면 분할 설치는 유지한다.
4. 소스 좌표가 붙은 클릭 대상·조상·후손으로 위치가 결정되면 전체 수식 문서의 좌표를
   다시 측정하지 않는다. 여백 클릭에는 기존 주변 anchor 탐색을 유지한다.
   숨긴 미리보기의 위치 보고가 편집기 anchor를 덮어쓰는 것도 막는다.

준비 확인 실행에서 실제 문서 view는 native/내부 viewport 모두 **1080×744**,
native visible=false, pending blocks=0이었다. 미사용 spare의 0×0 viewport는 별개다.

**Chromium 추적 근거**

프로파일을 켜지 않은 실행만 위 성능 통계에 사용했다. 별도의 변경 전 trace에서
두 번째 수정은 **35,678개 요소**의 UpdateLayoutTree에 **148.3ms**를 썼다.
변경 후에는 **3개 요소, 0.15ms**, Layout은 6개 dirty objects에 약 1ms였다.
준비된 첫 수정도 전체 문서 스타일 계산 없이 0개/0개/3개 요소 갱신으로 끝났다.

이 수치는 renderer의 Esc부터 capture까지 구간에서 추출했다. 첫 cold HTML parsing과
레이아웃 자체가 없어졌다는 뜻은 아니다. 그 작업 일부를 편집 중으로 옮기고,
반복되는 불필요한 작업을 제거한 것이다. 단일 전체 준비의 중간 실험은 수정 없는
즉시 Esc와 충돌했으므로 최종 구현에서는 작은 작업으로 나눴다.

**검증**

- 관련 단위 테스트 137개 통과. 위치 결정 우선순위, 소유권/유효 bounds, navigation 뒤
  재준비, 편집 anchor 보호, 배치 취소·교체·중복 방지를 포함한다.
- 관련 E2E에서 11개 통과. 배치 변경 후에는 문서 준비/수식 geometry, 한글 조합,
  Mermaid runtime 전환, 창 이동 4개를 다시 통과했다. 마지막으로 목차가 열린 채
  source로 전환해도 숨긴 reader의 폭이 유지되는 검사도 통과했다.
- 1100/680 창 폭, zoom 1/1.25에서 모든 수식 좌표·글꼴·MathML 표시를 원래 UI CSS를
  재삽입한 상태와 비교했다. viewport override를 해제한 native 표시와도 동등했다.
- 최종 성능 12회/60사이클 완료. 별도 최종 trace 1회 완료.
- production build, 최종 TypeScript/Svelte 검사, `git diff --check` 통과.

기존 `preview-reading-tools.spec.ts`는 새 탭이 기억된 목차 설정을 물려받는데도
목차가 숨겨지기를 기대하는 지점에서 실패했다. `workspace-zoom.spec.ts`의 md 테스트는
창이 보이기 전에 상태를 읽어 `No visible workspace`로 실패했다. 두 실패 모두 변경 전
HEAD의 main/worker/bridge/shell을 빌드한 대조군에서 같은 위치에 재현됐다.
전체 E2E가 모두 통과했다고 보고하지 않는다. 최적화 빌드는 대조 검사 후 복원했다.

재현:

```sh
npm run build --workspace @setdown/desktop
cd apps/desktop
npx playwright test test/e2e/sample-document-cycles.spec.ts --repeat-each=3
SETDOWN_TRACE_DOCUMENT_CYCLES=1 npx playwright test test/e2e/sample-document-cycles.spec.ts --grep 'idle=3000 edits=true'
npx playwright test test/e2e/document-preparation.spec.ts
```

캡처 시간은 polling/IPC/readback을 포함하며 실제 모니터의 픽셀 제시 시각이나 P95가
아니다. Git 비교의 viewport 폭은 달라 이 표와 완전히 같은 조건의 직접 비교가 아니다.
앞으로 더 낮추려면 남은 cold 문서 설치/레이아웃과 worker의 문서 전체 재조판 비용을
각각 줄여야 한다. 이번 작업은 Markdown 증분 파싱이나 문서 가상화를 구현하지 않았다.

원본과 추적 요약: [sample-document-optimization-2026-09-21.json](sample-document-optimization-2026-09-21.json).
