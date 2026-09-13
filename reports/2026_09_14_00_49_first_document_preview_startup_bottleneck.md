# 첫 문서 Preview 시작 성능 병목 계측 보고서

2026년 9월 14일 00:49 KST

## 결론

`sample.md`를 더블클릭해 Setdown을 처음 실행할 때 보이는 대기의 최대 병목은
Crossnote 조판 워커가 아니다. 워커가 만든 완성 페이지를 새 `WebContentsView`에
`loadURL()`로 올린 뒤, Chromium이 Crossnote runtime과 거대한 KaTeX DOM을
파싱·스타일 계산·layout하는 구간이다.

현재 production build에서 `sample.md`의 중앙값은 다음과 같았다.

```text
프로세스 시작
  └─ 0.99초: 앱 shell 표시
       └─ 0.07초: "조판 중입니다" 표시
            ├─ 0.27초: 워커 조판과 완성 HTML 생성
            └─ 1.50초: Preview navigation, 자산 실행, DOM/style/layout
                 └─ Preview 표시

총 더블클릭 상당 시점 → Preview 표시: 약 2.80초
"조판 중입니다" → Preview 표시: 약 1.76초
```

“조판 중입니다” 이후 대기 중 약 **85%**가 Preview 페이지 로드 쪽이고, 워커
조판은 약 **15%**였다. 따라서 첫 개선 대상은 Markdown parser나 IPC가 아니라
**첫 Preview가 Crossnote 전체 페이지를 새로 navigation하는 구조**다.

그 구조를 가볍게 만든 뒤에는 `sample.md`의 수식이 생성하는 약 5만 개의 layout
object가 다음 병목이 된다.

## 질문과 측정 범위

이번 계측은 다음 두 질문에 답하기 위해 수행했다.

1. 새 프로세스에서 첫 Markdown 문서를 열 때 어느 단계가 가장 오래 걸리는가?
2. 문서 크기, 수식, 고정 runtime 중 무엇을 개선해야 사용자가 보는 대기가 가장
   많이 줄어드는가?

측정 대상은 현재 저장소의 production build를 `electron . <문서 경로>`로 실행한
경로다. 데스크톱 파일 연결의 OS shell 전달 시간은 포함하지 않았지만, Electron이
문서 경로를 받아 창과 Preview를 만드는 제품 경로는 동일하다.

## 계측 방법

각 조건을 새 Electron 프로세스와 새 `XDG_CONFIG_HOME`에서 세 번 실행했다. 다음
시점을 Node, renderer Performance API, Electron main의 WebContents navigation
event로 같은 epoch에 맞춰 기록했다.

- Electron 실행 요청
- 첫 BrowserWindow와 제품 shell 표시
- `.render-state:not([hidden])`, 즉 “조판 중입니다” 표시
- 실제 문서 Preview의 `marktex-preview://document/...` navigation 시작
- Preview `dom-ready`와 `did-finish-load`
- native `WebContentsView`가 visible이 된 시점

원인 분리를 위해 세 문서를 비교했다.

- `tiny`: 17바이트의 제목과 한 문장
- `plain-same-shape`: `sample.md`에서 `$`만 전각 문자로 바꿔 수식을 비활성화한
  동급 크기 문서
- `sample-math`: 원본 `reports/sample.md`

추가로 Chrome DevTools Protocol의 `Performance`와 CPU profiler를 연결해 DOM node,
layout object, layout 시간, style recalculation 시간을 비교했다. 계측용 테스트는
결과를 얻은 뒤 삭제했으며 제품 코드와 작업 트리에는 남기지 않았다.

이 값은 **프로세스 cold start이지만 OS filesystem cache는 통제하지 않은 값**이다.
빌드 직후 첫 실행에서는 renderer 자산 cache가 차가워 전체 시간이 약 5.55초까지
늘어난 한 번의 관측값도 있었다. 아래 비교에는 반복 가능한 중앙값을 사용했다.

## 전체 결과

### `sample.md` critical path

