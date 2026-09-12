# 독서 도구는 문서 위가 아니라 문서 곁에 있어야 한다

> 구현 과정에서 테마를 render identity로 취급하는 이 문서의 초기안보다 더 근본적인 해법을 적용했다. 최종 구조와 근거는 [후속 구현 보고서](./2026_09_12_17_27_preview_controls_and_theme_state_architecture.md)를 기준으로 한다.

## 렌더링 화면의 목차·검색·테마 구현 계획

2026년 9월 12일 16:30 KST

긴 문서에서 독자를 지치게 하는 것은 대개 문법이 아니다. 지금 어디를 읽고 있는지 잃어버리고, 방금 본 문장을 다시 찾지 못하며, 밝은 종이 같은 화면을 밤에도 견뎌야 하는 일이다. 목차, 검색, 테마는 그래서 장식 세 가지가 아니다. 모두 **문서 내용은 건드리지 않으면서 읽는 위치와 방식만 바꾸는 Viewer 상태**다.

Setdown에서는 이 구분이 특히 중요하다. 실제 문서는 별도 `WebContentsView` 안에서 Crossnote가 그리고, 탭과 버튼은 바깥 renderer가 소유한다. 이 경계를 무시해 Crossnote의 DOM 안에 제품 버튼을 하나씩 심으면, 매 렌더와 엔진 업데이트 때 제품 UI도 함께 흔들린다. 반대로 모든 일을 바깥에서 처리하려 들면 검색과 스크롤처럼 문서 안에서만 가능한 작업을 우회하게 된다.

권고안은 중간에 있다. **도구의 얼굴과 상태는 Setdown renderer가 소유하고, 문서 안에서 수행할 최소 동작만 Preview WebContents에 명령한다.** 검색은 Preview bridge가 실제 본문에 `Range`를 만들고 Chromium의 CSS Highlight API로 표시하며, 테마는 Crossnote가 이미 보유한 스타일을 선택한다. 목차 역시 렌더된 heading에서 안전한 색인만 받아 바깥 셸에 표시한다. 새 엔진은 필요 없다.

## 현재 구조가 이미 절반을 해 놓았다

현재 Preview는 iframe이 아니다. 탭마다 독립된 `WebContentsView`가 있고, main process가 `preview:create`, `preview:load`, `preview:show`, `preview:command`를 중계한다. `src/preview/preload.ts`는 격리된 페이지와 main 사이에 좁은 다리를 놓고, `src/preview/bridge.ts`는 이미 다음 일을 수행한다.

- 렌더된 요소의 source line을 색인한다.
- Viewer의 현재 위치를 host에 알린다.
- host 명령을 받아 특정 source line이나 scroll ratio로 이동한다.
- 더블 클릭 위치를 Monaco 좌표로 되돌린다.

이번 기능은 이 다리를 넓히면 된다. 별도의 프레임이나 두 번째 문서 파서는 필요하지 않다.

Crossnote 쪽에도 쓸 만한 자산이 이미 있다. `parseMD()`는 heading을 모아 sidebar TOC HTML을 만들고, webview에는 `SidebarToc` 컴포넌트와 접기 상태까지 들어 있다. 다만 Setdown은 zen mode로 topbar를 숨기며, 초기 `updateHtml` 메시지에는 `tocHTML: ''`을 보낸다. 따라서 지금 보이지 않는 목차를 억지로 클릭시키는 것은 좋지 않다. 그것은 Crossnote의 React 내부 상태에 제품 동작을 종속시킨다.

테마도 마찬가지다. 현재 main process는 Notebook을 만들 때 아래 세 값을 고정한다.

```ts
previewTheme: 'github-light.css',
codeBlockTheme: 'auto.css',
mathRenderingOption: 'KaTeX',
```

Crossnote vendor에는 `github-light`, `medium`, `newsprint`, `solarized-light`, `github-dark`, `night`, `one-dark`, `solarized-dark` 등을 포함한 preview theme가 이미 있으며, `auto.css`는 preview theme에 맞는 Prism 테마를 고른다. 테마를 새 CSS 덮어쓰기로 흉내 낼 이유가 없다. **Crossnote에 다른 허용된 설정을 주어 같은 문서를 다시 생성하는 것**이 표, 코드, 수식까지 일관되게 바꾸는 방법이다.

