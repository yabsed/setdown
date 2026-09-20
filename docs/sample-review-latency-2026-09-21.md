수식이 많은 Working Tree에서 수정 직후 Esc — 조사 결과 (2026-09-21)

후속 구현 완료: [실제 변경과 전후 측정](sample-review-optimization-2026-09-21.md).
아래 내용은 변경 전 조사 기록이다. 후속 Chromium trace에서는 큰 비용이
레이아웃 자체보다 전역 스타일 재계산임을 확인했고, 이를 유발하던 UI CSS를
비교 페이지에서 제외했다. 전체 HTML 재분석 제거도 구현했다.

기준 커밋은 `222f58a`. 실제 대상은 `apps/desktop/test/fixtures/sample.md`다.
요청에 나온 `test/e2e/fixtures/sample.md`는 없고, IDE에 열린 위 파일을 사용했다.
제품 소스는 변경하지 않았다. 실험은 생성된 브라우저 번들에만 적용하고,
마지막에 원래 소스로 다시 빌드했다. 재현 코드와 측정 결과만 추가했다.

**결론: 가장 큰 관측 병목은 수식 DOM의 동기 스타일/레이아웃 처리다.**

그다음은 전체 비교 HTML을 만든 뒤 다시 파싱하여 행 패치를 계산하는 작업이다.
KaTeX의 수식 계산을 더 빠르게 하는 것만으로 이 문제를 해결할 수 없다.
현재 행 패치는 DOM 교체량을 줄였지만, 전체 문서 크기에 비례하는 앞뒤 작업을
없애지는 않았다. 단순 호출 삭제와 CSS containment 실험도 개선을 입증하지 못했다.

**실제 문서 크기와 CPU 비용**

샘플 원문은 33,928 UTF-8 bytes다. 실제 production render worker로 렌더링한
HTML은 1,398,912 bytes, `.katex` 출력은 766개였다. 동일 문서끼리 비교해도
unified + split before/after 출력은 4,247,227 bytes가 된다.

Node 22.23.1에서 실제 빌드된 worker를 직렬 port adapter로 실행했다.
실제 Crossnote/KaTeX 출력이며 합성 math span이 아니다. Electron IPC와 브라우저
비용은 포함하지 않는다. 각 경우 7회 중 첫 회를 제외한 6회의 중앙값이다.

| 수정 | 전체 Markdown → HTML | 비교 HTML 생성 | 행 패치 생성 전체 | 그중 HTML → 행 재분석 | 행 비교만 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scope 문장 수정 | 29.5ms | 13.4ms | 57.8ms | 44.5ms | 7.4ms |
| 기존 `Iv=v` 수식 수정 | 28.5ms | 13.7ms | 56.8ms | 44.9ms | 7.3ms |
| 문서 앞 줄 추가, 매회 행 번호 이동 | 28.4ms | 12.9ms | 118.9ms | 45.2ms | 67.7ms |

부분 단계는 추가 독립 호출로 측정했으므로 전체 열에 더하지 않는다.
첫 cold render는 212.3ms였다. 첫 로드와 수정 직후 warm 경로는 구별해야 한다.
CPU 실험은 단일 page cache를 사용한다. 실제 A/B 경로는 아래 Electron 검사로 확인했다.

`responsiveRenderedDiff()`는 이미 행 구조를 알고 있다. 그러나 문자열을 합친 뒤
`ReviewRowCache.update()` → `readReviewRows()`가 다시 `splitPreviewBlocks()`로
문서 전체, unified 내부, split 내부를 스캔한다. 이때 수식의 깊은 HTML까지
반복해서 방문한다. 행 번호가 밀리면 `rowDeltas()` → `deltaFor()` →
`shiftReviewHtml()`의 문자열 검증도 커진다.

관련 소스:
[rendered-diff.ts](../apps/desktop/src/core/preview/rendered-diff.ts),
[review-row-cache.ts](../apps/desktop/src/main/preview/review-row-cache.ts),
[review-row-patch.ts](../apps/desktop/src/core/preview/review-row-patch.ts).

**Electron에서 관측한 실제 임계 경로**

임시 Git 저장소에 샘플을 커밋하고 Working Tree를 열었다. A/B 두 페이지를
준비한 뒤 문서 끝에 내용을 넣고 디바운스 대기 없이 Esc를 눌렀다.
타이밍 구간에서는 native `innerText`를 polling하지 않고 main의 메시지 기록만
관찰했다. 최신 내용, 기존 행/수식 DOM 참조, URL 유지 여부는 표시 요청 후 확인했다.

| 순차 수정 | Esc → 패치 전송 | 패치 전송 → 설치 ACK | 설치 ACK → native show | Esc → native show |
| --- | ---: | ---: | ---: | ---: |
| 일반 문장 1 | 177ms | 175ms | 34ms | 386ms |
| 일반 문장 2 | 174ms | 174ms | 34ms | 382ms |
| 합 기호 수식 추가 | 176ms | 314ms | 57ms | 547ms |
| 이후 일반 문장 | 164ms | 316ms | 57ms | 537ms |

