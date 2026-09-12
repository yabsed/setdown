# Preview·Editor·프로그램을 하나로 묶는 테마 구조

2026년 9월 12일 18:38 KST

## 결론

가장 아름다운 방식은 Preview 테마의 CSS를 Monaco와 프로그램 셸에 억지로
복사하는 것이 아니다. **하나의 전역 `ThemeId`가 하나의 제품 테마 profile을
선택하고, Preview·Editor·App Shell이 그 profile을 자기 표현 방식으로 해석하게
하는 것**이다.

```text
                  main process
              ThemeState { id, revision }
                         │
               theme catalog/profile
              ┌──────────┼──────────┐
              ▼          ▼          ▼
       Crossnote adapter Monaco adapter Shell adapter
       CSS + Prism URL   defineTheme()  CSS variables
```

세 화면은 똑같은 CSS를 써야 하는 것이 아니라 같은 의도를 공유해야 한다. 예를
들어 `paper`는 Preview에서는 종이 질감과 serif 조판을 유지하되, Monaco에서는
읽기 어려운 serif를 쓰지 않고 따뜻한 밝은 배경과 낮은 대비의 경계색만 공유한다.
앱 셸도 문서 본문처럼 꾸미지 않고 종이를 받치는 중립적인 chrome으로 남는다.

따라서 메뉴 이름도 최종적으로 `Preview Theme`가 아니라 `Theme`가 맞다.

## 현재 간극의 정확한 원인

현재 `src/shared/preview-preferences.ts`의 registry는 사실상 Crossnote 자산
registry다. 각 항목이 Preview CSS 파일, Prism CSS 파일, 배경색만 고른다.

반면 Editor는 생성 시 다음 한 줄로 영구 고정된다.

```ts
theme: 'vs-dark'
```

프로그램 셸은 더 분산돼 있다. `src/renderer/style.css`에 tab, toolbar, dialog,
notice, TOC, search overlay의 색이 `#f7f7f5`, `#ecece8`, `#292927` 같은 literal로
직접 들어 있다. `BrowserWindow.backgroundColor`도 별도 상수다.

즉 현재 구조에는 세 테마가 있는 것이 아니다. **Crossnote만 테마 시스템이 있고,
Monaco와 앱 셸은 초기 디자인 스냅샷에 고정돼 있다.** Preview의 변경 이벤트를
두 곳에 더 보내는 것만으로는 해결되지 않는다. 받을 수 있는 공통 의미가 없기
때문이다.

## `PreviewThemeId`를 제품 `ThemeId`로 승격한다

전역 설정은 지금처럼 main process가 소유하되 이름과 책임을 넓힌다.

```ts
type ThemeId =
  | 'github-light'
  | 'paper'
  | 'medium'
  | 'solarized-light'
  | 'github-dark'
  | 'night'
  | 'one-dark'
  | 'solarized-dark';

type ThemeProfile = {
  id: ThemeId;
  label: string;
  appearance: 'light' | 'dark';
  preview: {
    stylesheet: string;
    prismStylesheet: string;
  };
  palette: ThemePalette;
  syntax: SyntaxPalette;
};
```

`ThemePalette`는 컴포넌트 이름이 아니라 의미로 구성한다.

```ts
type ThemePalette = {
  canvas: string;
  surface: string;
  raisedSurface: string;
  editorBackground: string;
  text: string;
  mutedText: string;
  border: string;
  hover: string;
  selected: string;
  accent: string;
  focusRing: string;
  warningSurface: string;
  warningText: string;
  shadow: string;
};
```

`tabBackground`, `searchBackground`처럼 현재 컴포넌트 이름으로 token을 만들면 새
컴포넌트마다 registry가 비대해진다. `surface`, `raisedSurface`, `border` 같은
역할을 정의해야 dialog와 검색창이 같은 설계 언어를 자연스럽게 공유한다.

