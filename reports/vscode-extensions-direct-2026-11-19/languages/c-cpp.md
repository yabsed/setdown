# C/C++ 확장 두 개의 분석

기준: `vendor/vscode-clangd` `4a6fe6386dd06745692662d1285d6ddccbe306a7`, `vendor/vscode-cpptools` `f1c3b981ef7a1494174553595c510aaba1d6a7ed`. 소스를 읽기만 했고 빌드하거나 실행하지 않았다. 인용은 저장소 기준 `경로:줄`이다. 같은 괄호 안에서 `:숫자`만 쓴 것은 바로 앞 파일의 다른 줄이다. "추정"은 소스에서 직접 보지 못한 것이다. 줄 수는 `wc -l`, 기여 수는 `package.json`을 파싱해 센 것이다.

## C/C++: clangd (`vendor/vscode-clangd`)

| 항목 | 값 |
| --- | --- |
| 버전 | 0.6.0 (`vendor/vscode-clangd/package.json:5`). 그 뒤 미출시 변경이 들어 있다 (`vendor/vscode-clangd/CHANGELOG.md:3-5`) |
| 라이선스 | MIT (`vendor/vscode-clangd/package.json:7`, `vendor/vscode-clangd/LICENSE:1`) |
| `engines.vscode` | `^1.91.0` (`vendor/vscode-clangd/package.json:10-12`) |
| 클라이언트 소스 크기 | `src/` 14개 파일 1,831줄. 테스트(`test/` 3개 파일 249줄)는 뺐다 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | 없음 |
| 기여 수 | commands 17 (`vendor/vscode-clangd/package.json:211-312`), configuration 속성 17 (`:91-199`), views 3 (`:391-409`), keybindings 2 (`:313-325`), colors 1, languages 1. debuggers와 taskDefinitions는 없다 |
| 언어 서버 | clangd. 확장에 들어 있지 않다. PATH나 `clangd.path`에서 찾고, 없으면 npm 패키지 `@clangd/install`이 GitHub 릴리스에서 받는다 (`vendor/vscode-clangd/src/install.ts:1-2`). 서버 소스와 라이선스 문서는 이 저장소에 없다 (LLVM 프로젝트의 공개 소스로 알려져 있으나 여기서 확인한 것은 아니다) |

### 1. 클라이언트가 하는 일

a. 도구 확보
- 기본 실행 파일 이름은 `clangd`다 (`vendor/vscode-clangd/package.json:95-100`). 슬래시가 있는 상대 경로는 작업 폴더 기준으로 푼다 (`vendor/vscode-clangd/src/install.ts:140-150`).
- 찾기, 받기, 버전 비교는 `@clangd/install` 0.1.20이 한다 (`vendor/vscode-clangd/package.json:50`, `vendor/vscode-clangd/src/install.ts:19-21`). 이 패키지 소스는 저장소에 없어서(`node_modules` 없음) 내부 동작은 확인하지 못했다.
- 확장이 직접 쓴 것은 그 패키지에 넘기는 화면 어댑터다. "PATH에 없다, 받겠는가" 질문 (`vendor/vscode-clangd/src/install.ts:127-138`), 진행 알림 (`:39-66`), 이미 받은 것 재사용 여부 (`:80-96`), 업데이트 질문 (`:112-125`), 받은 경로를 전역 설정 `clangd.path`에 쓰기 (`:155-162`), 설치 뒤 재시작 (`:100-105`).
- 자동 설치는 x86-64 Linux, Windows, Mac에서 된다고 적혀 있다 (`vendor/vscode-clangd/README.md:22`). 업데이트 확인은 기본으로 꺼져 있다 (`vendor/vscode-clangd/package.json:143-147`).

b. 컴파일러·툴체인·환경 선택
- 확장은 컴파일러를 찾지 않는다. clangd를 `clangd.arguments`와 작업 폴더를 cwd로 띄울 뿐이다 (`vendor/vscode-clangd/src/clangd-context.ts:90-97`). 환경 변수는 `CLANGD_TRACE`를 더할 때만 만진다 (`:98-102`).
- 초기화 옵션은 `clangdFileStatus: true`와 `fallbackFlags` 둘이다 (`vendor/vscode-clangd/src/clangd-context.ts:108-111`).

c. 프로젝트 범위와 설정 가져오기
- 대상은 `file` 스킴의 c, cpp, cuda-cpp, objective-c, objective-cpp다 (`vendor/vscode-clangd/src/clangd-context.ts:16-22`). 창 하나에 클라이언트 하나이고 cwd는 첫 작업 폴더다 (`:94`).
- `compile_commands.json`은 확장이 읽지 않는다. 만드는 것은 사용자 몫이고 (`vendor/vscode-clangd/README.md:27-36`), 위치를 바꾸려면 `clangd.arguments`에 `--compile-commands-dir`를 직접 쓴다 (`:49-56`). 설정 값의 `${workspaceFolder}`, `${env:…}`, `${config:…}`, `${command:…}` 치환은 확장이 한다 (`vendor/vscode-clangd/src/config.ts:47-87`).
- 신뢰하지 않는 작업 공간에서는 켜지지 않는다 (`vendor/vscode-clangd/package.json:74-79`).

