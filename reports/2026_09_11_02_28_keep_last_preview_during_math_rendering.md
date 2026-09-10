# 수식 렌더링을 기다리는 동안 무엇을 보여 줄 것인가

## 결론: 느린 계산보다 빈 화면이 더 큰 문제다

복잡한 수식 문서에서 `편집 → 보기` 전환이 느린 까닭은 단순히 KaTeX가 어렵게 계산하기 때문만은 아니다. 현재 MarkTex는 전환할 때마다 Markdown 전체를 다시 해석하고, 완전한 HTML 문서를 만들고, iframe을 새 주소로 이동시키고, Crossnote webview를 처음부터 실행한 뒤, 거대한 수식 HTML을 여러 차례 문자열과 DOM 사이에서 왕복시킨다. 수식이 복잡할수록 KaTeX가 내놓는 element 수와 HTML 크기가 급격히 늘어나므로 이 모든 비용이 함께 커진다.

그런데 사용자가 지적한 대로 우리는 이미 직전 Viewer를 잘 보고 있었다. 새 결과를 준비하는 동안 그것을 흰 막으로 가릴 이유가 없다. 가장 적합한 제품 원칙은 다음 한 문장이다.

> 마지막으로 정상 렌더된 Viewer는 다음 Viewer가 완성될 때까지 화면에 남는다.

새 결과는 뒤에서 만든다. 완성되고, sanitize와 수식 조판까지 끝나고, 목표 위치까지 계산된 다음 한 번에 교체한다. 실패하면 직전 결과를 그대로 둔다. 로딩 표시는 화면 전체를 점유하는 장막이 아니라 구석의 작은 상태 표시여야 한다. 이 변경은 렌더링 시간을 마술처럼 없애지는 않지만 사용자가 체감하는 공백 시간을 없앤다. 그 다음에야 실제 렌더링 비용을 줄이는 일이 의미를 갖는다.

## 지금은 한 번의 전환으로 너무 많은 것을 다시 시작한다

Editor에서 `Esc`를 누르면 renderer는 먼저 Viewer surface를 드러내고 `render()`를 기다린다.

```ts
async function enterViewer() {
  if (!model) return;
  anchor = editorViewportAnchor();
  publishAnchor();
  setSurface('viewer');
  await render(anchor);
}
```

겉으로는 기존 Viewer를 즉시 보여 주는 것처럼 보인다. 하지만 `render()`의 첫 동작은 화면 전체를 덮는 상태창을 켜는 것이다.

```ts
renderState.hidden = false;
const result = await window.marktex.renderDocument(
  model.getValue(),
  requestedRevision,
);
// ...
frame.src = result.url;
renderState.hidden = true;
```

그 상태창의 CSS는 `inset: 0`과 거의 불투명한 배경을 사용한다.

```css
.render-state {
  position: absolute;
  inset: 0;
  background: rgba(247, 247, 245, .86);
  z-index: 12;
}
```

즉, 직전 iframe은 여전히 뒤에 살아 있지만 보이지 않는다. 서버 쪽 렌더가 끝나면 `frame.src`를 새 URL로 바꾸므로 이번에는 iframe의 옛 document 자체가 폐기된다. 새 document가 CSS와 JavaScript를 읽고 Crossnote React app을 올리는 동안에는 이전 화면으로 돌아갈 길도 없다.

이 과정을 실제 코드의 경계에 맞춰 펼치면 다음과 같다.

| 단계 | 실행 위치 | 수식 문서에서 커지는 비용 |
|---|---|---|
| Markdown transform과 markdown-it parse | Electron main | 수식 token 수, 문서 길이 |
| KaTeX `renderToString` | Electron main | 수식의 복잡도와 cache miss 수 |
| Cheerio로 전체 HTML 재구성·sanitize | Electron main | 생성된 KaTeX HTML 전체 크기 |
| 완전한 HTML template 및 `data-html` 생성 | Electron main | 큰 문자열 생성·escape·보관 |
| custom protocol을 통한 새 iframe navigation | Chromium | document, CSS, JS를 다시 적재 |
| Crossnote webview bootstrap | iframe | React와 preview bundle 재초기화 |
| DOMPurify와 `innerHTML` | iframe | 수식 DOM node 수 |
| style 계산·font 적용·layout | Chromium | MathML·KaTeX span 수와 문서 높이 |

따라서 “수식 loading”은 하나의 긴 함수가 아니다. 같은 큰 결과물을 main process와 iframe이 차례로 몇 번씩 만지는 파이프라인이다.

## 수식은 짧은 원문에서 큰 DOM을 만든다

