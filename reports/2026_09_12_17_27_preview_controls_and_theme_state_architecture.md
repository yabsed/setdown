# Preview 도구의 위치와 문서 상태를 분리한 이유

> 후속 검증에서 `WebContentsView`의 합성 경계 자체가 흰 틈의 원인임을 확인했다.
> 이 문서의 bounds 보정안은 [iframe 합성 구조 보고서](./2026_09_12_18_20_preview_iframe_compositing_architecture.md)로 대체됐다.

## 목차·검색·테마 지연 제거 구현 보고서

2026년 9월 12일 17:27 KST

이번 문제는 버튼 몇 개의 위치나 애니메이션 속도 문제가 아니었다. Setdown의 화면은 바깥 renderer가 탭과 제품 UI를 그리고, 각 문서는 별도의 `WebContentsView`가 Crossnote 결과를 표시한다. UI 상태, 문서 내용, 표현 스타일을 같은 종류의 상태로 취급하면서 다음 현상이 생겼다.

- 목차를 닫은 뒤 바깥 DOM은 먼저 넓어졌지만 native Preview bounds는 다음 animation frame까지 이전 폭을 유지했다.
- `Ctrl/Cmd+F`가 Preview에서 시작하면 검색창을 가진 renderer가 focus를 소유하지 않았다.
- 테마를 바꿀 때 Markdown을 다시 렌더하고 Preview URL을 다시 load해 DOM과 문서별 scroll 위치를 버렸다.
- 비활성 탭은 새 테마를 준비하지 않고, 사용자가 탭을 연 시점에야 다시 렌더했다.

해결 원칙은 각 상태의 소유권을 분리하는 것이다.

| 상태 | 소유자 | 변경 시 하지 않는 일 |
|---|---|---|
| 목차 열림과 제품 레이아웃 | 바깥 renderer | 문서 재렌더·다음 frame 대기 |
| 검색어와 검색 UI | 탭별 renderer 상태 | Crossnote DOM wrapper 삽입 |
| 본문 검색 Range | 해당 Preview bridge | 원문 또는 Preview navigation 변경 |
| Preview 테마 | 전역 독서 환경설정 + 각 Preview stylesheet | Markdown parse·URL reload |
| 읽던 위치 | 각 Preview WebContents | 테마 변경 때문에 초기화 |

## 도구 배치

목차는 문서를 읽는 동안 자주 여닫는 직접 조작이므로 표·링크 아이콘과 같은 tab action 영역으로 옮겼다. 다만 표·링크는 Editor에서만, 목차는 Viewer에서만 나타난다. 검색 버튼과 테마 선택기는 화면에서 제거했다.

- 검색은 View 메뉴의 `Find in Preview`와 `Ctrl/Cmd+F`로 연다.
- 테마는 View 메뉴의 `Preview Theme` 하위 메뉴에서 고른다.
- 검색 입력줄은 검색 중일 때만 나타난다. 닫혀 있을 때 빈 toolbar 공간도 남기지 않는다.

이 배치는 명령의 발견 가능성을 메뉴에 남기면서, 항상 보이는 화면에는 즉시 조작할 이유가 있는 목차만 둔다.

## 목차 지연의 원인과 제거

이전 순서는 다음과 같았다.

```text
click
  → aside.hidden 변경
  → requestAnimationFrame 예약
  → 현재 frame에는 이전 WebContentsView bounds 유지
  → 다음 frame에 새 bounds 전송
```

`WebContentsView`는 renderer DOM의 자식이 아니므로 CSS flex 변경만으로 크기가 바뀌지 않는다. main process에 숫자 bounds를 다시 보내야 한다. 이전 구현은 이 동기화를 의도적으로 다음 frame에 미뤘고, 사용자는 그 한 frame 이상 동안 넓어진 셸 위에 이전 크기의 native view가 남아 있는 것을 지연으로 보았다.

수정 후에는 `hidden` 변경 직후 `syncPreviewView()`를 호출한다. 그 함수의 `getBoundingClientRect()`가 필요한 layout을 그 자리에서 확정하고 같은 event task 안에 새 bounds를 main으로 보낸다.

```text
click
  → aside.hidden 변경
  → layout 확정 및 새 rect 측정
  → 같은 frame에 WebContentsView bounds 전송
```

CSS transition으로 증상을 가리지 않았다. 서로 다른 합성 표면인 DOM과 `WebContentsView`의 geometry commit 시점을 하나로 맞췄다.

## 검색 focus의 경계

검색 버튼을 없앤 뒤 단축키가 유일한 빠른 진입점이므로 focus 보장은 기능의 일부다. 단축키는 두 위치에서 시작할 수 있다.

1. 바깥 renderer에 focus가 있으면 renderer의 capture key handler가 검색을 연다.
2. Preview `WebContentsView`에 focus가 있으면 main process의 `before-input-event`가 기본 Chromium 찾기를 막는다. 이어서 owner window의 renderer에 focus를 넘기고 `preview:open-find`를 보낸다.

renderer는 검색줄을 먼저 layout에 포함시키고 native Preview bounds를 즉시 줄인 다음, 입력 요소에 `focus({ preventScroll: true })`와 `select()`를 적용한다. 같은 task 끝에 focus를 한 번 재확인해 Chromium의 view 간 focus 이관과 경합해도 입력 커서가 검색창에 남게 했다. Editor에서는 이 단축키를 가로채지 않으므로 Monaco 검색이 계속 동작한다.

## 테마의 본질: 문서가 아니라 스타일 자산

