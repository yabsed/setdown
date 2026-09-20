Working Tree 수식 문서 — HTML 재분석 제거와 스타일 계산 범위 축소

`apps/desktop/test/fixtures/sample.md`의 실제 Crossnote/KaTeX 출력으로 구현하고
검증했다. 수식은 766개다. 이전 조사의 두 우선 작업을 제품 코드에 반영했다.

**결과**

같은 샘플에서 Esc → native show 요청은 이전 382–547ms에서 **121–172ms**로
줄었다. 변경 후에는 profiler/trace를 끈 상태에서 앱을 새로 실행하는 검사를
3회 반복했다. 아래 변경 후 값은 각 편집의 3회 중앙값이다. 변경 전은 기존
조사에서 기록한 각 편집 1회의 값이므로 P95 또는 통계적 성능 보장은 아니다.

| 순차 편집 | 이전 Esc → show | 이후 Esc → show | 이후 패치 → 설치 ACK |
| --- | ---: | ---: | ---: |
| 일반 문장 1 | 386ms | 140ms | 4ms |
| 일반 문장 2 | 382ms | 124ms | 4ms |
| 합 기호 수식 추가 | 547ms | 171ms | 4ms |
| 그 뒤 일반 문장 | 537ms | 167ms | 5ms |

약 64–69% 감소다. 마지막 편집에서는 A/B의 대상 페이지에 아직 없는 직전 수식
변경도 함께 적용된다. 이 값을 독립적인 일반 문장 수정으로 해석하면 안 된다.
show는 Electron native 표시 요청 관측이며, compositor 픽셀 제시 완료가 아니다.
모든 수치는 진단용이고 테스트의 시간 제한으로 사용하지 않는다.

**1. 문자열 전체를 만들었다가 다시 파싱하지 않는다**

`responsiveRenderedRows()`가 비교 분석 결과의 unified/split 행 배열을 직접 반환한다.
비교 worker는 그 배열을 `ReviewRowCache.updateRows()`에 전달한다. HTML 문자열이
필요한 cold load와 full-reset fallback에서만 `serializeReviewRows()`를 호출한다.
patch/full 선택도 HTML을 합치지 않고 정확한 문자열 길이를 계산한다.

이전 HTML API는 그대로 유지한다. 비교 강조, 수식 HTML/MathML, source 속성,
A/B의 개별 base revision, 실패 후 reset, cache 제한, client runtime 지원 여부
검증도 유지한다. 동등성 검사는 실제 문자열 경로와 구조화된 행 경로의 결과를
비교하며, 버려진 ACK와 baseline 불일치가 여전히 reset으로 이어지는지 확인한다.

별도의 analysis cache를 가진 두 모듈로 측정한 CPU 중앙값:

| 편집 | 이전 HTML 생성 + 행 패치 | 구조화된 행 생성 + 행 패치 |
| --- | ---: | ---: |
| Scope 문장 수정 | 13.0 + 56.3ms | 9.2 + 12.6ms |
| 기존 수식 수정 | 13.6 + 58.1ms | 9.9 + 13.8ms |
| 문서 앞 줄 추가 | 14.1 + 118.8ms | 8.1 + 72.2ms |

전체 Markdown → HTML 비용은 별도이며 약 28–32ms였다. 줄 번호가 전체적으로
밀릴 때의 per-row HTML/source metadata 검증은 여전히 남아 있다. 이 변경이
모든 종류의 HTML 스캔이나 전체 Markdown parsing을 제거한 것은 아니다.

**2. 브라우저가 변경되지 않은 수식까지 스타일 계산하지 않게 한다**

이번에 추가한 Chromium invalidation trace는 이전의 “스타일/레이아웃” 추정을
구분해 주었다. 큰 비용은 `UpdateLayoutTree`의 style recalculation이었다.
실제 geometric layout 자체는 두 경우 모두 약 0.8ms였다.

| 한 번의 문장 패치, trace 활성화 | 이전 | 이후 |
| --- | ---: | ---: |
| 스타일 재계산 요소 수 | 35,793 | 5 |
| 스타일 계산 | 256.669ms | 0.303ms |
| 실제 layout | 0.776ms | 0.782ms |

trace 자체의 오버헤드 때문에 위 시간은 앞의 일반 실행 표와 직접 합산하지 않는다.
하지만 작은 행 수정이 전체 수식 트리의 스타일 계산으로 번지던 현상이 제거됐음을
요소 수로도 확인할 수 있다.

정적 Git 비교 페이지에도 Crossnote 앱의 `webview/preview.css`가 들어오고 있었다.
이 UI 번들을 제외하는 대조 실험에서 큰 비용이 사라졌다. 단일 root `:has()`
규칙만 제외한 실험으로는 해결되지 않았으므로 특정 selector 하나가 원인이라고
단정하지 않는다. 비교 페이지에는 해당 앱 UI가 없으므로 생성 시 그 링크만 제외한다.