d. 표준 LSP 밖의 통신
- 서버 → 클라이언트 알림: `textDocument/clangd.fileStatus` (`vendor/vscode-clangd/src/file-status.ts:16-18`), `textDocument/inactiveRegions` (`vendor/vscode-clangd/src/inactive-regions.ts:18-20`).
- 클라이언트 → 서버 요청: `textDocument/switchSourceHeader` (`vendor/vscode-clangd/src/switch-source-header.ts:11-16`), `textDocument/ast` (`vendor/vscode-clangd/src/ast.ts:9`), `$/memoryUsage` (`vendor/vscode-clangd/src/memory-usage.ts:25-26`), 표준 이전의 `textDocument/typeHierarchy`와 `typeHierarchy/resolve` (`vendor/vscode-clangd/src/type-hierarchy.ts:44-60`), 옛 `clangd/inlayHints` (`vendor/vscode-clangd/src/inlay-hints.ts:35-39`).
- 추가 능력 선언: `completion.editsNearCursor` (`vendor/vscode-clangd/src/clangd-context.ts:48-54`), `inactiveRegionsCapabilities` (`vendor/vscode-clangd/src/inactive-regions.ts:36-46`). 서버 능력 `compilationDatabase.automaticReload`를 읽는다 (`vendor/vscode-clangd/src/config-file-watcher.ts:14-28`).
- 미들웨어: 완성 항목의 `filterText` 앞에 입력 접두사를 붙이고 `commitCharacters`를 비우고 목록을 미완성으로 표시한다 (`vendor/vscode-clangd/src/clangd-context.ts:130-175`). 작업 공간 심볼 이름에 한정자를 붙인다 (`:186-207`). 둘 다 VS Code의 퍼지 필터를 피하려는 처리라고 주석에 적혀 있다 (`:116-129`, `:181-185`).

e. 변경 감지와 재시작
- 서버가 `automaticReload`를 알리면 아무것도 하지 않는다. 설정 설명에 clangd 12 이상은 스스로 다시 읽는다고 적혀 있다 (`vendor/vscode-clangd/package.json:148-151`). 그렇지 않을 때만 각 작업 폴더의 `compile_commands.json`, `build/compile_commands.json`, `compile_flags.txt`를 감시하고 (`vendor/vscode-clangd/src/config-file-watcher.ts:53-57`), 2초 뒤 (`:66-75`) 빈 파일이 아니면 (`:82-83`) 묻거나 재시작한다 (`:85-113`).
- 재시작은 클라이언트를 버리고 새로 만드는 것이다 (`vendor/vscode-clangd/src/extension.ts:56-59`). 충돌 뒤 자동 재시작은 최대 4번이다 (`vendor/vscode-clangd/src/clangd-context.ts:213-215`).
- `clangd.*` 설정이 바뀔 때 재시작하는 코드는 없다. `onDidChangeConfiguration`은 비활성 영역 장식용 한 곳뿐이다 (`vendor/vscode-clangd/src/inactive-regions.ts:62`).

f. 실패 처리와 화면
- clangd가 없으면 설치 질문이 뜨고, 경로를 얻지 못하면 클라이언트를 만들지 않는다 (`vendor/vscode-clangd/src/clangd-context.ts:67-71`).
- 상태 표시줄에 현재 파일의 `clangd: <상태>`가 나오고 누르면 출력 패널이 열린다 (`vendor/vscode-clangd/src/file-status.ts:7-9`, `:53`). 출력 패널은 스스로 열리지 않는다 (`vendor/vscode-clangd/src/clangd-context.ts:112-114`).
- `workspace/executeCommand` 실패만 오류 알림으로 띄운다 (`vendor/vscode-clangd/src/clangd-context.ts:37-45`). Microsoft C/C++ 확장이 함께 켜져 있으면 5초마다 확인해 경고한다 (`vendor/vscode-clangd/src/extension.ts:88-117`).
- 컴파일 데이터베이스가 없다는 것을 확장이 따로 알리는 코드는 없다 (`src/`에서 `compile_commands`는 `config-file-watcher.ts` 한 파일에만 나온다).

### 2. VS Code에 묶인 정도

- 13개 파일이 모두 `import * as vscode` 형태라 숨은 사용이 없다. 요청하신 정규식으로 센 결과: window 38, commands 37, workspace 28, languages 3, extensions 1, env 1. debug, tasks, tests, notebooks, lm, chat, authentication, l10n은 0이다. 많이 쓰는 것은 `commands.registerCommand` 18, `commands.executeCommand` 17(대부분 `setContext`), `window.showInformationMessage` 11이다.
- 필요한 화면(식별자 출현 수): 상태 표시줄 1, 알림(정보 12, 오류 4, 경고 2), 진행 알림 2, 출력 채널 1, 트리 뷰 3, 편집기 장식 2. 빠른 선택, 웹뷰, 워크스루, 터미널, 태스크, 디버그, 테스트는 쓰지 않는다.
- VS Code 없이도 뜻이 있는 것: 초기화 옵션과 능력 선언, 비표준 메서드 이름, 감시 대상 파일과 2초 지연, 충돌 재시작 횟수. VS Code 안에서만 뜻이 있는 것: 완성·심볼 미들웨어, 트리 뷰 세 개, `setContext`, 설정 변수 치환.