이는 각 1회인 연속 시나리오의 진단값이다. P95나 모든 편집 형태의 대표값이 아니다.
마지막 문장 편집 때도 대상 A/B 페이지에는 직전 수식 변경이 아직 반영되지 않아
수식 변경이 함께 적용된다. 그 행을 단순 문장만 바꾼 독립 시나리오로 해석하면 안 된다.
shell의 keydown timestamp는 IPC 수신보다 1ms 정도 늦게 기록되기도 하므로
프레임 단위 정밀 측정은 아니다. `show`는 native API 호출 관측이며 화면 픽셀
제시 완료를 뜻하지 않는다. 폴링 완료 시각도 별도로 기록하고 성능 수치로 혼용하지 않는다.

패치 문자열은 앞의 두 경우 약 1KB, 뒤의 두 경우 약 5KB뿐이었다.
작은 패치를 전송하는 것만으로 170–316ms 구간이 없어지지 않는다.

native CPU profiler에서 큰 호출은 다음과 같았다.

```text
installReviewRowUpdates handler
  → afterPatch
    → document.fonts.ready getter
      → 약 180ms / 수식 추가 후 약 310ms의 동기 비용
```

해당 getter를 제거한 실험에서는 큰 비용이 `ViewportController.publish()`의
geometry 읽기 또는 `SourceAtlas`의 `getBoundingClientRect()`로 이동했다.
따라서 Promise 대기 타이머가 원인이라는 해석은 틀리다. DOM 수정 후 발생하는
브라우저의 스타일/레이아웃 계산이 중요한 원인이라는 증거다. 정확한 Chromium
invalidation 원인과 내부 layout 알고리즘별 비중은 이 JS CPU profile만으로
확정할 수 없으며, 다음 단계에서 renderer tracing이 필요하다.

관련 소스: [bridge.ts: afterPatch](../apps/desktop/src/preview-runtime/bridge.ts),
[source-atlas.ts](../apps/desktop/src/preview-runtime/source-atlas.ts),
[viewport-controller.ts](../apps/desktop/src/preview-runtime/viewport-controller.ts).

**실제로 시도했지만 해결되지 않은 변경**

| 실험 | 관측 결과 |
| --- | --- |
| `afterPatch`의 `document.fonts.ready` 접근 제거 | 패치 ACK는 3–4ms로 감소. 이후 준비가 215–378ms로 증가. Esc → show는 401–553ms. 비용이 이동했다. |
| 같은 base URL이면 `setAttribute` 생략 | Esc → show 389–515ms. 큰 병목이 그대로 남았다. |
| 비교 행과 unified 셀에 `contain: layout style` 적용 | Esc → show 385–520ms. 유의미한 개선을 입증하지 못했다. |

각 실험은 원본에서 해당 부분만 바꿨다. 실험 실행에는 native CPU profiling도
포함되어 원본 마지막 실행과 작은 시간 차이를 직접 비교하면 안 된다.
수백 ms 비용의 잔존과 이동은 확인할 수 있다. 세 변경 모두 최종 제품에 남기지 않았다.

**왜 수정 없는 Esc와 직후 Esc가 다른가**

수정 없는 경로는 이미 준비되고 표시했던 revision의 화면과 위치 증명을 재사용한다.
수정 경로는 아래 작업을 순서대로 기다린다.

```text
최신 buffer 확인
→ 기존 준비 작업이 있으면 그 작업 종료
→ 전체 수정본 render worker
→ 비교 worker: 전체 HTML + 행 패치 계산
→ 숨겨진 A/B 페이지 설치 및 브라우저 계산
→ main의 prepare-review ACK
→ renderer의 최종 present:* prepare-review ACK
→ native show
→ 필요 시 show 후 위치 검증
```

`showRendered()`는 디바운스를 이미 건너뛴다. 32ms/120ms checkpoint를 더 줄이는
것은 수정 즉시 Esc의 핵심 해결책이 아니다. `previewLoading`이면 새 준비를
시작하지 않는다. 오래된 작업이 끝난 뒤 최신 여부를 확인하므로, 이미 불필요한
결과의 DOM 설치와 위치 준비까지 기다릴 수 있다. 최신 결과만 보여주는 정책과
불필요한 계산을 중단하는 기능은 별개다.

관련 소스: [source-control-controller.ts](../apps/desktop/src/renderer/project/source-control/source-control-controller.ts),
[preview-renderer.ts](../apps/desktop/src/main/preview/preview-renderer.ts),
[review-presentation.ts](../apps/desktop/src/renderer/project/source-control/review-presentation.ts).

**두 지연을 없애기 위한 구현 순서**

1. 먼저 실제 sample을 성능 기준으로 고정한다. Chromium tracing으로 DOM 변경,
   style/layout, 최종 위치, native frame을 revision과 연결한다. 현재 조사에서
   가장 큰 브라우저 비용의 발생 이유를 확정하고, 개선 후 다른 지점으로 이동하지
   않았는지 검사한다. 최종 결과는 ACK가 아니라 최신 내용과 최종 위치의 픽셀이어야 한다.