평문 `문장입니다`는 대체로 몇 개의 text node와 `<p>` 하나가 된다. 반면 분수, 행렬, 정렬식, 위아래 첨자와 괄호가 겹친 수식은 짧은 TeX 원문에서도 많은 중첩 `span`과 MathML node를 만든다. 병목을 입력 Markdown의 byte 수로만 예상하면 안 되는 이유다. 더 유용한 지표는 결과 HTML byte 수와 DOM node 수다.

Crossnote의 KaTeX 경로는 각 수식에 대해 다음 계산을 수행한다.

```ts
katex.renderToString(
  content,
  Object.assign({}, structuredClone(katexConfig), { displayMode }),
);
```

현재 설치된 Crossnote bundle에는 수식 문자열과 설정을 key로 하는 bounded cache가 들어 있다. 그래서 완전히 같은 수식을 두 번째로 처리할 때 KaTeX 계산 자체는 줄어든다. 그러나 cache가 해결하지 못하는 비용이 더 많이 남는다.

- 수정한 수식은 새로운 key이므로 다시 조판해야 한다.
- cache hit이어도 거대한 KaTeX HTML 문자열은 전체 문서에 다시 결합된다.
- Markdown transform, Cheerio 처리와 sanitize는 문서 전체를 다시 돈다.
- 브라우저는 반환된 문자열을 다시 DOM으로 파싱하고 style과 layout을 계산한다.
- 현재 방식은 iframe까지 새로 시작하므로 JavaScript와 CSS 초기화도 반복한다.

따라서 cache는 유용하지만 구조를 대신하지 못한다. 특히 “수식 하나만 고쳤다”와 “문서 전체를 처음 열었다”가 거의 같은 경로를 지나는 것이 현재 비용의 본질이다.

## 같은 HTML이 iframe 안에서 다시 처리된다

현재 main process는 `generateHTMLTemplateForPreview()`로 완전한 page를 만들며 렌더 결과를 `<body data-html="…">`에 넣는다. Crossnote preview가 처음 올라오면 이 값을 읽어서 곧바로 실제 preview에 삽입한다.

```ts
if (document.body.hasAttribute('data-html')) {
  previewElement.current.innerHTML = sanitizeHtml(
    document.body.getAttribute('data-html') ?? '',
  );
  document.body.removeAttribute('data-html');
}
```

그 직후 webview가 `webviewFinishLoading`을 보내면 MarkTex bridge는 동일한 `initialHtml`을 `updateHtml`로 다시 보낸다. Crossnote의 update 경로는 그것을 숨은 preview에 넣고, enhancer가 끝나면 다시 실제 preview로 복사한다.

```ts
hiddenPreviewElement.current.innerHTML = sanitizeHtml(html);
await initEvents();

// initEvents 내부
previewElement.current.innerHTML = hiddenPreviewElement.current.innerHTML;
hiddenPreviewElement.current.innerHTML = '';
```

이는 새 iframe 하나를 열 때 같은 렌더 결과가 최소 두 update 경로를 지날 수 있다는 뜻이다. 더구나 `hiddenPreviewElement.current.innerHTML`을 다시 읽는 순간 DOM은 문자열로 serialize되고, 실제 preview에 대입될 때 다시 parse된다. 복잡한 수식일수록 이 왕복은 비싸다.

여기에는 역설이 있다. Crossnote는 이미 숨은 preview에서 다음 결과를 준비하고 실제 preview로 교체하는 double-buffer 구조를 갖고 있다. MarkTex는 매번 iframe을 새로 만들기 때문에 그 구조가 지켜 주려던 기존 화면을 먼저 버린다.

## 보여 주는 화면과 준비 중인 화면을 분리해야 한다

Viewer에는 두 종류의 상태가 필요하다.

```ts
type ViewerSnapshot = {
  revision: number;
  anchor: ViewportAnchor;
  status: 'ready' | 'refreshing' | 'failed';
};

let displayed: ViewerSnapshot; // 지금 사람이 보는 것
let requestedRevision: number; // 뒤에서 준비하는 것
```

Editor model이 revision 18이고 마지막 Viewer가 revision 12여도 revision 12는 폐기물이 아니다. revision 18이 완성될 때까지 읽을 수 있는 마지막 정상 결과다. 상태 전환은 다음처럼 되어야 한다.

```text
Viewer r12 ──더블 클릭──> Editor r12
                            │ 편집하여 r18
                            │ Esc
                            ▼
Viewer r12 + 작은 “업데이트 중” 표시
                            │ background render r18 완료
                            ▼
Viewer r18로 원자적 교체 + 화면 anchor 복원
```