### 3. VS Code 없이 쓸 수 있는 부품

- clangd 실행 파일: `clangd [인자]`를 표준 입출력으로 띄우는 일반 언어 서버다 (`vendor/vscode-clangd/src/clangd-context.ts:90-97`).
- `@clangd/install` 0.1.20: 화면 객체를 받아 동작하는 설치기다 (`vendor/vscode-clangd/src/install.ts:14-21`). 라이선스는 Apache-2.0 WITH LLVM-exception으로 적혀 있다 (`vendor/vscode-clangd/package-lock.json:234-238`). Setdown은 같은 일을 Zed로 이미 한다.
- `textDocument/ast` 형식 선언 (`vendor/vscode-clangd/api/vscode-clangd.d.ts:21-36`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

- 도구 확보: Zed는 PATH의 `clangd`를 먼저 쓰고 (`vendor/zed/crates/languages/src/c.rs:57-69`), 없으면 `clangd/clangd` 릴리스의 zip을 받아 (`:34-54`) 다이제스트와 `--version` 실행으로 확인한다 (`:98-132`). Setdown은 이 일을 호스트를 통해 Zed에 맡긴다 (`tooling/language-host/src/main.rs:163-168`, `apps/desktop/src/main/language/language-provisioner.ts:171`). 확장과 결과가 같고 질문 창만 없다.
- 컴파일 데이터베이스: 확장에는 탐색이 없다. Zed 어댑터에도 없다 (`c.rs`에 해당 코드 없음). Setdown만 루트, `build`, `builddir`, `out/build`, `CMakePresets.json`의 `binaryDir`를 살펴 (`apps/desktop/src/main/language/analysis-context.ts:139-155`) `--compile-commands-dir=`를 인자에 붙이고 (`:166-167`), 여러 개이거나 없으면 문제로 알린다 (`:169-172`). 이 부분은 Setdown이 확장보다 많이 한다.
- 비표준 통신: Setdown의 자체 클라이언트는 1절 d의 것을 하나도 다루지 않는다 (`apps/desktop/src`에서 `inactiveRegions`, `editsNearCursor`, `clangdFileStatus`, `switchSourceHeader` 검색 결과 0건). clangd는 아직 Zed 프로젝트 엔진 대상이 아니다 (`apps/desktop/src/main/language/zed-settings.ts:12`, `apps/desktop/src/main/language/project-languages.ts:168-170`). Zed 쪽에는 `editsNearCursor`와 비활성 영역 선언 (`vendor/zed/crates/languages/src/c.rs:366-388`), 비활성 영역을 진단으로 바꾸는 처리 (`vendor/zed/crates/project/src/lsp_store/clangd_ext.rs:49-103`), 헤더/소스 전환 요청 (`vendor/zed/crates/project/src/lsp_store/lsp_ext_command.rs:308-313`)이 있다.
- 서버 인자: 확장은 사용자 인자만 넘긴다. Setdown은 `--background-index --pch-storage=disk -j=2 --log=error`를 넘긴다 (`apps/desktop/src/main/language/catalog/profiles.json:141-149`).
- 변경 감지: Setdown은 `compile_commands.json`, `compile_flags.txt`, `.clangd`, `.clang-format` 변경을 `workspace/didChangeWatchedFiles`로 넘기고 (`apps/desktop/src/main/language/catalog/profiles.json:178-183`, `apps/desktop/src/main/language/server-session.ts:234-241`), 계획에 쓴 입력 파일이 바뀌면 다시 연결한다 (`apps/desktop/src/main/language/language-manager.ts:697-701`).
- 충돌 복구: 확장은 4번, Setdown은 60초 안에 3번(1초, 3초, 5초 뒤)이다 (`apps/desktop/src/main/language/language-supervisor.ts:8-11`).

### 5. 이 확장을 그대로 돌린다면

- 호스트가 줄 것: VS Code API 1.91 이상, 2절의 window·commands·workspace·languages 멤버, `vscode-languageclient` 11이 요구하는 언어 기능 등록 API(추정), 기여 지점 commands·configuration·views(explorer)·menus·keybindings·colors와 `when` 절, 전역 저장 경로 (`vendor/vscode-clangd/src/extension.ts:58-59`), 전역 설정 쓰기 (`vendor/vscode-clangd/src/install.ts:157`). 의존 확장과 제안 API는 없다.
- 막는 것: 없다. MIT이고 Open VSX 게시 스크립트도 있다 (`vendor/vscode-clangd/package.json:43`).
- 얻는 것: (1) 비활성 전처리 영역 흐리게 표시, (2) 헤더/소스 전환 명령, (3) 파일별 clangd 상태 표시, (4) 점을 화살표로 고치는 완성(`editsNearCursor`), (5) AST·메모리·타입 계층 뷰. 다섯 가지 모두 메서드 이름과 형식이 1절 d에 드러나 있어 확장 없이 구현할 수 있고, (1)과 (2)는 Zed에 이미 있다. 프로젝트 분석이 되느냐를 정하는 컴파일 데이터베이스 탐색은 이 확장에 없으므로 얻지 못한다.

## C/C++: C/C++ (Microsoft, `vendor/vscode-cpptools`)

| 항목 | 값 |
| --- | --- |
| 버전 | 1.35.6-main (`vendor/vscode-cpptools/Extension/package.json:5`) |
| 라이선스 | 클라이언트 소스는 MIT (`vendor/vscode-cpptools/LICENSE.md:5-25`). 공식 VSIX에 든 실행 파일은 별도의 독점 조건 (`vendor/vscode-cpptools/LICENSE.md:1-3`, `vendor/vscode-cpptools/RuntimeLicenses/cpptools-LICENSE.txt`). 매니페스트는 `SEE LICENSE IN LICENSE.txt`라고 하는데 (`vendor/vscode-cpptools/Extension/package.json:12`) 그 파일은 `Extension/`에 없다 |
| `engines.vscode` | `^1.82.0` (`vendor/vscode-cpptools/Extension/package.json:13-15`) |
| 클라이언트 소스 크기 | `Extension/src` 126개 `.ts` 33,250줄. 그중 `LanguageServer/` 45개 18,445줄, `Utility/` 43개 5,956줄, `Debugger/` 13개 3,502줄, `SSH/` 8개 1,839줄, 최상위 15개 3,408줄. 설정 화면 `Extension/ui`는 `.ts` 415줄과 `.html` 777줄. 테스트(`Extension/test`)는 뺐다 |
| `extensionDependencies` | 없음. 묶음 확장은 따로 있다 (`vendor/vscode-cpptools/ExtensionPack/package.json:38-43`) |
| `enabledApiProposals` | `terminalDataWriteEvent`, `chatParticipantAdditions` (`vendor/vscode-cpptools/Extension/package.json:43-46`) |
| 기여 수 | commands 46, configuration 속성 167(7개 묶음), views 2 (`:869`), debuggers 2 (`:4246`), taskDefinitions 1 (`:443`), problemMatchers 3, walkthroughs 1개 23단계 (`:203`), languageModelTools 1 (`:7210`), breakpoints 6, semanticTokenTypes 12, keybindings 3, jsonValidation 1 |
| 언어 서버 | 네이티브 실행 파일 `bin/cpptools`와 그 자식 `cpptools-srv`, `cpptools-srv2`, 그리고 `cpptools-wordexp` (`vendor/vscode-cpptools/Extension/src/main.ts:191-195`, `vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:4486-4487`). 소스는 저장소에 없고 비공개다 |

### 1. 클라이언트가 하는 일

a. 도구 확보
- 엔진은 플랫폼별 VSIX 안에 들어 온다. 실행 중에 받는 코드는 없다. 경로는 `<확장>/bin/cpptools` 고정이고 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:4472-4481`), 없으면 `Missing binary`를 던져 (`:1646-1651`) "Unable to start the C/C++ language server. IntelliSense features will be disabled."가 뜬다 (`:1363`).
- 저장소에 엔진이 없다는 근거: `Extension/bin`에는 `cpp.hint`와 `messages/`만 있다. `.gitignore`가 `bin/cpptools*`, `LLVM`, `debugAdapters`를 "내려받는 파일"로 제외한다 (`vendor/vscode-cpptools/Extension/.gitignore:8-27`). 빌드 문서는 Marketplace에서 확장을 설치한 뒤 `bin/`의 `cpptools`와 `cpptools-srv`를 복사해 오라고 한다 (`vendor/vscode-cpptools/Documentation/Building the Extension.md:15-19`).
- 활성화할 때 실행 권한을 주고 (`vendor/vscode-cpptools/Extension/src/main.ts:188-220`), VSIX의 대상 플랫폼 10종이 현재 기계와 맞는지 확인해 다르면 오류를 띄운다 (`:264-321`).
- 컴파일러 설치 도우미가 있다. macOS는 `sudo xcode-select --install`, Linux는 배포판별 `apt`·`yum`·`zypper` 명령을 VS Code 터미널에 넣고, Windows는 워크스루를 연다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:689-744`).

