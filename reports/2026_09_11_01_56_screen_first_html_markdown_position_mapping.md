# 화면을 기준으로 한 HTML–Markdown 위치 변환 보고서

## 결론: 위치 변환은 정확할 수도, 부정확할 수도 있지만 실패해서는 안 된다

Viewer와 Editor 사이의 왕복은 부가 기능이 아니다. 이 프로그램의 문법 그 자체다. 따라서 더블 클릭했을 때 source map이 있는 경우에만 Editor로 넘어가는 현재 방식은 제품의 약속과 맞지 않는다. 빈 파일, 수식, 그림, HTML, 문서 아래의 여백을 포함해 **Viewer 안의 어느 지점을 더블 클릭해도 반드시 Editor로 전환되어야 한다.** 정확한 원문 위치를 알 수 없다면 가장 설득력 있는 위치를 추정하고, 그것조차 어렵다면 문서의 처음이나 끝으로 간다. “매핑 실패”는 내부 진단값일 수는 있어도 사용자에게 허용되는 결과가 아니다.

반대 방향도 같은 원칙을 따라야 한다. `Esc`를 눌렀을 때 Viewer가 따라가야 하는 것은 Monaco cursor가 아니라 사용자가 보고 있던 **화면**이다. 커서가 10행에 남아 있어도 사용자가 마우스 휠로 300행을 읽고 있었다면 Viewer는 300행 근처를 보여 줘야 한다. 커서는 다시 Editor에 돌아왔을 때 복원할 편집 상태일 뿐, 화면 전환의 기준점이 아니다.

이를 위해 두 방향을 하나의 `ViewportAnchor`로 통일하는 것이 좋다.

```ts
type ViewportAnchor = {
  sourceLine: number;        // 항상 1 이상, 문서 행 수 이하
  sourceColumn?: number;     // 알 수 있을 때만
  sourceEndLine?: number;    // block 범위를 알 수 있을 때만
  yRatio: number;            // viewport 안의 세로 위치, 0~1
  reason:
    | 'exact-range'
    | 'ancestor-line'
    | 'neighbor-interpolation'
    | 'scroll-ratio'
    | 'empty-document';
  confidence: 'exact' | 'near' | 'fallback';
};
```

중요한 것은 `resolveViewerPoint()`와 `resolveEditorViewport()`가 `ViewportAnchor | null`을 반환하지 않는다는 점이다. 둘은 어떤 입력에도 anchor를 내놓는 **total function**이어야 한다. 전환 코드는 confidence를 검사하지 않는다. confidence는 시험과 디버깅을 위한 것이며, 낮다고 해서 전환을 취소하는 스위치가 아니다.

## 지금 실패하는 이유

현재 Electron preview bridge의 핵심은 다음과 같다.

```js
const mapped = target.closest('[data-source-line]') ||
  target.querySelector('[data-source-line]');
const line = Number(mapped?.getAttribute('data-source-line'));
if (!Number.isFinite(line) || line < 1) return;
send({ type: 'edit-at-line', line });
```

이 코드는 “행을 찾으면 전환한다”고 쓰여 있다. 우리가 원하는 규칙은 “전환하면서 행을 결정한다”이다. 둘은 비슷해 보이지만 실패의 주체가 다르다. 지금은 source map이 전환을 허가한다. 바뀐 설계에서는 전환이 먼저 확정되고, source map은 목적지를 개선하는 여러 증거 중 하나가 된다.

빈 파일에서는 렌더링할 Markdown block이 없으므로 클릭한 배경과 연결된 `[data-source-line]`도 없다. 사용자가 Crossnote의 고정 배경이나 preview container의 빈 부분을 더블 클릭하면 `closest()`와 `querySelector()`가 모두 실패하고 함수가 조용히 끝난다. 이것은 빈 문서의 특수한 문제가 아니라 “클릭 지점에 직접 연결된 source element가 없다”는 일반적인 경우다. 문서 끝의 넓은 여백도 같은 실패를 낼 수 있다.

수식 문제는 Crossnote 내부에서 더 정확히 드러난다. block math parser는 이미 source range를 갖고 있다.

```ts
const token = state.push('math_block', 'div', 0);
token.content = content;
token.map = [startLine, nextLine];
```

그러나 이어지는 전용 renderer는 `parseMath()`가 만든 KaTeX HTML만 반환한다.

```ts
md.renderer.rules.math_block = (tokens, idx) => {
  return parseMath({
    content: tokens[idx].content,
    displayMode: true,
    // ...
  });
};
```

