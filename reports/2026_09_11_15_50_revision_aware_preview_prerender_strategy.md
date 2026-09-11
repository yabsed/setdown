# 편집 중 미리 그리는 revision 기반 Preview 전략

## 결론

MarkTex의 `Editor → Viewer` 전환은 렌더링을 시작하는 시점이 너무 늦다. 현재는 사용자가 `Esc`를 누른 뒤에야 전체 Markdown을 Crossnote로 보내고, 수식을 조판하고, 완전한 HTML 문서를 만든 다음 iframe을 새 URL로 이동시킨다. `sample.md`처럼 수식이 많은 문서는 이 모든 작업이 전환 지연으로 직접 드러난다.

가장 현실적인 개선은 **마지막으로 완성된 Preview의 revision을 기억하고, 편집이 잠시 멈춘 동안 최신 revision을 숨은 Viewer에 미리 렌더링하는 것**이다. 사용자가 Viewer로 돌아갈 때 최신 결과가 이미 준비됐다면 HTML을 다시 만들지 않고 surface만 전환한다.

핵심 규칙은 네 가지다.

1. 현재 model과 같은 revision의 Preview가 있으면 절대 다시 렌더링하지 않는다.
2. 편집 중 입력이 일정 시간 멈추면 최신 revision 하나만 미리 렌더링한다.
3. 같은 revision에 대한 진행 중 작업은 새로 만들지 않고 공유한다.
4. 낡은 렌더 결과는 화면에 반영하지 않되, 마지막 정상 Preview는 새 결과가 준비될 때까지 보존한다.

이 전략은 Markdown 전체를 부분적으로 갱신하는 복잡한 증분 렌더러 없이도 반복 렌더링과 전환 대기 시간을 크게 줄인다. 첫 구현으로 가장 비용 대비 효과가 높다.

## 현재 동작과 병목

현재 renderer의 `enterViewer()`는 화면 기준 anchor를 계산한 뒤 Viewer를 먼저 표시하고 항상 `render()`를 호출한다.

```ts
async function enterViewer() {
  if (!model) return;
  anchor = editorViewportAnchor();
  publishAnchor();
  setSurface('viewer');
  await render(anchor);
}
```

`render()`는 model 전체 문자열을 main process로 보내고, 반환된 URL을 iframe의 `src`에 대입한다.

```ts
const result = await window.marktex.renderDocument(
  model.getValue(),
  requestedRevision,
);
// ...
frame.src = result.url;
```

main process의 `renderCurrent()`도 revision이나 기존 결과의 준비 상태를 검사하지 않는다. 요청마다 `generateHTMLTemplateForPreview()`를 호출하고 새로운 token URL을 만든다.

```ts
const html = await engine.generateHTMLTemplateForPreview({
  inputString: text.length > 0 ? text : '\n',
  // ...
});

const token = `${Date.now()}-${revision}-${Math.random().toString(36).slice(2)}`;
previewDocuments.set(token, html);
```

그 결과 다음 경우에도 전체 작업이 반복된다.

- Editor를 열었다가 아무것도 고치지 않고 Viewer로 돌아온 경우
- 이미 같은 revision을 렌더링 중인데 빠르게 Viewer 전환을 다시 요청한 경우
- 편집을 끝낸 뒤 충분한 유휴 시간이 있었지만 Viewer 전환 전에는 아무 준비도 하지 않은 경우

수식 문서는 Markdown 원문의 크기보다 생성되는 HTML과 DOM의 크기가 훨씬 클 수 있다. KaTeX 계산뿐 아니라 HTML 문자열 생성, sanitize, iframe navigation, DOM parse, style 계산과 layout도 함께 반복된다. 따라서 KaTeX cache 하나만으로는 전환 지연을 없앨 수 없다.

## 목표와 비목표

이번 전략의 목표는 다음과 같다.

- 변경 없는 `Editor → Viewer` 전환을 즉시 완료한다.
- 편집이 멈춘 동안 최신 Preview를 준비하여 전환 경로에서 무거운 계산을 제거한다.
- 중복 요청과 낡은 revision 계산을 가능한 한 줄인다.
- 렌더 실패 시 마지막 정상 Viewer를 유지한다.
- 기존 source anchor 기반 위치 복원을 보존한다.

