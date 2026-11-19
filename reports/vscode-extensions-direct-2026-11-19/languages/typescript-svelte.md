# VS Code 확장 분석: JavaScript/TypeScript, Svelte

작성일: 2026-11-19 · 소스만 읽고 썼다. 빌드, 설치, 실행은 하지 않았다. "확인"은 해당 줄을 직접 읽은 것이고, 읽지 못한 것은 "추정" 또는 "미확인"으로 적는다.

인용 표기(모두 저장소 루트 기준 경로의 줄임이다):

- `TS:` = `vendor/vscode/extensions/typescript-language-features/` (VS Code 1.142.0, `vendor/vscode/package.json:3`)
- `SV:` = `vendor/svelte-language-tools/packages/`
- `SD:` = `apps/desktop/src/main/language/`
- `ZED:` = `vendor/zed/`

먼저 알아 둘 사실 세 가지.

- VS Code의 TypeScript 확장은 LSP를 쓰지 않는다. `tsserver`를 직접 띄우고 TypeScript 고유 프로토콜로 말한다. 편집 기능 30개는 전부 클라이언트 안에서 VS Code 제공자(provider)로 구현되어 있다.
- Setdown의 기본 도구 `typescript-language-server`는 스스로를 "그 확장의 코드 위에 얹은 얇은 LSP 층"이라고 설명하고(`node_modules/typescript-language-server/README.md:37`), 라이선스 파일 첫 줄에 VS Code 저장소에서 복사한 코드가 들어 있다고 적는다(`node_modules/typescript-language-server/LICENSE:1-5`). Zed의 기본 도구 `vtsls`도 "VS Code에 든 TypeScript 확장을 감싼 LSP 래퍼"로 등록되어 있다(`SD:catalog/mason.json:10237-10238`). **즉 전문가가 쓴 그 로직의 상당 부분은 이미 LSP 서버 형태로 Setdown과 Zed에 들어와 있다.** 얼마나 들어와 있는지는 두 래퍼의 소스가 저장소에 없어 확인하지 못했다.
- Svelte 확장은 표준 `vscode-languageclient` 위의 얇은 클라이언트(3,543줄)이고, 분석 로직은 공개된 언어 서버(29,807줄)에 있다.

---

## JavaScript/TypeScript: JavaScript and TypeScript Language Features (`vendor/vscode/extensions/typescript-language-features`)

| 항목 | 값 |
| --- | --- |
| 버전 | 10.0.0 (`TS:package.json:5`). VS Code 본체와 함께 빌드되는 내장 확장이라 의미 있는 버전은 VS Code 1.142.0이다 |
| 라이선스 | MIT (`TS:package.json:8`) |
| `engines.vscode` | `^1.30.0` (`TS:package.json:27-29`). 명목 값이다. 실제로는 같은 트리의 제안 API 선언을 포함해 컴파일한다(`TS:tsconfig.json:16-21`) |
| 클라이언트 소스 크기 | 136개 파일 18,734줄(`src/`, 테스트 21개 2,753줄 제외). 기능 제공자 42개 7,899줄, tsserver 관리 26개 3,941줄, 화면 7개 751줄, 작업(task) 2개 339줄. 웹용 서버 호스트 `web/` 1,365줄은 별도 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | 5개: `workspaceTrust`, `multiDocumentHighlightProvider`, `codeActionAI`, `codeActionRanges`, `editorHoverVerbosityLevel` (`TS:package.json:10-16`) |
| 기여 수 | commands 15(`:2831`), configuration 속성 226(`:149`), jsonValidation 18(`:75`), taskDefinitions 1(`:3041`), problemMatchers 3(`:3071`), breakpoints 2(`:3033`), menus 4묶음. views·debuggers·walkthroughs 없음 |
| 언어 서버 | `tsserver`. npm 패키지 `typescript`의 `lib/tsserver.js`이고 공개(Apache-2.0)다. VS Code는 `extensions/node_modules`에 6.0.3을 넣어 배포한다(`vendor/vscode/extensions/package.json:7`, `vendor/vscode/extensions/package-lock.json:919-923`). LSP 서버가 아니다 |

### 1. 클라이언트가 하는 일

**a. 도구 확보.** 내려받지 않는다. 확장 폴더의 옆 `node_modules/typescript/lib/tsserver.js`를 `vscode.extensions.getExtension('vscode.typescript-language-features')`로 찾는다(`TS:src/tsServer/versionProvider.electron.ts:65-67, 79-84`). 없으면 "VS Code를 다시 설치하라"는 오류를 띄우고 예외를 던진다(`:71-72`). 그 밖의 출처는 사용자 설정 `js/ts.tsdk.path`(전역 값)와 야간 빌드 확장 `ms-vscode.vscode-typescript-next`다(`:29-37, 75-77`).

**b. 런타임·버전 선택.**