Crossnote의 일반 source-map plugin은 `*_open` token을 렌더할 때 `data-source-line`을 붙인다. `math_block`은 이 경로를 지나지 않는다. 실제로 Crossnote 0.9.35를 이용해 다음 문서를 렌더해 보았다.

```md
# 위

문장 속 $x^2$ 수식

$$
E=mc^2
$$

아래
```

그 결과 인라인 수식을 감싼 문단에는 `data-source-line="3"`이 남았지만, 독립 수식의 `span.katex-display`에는 source 속성이 없었다. 그 다음 문단은 곧바로 `data-source-line="9"`였다. 원래 parser가 알고 있던 5~7행 정보가 수식 조판 과정에서 사라진 것이다. DOM에서 조상을 찾는 것만으로는 복원할 수 없다.

## 첫 번째 원칙: 더블 클릭은 조건 없는 상태 전환이다

preview bridge는 document의 capture 단계에서 `dblclick`을 받는다. handler의 첫 동작은 전환에 필요한 화면 좌표를 기록하는 것이고, 마지막 동작은 언제나 `edit-at-anchor` 메시지를 보내는 것이다. 그 사이의 모든 mapping 로직은 anchor의 품질만 바꾼다.

```ts
function onPreviewDoubleClick(event: MouseEvent) {
  const yRatio = clamp(event.clientY / window.innerHeight, 0, 1);
  const anchor = resolveViewerPoint(event, yRatio); // 절대 null이 아님

  event.preventDefault();
  event.stopImmediatePropagation();
  host.postMessage({ type: 'edit-at-anchor', anchor });
}
```

현재의 `blocked` selector도 없애야 한다. 링크, checkbox, code chunk, 수식, SVG 위라고 해서 더블 클릭 전환을 거부하면 “어디서나 수정”이라는 규칙이 다시 예외 목록에 종속된다. 링크는 한 번 클릭하면 열리고 두 번 클릭하면 편집해야 한다. 이를 확실히 하려면 Crossnote의 link activation을 system double-click interval보다 조금 짧은 시간 동안 보류하고, 두 번째 click 또는 `dblclick`이 오면 취소해야 한다. 첫 click에서 곧바로 외부 페이지를 열어 버리면 두 번째 click이 현재 Viewer에 도달하지 못할 수 있다.

Checkbox처럼 첫 click의 부수 효과가 치명적이지 않은 control은 기존 동작을 허용해도 두 번째 click에서 반드시 Editor로 넘어가야 한다. code chunk 실행처럼 큰 부수 효과가 있는 control은 single-click action을 같은 gesture arbiter를 통해 지연한다. 이 때문에 single click 반응이 약 200~300ms 늦어지는 비용이 생기지만, 사용자가 의도한 double click을 잃는 것보다 작다.

브라우저의 단어 선택도 전환보다 우선하지 않는다. 두 번째 `mousedown`에서 native selection을 막고 `dblclick` capture handler가 상태를 전환한다. 다만 Editor에 들어간 뒤에는 Monaco selection을 별도로 정할 수 있다. “더블 클릭 전환이 필수”라는 말은 원문 block 전체를 반드시 선택하라는 뜻이 아니라, Viewer에 남아 있는 결과가 절대로 나와서는 안 된다는 뜻으로 구현해야 한다.

## HTML 지점에서 Markdown 위치를 찾는 사다리

정확한 정보부터 가장 거친 추정까지 여섯 단계를 둔다. 위 단계가 실패하면 아래 단계로 내려가되, 사다리 밖으로 떨어지는 경우는 없다.

### 1. source range가 붙은 자신 또는 조상

가장 먼저 event의 `composedPath()`를 훑는다. Shadow DOM과 SVG 내부를 고려하면 `target.closest()` 하나보다 composed path가 안전하다. `data-source-start`, `data-source-end`가 있으면 행과 열을 그대로 쓴다. 기존 `data-source-line`만 있으면 그 행의 1열을 쓴다.

인라인 수식은 대개 `<p data-source-line="N">` 안에 있으므로 이 단계에서 해당 문단으로 이동한다. heading 내부의 강조, link 안의 image, KaTeX의 깊은 span과 MathML도 조상에 source range만 남아 있다면 DOM 깊이와 무관하게 처리된다.

### 2. 후손의 source range

클릭한 것이 table이나 figure 같은 container이고 자식만 행 정보를 가진 경우에는 클릭 좌표를 포함하거나 좌표와 가장 가까운 후손 anchor를 고른다. 현재 코드처럼 첫 번째 `querySelector()`를 택하면 큰 table의 아래쪽을 눌러도 첫 행으로 갈 수 있다. 후보의 `getBoundingClientRect()`와 click point 사이 거리를 비교해야 한다.

