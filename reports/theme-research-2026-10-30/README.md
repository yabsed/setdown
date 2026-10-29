# 터미널 가독성과 8개 웹 테마 적용 연구

2026-10-30 · Setdown 소스와 Dark Reader 공개 소스를 검토하고, 격리된 실제 Electron에서 색상 변환을 실험했다.

**두 기능 모두 구현할 수 있다.** 터미널에는 테마별 ANSI 팔레트와 xterm의 최소 명암비 보정을 함께 적용하는 것이 적합하다. 웹에는 Dark Reader의 Dynamic Theme 엔진을 기존 ThemeProfile에 연결하는 것이 적합하다. 다만 웹의 모든 색을 앱 팔레트와 정확히 일치시키거나 모든 사이트를 자동으로 올바르게 변환한다고 보장할 수는 없다. 실제 실험에서도 테마 재적용 캐시, 외부 CSS, CSSOM 변경 추적 문제가 확인됐다.

이번 변경은 공식 서브모듈 추가, 연구 스크립트, 결과와 설계 기록이다. 제품의 터미널/웹 런타임에는 아직 적용하지 않았다. 브라우저 확장을 설치하거나 기존 사용자 설정을 변경한 것도 아니다.

## 1. 추가한 서브모듈

- 경로: [`vendor/darkreader`](../../vendor/darkreader)
- 원본: <https://github.com/darkreader/darkreader.git>
- 고정 커밋: `84f5db666b7bfb53d3520f9d6b233b1f2b644674`
- 해당 소스의 package.json 버전: `4.9.134`. 출시 태그를 체크아웃한 것은 아니다.
- 라이선스 파일: [`LICENSE`](../../vendor/darkreader/LICENSE). 향후 배포 번들에는 upstream 저작권/라이선스 고지를 포함한다.
- 재현: `git submodule update --init vendor/darkreader`

서브모듈은 원본 그대로 유지했다. 제품 npm 의존성이나 lockfile은 바꾸지 않았다. 실험은 기존 esbuild로 공개 API 진입점을 번들링하고, upstream API 빌드와 같은 기능 플래그를 사용했다. Plus 기능은 비활성이고 upstream의 공개 stub 경로를 사용한다. 확장 전체를 빌드하거나 Chrome 확장 호환성을 인증한 실험은 아니다.

## 2. 터미널에서 글자가 가려지는 이유

[`TerminalSurface.svelte`](../../apps/desktop/src/renderer/terminal/TerminalSurface.svelte)의 `theme()`는 배경·기본 글자·커서·선택 배경만 설정한다. `black`부터 `brightWhite`까지 ANSI 16색은 지정하지 않는다. `minimumContrastRatio`도 지정하지 않아 설치된 xterm 6.0.0의 기본값 `1`을 사용한다.

Oh My Zsh/Powerlevel10k 등의 프롬프트는 자체 ANSI 출력으로 색을 지정한다. 따라서 앱의 기본 글자색을 진하게 바꿔도 `brightWhite`, 256색 노랑, 직접 지정한 RGB 글자에는 적용되지 않는다. 밝은 배경 위에 어두운 터미널을 전제로 한 프롬프트 색이 남을 수 있다. 이 구조는 OS에 관계없이 존재한다.

Windows의 실제 사용자 셸/프롬프트는 이번에 재현하지 않았다. 현재 [`TerminalManager`](../../apps/desktop/src/main/terminal/terminal-manager.ts)는 Windows에서 `powershell.exe -NoLogo`를 실행한다. WSL 안의 zsh인지, PowerShell 프롬프트인지에 따라 추가 조정은 달라진다. 아래는 **앱의 같은 xterm 렌더러에서 ANSI 출력을 직접 넣어 확인한 원인과 보정 효과**다.

### 실측: Solarized Light

배경 `#fdf6e3`, 일반 텍스트 샘플의 실제 계산 스타일을 측정했다. 색 이름을 기본 글자색으로 강제 덮어쓰지 않고 xterm의 보정 옵션만 켰다.

| 출력 | 현재 설정(1) 명암비 | `minimumContrastRatio: 4.5` 명암비 |
| --- | ---: | ---: |
| ANSI bright white | 1.08:1 | 4.66:1 |
| ANSI bright yellow | 1.15:1 | 4.90:1 |
| ANSI bright cyan | 1.48:1 | 5.07:1 |
| ANSI blue | 5.49:1 | 5.49:1 |
| 256색 yellow (229) | 1.04:1 | 5.02:1 |
| RGB near-white | 1.01:1 | 5.17:1 |
| 서로 가까운 RGB 글자/명시적 RGB 배경 | 1.01:1 | 4.93:1 |