- 기본은 **번들 버전**이다. 시작 값은 "전역 tsdk 설정 → 야간 확장 → 번들" 순이다(`TS:src/tsServer/versionManager.ts:33`, `TS:src/tsServer/versionProvider.electron.ts:25-37`).
- 프로젝트 버전 후보는 워크스페이스 수준 tsdk 설정, 또는 각 워크스페이스 폴더의 `node_modules/typescript/lib`이다(`TS:src/tsServer/versionProvider.electron.ts:39-50, 125-146`). 후보가 있어도 자동으로 쓰지 않는다. 사람이 고른 적이 있고(`workspaceState`의 `typescript.useWorkspaceTsdk`) 워크스페이스를 신뢰한 경우에만 쓴다(`TS:src/tsServer/versionManager.ts:15, 35-48`). 고르는 길은 버전 선택 목록(`:81-141`)과 허용 질문(`:160-183`)이고, 질문은 워크스페이스 tsdk 설정이 있고 `tsdk.promptToUseWorkspaceVersion`이 켜졌을 때만 나온다(`:201-208`, 기본 꺼짐 `TS:src/configuration/configuration.ts:356-358`).
- 버전은 `tsserver.js` 옆 `package.json`에서 읽고(`TS:src/tsServer/versionProvider.electron.ts:163-200`), 그 값으로 기능을 켠다. 예: 4.0.1 이상 `--serverMode partialSemantic`(`TS:src/tsServer/spawner.ts:200-206`), 4.6 이상 Node IPC(`TS:src/tsServer/serverProcess.electron.ts:367-370`), 5.4.4 이상 감시 이벤트(`TS:src/tsServer/spawner.ts:272-278`), 5.6 이상 화면에 보이는 범위만 진단(`TS:src/tsServer/bufferSyncSupport.ts:357-359`).
- Node는 기본으로 VS Code 자신(Electron)이다. `ELECTRON_RUN_AS_NODE=1`로 `child_process.fork`한다(`TS:src/tsServer/serverProcess.electron.ts:144-156, 378-384`). `js/ts.tsserver.node.path`가 있으면 그 Node로 `spawn`한다(`:372-377`). 워크스페이스가 지정한 Node는 신뢰와 질문을 거친다(`TS:src/tsServer/nodeManager.ts:27-40, 90-104`). 힙 한도는 기본 3,072 MB를 `--max-old-space-size`로 준다(`TS:src/configuration/configuration.ts:310-318`, `TS:src/tsServer/serverProcess.electron.ts:167-169`).
- 프로세스는 기본 둘이다. 구문 서버와 의미 서버를 따로 띄우고(`TS:src/tsServer/spawner.ts:68-78, 117-120`), 개요·접기·서식·선택 범위는 항상 구문 서버로, 완성·정의·호버 등 12개는 프로젝트를 읽는 동안만 구문 서버로 보낸다(`TS:src/tsServer/server.ts:552-589, 607-633`). 실험 설정을 켜면 진단 전용 프로세스가 하나 더 생긴다(`TS:src/tsServer/spawner.ts:91-96`).
- TypeScript 7(Go 구현)을 쓰도록 설정하고 그 확장이 설치되어 있으면 이 확장은 끄는 명령 하나만 남기고 물러난다(`TS:src/extension.ts:61-73`, `TS:src/commands/useTsgo.ts:10-15`).

**c. 프로젝트 범위.**

- 클라이언트는 분석용 `tsconfig.json`을 찾지 않는다. 파일을 열 때 그 파일이 속한 워크스페이스 폴더를 `projectRootPath`로 보내고(`TS:src/tsServer/bufferSyncSupport.ts:171-176, 194-215`), `--useInferredProjectPerProjectRoot`를 준다(`TS:src/tsServer/spawner.ts:208`). 설정 파일 탐색과 프로젝트 구성은 tsserver가 한다(추정: 클라이언트에 탐색 코드가 없다).
- 설정 파일이 없는 파일에 쓸 컴파일 옵션은 클라이언트가 만든다. `module: Preserve`, `moduleResolution: Bundler`, `target: ES2022`, `jsx: react-jsx`에 `js/ts.implicitProjectConfig.*` 설정을 얹는다(`TS:src/tsconfig.ts:23-62`, `TS:src/typescriptServiceClient.ts:630-645`).
- 진단은 탭에 열려 있는 파일만 요청한다(`TS:src/tsServer/bufferSyncSupport.ts:760-770`).
- 자동 타입 내려받기(ATA)는 의미 서버에서 기본으로 켜져 있다. 꺼졌거나 구문·진단 프로세스일 때만 `--disableAutomaticTypingAcquisition`을 준다(`TS:src/tsServer/spawner.ts:210-212`). npm 위치는 `--npmLocation`으로 넘긴다(`:262-264`). 설치 코드는 클라이언트에 없다(추정: tsserver 안).
- 다른 확장의 플러그인: 설치된 모든 확장의 `package.json`에서 `contributes.typescriptServerPlugins`를 읽어(`TS:src/tsServer/plugins.ts:69-91`) `--globalPlugins`, `--pluginProbeLocations`로 넘긴다. 번들 버전을 쓸 때, 또는 플러그인이 `enableForWorkspaceTypeScriptVersions`를 켰을 때만 경로를 넘긴다(`TS:src/tsServer/spawner.ts:245-260`). 플러그인 설정은 확장 API와 `_typescript.configurePlugin` 명령으로 받아 `configurePlugin` 요청으로 보낸다(`TS:src/api.ts:15-17`, `TS:src/commands/configurePlugin.ts:9-18`, `TS:src/typescriptServiceClient.ts:1249-1251`).

**d. 표준 LSP 밖의 통신.** 전부가 LSP 밖이다.