최초로 파일을 여는 경우에는 직전 snapshot이 없다. 이때만 간결한 skeleton이나 조판 상태를 보여 준다. 정상 Viewer를 한 번이라도 만든 뒤에는 full-screen loading surface로 되돌아가지 않는다.

오래된 결과를 보여 준다는 사실은 숨기지 않아야 한다. 다만 읽기를 방해해서도 안 된다. 오른쪽 아래에 작은 spinner와 `변경 사항 반영 중` 정도를 표시하고, 120~200ms 안에 끝나는 빠른 갱신에는 아예 나타내지 않아 깜빡임을 막는 편이 좋다. 실패하면 spinner를 `최신 결과를 만들지 못함`으로 바꾸되 기존 본문은 계속 읽게 한다.

## 권장안: iframe은 살려 두고 내용만 갱신한다

가장 좋은 구조는 Crossnote iframe을 문서를 여는 동안 한 번만 bootstrap하는 것이다. 이후 `편집 → 보기`에서는 새 page URL로 navigation하지 않고 새 HTML fragment와 revision을 기존 iframe에 전달한다. Crossnote가 이미 보유한 hidden preview에 fragment를 넣고 수식·도표 처리를 마친 뒤 real preview와 교체한다.

main과 iframe 사이의 계약은 다음 정도면 충분하다.

```ts
type PreviewUpdate = {
  command: 'marktex:update-preview';
  revision: number;
  fragmentUrl: string;
  anchor: ViewportAnchor;
  totalLineCount: number;
};

type PreviewCommitted = {
  type: 'marktex:preview-committed';
  revision: number;
};
```

큰 HTML fragment를 Electron IPC의 structured clone으로 직접 복사할 필요는 없다. 현재 `marktex-preview` scheme은 이미 `supportFetchAPI: true`로 등록돼 있고 token별 결과 저장소도 있다. main은 full document 대신 fragment를 token URL에 보관하고, 살아 있는 bridge가 그 URL을 fetch한 뒤 Crossnote의 `updateHtml` 경로로 넘길 수 있다. 이러면 transport 방식은 유지하면서 iframe navigation만 제거할 수 있다.

교체 완료를 `frame.onload`로 판단해서는 안 된다. iframe은 이미 load된 상태이기 때문이다. Crossnote의 `initEvents()`가 hidden preview의 사전 조판을 끝내고 real preview를 교체한 직후 bridge가 `preview-committed(revision)`을 보내야 한다. parent는 그 응답을 받은 뒤에만 `displayed.revision`을 올리고 목표 anchor를 적용한다.

이 방식에는 세 가지 이점이 겹친다.

1. 기존 Viewer가 새 결과의 준비 시간 내내 실제 DOM으로 남는다.
2. Crossnote preview bundle, stylesheet와 runtime state를 매번 다시 올리지 않는다.
3. Crossnote가 원래 만든 hidden/real preview 교체 구조를 그대로 활용한다.

보안 경계는 낮추지 않는다. fragment는 지금과 똑같이 server-side sanitize를 거치고, iframe의 DOMPurify도 유지한다. “옛 HTML을 남긴다”는 것은 unsafe HTML을 재사용한다는 뜻이 아니라 마지막으로 검증되어 정상 표시된 DOM의 수명을 조금 연장한다는 뜻이다.

## 차선책: iframe 두 장을 겹친다

Crossnote 내부 갱신 계약을 당장 손대기 어렵다면 visible iframe A 뒤에서 iframe B를 새 URL로 load하는 방법도 있다. B가 `ready`와 revision을 알리면 A와 B를 한 프레임 안에 교체한다. 현재 구조를 적게 바꾸면서 빈 화면을 없앨 수 있다는 장점이 있다.

그러나 이는 임시 해법이다. Crossnote bundle과 CSS를 매번 다시 적재하고, 잠시 동안 두 개의 큰 수식 DOM을 동시에 보유하며, iframe 안의 중복 update도 남는다. 복잡한 문서에서 CPU 비용은 거의 그대로이고 peak memory는 오히려 늘 수 있다. 따라서 순서는 다음이 적절하다.

- 즉시 개선: 불투명 overlay를 없애고, 새 iframe이 준비될 때까지 기존 iframe을 유지한다.
- 단기 안전판: 필요하다면 두 iframe으로 atomic swap을 구현한다.
- 최종 구조: iframe 하나를 유지하고 Crossnote의 hidden preview를 update buffer로 사용한다.

## 오래된 화면에서도 더블 클릭은 반드시 작동해야 한다