첫 단계에서 하지 않을 일도 분명히 한다.

- Markdown block 단위 증분 파싱
- 수식 한 개만 골라 다시 조판하는 DOM patch
- Crossnote 내부 parser나 KaTeX cache의 재구현
- 입력 중 매 keystroke마다 실시간 Preview 갱신

부분 렌더링은 footnote, reference link, 목차와 문서 포함처럼 전역 의존성을 가진 Markdown 기능 때문에 난도가 높다. 먼저 전체 렌더 횟수와 전환 대기부터 제거하는 편이 안전하다.

## 권장 상태 모델

현재의 `revision`과 `renderToken`만으로는 “완성된 결과”, “준비 중인 결과”, “요청된 최신 결과”를 구분하기 어렵다. renderer가 다음 상태를 명시적으로 소유해야 한다.

```ts
type PreviewState = {
  displayedRevision: number | null;
  readyRevision: number | null;
  requestedRevision: number | null;
  inFlightRevision: number | null;
  status: 'empty' | 'ready' | 'rendering' | 'failed';
};
```

각 값의 의미는 다음과 같다.

| 상태 | 의미 |
|---|---|
| `displayedRevision` | 사용자가 마지막으로 정상적으로 본 Preview |
| `readyRevision` | iframe에서 로딩과 초기화까지 끝난 Preview |
| `requestedRevision` | 시스템이 최종적으로 준비해야 하는 최신 revision |
| `inFlightRevision` | 현재 Crossnote 또는 iframe에서 처리 중인 revision |
| `status` | 로딩 표시와 오류 처리에 사용하는 상태 |

현재 model revision과 Preview revision이 잠시 다른 것은 오류가 아니다. 비동기 선행 렌더링에서는 정상 상태다. 다만 Viewer로 전환할 때 어떤 revision을 보여 주는지 코드가 알고 있어야 한다.

## 전체 동작

```text
Viewer r10 준비 완료
        │
        │ Editor 진입
        ▼
Editor r10 ── 입력 ──> Editor r11 ── 입력 ──> Editor r12
                                                   │
                                                   │ 700ms 동안 입력 없음
                                                   ▼
                                      background render r12
                                                   │
                                                   │ iframe ready
                                                   ▼
                                        Preview r12 준비 완료
                                                   │
                                                   │ Esc
                                                   ▼
                                surface 전환 + anchor 적용만 수행
```

사용자가 선행 렌더가 끝나기 전에 `Esc`를 누르는 경우에는 진행 중인 r12 작업을 그대로 기다린다. 같은 r12 렌더를 하나 더 시작해서는 안 된다. 아직 debounce timer만 걸려 있었다면 timer를 취소하고 r12 렌더를 즉시 시작한다.

## 편집 중 선행 렌더링

Monaco의 `onDidChangeContent`에서 revision을 증가시킨 뒤 선행 렌더를 예약한다. 적절한 시작값은 700ms다.

```ts
model.onDidChangeContent(() => {
  revision += 1;
  window.marktex.updateText(model.getValue(), revision);
  schedulePreviewRender(revision, 700);
});
```

debounce가 필요한 이유는 입력 도중 만들어지는 r11, r12, r13을 모두 렌더링해도 사용자는 대부분 보지 않기 때문이다. 수식 조판은 CPU 사용량이 크므로 매 입력마다 실행하면 Editor 자체의 반응성을 해칠 수 있다.

예약 시점과 실제 시작 시점 사이에 revision이 바뀌면 이전 예약은 버린다. 렌더가 이미 시작되어 안전하게 취소할 수 없다면 결과 commit만 막고, 그 뒤에는 가장 최신 revision 하나만 남긴다. 중간 revision을 전부 queue에 쌓아서는 안 된다.

```ts
function schedulePreviewRender(targetRevision: number, delay = 700) {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (targetRevision === revision) {
      void ensurePreview(targetRevision);
    }
  }, delay);
}
```

