# VS Code 확장 분석: Rust, Go

작성일: 2026-11-19 · 소스만 읽고 썼다. 빌드, 설치, 실행은 하지 않았다. 기준: `vendor/rust-analyzer` `db89bd28`, `vendor/vscode-go` `3ab28d00`, `vendor/zed` `b5cd310b`(1.29), Setdown `d75384a`.

경로 줄임(모두 저장소 루트 기준): `RA/` = `vendor/rust-analyzer/editors/code/`, `RAS/` = `vendor/rust-analyzer/`, `GO/` = `vendor/vscode-go/extension/`, `GOD/` = `vendor/vscode-go/docs/`, `ZED/` = `vendor/zed/crates/`, `SD/` = `apps/desktop/src/main/language/`, `HOST/` = `tooling/language-host/src/`. 같은 파일을 이어서 인용할 때는 `:줄`만 적는다. "추정"은 읽은 코드에서 미루어 본 것이다. 기여 수는 `package.json`을 JSON으로 읽어 셌다.

## Rust: rust-analyzer (`vendor/rust-analyzer/editors/code`)

| 항목 | 값 |
| --- | --- |
| 버전 | `0.5.0-dev`. 배포 때 `xtask dist`가 버전과 `releaseTag`를 써넣는다 (`RA/package.json:7-8`, `RAS/xtask/src/dist.rs:82-88`) |
| 라이선스 | MIT OR Apache-2.0 (`RA/package.json:16`) |
| `engines.vscode` | `^1.144.0` (`RA/package.json:31`) |
| 클라이언트 소스 크기 | `RA/src` 21개 파일 7,246줄 (`RA/tests` 제외) |
| `extensionDependencies` | 없음 (필드 없음) |
| `enabledApiProposals` | `[]` (`RA/package.json:33`) |
| 기여 수 | commands 47, configuration 속성 219, views 2 + viewsContainers 1 (`RA/package.json:3974-4000`), taskDefinitions 1 (`:90`), problemMatchers 4, walkthroughs 1 (`:4011`), debuggers 0, semanticTokenTypes 38 |
| 언어 서버 | rust-analyzer. 실행 파일 하나, 같은 저장소(`RAS/crates/rust-analyzer`), MIT OR Apache-2.0 (`RAS/Cargo.toml:9`), 공개. 배포판 확장에는 플랫폼별 실행 파일이 `server/`에 들어간다 (`RAS/xtask/src/dist.rs:73-75`) |

### 1. 클라이언트가 하는 일

**a. 도구 확보** (`RA/src/bootstrap.ts`)

- 고르는 순서: ① 환경 변수 `__RA_LSP_SERVER_DEBUG` 또는 설정 `rust-analyzer.server.path` (`:48-54`) → ② 작업 폴더의 `rust-toolchain.toml`·`rust-toolchain`에 `rust-analyzer` 컴포넌트가 선언돼 있으면 그 폴더에서 `rustup which rust-analyzer`. 폴더마다 결과가 다르면 빌드 날짜가 이른 것 (`:57-85`, `:131-170`, `:182-200`) → ③ 개발 빌드(`releaseTag === null`)는 PATH의 `rust-analyzer` (`:87`) → ④ 확장 안의 `server/rust-analyzer` (`:90-107`) → ⑤ 없으면 "we don't ship binaries for your platform" 오류 알림 (`:109-117`).
- 고른 파일은 `--version`을 실행해 확인한다 (`:24-32`, `:202-223`).
- NixOS에서는 번들 파일을 globalStorage로 복사하고 `nix-build`로 patchelf한다 (`:95-105`, `:225-306`).
- 내려받기와 업데이트 코드는 없다(`RA/src`에서 download, fetch 검색 0건). 서버는 확장 버전에 묶여 온다. 이 저장소의 소스는 `releaseTag: null`이고 `server/` 폴더가 없어 ③으로 간다 (`RA/package.json:8`).

**b. 런타임·툴체인·환경 선택**

- 서버 환경 = 확장 호스트의 `process.env` + `server.extraEnv`. 값이 null이면 그 변수를 지우고 `${env:X}`, `${workspaceFolder}`, `${userHome}` 등을 치환한다 (`RA/src/ctx.ts:224-235`, `RA/src/config.ts:287-299`, `:482-558`, `:571-606`).
- `toolchain.ts`의 cargo·rustc·rustup 찾기(`$CARGO` 같은 환경 변수 → PATH → `$CARGO_HOME/bin` 또는 `~/.cargo/bin`)는 클라이언트가 실행·디버그 때 쓴다. 서버 쪽 구현을 그대로 옮긴 것이라고 적혀 있다 (`RA/src/toolchain.ts:157-167`, `:203-223`, `:254-271`).
- 툴체인을 고르는 화면은 없다. 서버가 "툴체인이 너무 오래됐다"고 알리면 rust-toolchain 파일에 컴포넌트를 추가하라는 모달을 띄운다 (`RA/src/ctx.ts:270-280`, `:611-646`).

**c. 프로젝트 범위와 가져오기**