| 구간 | 중앙값 | “조판 중” 이후 비중 |
|---|---:|---:|
| 프로세스 실행 → shell 표시 | 0.99초 | 해당 없음 |
| shell 표시 → “조판 중” | 0.07초 | 해당 없음 |
| “조판 중” → Preview navigation 시작 | 0.27초 | 15% |
| Preview navigation 시작 → load/표시 | 1.50초 | 85% |
| “조판 중” → Preview 표시 | 1.76초 | 100% |
| 프로세스 실행 → Preview 표시 | 2.80초 | 전체 체감 시간 |

워커 응답 뒤 첫 페이지를 설치하는 critical path는
`src/main/main.ts`의 다음 부분이다.

```ts
const rendered = await callRenderWorker(/* ... */);

// 첫 로드
const url = `marktex-preview://document/${token}`;
await preview.view.webContents.loadURL(url);
```

실제 최대 대기는 `callRenderWorker()`보다 `loadURL()`에서 발생했다.

### 대조군

| 문서 | 입력 크기 | “조판 중” → navigation | navigation → 표시 | 전체 “조판 중” 대기 |
|---|---:|---:|---:|---:|
| tiny | 17B | 0.08초 | 0.86초 | 0.91초 |
| plain-same-shape | 37.3KB | 0.12초 | 0.97초 | 1.09초 |
| sample-math | 33.9KB | 0.27초 | 1.50초 | 1.76초 |

이 비교에서 두 가지가 드러난다.

첫째, 17바이트 문서도 Preview navigation에 약 0.86초가 든다. 이것은 문서 내용과
무관한 Crossnote 브라우저 runtime의 고정 바닥 비용이다.

둘째, `sample.md`는 수식을 제거한 동급 문서보다 약 0.67초 더 기다린다. 그 증가분은
워커에 약 0.15초, Preview navigation과 layout에 약 0.52초로 나뉜다. 즉 수식 문서의
추가 비용도 주로 브라우저 DOM 쪽에서 발생한다.

## 최대 병목의 내부 구성

### 1. Crossnote 전체 runtime의 고정 비용

`generateHTMLTemplateForPreview()`는 이미 서버 쪽에서 완성한 Markdown HTML을
내려주면서도 일반 문서에 다음 runtime을 함께 싣는다.

| 자산 | 대략적인 디스크 크기 |
|---|---:|
| Crossnote `webview/preview.js` | 4.1MB |
| Mermaid | 3.5MB |
| Vega, Vega-Lite, Vega-Embed | 0.8MB |
| WaveDrom과 skin | 0.14MB |
| Preview/KaTeX/Font Awesome CSS | 0.54MB |
| JavaScript 합계 | 약 8.4MB |

계측된 Preview는 88개 resource를 만들었다. Mermaid나 Vega가 없는 문서에서도
Mermaid, WaveDrom, Vega runtime이 로드됐고, ZenUML 모듈을 jsDelivr에서 받는 외부
요청도 발생했다. 관측된 ZenUML 요청은 약 30~101ms였으며 네트워크 상태에 따라 더
큰 지연이나 편차를 만들 수 있다.

tiny 문서가 약 0.9초 걸리는 이유가 이것이다. 현재 bridge는 Crossnote runtime의
`webviewFinishLoading` 신호를 이용해 초기 `<template>` 내용을 설치하지만, 문서
조판 결과 자체는 워커에서 이미 만들어지고 sanitize까지 끝난 상태다. 도해가 없는
일반 문서에서 전체 runtime을 다시 부팅하는 것은 비용에 비해 얻는 기능이 작다.

### 2. KaTeX가 확장한 DOM의 layout 비용

동일한 본문에서 수식만 비활성화해 비교한 renderer 지표는 다음과 같다.

| 지표 | 수식 제거 문서 | `sample.md` | 배율 |
|---|---:|---:|---:|
| 전달된 Preview HTML | 104KB | 1.46MB | 14.0배 |
| DOM node | 1,437 | 51,123 | 35.6배 |
| Preview 자손 element | 470 | 35,656 | 75.9배 |
| layout object | 1,053 | 50,171 | 47.6배 |
| layout 시간 | 0.12초 | 0.53초 | 4.2배 |
| style 재계산 | 0.01초 | 0.36초 | 31.8배 |
| layout + style | 0.14초 | 0.89초 | 6.5배 |

`sample.md` Preview renderer에서 단일 CPU 비용으로 가장 크게 잡힌 것은 layout과
style recalculation의 합계 약 0.89초였다. CPU profiler의 가장 큰 샘플도 JS 함수가
아닌 브라우저의 `(program)` 영역에 모였으며, 이는 HTML parser, style, layout 같은
native browser 작업과 일치한다.

현재 워커는 수식 HTML을 Crossnote의 Cheerio 왕복 뒤로 미루고, 첫 HTML을
`<template>`에 넣어 중복 parsing도 피한다. 이 최적화는 유효하지만, 최종적으로
Chromium이 5만 개의 layout object를 한꺼번에 계산해야 한다는 사실은 바뀌지 않는다.

### 3. 조판 워커는 이미 critical path의 작은 부분이다

조판은 `src/main/render-worker.ts`의 `generateHTMLTemplateForPreview()`에서 수행된다.
Crossnote module 초기화에는 약 0.6초가 필요하지만, main은 BrowserWindow를 띄우기
전에 utility process를 fork하여 renderer 시작과 병렬화하고 있다.

그 결과 “조판 중” 이후 실제 관측된 worker/HTML 준비 구간은 `sample.md`에서도 약
0.27초였다. 이 구간을 절반으로 줄여도 절감되는 시간은 약 0.14초뿐이다. Preview
navigation을 그대로 둔 채 parser나 IPC부터 미세 최적화하는 것은 우선순위가 낮다.

## 개선 우선순위

### P0. 일반 문서용 lean Preview shell

가장 먼저 해야 할 개선이다.

현재 코드에는 이미 `requiresCrossnoteInstall(html)`이 있어 Mermaid, WaveDrom, Vega,
TikZ처럼 브라우저 초기화가 필요한 문서를 구분한다. 이 판단을 초기 HTML 설치
방법뿐 아니라 **페이지 template 선택**에도 사용해야 한다.

일반 문서는 다음 요소만 가진 작은 shell로 충분하다.

- 제품 preview bridge
- 현재 theme과 code theme CSS
- 필요한 경우에만 KaTeX와 Font Awesome CSS
- 이미 sanitize된 완성 HTML을 담은 `<template>`
- root background와 Preview 전용 보정 CSS

Mermaid 등의 client-rendered markup이 발견된 문서만 기존 Crossnote 전체 template을
사용한다. lean shell은 Crossnote `preview.js`가 보내던 준비 신호를 기다릴 수 없으므로,
bridge가 `DOMContentLoaded` 또는 inline bootstrap에서 직접 `installInitialHtml()`을
호출하도록 바꿔야 한다.

tiny 문서의 0.86초는 이 개선이 겨냥하는 고정 비용의 상한에 가깝다. 모든 시간이
사라지는 것은 아니지만, 일반 문서에서 약 0.7~1.0초를 줄일 가능성이 가장 크다.
외부 ZenUML 요청도 client-rendered 문서로 한정되어 startup 편차가 사라진다.

### P1. 첫 문서용 Preview shell 선행 부팅

현재 spare Preview는 첫 실제 Preview의 `loadURL()`이 완료된 뒤
`ensureSparePreview()`로 만든다. 따라서 두 번째 탭부터는 warm view의 이점을 받지만,
가장 중요한 첫 더블클릭 문서는 항상 전체 navigation을 지불한다.

첫 render 결과에서 warmup template을 파생하지 말고, build-time 또는 app-local 정적
lean shell을 두어 BrowserWindow와 동시에 숨은 `WebContentsView`에 로드해야 한다.
워커가 HTML을 완성했을 때는 navigation 대신 이미 준비된 shell에 DOM update만
보낸다.

이 방식은 고정 runtime 비용을 앱 shell 시작과 겹치게 한다. 다만 전체 Crossnote
runtime을 그대로 prewarm하면 Monaco 초기화와 CPU·I/O 경합이 생길 수 있으므로,
P0의 lean shell과 함께 구현하는 편이 안전하다.

### P2. 수식 문서의 첫 viewport를 우선하는 전략

lean shell 뒤에도 `sample.md`에는 약 0.89초의 layout/style 비용이 남는다. 다음
후보를 작은 실험으로 비교해야 한다.

1. 화면 밖 수식 블록의 KaTeX DOM 생성을 지연하고 첫 viewport를 먼저 표시한다.
2. source block 단위로 `content-visibility: auto`와 적절한 intrinsic size를 적용한다.
3. KaTeX의 출력 모드를 축소할 수 있는지 검토한다. HTML/MathML 중 하나를 제거하면
   DOM은 줄지만 접근성이나 렌더링 호환성이 나빠질 수 있다.
4. 긴 문서는 block 단위로 설치하되, 첫 화면과 목차에 필요한 heading을 먼저 넣는다.

Setdown의 source anchor와 semantic scroll은 전체 문서의 기하를 이용한다.
`content-visibility`나 점진 설치는 아직 layout하지 않은 블록의 높이 추정 오차를
만들 수 있으므로, 단순히 CSS 한 줄을 넣기보다 스크롤 위치 보정과 함께 설계해야 한다.

### P3. 읽기 모드에서 Monaco 지연 로드

이 항목은 “조판 중” 이후 1.76초를 직접 줄이지는 않지만, 더블클릭부터 Preview까지의
전체 시간을 줄인다. 현재 제품 renderer bundle은 약 4MB이고 읽기 모드로 시작해도
Monaco editor를 동기적으로 생성한 뒤 문서를 요청한다.

초기 surface가 Viewer라면 문서/Preview 요청을 먼저 시작하고, Monaco module과 model은
background에서 불러오거나 사용자가 편집기로 전환하기 전에 준비할 수 있다. 현재 약
0.99초인 프로세스 시작부터 shell 표시 구간과 worker/Preview 준비를 더 많이 겹칠 수
있다.

## 권장 구현 순서

```text
1. 일반 문서용 lean shell proof of concept
   └─ Crossnote 전체 template과 시각 결과 비교
   └─ Mermaid/Vega/WaveDrom/TikZ 문서는 기존 경로 유지