## 세 기능, 세 실행 장소

| 기능 | UI와 상태의 주인 | 실제 작업자 | 이유 |
|---|---|---|---|
| 목차 열기/닫기 | Setdown renderer | Preview bridge가 heading 색인·이동 | 제품 레이아웃은 셸이, 문서 좌표는 문서가 안다 |
| 검색 | Setdown renderer | Preview bridge와 CSS Highlight API | 실제 Preview만 검색하고 DOM 구조를 바꾸지 않는다 |
| Preview 테마 | Setdown renderer의 설정 | Crossnote render pipeline | 본문·코드·수식 색을 한 엔진에서 일치시킨다 |

이 배치는 원칙 이상의 실익이 있다. 검색 결과를 `<mark>`로 직접 감싸면 Crossnote가 만든 KaTeX, 링크, source anchor DOM을 변형하게 된다. CSS Highlight는 DOM wrapper 없이 `Range`만 칠하므로 다음 더블 클릭과 source mapping을 보존한다. 목차는 heading의 계층과 목적지를 알아야 하므로 같은 bridge가 읽는다. 테마는 DOM에 임의 stylesheet를 뒤늦게 덮으면 Prism의 `auto.css` 선택과 Crossnote의 색상 판정이 어긋난다. 처음부터 render identity의 일부여야 한다.

## 화면은 한 줄의 도구막대와 한 장의 선택적 목차면 충분하다

Viewer 안에는 고정된 도구막대를 둔다. 현재 tab strip의 편집 기능과 섞지 않는다. 표·링크는 Markdown을 바꾸는 Editor 명령이고, 목차·검색·테마는 Markdown을 바꾸지 않는 Viewer 명령이기 때문이다.

```text
┌────────────────────────────────────────────────────────────┐
│ 문서 탭                                      ✎ Viewer 전환 │
├────────────────────────────────────────────────────────────┤
│ ☰ 목차   🔍 문서에서 찾기                  테마: GitHub ▾ │
├───────────────┬────────────────────────────────────────────┤
│ 1. 서론       │                                            │
│   1.1 배경     │          Crossnote Preview                 │
│ 2. 설계       │          (WebContentsView)                 │
│   2.1 검색     │                                            │
│               │                                            │
└───────────────┴────────────────────────────────────────────┘
```

목차가 닫히면 왼쪽 칸은 완전히 사라지고 Preview bounds가 넓어진다. 열린 폭은 기본 260px, 최소 220px, 최대 화면의 40%로 제한하고 사용자가 조절한 값을 저장한다. 작은 창에서는 본문을 밀어내지 말고 overlay drawer로 바꾼다. 목차 항목은 heading level에 따라 들여쓰고, 현재 viewport를 대표하는 heading을 강조한다.

검색 버튼이나 Viewer에서 `Ctrl/Cmd+F`를 누르면 도구막대의 검색 입력이 열린다. `Enter`와 `Shift+Enter`는 다음·이전 결과로 이동하고 `Esc`는 검색만 닫으며 Viewer를 Editor로 전환하지 않는다. 입력 오른쪽에는 `3 / 17`, 이전, 다음, 닫기를 표시한다. 결과가 없으면 `0 / 0`을 보여 준다.

테마 메뉴는 파일명을 그대로 노출하지 않는다. 첫 출시는 다음처럼 검증된 소수로 시작하되 registry에 항목을 더하는 구조로 만든다.

| 표시 이름 | Crossnote preview theme | 성격 |
|---|---|---|
| GitHub Light | `github-light.css` | 기본, 중립적 |
| Paper | `newsprint.css` | 긴 글 읽기 |
| Medium | `medium.css` | 넉넉한 산문 조판 |
| Solarized Light | `solarized-light.css` | 낮은 대비의 밝은 화면 |
| GitHub Dark | `github-dark.css` | 중립적 어두운 화면 |
| Night | `night.css` | 야간 독서 |
| One Dark | `one-dark.css` | 코드 중심 문서 |
| Solarized Dark | `solarized-dark.css` | 낮은 대비의 어두운 화면 |

