**수식 문서 Working Tree: 첫 두 번의 Esc가 느린 이유**

측정 대상은 `57ca91d`를 포함한 현재 HEAD `3fc8180`의 새 production build다.
실제 fixture 경로는 `apps/desktop/test/fixtures/sample.md`다. 임시 Git 저장소와
새 설정 디렉터리를 매 실행 생성하고, 원본을 commit한 뒤 문단 하나를 추가해
Working Tree 비교를 열었다. 제품 코드는 수정하지 않았다.

**반복 측정 결과**

각 실행마다 앱을 새로 띄운 3회 중앙값이다. 아래는 비교 탭 진입 후 3초 대기하고,
매번 문단을 추가한 직후 Esc → 더블클릭을 5번 반복한 결과다. trace는 껐다.

| 사이클 | 표시 페이지 | Esc → show 요청 | Esc → 캡처 완료 |
| --- | --- | ---: | ---: |
| 1 | B 최초 표시 | 152ms | 857ms |
| 2 | A 최초 표시 | 125ms | 816ms |
| 3 | B 재사용 | 174ms | 225ms |
| 4 | A 재사용 | 166ms | 226ms |
| 5 | B 재사용 | 123ms | 165ms |

표시 요청까지는 첫 두 번도 빠르다. 이후에 약 0.7초가 추가되는 것이 관측된 차이다.

수정 없는 대조군은 첫 캡처 중앙값 695ms, 이후 4회의 중앙값은 각각 23ms, 28ms, 28ms, 20ms였다.
탭 진입 직후 Esc를 누르면 첫 show 중앙값 928ms, 캡처 중앙값 1637ms로 초기 로드 대기까지 추가됐다.
최종 진단은 수정 포함 3회, 수정 없는 대조군 3회 모두 통과했다. production build 및 TypeScript/Svelte 검사도 통과했다.

**발견**

초기 HTML과 행 패치가 준비됐어도, 숨겨진 WebContentsView의 브라우저 viewport는
아직 실제 화면 크기를 반영하지 않는다. 별도의 trace 실행에서 3초 대기 후:

| 대상 | native bounds | 페이지 내부 viewport | fonts.status |
| --- | --- | --- | --- |
| 비교 A, 숨김 | 780 × 745 | 0 × 0 | loaded |
| 비교 B, 숨김 | 780 × 745 | 0 × 0 | loaded |

페이지의 `document.visibilityState`도 이때 `visible`이었다. native view의
`getVisible()`과 DOM visibility/viewport를 같은 상태로 취급하면 안 된다.
표시 시 native 크기는 780 × 744였다. 후속 수정 검증에서 `getZoomFactor()=1`,
`devicePixelRatio≈1.3333`을 직접 확인했다. 따라서 trace의 1040 × 992 좌표를
CSS viewport와 앱 zoom 0.75로 해석했던 최초 기록은 정정한다.
후속 대조 실험에서는 1px의 native 높이 차이도 전체 스타일 재계산을 유발했다.

`rendered-diff.ts`의 720px breakpoint 때문에 숨겨진 페이지에서는 unified가,
처음 표시될 때는 split이 활성화된다. 실제 첫 표시 때 수식 트리의 스타일과
레이아웃을 다시 계산한다. `setBounds()` 호출과 `review-prepared` ACK만으로
최종 viewport의 준비가 끝났다고 볼 수 없다.

별도 Chromium trace에서 첫 Esc 이후 발생한 비용:

| 작업 | 시간 | 규모 |
| --- | ---: | --- |
| UpdateLayoutTree | 248.675ms | 71,654 elements |
| Layout | 305.466ms | 100,518 dirty / total objects |
| PrePaint | 84.551ms | 최초 화면 준비 |
| firstContentfulPaint | Esc +801.747ms | trace의 브라우저 paint milestone |

trace는 오버헤드가 있으므로 일반 실행의 시간과 직접 합산하지 않는다.
firstContentfulPaint도 실제 모니터의 픽셀 제시 완료 시각은 아니다.

**두 번 반복해야 빨라지는 조건**