### 3. 앞뒤 source anchor 사이의 보간

독립 수식처럼 클릭한 node와 그 조상·후손 어디에도 source 정보가 없으면, DOM 순서와 화면 좌표 양쪽에서 직전·직후 anchor를 찾는다. 예컨대 수식 위 문단이 3행, 아래 문단이 9행이라면 클릭 대상은 4~8행 사이에 있다. 이 구간의 Markdown block index에서 display math가 5~7행임을 알 수 있으면 5행을 고른다.

block index도 없다면 click의 세로 위치를 두 anchor의 화면 위치 사이에서 보간한다. 이 결과는 exact가 아니라 `neighbor-interpolation`이지만, 직전 문단으로 무조건 붙이는 것보다는 문서의 시각적 흐름을 잘 보존한다.

### 4. 가장 가까운 시각 anchor

absolute positioning, 큰 SVG, diagram overlay처럼 DOM 순서와 시각 순서가 달라질 때는 화면상 거리가 가까운 anchor를 사용한다. 각 anchor의 rect 내부에서는 거리를 0으로 계산하고, 그 밖에서는 click point에서 rect 경계까지의 거리를 잰다. 단, 왼쪽 TOC나 floating UI는 본문 좌표계에서 제외한다.

### 5. 전체 scroll ratio

source anchor가 하나도 없지만 Markdown에는 내용이 있다면 Viewer의 전체 scroll progress를 source line 수에 투영한다.

```ts
const documentRatio =
  (scrollY + event.clientY) / Math.max(documentHeight, innerHeight);
const line = 1 + Math.round(documentRatio * (lineCount - 1));
```

raw HTML만 있는 문서, renderer가 모든 mapping을 잃은 문서에서도 최소한 위쪽은 원문 앞쪽으로, 아래쪽은 원문 뒤쪽으로 간다. 정확한 의미 변환은 아니지만 화면을 기준으로 한 일관된 변환이다.

### 6. 빈 문서의 1행

0 byte 문서의 source line은 Monaco 관점에서 1행 하나다. 따라서 어디를 더블 클릭해도 `{sourceLine: 1, sourceColumn: 1, reason: 'empty-document'}`를 반환한다. 공백과 newline만 있는 문서도 시각적 내용은 없으므로 기본은 1행으로 두되, 줄이 여러 개이고 click 높이를 반영할 가치가 있다면 scroll ratio로 1~N행을 선택할 수 있다. 어느 쪽이든 Editor 전환은 이미 확정돼 있다.

모든 결과는 마지막에 `1 <= line <= model.getLineCount()`로 clamp한다. 잘못된 `data-source-line="9999"`도 전환을 깨뜨리지 않고 문서 끝으로 수렴한다.

## 수식은 추정하기 전에 정보를 잃지 않아야 한다

fallback을 잘 만드는 일과 engine이 가진 정보를 보존하는 일은 구분해야 한다. block math는 이미 `token.map`이 있으므로 추정할 이유가 없다. Crossnote의 renderer가 source wrapper를 내놓도록 고치는 것이 정답이다.

```ts
md.renderer.rules.math_block = (tokens, idx) => {
  const token = tokens[idx];
  const [start, end] = token.map ?? [0, 1];
  const math = parseMath(/* existing arguments */);

  return `<div class="crossnote-math-source"
    data-source-line="${start + 1}"
    data-source-lines="${start + 1}-${end}">${math}</div>`;
};
```

Crossnote sanitizer는 이미 `data-source-line`, `data-source-lines`, 일반 `data-*`를 보존한다. 따라서 wrapper는 KaTeX와 MathJax 양쪽에서 살아남을 수 있다. blockquote와 list 안의 math도 token의 container-adjusted `map`을 사용하므로 별도 행 계산을 해서는 안 된다.

인라인 수식은 부모 문단 행만으로도 지금의 오작동 대부분을 해결한다. 다만 여러 행짜리 문단이나 같은 행에 수식이 여러 개 있을 때 정확한 formula column을 원한다면 sidecar source atlas가 필요하다. inline rule이 token을 만들 때 delimiter 시작·끝 offset을 `token.meta`에 기록하고, 부모 inline token의 block line과 합쳐 다음 정보를 출력한다.

```html
<span class="crossnote-inline-math-source"
      data-source-start="12:18"
      data-source-end="12:31">…KaTeX…</span>
```