Crossnote CSS에서 런타임으로 색을 긁어 palette를 자동 생성하는 방법은 권하지
않는다. 현재 vendor 테마는 CSS variable 계약이 없고, minified selector 안에
본문·인용문·표 색이 섞여 있다. 무엇이 앱 chrome의 border인지 기계적으로 결정할
수 없다. 8개 profile의 palette를 명시적으로 큐레이션하는 편이 작고 안전하며,
vendor 업데이트에도 흔들리지 않는다.

## 세 adapter의 역할

### Preview adapter

현재의 Crossnote Preview CSS와 Prism CSS 교체, source anchor 보존 방식을 그대로
사용한다. Preview는 문서 조판의 주체이므로 font family, 본문 폭, heading 간격까지
원래 테마를 충실히 따른다.

### Monaco adapter

각 profile에 대해 `setdown-${themeId}`라는 Monaco 테마를 한 번 등록한다.

```ts
monaco.editor.defineTheme(`setdown-${profile.id}`, {
  base: profile.appearance === 'dark' ? 'vs-dark' : 'vs',
  inherit: true,
  colors: toMonacoColors(profile.palette),
  rules: toMonacoTokenRules(profile.syntax),
});
```

테마 변경 시 model이나 editor를 다시 만들지 않고
`monaco.editor.setTheme()`만 호출한다. 그러면 cursor, selection, undo stack,
scroll position은 그대로 남는다. 배경, gutter, line number, selection,
find-match, cursor와 Markdown token 색은 profile에서 온다.

Prism CSS를 Monaco token rule로 파싱하지 않는다. 두 엔진의 token 이름과 우선순위가
다르기 때문이다. 대신 `SyntaxPalette`의 comment, keyword, string, number, link,
heading, code 값을 Prism 짝과 같은 색채군으로 큐레이션한다. “같은 엔진처럼 보임”은
CSS 복제가 아니라 같은 palette를 서로의 token 체계에 올바르게 번역한 결과여야 한다.

### App Shell adapter

하드코딩 색을 CSS custom property로 치환한다.

```css
:root {
  color-scheme: var(--setdown-color-scheme);
  --app-canvas: ...;
  --app-surface: ...;
  --app-raised-surface: ...;
  --app-text: ...;
  --app-muted-text: ...;
  --app-border: ...;
  --app-hover: ...;
  --app-selected: ...;
  --app-focus-ring: ...;
  --app-shadow: ...;
}
```

renderer는 profile 변경 시 `document.documentElement.dataset.theme`과 이 변수들을
한 번에 갱신한다. tab strip, TOC, 검색 overlay, dialog, 빈 화면과 notice는 모두
변수만 참조한다. `color-scheme`도 함께 바꿔 native form control과 scrollbar의
명암을 맞춘다.

main process는 같은 profile의 `canvas`를 `BrowserWindow.backgroundColor`에
적용한다. 향후 custom title bar를 쓰면 title bar overlay 색도 같은 adapter가
담당한다. 운영체제 전체의 `nativeTheme.themeSource`를 바꾸는 것은 범위가 너무
넓으므로 사용하지 않는다.

## 한 번의 선택을 일관되게 적용하는 프로토콜

전역 theme state는 `{ id, revision }`으로 둔다. main은 ID만 영속화하고 revision은
프로세스 안에서 단조 증가시킨다. 모든 창은 snapshot 조회와 change subscription을
사용하며, 자신이 이미 적용한 revision보다 오래된 메시지는 버린다. 그러면 새 창이
초기 snapshot을 읽는 순간 사용자가 다시 테마를 선택해도 이전 응답이 최신 선택을
덮지 않는다.

한 renderer 안에서는 다음 순서가 적절하다.

1. theme profile과 Preview 자산을 준비한다.
2. 현재 의미론적 Preview anchor를 보존한다.
3. 같은 animation frame에서 앱 CSS variable과 Monaco theme를 commit한다.
4. 각 Preview iframe에 이미 존재하는 stylesheet hot-swap을 실행한다.
5. Preview CSS load 후 source line과 viewport 비율을 복원한다.
6. 해당 revision의 적용 완료를 main에 알린다.