초기값 700ms는 정책이 아니라 측정 가능한 조정값이다. 짧은 문서에서는 300~500ms도 가능하지만 `sample.md`를 기준으로 Editor 입력 지연, main process 점유 시간과 Preview 적중률을 측정한 뒤 정해야 한다.

## revision 재사용과 single-flight

`ensurePreview(targetRevision)`은 Preview 준비를 위한 유일한 진입점이어야 한다. Viewer 전환, debounce timer, 파일 열기와 재시도 모두 이 함수를 통과시킨다.

```ts
async function ensurePreview(targetRevision: number) {
  if (preview.readyRevision === targetRevision) return;

  if (
    preview.inFlightRevision === targetRevision &&
    preview.inFlightPromise
  ) {
    return preview.inFlightPromise;
  }

  const text = model!.getValue();
  const task = renderAndLoad(text, targetRevision);
  preview.inFlightRevision = targetRevision;
  preview.inFlightPromise = task;

  try {
    await task;
  } finally {
    if (preview.inFlightPromise === task) {
      preview.inFlightRevision = null;
      preview.inFlightPromise = null;
    }
  }
}
```

같은 revision 요청을 하나의 Promise로 합치는 것을 single-flight라고 한다. 이것이 없으면 debounce 렌더가 끝나기 직전에 사용자가 `Esc`를 눌렀을 때 동일한 전체 렌더가 두 번 실행될 수 있다.

완료 시점에는 요청을 시작했을 때의 revision과 현재 revision을 다시 비교한다.

```ts
if (result.revision !== revision) {
  return; // stale result: 준비 완료 상태로 승격하지 않음
}

preview.readyRevision = result.revision;
```

여기서 낡은 결과를 commit하지 않는 것과 마지막 정상 결과를 폐기하는 것은 다르다. r12를 준비하는 동안 r10이 마지막 정상 Viewer라면 r10은 r12가 완성될 때까지 유지한다.

## Viewer 전환 경로

`enterViewer()`는 먼저 현재 Editor viewport로 anchor를 확정하고, 그 다음 Preview 준비 상태에 따라 분기해야 한다.

```ts
async function enterViewer() {
  if (!model) return;

  anchor = editorViewportAnchor();
  publishAnchor();
  cancelScheduledPreview();

  if (preview.readyRevision === revision) {
    setSurface('viewer');
    revealAnchorAfterVisible(anchor);
    return;
  }

  setSurface('viewer');
  showNonBlockingRefreshState();
  await ensurePreview(revision);
  revealAnchorAfterVisible(anchor);
}
```

가장 중요한 fast path는 `readyRevision === revision`이다. 이 경우 IPC, Crossnote, KaTeX와 iframe navigation이 모두 없어야 한다. 화면을 보이게 하고 위치만 맞춘다.

변경 없이 Editor에 들어갔다 나온 경우에는 처음 Viewer의 revision이 그대로 준비되어 있으므로 항상 이 fast path를 탄다.

## HTML 준비와 anchor 적용을 분리한다

현재 `render()`는 HTML 생성, iframe navigation, load event와 source anchor 이동을 한 함수 안에서 처리한다. 선행 렌더는 Editor surface가 보이는 동안 실행되므로 이 책임을 분리해야 한다.

```ts
async function renderAndLoad(text: string, revision: number): Promise<void>;
function revealAnchorAfterVisible(anchor: ViewportAnchor): void;
```

현재 CSS는 활성 surface가 아닌 section을 `display: none`으로 숨긴다. 숨은 iframe도 문서 parse와 script 실행은 할 수 있지만 viewport 크기가 0인 상태에서 계산된 scroll과 layout 결과를 신뢰해서는 안 된다. 따라서 선행 렌더 중에는 HTML과 DOM만 준비하고, anchor 메시지는 Viewer를 다시 표시한 다음 보낸다.

`revealAnchorAfterVisible()`은 최소 한 animation frame 뒤에 실행하고, font나 늦은 layout을 고려해 기존처럼 짧은 지연 후 한 번 더 보낼 수 있다.