raw HTML block 안의 수식은 더 어렵다. Crossnote는 HTML 문자열을 다시 훑어 delimiter를 KaTeX로 치환하며, markdown-it의 inline token 경로를 거치지 않는다. 이 경우 원문을 정규식으로 다시 대충 찾기보다 transformer 단계에서 HTML block 전체의 source range를 wrapper에 보존하고, 그 범위 안에서 수식 순서를 sidecar atlas와 맞춰야 한다. 같은 수식이 반복될 수 있으므로 TeX 문자열만 key로 쓰지 말고 `(blockId, occurrenceIndex)`를 사용한다.

이 수정은 앱에서 렌더 완료 DOM을 억지로 고치는 것보다 Crossnote의 최소 patch로 두는 편이 낫다. `span.katex-display`의 순서를 Markdown의 `$$` 순서와 맞추는 사후 처리는 당장은 동작해도 fenced code, escaped dollar, custom delimiter에서 쉽게 어긋난다. parser가 아는 range를 renderer가 운반하는 것이 가장 짧고 확실하다.

## `Esc`: 커서를 버리고 화면을 읽는다

현재 renderer의 `enterViewer()`는 다음 방식이다.

```ts
anchorLine = editor.getPosition()?.lineNumber ?? anchorLine;
setSurface('viewer');
await render(anchorLine);
```

이것이 커서와 화면이 다를 때 Viewer가 엉뚱한 곳으로 가는 직접적인 이유다. Monaco에서 mouse wheel이나 scrollbar로 멀리 이동해도 cursor는 원래 편집하던 행에 남을 수 있다. 사용자가 보는 것은 300행인데 전환은 10행을 따른다.

바뀐 방식은 Editor viewport 안에 고정된 probe point를 둔다. Crossnote도 source sync에서 화면 높이의 37.2%를 기본 `topRatio`로 사용한다. 이 값을 두 화면의 공통 기준선으로 삼으면 좋다. `Esc` 순간에 Monaco DOM의 왼쪽 content 영역, 위에서 37.2%인 client point를 `editor.getTargetAtClientPoint()`에 넣어 실제 보이는 line을 얻는다. view zone이나 빈 영역 때문에 target이 없다면 `getVisibleRanges()`에서 해당 높이에 가장 가까운 range를 고른다. 그래도 없으면 1행이다.

```ts
function resolveEditorViewport(editor: IStandaloneCodeEditor): ViewportAnchor {
  const rect = editor.getDomNode()!.getBoundingClientRect();
  const yRatio = 0.372;
  const target = editor.getTargetAtClientPoint(
    rect.left + editor.getLayoutInfo().contentLeft + 8,
    rect.top + rect.height * yRatio,
  );

  const sourceLine = target?.position?.lineNumber
    ?? editor.getVisibleRanges()[0]?.startLineNumber
    ?? 1;

  return { sourceLine, yRatio, reason: 'exact-range', confidence: 'near' };
}
```

그 anchor로 새 Viewer가 준비되면 Crossnote에 `changeTextEditorSelection`을 보내되 `line = sourceLine - 1`, `topRatio = yRatio`, `forced = true`로 한다. 새 HTML에서 정확한 source element가 없다면 Viewer 쪽도 앞뒤 anchor를 보간해 같은 화면 높이에 놓는다. cursor position과 selection, undo history는 Monaco model에 그대로 보관한다. 나중에 Editor로 돌아왔을 때 cursor는 원래 자리에 있어도 된다. 다만 화면 전환 순간의 시점은 viewport가 결정한다.

반대 방향도 같은 대칭을 지킨다. Viewer에서 사용자가 화면의 70% 높이에 있는 수식을 더블 클릭했다면, Editor에서도 대응 source line을 화면의 약 70% 높이에 놓는다. `revealLineInCenter()`로 무조건 중앙에 보내면 클릭할 때마다 문서가 위아래로 점프한다. Monaco의 `getTopForLineNumber(line)`에서 click pixel offset을 빼 `setScrollTop()`을 호출하면 같은 위치를 유지할 수 있다. cursor는 그 line 또는 정확한 source range에 놓되 scroll 계산의 기준은 click의 `yRatio`다.

## 구현 순서

첫째, 현재 bridge를 total function으로 바꾼다. `blocked`와 mapping 실패 `return`을 제거하고, empty document와 scroll-ratio fallback을 넣는다. 메시지를 `edit-at-line`에서 `edit-at-anchor`로 바꿔 `yRatio`, reason, confidence를 함께 보낸다. 이것만으로 빈 파일, 여백, 알 수 없는 HTML에서도 전환은 보장된다.

둘째, `Esc`에서 `editor.getPosition()`을 제거하고 viewport probe를 사용한다. Viewer 진입과 Editor 진입 양쪽에서 같은 `yRatio`를 적용한다. 이 단계가 끝나면 “화면이 기준”이라는 원칙이 왕복 전체에 성립한다.