셸과 Monaco는 동기적으로 변하고 Preview stylesheet만 비동기다. 이를 숨기기 위해
전체 화면을 지우면 다시 흰 화면 문제가 생긴다. 기존 화면을 유지한 채 Preview만
자기 DOM 안에서 CSS를 교체하고, 늦게 끝난 이전 revision을 폐기하는 현재 방식이
맞다. 필요하면 다음 단계에서 새 stylesheet를 disabled 상태로 preload한 뒤 commit할
수 있지만, 먼저 실제 전환 시간을 측정하고 결정해야 한다.

## 처음 실행할 때부터 맞아야 한다

현재처럼 renderer가 기본 light 색으로 먼저 그려지고 IPC 뒤에 실제 테마를 받으면
시작 순간 짧은 flash가 생길 수 있다. 창을 `show:false`로 만드는 것만으로 상태
계약이 해결되지는 않는다.

main은 `createWindow()` 전에 theme snapshot을 이미 알고 있다. 이를 preload가
동기적으로 읽을 수 있는 작은 bootstrap 값으로 BrowserWindow에 전달하고, renderer는
앱 DOM과 Monaco를 만들기 전에 다음을 수행해야 한다.

```text
Theme bootstrap 적용
  → root dataset/CSS variables 설정
  → Monaco theme 등록
  → 앱 DOM 생성
  → 문서 및 Preview load
  → ready-to-show
```

그 뒤 IPC snapshot으로 revision을 확인한다. bootstrap은 첫 paint를 위한 사본이고,
main의 `ThemeState`가 계속 유일한 authority다.

## 테마별 권장 성격

| 제품 테마 | App Shell | Monaco base | 편집기 색채 방향 |
|---|---|---|---|
| GitHub Light | 차가운 중립 light | `vs` | GitHub 계열 syntax |
| Paper | 따뜻한 종이 light | `vs` | 낮은 채도, 따뜻한 gutter |
| Medium | 깨끗한 흰색 light | `vs` | 본문 대비를 방해하지 않는 절제된 색 |
| Solarized Light | Solarized base3 | `vs` | Solarized 공식 palette |
| GitHub Dark | 청회색 dark | `vs-dark` | GitHub Dark 계열 syntax |
| Night | 중립 회색 dark | `vs-dark` | Darcula 계열 syntax |
| One Dark | Atom 계열 dark | `vs-dark` | One Dark palette |
| Solarized Dark | Solarized base03 | `vs-dark` | Solarized 공식 palette |

여기서 중요한 것은 Preview의 font와 padding을 Monaco나 tab strip에 전파하지 않는
것이다. 전파 대상은 appearance, surface, text hierarchy, accent와 syntax palette다.
조판 역할까지 같게 만들면 통일감이 아니라 용도 혼동이 된다.

## 코드 경계 제안

```text
src/shared/theme-catalog.ts       ThemeId, profile, normalize, 순수 조회
src/main/theme-state.ts           영속화, revision, window broadcast
src/renderer/theme-controller.ts  snapshot 구독, adapter 조정
src/renderer/theme-shell.ts       CSS variable 적용
src/renderer/theme-monaco.ts      defineTheme/setTheme
src/preview/bridge.ts             Preview stylesheet 적용 및 anchor 복원
```

현재 `preview-preferences.ts`는 `theme-catalog.ts`로 흡수한다. main과 renderer가
별도 mapping을 갖지 않게 하고, 저장 파일에는 오직 theme ID만 둔다. Crossnote URL은
지금처럼 main이 안전한 resource URL로 변환해야 한다.

## 구현 순서

1. `ThemeProfile` registry를 만들고 기존 Preview mapping을 그대로 이관한다.
2. 앱 CSS의 literal을 semantic variable로 치환한다. 이 단계에서는 화면이 기존과
   동일해야 한다.