- 활성화 조건: 작업 폴더나 한 단계 아래의 `Cargo.toml`, `rust-project.json`, `.rust-project.json` (`RA/package.json:80-87`).
- 클라이언트는 프로젝트를 찾지 않는다. 폴더가 열려 있으면 표준 작업 폴더만 가고, 폴더 없이 `.rs`만 열려 있으면 그 파일들을 `initializationOptions.detachedFiles`에 넣는다 (`RA/src/ctx.ts:42-55`, `:243-248`). 찾는 일은 서버가 한다: 폴더에서 위로 `rust-project.json` → `.rust-project.json` → `Cargo.toml` (`RAS/crates/project-model/src/lib.rs:133-141`, `RAS/crates/rust-analyzer/src/config.rs:1806`).
- `linkedProjects`와 `workspace.discoverConfig`는 설정값으로 서버에 갈 뿐이다 (`RA/package.json:2782`, `:3279`). "이 파일을 linkedProjects에 넣을까요" 알림 코드는 조건이 `"temporary-disabled"`로 꺼져 있다 (`RA/src/client.ts:65-73`).
- 설정 전달: `rust-analyzer.*` 전체를 변수 치환해 `initializationOptions`로 보내고 (`RA/src/ctx.ts:241-250`, `RA/src/config.ts:242-262`), 서버의 `workspace/configuration`(`rust-analyzer` 섹션만 허용)에 같은 값으로 답한다 (`RA/src/client.ts:31-51`). 설정이 바뀌면 빈 `didChangeConfiguration`을 보내 서버가 다시 묻게 한다 (`RA/src/main.ts:102-110`). 다른 확장이 값을 덮어쓰는 API `addConfiguration`이 있다 (`RA/src/main.ts:13-22`, `RA/src/config.ts:72-93`).

**d. 표준 LSP 밖의 통신**

- `lsp_ext.ts`에 요청 31개와 알림 10개가 정의돼 있다. 이름은 `rust-analyzer/*`, `experimental/*` 40개다 (`RA/src/lsp_ext.ts:30-228`).
- `experimental` 능력 선언: `snippetTextEdit`, `codeActionGroup`, `hoverActions`, `serverStatusNotification`, `colorDiagnosticOutput`, `openServerLogs`, `localDocs`, `testExplorer`, 그리고 서버가 부를 클라이언트 명령 6개(`runSingle`, `debugSingle`, `showReferences`, `gotoLocation`, `triggerParameterHints`, `rename`) (`RA/src/client.ts:314-336`).
- 미들웨어: hover를 선택 범위와 함께 보내고 응답의 actions를 명령 링크로 그린다 (`:154-182`, `:401-422`). code action을 그룹으로 묶고 resolve를 직접 한다 (`:183-275`). 진단의 `data.rendered`로 rustc 원문을 여는 링크를 단다 (`:123-150`).
- 받는 알림: `experimental/serverStatus` → 상태 표시줄, `rust-analyzer/openServerLogs` → 출력 채널 (`RA/src/ctx.ts:260-269`).

**e. 변경 감지와 재시작**

- `Cargo.toml`이 바뀌어도 클라이언트는 재시작하지 않는다. 파일 감시 기본값이 `client`라서 (`RA/package.json:1709-1711`) 서버가 `workspace/didChangeWatchedFiles`를 동적으로 등록한다 (`RAS/crates/rust-analyzer/src/reload.rs:561`, `:636-648`). 감시 자체는 vscode-languageclient가 한다(추정: 라이브러리 코드는 읽지 않았다). 서버는 `Cargo.toml`·`Cargo.lock` 변경에 작업공간을 다시 읽는다 (`:1001-1017`).
- 재시작이 필요한 설정은 `server.*`, `files.*`, `showSyntaxTree`뿐이다. `restartServerOnConfigChange`가 꺼져 있으면(기본값) "Restart now" 알림으로 묻는다 (`RA/src/config.ts:34-36`, `:123-140`, `RA/package.json:464-467`).
- 폴더 없이 연 파일의 목록이 바뀌면 서버를 내렸다 올린다 (`RA/src/ctx.ts:170-193`).
- 수동 명령: start, stop, restart, `reloadWorkspace`, `rebuildProcMacros` (`RA/src/main.ts:145-175`, `RA/src/commands.ts:965-971`).

**f. 실패 처리와 화면**

- 상태 표시줄 항목 하나. health가 ok, warning, error, stopped로 색과 아이콘이 바뀌고, 분석이 끝나지 않았으면 회전 아이콘이 붙는다. 도구 설명에 서버 메시지와 명령 링크 6개가 들어간다 (`RA/src/ctx.ts:509-574`). 메시지 내용(작업공간 발견 실패, 빌드 스크립트 실패 등)은 서버가 만든다 (`RAS/crates/rust-analyzer/src/reload.rs:128-180`).
- 시작 실패: "Cannot start rust-analyzer server: …" 알림을 띄우고 stopped 상태로 활성화를 마친다 (`RA/src/main.ts:116-134`). 실행 파일 확보 실패는 출력 채널을 보라는 문장으로 바뀐다 (`RA/src/ctx.ts:285-297`).
- 출력 채널 3개: "rust-analyzer Extension" (`RA/src/util.ts:26`), "rust-analyzer Language Server" (`RA/src/ctx.ts:205`), "rust-analyzer LSP Trace" (`:201`).
- 디버그(`debug.ts` 454줄), 테스트 탐색기(`test_explorer.ts` 212줄), 실행·태스크(`run.ts` 295줄, `tasks.ts` 146줄), 새 프로젝트(`new_project.ts` 311줄)는 있다는 것만 적는다.

### 2. VS Code에 묶인 정도