- 의존 패키지에 `vscode-languageclient`가 없다(`TS:package.json:34-44`). 프로토콜 타입은 TypeScript의 `ts.server.protocol`이다(`TS:src/tsServer/protocol/protocol.d.ts:6, 14`). 쓰는 명령은 52개다(응답 있는 것 43, 없는 것 7, 비동기 2: `TS:src/typescriptService.ts:38-97`).
- 전송은 Node IPC, 또는 표준 입출력(보낼 때 줄 단위 JSON, 받을 때 `Content-Length` 틀)이다(`TS:src/tsServer/serverProcess.electron.ts:22, 227-233, 287-289`).
- 문서 동기화는 열기·닫기·변경을 모아 `updateOpen` 한 번으로 보낸다(`TS:src/tsServer/bufferSyncSupport.ts:119-134`). 요청은 한 번에 하나만 보내고 열기·변경은 순서 울타리로 다룬다(`TS:src/tsServer/server.ts:325-332, 367-377`).
- 진단은 서버가 밀어 주지 않는다. 클라이언트가 지연(300~800 ms)을 계산해 `geterr`를 요청하고 구문·의미·제안·영역 이벤트 네 가지로 받는다(`TS:src/tsServer/bufferSyncSupport.ts:331, 698-714`, `TS:src/typescriptServiceClient.ts:990-1007`).
- 취소는 임시 파일을 만들어 알린다(`TS:src/tsServer/cancellation.electron.ts:18-28`, `TS:src/tsServer/spawner.ts:218-220`).
- 기능 구현: 모듈 29개가 `vscode.languages.register*Provider`로 등록되고(`TS:src/languageProvider.ts:69-99`) 각자 tsserver 명령을 부른다. 완성 `completionInfo`+`completionEntryDetails`(`TS:src/languageFeatures/completions.ts:192, 761`), 정의 `definitionAndBoundSpan`(`definitions.ts:28`), 호버 `quickinfo`(`hover.ts:45`), 이름 바꾸기 `rename`(`rename.ts:136`), 개요 `navtree`(`documentSymbol.ts:50`), 서식 `format`(`formatting.ts:35`), 의미 색 `encodedSemanticClassifications-full`(`semanticTokens.ts:64`), 파일 이동 시 경로 고치기 `getEditsForFileRename`(`updatePathsOnRename.ts:223`).
- 리팩터링·빠른 수정·가져오기 정리·붙여넣기 편집은 있다는 것만 적는다. `refactor.ts` 782줄, `quickFix.ts` 556줄, `updatePathsOnRename.ts` 291줄, `copyPaste.ts` 259줄, `fixAll.ts` 257줄, `organizeImports.ts` 187줄이다. 디버거 기여는 없다. `tsc` 빌드·감시 작업 제공자가 339줄 있다.

**e. 변경 감지와 재시작.**

- 재시작 조건: 서버 관련 설정이 바뀜(`TS:src/typescriptServiceClient.ts:212-230`), 버전이나 Node를 새로 고름(`:191-198`), 플러그인 목록이 바뀜(`:248-250`, `TS:src/tsServer/plugins.ts:36-46`), 사람이 명령을 실행함(`:322-337`). 재시작 뒤에는 열린 버퍼를 전부 다시 열고 진단을 다시 요청한다(`:599-622`).
- 파일 감시: tsserver가 감시할 경로를 이벤트로 알려 주면 클라이언트가 VS Code 감시기를 만들고, 변경을 100 ms 묶어 `watchChange`로 돌려준다(`TS:src/typescriptServiceClient.ts:1057-1090, 1110-1124, 1161-1188`). TypeScript 5.4.4 이상이고 Yarn PnP가 아니며 `files.watcherExclude`가 `node_modules`를 빼지 않았을 때만 쓴다(`TS:src/tsServer/spawner.ts:270-284`, `TS:src/configuration/configuration.ts:271-294`). 아니면 tsserver가 Node로 직접 감시한다.
- 프로젝트를 다시 읽게 하는 명령 `reloadProjects`가 있다(`TS:src/typeScriptServiceClientHost.ts:183-186`).

**f. 실패 처리와 화면.**

- tsdk 경로가 틀리면 경고하고 번들로 돌아간다(`TS:src/typescriptServiceClient.ts:398-406`). Node 경로가 틀리면 경고하고 내장 Node로 돌아간다(`TS:src/configuration/configuration.electron.ts:110-119`).
- 서버가 죽으면 바로 다시 띄운다. 여섯 번째 재시작에서 직전 시작이 10초 안이면 멈추고 오류를 띄우며, 5분 안이면 경고만 한다(`TS:src/typescriptServiceClient.ts:657-705`). 플러그인이 있으면 그 확장 이름을 원인 후보로 보여 준다(`:676-678`).
- 구문 서버와 의미 서버의 열기·변경 결과가 어긋나면 치명 오류로 보고 서버를 죽인다(`TS:src/tsServer/server.ts:441-457`, `TS:src/typescriptServiceClient.ts:961-986`).
- 화면: 언어 상태 항목 둘(버전, 프로젝트 설정 파일. `TS:src/ui/versionStatus.ts:23`, `TS:src/ui/intellisenseStatus.ts:218-223`), "설정 파일 없음"과 만들기 명령(`intellisenseStatus.ts:179-188`), 프로젝트가 너무 클 때 상태 표시줄 항목과 경고(`TS:src/ui/largeProjectStatus.ts:24, 67-86`), 프로젝트 초기화 진행 표시(`TS:src/typescriptServiceClient.ts:1291-1299`), 타입 내려받기 진행과 npm 없음 경고(`TS:src/ui/typingsStatus.ts:84-87, 98-113`), 서버 로그 열기(`TS:src/typescriptServiceClient.ts:551-597`).