2. lean shell을 첫 BrowserWindow 생성과 동시에 prewarm
   └─ 첫 문서는 navigate 대신 update-html

3. sample.md의 KaTeX DOM/layout 최적화 실험
   └─ 접근성, scroll anchor, 검색, TOC 회귀 검증

4. Viewer-first 시작에서 Monaco lazy loading
```

parser나 IPC 최적화는 위 작업 뒤 다시 측정해 worker 구간이 실제 병목으로 올라왔을
때 수행하는 것이 합리적이다.

## 검증 기준

개선 구현은 같은 세 대조군으로 최소 10회, 실행 순서를 무작위로 섞어 median과 p95를
비교해야 한다. OS filesystem cache가 찬 경우와 찬 상태가 아닌 경우도 별도로 기록한다.

초기 목표는 다음처럼 잡을 수 있다. 이는 현재 측정에서 도출한 목표이며 아직 달성값은
아니다.

- 일반 작은 Markdown: “조판 중” 표시를 거의 보지 않거나 0.25초 이내
- `sample.md`: “조판 중” 이후 1초 미만
- Preview 시작 중 외부 네트워크 요청 0개
- TOC, 검색, theme, semantic scroll과 수식 접근성 유지
- client-rendered 도해 문서는 기존 결과와 동일

## 최종 판단

현재의 성능 문제는 계산량 하나가 큰 것이 아니라 첫 문서에서 이미 완성된 HTML을
보여 주기 위해 **범용 Crossnote 브라우저 환경 전체를 새로 부팅하고**, 이어서
**KaTeX가 확장한 5만 개의 layout object를 한 번에 배치하는 것**이다.

가장 큰 절감은 다음 두 경계를 바꿀 때 얻어진다.

1. 범용 Crossnote page가 필요한 문서와 정적 HTML만 필요한 문서를 나눈다.
2. 첫 Preview의 완료 조건을 전체 문서 layout이 아니라 첫 viewport의 유효한 표시로
   바꾼다.

따라서 첫 투자 지점은 `render-worker.ts`의 Markdown 계산을 더 빠르게 만드는 일이
아니라 `main.ts`의 첫 `WebContentsView.loadURL()` 경로를 lean, reusable,
viewport-first 구조로 바꾸는 일이다.
