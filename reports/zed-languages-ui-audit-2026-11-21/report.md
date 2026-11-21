# Zed를 통해 지원하는 언어: 실제 저장소로 본 UI 동작

작성일: 2026-11-21 · 감사 보고서 · 기준 `508d564`와 그 위의 커밋하지 않은 수정 · 사용자 설정(`~/.config/Setdown`)은 건드리지 않았다. 감사용 프로필을 따로 썼다.

같은 날의 [언어 도구를 사람에게 보여 주는 체계](../language-ui-design-2026-11-21/report.md)는 Rust, Go, C로 화면을 점검했다. 이 보고서는 Setdown이 직접 지원하지 않고 Zed에서 가져온 카탈로그로만 지원하는 언어를 다룬다. 이 언어들은 실제 저장소로 끝까지 열어 본 적이 없었다.

## 결론

**도구가 될 때의 화면은 직접 지원하는 언어와 같은 수준이다. 도구가 안 될 때의 화면은 원인을 말하지 못하거나 틀리게 말했다. 그 부분을 고쳤다.**

1. **28개 언어를 실제 GitHub 저장소 27곳의 파일로, 실제 앱에서 열었다.** 결과는 아래와 같다.

   | 결과 | 수 | 언어 |
   | --- | --- | --- |
   | 버튼 한 번(또는 이미 있는 도구)으로 호버·이동·자동완성까지 됨 | 13 | Lua, TOML, Shell, Perl, LaTeX, Terraform, Typst, Protobuf, XML, Haskell, Astro, Zig, Gleam |
   | 되지만 프로젝트 준비가 없어 일부만 됨 | 1 | OCaml |
   | 도구의 질문에 답해야 됨 | 1 | Clojure |
   | "Working"이라 하지만 묻는 것마다 답이 없음 | 1 | Vue |
   | 이 컴퓨터에 없는 것 때문에 안 됨 | 8 | Ruby, R, Swift, Dart, Elixir, Nix, Julia, Scala |
   | Setdown이 설치할 방법이 없음 | 2 | C#, CMake |
   | 도구가 아예 없음 | 1 | Makefile |
   | 범위 밖(읽기 화면으로 열림) | 1 | Markdown |

2. **안 되는 8개의 원인은 모두 "이 컴퓨터에 무엇이 없다"였다. 화면은 그것을 말하지 못했다.** Swift는 이유 없이 "can't start"였고, R은 오류의 마지막 줄인 "실행이 정지되었습니다"만 보였고, Scala는 내려받은 적이 없는데 "Couldn't download"였다. 다시 해도 결과가 같은데 버튼은 [Try again]뿐이었다. 일곱 개는 이제 없는 것의 이름을 말하고 그에 맞는 버튼을 준다(3.5절). Ruby만 도구의 오류 문장 그대로 남았다(4.4절).
3. **될 때에도 결함이 다섯 있었다.** 설치를 누르고 6초가 지나면, 내려받는 동안(길게는 30초) "No project checks are active"라고 말했다. 열지 않은 파일의 참조는 코드 줄 대신 `job_spec.lua:137:12`로 나왔다. 질문을 던진 도구(Clojure)는 20초마다 죽었다 살아나기를 끝없이 되풀이했다. 우클릭 메뉴 아래에 호버가 다시 떴다. Problems 목록은 경로가 길면 파일 이름이 잘렸다. 모두 고쳤다(3절).
4. **고치지 않은 것 중 큰 것은 넷이다.** Vue 도구는 살아 있지만 답하지 않는데 화면은 "Working"이다. 이미 설치한 도구도 다시 시작할 때 네트워크 요청이 실패하면 시작하지 못한다(Protobuf에서 한 번 봤다). Language Support 화면의 "Ready"와 "Needs attention"은 이번 실행에서 본 것만으로 만들어져, 시작하지 못하는 도구가 Ready에 있고 설치할 수 없는 도구가 Needs attention에 없다. 도구마다 다른 선행 조건(R 패키지, lein, `dune build`)을 안내할 자리가 없다(4절).
5. **따로 요청받은 웹 탭의 지구본 아이콘도 고쳤다**(5절).

수정은 커밋하지 않았다. 설치해 쓰는 앱에는 `npm run install:linux`를 해야 반영된다.

전체 시험(`npm run test:preview-contract`)은 통과하지 못했다. 실제 앱 시험 409개 중 2개가 실패했다. 하나는 수정 전 소스에서도 실패하던 것이다. 다른 하나는 컴퓨터가 바쁠 때 5초 제한을 넘는 시험으로 보지만, 이번 수정 탓이 아니라고 증명하지는 못했다(6절).

## 1. 조사한 것과 방법

### 1.1 대상

Setdown이 직접 지원하는 언어(`supportedLanguages`: Python, JavaScript/TypeScript, Svelte, C/C++, Rust, Go, PHP, Java, Kotlin, JSON, YAML, Dockerfile, Docker Compose, CSS, HTML) 밖의 언어다. 이 언어들은 Zed에서 가져온 카탈로그가 언어 이름·문법·도구를 정하고, Zed 확장(wasm)이 도구를 내려받는다. 내려받은 도구는 **Setdown 자체의 LSP 클라이언트**(`LanguageManager`, `ServerSession`)가 실행한다. Zed의 프로젝트 엔진으로 가는 도구는 여섯 개뿐이다(gopls, json-lsp, yaml-language-server, dockerfile-language-server, css-lsp, html-lsp). 그래서 이 감사에서 본 화면은 거의 모두 자체 클라이언트의 화면이다.

### 1.2 방법