### 2. VS Code에 묶인 정도

세는 법: 과제의 정규식을 테스트를 뺀 136개 파일에 돌렸다. 136개 중 107개가 `vscode`를 가져오고, 이름 가져오기는 2개 파일뿐이라(`TS:src/remoteRepositories.browser.ts:6`, `TS:src/utils/async.ts:6`) 숫자에 영향이 없다. `vscode.` 참조는 모두 1,690곳이다.

| 이름공간 | 횟수 | 주로 쓰는 것 |
| --- | --- | --- |
| l10n | 162 | 문구 번역 |
| workspace | 111 | `getConfiguration` 19, `workspaceFolders` 16, `openTextDocument` 10, 설정 변경 이벤트 9, `fs` 8, 신뢰 8, 감시기 4, `applyEdit` 5 |
| window | 93 | 오류·경고·안내 알림 44, `activeTextEditor` 15, `withProgress` 6, `tabGroups` 4, `visibleTextEditors` 4, 빠른 선택 4, 출력 채널 2, 상태 표시줄 1 |
| languages | 36 | 제공자 등록 30, 언어 상태 항목 2, 진단 모음 1 |
| commands | 19 | `executeCommand` 16, `registerCommand` 3 |
| env | 12 | `openExternal` 6, `language`, `remoteName`, `uriScheme`, `uiKind` |
| extensions | 7 | `getExtension` 4, `all` 1, 변경 이벤트 2 |
| tasks | 1 | 작업 제공자 |
| debug, tests, notebooks, lm, chat, authentication | 0 | (`workspace.notebookDocuments`만 2곳) |

- 필요한 화면 요소: 알림(선택 버튼 포함), 언어 상태 항목, 상태 표시줄, 빠른 선택, 진행 표시, 출력 채널, 열기·저장 대화상자(`TS:src/languageFeatures/refactor.ts:255-262`), 작업. 웹뷰·트리 뷰·터미널·디버그·테스트는 쓰지 않는다.
- 화면과 무관하게 의미 있는 로직: 버전 고르기와 유효성 검사, 프로세스 인자 조립, 구문·의미 서버 분리와 경로 배정, 버퍼 동기화와 요청 순서, 진단 일정, 감시 이벤트 중계, 플러그인 전달, 추론 프로젝트 옵션, 재시작 한도. 다만 이 코드도 `vscode.EventEmitter`, `vscode.Uri`, `vscode.CancellationToken`, `vscode.workspace` 설정 조회를 직접 쓴다(`TS:src/tsServer/server.ts:7`, `TS:src/tsServer/spawner.ts:6`, `TS:src/tsServer/bufferSyncSupport.ts:6`).
- VS Code 안에서만 의미 있는 로직: 제공자 42개 파일 전체(결과가 `vscode.CompletionItem`, `vscode.CodeAction` 같은 VS Code 객체다), 탭·보이는 편집기 추적, 워크스페이스 신뢰, `workspaceState` 기억, 원격 측정과 실험 서비스(`TS:src/extension.ts:44-54`), 작업 제공자.

### 3. VS Code 없이 쓸 수 있는 부품

| 부품 | 쓰는 법 | 라이선스 |
| --- | --- | --- |
| `typescript`의 `lib/tsserver.js` | `node tsserver.js <인자>`, tsserver 프로토콜(표준 입출력 또는 `--useNodeIpc`). LSP가 아니라 클라이언트를 따로 써야 한다 | Apache-2.0 (`node_modules/typescript/package.json:5-6`) |
| `typescript-language-server` | `typescript-language-server --stdio`, LSP (`node_modules/typescript-language-server/README.md:54`). `_typescript.configurePlugin`, `typescript.tsserverRequest` 명령과 `$/typescriptVersion` 알림이 있다(`README.md:198-236, 298-303`). 구문·의미 서버를 구분하는 인자가 있다(`README.md:223`) | Apache-2.0, VS Code에서 복사한 부분은 MIT (`package.json:6`, `LICENSE:1-5`) |
| `@vtsls/language-server` | `vtsls --stdio`, LSP (`ZED:crates/languages/src/vtsls.rs:29-31, 39-40`). 설정 이름이 VS Code 확장과 같다(`typescript.tsdk`, `vtsls.autoUseWorkspaceTsdk`: `vtsls.rs:247-299`) | MIT (`SD:catalog/mason.json:10244-10246`). 소스는 저장소에 없다 |
| 확장 클라이언트 소스 | 그대로 실행할 수 없다. 소스로 가져다 `vscode` 의존을 떼어 내야 한다 | MIT (`TS:package.json:8`) |
| TypeScript 7 자체 LSP | `typescript-language-server` 문서가 "LSP 구현을 포함할 것"이라고 적는다(`node_modules/typescript-language-server/README.md:43`). 저장소에 없어 미확인 | 미확인 |

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown의 JS/TS는 아직 Zed 프로젝트 엔진을 타지 않는다. 엔진 대상 목록에 없어서(`SD:zed-settings.ts:12`, `SD:project-languages.ts:168-170`) Setdown 자체 LSP 클라이언트가 번들 `typescript-language-server` 6.0.2를 띄운다(`apps/desktop/src/core/document/supported-languages.ts:7`, `SD:catalog/profiles.json:448-454`, `apps/desktop/package.json:87-88`).