```ts
function revealAnchorAfterVisible(target: ViewportAnchor) {
  requestAnimationFrame(() => {
    postReveal(target);
    window.setTimeout(() => postReveal(target), 80);
  });
}
```

## iframe 운용 선택

### 1단계: 기존 iframe 하나를 Editor 뒤에서 갱신

현재 구조를 가장 적게 고치는 방법이다. Viewer가 숨겨진 Editor 모드에서 기존 iframe의 `src`를 새 token URL로 바꾸고 load 완료 revision을 기록한다.

장점은 구현 범위가 작고 선행 렌더의 효과를 빠르게 검증할 수 있다는 것이다. 단점은 iframe navigation과 Crossnote bootstrap 비용이 여전히 존재하며, 선행 렌더가 실패하면 이전 DOM을 이미 잃었을 수 있다는 것이다.

따라서 이 단계에서도 마지막 정상 URL을 main의 `previewDocuments`에 유지하여 재시도할 수 있어야 한다. 사용자에게 보이는 Viewer를 갱신하는 도중에는 전면 overlay로 가리지 않는다.

### 2단계: persistent iframe 내부 갱신

최종 권장 구조는 문서가 열려 있는 동안 iframe을 한 번만 bootstrap하고, 이후에는 새 HTML fragment와 revision만 전달하는 것이다. Crossnote iframe 내부의 hidden preview가 새 fragment를 준비하고, 완료 메시지를 보낸 뒤 실제 preview와 교체한다.

이 구조는 다음 비용까지 제거한다.

- iframe document navigation
- Crossnote preview bundle 재초기화
- stylesheet와 runtime 재적재
- 준비 실패 시 마지막 정상 DOM 손실

이는 `2026_09_11_02_28_keep_last_preview_during_math_rendering.md`에서 다룬 persistent iframe 전략과 같다. 본 보고서의 revision, debounce와 single-flight 정책은 그 구조 위에서도 그대로 사용한다.

실행 순서는 **revision 재사용과 선행 렌더를 먼저 구현하고, 계측 결과에 따라 persistent iframe으로 이동**하는 것이 적절하다.

## main process 캐시

renderer의 `readyRevision` 검사가 가장 먼저 필요하다. main process 캐시는 그 다음 방어선이다. renderer가 실수로 같은 요청을 다시 보내거나 iframe이 결과 URL을 다시 요구해도 Crossnote를 재호출하지 않도록 한다.

캐시 key에는 최소한 다음 값이 필요하다.

```ts
type RenderCacheKey = {
  documentPath: string;
  revision: number;
  configVersion: number;
};
```

revision만 key로 쓰면 다른 문서나 렌더 설정 변경과 충돌할 수 있다. 문서별 revision은 로컬 값이기 때문이다. 테마, 수식 엔진, parser 설정이 바뀌면 같은 source revision도 결과가 달라지므로 `configVersion` 또는 안정적인 설정 hash가 필요하다.

현재 `previewDocuments`는 token별 HTML을 최대 5개 보관하지만, 같은 입력의 재계산을 막는 cache가 아니다. token을 매번 새로 만들기 때문이다. 다음 두 map을 역할별로 구분하는 편이 명확하다.

```ts
const renderResultsByKey = new Map<RenderKey, RenderResult>();
const previewDocumentsByToken = new Map<string, string>();
```

캐시는 문서를 닫거나 설정을 바꿀 때 무효화하고, 크기 제한은 entry 수뿐 아니라 HTML byte 수 기준도 함께 두는 것이 좋다. 수식 문서 한 개의 결과가 매우 클 수 있기 때문이다.

## 실패 처리

선행 렌더 실패는 편집 실패가 아니다. 사용자는 계속 원문을 편집할 수 있어야 한다.

- Editor에서는 작은 상태 표시만 남기고 입력을 방해하지 않는다.
- Viewer에 마지막 정상 revision이 있으면 그것을 유지하면서 최신화 실패를 표시한다.
- 최초 렌더라서 정상 Viewer가 없을 때만 전용 오류 surface를 사용한다.
- 동일 revision의 자동 재시도를 무한 반복하지 않는다.
- 다음 편집 revision 또는 사용자의 명시적 재시도에서 다시 시도한다.