| 항목 | 내용 |
| --- | --- |
| 앱 | 빌드한 실제 Electron 앱. 가상 화면(`with-isolated-display.sh`)에서만 띄웠다 |
| 프로필 | 감사용 새 프로필. 도구는 하나도 설치되지 않은 상태에서 시작 |
| 입력 | 언어마다 실제 GitHub 저장소 하나, 고정한 커밋의 실제 파일 하나(부록 A) |
| 환경 | 시험 프로그램의 환경을 그대로 물려줌(`SETDOWN_LSP_INHERIT_ENV=1`). 실제 실행은 로그인 셸에 환경을 묻는다 |
| 한 번에 | 언어 하나씩, 메모리 5.5 GiB 제한 안에서 |

언어마다 사람이 하는 순서대로 열세 장면을 기록했다: 파일을 연 직후, 언어 칩의 패널, [Install … support]를 누른 뒤 1초 간격의 상태, 준비된 뒤의 패널·상세·로그·Problems, 방향키 지연, 호버, 우클릭 메뉴, 자동완성, F1, F12, Language Support 화면. 기록은 [notes/](notes/), 시험 프로그램은 [audit-spec.ts.txt](audit-spec.ts.txt)다.

세 번 돌렸다.

- **1차(first):** 새 프로필에서 처음 여는 경험. 앞의 12개 언어는 수정 전 빌드, 뒤의 16개는 "시작 알림"(3.1절)만 고친 빌드다.
- **2차(second):** 같은 프로필로 다시 여는 경험. 모든 수정이 들어간 빌드다. 수정이 실제 앱에서 되는지도 여기서 확인했다.
- **엔진 비교(engine):** `SETDOWN_LANGUAGE_ENGINE=zed`로 모든 도구를 Zed 프로젝트 엔진에 맡겼을 때. Vue, Lua, Ruby, TOML만 봤다.

### 1.3 한계

- 한 컴퓨터(Fedora 45)의 결과다. Ruby, R, Swift 같은 결과는 이 컴퓨터에 무엇이 깔려 있는지에 달려 있다. 그래서 "언어 X는 안 된다"가 아니라 "X가 없을 때 화면이 무엇을 말하는가"를 봤다.
- 언어마다 파일 하나, 자리 하나다. 도구의 기능을 넓게 시험한 것이 아니다.
- 설치 시간은 네트워크에 달려 있다. 한 번 잰 값이다.
- 사용자 프로필이 아니라 새 프로필이다.

## 2. 언어별 결과

"준비까지"는 [Install … support]를 누른 때부터 "✓ Working"까지다. "다시 열 때"는 2차에서 앱을 띄운 때부터 준비될 때까지다. 방향키 한 번의 처리 시간은 모든 언어에서 1~3 ms였다.

| 언어(칩의 이름) | 도구 | 처음: 준비까지 | 다시 열 때 | 호버 | F12 | 우클릭 메뉴의 언어 항목 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lua | lua-language-server 3.19.2 | 13.8초 | 열자마자 | 됨 | `functional.lua:52` | 정의, 형식 정의, 참조, 이름 바꾸기 | 진단 다수(`Undefined global vim` 등) |
| TOML | taplo | 7.8초 | 열자마자 | 그 자리에는 없음 | 없음(조용함) | 이름 바꾸기 | 서식, 심볼 |
| Shell | bash-language-server | 7.8초 | 열자마자 | 됨 | `install.sh:21` | 정의, 참조, 이름 바꾸기 | |
| Perl | perlnavigator | 6.2초 | 열자마자 | 됨 | `Home.pm:1` | 정의 | |
| LaTeX | texlab 5.26.0 | 15.3초 | 5.8초 | 그 자리에는 없음 | `awesome-cv.cls:289` | 정의, 참조, 이름 바꾸기 | |
| HashiCorp HCL (`.tf`) | terraform-ls | 16.9초 | 열자마자 | 됨 | `variables.tf:234` | 정의, 참조 | "Waiting for analysis results"가 남음(4.5절) |
| Typst | tinymist | 62.2초(내려받기 48초) | 8.9초 | 됨 | `lib.typ:3` | 정의, 참조 | |
| Protocol Buffer 3 | buf (buf-lsp 1.75.0) | 36.4초 | 42초. 한 번은 실패(4.2절) | 진단의 설명 | 없음(조용함) | 참조, 이름 바꾸기, 리팩터 | import를 찾지 못한다는 진단 |
| XML | lemminx | 15.4초 | 열자마자 | 됨(Maven 스키마 설명) | 없음(조용함) | 정의, 형식 정의, 참조, 이름 바꾸기 | |
| Haskell | haskell-language-server (이 컴퓨터의 ghcup) | 묻지 않고 시작, 12초 | 열자마자 | 됨 | `Extra.hs:29` | 정의, 참조, 호출자, 피호출자, 이름 바꾸기 | |
| Astro | astro-language-server | 16.9초 | 열자마자 | 됨 | `resolveDefaultOgImagePath.ts:24` | 정의, 참조, 이름 바꾸기 | |
| Zig | zls 0.17.0 | 22.9초 | 열자마자 | 됨 | `router.zig:1` | 정의, 참조, 이름 바꾸기 | 칩 "Zig · Notice": `zig`가 없다는 도구의 말 |
| Gleam | gleam | 13.9초 | 열자마자 | 됨 | `order.gleam:4` | 정의, 참조, 이름 바꾸기 | |
| OCaml | ocaml-lsp 1.26.0 (이 컴퓨터의 opam) | 묻지 않고 시작 | 열자마자 | 됨 | "No definition found" | 없음 | `dune build`를 하지 않아 모듈을 찾지 못함 |
| Clojure | clojure-lsp | 30초 뒤 질문 | 열자마자 질문 | 답하기 전에는 없음 | 없음 | 없음 | Ignore를 고르면 곧바로 "✓ Working"(3.3절) |
| Vue | vue-language-server 3.3.14 | 18.4초 | 열자마자 "Working" | "Loading..."에서 멈춤 | 반응 없음 | "Asking Vue…"뿐 | 4.1절 |
| Ruby | ruby-lsp 0.26.11 | 42초 뒤 실패 | 47초 뒤 같은 실패 | | | | gem `rbs`를 찾지 못함(4.4절) |
| R | r_language_server | 14초 뒤 실패 | 같은 실패 | | | | R 패키지 `languageserver` 없음 |
| Swift | sourcekit-lsp | 15초 뒤 실패 | 곧바로 "isn't installed" | | | | 3.5절 |
| Dart | dart | 14초 뒤 실패 | 곧바로 "needs Dart" | | | | 3.5절 |
| Elixir | elixir-ls 0.31.1 | 15초 뒤 실패 | 곧바로 "needs Elixir" | | | | 3.5절 |
| Nix | nil | 5초 뒤 실패 | 곧바로 "isn't installed" | | | | 3.5절 |
| Julia | jetls | 6초 뒤 실패 | 곧바로 "needs Julia" | | | | 3.5절 |
| Scala | metals | 5초 뒤 실패 | 곧바로 "isn't installed" | | | | 3.5절 |
| C# | roslyn-language-server | 설치 버튼 없음 | | | | | "Setdown can't install it by itself." |
| CMake | neocmakelsp | 설치 버튼 없음 | | | | | 같음 |
| Makefile | 없음 | | | | | | "Syntax highlighting and editing support are available." |
| Markdown | | | | | | | 읽기 화면으로 열린다. 코드 편집기가 아니라 범위 밖 |