마지막 Viewer를 남겨 두면 새로운 문제가 생긴다. 화면은 revision 12인데 Markdown model은 revision 18일 수 있다. 그렇다고 refresh 중에 더블 클릭을 막아서는 안 된다. 앞선 보고서에서 정한 “어디서나 반드시 Editor로 전환” 규칙은 여기서도 제품 invariant다.

Viewer가 보내는 anchor에는 `renderedRevision`을 함께 넣어야 한다.

```ts
send({
  type: 'edit-at-anchor',
  renderedRevision: displayedRevision,
  anchor,
});
```

Host는 Monaco의 content change를 revision별 line delta로 짧게 기록한다. 오래된 Viewer에서 얻은 행을 현재 model로 옮길 때 이 delta를 통과시킨다. 클릭한 block 자체가 삭제됐다면 삭제 범위의 시작 행으로 수렴하고, 기록이 부족하면 기존 원칙대로 행을 clamp한 뒤 전환한다. 어떤 경우에도 mapping confidence가 전환을 취소하지 않는다.

또한 `Esc` 직후 보이는 옛 Viewer도 Editor viewport anchor를 따라야 한다. 우선 옛 DOM에서 가장 가까운 source element로 즉시 scroll하고, 새 revision이 commit되면 같은 anchor를 새 DOM에 다시 적용한다. 그러면 계산 중이라는 이유로 화면이 문서의 옛 위치로 튀었다가 다시 돌아오는 일을 피할 수 있다.

## 계산 자체도 최신 결과 하나에만 써야 한다

기존 화면을 유지하면 기다림은 견딜 만해지지만 불필요한 렌더를 계속 돌려도 된다는 뜻은 아니다. 요청에는 다음 규칙이 필요하다.

- 같은 revision의 완성된 Viewer가 있으면 다시 렌더하지 않는다.
- 렌더 도중 더 최신 요청이 왔다면 완성된 옛 결과는 commit하지 않는다.
- sync KaTeX 작업을 중간 취소하기 어렵다면 현재 작업 뒤에는 가장 최신 revision 하나만 남기고 중간 revision을 합친다.
- 수식 cache는 유지하되 hit/miss를 측정한다. cache hit이어도 DOM 비용은 남는다는 점을 별도로 본다.
- 향후에는 변경 block만 다시 만드는 incremental render를 검토하되, 우선 persistent iframe으로 전체 재초기화부터 제거한다.

현재 renderer의 `renderToken` 검사는 낡은 결과가 화면에 commit되는 것을 막는다. 그러나 이미 main process에 보낸 계산을 취소하거나 합치지는 않는다. edit 때마다 preview를 만들지 않는 현재 UX에서는 급한 문제는 아니지만, 자동 갱신이나 빠른 mode toggle을 추가한다면 latest-only queue가 필요하다.

## 먼저 측정해야 할 것은 총시간이 아니라 단계별 시간이다

수식이 느리다는 관찰은 맞지만, 최적화 순서를 정하려면 다음 표본을 별도로 재야 한다.

```ts
type RenderMetrics = {
  revision: number;
  markdownBytes: number;
  formulaCount: number;
  parseAndKatexMs: number;
  serverSanitizeMs: number;
  fragmentBytes: number;
  fetchMs: number;
  domPurifyMs: number;
  enhanceMs: number;
  commitAndLayoutMs: number;
  katexCacheHits: number;
  katexCacheMisses: number;
};
```

평문 문서, 수식 100개가 모두 같은 문서, 수식 100개가 모두 다른 문서, 거대한 행렬 몇 개가 있는 문서를 나눠 측정해야 한다. 같은 수식 표본은 cache 효과를 보여 주고, 모두 다른 수식은 KaTeX CPU를 드러내며, 거대한 행렬은 HTML/DOM 팽창 비용을 드러낸다. cold start와 같은 문서를 다시 보는 warm update도 분리한다.

성능 목표의 첫 항목은 “몇 ms 안에 모든 계산 완료”가 아니라 다음처럼 잡는 것이 좋다.

- `Esc`를 누른 다음 프레임에도 읽을 수 있는 Viewer가 존재한다.
- 준비 중 어떤 시점에도 빈 화면이나 전체 가림막이 나타나지 않는다.
- 새 결과는 부분적으로 그려지는 대신 완성된 뒤 한 번에 교체된다.
- 실패하거나 낡은 결과가 도착해도 마지막 정상 Viewer가 손상되지 않는다.