`source-control-controller.ts`의 `preparePreview()`는 수정할 때마다 A/B 후보를
교대한다. 이번 측정에서는 첫 수정이 B, 두 번째 수정이 A, 이후 B → A → B였다.
각 페이지는 처음 표시될 때 위의 비용을 한 번씩 낸다. 미리 생성하는 standby도
DOM과 HTML cache는 준비하지만 실제 폭에서의 첫 레이아웃까지 준비하지는 못했다.

수정 없이 Esc → 더블클릭만 반복하면 같은 A를 재사용하므로 첫 번째만 느렸다.
따라서 “항상 두 번”이 아니라 “서로 다른 두 페이지를 처음 표시하는가”가 핵심이다.

**기존 커밋의 측정이 놓친 부분**

`sample-review-latency.spec.ts`는 resident 페이지를 기다린 다음 편집하고,
`preview:show` IPC까지의 시간을 측정한다. `57ca91d`의 행 패치 최적화는
실제로 적용된다. 이번에도 설치 ACK는 수 ms였다. 하지만 native show 요청 이후의
첫 style/layout/paint 비용 약 0.7초는 기존 측정 구간 바깥이다.

이 지연을 개선할 다음 대상은 **두 비교 페이지가 실제 viewport에서 첫 화면을
준비하는 경로**다. native bounds뿐 아니라 renderer가 수신한 크기와 준비 상태를
검증해야 한다. 현재 `loadURL()`의 분리/재부착은 IME 포커스 격리를 위한 것이므로,
단순히 숨긴 view를 먼저 노출하는 변경은 포커스·깜빡임·위치 전환까지 검증해야 한다.
현재 조사에서는 그런 제품 동작 변경을 하지 않았다.

**측정 방식과 한계**

새 진단 `sample-review-cold-cycles.spec.ts`는 첫 Esc 이전에 hidden DOM의
`innerText`나 `getBoundingClientRect()`를 읽지 않는다. Esc는 shell의 초기 capture
listener에서 timestamp를 남기고, main에서 표시 요청과 native visibility를 기록한다.
각 표시 후 `capturePage()` 완료를 별도로 기록하고, 수식과 최신 수정 내용도 확인한다.
더블클릭은 preview에 브라우저 입력을 전달해 기존 `edit-at-anchor` 경로를 사용한다.

캡처 시간에는 Playwright polling, IPC, readback 비용이 포함된다. 비어 있지 않은
캡처가 최종 위치나 실제 모니터 프레임을 보장하지 않는다. 따라서 결과를
“Esc → 실제 픽셀 표시 P95”라고 부르지 않는다. 캐시가 데워지는 현상과 최초 전체
레이아웃 비용은 별도의 trace 및 native/page 크기 관측으로 확인했다.

trace 모드의 hidden geometry probe는 일반 시간 측정에서 제외한다. 초기 측정기에서
native 더블클릭의 source 복귀가 간헐적으로 실패했으며, 입력과 실패 trace 기록을
보강했다. 실패 실행은 최종 집계에 섞지 않는다.

재현:

```sh
npm run build
cd apps/desktop
SETDOWN_CYCLES_IDLE_MS=3000 SETDOWN_CYCLES_EDIT=1 npx playwright test test/e2e/sample-review-cold-cycles.spec.ts --repeat-each=3
SETDOWN_CYCLES_IDLE_MS=3000 npx playwright test test/e2e/sample-review-cold-cycles.spec.ts --repeat-each=3
SETDOWN_CYCLES_IDLE_MS=3000 SETDOWN_TRACE_CYCLES=1 npx playwright test test/e2e/sample-review-cold-cycles.spec.ts
```

`SETDOWN_CYCLES_IDLE_MS=0`이면 비교 탭 진입 직후의 추가 초기 로드 대기도 측정한다.
출력은 각 test output의 `cycles.json`과 선택적인 `cycles-trace.json`이다.
보존한 집계 및 이벤트 원본: [sample-review-cold-cycles-2026-09-21.json](sample-review-cold-cycles-2026-09-21.json).