읽는 법 몇 가지.

- **"열자마자"**는 앱을 띄운 뒤 첫 기록(4.6초)에 이미 준비돼 있었다는 뜻이다. 한 번 설치한 도구는 다시 묻지 않고 시작한다.
- **Haskell과 OCaml은 묻지 않고 시작했다.** 이 컴퓨터에 이미 있는 도구였기 때문이다. 묻는 것은 내려받기뿐이다.
- **메뉴와 F1은 도구가 답하는 것만 보였다.** Perl 도구는 참조와 이름 바꾸기를 하지 않고, 메뉴에도 정의만 있었다. 도구가 없거나 시작하지 못한 언어의 메뉴는 Copy, Paste, All Commands…뿐이었다. 메뉴와 F1에 관한 한 관측 원칙은 28개 언어 전부에서 지켜졌다.
- **"없음(조용함)"**은 그 자리에 정의가 없을 때 F12가 아무 말도 하지 않았다는 뜻이다. OCaml과 Terraform은 "No definition found for '…'"라고 말했다. 도구가 정의 기능을 알렸는지에 따라 갈린다.

## 3. 고친 것

### 3.1 설치를 누른 뒤 "아무것도 이 파일을 검사하지 않는다"고 말했다

- **전:** [Install Lua support]를 누르면 0.1초 뒤 "Starting…"이 떴다가 6.2초에 "No project checks are active for this document."로 바뀌었다. 칩에는 아무 표시도 없었다. 그 문장이 Typst에서는 누른 지 12초, Protobuf에서는 36초가 될 때까지 남았다. 확장을 불러오고 도구를 찾는 동안 문서가 아무 소식도 듣지 못했기 때문이다.
- **후:** 누르고 0.2초 안에 "Starting…"과 도는 고리가 뜨고, "Setting up … support… Downloading…"을 거쳐 "✓ Working"이 된다. Vue, Astro, Zig, Gleam의 1차 기록에서 확인했다.
- **코드:** `language-manager.ts`의 `open()`이 도구를 찾기 전에 `starting`을 알린다.
- **시험:** `language-manager.test.ts`의 두 시험. 수정을 빼면 첫 시험이 실패한다.

### 3.2 열지 않은 파일의 참조와 정의 링크

- **전:** Lua의 `Job:sync`에서 Shift+F12를 누르면 참조 31개 중 다른 파일의 것은 `job_spec.lua:137:12` 같은 위치로만 나왔다. 그 줄을 골라도 옆의 미리보기는 처음 파일에 머물렀다. 그사이 화면 뒤에서 "Model not found" 오류가 30번 났다. Ctrl을 누른 채 이름 위에 포인터를 올려도 링크 밑줄이 생기지 않았다. 원인은 Monaco가 열려 있는 문서의 모델만 알고, 다른 파일을 달라는 요청에 답할 곳이 없었던 것이다.
- **후:** 다른 파일의 참조도 그 줄의 코드로 나오고, 고르면 미리보기가 그 파일을 보여 준다. 파일은 열리지 않는다(탭이 늘지 않는다). Ctrl을 누르면 이름이 링크가 된다. 오류는 0번이다. 참조 목록의 글꼴도 16px 시스템 글꼴에서 앱 글꼴 12px로 맞췄다.
- **코드:** `file-previews.ts`(읽은 파일을 보는 사람 수만큼만 붙잡는다), `monaco-file-models.ts`(Monaco의 모델 요청에 답한다), `builtin-diagnostics.ts`(미리보기 모델은 검사하지 않는다).
- **시험:** `file-previews.test.ts`, e2e "a reference in a file that is not open is listed by its line of code…".
- **증거:** [notes/focus-lua-before.txt](notes/focus-lua-before.txt), [notes/focus-lua-after.txt](notes/focus-lua-after.txt), [images/lua-references-before.png](images/lua-references-before.png), [images/lua-references-after.png](images/lua-references-after.png).

### 3.3 질문을 던진 도구를 20초마다 죽였다