| | VS Code 확장 | Zed | Setdown |
| --- | --- | --- | --- |
| 서버 | tsserver 직접, 고유 프로토콜 (`TS:src/typescriptService.ts:38-97`) | 기본 `vtsls`, `typescript-language-server`는 끔 (`ZED:assets/settings/default.json:2556, 2661, 2672`) | `typescript-language-server` (`SD:catalog/profiles.json:391-454`) |
| 확보 | VS Code에 동봉 (`TS:src/tsServer/versionProvider.electron.ts:65-67`) | PATH의 `vtsls`, 없으면 npm으로 최신 설치 (`vtsls.rs:108-143`) | 앱에 동봉, 실행 파일 교체 불가 (`SD:server-registry.ts:364, 385-387`) |
| TypeScript 버전 | 기본 번들 6.0.3. 프로젝트 것은 사람이 고르고 신뢰해야 (`TS:src/tsServer/versionManager.ts:33-48`) | 워크트리 루트의 `.yarn/sdks/typescript/lib` 또는 `node_modules/typescript/lib`에 `tsserver.js`가 있으면 자동 (`vtsls.rs:49-75, 298`) | 루트에서 `.git`까지 올라가며 `node_modules/typescript`를 찾아 자동, 없으면 번들 5.9.3, 사람이 바꿀 수 있음 (`SD:analysis-context.ts:99-128`) |
| Node | Electron 자신, 설정으로 교체 (`TS:src/tsServer/serverProcess.electron.ts:361-384`) | Zed의 Node 런타임 (`vtsls.rs:138`) | Electron 자신 (`SD:server-registry.ts:386-387`) |
| 힙 한도 | 3,072 MB (`TS:src/configuration/configuration.ts:310-318`) | 8,192 MB (`vtsls.rs:283-285`) | 프로필에 설정 없음 (`SD:catalog/profiles.json:460-483, 511-513`) |
| 프로젝트 범위 | 워크스페이스 폴더를 넘기고 tsserver가 설정 파일을 찾음 (`TS:src/tsServer/bufferSyncSupport.ts:194-215`) | 워크트리 루트 기준 (`vtsls.rs:49-52`) | 가장 가까운 `tsconfig.json`/`jsconfig.json`, 없으면 `package.json` 폴더 (`SD:language-root.ts:74-81`) |
| 타입 자동 내려받기 | 기본 켬, 진행 표시 있음 (`TS:src/tsServer/spawner.ts:210-212`) | 어댑터가 정하지 않음 (`vtsls.rs:247-299`) | 끔 (`SD:server-definitions.ts:19-23`, `SD:zed-settings.ts:93-95`) |
| 플러그인 | 설치된 확장의 기여를 자동 전달 (`TS:src/tsServer/plugins.ts:69-91`) | 어댑터에 전달 코드 없음 (`ZED:crates/languages/src/typescript.rs:831-847`) | 프로필에 없음 (`SD:catalog/profiles.json:511-513`) |
| 죽었을 때 | 즉시 재시작, 6번째가 10초 안이면 중단 (`TS:src/typescriptServiceClient.ts:657-683`) | 미확인 | 60초 안 3회까지 1·3·5초 뒤 재연결 (`SD:language-supervisor.ts:8-11`) |

덧붙임: Setdown은 `node_modules`가 없으면 "의존성을 설치하라"는 안내를 띄운다(`SD:analysis-context.ts:132-134`). VS Code 확장에는 이 안내가 없고 대신 큰 프로젝트 경고와 "설정 파일 없음" 상태가 있다. Setdown 클라이언트는 `$/typescriptVersion`을 받아 쓰는 버전을 보여 준다(`SD:server-session.ts:99-103`).

### 5. 이 확장을 그대로 돌린다면

호스트가 갖춰야 하는 것:

- `vscode` API를 구현한 확장 호스트. 2절의 이름공간 전부가 필요하다. 특히 제공자 등록 30종, 전역·워크스페이스·언어별 값을 구분하는 설정 `inspect()`(`TS:src/configuration/configuration.electron.ts:27-49`, `TS:src/utils/configuration.ts:23-57`), 탭 묶음과 보이는 범위(`TS:src/tsServer/bufferSyncSupport.ts:390-402, 735-740`), 워크스페이스 신뢰, `workspaceState`, 상대 패턴 파일 감시기, 설치된 확장 목록과 그 `package.json`.
- 제안 API 5개. VS Code는 내장 확장이 아니면 제안 API를 막는다(`vendor/vscode/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:110-113`).
- VS Code의 `extensions/` 폴더 배치. 번들 TypeScript를 확장 ID와 상대 경로로 찾기 때문이다(`TS:src/tsServer/versionProvider.electron.ts:65-67`).
- Monaco 쪽 다리. 제공자가 돌려주는 VS Code 객체와 명령을 standalone Monaco의 제공자로 옮겨야 한다(추정: 저장소에 그런 층이 없다).

막는 것:

- 라이선스는 막지 않는다(MIT, TypeScript는 Apache-2.0). 닫힌 부분도 없다.
- 배포가 막는다. 독립 확장으로 배포되지 않는다. README가 "VS Code에 동봉되며 끌 수는 있어도 제거할 수 없다"고 적고(`TS:README.md:3`), 빌드가 VS Code 트리에 의존한다(`TS:tsconfig.json:2, 16-21`, `TS:package.json:50`, `TS:src/tsServer/protocol/protocol.d.ts:14`). 쓰려면 VS Code 트리의 특정 커밋에서 직접 빌드하고 매달 따라가야 한다.
- 원격 측정 키와 실험 서비스가 들어 있어 떼거나 막아야 한다(`TS:package.json:9, 42`, `TS:src/extension.ts:44-54`).
- TypeScript 7로 가면 이 확장은 스스로 물러난다(`TS:src/extension.ts:61-73`). TypeScript 7은 `tsserver.js`를 싣지 않는다(`vtsls.rs:60`의 주석, `SD:analysis-context.ts:117-119`의 주석).

지금 Setdown보다 얻는 것(래퍼가 이미 하고 있을 수 있는 것은 그렇게 적는다):

1. 다른 확장이 기여한 tsserver 플러그인의 자동 연결. Svelte·Vue 같은 파일을 TS 쪽에서 타입으로 보는 길이다. 지금 Setdown에는 없다. 다만 래퍼에도 `_typescript.configurePlugin`이 있어(`node_modules/typescript-language-server/README.md:230-236`) 플러그인 전달은 확장 없이도 가능해 보인다(추정).
2. 버전 선택 화면, "설정 파일 없음"과 만들기, 큰 프로젝트 경고, 타입 내려받기 진행 표시. Setdown에도 SDK 선택(`SD:analysis-context.ts:120-126`)은 있고 나머지는 없다.
3. 타입 자동 내려받기. 설정 파일 없는 JavaScript 프로젝트의 완성 품질이 오른다. Setdown은 일부러 꺼 두었다(`SD:zed-settings.ts:93-95`). 켜는 것은 설정 한 줄이다.
4. tsserver 새 기능의 즉시 반영: 붙여넣기 편집, 파일로 옮기기 리팩터링, 호버 자세히 보기(`TS:src/languageFeatures/copyPaste.ts:102, 190`, `refactor.ts:171`, `hover.ts:36-59`). 래퍼가 어디까지 따라왔는지는 미확인이다.
5. 구문 서버 분리로 프로젝트를 읽는 동안에도 개요·접기·서식이 바로 된다. `typescript-language-server`에도 구문·의미 서버 구분이 있어(`README.md:223`) 이미 얻고 있을 가능성이 높다(추정).

정리하면 이 확장은 "그대로 돌리기"가 가장 어려운 쪽이고(LSP가 아니고, 내장 전용이고, 제안 API를 쓴다), 동시에 그 로직을 LSP로 옮긴 공개 래퍼가 둘이나 있어 돌릴 이유가 가장 작은 쪽이다.

---

## Svelte: Svelte for VS Code (`vendor/svelte-language-tools/packages/svelte-vscode`)