b. 컴파일러·툴체인·환경 선택
- 컴파일러를 찾고 질의하는 일은 클라이언트가 아니라 엔진이 한다. 클라이언트는 `cpptools/queryCompilerDefaults`를 보내 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:3212-3221`) 기본 컴파일러 경로와 인자, 알려진 컴파일러 목록, C/C++ 표준, Windows SDK 버전, IntelliSense 모드를 받는다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:127-136`). `LanguageServer/`의 TypeScript가 띄우는 프로세스는 node 애드온 경로 질의 (`:537`)와 충돌 기록용 디맹글러 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:1535`)뿐이다. 엔진이 시스템 include 경로를 어떻게 구하는지는 이 저장소에서 볼 수 없다.
- 신뢰 절차는 클라이언트에 있다. 사용자가 고르거나 설정에 적은 컴파일러만 신뢰 목록에 넣고 다시 질의한다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:4436-4446`). 신뢰한 컴파일러가 없으면 엔진이 찾은 기본값을 쓰지 않는다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:333-341`).
- 우선순위도 클라이언트가 정한다. 속성마다 `c_cpp_properties.json` 값, `C_Cpp.default.*` 설정, 엔진 기본값 순이다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:936-1047`). `compileCommands`가 있으면 `compilerPath` 기본값을 넣지 않는다 (`:984-988`).
- IntelliSense 모드: 설정 이름과 플랫폼으로 기본값을 정하고 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:605-621`), `cl.exe`와 `msvc` 모드가 어긋나면 오류로 표시한다 (`:623-645`). 스키마의 값은 41개다 (`vendor/vscode-cpptools/Extension/c_cpp_properties.schema.json:123`).
- 클라이언트가 직접 더하는 경로: vcpkg의 `include` 폴더 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:472-500`), `node-addon-api`와 `nan` (`:506-583`), Kconfig `.config`의 정의 (`:958-963`).
- Windows에서는 `node-vswhere`와 `node-vcvarsall`로 Visual Studio 개발 환경을 구해 VS Code의 `environmentVariableCollection`에 넣는다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/devcmd.ts:7-8`, `:58-97`).

c. 프로젝트 범위와 설정 가져오기
- 작업 폴더마다 `.vscode/c_cpp_properties.json`을 읽는다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:181`, `:255-260`). 주석 허용 JSON이고 설정이 하나 이상 있어야 한다 (`:1466-1468`). 설정 하나의 속성은 18개다 (`vendor/vscode-cpptools/Extension/c_cpp_properties.schema.json`). 파일이 없으면 이름이 `Linux`/`Mac`/`Win32`인 기본 설정을 만들고 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:41-56`) include 경로를 `${workspaceFolder}/**`로 둔다 (`:410-414`).
- `C_Cpp.default.*` 설정 22개와 속성별로 합친다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:936-1047`).
- `compile_commands.json`: 후보 경로는 엔진이 `cpptools/compileCommandsPaths`로 알려 준다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:3113-3128`). 엔진이 어떻게 찾는지는 볼 수 없다. 클라이언트는 자동으로 적용하지 않고 상태 표시줄 경고와 빠른 선택으로 묻는다 (`:3154-3159`, `:1210-1213`).
- 설정 제공자: CMake Tools 같은 다른 확장이 확장 호스트 안의 공개 API로 등록한다 (`vendor/vscode-cpptools/Extension/src/cppTools.ts:57-113`, `vendor/vscode-cpptools/Extension/src/LanguageServer/customProviders.ts:20-21`). 엔진이 파일 목록을 들어 `cpptools/requestCustomConfigs`를 보내면 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:2445-2453`) 클라이언트가 제공자의 `canProvideConfiguration`과 `provideConfigurations`를 부르고 (`:2308-2333`), 파일 하나일 때는 2초 제한을 걸고 (`:79`, `:2410`), 형식을 검사해 엔진에 넘긴다 (`:3505-3509`). 제공자가 하나뿐이고 다른 설정이 비어 있으면 자동으로 고른다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:1050-1073`). `mergeConfigurations`가 켜져 있으면 제공자 결과에 `c_cpp_properties.json`의 include 경로, 정의, 강제 include를 더한다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:2366-2398`).
- 탐색용 데이터베이스: `browse.path`, `limitSymbolsToIncludedHeaders`, `databaseFilename`을 클라이언트가 풀어 넘긴다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:1032-1047`). 저장 위치는 캐시 폴더 아래 작업 공간 해시다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1696-1698`, `vendor/vscode-cpptools/Extension/src/common.ts:1320-1342`). 데이터베이스와 태그 파서 자체는 엔진 안에 있다.
- 여러 작업 폴더: 폴더마다 클라이언트 객체를 두지만 (`vendor/vscode-cpptools/Extension/src/LanguageServer/clientCollection.ts:44-55`) 엔진 프로세스는 하나를 같이 쓴다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:89-90`, `:1340-1348`). 문서는 속한 폴더의 클라이언트가 맡고 (`vendor/vscode-cpptools/Extension/src/LanguageServer/clientCollection.ts:226-246`), 폴더가 더해지거나 빠지면 소유를 옮긴다 (`:154-192`).

d. 표준 LSP 밖의 통신
- 전송은 `vscode-languageclient` 9로 `bin/cpptools`를 표준 입출력에 붙인 것이다 (`vendor/vscode-cpptools/Extension/package.json:7323`, `vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1657-1660`, `:1804`). 표준 `initialize`에는 로그 수준만 싣고 (`:1717-1719`), 실제 초기화는 `cpptools/preinitialize`와 `cpptools/initialize`로 한다 (`:1813-1825`). 후자에 확장 경로, 데이터베이스 경로, 지역화 문자열, 모든 설정이 들어간다 (`:1700-1713`).
- `cpptools/*` 메서드는 78개다. `client.ts`에 73개 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:593-671`), 다른 파일에 5개 (`vendor/vscode-cpptools/Extension/src/LanguageServer/Providers/codeActionProvider.ts:40`, `vendor/vscode-cpptools/Extension/src/LanguageServer/Providers/renameProvider.ts:18`, `vendor/vscode-cpptools/Extension/src/LanguageServer/Providers/findAllReferencesProvider.ts:12`, `vendor/vscode-cpptools/Extension/src/LanguageServer/codeAnalysis.ts:114-115`).
- 주요 기능이 표준 메서드가 아니다. 호버, 이름 바꾸기, 참조, 문서 심볼, 코드 액션, 서식은 클라이언트가 VS Code 제공자를 직접 등록하고 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1403-1415`) `cpptools/hover` 같은 전용 요청을 보낸다 (`:599-603`). 진단, 의미 토큰, 인레이 힌트, 비활성 영역은 `cpptools/intelliSenseResult` 알림 하나에 묶여 오고 (`:358-370`, `:2632`) 클라이언트가 VS Code 진단 모음에 넣는다 (`:2666-2669`).
- 표준으로 남은 것: 문서 열기·닫기·저장 전 처리 (`vendor/vscode-cpptools/Extension/src/LanguageServer/protocolFilter.ts:68-114`), 호출 계층 (`:115-229`), 접기 (`:230-233`), 작업 공간 심볼 (`:234-268`), 정의로 이동 (`vendor/vscode-cpptools/Extension/src/LanguageServer/goToDefinition.ts:38`). 완성과 서명 도움은 직접 등록한 곳이 없어 표준으로 가는 것으로 보인다(추정).
- 설정은 `workspace/configuration`이 아니라 `cpptools/didChangeSettings`로 통째로 보낸다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1846-1849`). 편집기 상태(활성 편집기, 선택, 보이는 범위)도 전용 알림으로 보낸다 (`:622`, `:625`, `:638-639`). 엔진은 창 다시 읽기, 문서 언어 바꾸기 같은 화면 지시를 보낸다 (`:649`, `:661-665`).
- 결론: LSP 틀 위에 전용 프로토콜을 얹은 것이다. 일반 LSP 클라이언트를 붙이면 설정을 줄 길이 없고 진단·호버·참조·이름 바꾸기를 받지 못한다.

e. 변경 감지와 재시작
- `c_cpp_properties.json`의 생성·삭제·변경을 감시해 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:262-278`) 다시 읽고 `cpptools/didChangeCppProperties`를 보낸다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:3405`).
- `compile_commands.json`은 파일마다 `fs.watch`를 걸고 1초 뒤 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:1163-1201`) `cpptools/didChangeCompileCommands`를 보낸다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:3480-3486`).
- 작업 폴더 전체를 `**/*`로 감시해 파일 생성·변경·삭제를 엔진에 알린다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:2747-2816`). Linux 감시 한도에 걸릴 수 있다는 경고가 주석에 있다 (`:2746`).
- 설정 변경은 다시 보낸다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:293-311`). 엔진 종류를 바꾸면 창을 다시 읽으라고 한다 (`vendor/vscode-cpptools/Extension/src/main.ts:109-122`).
- 충돌: 다섯 번 미만이면 클라이언트를 새로 만들고 열린 문서를 다시 연다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1731-1747`, `vendor/vscode-cpptools/Extension/src/LanguageServer/clientCollection.ts:112-152`). 3분 안에 다섯 번이면 아무 일도 하지 않는 대체 클라이언트로 바꾸고 재시작하지 않는다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1769-1770`, `:4534`).
- 수동 명령: 데이터베이스 초기화, 작업 공간 다시 훑기, 파일의 IntelliSense 재시작, 컴파일러 다시 찾기 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:397`, `:427`, `:450`, `:454`).