2. 비교 worker는 문자열로 합치기 전의 구조화된 행을 패치 캐시에 직접 전달한다.
   전체 HTML은 cold load와 reset에서만 조립한다. 기존 출력과 byte equality,
   source metadata 이동, A/B base 검증을 유지한다. 약 45ms의 재파싱을 제거할
   명확한 후보지만, 현재 0.4–0.55초 전체를 이것만으로 없앨 수는 없다.
3. 수식 HTML과 source metadata를 분리하고, 변경되지 않은 수식·행의 결과를 재사용한다.
   줄 추가 때문에 수식 내부 HTML 전체를 스캔하거나 동일 수식 DOM을 교체하지 않도록
   안정된 식별자와 별도 source mapping을 둔다. 같은 행의 문장만 바뀔 때도 수식 DOM을
   보존해야 한다. 지금 검증된 것은 변경되지 않은 *행*의 수식 보존이다.
4. 브라우저의 작업량을 현재 읽을 위치와 변경된 행으로 제한하는 설계를 검증한다.
   후보는 행별 geometry cache와 높이 합 인덱스, 활성 비교 표현만의 geometry 조회,
   viewport 주변 행의 실제 layout 및 화면 밖 행의 높이 보존이다. 단순 containment는
   실패했으므로 같은 주장을 반복하지 않는다. 스크롤·선택·검색·접근성·폰트 변경·줌·
   before/after 위치가 보존되는지 확인하며 도입해야 한다. 전역 줄바꿈이나 폭 변경은
   더 넓은 재계산이 필요하다. 이 부분의 개선량은 아직 측정하지 않았다.
5. 준비 요청에 최신 revision/intent를 전달하고, superseded 작업은 다음 비싼 단계
   진입 전에 중단한다. 실행 중인 동기 parse의 즉시 선점은 별도 문제다. worker의
   전역 상태를 무시하고 무작정 Promise 병렬화를 해서는 안 된다. 전체 Markdown parse도
   이후에는 영향 블록 중심으로 줄이되, reference definition·macro·목록·표 등의
   문맥 변경은 영향 범위를 확장하거나 전체 렌더로 fallback해야 한다.
6. 표시 의도와 실제 표시 화면을 분리해 최신 revision과 최종 위치가 준비된 순간
   한 번만 화면을 교체한다. 현재는 Esc에서 source layer를 먼저 감추고 최신 preview가
   없으면 native view도 숨겨 `Typesetting changes…`가 드러날 수 있다. 준비 전까지
   편집 화면을 유지하면 임시 화면 전환은 없앨 수 있지만 **실제 계산 지연을 없앤 것은
   아니다**. 위 계산량 감소와 함께 적용해야 요청한 두 문제를 모두 다룰 수 있다.

literal 0ms 또는 모든 Markdown 편집을 한 프레임 안에 처리한다는 보장은 할 수 없다.
다만 일반 문장/한 수식 수정의 비용이 전체 문서 크기에 비례하는 현재 경로를 바꿔,
준비된 최신 화면으로 한 번에 넘어가는 것을 목표로 삼는 것이 맞다.
임시 화면을 기존 조판이나 스크린샷으로 바꾸는 것만으로 완료 처리해서는 안 된다.

**재현과 검증**

```sh
npm run build
node apps/desktop/scripts/benchmark-review-pipeline.cjs
cd apps/desktop
npx playwright test test/e2e/sample-review-latency.spec.ts
SETDOWN_PROFILE_REVIEW=1 npx playwright test test/e2e/sample-review-latency.spec.ts
```

실행 완료: 전체 TypeScript/Svelte typecheck, 앱 build, 기존 간단한 수식 120개
immediate-Esc 테스트, 실제 sample Electron 테스트, CPU 측정 및 위 대조 실험.
실제 sample 테스트는 최신 내용, row/math 참조 유지, A/B 페이지 URL 유지와
행 패치 사용을 확인했다. 모든 unit/E2E 테스트, OS IME 검사, 실제 화면 연속 프레임
기록은 실행하지 않았다. 성능 개선 완료나 두 지연 제거를 주장하지 않는다.

기존 `git-review-instant-escape.spec.ts`의 첫 held-installation 테스트는
오래된 preview 표시를 요구하며 latest-only 정책과 충돌한다. 기존 문서의
“대기 없이 기존 화면을 보여준다”는 설명도 현재 정책과 섞어 읽으면 안 된다.
이번에는 그 테스트를 수정하거나 통과했다고 주장하지 않고, 두 번째 DOM 보존
검사와 별도 sample 검사를 실행했다.

수치 원본: [sample-review-latency-2026-09-21.json](sample-review-latency-2026-09-21.json).
재현 코드: [CPU benchmark](../apps/desktop/scripts/benchmark-review-pipeline.cjs),
[Electron sample test](../apps/desktop/test/e2e/sample-review-latency.spec.ts).