- `vscode.<이름공간>.<멤버>` 198건: window 86, workspace 64, commands 17, extensions 5, tasks 4, env 4, debug 3, languages 2, tests 1. notebooks, lm, chat, authentication, l10n은 0건이다. 이름으로 가져온 것은 `WorkspaceEdit` 하나라서 숨은 사용은 없다 (`RA/src/client.ts:8`). 21개 파일 중 19개가 `vscode`를 가져온다(제외: `lsp_ext.ts`, `crate_graph.ts`). 세는 법은 과제의 grep과 `import {…} from "vscode"` 검색이다.
- 화면 요소: 상태 표시줄 1 (`RA/src/ctx.ts:130`), 알림(오류 13, 정보 9, 경고 3곳), quick pick (`RA/src/commands.ts:997`), 출력 채널 3, 웹뷰 2 (`RA/src/commands.ts:859`, `:1337`), 트리 뷰 2 (`RA/src/ctx.ts:325`, `:371`), walkthrough 1, 가상 문서 제공자 6, 태스크, 디버그, 테스트 (`RA/src/ctx.ts:136`).
- VS Code 없이도 뜻이 있는 것: 서버를 고르는 순서, `extraEnv` 치환, 능력 선언 목록, `serverStatus`의 뜻, `detachedFiles`.
- VS Code 안에서만 뜻이 있는 것: `command:` 링크로 그리는 hover action, code action 그룹 선택, Enter 규칙 (`RA/src/config.ts:149-229`), 뷰, 웹뷰, walkthrough, 태스크, 디버그, 테스트.

### 3. VS Code 없이 쓸 수 있는 부품