f. 실패 처리와 화면
- 설정이 없을 때: 설정 제공자, `compile_commands.json`, 컴파일러 정보가 모이거나 15초가 지나면 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1442-1446`, `:3131-3135`) 상태 표시줄에 경고색 "Configure IntelliSense"를 띄운다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/ui.ts:438-451`). 누르면 제공자, `compile_commands.json`, 컴파일러, 직접 찾기, 설치, 설정 안 함이 한 목록에 나온다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1110-1166`).
- 진행 상태: 언어 상태 항목 세 개(IntelliSense, 태그 파서, 코드 분석)가 있다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/ui.ts:112`, `:139`, `:253`). 엔진이 보내는 "C_Cpp: Parsing" 같은 문자열을 끝말로 판별해 갱신한다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:2905-2964`).
- 설정 파일 오류: `c_cpp_properties.json`의 없는 경로 등을 클라이언트가 검사해 그 파일에 밑줄로 표시한다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:1736-1781`, `:1866-1880`). 같은 내용을 폼으로 고치는 웹뷰가 있다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/settingsPanel.ts:116-122`).
- 제공자가 제때 답하지 않으면 "{0} is unable to provide IntelliSense configuration information…"을 띄우고 파일 설정으로 돌아간다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:2427-2429`).
- 충돌 기록 폴더를 감시해 호출 스택을 출력 채널과 원격 측정으로 보낸다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:1238-1280`, `:1600-1608`).

범위 밖이라 크기만 적는다. 디버거 3,502줄, SSH 1,839줄, Copilot 연동 약 1,260줄(`copilot*.ts`, `lmTool.ts`, `Providers/CopilotHoverProvider.ts`), 빌드 태스크 569줄. 리팩터링(선언/정의 만들기, 함수 추출)은 `client.ts` 안에 있다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:605-606`).