독립된 `styles/preview.css`, preview theme, Prism, KaTeX, Font Awesome,
callout/admonition stylesheet는 유지한다. `<head>`의 신뢰된 UI resource 링크만
제외하며 본문의 authored CSS는 유지한다. 일반 Markdown 페이지와 Crossnote client
runtime 경로에는 이 처리를 적용하지 않는다. 비교 문서가 Crossnote 내부의 UI
유틸리티 class에 의존했다면 그 UI 스타일은 더 이상 제공되지 않는다.

추가로 `SourceAtlas`가 display:none인 responsive sibling의 source anchor를
전부 측정한 뒤 버리던 작업을 제거했다. 현재 활성 표현의 anchor만 조회하며,
화면 폭 변경 시 다시 선택한다. 불필요한 폰트 대기를 단순 삭제하거나 준비 ACK를
생략하지 않았다. 실제로 `fonts.ready`만 삭제했던 이전 실험은 비용을 위치 계산으로
옮길 뿐이었다.

이 결과에 따라 전체 수식 DOM을 가상화하거나 행 높이를 임시값으로 고정할 필요 없이
주요 스타일 재계산을 변경된 요소로 제한했다. 높이 캐시나 viewport virtualization을
구현했다고 주장하지 않는다.

**정확성 검증**

- 실제 sample의 최신 내용과 A/B URL 유지, 변경되지 않은 행·수식 DOM 참조 유지.
- 같은 native 문서에 이전 UI stylesheet를 다시 넣어 전후 비교. 넓은 화면,
  좁은 화면, 125% 줌에서 수식·문장의 document 좌표/크기와 글꼴·색이 일치.
- light/dark 비교 강조, responsive row 정렬, before/after 행 번호 이동,
  잘못된 patch 거부, 숨겨진 표현 제외, breakpoint 변경 후 위치 재계산,
  warm 위치 재사용과 늦은 font-ready 응답 처리.
- TypeScript/Svelte 전체 typecheck와 앱 build 통과.
- 관련 단위 테스트 8개 파일, 97개 검사 통과.
- 관련 브라우저 검사 10개 통과(스타일/레이아웃 3개, 패치/위치 7개).
- sample 즉시 Esc 검사를 새 앱에서 3회 반복해 통과.
- 이후 문서 맨 앞에 두 줄을 추가하는 경우도 실제 sample에서 통과했다.
  기존 수식 DOM을 유지하면서 before 행 번호는 그대로, after만 +2 이동함을 확인했다.

전체 단위 테스트는 461개 통과, 13개 실패였다. 모두 기존
`source-control-controller.test.ts`의 실패다. 변경 전 HEAD를 `/tmp`에 별도로
풀어서 실행해 **동일한 13개 실패**를 재현했다. 해당 컨트롤러 코드는 이번에
변경하지 않았다. 전체 테스트가 통과했다고 보고하지 않는다.

기존 브라우저 fixture의 두 문제도 보정했다. row-patch 검사의 visibility locator를
실제 `#root`에 한정해 hidden 비교용 복제 DOM과 충돌하지 않게 했다. standalone
SourceAtlas fixture에는 runtime ResizeObserver가 없으므로, 높이를 직접 바꾼 뒤
실제 런타임이 보내는 invalidation을 명시적으로 전달했다.

**남는 지연**

0ms는 아니다. 현재 이 샘플에서 최신 수정본의 worker 렌더/비교/IPC가 약
108–128ms, 최종 위치 준비가 일반 문장에서는 약 7–9ms, 수식 변경이 포함된
A/B 갱신에서는 약 52ms 남는다. 이전 작업 선점, 변경 블록 중심 Markdown 렌더,
per-row source shift 최적화, native 픽셀 단위 전환 검증은 이후 작업이다.
임시 화면 정책을 바꾸거나 오래된 revision을 먼저 보여주는 변경은 하지 않았다.

**재현**

```sh
npm run build
node apps/desktop/scripts/benchmark-review-pipeline.cjs
cd apps/desktop
npx playwright test test/e2e/sample-review-latency.spec.ts --repeat-each=3
npx playwright test test/e2e/review-document-styles.spec.ts test/e2e/rendered-diff-layout.spec.ts test/e2e/review-row-patching.spec.ts test/e2e/source-atlas-review.spec.ts test/e2e/verified-review-position.spec.ts
SETDOWN_TRACE_REVIEW=1 npx playwright test test/e2e/sample-review-latency.spec.ts
```

trace는 Playwright test output의 `native-trace.json`에 저장된다. 추가한 코드가
적용된 main/worker와 새 비교 페이지를 사용하려면 실행 중인 앱을 재시작해야 한다.
측정 원본: [sample-review-optimization-2026-09-21.json](sample-review-optimization-2026-09-21.json).