- **전:** clojure-lsp는 시작하면서 "lein을 실행할 수 없다. Retry / Ignore?"를 묻고 답을 기다린다. Setdown은 `initialize`의 답이 20초 안에 오지 않으면 도구가 멈췄다고 보고 죽였다. 그래서 화면은 "Needs answer" → "Reconnecting… Attempt 1 of 3" → "Needs answer"를 되풀이했고, 5분 뒤에도 "Attempt 3 of 3"이었다. 재시도 횟수는 "1분 안의 실패"로 셌는데, 한 번 실패하는 데 20초가 넘게 걸리니 셋을 채우지 못했다.
- **후:** 질문이 열려 있는 동안에는 어떤 요청도 시간 초과가 되지 않는다. 질문은 그대로 있고, [Answer…]를 누르면 Retry / Ignore / Dismiss가 나오며, Ignore를 누르면 곧바로 "✓ Working"이 된다. 재시도는 "마지막 재연결로부터 3분 안의 실패"를 이어서 세므로, 느리게 실패하는 도구도 세 번 뒤에는 멈춘다.
- **코드:** `server-session.ts`의 `request()`, `language-supervisor.ts`.
- **시험:** `server-session.test.ts` "a tool that waits for the person's answer has not stopped answering…", `language-supervisor.test.ts`의 두 시험. 둘 다 수정 전 코드에서는 실패한다.
- **증거:** [notes/clojure-first.txt](notes/clojure-first.txt), [notes/focus-clojure-after.txt](notes/focus-clojure-after.txt), [images/clojure-question.png](images/clojure-question.png).

### 3.4 우클릭 메뉴 아래에 호버가 다시 떴다

- **전:** 이름 위에 포인터를 두어 호버가 뜬 상태에서 우클릭하면 메뉴가 열리고 호버가 사라졌다가, 0.3초쯤 뒤 메뉴 아래에 다시 떴다. Haskell, OCaml, Astro, Zig, Gleam 등 호버가 있는 모든 언어에서 그랬다. 포인터가 마지막으로 움직였을 때 Monaco가 "잠시 뒤 이 자리를 다시 본다"고 예약해 둔 것이 메뉴가 열린 뒤에 실행됐기 때문이다.
- **후:** 메뉴가 열려 있는 동안 그 예약을 취소한다. 메뉴를 닫으면 호버는 다시 정상으로 뜬다. 2차에서 호버가 있는 모든 언어가 "hover still shown=0"이었다.
- **코드:** `monaco-editor.ts`의 `openHere`, `here-menu-view.ts`.
- **시험:** e2e "the menu at the cursor takes the place of what the pointer was told there, also when the pointer had just moved". 예약을 취소하지 않는 빌드에서는 실패한다.
- **증거:** [images/menu-hover-before.png](images/menu-hover-before.png)(Zig, 메뉴 위로 호버가 보인다), [images/menu-hover-after.png](images/menu-hover-after.png).

### 3.5 안 될 때의 문장