초기 구현은 테마를 `(revision, themeId)`라는 render identity로 취급했다. 안전하지만 테마가 바뀔 때 Crossnote render와 Preview navigation을 다시 수행했다. 이 모델에서는 문서 1을 바꾼 뒤 문서 2를 열 때 lazy render가 발생하고, navigation 때문에 문서 2의 DOM 및 scroll 위치가 사라지는 것이 필연적이다.

테마는 Markdown 의미 구조를 바꾸지 않는다. heading, 링크, KaTeX 결과, source mapping도 그대로다. 바뀌어야 하는 것은 Crossnote preview theme CSS와 코드용 Prism CSS뿐이다. 그래서 최종 구현은 다음 흐름을 사용한다.

```text
View > Preview Theme 선택
  → shared allowlist로 theme id 정규화
  → main이 Crossnote preview CSS와 Prism CSS의 안전한 marktex-resource URL 생성
  → 현재 창의 모든 탭 Preview에 marktex:apply-theme broadcast
  → 각 Preview bridge가 두 link[rel=stylesheet]의 href만 교체
  → DOM, URL, 검색 Range, heading index, scroll 위치 유지
```

경로는 renderer가 조합하지 않는다. main process가 고정된 Crossnote 설치 디렉터리와 allowlist 매핑으로만 URL을 만든다. 예를 들어 Paper는 `newsprint.css`와 `pen-paper-coffee.css`, Night는 `night.css`와 `darcula.css`를 짝지어 본문과 코드가 함께 바뀐다. 임의 로컬 CSS를 읽는 통로는 만들지 않았다.

모든 열린 탭에 즉시 명령을 보내므로 탭 클릭은 테마 적용의 trigger가 아니다. 탭 전환은 이미 존재하는 각 `WebContentsView`를 다시 보이게 할 뿐이며 render, load, 위치 복원 단계가 없다. 테마 변경과 Preview 최초 load가 겹치는 경우에는 load 완료 직후 현재 전역 테마를 다시 동기화해 navigation 중 유실된 명령도 보완한다.

스타일시트 적용 자체가 글꼴·행간·여백과 문서 높이를 바꾸므로 pixel `scrollTop`을 보존해서는 안 된다. bridge는 교체 직전 golden viewport 지점에 있는 source anchor를 잡고, 두 CSS의 load와 layout이 끝난 뒤 같은 source line을 같은 viewport 비율에 두 번 확정한다. 빠른 연속 테마 선택에는 generation 번호를 사용해 늦게 끝난 이전 CSS 요청이 최신 선택이나 위치를 덮지 못하게 했다.

후속 resize 검증에서는 `WebContentsView`가 DOM flex item이 아니라 별도 native surface라는 합성 경계도 반영했다. 창이 커질 때 renderer의 `ResizeObserver → IPC`보다 native window가 먼저 커지면 기본 흰 배경이 드러날 수 있다. main process가 window resize 이벤트에서 보이는 Preview의 오른쪽·아래 edge를 새 content bounds까지 먼저 확장하고, renderer가 이후 정확한 목차·검색 geometry를 확정한다. 또한 BrowserWindow, WebContentsView, 바깥 Preview 셸이 allowlist에 기록된 동일한 테마 배경색을 공유한다. 목차 토글처럼 새로 노출되는 native 영역도 흰색 대신 현재 문서 배경으로 이어진다.

## 변경된 코드 경계

- `src/main/main.ts`: View 메뉴 명령, Preview focus 이관, allowlist 기반 테마 자산 URL 제공
- `src/preload/index.ts`, `src/shared/contracts.ts`: 제한된 테마 자산 IPC와 View 명령 계약
- `src/shared/preview-preferences.ts`: Preview/Prism 테마 쌍의 단일 registry
- `src/renderer/main.ts`: 목차 action 이동, 검색 focus와 즉시 bounds commit, 전체 탭 테마 broadcast
- `src/preview/bridge.ts`: navigation 없는 stylesheet hot swap과 scroll 보존
- `src/renderer/style.css`: 검색할 때만 존재하는 toolbar와 surface별 action 노출
- `test/e2e/preview-reading-tools.spec.ts`: 버튼 제거, 검색 focus, 두 문서 eager theme, URL·scroll 불변 검증

## 검증

다음 검증을 통과했다.

- Vitest: 10개 파일, 61개 테스트
- TypeScript `tsc --noEmit`
- production renderer 및 Electron bundle build
- Electron E2E 읽기 도구 시나리오
  - 목차가 tab action 영역에만 노출됨
  - 검색 및 테마 화면 버튼이 없음
  - `Ctrl+F` 직후 검색 input이 focus를 가짐
  - 검색 Range와 결과 수가 유지됨
  - 열린 문서 두 개가 탭 클릭 전에 모두 Night 테마를 적용함
  - 테마 적용 전후 두 Preview URL이 같고, 실제로 읽던 source anchor가 같은 viewport 위치에 남음
  - 창 확장 뒤 native Preview의 오른쪽·아래 edge가 content bounds와 맞고, BrowserWindow와 셸 배경이 Night 배경색을 공유함
  - 테마 적용 뒤 다른 탭을 열어도 추가 render/navigation이 없음

결론적으로 지연을 각각 보정한 것이 아니라, **레이아웃은 renderer가 같은 frame에 commit하고, focus는 WebContents 경계를 명시적으로 넘기며, 테마는 문서 lifecycle과 분리된 표현 상태로 모든 Preview에 eager 적용한다**는 구조로 바꿨다.