### 2. VS Code에 묶인 정도

- 센 방법: 요청하신 정규식을 `Extension/src`에 돌리고, 이름으로 가져온 파일 하나(`vendor/vscode-cpptools/Extension/src/LanguageServer/cppBuildTaskProvider.ts:9`)의 `window.`·`workspace.`·`tasks.` 사용을 따로 세어 더했다. 126개 파일 중 61개가 `vscode`를 가져온다.

| 네임스페이스 | `src` 전체 | 그중 `LanguageServer/` |
| --- | --- | --- |
| window | 193 | 129 |
| workspace | 137 | 94 |
| commands | 124 | 96 |
| languages | 30 | 27 |
| env | 14 | 12 |
| tasks | 7 | 4 |
| debug | 6 | 1 |
| extensions | 5 | 4 |
| lm | 1 | 1 |
| tests, notebooks, chat, authentication, l10n | 0 | 0 |

- 지역화는 `vscode.l10n`이 아니라 `vscode-nls`다 (`vendor/vscode-cpptools/Extension/src/main.ts:17`, `:30`).
- 필요한 화면(식별자 출현 수): 상태 표시줄 항목 3과 언어 상태 항목 3, 빠른 선택 22, 알림(오류 38, 정보 23, 경고 17), 출력 채널 8, 웹뷰 패널 1, 트리 뷰 1(참조 결과), 워크스루 1, 터미널 8, 태스크 제공자 1, 디버그 설정 제공자 2, 언어 모델 도구 1, 진행 알림 6, 편집기 장식 1. 테스트 API는 쓰지 않는다.
- VS Code 없이도 뜻이 있는 것: 설정 우선순위와 합치는 규칙(`configurations.ts`), `c_cpp_properties.json` 형식, 제공자가 주는 자료의 모양, 감시와 충돌 정책. 다만 모두 비공개 엔진에 넘길 입력을 만드는 일이라 엔진 없이는 쓸 곳이 없다.
- VS Code 안에서만 뜻이 있는 것: 제공자 등록 API(다른 확장이 같은 확장 호스트에 있어야 한다), 언어 상태 항목, 웹뷰, 워크스루, 태스크, 디버그, Copilot 연동, 원격 측정.