| 항목 | 값 |
| --- | --- |
| 버전 | 0.5.0 (`SV:svelte-vscode/package.json:3`), 저장소 커밋 `1c895e9` |
| 라이선스 | MIT (`SV:svelte-vscode/package.json:24`) |
| `engines.vscode` | `^1.82.0` (`:40-42`) |
| 클라이언트 소스 크기 | 35개 파일 3,543줄(`src/`, 테스트는 `test/`에 따로 있다). 그중 TypeScript 7 연동 `typescript-go/`가 1,282줄, SvelteKit 파일 만들기 `sveltekit/`가 849줄 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | 없음 |
| 기여 수 | commands 16(`:558`), configuration 속성 55(`:67`), languages 3(`:418`), grammars 8(`:455`), snippets 3(`:757`), jsonValidation 3(`:441`), breakpoints 1(`:752`), typescriptServerPlugins 1(`:61-66`), menus 6묶음. views·debuggers·taskDefinitions 없음 |
| 언어 서버 | `svelte-language-server` 0.18.6, 같은 저장소 `packages/language-server`, 공개 MIT, 104개 파일 29,807줄(`SV:language-server/package.json:2-3, 33`). 여기에 tsserver 플러그인 `typescript-svelte-plugin` 0.3.52, MIT, 4,438줄(`SV:typescript-plugin/package.json:2-3, 24`) |

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** 서버를 확장에 넣어 배포하고(`SV:svelte-vscode/package.json:785`) `require.resolve('svelte-language-server/bin/server.js')`로 찾는다(`SV:svelte-vscode/src/extension.ts:198`). 내려받지 않는다. `svelte.language-server.ls-path`로 다른 서버를 가리킬 수 있다(`:188-196`).
- **b. 런타임·버전.** 기본은 확장 호스트의 Node이고 전송은 Node IPC다(`:225-236`). `svelte.language-server.runtime`으로 Node를 바꾼다(`:201, 238-242`). Node 22.6~22.17과 23.0~23.5에서는 `--experimental-strip-types`를 붙인다(`:45-49, 203-206`). 프로젝트의 Svelte 컴파일러·Prettier를 고르는 것은 서버다. 프로젝트 폴더에서 먼저 찾고 없으면 자기 것을 쓴다(`SV:language-server/src/importPackage.ts:27-38, 60-69`). TypeScript는 서버가 자기 설치 위치의 것을 쓴다(`SV:language-server/src/plugins/typescript/TypeScriptPlugin.ts:1`, 확장은 `^6.0.3`을 싣는다 `SV:svelte-vscode/package.json:789`). 프로젝트의 TypeScript를 고르는 코드는 서버에서 찾지 못했다.
- **c. 프로젝트 범위.** 대상은 `file` 스킴의 `svelte` 문서다(`extension.ts:248`). 서버가 워크스페이스 폴더를 받고(`SV:language-server/src/server.ts:140-142`) 파일마다 `tsconfig.json`/`jsconfig.json`을 찾는다(`SV:language-server/src/plugins/typescript/utils.ts:146-155`).
- **d. 표준 LSP 밖.**
  - 초기화 옵션: `svelte`, `prettier`, `emmet`, `typescript`, `javascript`, `js/ts`, `css`, `less`, `scss`, `html` 설정 전체와 `dontFilterIncompleteCompletions`, `isTrusted`(`extension.ts:267-281`). 설정 변경 알림에도 JS/TS 설정을 합쳐 넣는다(`SV:svelte-vscode/src/typescript/configurationMiddleware.ts:5-20`).
  - 사용자 요청·알림 6개: 태그 자동 닫기 `html/tag`(`extension.ts:51-55, 305-311`), **열려 있는 `.ts`/`.js`의 변경을 알리는 `$/onDidChangeTsOrJsFile`**(`:452-469`), 파일 이동 시 가져오기 고치기 `$/getEditsForFileRename`(`:472-555`), `$/getFileReferences`, `$/getComponentReferences`, `$/getCompiledCode`(서버 쪽 `SV:language-server/src/server.ts:524-526, 652-659, 710-736`).
  - 참조 코드 렌즈는 클라이언트가 명령으로 바꿔 줘야 동작한다. 소스가 "다른 클라이언트도 비슷한 중간 처리가 필요하다"고 적는다(`SV:svelte-vscode/src/typescript/codeLensMiddleware.ts:4-8, 19-40`).
  - tsserver 플러그인: `typescriptServerPlugins`로 기여하고(`SV:svelte-vscode/package.json:61-66`) 내장 TypeScript 확장의 `_typescript.configurePlugin` 명령으로 켜고 끈다(`SV:svelte-vscode/src/tsplugin.ts:31-43`). 기본은 꺼짐이고 켤지 묻는다(`package.json:71-75`, `tsplugin.ts:46-68`).
- **e. 변경 감지와 재시작.** `svelte.config.*`, `vite.config.*`, Prettier 설정 파일을 저장하면 서버를 재시작한다(`extension.ts:320-338`). 서버는 감시를 클라이언트에 등록하고, 클라이언트가 동적 등록을 지원하지 않으면 스스로 감시한다(`SV:language-server/src/server.ts:148-156, 441-470`).
- **f. 실패 처리와 화면.** 출력 채널 "Svelte"가 전부다. 자동으로 열지 않는다(`extension.ts:245-249`). 죽었을 때의 재시작은 `vscode-languageclient` 기본 동작에 맡긴다(추정: 옵션에 오류 처리기가 없다 `:246-292`). 서버는 프로젝트가 너무 크면 `window/showMessage`로 경고한다(`SV:language-server/src/server.ts:474-480`).

### 2. VS Code에 묶인 정도

세는 법: 35개 파일 중 11개가 이름 가져오기(`import { window, workspace } from 'vscode'`), 6개가 `vscode.` 접두를 쓴다. 그래서 접두가 있든 없든 `이름공간.멤버` 꼴을 셌다. 같은 이름의 지역 변수가 섞였을 수 있다. 결과: workspace 50(`getConfiguration` 22), window 32(`activeTextEditor` 10, `withProgress` 6), commands 18, extensions 3, languages 1. l10n·env·debug·tasks·tests·notebooks·lm·chat·authentication은 0이다.

- 화면 요소: 출력 채널, 진행 표시, 입력 상자, 빠른 선택, 상태 표시줄 문구, 안내 알림, 읽기 전용 가상 문서(컴파일 결과 미리 보기 `extension.ts:563`), 메뉴 조건(`setContext`). 웹뷰·트리 뷰·터미널·작업·디버그·테스트는 없다.
- VS Code 없이도 의미 있는 것: 서버 실행 옵션, 초기화 옵션 구성, 재시작할 설정 파일 목록, 사용자 알림 6개, 들여쓰기·단어 규칙(`extension.ts:385-444`).
- VS Code 안에서만 의미 있는 것: tsserver 플러그인 토글(내장 TypeScript 확장이 있어야 한다), TypeScript 7 연동(그 확장의 API를 부른다 `SV:svelte-vscode/src/typescript-go/contentMapper.ts:64-69`), SvelteKit 파일 만들기 메뉴, 미리 보기.

### 3. VS Code 없이 쓸 수 있는 부품

- `svelte-language-server`(npm, MIT): `svelteserver --stdio`, LSP(`SV:language-server/package.json:18-20`, `SV:language-server/src/server.ts:100-110`). Node 18 이상(`package.json:38-40`). 설정은 `initializationOptions.configuration`에 넣으라고 문서에 적혀 있다(`SV:language-server/README.md:57`).
- `typescript-svelte-plugin`(npm, MIT): tsserver 플러그인. 프로젝트 `tsconfig.json`의 `plugins`에 적으면 확장 없이 쓴다(`SV:typescript-plugin/README.md:14-34`). Svelte 파일의 변경은 저장해야 반영된다(`:38`).
- `svelte2tsx`, `svelte-check`가 같은 저장소에 있다. 읽지 않았다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