임의 CSS 경로나 문서 front matter가 앱 설정을 대신 선택하게 해서는 안 된다. theme id는 고정 allowlist를 통과한 뒤 Crossnote 파일명으로 매핑한다.

## 상태는 문서 revision과 보기 설정을 구분해야 한다

지금 Preview 준비 여부는 사실상 revision 하나로 판정된다. 테마가 생기면 같은 revision도 서로 다른 화면을 만들 수 있다. 따라서 render identity는 `(revision, themeId)`가 되어야 한다.

중요한 상태 모델은 다음과 같다.

```ts
type PreviewThemeId =
  | 'github-light'
  | 'paper'
  | 'medium'
  | 'solarized-light'
  | 'github-dark'
  | 'night'
  | 'one-dark'
  | 'solarized-dark';

type PreviewIdentity = {
  revision: number;
  themeId: PreviewThemeId;
};

type ReaderPreferences = {
  tocOpen: boolean;
  tocWidth: number;
  themeId: PreviewThemeId;
};

type PreviewFindState = {
  query: string;
  activeMatch: number;
  matchCount: number;
};
```

`ReaderPreferences`는 앱 차원의 읽기 취향으로 저장한다. 새 탭도 같은 테마와 목차 열림 상태를 따르는 편이 자연스럽다. 테마 변경 시 보이지 않는 모든 탭을 즉시 다시 그리지는 않는다. 활성 탭은 즉시 준비하고, 비활성 탭은 다음 활성화 때 새 theme identity로 lazy render한다.

검색어와 현재 결과 번호는 탭별 임시 상태다. 문서를 닫거나 앱을 다시 열었을 때 복구할 가치가 적고, 다른 문서로 검색어가 새어 가면 오히려 혼란스럽다. 목차 항목도 저장하지 않는다. 매 Preview load가 끝난 뒤 현재 DOM에서 다시 받는다.

<details>
<summary>권장 shared contract와 메시지 모양</summary>

```ts
type PreviewHeading = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  sourceLine?: number;
};

type PreviewCommand =
  | { command: 'marktex:collect-headings' }
  | { command: 'marktex:scroll-to-heading'; id: string }
  | { command: 'marktex:find'; query: string; direction: 'forward' | 'backward'; findNext: boolean }
  | { command: 'marktex:stop-find' };

type PreviewEvent =
  | { type: 'marktex:headings'; revision: number; headings: PreviewHeading[] }
  | { type: 'marktex:active-heading'; revision: number; id: string | null }
  | { type: 'marktex:find-result'; revision: number; activeMatch: number; matches: number };
```

Renderer와 Preview 사이의 payload는 양쪽 경계에서 다시 검사한다. `tabId` 소유권은 기존 preview IPC와 같은 방식으로 확인하고, theme id, query와 heading id에는 길이 제한을 둔다.

</details>

## 목차: 두 번째 Markdown 파서를 만들지 않는다

목차를 host에서 Markdown 원문으로 다시 만들면 Crossnote와 heading 규칙이 갈릴 수 있다. raw HTML heading, 강조가 든 제목, 중복 slug, 문서 포함과 Crossnote 확장 문법이 대표적인 함정이다. 이미 화면에 그려진 결과가 정답이므로 bridge는 `.markdown-preview[data-for="preview"]` 아래의 `h1`부터 `h6`까지 읽는다.

각 항목에서는 `id`, `textContent`, heading level, 가능한 경우 `data-source-line`을 추출한다. host는 HTML을 받지 않고 이 구조화된 문자열만 받아 자체 버튼을 만든다. 그 덕분에 Crossnote HTML을 shell에 다시 주입하지 않아도 되고, 목차가 별도 XSS 표면이 되지 않는다.