- `rust-analyzer` 실행 파일. 인자 없이 실행하면 stdio LSP다. 확장도 `command`만 준다 (`RA/src/ctx.ts:232-235`). 얻는 길은 GitHub 릴리스의 `rust-analyzer-<target>.gz` (`RAS/docs/book/src/rust_analyzer_binary.md:3-16`)와 `rustup component add rust-analyzer` (`:46`)다. MIT OR Apache-2.0.
- 비표준 통신 명세 문서 (`RAS/docs/book/src/contributing/lsp-extensions.md:10-17`).
- npm 패키지는 없다. 확장 패키지는 `private`이다 (`RA/package.json:5`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown에서 rust-analyzer는 아직 자체 클라이언트 경로다 (`SD/zed-settings.ts:12`).

1. 서버 얻기. 확장은 번들뿐이고 내려받지 않는다 (`RA/src/bootstrap.ts:90-107`). Zed는 rustup override → PATH(`--help`로 실행 확인) → GitHub 최신 릴리스 내려받기(SHA-256 대조) 순이다 (`ZED/languages/src/rust.rs:755-810`, `:812-836`, `:838-925`). Setdown은 자체 경로에서도 실행 파일을 이 Zed 어댑터에 묻는다 (`SD/language-manager.ts:552-575`, `HOST/main.rs:163-168`).
2. rustup override 조건. 확장은 toolchain 파일에 `rust-analyzer` 컴포넌트가 선언돼 있을 때만 쓴다 (`RA/src/bootstrap.ts:65`, `:182-189`). Zed는 toolchain 파일이 있기만 하면 쓴다 (`ZED/languages/src/rust.rs:205-255`).
3. 환경. 확장은 확장 호스트 환경 + `extraEnv` (`RA/src/ctx.ts:224-231`). Zed는 작업 폴더의 셸 환경 (`ZED/languages/src/rust.rs:213`, `:763`). Setdown은 프로젝트 루트에서 로그인 셸 환경을 떠 온다 (`HOST/main.rs:262-268`, `SD/language-manager.ts:566-567`).
4. 프로젝트 루트. 확장은 작업 폴더를 그대로 주고 발견은 서버가 한다 (`RA/src/ctx.ts:42-55`). Zed는 가장 바깥 `Cargo.toml`의 폴더다 (`ZED/languages/src/rust.rs:280-303`). Setdown은 `Cargo.toml`의 `[workspace] members/exclude`와 `package.workspace`를 직접 읽어 작업공간 루트를 정한다 (`SD/language-root.ts:49-72`).
5. 상태 알림. 확장과 Zed는 `serverStatusNotification`을 선언하고 받는다 (`RA/src/client.ts:319`, `ZED/lsp/src/lsp.rs:1142-1145`, `ZED/project/src/lsp_store/rust_analyzer_ext.rs:26-83`). Setdown 자체 클라이언트의 능력 선언에는 `experimental`이 없고 받는 코드도 없다 (`apps/desktop/src/protocol/language-features.ts:34-40`, `SD/server-session.ts:94-144`).
6. 변경 감지. 확장은 서버가 등록한 감시를 클라이언트가 수행하고 재시작하지 않는다(1e). Setdown은 프로필에서 `files.watcher: "server"`로 서버가 직접 감시하게 하고 (`SD/catalog/profiles.json:317-319`), `Cargo.toml`, `Cargo.lock`, `rust-toolchain(.toml)`, `.cargo/config.toml`이 바뀌면 세션을 다시 잇는다 (`SD/analysis-context.ts:176-178`, `SD/language-manager.ts:697-701`).
7. 서버가 부르는 클라이언트 명령. 확장 6개 (`RA/src/client.ts:325-332`), Zed 4개와 설정 시 `runSingle` (`ZED/languages/src/rust.rs:704-712`), Setdown 0개(5와 같은 근거).

### 5. 이 확장을 그대로 돌린다면

- 호스트가 줘야 하는 것: VS Code API 1.144 수준 (`RA/package.json:31`). 의존 확장과 proposed API는 없다 (`:33`). `workspaceContains` 활성화 (`:80-87`), 설정 219개의 기본값을 돌려주는 `getConfiguration`, `globalState`와 `workspaceState` (`RA/src/ctx.ts:146`, `RA/src/config.ts:43`), 상태 표시줄, 출력 채널, 알림, `command:` 링크가 되는 Markdown, 명령 등록, 가상 문서, 트리 뷰, 웹뷰, 태스크·디버그·테스트 API. 언어 기능은 `vscode-languageclient ^9.0.1`이 `vscode.languages.*` 제공자로 등록한다 (`RA/package.json:57`; 추정: 라이브러리 코드는 읽지 않았다).
- 막는 것: Setdown에는 확장 호스트가 없다(과제 전제). 확장에는 서버를 내려받는 코드가 없어서, 배포판 VSIX의 `server/` 파일이 없으면 PATH에 의존한다(1a).
- 얻는 것:
  1. 서버 상태 문장(작업공간 발견 실패, 빌드 스크립트 실패, proc-macro 재빌드 필요)과 "분석 중" 표시 (`RA/src/ctx.ts:509-574`).
  2. hover action, code action 그룹, snippet 편집 (`RA/src/client.ts:316-318`).
  3. rustc 원문 진단 보기 (`RA/src/client.ts:123-150`).
  4. 명령 47개: 매크로 펼치기, crate 그래프, 문서 열기, 구조 검색·치환, 실행·디버그 (`RA/src/main.ts:139-239`).
  5. NixOS 패치와 오래된 툴체인 안내 (`RA/src/bootstrap.ts:251-306`, `RA/src/ctx.ts:617-646`).
- 1은 확장 없이도 얻을 수 있다. Zed가 같은 알림을 받고 (`ZED/project/src/lsp_store/rust_analyzer_ext.rs:31-83`) Setdown 호스트가 `project.status`로 내보낸다 (`HOST/project_host.rs:257-264`). 다만 받는 쪽은 지금 시작을 기다리는 채널에만 쓴다 (`SD/project-languages.ts:316-317`, `:333-343`).
- 서버 확보는 얻는 것이 아니다. 확장은 내려받지 않고, Setdown은 Zed 어댑터로 이미 내려받는다(4의 1).

## Go: Go (`vendor/vscode-go/extension`)

| 항목 | 값 |
| --- | --- |
| 버전 | `0.60.0-dev` (`GO/package.json:4`) |
| 라이선스 | MIT (`GO/package.json:10`) |
| `engines.vscode` | `^1.125.0`. `node >=24.15.0`도 적혀 있다 (`GO/package.json:92-94`) |
| 클라이언트 소스 크기 | `GO/src` 84개 파일 22,558줄 (`GO/test` 제외). 그중 `debugAdapter/` 2,862줄, `goTest/` 2,226줄, `language/` 3,123줄 |
| `extensionDependencies` | `[]` (`GO/package.json:53`) |
| `enabledApiProposals` | 없음 (필드 없음) |
| 기여 수 | commands 67 (`GO/package.json:205`), configuration 최상위 속성 67과 `gopls` 객체 아래 43 (`:1202`, `:2078`), views 3 (`:4002`), debuggers 1 (`:561`), taskDefinitions 1 (`:4027`), languages 6, walkthroughs 0 |
| 언어 서버 | gopls (`golang.org/x/tools/gopls`). 확장에 들어 있지 않고 사용자 기기에서 `go install`로 빌드한다 (`GO/src/goInstallTools.ts:365-377`). 소스는 이 저장소에 없다. 공개, BSD-3-Clause(Setdown 카탈로그 표기 `SD/catalog/mason.json:3176-3178`; 원본 LICENSE는 확인하지 못했다) |

### 1. 클라이언트가 하는 일

**a. 도구 확보**

- 도구 표: 13개(gopls, dlv, staticcheck, goimports, gofumpt, golangci-lint 등)의 import 경로, 고정 버전, 최소 Go 버전 (`GO/src/goToolsInformation.ts:7-168`). gopls는 최소 Go 1.19, 표에 적힌 최신은 v0.24.0이다 (`:127-141`).
- 필요한 도구: gotests, impl, goplay(와 64비트에서 dlv), 설정한 포맷터와 린터, `go.useLanguageServer`가 켜져 있으면 gopls. gopls를 쓰면 gopls가 대신하는 도구(gotests)는 뺀다 (`GO/src/goTools.ts:138-180`, `GO/src/goToolsInformation.ts:56-62`).
- 찾는 순서: `go.alternateTools`의 절대 경로 → `GOBIN` → `go.toolsGopath`와 현재 GOPATH의 `bin` → GOROOT/bin → PATH → (go만) `/usr/local/go/bin/go` 같은 기본 위치 (`GO/src/utils/pathUtils.ts:60-133`, `GO/src/util.ts:307-331`).
- 설치: `go install -v <경로>@<버전>`을 자식 프로세스로 돌린다 (`GO/src/goInstallTools.ts:365-377`). 버전은 Go 버전별 고정표(Go 1.19 미만 → gopls v0.14.2, 1.21 미만 → v0.15.3) → 도구의 `defaultVersion` → `@latest` 순으로 정한다 (`GO/src/goTools.ts:62-106`). 설치에 쓰는 Go는 1.21 이상이어야 한다 (`GO/src/goInstallTools.ts:49`, `:184-194`).
- 설치 환경은 따로 만든다. GOPATH를 정하고 `GOTOOLCHAIN=auto`를 넣고 GOOS, GOARCH, GOROOT, GOFLAGS, GOENV, GO111MODULE을 지운다 (`GO/src/goEnv.ts:17-49`). 프로젝트의 Go가 설치용 Go보다 새로우면 `GOTOOLCHAIN=go<버전>+auto`로 바꾼다 (`GO/src/goInstallTools.ts:196-212`).
- 활성화 때 "중요" 표시가 붙은 필요한 도구가 없으면 묻지 않고 설치한다 (`GO/src/goMain.ts:136`, `GO/src/goInstallTools.ts:606-655`). 중요 표시는 gopls, goimports, staticcheck, golangci-lint(v1, v2), revive에 있다 (`GO/src/goToolsInformation.ts:51`, `:87`, `:98`, `:110`, `:122`, `:134`). 기본 설정은 포맷터와 린터를 지정하지 않으므로 gopls 하나가 된다 (`GO/src/language/legacy/goFormat.ts:154-164`, `GO/package.json:1277-1279`). 그 밖의 도구는 쓰려는 순간 "Install / Install All" 알림으로 묻는다 (`GO/src/goInstallTools.ts:391-450`).
- 업데이트: 시작 10분 뒤부터 하루 한 번 gopls 버전을 본다 (`GO/src/language/goLanguageServer.ts:163-220`). 최신 버전은 `go list -m -versions`(모듈 프록시) 결과나 표의 값이다 (`:1177-1251`, `GO/src/goInstallTools.ts:759-795`). `autoUpdate`가 켜져 있으면 조용히 설치하되, 새 마이너 버전은 첫날 10%, 사흘째까지 30%의 기기만 받는다 (`GO/src/language/goLanguageServer.ts:137-157`, `:177-190`). 꺼져 있으면 "Always Update / Update Once / Release Notes" 알림을 띄운다 (`GO/src/goInstallTools.ts:452-525`).
- Go가 바뀌면 도구를 빌드한 Go 버전을 `go version -m`으로 읽어 재컴파일을 권한다 (`:802-844`, `:877-967`).
- 원격 측정 도우미 `vscgo`를 확장 폴더에 `go install`한다 (`GO/src/goMain.ts:119-130`, `GO/src/goInstallTools.ts:974-1019`).

**b. 런타임·툴체인·환경 선택**

- `go` 고르기: `go.goroot` 설정 → "Choose Go Environment"로 고른 값(작업공간 상태 `selectedGo`) → `go.alternateTools.go` → GOROOT/bin → PATH → 기본 위치 (`GO/src/util.ts:307-331`, `GO/src/utils/pathUtils.ts:60-133`).
- 활성화 때 `go env -json GOPATH GOROOT GOPROXY GOBIN GOMODCACHE`를 돌려 확장 호스트의 `process.env`를 채운다. PATH에서 찾은 go가 아니면 GOROOT/bin을 `process.env.PATH` 앞과 통합 터미널의 PATH에 넣는다 (`GO/src/goInstallTools.ts:527-599`, `GO/src/goEnvironmentStatus.ts:324-378`). gopls는 이 환경을 물려받아 같은 go를 찾는다 (`GO/src/goInstallTools.ts:582-587`).
- gopls의 환경 = `process.env` + `go.toolsEnvVars`(`${env:X}` 치환) + VS Code의 `http.proxy` + GOPATH (`GO/src/goEnv.ts:53-90`, `GO/src/language/goLanguageServer.ts:1091`, `:412-416`).
- GOPATH: `go.inferGopath`(위로 `src` 폴더 찾기, go.mod가 있으면 무효) → `go.gopath` → 환경 변수 (`GO/src/util.ts:345-383`).
- Go 버전 고르기 화면: `$HOME/sdk`의 설치본, `go.dev/dl/?mode=json`의 내려받을 수 있는 버전, 파일 선택. 내려받기는 `go install golang.org/dl/goX` 뒤 `goX download`다. 고른 뒤 창을 다시 읽어야 적용된다 (`GO/src/goEnvironmentStatus.ts:76-148`, `:154-226`, `:231-293`, `:472-543`). `go.goroot`나 GOROOT 환경 변수가 있으면 전환하지 않는다 (`:56-71`).
- GOTOOLCHAIN: 프로젝트용 값은 사람이 `go.toolsEnvVars`에 넣는다. Go explorer 뷰에서 편집할 수 있다 (`GOD/ui.md:22-30`, `GO/src/goExplorer.ts:227-229`, `:264`). 클라이언트가 스스로 정하는 곳은 도구 설치 환경뿐이다 (`GO/src/goEnv.ts:36`, `GO/src/goInstallTools.ts:211`).

**c. 프로젝트 범위와 가져오기**

- 활성화: `onLanguage:go` 등 (`GO/package.json:96-104`).
- 클라이언트는 go.mod, go.work로 루트를 정하지 않는다. 클라이언트 옵션에 작업 폴더 지정이 없어 VS Code 작업 폴더가 그대로 간다 (`GO/src/language/goLanguageServer.ts:419-434`). 모듈과 go.work 해석은 gopls가 한다(추정: gopls 소스가 저장소에 없다). 문서는 "VS Code 프로젝트마다 gopls 하나"라고 적는다 (`GOD/tools.md:19`).
- 클라이언트가 모듈에 대해 아는 것은 `go env GOMOD GOWORK` 결과뿐이고, 상태 메뉴의 "Open go.mod / go.work"와 테스트·린트 명령에 쓴다 (`GO/src/goModules.ts:18-77`, `GO/src/goStatus.ts:52-66`, `:90-97`).
- gopls를 띄우지 않는 경우: 다중 루트에서 폴더마다 GOPATH가 다를 때 (`GO/src/language/goLanguageServer.ts:1130-1138`), 작업 폴더가 `vsls`·`ssh`이거나 `file`이 하나도 없을 때 (`GO/src/commands/startLanguageServer.ts:105-129`).
- 설정 전달: `gopls` 섹션에서 사람이 실제로 바꾼 값만 남긴다 (`GO/src/language/goLanguageServer.ts:898-928`). `go.buildFlags`와 `go.buildTags`는 `build.buildFlags`로 (`:936-954`), `go.inlayHints`는 `ui.inlayhint.hints`로, `go.diagnostic.vulncheck`는 `ui.vulncheck`로 옮기고 `linkifyShowMessage`를 켠다(각각 gopls 버전 조건) (`:988-1026`). 같은 가공을 `initializationOptions`와 `workspace/configuration` 응답에 쓴다 (`:397`, `:424`, `:796-824`).

**d. 표준 LSP 밖의 통신**

- `experimental` 능력: `progressMessageStyles: ['log']` (`GO/src/language/goLanguageServer.ts:361-372`), `interactiveResolve`(입력 유형 6개) (`GO/src/language/form.ts:584-591`). gopls 전용 semantic token modifier 13개를 능력 선언에 더한다. gopls 0.24부터 선언하지 않은 것은 걸러진다고 적혀 있다 (`GO/src/language/goSemanticTokens.ts:35-49`, `:52-74`).
- 자체 요청: `command/resolve`, `interactive/listEnum`. 명령이 입력을 요구하면 폼을 띄워 답을 모은다 (`GO/src/language/form.ts:521-578`, `:703-713`; 파일 1,250줄).
- 미들웨어: 선택 범위를 hover와 typeDefinition에 붙인다 (`GO/src/language/goLanguageServer.ts:483-528`). `style: log` 진행 알림을 터미널로 보낸다 (`:529-568`). `gopls.tidy`와 `gopls.vulncheck` 전에 전체 저장한다 (`:605-623`). "run test" code lens를 확장 명령으로 바꾼다 (`:684-706`, `:1029-1071`). 포맷터가 설정돼 있으면 gopls 대신 외부 포맷터를 쓴다 (`:707-719`). 완성 목록의 순서를 고정한다 (`:720-777`). gopls 진단이 오면 build·vet·lint 진단의 중복을 지운다 (`GO/src/diagnostics/diagnostics.ts:75-116`).
- 클라이언트가 `workspace/executeCommand`로 부르는 gopls 명령은 14종이다(`gopls.package_symbols`, `gopls.vulncheck`, `gopls.add_import`, `gopls.tidy` 등; `GO/src`에서 `'gopls.*'` 검색).

**e. 변경 감지와 재시작**

- 재시작하는 설정: `go.useLanguageServer`, `go.languageServerFlags`, `go.alternateTools`, `go.toolsEnvVars`, `go.formatTool` (`GO/src/goMain.ts:267-276`).
- gopls를 새로 설치하면 재시작한다 (`GO/src/goInstallTools.ts:268-271`). 수동 명령은 `go.languageserver.restart`다 (`GO/src/goMain.ts:133`). 재시작은 뮤텍스로 한 번에 하나만 한다 (`GO/src/commands/startLanguageServer.ts:25-36`).
- 비정상 종료는 5번까지 자동 재시작하고, 초기화 실패는 재시작하지 않는다 (`GO/src/language/goLanguageServer.ts:435-481`).
- Go 버전 전환과 GO111MODULE 변경은 창 다시 읽기를 요구한다 (`GO/src/goEnvironmentStatus.ts:207-223`, `GO/src/goMain.ts:322-332`).
- go.mod, go.work 변경으로 재시작하는 코드는 없다(`goMain.ts`, `startLanguageServer.ts`, `goLanguageServer.ts`에 파일 감시가 없다). gopls가 표준 파일 감시로 처리한다(추정).

**f. 실패 처리와 화면**

- 상태 표시줄 "Go <버전>"과 gopls 아이콘(실행 ⚡, 시작 중 회전, 정지 ⚠) (`GO/src/goStatus.ts:133-194`). 누르면 메뉴가 뜬다: 도구 위치, Go 환경 고르기, gopls trace, "Install Go Language Server", go.mod·go.work 열기 (`:52-128`).
- 언어 상태 항목: "Analysis tools"(빠진 도구와 설치 버튼) (`GO/src/goInstallTools.ts:606-696`), "New Go version is available" (`GO/src/goEnvironmentStatus.ts:674-686`).
- go가 없으면 "Failed to find the go binary … Go to Download Page"를 띄운다 (`GO/src/goInstallTools.ts:720-738`).
- gopls 시작 실패: 버전이 낡았으면 업데이트를 권한다. 아니면 출력 채널을 열고, 출력에 "Usage:"가 있으면 `go.languageServerFlags`를 고치라고 한다 (`GO/src/language/goLanguageServer.ts:1437-1490`, `:1524-1552`). 자동 이슈 보고는 이 버전에 없다(주석만 남아 있다 `:1484-1487`).
- 설문과 원격 측정: gopls 설문, 개발자 설문, opt-out 설문 (`:202-210`, `:223-278`). telemetry 동의는 gopls 명령에 넘긴다 (`GO/src/goTelemetry.ts:270-317`).
- gopls 없이 남은 기능: `go.useLanguageServer`가 꺼지면 등록되는 언어 기능은 문서 포맷 하나다 (`GO/src/language/registerDefaultProviders.ts:11-18`, `GO/src/commands/startLanguageServer.ts:68-75`). 저장 시 build와 vet는 gopls가 꺼졌을 때만 돈다 (`GO/src/diagnostics/goCheck.ts:68`, `:94-96`, `:129`).
- 디버거(`debugAdapter/` 2,862줄과 `goDebug*.ts` 1,514줄), 테스트(`goTest/` 2,226줄, `testUtils.ts` 766줄, `goTest.ts` 483줄), 코드 생성(`goGenerateTests`, `goImpl`, `goModifytags`, `goImport` 767줄)은 있다는 것만 적는다.

### 2. VS Code에 묶인 정도

- `vscode.<이름공간>.<멤버>` 444건: window 279, workspace 65, commands 55, env 16, debug 14, languages 9, extensions 4, tests 1, tasks 1. notebooks, lm, chat, authentication, l10n은 0건이다. 이름으로 가져와 grep에 안 잡히는 사용이 10건 더 있다: `experimental.ts`(extensions 2, workspace 2), `goTest/explore.ts`(workspace 5), `goTest/resolve.ts`(workspace 1). `import {…} from 'vscode'`에 이름공간이 든 파일을 찾아 그 안의 `workspace.`, `extensions.` 사용을 셌다. 84개 파일 중 68개가 `vscode`를 가져온다.
- 가장 많은 것은 알림이다: `showInformationMessage` 64, `showErrorMessage` 64, `showWarningMessage` 19.
- 화면 요소: 상태 표시줄 (`GO/src/goStatus.ts:24`, `:137`), 언어 상태 항목 (`:238`), quick pick 14곳, 출력 채널 (`:21`, `GO/src/language/goLanguageServer.ts:387-393`), 웹뷰(welcome) (`GO/src/welcome.ts:47-61`), 트리 뷰 3 (`GO/src/goExplorer.ts:32`, `GO/src/goPackageOutline.ts:40`, `GO/src/goTest/explore.ts:87`), 가상 터미널 (`GO/src/progressTerminal.ts:42-56`), 통합 터미널 환경 주입 (`GO/src/goEnvironmentStatus.ts:348`), 태스크 (`GO/src/goTaskProvider.ts:41`), 디버그 (`GO/src/goDebugFactory.ts:25`), 테스트 (`GO/src/goTest/explore.ts:76`).
- VS Code 없이도 뜻이 있는 것: 도구 표와 Go 버전별 고정표, 찾는 순서(`pathUtils.ts`는 `vscode`를 가져오지 않는다 `GO/src/utils/pathUtils.ts:9-14`), 설치 환경 규칙, 버전 비교, gopls 설정 가공 규칙.
- 다만 이 규칙들은 `getGoConfig()`, `process.env` 변경, 알림 호출과 한 함수 안에 섞여 있다. 떼어 쓰려면 규칙만 다시 써야 한다(예: `installTools` `GO/src/goInstallTools.ts:159-309`).
- VS Code 안에서만 뜻이 있는 것: 통합 터미널 PATH, code lens 치환, 폼 화면, 설문, welcome, 저장 시 검사, 태스크, 디버그, 테스트.

### 3. VS Code 없이 쓸 수 있는 부품

- gopls. `go install golang.org/x/tools/gopls@<버전>`으로 얻는다. 인자 없이 실행하면 stdio LSP다. 확장도 기본 플래그 없이 실행한다 (`GO/src/language/goLanguageServer.ts:412-416`, `:1085`). 버전은 `gopls version -json`으로 읽는다 (`:1334`). BSD-3-Clause(표와 같은 한계).
- `go` 명령. `go env -json`, `go version -m <파일>`, `go list -m -versions -json <모듈>@latest`가 클라이언트 논리의 재료다 (`GO/src/goInstallTools.ts:549`, `:774`, `:809`).
- 도구 표 데이터(MIT). 그대로 옮겨 쓸 수 있다 (`GO/src/goToolsInformation.ts:7-168`, `GO/src/goTools.ts:62-106`).
- 게시된 npm 패키지나 독립 실행 클라이언트는 저장소에서 찾지 못했다. `vscgo`는 원격 측정용이라 분석에 필요 없다 (`GOD/tools.md:38-43`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown은 gopls를 Zed 프로젝트 엔진에 맡긴다 (`SD/zed-settings.ts:12`, `SD/project-languages.ts:168-176`).

1. gopls 찾기. 확장은 `GOBIN`, GOPATH/bin, PATH를 본다(1a). Zed는 PATH의 `gopls`만 본다 (`ZED/languages/src/go.rs:112-124`). 그래서 `~/go/bin`이 PATH에 없으면 이미 있는 gopls를 못 찾고 새로 설치한다(추정). Setdown 자체 경로의 탐색은 `GOBIN`과 `~/go/bin`도 봤다 (`SD/server-discovery.ts:25`).
2. 설치와 버전. 확장은 Go 버전에 맞는 gopls 버전을 고르고 설치 환경을 정리한다(1a). Zed는 Zed 전용 폴더에 항상 `gopls@latest`를 설치한다 (`ZED/languages/src/go.rs:160-170`).
3. go가 없을 때. 확장은 다운로드 페이지를 안내하고 Go를 내려받는 화면이 있다(1b, 1f). Zed는 "Could not install … because `go` was not found" 알림을 한 번 띄운다 (`ZED/languages/src/go.rs:81-98`). Setdown은 실패 문장을 종류(다운로드 실패, 시작 실패 등)로 나눠 상태에 보인다 (`SD/project-languages.ts:78-84`, `:333-343`).
4. 업데이트. 확장은 매일 검사하고 묻거나 단계 배포한다(1a). Zed는 릴리스 태그를 보고 그 버전 파일이 없으면 다시 설치한다 (`ZED/languages/src/go.rs:75-110`, `:143-162`).
5. Go 선택과 환경. 확장은 설정, 선택 화면, `toolsEnvVars`, `process.env` 변경으로 정한다(1b). Zed에는 Go용 툴체인 제공자가 없다. 툴체인은 Python에만 있다 (`ZED/languages/src/lib.rs:124-142`, `:176`). Setdown은 Zed가 정한 환경을 쓴다 (`HOST/project_host.rs:1-6`).
6. 초기 설정. 확장은 사람이 바꾼 값과 `go.*` 매핑만 보낸다(1c). Zed는 `usePlaceholders: false`, inlay hint 7종, `codelenses.test`, `semanticTokens`를 보낸다 (`ZED/languages/src/go.rs:227-243`). Setdown은 Zed 설정에서 Go의 서버를 gopls 하나로 둔다 (`SD/zed-settings.ts:66-73`).
7. 프로젝트 루트. 확장은 작업 폴더다. Zed의 manifest 제공자는 Cargo와 pyproject뿐이고 Go에는 없다 (`ZED/languages/src/lib.rs:329-331`). Setdown은 Zed에 열 폴더를 "열린 폴더 → `.git` 저장소 → 프로젝트 표지 → 파일 하나" 순으로 정한다 (`SD/zed-settings.ts:136-145`).
8. 비표준 통신. 확장은 폼, 로그형 진행, code lens 치환을 한다(1d). Zed는 `gopls.run_tests` 명령만 클라이언트에서 처리한다 (`ZED/languages/src/go.rs:456-468`).

### 5. 이 확장을 그대로 돌린다면

- 호스트가 줘야 하는 것: VS Code API 1.125 수준 (`GO/package.json:93`). 의존 확장은 없고 (`:53`) proposed API도 없다. `onLanguage` 활성화 (`:96-104`). `globalState`, `workspaceState`, `environmentVariableCollection` (`GO/src/goMain.ts:98-100`). 상태 표시줄, 언어 상태 항목, quick pick, 버튼과 모달이 있는 알림, 로그 출력 채널, 가상 터미널, 트리 뷰, 웹뷰, 테스트·디버그·태스크 API. 내장 명령 `workbench.action.reloadWindow`, `setContext`, `vscode.open`, `workbench.action.openSettings` (`GO/src/goEnvironmentStatus.ts:219`, `GO/src/commands/startLanguageServer.ts:101`, `GO/src/goModules.ts:147`, `GO/src/language/goLanguageServer.ts:1482`). `vscode-languageclient 10.1.0` (`GO/package.json:64`).
- 막는 것:
  - Setdown에는 확장 호스트가 없다(과제 전제).
  - 활성화가 한 줄로 이어져 있다: `go env` → vscgo 빌드 → 도구 자동 설치 → gopls 시작 → 업데이트와 새 Go 확인 (`GO/src/goMain.ts:104-140`). go를 못 찾으면 첫 단계가 reject한다 (`GO/src/goInstallTools.ts:535-540`). `await`라서 활성화가 실패한다(추정; `GO/src/goMain.ts:116`).
  - 확장이 자기 프로세스의 `process.env`를 고친다 (`GO/src/goInstallTools.ts:576-580`, `GO/src/goEnvironmentStatus.ts:377`, `GO/src/goEnv.ts:127`).
  - 신뢰하지 않는 작업공간과 가상 작업공간은 지원하지 않는다 (`GO/package.json:106-111`).
- 얻는 것:
  1. 오래된 Go에 맞는 gopls 버전 선택과 정리된 설치 환경.
  2. `GOBIN`, GOPATH/bin에 이미 있는 gopls 찾기와 `go.alternateTools`.
  3. Go 버전 표시, 선택, 내려받기.
  4. gopls 업데이트 검사와 단계 배포.
  5. gopls의 폼 입력, vulncheck, 패키지 개요 같은 gopls 전용 화면.
  6. `go.buildTags`, `go.buildFlags`, `go.toolsEnvVars`를 gopls에 넘기는 설정 통로.
- 1, 2, 4, 6은 화면이 필요 없는 규칙과 데이터다. 확장을 돌리지 않고 옮길 수 있다(2절).