3. 8개 Monaco theme를 등록하고 editor 재생성 없이 전환한다.
4. 메뉴를 `Theme`으로 바꾸고 main의 versioned state를 모든 창에 연결한다.
5. 첫 paint bootstrap을 넣어 시작 시 잘못된 테마가 보이는 순간을 제거한다.
6. 마지막으로 전환 시간 측정 후 Preview stylesheet preload 필요성을 판단한다.

한 번에 모든 색을 손으로 바꾸기보다 현재 light shell을 GitHub Light profile의
golden master로 삼아 token화하고, dark profile 하나인 One Dark를 두 번째 vertical
slice로 완성한 뒤 나머지 profile을 채우는 편이 안전하다.

## 완료 조건

- 메뉴에서 고른 단 하나의 theme ID가 모든 창의 Preview, Monaco, 앱 셸에 적용된다.
- 새 창, 분리 창, 앱 재실행에서도 세 영역과 메뉴 check가 처음 paint부터 일치한다.
- 테마 변경이 editor model, undo stack, cursor, editor scroll을 초기화하지 않는다.
- Preview는 pixel Y가 아니라 source anchor를 보존한다.
- 검색 overlay, dialog, TOC와 tab strip에 이전 light-theme literal이 남지 않는다.
- 빠르게 테마를 연속 선택해도 가장 높은 revision만 최종 화면에 남는다.
- light/dark 각각에서 focus, selection, warning, disabled text가 접근 가능한 대비를
  가진다.
- PDF export는 앱 chrome theme와 분리하고 명시적인 export theme 정책을 따른다.

## 최종 판단

Preview 테마를 제품 전체의 주인으로 만들면 Crossnote vendor CSS가 앱 디자인까지
지배하게 된다. 반대로 앱 테마와 Preview 테마를 계속 별도로 두면 사용자가 한 번
선택했는데 세 화면이 갈라지는 현재 문제가 반복된다.

해답은 **선택의 주인은 하나, 표현 adapter는 셋**이다. `ThemeId`와 semantic
palette는 Setdown이 소유하고, Crossnote와 Monaco는 각각 문서 조판 엔진과 코드 편집
엔진으로서 그 선택을 번역한다. 이것이 엔진의 전문성을 보존하면서도 한 제품처럼
보이게 만드는 가장 작은 구조다.

## 구현 결과

이 설계를 실제 코드에 적용했다.

- `src/shared/theme-catalog.ts`를 단일 catalog로 만들고 8개 제품 테마의 Preview,
  Shell semantic palette, Monaco syntax palette를 한 profile에 묶었다.
- main process가 `{ id, revision }` snapshot의 유일한 authority가 되었다. 변경 시 모든
  창으로 같은 snapshot을 broadcast하며, 새 창에는 `additionalArguments`로 초기
  snapshot을 전달한다.
- preload가 초기 snapshot을 동기적으로 노출하므로 renderer는 DOM과 Monaco를 만들기
  전에 Shell과 Editor 테마를 적용한다. 재실행이나 새 창에서 기본 테마가 잠깐 보이는
  flash가 발생하지 않는다.
- renderer의 세 adapter가 같은 snapshot을 소비한다. 비동기 Preview asset 적용은
  revision을 다시 검사하여 빠른 연속 선택에서 오래된 응답이 최신 테마를 덮지 못한다.
- Monaco는 editor/model을 재생성하지 않고 등록된 `setdown-*` theme만 교체한다. undo,
  cursor, selection과 scroll state가 유지된다.
- tab strip, TOC, 검색 overlay, dialog, form을 포함한 앱 chrome의 하드코딩 색을 semantic
  CSS variable로 치환했다.

검증 결과 `npm test`의 63개 단위·통합 테스트, `npm run build`, Electron Playwright의
4개 E2E 테스트가 모두 통과했다. E2E는 현재 창, 새 창, 앱 재실행에서 Night 테마의
Shell·Monaco·Preview 및 메뉴 상태가 함께 유지되는 경로를 검사한다.