목차 클릭은 hash navigation에 맡기지 않는다. host가 `marktex:scroll-to-heading`을 보내면 bridge가 `document.getElementById(id)`로 대상을 찾고 `scrollIntoView()`한다. 이동 뒤에는 기존 `scheduleViewportState()`를 호출해 탭의 scroll ratio와 source anchor도 함께 갱신한다. 현재 heading은 모든 heading에 무거운 observer를 붙이기보다 scroll 시 viewport 상단 기준선을 마지막으로 지난 heading을 이진 탐색해 계산할 수 있다. heading 수가 적은 보통 문서에서는 선형 탐색도 충분하지만, 한 번 계산한 문서 좌표 배열을 기존 atlas처럼 재사용하는 편이 구조와 잘 맞는다.

렌더 직후 KaTeX, Mermaid, 이미지가 레이아웃을 늦게 바꿀 수 있다. heading 목록 자체는 변하지 않지만 좌표는 바뀐다. 따라서 항목 목록은 DOM 교체 뒤 한 번 보내고, active-heading 좌표 index는 기존 atlas와 함께 resize·load·mutation 때 stale 처리한다.

## 검색: 실제 본문의 Range만 칠한다

초기 계획은 `WebContentsView.webContents.findInPage()`를 쓰는 것이었다. 그러나 Electron 38의 실제 통합 시험에서는 호출이 Preview view까지 도착해도 `found-in-page` 결과 이벤트가 오지 않았다. 더 큰 문제는 Crossnote 페이지 안에 실제 Preview와 hidden preview가 함께 있어, 브라우저 전체 검색이 어느 DOM을 결과로 셀지 제품이 통제하기 어렵다는 점이다.

최종 구현은 bridge가 `.markdown-preview[data-for="preview"]`만 `TreeWalker`로 순회해 text node의 연속 offset을 만들고, query match를 DOM `Range`로 되돌린다. 모든 결과와 현재 결과는 CSS Custom Highlight API의 서로 다른 이름으로 표시한다.

```ts
registry.set('setdown-search-results', new Highlight(...ranges));
registry.set('setdown-search-active', new Highlight(ranges[activeIndex]));
```

이 방식은 `<mark>`나 span을 삽입하지 않는다. Crossnote DOM, KaTeX 출력, source anchor와 click handler가 그대로 남는다. 검색 명령과 `현재 / 전체` 결과는 기존 `preview:command`와 `preview:message` 다리로 왕복한다. `Enter`는 다음, `Shift+Enter`는 이전 Range를 고르고 화면 밖의 현재 결과만 중앙으로 스크롤한다. 빈 query와 검색 닫기는 named highlight를 registry에서 제거한다.

단축키는 여전히 두 프로세스에 걸친다. 포커스가 outer renderer에 있으면 renderer가 `Ctrl/Cmd+F`를 처리한다. 포커스가 Preview WebContents에 있으면 main이 그 view의 `before-input-event`를 받아 기본 동작을 막고 host에 `preview:open-find`를 알린다. Editor surface에서는 이 단축키를 가로채지 않아 Monaco의 찾기를 그대로 사용한다.

## 테마: 설정 변경도 하나의 render다

테마 전환은 Markdown revision을 올리지 않는다. 문서는 바뀌지 않았기 때문이다. 대신 `renderDocument()` 요청에 `themeId`를 추가하고, `PreviewRenderCoordinator`가 revision과 theme를 함께 비교하게 한다.

현재 `notebookCache`는 root 하나만 기준으로 Notebook을 재사용한다. 공유 Notebook의 `config.previewTheme`를 render 직전에 바꾸었다 되돌리는 방식은 금지한다. 서로 다른 탭이나 창의 비동기 render가 겹치면 한 문서에 다른 테마가 섞일 수 있다. 안전한 cache key는 다음과 같다.

```ts
type NotebookCacheKey = `${string}::${PreviewThemeId}`;

const notebookCaches = new Map<NotebookCacheKey, NotebookInstance>();
```

Notebook을 `(canonical root, themeId)`별로 지연 생성하고, 설정에는 allowlist가 돌려준 `previewTheme`과 기존 `codeBlockTheme: 'auto.css'`를 넣는다. 메모리가 걱정되면 최근 사용 key 4~6개만 남기는 LRU를 둔다. 첫 구현부터 CSS link를 갈아 끼우는 최적화는 하지 않는다. Crossnote의 theme와 Prism 자동 매핑, 본문 배경색 판정이 모두 config를 읽기 때문이다.