오류 상태에도 `failedRevision`을 기록하면 같은 실패 요청이 surface toggle마다 반복되는 것을 막을 수 있다.

## 동시성과 stale 결과

다음 경합을 반드시 시험해야 한다.

| 상황 | 기대 결과 |
|---|---|
| r11 렌더 중 r12 입력 | r11은 ready로 commit하지 않고 r12 하나만 후속 처리 |
| r12 선행 렌더 중 `Esc` | 기존 r12 Promise를 공유하며 중복 렌더 없음 |
| r12 렌더 중 새 문서 열기 | 이전 문서 결과가 새 iframe 상태를 덮지 않음 |
| r12 렌더 실패 | 마지막 정상 Preview와 Editor model 유지 |
| r12 준비 후 입력 없이 여러 번 toggle | Crossnote 호출 0회, surface와 anchor만 변경 |
| 외부 파일 reload | 이전 문서의 ready/in-flight 상태를 모두 무효화 |

기존 `renderToken`은 늦게 끝난 결과의 commit을 막는 용도로 유지할 수 있지만, 이것만으로 이미 시작된 중복 계산은 막지 못한다. token 검사와 single-flight/latest-only queue의 역할을 구분해야 한다.

## 단계별 구현안

### 1단계: 변경 없는 전환 재사용

- `readyRevision`을 추가한다.
- iframe load 완료 시에만 해당 revision을 ready로 기록한다.
- `enterViewer()`에서 같은 revision이면 `render()`를 호출하지 않는다.
- 렌더와 anchor reveal을 분리한다.

이 단계만으로도 “Editor에 잠깐 들어갔다 나왔는데 다시 수식을 전부 그리는 문제”가 사라진다.

### 2단계: 편집 중 debounce 선행 렌더

- Monaco 변경 이벤트에서 700ms debounce를 건다.
- Editor surface일 때만 자동 선행 렌더한다.
- Viewer 진입 시 timer를 즉시 실행으로 승격한다.
- stale 결과는 폐기하고 최신 revision 하나만 유지한다.

### 3단계: 동일 revision single-flight

- revision별 진행 중 Promise를 공유한다.
- Viewer 전환과 background timer가 같은 작업을 기다리게 한다.
- 호출 횟수를 계측하여 중복이 없는지 확인한다.

### 4단계: 마지막 정상 Preview 보존

- 전면 render overlay를 비차단 상태 표시로 바꾼다.
- 실패와 refresh 중에도 마지막 정상 Viewer를 유지한다.
- 필요하면 임시로 두 iframe을 사용해 ready 후 원자적으로 교체한다.

### 5단계: persistent iframe

- main은 full page 대신 갱신 fragment URL을 제공한다.
- bridge는 fragment를 Crossnote hidden preview에 전달한다.
- 실제 DOM 교체 완료 후 `preview-committed(revision)`을 보낸다.
- parent는 이 메시지 이후에만 `readyRevision`을 갱신한다.

## 계측 계획

선행 렌더는 실제 작업 시간을 없애기보다 전환 전에 옮긴다. 따라서 총 CPU 시간과 체감 전환 시간을 함께 측정해야 한다.

```ts
type PreviewMetrics = {
  revision: number;
  trigger: 'open' | 'debounce' | 'enter-viewer' | 'retry';
  markdownBytes: number;
  formulaCount: number;
  renderMs: number;
  iframeLoadMs: number;
  readyToVisibleMs: number;
  cacheHit: boolean;
  joinedInFlight: boolean;
  discardedAsStale: boolean;
};
```

최소한 다음 표본을 비교한다.

- 짧은 평문 문서
- 현재 `sample.md`
- 같은 수식이 반복되는 문서
- 서로 다른 수식이 많이 들어간 문서
- 큰 행렬 몇 개가 들어간 문서