그 조건을 만족한 뒤 측정된 가장 큰 구간부터 줄인다. 예상으로는 persistent iframe 제거 전에는 bootstrap과 반복 DOM 구성이 크게 보일 가능성이 높지만, 계측 없이 KaTeX만 탓하거나 cache 크기부터 키우는 것은 순서가 아니다.

<details>
<summary>관련 코드 경로</summary>

```text
src/
├── renderer/
│   ├── main.ts                 # enterViewer, render, iframe navigation
│   └── style.css               # 전체 화면 render-state overlay
├── main/
│   └── main.ts                 # renderCurrent, HTML template, token 저장소
├── preview/
│   └── bridge.ts               # webviewFinishLoading 후 updateHtml 전달
└── shared/
    ├── contracts.ts            # RenderResult 계약
    └── viewport-anchor.ts      # 화면 기준 anchor

vendor/crossnote/src/
├── markdown-engine/index.ts    # parseMD, template 생성
├── renderers/parse-math.ts     # KaTeX 조판과 cache
└── webview/
    ├── containers/preview.ts   # hidden preview 준비 후 real preview 교체
    └── components/
        ├── Preview.tsx         # 두 preview DOM의 소유자
        ├── LoadingIcon.tsx     # 최초 loading overlay
        └── RefreshingIcon.tsx  # 구석의 갱신 표시
```

</details>

## 구현 순서

첫째, 사용자 경험부터 바로잡는다. `render-state`의 전면 배경을 제거하고 지연 후 나타나는 작은 `RefreshingIcon` 형태로 바꾼다. `render()`가 시작됐다는 이유만으로 기존 iframe을 가리지 않는다. 새 결과가 실패하면 오류를 본문 위에 덮지 말고 상태 표시로 남긴다.

둘째, displayed revision과 requested revision을 분리한다. old Viewer가 현재 model보다 뒤처질 수 있음을 정상 상태로 인정하고, 모든 메시지에 revision을 붙인다. stale result는 버리되 last-known-good result는 버리지 않는다.

셋째, iframe을 한 번만 bootstrap하도록 계약을 바꾼다. main은 HTML fragment URL을 반환하고 bridge는 fetch 후 Crossnote hidden preview를 갱신한다. 초기 `data-html`과 `webviewFinishLoading → updateHtml` 중 하나만 남겨 첫 문서의 중복 삽입도 제거한다. Crossnote가 실제 DOM 교체를 끝냈을 때 `preview-committed`를 보내도록 한다.

넷째, 화면 anchor를 교체 전후 두 번 적용한다. 옛 Viewer를 즉시 현재 Editor viewport 근처로 옮기고, 새 Viewer가 commit되면 같은 `sourceLine`과 `yRatio`를 다시 맞춘다.

다섯째, revision 간 line mapping과 단계별 계측을 붙인다. stale Viewer의 더블 클릭도 무조건 현재 Editor로 넘어가게 하고, 실제 병목이 KaTeX CPU인지 문자열 처리인지 DOM/layout인지 숫자로 확인한다.

여섯째, 그 측정 결과가 필요성을 입증할 때만 block 단위 incremental rendering을 시작한다. 이는 source map, footnote, reference link, TOC처럼 문서 전역 의존성이 있는 기능 때문에 훨씬 어려운 작업이다. iframe 재초기화와 중복 DOM 삽입을 먼저 없애지 않은 채 incremental parser부터 만드는 것은 위험에 비해 얻는 것이 작다.

## 최종 판단

지금의 긴 전환은 복잡한 수식을 그리는 시간과 전체 preview를 매번 새 프로그램처럼 다시 여는 시간이 합쳐진 결과다. KaTeX cache는 같은 수식의 재계산 일부를 줄이지만, 큰 HTML을 만들고 sanitize하고 DOM으로 재구성하고 배치하는 비용까지 없애지는 못한다. 현재는 그 동안 살아 있는 옛 화면을 스스로 가리고, 곧이어 iframe navigation으로 폐기한다.

읽기 프로그램에서 새 페이지가 준비되지 않았다는 이유로 이미 읽던 페이지를 치우는 것은 맞지 않는다. Editor가 최신 원문을 소유하고, Viewer는 마지막으로 완성된 표현을 소유하면 된다. 둘의 revision이 잠시 다른 것은 오류가 아니라 비동기 렌더링의 정상 상태다. 사용자는 직전 결과를 계속 읽고, 시스템은 뒤에서 다음 결과를 만들고, 완성된 순간에만 화면을 바꾼다.

MarkTex의 기준은 여전히 화면이다. 이번에는 위치뿐 아니라 시간에서도 그렇다. 새 화면이 준비될 때까지 옛 화면은 사라져서는 안 된다.