테마 전환 중에는 마지막 정상 Preview를 지우지 않는다. 새 identity가 조판되고 load될 때까지 기존 화면을 유지한 뒤, 현재 scroll ratio 또는 source anchor로 새 화면을 맞추고 교체한다. 검색창이 열려 있었다면 load 완료 후 같은 query를 새 webContents에 다시 실행한다. 목차는 새 DOM에서 다시 수집한다. 이 순서를 지키면 테마를 바꿨다는 이유로 독자가 문서 첫 줄로 떨어지지 않는다.

## 실제 변경 경로

핵심 작업은 새 거대 모듈 하나가 아니라 기존 경계를 조금씩 명확하게 만드는 일이다.

```text
src/
├── shared/
│   ├── contracts.ts                 # theme, heading, find IPC type
│   ├── preview-render-coordinator.ts# PreviewIdentity 비교
│   └── preview-preferences.ts       # allowlist와 기본값
├── renderer/
│   ├── main.ts                      # toolbar, per-tab find state, command
│   └── style.css                    # toolbar, sidebar, mobile drawer
├── preview/
│   ├── bridge.ts                    # heading 수집·이동·active heading
│   └── preload.ts                   # 기존 command/event 다리 유지
├── preload/
│   └── index.ts                     # find/theme 관련 제한 API
└── main/
    └── main.ts                      # Preview 단축키, theme-aware render/cache

test/
└── e2e/
    └── preview-reading-tools.spec.ts
```

<details>
<summary>파일별 세부 책임</summary>

- `src/renderer/main.ts`
  - Viewer toolbar와 TOC sidebar markup을 만든다.
  - `ReaderPreferences`를 읽고 저장한다.
  - 활성 탭의 heading 및 find state만 화면에 투영한다.
  - Preview bounds 계산에 toolbar 높이와 TOC 폭을 반영한다.
- `src/renderer/style.css`
  - 넓은 화면의 push sidebar와 좁은 화면의 overlay drawer를 나눈다.
  - 테마와 무관하게 읽을 수 있는 shell 색상 token을 사용한다.
  - search focus, active match count, active heading의 접근성 상태를 표시한다.
- `src/preview/bridge.ts`
  - Crossnote DOM을 소유하거나 수정하지 않는다.
  - heading metadata를 수집하고 heading id로 이동한다.
  - 기존 source atlas 무효화 흐름을 재사용한다.
- `src/main/main.ts`
  - Preview에 포커스가 있을 때 `Ctrl/Cmd+F`를 host 검색창으로 전달한다.
  - theme allowlist를 검증하고 theme-aware Notebook cache를 관리한다.
- `src/shared/preview-render-coordinator.ts`
  - 숫자 revision 대신 안정적으로 비교 가능한 identity key를 받는다.
  - 동일 identity는 single-flight하고, 오래된 theme 결과의 commit을 막는다.

</details>

## 구현 순서는 목차, 검색, 테마다

첫 단계에서는 Viewer toolbar와 상태 골격을 만든다. 이때 `syncPreviewView()`가 tab strip 아래 전체 영역이 아니라 Viewer toolbar와 선택적 sidebar를 제외한 사각형을 main에 보내도록 바꾼다. 레이아웃 경계가 먼저 안정돼야 나머지 기능의 위치가 흔들리지 않는다.

둘째로 목차를 붙인다. heading fixture에서 중복 제목, 강조가 든 제목, raw HTML heading, H1에서 H3으로 건너뛰는 경우를 확인한다. 목차 열기/닫기와 항목 이동이 기존 Viewer↔Editor anchor를 훼손하지 않는 것이 완료 조건이다.

셋째로 검색을 붙인다. 짧은 query의 빠른 교체, Enter/Shift+Enter, 한글과 결합 문자, 코드 블록, 링크를 시험한다. 검색을 닫은 뒤 모든 Chromium highlight가 사라지고 `Esc`가 Editor 전환으로 새지 않아야 한다.