8개 테마 × 보정 전후 2설정 = 16케이스를 실행했다. 각 케이스는 일반 글자 8샘플과 dim/Powerline 예외 샘플을 포함한다. 보정한 일반 글자 64샘플 모두 4.5:1 이상이었다. Powerline 구분자 `U+E0B0`는 원래 색을 유지했고, dim은 xterm의 별도 낮은 명암비 정책을 따랐다. 그러므로 “어떤 글리프든 전부 4.5:1”이라고 설명해서는 안 된다. 반투명 글자는 배경과 합성한 값으로 계산한다.

[보정 전 화면](results/terminal-solarized-light-1.png) · [보정 후 화면](results/terminal-solarized-light-4.5.png)

### 권장 구현

1. ThemeProfile에 터미널 전용 ANSI 16색을 정의한다. 기존 syntax 팔레트는 토큰 역할이 달라 그대로 16색에 대입하지 않는다. 밝은/어두운 테마에서 빨강·초록 등의 구분을 유지하고, ANSI 색이 배경으로도 쓰인다는 점을 반영한다.
2. 기본값은 `minimumContrastRatio: 4.5`를 검토한다. 16색 팔레트만으로 해결하지 못하는 256색/truecolor와 명시적 배경 조합을 렌더러가 보정하게 한다. xterm 자체 기능을 사용하므로 PTY 바이트를 재작성할 필요가 없다. [공식 옵션 설명](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#minimumcontrastratio)
3. `cursorAccent`, `selectionForeground`까지 함께 정해 커서 아래/선택 영역도 점검한다. 테마 변경 시 기존 Terminal의 옵션만 변경하고 PTY, 입력 내용, 스크롤백을 유지한다.
4. 원색 보존이 필요한 색상 도구/ANSI 아트용으로 보정 해제 옵션을 고려한다. 항상 어두운 터미널을 원하는 사용자에게는 앱 테마와 별도로 터미널 테마를 고정하는 선택지도 유용하다.

최초 제품 수정은 명암비 보정과 검증된 16색 팔레트에 집중하는 편이 좋다. 환경변수만으로 프롬프트가 모든 색을 다시 선택할 것으로 기대하거나, 테마 변경 때 셸을 재시작하는 설계는 필요하지 않다. 실제 Powerlevel10k, PowerShell/Oh My Posh, WSL, Vim, 선택/커서/역상/Powerline을 제품 회귀 검사에 포함해야 한다.

## 3. Dark Reader에서 가져올 핵심 아이디어

페이지 전체에 단일 반전 필터를 거는 방식보다 **CSS의 역할에 따라 색을 변환하는 Dynamic Theme**가 이번 목적에 맞는다. 공식 [Dynamic Theme 소개](https://darkreader.org/blog/dynamic-theme/)는 색과 배경 이미지 분석을 설명한다. 구체적인 현재 동작은 다음 소스를 기준으로 조사했다.

| 소스 | 의미 |
| --- | --- |
| [`modify-colors.ts`](../../vendor/darkreader/src/inject/dynamic-theme/modify-colors.ts) | 배경·글자·테두리에 다른 HSL 변환을 적용한다. 중성색을 목표 배경/글자 색조로 옮기고 채도가 있는 색은 원래 색상 구분을 상당 부분 유지한다. |
| [`modify-css.ts`](../../vendor/darkreader/src/inject/dynamic-theme/modify-css.ts) | CSS 속성 역할, 그림자, 그라데이션, SVG fill/stroke, 배경 이미지를 처리한다. 마스크 이미지는 글자색처럼 다루는 등 예외가 있다. |
| [`variables.ts`](../../vendor/darkreader/src/inject/dynamic-theme/variables.ts) | CSS 변수의 사용처가 배경인지 글자인지 추적한다. 같은 변수도 역할에 맞는 변환이 필요하다. |
| [`style-manager.ts`](../../vendor/darkreader/src/inject/dynamic-theme/style-manager.ts), [`inline-style.ts`](../../vendor/darkreader/src/inject/dynamic-theme/inline-style.ts) | 원본 스타일 옆에 변환 스타일을 만들고 인라인 스타일도 추적한다. 외부 stylesheet를 읽지 못하면 별도 fetch가 필요하다. |
| [`stylesheet-proxy.ts`](../../vendor/darkreader/src/inject/dynamic-theme/stylesheet-proxy.ts), [`watch/`](../../vendor/darkreader/src/inject/dynamic-theme/watch) | DOM/CSSOM 변경, Shadow DOM/구성 stylesheet 등의 변화를 관찰한다. 단순 DOM MutationObserver만으로는 충분하지 않다. |
| [`image.ts`](../../vendor/darkreader/src/inject/dynamic-theme/image.ts) | 밝기·투명도·크기 등을 분석해 이미지 처리 결정을 지원한다. 사진/로고/차트가 언제나 원본 그대로 유지된다는 보장은 아니다. |
| [`dynamic-theme-fixes.config`](../../vendor/darkreader/src/config/dynamic-theme-fixes.config) | 사이트별 CSS, 반전 대상, 인라인/이미지 분석 제외 등이 실제 호환성의 중요한 부분이다. |
| [`src/api/index.ts`](../../vendor/darkreader/src/api/index.ts) | 공개 `enable`, `disable`, `setFetchMethod` 등. API는 Dynamic Theme만 지원하며 `enable(options, fixes)`에는 하나의 선택된 fix를 전달한다. |

엔진을 직접 처음부터 다시 만드는 것보다 공개 엔진을 고정 버전으로 통합하고, 우리 팔레트/페이지 수명주기/설정/자원 로딩을 연결하는 편이 타당하다. 확장 전체를 설치하는 방식도 비교 대상이지만, 8개 앱 테마와 단일 설정을 공유하려면 API 엔진 방식이 더 직접적이다. 확장 호스트에서는 동작한다고 가정하지 말고 별도 검증해야 한다.

## 4. 현재 8개 ThemeProfile의 매핑

[`theme-catalog.ts`](../../apps/desktop/src/core/theme/theme-catalog.ts)를 유일한 색상 원본으로 삼는다. 웹 문서 배경에는 `palette.surface`, 기본 글자에는 `palette.text`를 사용했다. One Dark의 터미널/에디터 배경 `#282c34`와 웹/리더 표면 `#272b33`은 의도적으로 구분된다.

| 테마 | mode | 웹 배경 | 기본 글자 |
| --- | ---: | --- | --- |
| GitHub Light | 0 | `#ffffff` | `#242424` |
| Paper | 0 | `#f3f2ee` | `#2d2520` |
| Medium | 0 | `#ffffff` | `#202123` |
| Solarized Light | 0 | `#fdf6e3` | `#586e75` |
| GitHub Dark | 1 | `#24292e` | `#cdd9e5` |
| Night | 1 | `#363b40` | `#dedede` |
| One Dark | 1 | `#272b33` | `#abb2bf` |
| Solarized Dark | 1 | `#002b36` | `#93a1a1` |

API 옵션 매핑은 아래와 같다. 이는 설계 예시이며 제품 코드에 추가하지 않았다.

```ts
const options = {
  mode: profile.appearance === 'dark' ? 1 : 0,
  darkSchemeBackgroundColor: profile.palette.surface,
  darkSchemeTextColor: profile.palette.text,
  lightSchemeBackgroundColor: profile.palette.surface,
  lightSchemeTextColor: profile.palette.text,
  brightness: 100,
  contrast: 100,
  sepia: 0,
  grayscale: 0,
  useFont: false,
};
```

이 방식은 색감의 통일이다. Paper의 문서 레이아웃이나 Medium의 타이포그래피를 모든 웹사이트에 이식하는 것은 별도 범위다. GitHub Light/Medium처럼 기본 색이 비슷한 테마는 웹에서도 비슷해질 수 있다. 사이트의 레이아웃·폰트·콘텐츠 의미를 보존하는 것이 초기 목표에 맞다.

공개 옵션에는 “모든 링크를 앱 accent로”라는 일반 매핑이 없다. 실제 Solarized Light 링크는 `#3c9eff`로 바뀌었고 앱 accent `#268bd2`와 달랐다. 이 링크의 배경 대비 명암비는 **2.59:1**이었다. 기본 `contrast: 100` 역시 모든 글자/배경 조합에 최소 명암비를 보장하는 옵션이 아니다. 링크·상태색까지 정확히 맞추려면 역할별 추가 규칙과 별도의 명암비 검증이 필요하다. 모든 링크/빨강/초록을 같은 accent로 덮어쓰면 방문 상태, 오류·성공, 브랜드 색을 손상할 수 있다.

## 5. 실제 Electron 실험 결과와 발견한 제한

실행 환경: Linux, Electron `44.7.2`, Chromium `152.0.7977.149`, 실제 화면 렌더링, sandbox/contextIsolation 활성, nodeIntegration 비활성. Xvfb, private runtime, private D-Bus를 사용하고 사용자 Wayland 소켓을 상속하지 않았다. 로컬 서버와 임시 프로필을 사용했다.

### 통과한 범위

- 공개 API를 sandbox preload에 번들링해 8개 팔레트를 같은 문서에 차례로 적용했다. 아래에서 설명하는 `disable()` → `enable()` 정리를 사용했다.
- 흰 배경/검정 본문 fixture의 최종 계산 색이 각 ThemeProfile의 배경/글자와 정확히 일치했다.
- 적용 후 추가된 인라인 스타일 요소도 목표 색으로 바뀌었다. CSS 변수 기반 카드, 링크, SVG가 포함된 화면과 계산 스타일도 기록했다.
- 입력값, 활성 input, 문서 식별자가 유지됐다. `window.DarkReader` API는 페이지의 main world에 노출되지 않았다.
- 해제 시 원래 흰 배경/검정 본문과 입력값이 복원되고 `.darkreader` 스타일 요소가 제거됐다.
- 터미널 16케이스 및 위의 일반 글자 명암비 검사를 통과했다.

입력에 한글 문자열을 넣어 보존을 확인했지만 **네이티브 IME 조합 테스트는 아니다.** 실제 Setdown의 WebContentsView, 다중 프레임, 창 이동, 숨김/복원, 확장 동시 실행을 검증한 것도 아니다. 고정 대기 후 최종 상태를 관찰했으므로 첫 페인트 깜빡임이나 전환 지연 수치를 주장할 수 없다.

### 실제로 확인한 제한

1. **단순 재호출 시 이전 팔레트 잔존.** `enable(GitHubLight)` 다음 `enable(Paper)`를 호출했을 때 흰 배경이 그대로 남았다. 목표는 `rgb(243,242,238)`였다. 최초 실패의 [JSON](bare-update-failure.json)과 [로그](bare-update-failure.log)를 보존했다. 최종 probe도 이 호출을 먼저 실행해 `naiveUpdate`에 기록한다. 소스에서는 `prevTheme && prevFixes` 조건으로 팔레트 갱신/초기화 경로에 진입하는데 API 기본 fixes는 null이다. 초기 통합 후보는 같은 호출 안에서 `disable()` 후 `enable()`하는 방식이며, 그 재분석 비용과 깜빡임을 별도로 측정해야 한다. 빈 fixes 객체만 주면 충분하다고 결론 내리지 않았다.
2. **Light mode는 dark 사이트의 자동 반전이 아니다.** 원래 `#111` 배경/`#eee` 본문인 fixture에 Solarized Light를 적용하면 배경은 `rgb(96,120,127)`, 본문은 `rgb(252,241,210)`이 됐다. 밝은 테마의 목표 배경 `#fdf6e3`가 되지 않았다. 사이트 자체 light 모드와 협력하거나 해당 사이트를 원본/예외로 처리해야 한다.
3. **CORS 없는 외부 CSS 누락.** `127.0.0.1` 문서에서 `localhost` CSS를 로드했다. 브라우저는 원본 스타일을 표시했지만 엔진의 fetch는 이를 읽어 변환하지 못해 흰 영역이 남았다. `setFetchMethod(window.fetch)`만으로 해결되지 않는다.
4. **CSP와 CSSOM 변경.** `script-src 'self'`인 페이지에서 inline stylesheet proxy 삽입이 차단됐다는 콘솔 오류를 기록했다. 이 fixture에서는 `insertRule`에 의한 규칙 개수 변경은 대체 관찰 경로로 반영됐다. 반면 기존 규칙의 `style.setProperty()`만 변경한 경우에는 CSP 유무와 관계없이 변환 스타일이 갱신되지 않았다. upstream의 일반 stylesheet 관찰과 adopted stylesheet 선언 관찰 범위 차이를 구분해야 한다.
5. **이미지/복잡한 웹 앱은 아직 미검증.** 사진, 투명 로고, 대형 배경 이미지, Canvas/WebGL 차트, closed shadow root, 인증 iframe, Google/ChatGPT/YouTube 실제 사이트는 이번 성공 범위에 포함되지 않는다. SVG 하나의 fill이 유지된 결과를 모든 이미지 보존의 증거로 사용하지 않는다.

따라서 “API 한 번 호출하면 8개 테마가 모든 사이트에 완벽히 적용된다”는 구현 계획은 부정확하다. **테마 적용의 기본 기능은 확인했고, 범용 브라우저 수준의 호환성 작업은 남아 있다.**

## 6. Setdown에 연결할 구조

현재 [`ThemeManager`](../../apps/desktop/src/main/theme/theme-manager.ts)는 shell과 preview에 테마를 전달한다. 일반 웹 페이지는 별도 BrowserManager/session/프레임을 가지며, shell의 CSS 변수가 자동으로 전달되지 않는다. 스크린샷처럼 앱 메뉴만 Solarized이고 Google 페이지는 흰색인 현상은 이 구조로 설명된다.

권장 흐름은 `ThemeManager의 snapshot → BrowserManager의 소유 페이지/프레임 → 전용 웹 테마 런타임 → Dark Reader API`다.

| 위치 | 맡을 일 |
| --- | --- |
| `core/theme/theme-catalog.ts`와 새 순수 매퍼 | ThemeProfile → 웹 API 옵션 / 터미널 팔레트. 엔진의 DOM 코드를 core에 가져오지 않는다. |
| `main/theme/theme-manager.ts` | 기존 revision을 포함한 테마 변경을 웹 coordinator에도 전달한다. |
| `main/browser/browser-manager.ts`와 웹 테마 coordinator | 페이지/프레임 소유권, navigation 세대, 현재 theme revision, 사이트별 설정, 생성/이동/닫힘 수명주기. |
| `browser-runtime`의 테마 런타임 | 신뢰된 테마 옵션으로 적용/해제, 중복 설치 방지, cleanup, 현재 문서 상태 응답. 페이지에 desktop API를 노출하지 않는다. |
| 기존 browser 빌드 단계 | 고정 엔진을 로컬 자산으로 번들링하고 라이선스 포함. shell/Markdown preview의 초기 번들에는 넣지 않는다. |

기존 session frame preload와 committed-frame 알림을 활용하되, top frame뿐 아니라 늦게 생기는 iframe/탐색 후 frame에 현재 revision을 전달해야 한다. 이전 URL의 비동기 fetch/테마 완료가 새 문서에 적용되지 않아야 한다. `chrome-extension:`, 앱 내부 문서, Markdown/Git preview, PDF/HWP, extension popup 등 적용 대상이 아닌 surface는 분리한다.

Dark Reader API는 `chrome.runtime` shim도 설치하므로, 기존 확장 preload와 같은 JavaScript world에서 공존 가능한지 확인해야 한다. 별도의 isolated world 사용이나 좁은 adapter를 검토한다. main-world CSSOM proxy가 필요해도 renderer에 Node 권한을 주거나 사이트 CSP 전체를 완화하는 방식으로 해결하지 않는다.

외부 CSS/이미지 fetch는 별도의 핵심 작업이다. 브라우저 세션의 cookie/proxy/인증 맥락을 지키면서, 현재 소유 프레임에 필요한 HTTP(S) 자원만 처리하는 제한된 경로가 필요하다. 응답 크기·종류·리다이렉트·취소와 페이지 수명주기를 검증해야 한다. 원격 페이지가 임의 파일이나 인증 응답을 읽는 범용 IPC가 되어서는 안 된다. 확장의 background fetch를 그대로 복사해도 앱의 권한 모델이 자동으로 맞아지는 것은 아니다.

공개 API는 확장의 전체 사이트 fix 목록을 자동으로 선택/적용하지 않는다. 공개 fix 설정을 사용할 경우 번들에 포함하고 URL별로 선택·조합하는 adapter가 필요하다. 앱의 작은 추가 fix 목록도 upstream과 분리해 관리하는 편이 업데이트에 유리하다.

설정은 **웹 페이지: 앱 테마 따르기 / 원본**, 그리고 **이 사이트에서는 원본 유지** 정도로 시작하는 것이 적당하다. OS 다크 모드에 연결되는 `auto()` 대신 앱이 선택한 ThemeProfile을 명시적으로 전달한다. 이미 설치된 Dark Reader나 사이트 자체 테마와 중복 적용되지 않도록 우선순위를 정한다. 초기 배경색도 테마에 맞추되 숨은 페이지를 강제로 표시하거나 포커스해서 준비시키지 않는다.

## 7. 구현 순서와 검증 기준

1. 터미널의 ANSI 16색과 4.5 명암비 보정, 선택/커서/역상/256색/RGB/Powerline을 제품 경로에서 검증한다. Windows PowerShell/WSL의 실제 프롬프트도 확인한다.
2. 웹 API adapter를 로컬 자산으로 묶고, 8개 테마/원본 복원/사이트 예외/새 문서 revision을 연결한다. 첫 공개 범위는 일반 HTML/CSS 사이트로 명시한다.
3. 외부 CSS, CSSOM, iframe, Shadow DOM, 사이트 fix, 기존 확장 공존을 추가 검증한다. 실패 사이트는 원본으로 돌아갈 수 있어야 한다.
4. 실제 Setdown에서 폼·스크롤·로그인 상태·페이지 identity·Korean IME를 유지하고, 숨긴 페이지의 복원/닫기/다중 창 이동에 리스너와 스타일이 중복되지 않는지 확인한다.
5. 첫 페인트, 테마 완료 시간, 큰 DOM의 스타일 재계산, 장시간 스크롤 CPU와 메모리를 측정한다. 숨은 view에서 rAF가 멈추는 조건을 따로 다룬다. `immediateModify`를 무조건 켜 성능 문제를 옮기지 않는다.

제품의 테마/CSS/프레젠테이션 경로를 수정할 때는 [preview performance contract](../../docs/preview-performance-contract.md)에 따라 `npm run test:preview-contract`와 분리된 설치 baseline의 `npm run bench:preview -- --baseline /absolute/path`를 수행해야 한다. 일반 Markdown/Git review, 수정 유무, 준비 시간 유무의 첫째·둘째·warm cycle을 각각 보고한다. 이 연구용 fixture의 성공은 그 회귀 검사를 대체하지 않는다.

## 8. 재현 및 검증 기록

저장소 루트에서 실행한다. 이미 설치된 workspace의 Electron, Playwright, esbuild, xterm을 사용한다.

```sh
bash apps/desktop/scripts/with-isolated-display.sh \
  node reports/theme-research-2026-10-30/probe.mjs /tmp/setdown-theme-research-results
```

- [연구 스크립트](probe.mjs), [최종 실행 로그](probe.log.txt), [전체 수치/버전/제한 사례](results/results.json).
- [Solarized Light 웹 화면](results/web-solarized-light.png), [One Dark 웹 화면](results/web-one-dark.png). 나머지 6개 테마도 `results/`에 저장했다.
- [이미 어두운 사이트의 밝은 모드 결과](results/limitation-dark.png), [외부 CSS 누락 화면](results/limitation-foreign.png).
- 타입 검사: tsc 두 구성 및 svelte-check **0 errors, 0 warnings**. 렌더러 빌드 완료.
- 최초 `npm run build`의 Electron 빌드 단계는 기존 uBlock의 `git rev-parse`를 spawn하는 과정에서 sandbox `EPERM`으로 종료됐다. [원본 로그](build-sandbox.log.txt).
- 해당 단계 `npm run build:electron --workspace @setdown/desktop`를 권한이 허용된 환경에서 따로 실행해 종료 코드 0으로 완료했다. [로그](build-electron.log.txt). 최초 전체 명령 자체가 성공했다고 기록하지 않는다.
- 최초 GUI 실행은 sandbox가 D-Bus 소켓 bind를 막아 시작하지 못했다. 권한이 허용된 환경에서도 workspace별 Electron 경로 및 상속된 `ELECTRON_RUN_AS_NODE`를 바로잡은 뒤 실행했다. 사용자 desktop으로 fallback하지 않았다.
- 제품 소스/스타일/의존성과 preview 성능 경로를 수정하지 않아 이번 연구에서는 preview contract 전체 및 baseline latency benchmark를 실행하지 않았다. 사용자 Windows 증상에 대한 수정 완료나 제품 출시 검증으로 간주하지 않는다.