Zed의 Svelte는 Zed 확장에서 온다(`ZED:docs/src/languages/svelte.md:8-11`). 그 확장 소스는 저장소에 없다. Setdown의 기본 도구는 `svelte-language-server`이고(`apps/desktop/src/core/document/supported-languages.ts:8`) 엔진 대상이 아니라(`SD:zed-settings.ts:12`) Setdown 자체 클라이언트가 띄운다.

1. 확보: 확장은 서버를 동봉한다. Setdown은 Zed 확장 `svelte` 0.2.11을 내려받아 호스트에 싣고 그 확장이 서버를 준비한다(`SD:catalog/zed-profiles.json:61269-61271`, `SD:catalog/zed.json:30808-30811`, `SD:language-provisioner.ts:153-165`). 내려받기가 꺼져 있으면 실패한다(`:156`).
2. 초기화 옵션: 확장은 10개 설정 묶음과 `isTrusted`를 보낸다(`extension.ts:267-281`). Setdown 프로필은 JS/TS 인레이 힌트만 담고 있다(`SD:catalog/profiles.json:7972-8019`). Zed 확장이 더하는 값이 있으면 합쳐지지만(`SD:language-provisioner.ts:178-179`) 무엇인지는 미확인이다.
3. 신뢰: `isTrusted`가 없으면 서버는 신뢰한 것으로 본다(`SV:language-server/src/server.ts:158-164`). 그 경우 서버는 프로젝트의 `node_modules`와 `svelte.config.js`를 읽어 실행한다. 확장 자신이 "워크스페이스가 지정한 코드를 실행한다"고 적는다(`SV:svelte-vscode/package.json:57`).
4. 사용자 알림: `$/onDidChangeTsOrJsFile`을 포함한 6개를 Setdown은 보내지 않는다(`apps/desktop/src`와 `tooling/language-host/src`를 검색해 0건). 저장하지 않은 `.ts` 변경이 `.svelte` 분석에 늦게 반영될 수 있다(추정).
5. 설정 파일 재시작: 확장은 `svelte.config.*`와 `vite.config.*` 저장 때 재시작한다(`extension.ts:320-338`). Setdown 프로필은 `.svelte`만 감시하고 루트 표지가 비어 있다(`SD:catalog/profiles.json:7961-7966`).
6. TS 쪽 플러그인: 확장은 tsserver에 플러그인을 넣는다. Setdown의 TypeScript 프로필에는 플러그인이 없다(`SD:catalog/profiles.json:511-513`).

### 5. 이 확장을 그대로 돌린다면

- 호스트가 갖춰야 하는 것: `vscode`의 workspace·window·commands·languages 일부와 그 위에서 도는 `vscode-languageclient`(`SV:svelte-vscode/package.json:787`). 제안 API와 의존 확장은 없다. 최소 버전은 1.82다. tsserver 플러그인까지 쓰려면 내장 TypeScript 확장이 같은 호스트에 있어야 한다. 없으면 조용히 건너뛴다(`SV:svelte-vscode/src/tsplugin.ts:31-35`).
- 막는 것: 라이선스와 닫힌 부분은 없다. 배포 경로(마켓플레이스 등)는 저장소로 확인할 수 없다.
- 얻는 것: (1) 열린 `.ts` 변경의 즉시 반영, (2) 파일 이동 시 가져오기 고치기, (3) 설정 파일 변경 시 재시작, (4) 태그 자동 닫기와 참조 코드 렌즈, (5) 컴포넌트 추출·Svelte 5 이전 명령과 컴파일 결과 미리 보기.
- 그런데 (1)~(4)는 요청 이름과 인자가 소스에 그대로 있는 작은 LSP 추가 10여 개다. 확장 호스트 없이 Setdown 클라이언트(또는 Zed 쪽 설정)에서 같은 것을 보내면 된다. 이 확장에서 가져올 것은 "실행"이 아니라 "목록"이다.

---

## 확인하지 못한 것

- `typescript-language-server`와 `vtsls`의 내부. 소스가 저장소에 없다. 전자는 설치된 패키지의 README와 LICENSE만 읽었다. 두 래퍼가 VS Code 확장의 어느 부분까지 담고 있는지, 구문 서버 분리·영역 진단·타입 자동 내려받기 기본값이 무엇인지는 모른다.
- tsserver 내부(설정 파일 탐색, 타입 자동 내려받기 설치기). `typescript` 패키지 소스는 읽지 않았다.
- TypeScript 7 확장(`typescriptteam.vscode-typescript`)과 Zed의 Svelte 확장. 저장소에 없다.
- TypeScript 확장이 마켓플레이스에 독립 배포되는지. README의 문장만 근거다.
- Zed가 서버가 죽었을 때 하는 일. 이번 범위에서 읽지 않았다.
- `vscode-languageclient` 9.0.1의 정확한 실행 방식. 저장소의 사본(`vendor/vscode-languageserver-node/client/src/node/main.ts:303, 401, 458`)은 버전이 다를 수 있다.