셋째, Crossnote의 `math_block` renderer가 `token.map`을 보존하도록 수정하고 upstream에 보낼 수 있는 작은 patch와 test를 만든다. KaTeX, MathJax, blockquote/list 내부 수식, custom delimiter를 같은 test table로 돌린다. 앱이 npm Crossnote와 local submodule을 섞어 쓰지 않도록, patch 적용 뒤에는 local Crossnote build를 명시적으로 의존하거나 수정이 포함된 정식 release로 올린다.

넷째, source atlas와 geometry index를 만든다. 매 render가 끝난 뒤 모든 `[data-source-*]` element의 rect와 DOM 순서를 한 번 수집하고, resize·image load·diagram render 때 index를 무효화한다. 매 double click마다 전체 DOM을 반복해서 훑지 않는다.

다섯째, single/double click gesture arbiter를 link와 실행 control에 적용한다. double click은 언제나 Editor를 이기고, single click은 짧은 지연 뒤 원래 기능을 수행한다.

## 시험은 정확도와 전환 보장을 분리해야 한다

두 종류의 시험이 필요하다. 첫째는 **liveness**다. Viewer 내부의 어떤 좌표를 두 번 눌러도 정해진 시간 안에 `data-surface="editor"`가 되어야 한다. 0 byte, newline만 있는 파일, raw HTML만 있는 파일, 매우 긴 문서에서 viewport를 격자로 나눠 모든 점을 검사한다. mapping reason이 fallback이어도 이 시험은 성공이다.

둘째는 **accuracy**다. 다음 fixture마다 예상 행 또는 허용 범위를 검증한다.

| Viewer에서 누른 대상 | 기대하는 Markdown 위치 |
|---|---|
| 빈 문서의 중앙 | 1행 1열 |
| 문서 끝 여백 | 마지막 source block 또는 EOF |
| 인라인 `$x^2$` | 그 수식이 든 문단, 가능하면 delimiter 범위 |
| 독립 `$$…$$` | opening delimiter 행과 block 범위 |
| blockquote/list 속 수식 | container marker를 포함한 실제 source 행 |
| raw HTML table 속 수식 | HTML block 범위 안 해당 occurrence |
| Mermaid/SVG 내부 | 해당 fence의 시작 행 |
| table 마지막 cell | 해당 row 또는 cell에 가장 가까운 source 행 |
| link를 더블 클릭 | link를 열지 않고 link source 위치로 전환 |

`Esc` 시험에서는 cursor와 viewport를 의도적으로 갈라놓는다. cursor를 10행에 둔 채 Editor를 300행으로 scroll하고 `Esc`를 누른다. Viewer의 37.2% 기준선에는 300행에 대응하는 element가 와야 한다. 다시 Editor로 들어갔을 때 화면은 해당 click anchor를 따르되, Monaco가 보존한 cursor·undo 상태가 손실되지 않는지도 따로 확인한다.

property test도 유용하다. 임의의 click coordinate와 임의의 불완전한 anchor 목록을 넣었을 때 resolver가 절대 throw하거나 null을 반환하지 않고, 결과 행이 항상 `[1, lineCount]`에 포함되는지 검증한다. source 속성이 잘못됐거나 DOM node가 render 도중 분리되는 상황도 생성해야 한다.

## 최종 판단

HTML과 Markdown 사이에는 완전한 역함수가 없다. Markdown delimiter, front matter, reference definition은 Viewer에서 사라지고, 하나의 수식은 수십 개의 KaTeX span으로 늘어난다. 그러므로 모든 지점에서 “정확한” 변환을 약속할 수는 없다. 그러나 모든 지점에서 **일관된** 변환은 약속할 수 있다.

그 약속의 순서는 분명해야 한다. 먼저 무조건 전환한다. 다음으로 parser가 가진 source range를 끝까지 보존한다. 정보가 사라졌다면 이웃과 화면 위치로 추정한다. 마지막까지 아무것도 없다면 빈 문서는 1행, 일반 문서는 scroll ratio가 가리키는 행으로 간다. `Esc` 역시 cursor라는 편집기의 사정을 묻지 않고 사용자가 보고 있던 화면을 따른다.

이 프로그램에서 화면은 결과물이 아니라 좌표계다. Viewer와 Editor는 서로 다른 두 문서가 아니라 같은 문서를 바라보는 두 렌즈다. 어느 렌즈의 어느 지점에서도 다른 렌즈로 넘어갈 수 있어야 하며, 넘어간 뒤에도 방금 보던 대목이 같은 높이에 남아 있어야 한다. 이것을 예외 없는 제품 invariant로 두는 것이 맞다.