| 언어 | 실제 원인 | 전 | 후 |
| --- | --- | --- | --- |
| R | R 패키지 `languageserver`가 없음 | R support can't start. / 실행이 정지되었습니다 | R support can't start. / …‘languageserver’이라고 불리는 패키지가 없습니다… |
| Swift | `sourcekit-lsp`가 없음(Swift와 함께 옴) | 재시도 3번 뒤 Swift support can't start. [Show log] [Try again] | 재시도 없이 Swift support isn't installed. / Setdown can't install it by itself. [How to install ↗] [I already have it…] |
| Dart | Dart SDK가 없음 | Couldn't set up Dart support. / from extension "Dart" version 0.4.1: dart must be installed from dart.dev/get-dart or pointed to by the LSP binary settings [Try again] | Dart support needs Dart. / Dart was not found. [How to install ↗] [Show log] |
| Julia | Julia가 없음 | Couldn't set up Julia support. / from extension "Julia" version 0.2.8: Unable to find Julia command 'julia'. … specify its full path in Zed settings. [Try again] | Julia support needs Julia. / Julia was not found. [How to install ↗] [Show log] |
| Elixir | Elixir가 없음 | 재시도 3번 뒤 Elixir support can't start. / …/launch.sh:149: command not found: elixir [Show log] [Try again] | 재시도 없이 Elixir support needs Elixir. / Elixir was not found. [How to install ↗] [Show log] |
| Nix | `nil`을 직접 설치해야 함 | Couldn't set up Nix support. / from extension "Nix" version 0.1.5: nil must be installed manually. Install it or specify the 'binary' path to it via local settings. [Try again] | Nix support isn't installed. / nil must be installed manually. [How to install ↗] [I already have it…] |
| Scala | Metals를 직접 설치해야 함 | **Couldn't download** Scala support. / from extension "Scala" version 0.2.5: Metals must be installed manually. … [Try again] | Scala support isn't installed. / Metals must be installed manually. Recommended way is to install coursier (https://get-coursier.io/), and then run `cs install metals`. [How to install ↗] [I already have it…] |

무엇을 바꿨는지는 다섯 가지다.

1. **마지막 줄이 아니라 원인이 있는 줄.** 도구가 사람의 언어로 말하면(R의 한국어 오류) 우리가 아는 낱말("error", "not found")이 없고, 마지막 줄은 "멈췄다"는 말뿐이다. 출력이 여섯 줄 이하면 전부를, 길면 마지막 줄을 보인다.
2. **없는 프로그램은 다시 시도하지 않는다.** 확장이 내려받지 않는 프로그램의 이름만 준 경우(Swift), 시작은 매번 같은 이유로 실패한다. 재시도 없이 "isn't installed"라고 말하고 [I already have it…]를 준다.
3. **언어 자체가 없으면 그 이름을 말한다.** Dart, Julia, Elixir는 도구가 언어와 함께 온다. "Dart support needs Dart."와 설치 안내 링크를 준다.
4. **"직접 설치해야 한다"는 내려받기 실패가 아니다.** 확장이 "must be installed"라고 말하면 [Try again]이 아니라 [How to install ↗]과 [I already have it…]를 준다. 확장의 문장에서 Setdown에 없는 "Zed settings", "local settings"를 가리키는 부분은 뺀다. 그 길은 [I already have it…]이다.
5. **군더더기.** `from extension "Dart" version 0.4.1:`는 뗀다. 조언 속의 주소(`https://…`) 때문에 제목이 "Couldn't download"가 되던 것을 고쳤다.

- **코드:** `language-issue.ts`, `document-presentation.ts`, `language-manager.ts`, `protocol/language.ts`.
- **시험:** `language-issue.test.ts`(실제 확장의 문장 네 개, zsh와 bash의 "command not found", R의 한국어 출력), `document-presentation.test.ts`.
- **증거:** [images/scala-before.png](images/scala-before.png), [images/scala-after.png](images/scala-after.png), [images/swift-after.png](images/swift-after.png).

### 3.6 작은 것들

| 무엇 | 전 | 후 | 코드 |
| --- | --- | --- | --- |
| 언어 이름 | 칩과 패널에 `clojure` | `Clojure` | `language-catalog.ts` `languageDisplayName` |
| F1 검색 순서 | "symbol"을 치면 설명에만 그 낱말이 있는 "Choose a previous result list…"가 맨 위 | 이름에 그 낱말이 있는 명령이 먼저 | `panel-match.ts` |
| Problems의 경로 | 경로가 길면 끝의 파일 이름과 줄 번호가 잘림 | 앞쪽 폴더만 줄이고 `job.lua:102`는 남김. 마우스를 올리면 전체 | `LanguageResults.svelte`, `language-results.ts` |

## 4. 고치지 않은 것과 권고

중요한 순서다. 앞의 넷은 결정이 필요하다.

### 4.1 Vue: 살아 있지만 답하지 않는 도구

- **화면:** 칩은 "Vue", 패널은 "✓ Working", 상세는 "vue-language-server · Connected · Results received for this open file"이다. 그런데 호버는 "Loading..."에서 멈추고, 우클릭 메뉴는 "Asking Vue…"만 보이고, Ctrl+Space도 "Loading..."이고, F12는 아무 일도 없다. 로그는 "No server output."이다([images/vue-loading.png](images/vue-loading.png)).
- **원인:** `@vue/language-server` 3은 타입에 관한 질문에 스스로 답하지 않는다. 편집기에게 `tsserver/request`로 "TypeScript 서버에 대신 물어 달라"고 하고 답을 기다린다. Zed는 이 다리를 `vendor/zed/crates/project/src/lsp_store/vue_language_server_ext.rs`에 두고, Vue 플러그인(`@vue/typescript-plugin`)을 붙인 TypeScript 서버를 `.vue` 파일에도 붙인다. Setdown의 자체 클라이언트에는 다리가 없어 도구가 끝없이 기다린다.
- **엔진에 맡겨 봤다.** `SETDOWN_LANGUAGE_ENGINE=zed`로 열면 멈춤은 사라진다. 호버는 뜨지 않고, F12는 "No definition found for 'ArticleDetail'"이라 말하고, 메뉴에는 References만 있다. 답은 여전히 없다. `.vue` 파일에 TypeScript 서버가 붙지 않기 때문이다. 엔진으로 옮기는 것만으로는 해결되지 않는다([notes/vue-engine.txt](notes/vue-engine.txt)).
- **권고 둘.**
  - Vue를 제대로 지원하려면 `.vue`에 Vue 플러그인을 붙인 TypeScript 서버와 `tsserver/request` 다리가 필요하다. Svelte를 직접 지원 언어로 다루는 것과 같은 크기의 일이다. 할지 말지 결정이 필요하다. 하지 않는다면 Vue 도구를 카탈로그에서 빼는 편이 지금보다 정직하다.
  - Vue와 무관하게, "요청을 보냈는데 몇 초째 답이 없다"를 말하는 상태가 없다. 답하지 않는 도구와 일하는 도구가 화면에서 구분되지 않는다. "Working"은 이 파일에 대한 답을 실제로 받은 뒤에만 말해야 한다.

### 4.2 이미 설치한 도구의 시작이 네트워크에 달려 있다

- **관측:** 2차에서 Protobuf 파일을 다시 열었을 때 한 번은 "Couldn't set up Protocol Buffer 3 support. / 1: request or response body error [Try again]"로 끝났다. 도구(buf 1.75.0)는 1차에서 내려받아 디스크에 있었다. 다시 돌리니 42초 뒤 준비됐다([notes/proto-second-network-failure.txt](notes/proto-second-network-failure.txt), [notes/proto-second.txt](notes/proto-second.txt)).
- **뜻:** 도구를 다시 시작할 때에도 확장의 준비 단계가 네트워크 요청을 하고, 그 요청이 실패하면 설치된 도구를 쓰지 않는다. 확장이 무엇을 요청했는지는 확인하지 않았다. 다시 열 때의 42초가 그 요청 때문인지 buf 자체의 시작 때문인지도 가르지 못했다.
- **권고:** 지난번에 성공한 실행 명령을 도구별로 저장해 둔다. 준비가 네트워크 오류로 실패했고 그 프로그램이 아직 있으면 그것으로 시작한다. 오프라인에서도 이미 설치한 도구는 동작해야 한다.

### 4.3 Language Support 화면이 이번 실행만 기억한다

"Ready"는 "설치돼 있거나 실행 중이고, 이번 실행에서 실패한 적이 없는 도구의 언어"다. "Needs attention"은 "이번 실행에서 실패한 세션이 있는 도구"다. 그래서 두 가지가 어긋난다.

- **시작하지 못하는 도구가 Ready에 있다.** Ruby와 Elixir는 내려받았지만 한 번도 시작하지 못했다. 다른 파일을 열어 둔 실행에서는 둘 다 Ready 목록에 있다.
- **설치할 수 없는 도구가 Needs attention에 없다.** Dart, Nix, Julia, Scala는 준비 단계에서 끝나 세션이 생기지 않는다. 파일의 칩은 "Not working"인데 Language Support 화면에는 아무 표시가 없다.
- **Ready 목록에 사람이 모르는 이름이 섞인다.** 도구 하나가 여러 언어를 맡으면 전부 나온다: cross-config, git-cliff-config, jjconfig, miseconfig, pkgbuild, Glimmer JS, Glimmer TS, heex, BibTeX.

권고: 도구마다 마지막 결과(됐다, 왜 안 됐다)를 저장하고 두 목록을 그것으로 만든다. Ready에는 이 사람이 실제로 연 파일의 언어만 올린다.

### 4.4 도구마다 다른 선행 조건을 말할 자리가 없다

| 언어 | 필요한 것 | 지금 화면 |
| --- | --- | --- |
| R | R 안에서 `install.packages("languageserver")` | R의 오류 문장 그대로(3.5절 이후) |
| Ruby | ruby-lsp가 쓰는 gem `rbs`. Fedora는 `/usr/share/gems`에 두는데, Zed의 Ruby 확장이 `GEM_PATH`를 확장 폴더와 `~/.local/share/gem/ruby`로만 정해 찾지 못한다 | Ruby support can't start. / …Could not find 'rbs' (>= 3, < 5) among 44 total gem(s) (Gem::MissingSpecError) |
| Clojure | `lein` | 도구의 질문으로 나온다. 다시 열 때마다 다시 묻는다 |
| OCaml | `dune build` | Problems에 "No config found for file bin/ydump.ml. Try calling 'dune build'." |
| Zig | `zig` | "zls has a message." [Read…] |
| Terraform | (없음) | 진단이 오지 않아 "Waiting for analysis results"로 남는다 |

OCaml, Zig, Clojure는 도구가 스스로 말하고, 그 말이 화면에 온다. 이것은 관측 원칙대로다. R과 Ruby는 도구가 죽으면서 남긴 말이라 사람이 읽을 문장이 아니다. 권고: 카탈로그에 도구별 "선행 조건" 한 줄과 링크를 두고, 시작에 실패했을 때 오류 문장 아래에 보인다.

Ruby는 따로 결정이 필요하다. 첫째, `GEM_PATH`는 확장의 동작이라 Setdown에서 고치려면 확장이 준 환경을 덮어써야 한다. 둘째, 길에 따라 고르는 도구가 다르다. 자체 클라이언트는 ruby-lsp를 쓰고, Zed 엔진에 맡기면(`SETDOWN_LANGUAGE_ENGINE=zed`) Zed의 기본값인 solargraph를 내려받는다. 이 컴퓨터에서는 그쪽도 gem을 빌드하다 "Ruby support can't start. / extconf failed, exit code 1"로 끝났다([notes/ruby-engine.txt](notes/ruby-engine.txt)).

### 4.5 "아직 기다리는 중"이 끝나지 않는다

깨끗한 파일에 진단을 보내지 않는 도구(terraform-ls, tinymist, haskell-language-server, gleam)는 상세 화면에 "Waiting for analysis results", Problems에 "No diagnostics reported. Some analysis results are still pending."이 끝까지 남는다. 칩은 "✓ Working"이라 두 말이 어긋난다. 권고: 도구가 진행 중이라고 알리지 않고 일정 시간이 지났으면 "보고된 문제 없음"으로 바꾼다.

### 4.6 이름

- `.tf` 파일의 칩이 "HashiCorp HCL"이다. Terraform 파일을 여는 사람이 찾는 이름은 "Terraform"이다.
- `.proto` 파일의 칩이 "Protocol Buffer 3"이다.
- 카탈로그의 언어 이름 가운데 233개가 소문자 id 그대로다. 이번에 고친 것은 별칭에 제대로 된 이름이 있을 때 그것을 쓰는 것까지다.

카탈로그 데이터의 문제다. 권고: 자주 쓰는 언어 20~30개의 표시 이름을 손으로 정한다.

### 4.7 설치할 방법이 없는 언어

C#(roslyn-language-server)과 CMake(neocmakelsp)는 "isn't installed. Setdown can't install it by itself. [How to install ↗] [I already have it…]"이다. 화면은 사실대로다. Makefile은 도구가 없고 "Syntax highlighting and editing support are available."이라고 말한다. 이것도 사실대로다. C#은 쓰는 사람이 많으니 설치 방법을 넣을 가치가 있다.

### 4.8 그 밖에

- **F1의 느슨한 일치.** "rename"을 치면 "Rename Symbol" 뒤에 "Change completion preferences…", "Create a content checkpoint…"가 따라온다. 글자가 순서대로만 있으면 일치로 치기 때문이다. 이름이나 설명에 낱말이 그대로 있는 행이 하나라도 있으면 느슨한 일치는 빼는 편이 낫다.
- **참조 목록의 파일 행**이 절대 경로 전체를 보인다. 프로젝트 기준 경로면 충분하다.
- **terraform-ls의 로그**는 도구가 모든 요청을 그대로 찍어 숫자 수천 개가 이어진다. [Show log]로 읽을 수 없다.
- **Problems 목록의 경로**도 절대 경로다. 이번 수정으로 파일 이름과 줄 번호는 보이지만([images/problems-after.png](images/problems-after.png)), 앞부분은 프로젝트 기준 경로가 더 쓸모 있다.
- **도구가 꺼져 있을 때의 Ctrl+Space**는 파일 안의 낱말을 "Text"로 내놓는다. 틀리지는 않지만 도구의 답처럼 보인다.
- **Clojure의 질문은 다시 열 때마다 다시 나온다.** 도구가 매번 묻는 것이라 Setdown이 답을 기억해 대신 답할지는 결정할 일이다.

## 5. 따로 요청받은 것: 웹 탭의 지구본 아이콘

- **증상:** 웹 탭(예: Google 검색 결과)에 사이트 아이콘 대신 지구본이 떴다.
- **원인:** Chromium은 페이지의 아이콘을 "직전 페이지와 다를 때만", 그리고 페이지를 다 읽은 뒤에만 알린다. Setdown은 아이콘을 찾는 일을 문서 하나에 묶어 두어, 같은 사이트의 다음 페이지가 읽히기 시작하면 앞의 결과를 버렸다. 다음 페이지는 아이콘이 같으니 Chromium이 다시 알리지 않는다. 그래서 그 탭은 그 사이트에 있는 내내 지구본이었다.
- **수정:** 아이콘 찾기는 문서가 아니라 사이트에 속한다. 가장 최근의 찾기만 반영하고, 다른 사이트로 넘어간 뒤에는 반영하지 않는다. 아이콘이 없는 페이지에는 Setdown이 직접 "어떤 아이콘을 선언했는가"를 묻는다. 아무것도 선언하지 않은 사이트는 `/favicon.ico`를 쓴다.
- **코드:** `browser-manager.ts`(`labelTab`, `askIcons`), `core/browser/favicon.ts`.
- **시험:** `favicon.test.ts`, e2e `test/e2e/browser/tab-icons.spec.ts`.

## 6. 검증

| 무엇 | 결과 |
| --- | --- |
| 타입 검사(`npm run typecheck`) | 오류 0 |
| 단위 시험 전체(`npm test`) | 241개 파일, 1921개 시험 통과 |
| e2e: `test/e2e/language` 전체, `browser/tab-icons.spec.ts`, `workspace/editor-tools.spec.ts` | 50개 중 49개 통과, 1개 실패(아래) |
| 미리보기 계약(`npm run test:preview-contract`) | **통과하지 못했다.** 단위 시험 149개 파일 1236개와 도구 시험 20개, 빌드는 통과. 실제 앱 시험 409개 중 407개 통과, 2개 실패(아래) |
| 실제 앱에서 수정 확인(2차) | 3.1~3.6절의 "후"는 모두 2차 기록에서 읽은 것이다 |

**실패한 e2e는 둘이다.**

1. **`language-registry.spec.ts` "an imported npm profile starts automatically and supplies completion without a connection form".** 5초 안에 `ready`가 되지 못하고 `starting`에 머문다. 이번 변경과 무관하다. 이번 수정을 모두 뺀 소스(커밋 `508d564` 그대로)로 메인과 렌더러를 빌드해 돌려도 똑같이 실패했다. 원인은 찾지 않았다.
2. **`workspace/folder-drag.spec.ts` "a folder tab drags files into folders, onto a web page as real files, and onto a tab strip".** 계약 실행에서 한 번 실패했다. 웹 탭을 연 뒤 5초가 지나도 탭이 제목("Drop page") 대신 주소를 보이며 읽는 중이었다. 아이콘 수정(5절)이 웹 탭을 건드리므로 그 탓인지 따졌다. **수정 탓이 아니라고 보지만 증명하지는 못했다.**
   - 실패 직후 같은 빌드로 3번 돌리니 1번 통과, 2번 실패였다. 아이콘 수정을 `browser-manager.ts`에서 뺀 빌드로는 6번 모두 통과했다. 여기까지는 수정 탓으로 보였다.
   - 7분 뒤 수정이 든 같은 빌드로 10번 돌리니 모두 통과했다.
   - 같은 순서를 따라가며 시각을 적었다. 새 프로필의 첫 웹 탭은 내장 광고 차단 확장이 시작되기를 기다린 뒤에야 서버에 요청을 보낸다. 그 기다림이 한가할 때 1.7~4.4초, 코어를 전부 바쁘게 하면 15~21초였다. 요청이 닿은 뒤 제목이 뜨기까지는 0.2~1.1초다. 기다림은 `browser-manager.ts`의 `ensureReady`에 있다. 아이콘 코드는 페이지를 읽은 뒤에만 실행되므로, 5초 제한은 그 코드가 실행되기 전에 넘어간다([notes/folder-drag-first-web-tab-timing.txt](notes/folder-drag-first-web-tab-timing.txt)).
   - 판단: 5초 제한이 확장의 시작 시간에 걸리는 시험이고, 실패한 시각(23:37~23:42)에 컴퓨터가 바빴던 것으로 본다. 그 시각에 무엇이 컴퓨터를 바쁘게 했는지는 확인하지 못했고, 한가한 컴퓨터에서 실패를 다시 만들지도 못했다. 시험은 고치지 않았다. 제한을 늘리는 것은 기준을 낮추는 일이다.

**새 시험이 결함을 잡는지 확인했다.** 수정을 빼고 돌려 실패하는 것을 본 시험은 다음과 같다: 시작 알림(`language-manager.test.ts`), 질문 중 시간 초과(`server-session.test.ts`), 느리게 실패하는 도구의 재시도(`language-supervisor.test.ts`), 메뉴 아래의 호버(e2e). 열지 않은 파일의 참조는 수정 전 앱에서 같은 순서로 "Model not found" 30번과 위치 문자열을 기록했다.

**확인하지 못한 것.**

- Clojure는 질문에 답한 뒤 "✓ Working"까지만 봤다. 그 뒤의 호버와 이동은 보지 않았다.
- 실패 문장은 이 컴퓨터에 없는 것들로만 확인했다. 예를 들어 Swift가 설치된 컴퓨터에서 sourcekit-lsp가 실제로 동작하는지는 보지 않았다.
- 미리보기 성능 측정(`bench:preview`)은 하지 않았다. 스타일시트에 더한 규칙은 편집기의 참조 목록(`.monaco-editor .peekview-widget`)에만 닿고, 미리보기를 준비하거나 보여 주는 길은 건드리지 않았다.
- Swift의 분류는 처음에 단위 시험에서 가정한 문자열(`spawn sourcekit-lsp ENOENT`)로 썼다가, 실제 앱이 기록한 문자열(`spawn /usr/bin/xcrun ENOENT`)을 보고 고쳤다. Zed의 Swift 확장은 sourcekit-lsp를 찾지 못하면 macOS의 `xcrun`을 가리킨다([notes/focus-swift-after.txt](notes/focus-swift-after.txt)).

**남겨 둔 것.** 시험 프로그램 세 개(`apps/desktop/.probe/zed-audit.spec.ts`, `zed-focus.spec.ts`, `zed-audit-run.sh`)는 git이 모르는 파일로 남아 있다. 다시 돌리려면 `bash apps/desktop/.probe/zed-audit-run.sh <이름> <언어…>`이다. 감사용 프로필과 저장소(1.4 GB)는 `target/validation/zed-languages-ui-audit-2026-11-21/`에 있다.

## 부록 A. 저장소와 커밋

| 언어 | 저장소 | 커밋 | 연 파일 |
| --- | --- | --- | --- |
| Lua | nvim-lua/plenary.nvim | `74b06c6c75` | `lua/plenary/job.lua` |
| TOML | BurntSushi/walkdir | `6fd031c82b` | `Cargo.toml` |
| Ruby | sinatra/sinatra | `2e3f791391` | `lib/sinatra/main.rb` |
| Shell | nvm-sh/nvm | `ea0fcdbe16` | `install.sh` |
| R | tidyverse/stringr | `7e1a4cf9c2` | `R/detect.R` |
| Perl | mojolicious/mojo | `d232174795` | `lib/Mojolicious.pm` |
| LaTeX | posquit0/Awesome-CV | `dfe863541c` | `examples/resume.tex` |
| Terraform | terraform-aws-modules/terraform-aws-vpc | `577ad620ab` | `main.tf` |
| Typst | typst/templates | `71b01c6b0a` | `charged-ieee/template/main.typ` |
| Protobuf | grpc/grpc-proto | `a0515b7687` | `grpc/gcp/handshaker.proto` |
| Clojure | ring-clojure/ring | `5f745bbc7d` | `ring-core/src/ring/util/response.clj` |
| XML | spring-projects/spring-petclinic | `500158f732` | `pom.xml` |
| CMake | fmtlib/fmt | `14ac0d5a9d` | `CMakeLists.txt` |
| Makefile | DaveGamble/cJSON | `6d9f2443ab` | `Makefile` |
| Markdown | sinatra/sinatra | `2e3f791391` | `README.md` |
| Haskell | ndmitchell/extra | `2aa1d78dc4` | `src/Data/List/Extra.hs` |
| OCaml | ocaml-community/yojson | `df9e87cdef` | `bin/ydump.ml` |
| Vue | mutoe/vue3-realworld-example-app | `741c215ef0` | `src/pages/Article.vue` |
| Astro | satnaing/astro-paper | `217c4e3362` | `src/layouts/Layout.astro` |
| C# | serilog/serilog | `43105b3509` | `src/Serilog/Log.cs` |
| Swift | apple/swift-argument-parser | `d225b6fe8a` | `Sources/ArgumentParser/Parsable Types/ParsableCommand.swift` |
| Dart | dart-lang/http | `0d813f96a0` | `pkgs/http/lib/src/client.dart` |
| Elixir | elixir-plug/plug | `f6cb9a9d8d` | `lib/plug/conn.ex` |
| Zig | karlseguin/http.zig | `cfbad6f01a` | `src/httpz.zig` |
| Nix | nix-community/nix-direnv | `2d086079a3` | `default.nix` |
| Julia | JuliaCollections/DataStructures.jl | `392160d2f8` | `src/deque.jl` |
| Gleam | gleam-lang/stdlib | `f2d4fdf6fb` | `src/gleam/list.gleam` |
| Scala | com-lihaoyi/os-lib | `8871ab0bda` | `os/src/Path.scala` |

TOML, XML, CMake, Makefile은 `apps/lsp-benchmark/work/sources`에 이미 있던 저장소를 썼다.

## 부록 B. 증거

- [notes/](notes/): 언어마다 `‹언어›-first.txt`, `‹언어›-second.txt`, 일부는 `‹언어›-engine.txt`. 한 줄이 한 장면이고, 앞의 숫자는 앱을 띄운 뒤의 초다. 경로는 `<audit>`, `<repo>`, `~`로 줄였다.
- [notes/focus-*.txt](notes/): 한 가지를 따로 들여다본 기록(Lua의 참조, Clojure의 질문, Swift의 실패 사유).
- [images/](images/): 본문에서 가리킨 화면.
- [audit-spec.ts.txt](audit-spec.ts.txt), [focus-spec.ts.txt](focus-spec.ts.txt), [audit-run.sh.txt](audit-run.sh.txt): 시험 프로그램. 원본은 `apps/desktop/.probe/`에 있다.
- 화면 전체(언어마다 13장씩 두 번)와 내려받은 도구는 `target/validation/zed-languages-ui-audit-2026-11-21/`에 있다. `target/`은 git이 보지 않는다.