마지막으로 테마를 render identity에 넣는다. 테마 변경은 render coordinator, cache, tab transfer까지 영향을 주므로 앞의 두 기능보다 범위가 넓다. 활성 탭은 현재 위치에서 교체되고, 비활성 탭은 lazy update되며, detach된 탭도 동일한 preference를 받아야 한다.

## 시험해야 할 것은 버튼보다 상태 전환이다

단위 테스트는 다음 계약을 고정한다.

- 허용되지 않은 theme id가 언제나 기본 테마로 거절되거나 정규화되는가.
- `(revision 7, github-light)`와 `(revision 7, night)`를 다른 Preview로 보는가.
- 같은 identity 요청은 하나의 render Promise를 공유하는가.
- 이전 theme render가 늦게 끝나도 최신 테마를 덮지 않는가.
- 빈 검색어가 모든 named highlight 제거로 귀결되는가.
- 다른 window가 소유한 `tabId`로 find 명령을 보낼 수 없는가.

E2E는 사용자의 독서 흐름을 검증한다.

1. 긴 fixture를 열고 중간까지 내린다.
2. 목차를 열어 현재 heading이 강조되는지 본다.
3. 다른 heading을 눌러 정확히 이동하고, 더블 클릭하면 대응하는 Monaco 근처로 가는지 본다.
4. Viewer에서 `Ctrl/Cmd+F`를 누르고 한글 검색어의 결과 수와 다음·이전 이동을 확인한다.
5. 검색창을 연 채 Night로 바꾸고 위치, query, match가 복원되는지 확인한다.
6. 다른 탭으로 갔다 돌아와 목차/검색 상태의 의도한 범위가 유지되는지 확인한다.
7. 탭을 새 창으로 떼었다 붙여도 theme와 Preview bounds가 어긋나지 않는지 확인한다.

성능 기준도 작게 잡을 수 있다. 목차 토글은 재렌더 없이 한 프레임 안에 bounds만 바뀌어야 한다. 검색 입력은 Markdown render를 호출해서는 안 된다. 테마만 전체 render를 허용하되, 그동안 마지막 정상 화면을 유지해야 한다.

## 하지 않을 일

첫 버전에서 다음은 범위 밖으로 둔다.

- 목차 항목 drag로 문서 heading 순서를 바꾸는 기능
- 정규식, 대소문자 구분, whole-word 검색 옵션
- 사용자가 임의 CSS 파일을 theme로 불러오는 기능
- 문서별 front matter로 앱 theme를 강제하는 기능
- Crossnote `SidebarToc`를 DOM click이나 Escape key 합성으로 원격 조작하는 방식
- 검색 결과를 직접 `<mark>`로 감싸는 DOM patch

이 기능들은 불가능해서가 아니라 세 기능의 본질을 흐리기 때문에 미룬다. 첫 릴리스의 목적은 Viewer를 작은 IDE로 만드는 것이 아니라, 긴 글을 잃지 않고 읽게 하는 것이다.

## 결론

세 기능에 각각 새 라이브러리를 붙일 필요는 없다. 이 코드베이스에는 이미 필요한 엔진이 있다. Crossnote는 heading과 테마를 알고, Chromium은 페이지 검색을 알고, Setdown은 탭과 읽기 상태를 안다. 좋은 구현은 이 셋 중 누구도 다른 둘의 일을 흉내 내지 않게 한다.

따라서 구현 원칙은 세 줄로 압축된다.

1. **목차는 렌더된 heading의 구조화된 색인만 bridge에서 받아 Setdown 셸에 그린다.**
2. **검색은 실제 Preview의 text Range만 CSS Highlight로 표시하고 DOM을 수정하지 않는다.**
3. **테마는 Crossnote 설정이자 Preview identity로 취급하며, 현재 위치를 보존한 채 다시 렌더한다.**

그렇게 하면 도구는 문서 위를 덮지 않는다. 필요할 때 곁에 나타나고, 사라질 때는 원문과 읽던 자리를 모두 그대로 둔다. ■