측정 시나리오는 cold open, 변경 없는 toggle, 한 글자 수정 후 즉시 toggle, 수정 후 1초 대기한 toggle, 빠른 연속 입력으로 나눈다.

## 완료 기준

기능 완료는 다음 조건으로 판정한다.

- 변경 없는 `Editor → Viewer` 전환에서 `renderDocument()`가 호출되지 않는다.
- 선행 렌더가 끝난 revision으로 전환할 때 spinner 없이 다음 frame 안에 Viewer가 나타난다.
- 선행 렌더 중 전환해도 같은 revision의 Crossnote 렌더는 한 번만 실행된다.
- 최신 revision보다 늦은 결과가 화면을 덮지 않는다.
- Preview가 숨겨진 동안 계산된 잘못된 scroll 위치를 사용하지 않는다.
- 렌더 실패 후에도 마지막 정상 Viewer와 편집 내용이 보존된다.
- `sample.md`를 빠르게 입력하는 동안 Monaco의 타이핑 반응성이 눈에 띄게 악화되지 않는다.
- 기존 source anchor와 더블 클릭 편집 위치 테스트가 계속 통과한다.

성능 목표는 두 단계로 잡는다.

1. 선행 렌더 적중 시 `Esc → Viewer 표시`를 한 frame 수준으로 만든다.
2. 선행 렌더 미적중 시에도 기존 Viewer 또는 명확한 비차단 상태를 즉시 보여 준다.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 입력할 때마다 렌더가 시작되어 Editor가 느려짐 | 700ms debounce, Editor에서만 자동 실행, latest-only queue |
| 숨은 iframe의 layout이 부정확함 | HTML 준비와 anchor 적용 분리, 표시 후 animation frame에서 위치 복원 |
| 렌더 중 새 입력으로 CPU 낭비 | 취소 가능한 구간은 취소하고, 불가능하면 결과 commit 차단 및 최신 하나만 후속 실행 |
| 큰 HTML cache가 메모리를 과도하게 사용 | 문서 수와 총 byte 수 제한, 문서 close/config 변경 시 무효화 |
| 오래된 Viewer에서 편집 위치가 어긋남 | anchor에 rendered revision 포함, 필요 시 revision 간 line mapping 적용 |
| ready 판정을 너무 일찍 함 | main 응답이 아니라 iframe load 또는 `preview-committed` 이후 ready 처리 |

## 최종 권고

우선 `readyRevision`을 도입하여 변경 없는 전환의 전체 재렌더를 제거한다. 이어 Monaco 입력에 700ms debounce 선행 렌더를 연결하고, `ensurePreview(revision)` 하나로 Viewer 전환과 background 요청을 합친다. 이 세 가지가 첫 배포 단위다.

그 다음 마지막 정상 Preview를 유지하는 비차단 UI를 적용하고, 장기적으로는 iframe navigation 대신 Crossnote의 hidden preview 갱신 경로를 사용하는 persistent iframe으로 옮긴다. 부분 Markdown 렌더링은 이 단계들의 계측 결과로도 성능이 부족할 때만 검토한다.

즉, 해결책은 수식을 더 빨리 그리는 특별한 알고리즘부터 만드는 것이 아니다. **같은 결과를 다시 그리지 않고, 필요한 결과는 사용자가 요청하기 전에 한 번만 준비하며, 준비된 결과를 즉시 재사용하는 것**이 먼저다.

## 관련 코드와 문서

```text
src/renderer/main.ts
  installModel()              Monaco 변경 이벤트와 revision 증가
  render()                    전체 렌더 요청, iframe navigation, anchor 적용
  enterViewer()               현재 무조건 render()를 호출하는 전환 경로

src/main/main.ts
  renderCurrent()             Crossnote 전체 HTML 생성
  previewDocuments            token 기반 HTML 임시 저장소

src/renderer/style.css
  data-surface                비활성 Viewer/Editor의 display 처리
  render-state                현재 전체 화면 렌더 상태 표시

reports/2026_09_11_02_28_keep_last_preview_during_math_rendering.md
  마지막 정상 Viewer 유지와 persistent iframe 상세 설계
```