### 3. VS Code 없이 쓸 수 있는 부품

- 엔진 실행 파일(`cpptools`, `cpptools-srv`, `cpptools-srv2`): 쓸 수 없다. 비공개이고 5절의 조항이 Microsoft 제품과 함께 쓰는 것만 허락한다.
- `clang-format`, `clang-tidy`: VSIX의 `LLVM/bin`에 들어 온다 (`vendor/vscode-cpptools/Extension/src/main.ts:196-197`). 이 저장소에는 없다. LLVM에서 따로 구할 수 있는 일반 도구다.
- `c_cpp_properties.schema.json`과 클라이언트 TypeScript: MIT 저장소의 파일이라 형식과 합치는 규칙을 읽고 따라 만들 수 있다.
- npm `vscode-cpptools` ^7.1.1: 제공자 API의 형식 선언이다 (`vendor/vscode-cpptools/Extension/package.json:7322`). 패키지가 저장소에 없어 라이선스는 확인하지 못했다.
- 디버그 어댑터(`OpenDebugAD7`, vsdbg): 범위 밖이다. vsdbg 조건문에도 같은 제한 조항이 있다 (`vendor/vscode-cpptools/RuntimeLicenses/vsdbg-LICENSE.txt:19-22`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

- 엔진: 이 확장은 비공개 엔진을 쓴다. Zed와 Setdown은 clangd를 쓴다 (`vendor/zed/crates/languages/src/lib.rs:99-105`, `apps/desktop/src/core/document/supported-languages.ts:9`).
- 컴파일러와 include 경로: 이 확장은 엔진이 컴파일러에 질의하고 클라이언트가 22개 설정과 파일을 합친다. Setdown에는 그런 단계가 없고 `compile_commands.json`이 있는 폴더를 clangd에 알려 줄 뿐이다 (`apps/desktop/src/main/language/analysis-context.ts:152-167`). Zed 어댑터에는 그것도 없다 (`vendor/zed/crates/languages/src/c.rs`).
- 설정이 없을 때: 이 확장은 `${workspaceFolder}/**` 재귀 include와 신뢰한 컴파일러로 일단 동작한다. Setdown은 "Choose a build folder or configure this project…"라는 문제를 내고 (`apps/desktop/src/main/language/analysis-context.ts:172`), 사람이 누르면 `cmake -S <루트> -B <앱 데이터 폴더> -DCMAKE_EXPORT_COMPILE_COMMANDS=ON`이나 `meson setup`을 직접 실행해 데이터베이스를 만든다 (`apps/desktop/src/main/language/analysis-preparation.ts:20-23`, `apps/desktop/src/main/language/language-manager.ts:375-383`).
- 빌드 시스템 연결: 이 확장은 CMake Tools가 파일별 설정을 API로 준다. Setdown은 `CMakePresets.json`에서 문자 그대로의 `binaryDir`만 읽고 매크로는 풀지 않는다 (`apps/desktop/src/main/language/analysis-context.ts:140-151`).
- 프로젝트 범위: 이 확장은 작업 폴더가 단위이고 엔진 하나를 같이 쓴다. Setdown은 파일에서 위로 올라가며 `.clangd`, `compile_commands.json`, `compile_flags.txt`, `.git`, `CMakeLists.txt`를 찾아 루트를 정하고 (`apps/desktop/src/main/language/catalog/profiles.json:153-159`, `apps/desktop/src/main/language/language-root.ts:82-94`), 도구·루트·설정마다 서버를 따로 띄운다 (`apps/desktop/src/main/language/language-manager.ts:656-657`).
- 화면: 이 확장은 상태 표시줄 경고와 빠른 선택, 웹뷰 설정 화면이다. Setdown은 분석 맥락에 문제 세 가지(`compilation-missing`, `compilation-choice`, `compilation-unknown`)를 붙이고 (`apps/desktop/src/main/language/analysis-context.ts:164`, `:169`, `:172`) 빌드 폴더 선택 대화상자를 연다 (`apps/desktop/src/main/language/language-manager.ts:804-806`).
- 프로토콜: Setdown의 클라이언트는 표준 LSP 메서드만 처리한다 (`apps/desktop/src/main/language/server-session.ts:94-146`). 라이선스가 허락하더라도 이 엔진과는 말이 통하지 않는다.

### 5. 이 확장을 그대로 돌린다면

호스트가 줄 것
- VS Code API 1.82 이상과 2절의 네임스페이스 전부. 특히 언어 기능 제공자 등록, 진단 모음, 언어 상태 항목, 웹뷰 패널, 문서 내용 제공자 (`vendor/vscode-cpptools/Extension/src/main.ts:63`), 태스크, 디버그 어댑터, 터미널, `environmentVariableCollection`, 전역·작업 공간 상태 저장 (`vendor/vscode-cpptools/Extension/src/LanguageServer/persistentState.ts:56`, `:62`), 내장 명령 `markdown.showPreview` (`vendor/vscode-cpptools/Extension/src/main.ts:327`).
- 제안 API 두 개. `terminalDataWriteEvent`는 SSH 쪽에서 쓴다 (`vendor/vscode-cpptools/Extension/src/SSH/commandInteractors.ts:375-381`). `chatParticipantAdditions`의 사용처는 소스에서 찾지 못했다.
- `references-view` 뷰 컨테이너 (`vendor/vscode-cpptools/Extension/package.json:869`). VS Code 내장 확장이 주는 것으로 보인다(추정).
- 설정 제공자를 쓰려면 CMake Tools 같은 확장도 같은 호스트에서 돌아야 한다.

막는 것
- 라이선스. 엔진에 적용되는 조건문 (`vendor/vscode-cpptools/RuntimeLicenses/cpptools-LICENSE.txt:19-22`): "You may install and use any number of copies of the software only with Microsoft Visual Studio, Visual Studio for Mac, Visual Studio Code, Azure DevOps, Team Foundation Server, and successor Microsoft products and services to develop and test your applications." 같은 문서가 금지하는 일 (`:59-62`): "share, publish, distribute, or lease the software (except for any distributable code, subject to the terms above), provide the software as a stand-alone offering for others to use, or transfer the software or this agreement to any third party." 첫머리 (`:1-3`): "All VS Marketplace extensions, including this C/C++ Extension for Visual Studio Code, must also be used consistent with the VS Marketplace Terms of Use". `cpptools-srv-LICENSE.txt`는 이 파일과 내용이 같다(diff로 확인). Setdown은 Microsoft 제품이 아니므로 엔진을 함께 쓰는 것도, 배포하는 것도 허락되지 않는다.
- 비공개 엔진. MIT인 클라이언트만으로는 `Missing binary`에서 멈춘다 (`vendor/vscode-cpptools/Extension/src/LanguageServer/client.ts:1646-1651`).
- 배포 경로. 저장소가 알려 주는 입수 방법은 Marketplace에서 설치하는 것 하나다 (`vendor/vscode-cpptools/Documentation/Building the Extension.md:17-19`). Marketplace 약관의 내용과 Open VSX 게시 여부는 이 저장소로는 확인할 수 없다.

허락된다면 얻었을 것
1. `compile_commands.json` 없이도 동작하는 기본값: 컴파일러 질의, 재귀 include (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:410-414`), 태그 파서 엔진 (`vendor/vscode-cpptools/Extension/package.json:1422-1437`).
2. CMake Tools 등에서 파일별 설정을 받는 길. 데이터베이스 파일을 만들 필요가 없다.
3. MSVC와 Windows SDK 지원 (`vendor/vscode-cpptools/Extension/src/LanguageServer/configurations.ts:611-615`, `vendor/vscode-cpptools/Extension/src/LanguageServer/devcmd.ts:58-97`).
4. 이름 붙인 설정 여러 개를 두고 바꾸는 기능과 설정 화면.
5. clang-tidy 코드 분석, vcpkg 안내 (`vendor/vscode-cpptools/Extension/src/LanguageServer/extension.ts:229-246`), Doxygen 주석 생성.

이 가운데 1~3은 엔진이 하는 일이고, 클라이언트 TypeScript에 있는 것은 그 입력을 모으고 화면에 보이는 일이다.
