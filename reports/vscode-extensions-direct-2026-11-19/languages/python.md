# Python: VS Code 확장을 그대로 돌릴 수 있는가

작성일: 2026-11-19 · 조사(부분: Python) · 소스를 읽기만 했다. 빌드, 설치, 실행은 하지 않았다.

기준 커밋(`vendor/<이름>`의 `git log -1`): vscode-python `9c08cef`, vscode-python-environments `54a6e78`, pyright `317abe4`, basedpyright `a5ea571`, pylance-release `26d6c82`.

**경로 약어.** `VP/` = `vendor/vscode-python/`, `VPC/` = `vendor/vscode-python/src/client/`, `PE/` = `vendor/vscode-python-environments/`, `PR/` = `vendor/pyright/packages/`, `BP/` = `vendor/basedpyright/packages/`, `PL/` = `vendor/pylance-release/`, `ZPY` = `vendor/zed/crates/languages/src/python.rs`, `SD/` = `apps/desktop/src/main/language/`. 그 밖의 경로는 저장소 루트 기준으로 적는다.

**세는 법.** 줄 수는 `wc -l`, 테스트 폴더와 `.d.ts` 제외. `vscode` API 사용 횟수는 정규식으로 셌다. (가) `import * as vscode from 'vscode'`나 `require('vscode')` 별칭 뒤의 `vscode.<이름공간>.<멤버>`, (나) `import { window, workspace, … } from 'vscode'`로 들여온 파일 안의 `<이름공간>.<멤버>`. 두 값을 더했다. 두 Microsoft 확장은 API를 자체 래퍼로 감싸 쓰므로 이 숫자는 실제보다 작다. 그래서 메서드 이름이 나오는 횟수를 따로 적었다.

## 먼저 볼 것

- **vscode-python은 Pyright를 시작하지 않는다.** 시작할 수 있는 것은 Pylance(비공개), Jedi, 없음 셋이다(`VPC/languageServer/watcher.ts:230-266`). Setdown의 기본 도구인 Pyright에 대해 이 확장이 주는 것은 언어 분석이 아니라 "어느 Python을 쓸지"다.
- **Pylance는 쓸 수 없다.** "Pylance is licensed for use in Microsoft products and services only, so can only be used on official Microsoft builds of Visual Studio Code and GitHub Codespaces." (`PL/FAQ.md:17`)
- **환경 탐색의 전문가 로직은 확장 밖에 있다.** 두 확장 모두 Rust 프로그램 PET(`pet`)를 자식 프로세스로 띄워 묻는다(`VPC/pythonEnvironments/base/locators/common/nativePythonFinder.ts:219`, `PE/src/managers/common/nativePythonFinder.ts:677`). Zed는 같은 PET를 라이브러리로 링크하고(`vendor/zed/Cargo.toml:839-845`, `ZPY:1324-1353`), Setdown의 Rust 호스트도 Zed를 통해 이미 링크한다(`tooling/language-host/Cargo.lock:6186-6188`). 다만 Python은 아직 그 경로를 타지 않는다(`SD/zed-settings.ts:12`).
- **Pyright의 공개 클라이언트는 3개 파일 510줄이다.** 하는 일은 서버 실행, 인터프리터 경로 끼워 넣기, 파일 기반 취소, 명령 3개다. 인터프리터를 고르는 일은 하지 않고 Python 확장에 묻는다(`PR/vscode-pyright/src/extension.ts:323-370`).
- vscode-python 67,304줄 가운데 언어 서버 관련은 3,244줄(4.8%), 환경 관련은 20,876줄(31%)이다. 나머지는 디버그, 테스트, 터미널, REPL, 채팅 도구, 원격 측정, 공통 기반이다.

---

## Python: Python (`vendor/vscode-python`)

| 항목 | 값 |
| --- | --- |
| 버전 | 2026.13.0 (`VP/package.json:5`) |
| 라이선스 | MIT (`VP/package.json:34`, `VP/LICENSE:1-5`). 배포판은 LICENSE 앞에 "Pylance는 바이너리로만 제공되고 Microsoft 독점 라이선스"라는 안내를 붙인다(`VP/gulpfile.js:105-110`, `VP/build/license-header.txt:6-7`) |
| `engines.vscode` | `^1.95.0` (`VP/package.json:49-51`) |
| 클라이언트 소스 | `src/client` 500개 파일 67,304줄(`src/test` 367개 파일 제외). Python 쪽 보조 스크립트 `python_files` 31개 5,142줄(tests, lib, get-pip.py 제외) |
| `extensionDependencies` | 없음. 배포 빌드가 `extensionPack`에 `ms-python.vscode-pylance`, `ms-python.debugpy`, `ms-python.vscode-python-envs`를 넣는다(`VP/gulpfile.js:88-103`) |
| `enabledApiProposals` | 9개: contribEditorContentMenu, quickPickSortByLabel, testObserver, quickPickItemTooltip, terminalDataWriteEvent, terminalExecuteCommandEvent, codeActionAI, notebookReplDocument, notebookVariableProvider (`VP/package.json:20-30`) |
| 기여 수 | commands 23, configuration 41, activationEvents 21, languages 6, languageModelTools 6, keybindings 4, jsonValidation 3, yamlValidation 3, walkthroughs 2, debuggers 1, grammars 1, viewsWelcome 1, problemMatchers 1. views와 taskDefinitions는 없다(`VP/package.json`을 JSON으로 읽어 셈. 시작 행 115, 269, 396, 762, 1507) |
| 언어 서버 | 셋 중 하나(`VPC/activation/types.ts:39-45`). Pylance: 별도 확장, 비공개. Jedi: 공개 pip 패키지 `jedi-language-server` 0.45.1을 빌드 때 확장에 넣음(`VP/python_files/jedilsp_requirements/requirements.txt:32`, `VP/noxfile.py:32-40`). None |

폴더별 크기: pythonEnvironments 93개 14,465줄, common 148개 17,766줄, testing 45개 7,899줄, interpreter 30개 4,229줄, telemetry 7개 3,587줄, activation 27개 2,578줄, chat 11개 2,302줄, debugger 31개 2,261줄, envExt 7개 2,182줄, terminals 16개 2,116줄, application 24개 1,974줄, repl 11개 1,118줄, languageServer 5개 666줄.

### 1. 클라이언트가 하는 일

**a. 도구 확보**

- Pylance는 확장이 받지 않는다. Pylance 확장이 설치돼 있는지만 본다(`VPC/languageServer/pylanceLSExtensionManager.ts:88-91`). 없으면 경고를 띄우고 "설치", "Jedi로 되돌리기", "나중에"를 고르게 한다(`VPC/activation/common/languageServerChangeHandler.ts:18-39`).
- 기본값은 Pylance가 있으면 Pylance, 없으면 Jedi다(`VPC/activation/common/defaultlanguageServer.ts:30-36`). Pyrefly 확장이 있으면 None이다(`VPC/common/configSettings.ts:283-286`).
- Jedi는 빌드 때 `python_files/lib/jedilsp`에 설치돼 확장과 함께 온다(`VP/noxfile.py:32-40`). 실행 스크립트가 그 폴더를 `sys.path`에 넣는다(`VP/python_files/run-jedi-language-server.py:8-14`).
- 환경 탐색기 PET는 확장 폴더의 `python-env-tools/bin/pet`이다(`VPC/pythonEnvironments/base/locators/common/nativePythonFinder.ts:30-32`). 이 저장소에는 소스가 없다. CI가 `microsoft/python-environment-tools`를 따로 받아(`VP/.github/workflows/build.yml:91-101`) cargo로 빌드하고(`VP/noxfile.py:63-100`), 릴리스 파이프라인은 미리 빌드된 `pet`를 내려받는다(`VP/build/azure-pipeline.stable.yml:139-151`).

**b. 런타임·인터프리터·환경 선택**

- 탐색 경로가 셋이다. Python Environments 확장이 설치돼 있고 `python.useEnvironmentsExtension`이 켜져 있으면 그 확장에 맡긴다(`VPC/pythonEnvironments/index.ts:64-76`, `VPC/envExt/api.internal.ts:59-68`). `python.locator`가 `native`면 PET를 쓴다(`VPC/pythonEnvironments/index.ts:52-55`, `:78-88`). 둘 다 아니면 TypeScript로 쓴 탐색기를 쓴다(`:90-96`). 설정 기본값은 각각 `false`와 `js`다(`VP/package.json:449-450`, `:581-582`).
- TypeScript 탐색기: pyenv, Conda, ActiveState, 전역 가상환경, 사용자 지정 폴더, Windows 레지스트리·스토어·PATH, POSIX 알려진 경로(`VPC/pythonEnvironments/index.ts:178-201`), 작업 폴더별로 가상환경, Poetry, Hatch, Pixi(`:226-239`). 찾은 인터프리터마다 `interpreterInfo.py`를 실행해 버전과 접두 경로를 얻는다(`VPC/pythonEnvironments/base/info/environmentInfoService.ts:50`, `VP/python_files/interpreterInfo.py:7-13`).
- PET: `pet server`를 띄우고 표준 입출력 JSON-RPC로 말한다(`nativePythonFinder.ts:219`, `:267-270`). 요청은 `configure`(`:408-424`), `refresh`(`:386`), `resolve`(`:128`), `condaInfo`(`:432`), 알림은 `environment`(`:338`), `manager`(`:366`), `log`(`:278`), `telemetry`(`:296`)다. `configure`에 작업 폴더, 가상환경 폴더, conda·poetry 실행 파일, 캐시 폴더를 넘긴다(`:409-416`).
- 자동 선택: 작업 폴더 안의 환경을 먼저, 전역 가상환경은 건너뛰고, Python 2는 빼고, 같은 무리에서는 최신 버전을 고른다(`VPC/interpreter/configuration/environmentTypeComparer.ts:46-51`, `:119-150`). 종류 우선순위는 Poetry, Pipenv, virtualenvwrapper, Hatch, venv, virtualenv, ActiveState, Conda, pyenv 순이다(`:282-299`).
- 고른 값은 `settings.json`이 아니라 확장의 저장소에 작업 폴더별 키로 둔다(`VPC/common/interpreterPathService.ts:125-133`, `:142-157`). `python.defaultInterpreterPath`는 초기값 구실이다(`VPC/common/configSettings.ts:241-249`).
- 서버를 기다리게 하지 않는다. 100ms 안에 결정되지 않으면 지난번 값을 돌려주고, 결정되면 이벤트로 알린다(`VPC/interpreter/interpreterService.ts:58`, `:296-315`).

**c. 프로젝트 범위**

- 단위는 VS Code 작업 폴더다. Jedi는 작업 폴더마다 서버 하나, Pylance는 전체에 하나다(`VPC/languageServer/watcher.ts:47-50`, `:376-385`).
- Jedi에는 작업 폴더와 `python.autoComplete.extraPaths`, 인터프리터 경로를 초기화 옵션으로 넘긴다(`VPC/activation/jedi/analysisOptions.ts:41-91`).
- `.py` 파일은 작업 폴더가 아니라 그 파일 기준으로 인터프리터를 묻는다. PEP 723 스크립트 환경 때문이며 Environments 확장을 쓸 때만 달라진다(`VPC/activation/languageClientMiddlewareBase.ts:90-102`).

**d. 표준 LSP 밖의 통신**

- 서버가 `workspace/configuration`으로 `python` 구역을 물으면 답에 `pythonPath`(선택된 인터프리터)와 `_envPYTHONPATH`(`.env`에서 온 PYTHONPATH)를 끼워 넣는다(`VPC/activation/languageClientMiddlewareBase.ts:80-108`).
- 파일 기반 취소. 서버를 `--cancellationReceive=file:<폴더>`로 시작하고, 요청을 취소할 때 임시 폴더에 `cancellation-<id>.tmp`를 만든다(`VPC/activation/common/cancellationUtils.ts:24-30`, `:46-49`, `:93-95`).
- Pylance 전용 요청: `python/inExperiment`, `python/getExperimentValue`(`VPC/activation/node/languageServerProxy.ts:28`, `:41`, `:199-215`), `python/isTrustedWorkspace`(`:217-221`), 알림 `python/workspaceTrusted`(`:112-116`). 초기화 옵션 `experimentationSupport`, `trustedWorkspaceSupport`(`VPC/activation/node/analysisOptions.ts:21-26`).
- 진행 알림 `python/setStatusBarMessage`, `python/beginProgress`, `python/reportProgress`, `python/endProgress`(`VPC/activation/progress.ts:16-43`).
- 모든 요청을 미들웨어로 감싸 원격 측정을 보내고(`VPC/activation/languageClientMiddlewareBase.ts:24-32`), 숨김 파일의 진단은 버린다(`:232-238`).
- Pylance가 자기 클라이언트를 갖고 있으면 이 확장은 `api.client.start()`만 부른다(`VPC/activation/node/languageServerProxy.ts:96-104`). 그 안은 비공개다. 반대로 Pylance가 이 확장에게 클라이언트를 만들어 달라고 하는 API도 있다(`VPC/api.ts:147-157`).

**e. 변경 감지와 재시작**

- 설정, 작업 폴더, 인터프리터 정보, 인터프리터 경로, 설치된 확장 목록의 변경을 듣는다(`VPC/languageServer/watcher.ts:91-127`).
- `python.languageServer`가 바뀌면 멈추고 다시 시작한다(`:277-302`).
- 인터프리터가 바뀌면 Jedi는 다시 시작하고(`:305-312`), Pylance에는 `workspace/didChangeConfiguration`을 `settings: null`로 보내 서버가 다시 묻게 한다(`VPC/activation/node/languageServerProxy.ts:170-187`).
- `.env`의 PYTHONPATH가 바뀌면 1초 모아서 다시 시작한다(`VPC/activation/common/analysisOptions.ts:92-110`, `VPC/activation/jedi/manager.ts:66`, `:104-107`).
- 환경 목록은 파일 감시로 갱신한다(`VPC/pythonEnvironments/base/locators/common/pythonWatcher.ts:67`, `:110`).
- Jedi를 멈출 때는 프로세스 번호로 직접 죽인다(`VPC/activation/jedi/languageServerProxy.ts:78-92`).

**f. 실패 처리와 화면**

- 인터프리터가 없으면 "No Python interpreter is selected…" 알림에 "인터프리터 선택" 버튼(`VPC/application/diagnostics/checks/pythonInterpreter.ts:41-46`, `:143-173`, `:295-313`).
- PET가 뜨지 않으면 경고 알림에 "출력 열기", "다시 보지 않기"(`nativePythonFinder.ts:435-460`). 이 파일에는 PET 재시작이 없다(`:208-307`).
- Jedi 시작 실패는 "Launching Jedi language server using python failed, see output."(`VPC/activation/jedi/languageServerProxy.ts:55-63`).
- 선택된 인터프리터는 상태 표시줄이나 언어 상태 항목에 보인다(`VPC/interpreter/display/index.ts:75-91`). 신뢰하지 않는 작업 폴더에서는 경고 상태 항목이 뜨고(`VPC/activation/partialModeStatus.ts:25-57`) Pylance나 None만 허용된다(`VPC/languageServer/watcher.ts:154-161`).
- 서버 출력 채널은 스스로 열리지 않는다(`VPC/activation/common/analysisOptions.ts:48`).

### 2. VS Code에 묶인 정도

- 500개 파일 중 287개가 `vscode`를 가져온다. 이름공간별 직접 사용: l10n 371, workspace 111, window 64, env 22, commands 17, extensions 17, debug 15, languages 9, lm 9, tests 6, notebooks 1. tasks, chat, authentication은 0이다.
- 실제 화면 호출은 대부분 주입식 래퍼(`VPC/common/application/`, `VPC/common/vscodeApis/`)를 거친다. 래퍼를 참조하는 파일 수: IWorkspaceService 68, IApplicationShell 46, ICommandManager 43, IExtensions 18, IDocumentManager 14, ITerminalManager 10, IDebugService 8.
- 메서드 이름 출현 횟수(래퍼 정의 포함): executeCommand 100, registerCommand 52, showInformationMessage 51, showErrorMessage 45, showQuickPick 32, showWarningMessage 26, onDidChangeConfiguration 23, withProgress 20, createTerminal 17, createFileSystemWatcher 11, createQuickPick 10, showInputBox 10, createStatusBarItem 9, createLanguageStatusItem 8.
- 필요한 화면 요소: 상태 표시줄과 언어 상태 항목, quick pick과 여러 단계 입력(`VPC/interpreter/configuration/interpreterSelector/commands/setInterpreter.ts:189`, `:544`), 파일 선택 대화상자(`:560`), 버튼 달린 알림, 출력 채널, 진행 표시(`VPC/activation/progress.ts:55-64`), walkthrough 2개, 터미널, 디버그, 테스트 컨트롤러, 언어 모델 도구 6개. webview는 쓰지 않고 tree view는 래퍼 정의뿐이다(`VPC/common/application/applicationShell.ts:168-169`).
- 화면 없이도 뜻이 있는 것: PET와 주고받는 프로토콜(`vscode-jsonrpc`), 환경 순위 규칙, `interpreterInfo.py`, Jedi 실행과 초기화 옵션, `pythonPath`를 설정 답에 넣는 규칙, 파일 기반 취소.
- VS Code 안에서만 뜻이 있는 것: 인터프리터 고르는 화면, 상태 항목, walkthrough, 터미널 자동 활성화, 디버그 구성, 테스트 탐색기, REPL, 채팅 도구, Pylance와의 확장 간 API, 작업 폴더 신뢰, A/B 실험(`VPC/common/experiments/service.ts:8`).

### 3. VS Code 없이 쓸 수 있는 부품

| 부품 | 쓰는 법 | 라이선스 |
| --- | --- | --- |
| PET (`pet`) | `pet server`, 표준 입출력 JSON-RPC. 메서드는 1.b. 한 번에 묻는 형태로 `pet find --json`, `pet resolve <실행 파일> --json`도 있다(`PE/src/managers/common/nativePythonFinder.ts:1306`, `:1461`) | 소스와 라이선스 문서가 이 저장소에 없다. 미확인 |
| jedi-language-server 0.45.1 | 고른 Python으로 `run-jedi-language-server.py`를 실행, 표준 입출력 LSP(`VPC/activation/jedi/languageClientFactory.ts:24-29`) | pip 패키지. 라이선스 미확인 |
| `interpreterInfo.py` 등 `python_files` | 스크립트를 그 Python으로 실행하면 JSON 한 줄 출력 | MIT |
| `@vscode/python-extension` 1.0.6 | 다른 확장이 Python 확장 API를 부르는 타입 포장(`VP/pythonExtensionApi/package.json:2-4`). 확장 호스트 없이는 쓸모없다 | MIT (`:19`) |
| conda 스키마 3개 | `.condarc`, `environment.yml`, `meta.yaml`용 JSON 스키마(`VP/package.json:1138-1151`) | MIT |

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown에서 Python은 아직 자체 클라이언트 경로다. 새 경로(Zed 프로젝트 엔진)를 쓰는 도구 목록에 Pyright가 없다(`SD/zed-settings.ts:12`).

1. **서버.** 확장은 Pylance 확장이나 번들된 Jedi를 쓴다(1.a). Zed는 PATH의 `pyright-langserver`, 없으면 npm으로 최신판을 받는다(`ZPY:793-815`, `:828-831`). Zed의 기본 Python 서버는 basedpyright와 ruff다(`vendor/zed/assets/settings/default.json:2626`). Setdown은 Pyright 1.1.414를 앱에 넣고(`apps/desktop/package.json:78`) Electron을 Node로 써서 `--stdio`로 띄운다(`SD/catalog/profiles.json:46-51`, `SD/server-registry.ts:351`).
2. **환경 탐색 엔진.** 확장은 PET 프로세스나 TypeScript 탐색기(1.b). Zed는 PET 크레이트를 같은 프로세스에서 부른다(`ZPY:1324-1353`). Setdown의 자체 경로는 직접 찾는다: 파일에서 저장소 경계까지 올라가며 `.venv`와 `venv`(`apps/desktop/src/main/notebook/python-environments.ts:40-45`), `VIRTUAL_ENV`·`CONDA_PREFIX`(`:46-48`), PATH의 python(`:49`), `~/.conda/environments.txt`(`:51-54`), Jupyter 커널 명세(`:55-72`). pyenv, Poetry, Pipenv, Hatch, Pixi의 폴더 밖 환경은 찾지 않는다.
3. **자동 선택 규칙.** 확장: 작업 폴더 안 환경 우선, 전역 가상환경 제외, 최신 버전(1.b). Zed: `.venv` 파일에 적힌 이름, 하위 프로젝트와의 거리, 종류 우선순위, `CONDA_PREFIX`, 경로 순으로 정렬한다(`ZPY:1362-1422`). 첫 번째를 자동으로 쓰는 규칙은 Zed 화면 코드에 있어서 Setdown 호스트가 옮겨 두었다(`tooling/language-host/src/project_host.rs:658-670`). Setdown 자체 경로: 폴더 환경이 하나면 자동, 여러 개면 묻고, 없으면 PATH의 python(`python-environments.ts:75-78`, `SD/analysis-context.ts:94-95`).
4. **서버에 알리는 법.** 셋 다 `workspace/configuration` 답의 `python.pythonPath`다. 확장은 미들웨어(1.d), Zed는 `workspace_configuration`(`ZPY:737-765`), Setdown은 `setPython`과 요청 처리기(`SD/analysis-context.ts:23-26`, `:83`, `SD/server-session.ts:106-107`).
5. **바뀌었을 때.** 확장은 Pylance에 `didChangeConfiguration`, Jedi는 재시작(1.e). Zed는 환경을 활성화하면 설정을 다시 보낸다(`vendor/zed/crates/project/src/lsp_store.rs:5217-5229`). Setdown은 `pyrightconfig.json`, `pyproject.toml`, `.vscode/settings.json`, `.venv`, `venv`를 1.5초마다 확인해 바뀌면 연결을 다시 맺는다(`SD/analysis-context.ts:70`, `SD/language-manager.ts:735-737`).
6. **프로젝트 범위.** 확장은 작업 폴더(1.c). Zed는 가장 안쪽 `pyproject.toml`, 잠금 파일이 있으면 가장 바깥쪽을 하위 프로젝트 루트로 본다(`ZPY:73-112`). Setdown은 가장 가까운 `pyrightconfig.json`, `pyproject.toml`, `setup.py`, `setup.cfg`를 찾고 `.git`에서 멈춘다(`SD/catalog/profiles.json:53-58`, `SD/language-root.ts:82-94`).
7. **요청 취소.** 확장은 파일 기반 취소를 쓴다(1.d). Zed의 Python 어댑터와 Setdown에는 `--cancellationReceive`가 없다(`ZPY`와 `apps/desktop/src`를 검색해 확인).

### 5. 이 확장을 그대로 돌린다면

**호스트가 줘야 하는 것**

- VS Code 확장 API 1.95 이상과 제안 API 9개. VS Code는 제안 API를 `product.json`의 허용 목록, 개발 모드, `--enable-proposed-api` 중 하나로만 연다(`vendor/vscode/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:32-37`, `:43-55`, `:104`).
- 2절의 화면 요소 전부, 확장별 저장소(`VPC/pythonEnvironments/index.ts:112`, `nativePythonFinder.ts:533-535`), 작업 폴더 신뢰(`VPC/languageServer/watcher.ts:106`, `:155`), 다른 확장을 찾고 깨우는 `extensions.getExtension`(`VPC/activation/node/languageServerProxy.ts:224-235`).
- 플랫폼별로 빌드된 `pet`가 든 배포 패키지. 소스 체크아웃에는 없다(1.a).

**막는 것**

- 기본 구성의 언어 분석은 Pylance이고 Pylance는 위 조항으로 쓸 수 없다. Pylance 없이 돌리면 서버는 Jedi가 된다. Pyright는 나오지 않는다.
- 배포판은 Marketplace로 오고 "Extensions installed through the marketplace are subject to the Marketplace Terms of Use"라고 적혀 있다(`VP/README.md:18`). 약관 원문은 저장소에 없다. 미확인.
- 디버그, 테스트, 터미널, REPL, 채팅 도구가 한 확장에 들어 있어 환경 선택만 떼어 켤 수 없다(크기는 위 표).

**지금의 Setdown보다 얻는 것**

1. 폴더 밖 환경까지 찾기: pyenv, Poetry, Pipenv, Hatch, Pixi, ActiveState, Windows 레지스트리와 스토어.
2. 검증된 자동 선택 순위와, 느린 탐색이 서버 시작을 막지 않게 하는 100ms 규칙.
3. `.env`의 PYTHONPATH를 서버에 전달.
4. 인터프리터가 바뀌어도 서버를 다시 띄우지 않고 설정만 다시 보내기.
5. Pyright가 없을 때의 대안 서버 Jedi.

1번은 PET가 하는 일이고 Setdown 호스트가 이미 링크한 Zed 코드로 얻을 수 있다. 2~4번은 화면과 무관한 규칙이라 수백 줄 단위로 옮길 수 있다(추정).

---

## Python: Python Environments (`vendor/vscode-python-environments`)

| 항목 | 값 |
| --- | --- |
| 버전 | 1.45.0 (`PE/package.json:5`) |
| 라이선스 | MIT (`PE/LICENSE:1`). `package.json`에 `license` 항목은 없다 |
| `engines.vscode` | `^1.110.0-20260204` (`PE/package.json:7-9`) |
| 클라이언트 소스 | `src` 215개 파일 50,437줄(`src/test` 제외). managers 82개 23,955줄, features 67개 14,026줄, common 55개 7,818줄 |
| `extensionDependencies` | 없음. 다만 자기 폴더에 PET가 없으면 Python 확장의 PET를 쓰고, 그것도 없으면 "Python extension not found"로 실패한다(`PE/src/managers/common/nativePythonFinder.ts:101-122`) |
| `enabledApiProposals` | 3개: terminalShellEnv, terminalDataWriteEvent, taskExecutionTerminal (`PE/package.json:13-17`) |
| 기여 수 | commands 35, configuration 12, views 2(활동 표시줄 컨테이너 1), taskDefinitions 1, activationEvents 9. 메뉴 항목: 명령 팔레트 31, 뷰 항목 25, 뷰 제목 6 (`PE/package.json:28`, `:51`, `:195`, `:731-759`) |
| 언어 서버 | 없음. 띄우는 것은 PET뿐이다 |

이 확장은 언어 분석을 하지 않는다. "이 파일에 어느 Python 환경을 쓰는가"에 답하고, 환경을 만들고, 패키지를 설치하고, 터미널을 활성화한다. Pylance, vscode-python, basedpyright 클라이언트가 이 확장의 API에 묻는다(`VPC/envExt/api.internal.ts:114-140`, `BP/vscode-pyright/src/extension.ts:87-108`).

### 1. 클라이언트가 하는 일

**a. 도구 확보.** PET는 자기 폴더의 `python-env-tools/bin/pet`, 없으면 Python 확장의 것이다(`PE/src/managers/common/nativePythonFinder.ts:101-122`). 릴리스 파이프라인이 미리 빌드된 `pet`를 넣는다(`PE/build/azure-pipeline.stable.yml:109-121`). uv로 Python 자체를 설치하는 코드도 있다(`PE/src/managers/builtin/uvPythonInstaller.ts`, 파일 존재만 확인).

**b. 환경 선택.** 관리자(manager) 단위로 나뉜다: 시스템, venv, uv, Conda, pyenv, Pipenv, Poetry(`PE/src/extension.ts:755-765`, `PE/src/managers/builtin/` 파일 목록). 선택은 네 단계다(`PE/src/features/interpreterSelection.ts:82`, `:101`, `:118`, `:168`).

1. `python-envs.pythonProjects`에 이 경로의 관리자가 적혀 있으면 그것.
2. 사용자가 정한 `python-envs.defaultEnvManager`.
3. 사용자가 정한 `python.defaultInterpreterPath`. 변수를 풀고 상대 경로를 작업 폴더 기준으로 바꾼 뒤 PET로 확인한다(`:118-166`).
4. 자동: 폴더의 venv, 없으면 시스템 Python(`:226-260`).

결과는 `settings.json`에 쓰지 않고 캐시한다(`:262-266`).

**c. 프로젝트 범위.** 프로젝트는 작업 폴더 루트와 `python-envs.pythonProjects`에 적힌 하위 경로다(`PE/src/features/projectManager.ts:164-196`). 파일은 경로가 가장 긴 프로젝트에 속한다(`:311-335`). `pyproject.toml`과 `setup.py`를 찾아 프로젝트로 추가하는 기능은 사람이 명령으로 실행한다(`PE/src/features/creators/autoFindProjects.ts:93-94`). PET에는 작업 폴더가 아니라 프로젝트 목록을 넘긴다(`nativePythonFinder.ts:1100-1110`).

**d. 표준 밖 통신.** LSP는 없다. PET와는 vscode-python과 같은 JSON-RPC에 `info` 요청이 더 있다(`nativePythonFinder.ts:813`). 다른 확장에는 `getEnvironment(scope)`, `onDidChangeEnvironment` 같은 확장 API로 답한다(`PE/src/extensionApi.ts:96-125`).

**e. 변경 감지와 재시작.**

- PET 요청마다 제한 시간이 있다: 설정 30초(재시도 시 60초까지), 새로 고침 30초, 확인 30초(`nativePythonFinder.ts:28-36`).
- PET가 죽거나 멈추면 죽이고 1초, 2초, 4초 간격으로 세 번까지 다시 띄운다(`:41-44`, `:444-535`).
- 서버 방식이 끝내 안 되면 `pet find --json`을 한 번 실행하는 방식으로 넘어간다(`:846-889`, `:1208`).
- 설정이 바뀌면 선택을 다시 계산한다(`PE/src/features/interpreterSelection.ts:727-733`). 프로젝트 폴더가 지워지거나 이름이 바뀌면 목록을 고친다(`PE/src/features/projectManager.ts:90-107`).
- `activate` 스크립트 생성과 파일 삭제(`PE/src/managers/builtin/main.ts:44-47`), `.env`(`PE/src/features/execution/envVariableManager.ts:40`)를 감시한다.

**f. 실패 처리와 화면.** 상태 표시줄에 선택된 환경, 없으면 경고 배경의 "Select Python Interpreter"(`PE/src/features/views/pythonStatusBar.ts:14-32`). 설정을 적용하지 못하면 "설정 열기" 버튼이 달린 경고(`PE/src/features/interpreterSelection.ts:543`). 로그는 "Python Environments" 출력 채널(`PE/src/extension.ts:145`). PET 실패 로그는 "PET를 터미널에서 실행" 명령을 안내한다(`nativePythonFinder.ts:531-535`).

### 2. VS Code에 묶인 정도

- 215개 파일 중 134개가 `vscode`를 가져온다. 이름 가져오기 기준 직접 사용: l10n 508, commands 60, window 51, workspace 33, extensions 6, languages 4, env 4, tasks 4, lm 1. (`window.apis` 같은 파일 이름에 걸린 10건은 뺐다.)
- 래퍼 파일을 가져오는 파일 수: `PE/src/common/window.apis.ts`(내보내기 42개) 47, `workspace.apis.ts`(17개) 40.
- 메서드 이름 출현: withProgress 61, showQuickPick 46, createTerminal 13, createFileSystemWatcher 12, createTreeView 5, createStatusBarItem 4. 알림 호출이 있는 줄은 167개다.
- 필요한 화면 요소: 활동 표시줄의 tree view 2개(`PE/src/features/views/envManagersView.ts:92`, `projectView.ts:49`), 상태 표시줄, quick pick, 진행 표시, 알림, 출력 채널, 터미널(자동 활성화 포함, `PE/src/features/terminal/` 28개 3,834줄), 작업(tasks), 코드 렌즈(`PE/src/features/inlineScript/codeLens.ts:144`).
- 화면 없이도 뜻이 있는 것: PET 클라이언트(제한 시간, 재시작, CLI 대체), 선택 우선순위, 관리자별 환경 만들기와 패키지 설치 명령.
- VS Code 안에서만 뜻이 있는 것: 환경·프로젝트 tree view, 터미널 활성화, 작업 실행, 설정 자동 완성, 이슈 보고.

### 3. VS Code 없이 쓸 수 있는 부품

PET(위 표와 같음), 그리고 `@vscode/python-environments` 1.8.1(확장 API 포장, MIT, `PE/api/package.json:2-4`, `:31`). 뒤의 것은 확장 호스트 없이는 쓸모없다. 관리자 코드(venv, uv, conda 호출)는 MIT라 옮겨 쓸 수 있으나 `vscode` 타입과 래퍼에 묶여 있다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **PET를 부르는 법.** 확장은 프로세스로 띄우고 제한 시간, 재시작, CLI 대체를 둔다(1.e). Zed는 같은 프로세스에서 한 번 호출한다(`ZPY:1324-1353`). Setdown 자체 경로는 PET를 쓰지 않는다(`apps/desktop/src/main/notebook/python-environments.ts:27-78`).
2. **선택 우선순위.** 확장은 프로젝트 설정, 기본 관리자, 인터프리터 경로 설정, 자동의 네 단계(1.b). Zed는 정렬만 하고 고르지 않는다(`ZPY:1362-1422`, `tooling/language-host/src/project_host.rs:658-661`). Setdown은 사람이 고른 것, 연결 설정의 `python.pythonPath`, 자동 순이다(`SD/analysis-context.ts:74-79`).
3. **프로젝트 단위.** 확장은 작업 폴더와 설정에 적은 하위 경로(1.c). Zed는 `pyproject.toml`(`ZPY:73-112`). Setdown은 루트 표지 파일(`SD/catalog/profiles.json:53-58`).
4. **환경 만들기와 패키지 설치.** 확장은 한다. Zed의 탐색기는 목록, 확인, 활성화 스크립트만 있다(`ZPY:1315`, `:1448`, `:1469`). Setdown은 탐색 때 인터프리터를 실행하지 않고 패키지를 설치하지 않는다(`python-environments.ts:73`, `SD/server-environment.ts:8`).
5. **바뀌었을 때.** 확장은 API 이벤트와 파일 감시(1.e). Zed는 활성화 이벤트(`vendor/zed/crates/project/src/lsp_store.rs:5217-5229`). Setdown은 1.5초 주기 확인(`SD/language-manager.ts:735-737`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것:** VS Code 1.110(2026-02-04 이후 빌드) 이상, 터미널과 작업 쪽 제안 API 3개, tree view, 터미널, 작업, 파일 감시, `workspace.findFiles`. 그리고 PET 바이너리.
- **막는 것:** 라이선스는 MIT라 조항상 막는 것은 없다. 실질적 장벽은 요구 버전이 매우 최신이라는 점과 터미널·작업 API다. 배포판 밖에서 PET를 구하는 길은 이 저장소에 없다.
- **얻는 것:** (1) 환경 만들기와 패키지 설치(venv, uv, Conda), (2) 멈춘 PET를 다루는 방식, (3) 한 폴더 안 여러 프로젝트에 환경을 따로 지정, (4) PEP 723 스크립트 환경(`PE/src/features/inlineScript/`, 7개 1,598줄), (5) 터미널 활성화.

언어 분석이 되느냐를 정하는 것은 이 가운데 (2)와 (3)이고, 둘 다 화면 없이 옮길 수 있는 규칙이다(추정).

---

## Python: Pyright와 basedpyright 클라이언트 (`vendor/pyright/packages/vscode-pyright`, `vendor/basedpyright/packages/vscode-pyright`)

| 항목 | Pyright | basedpyright |
| --- | --- | --- |
| 버전 | 1.1.414 (`PR/vscode-pyright/package.json:5`) | 1.1.414 (`BP/vscode-pyright/package.json:5`) |
| 라이선스 | MIT (`PR/vscode-pyright/package.json:7`) | MIT (`BP/vscode-pyright/package.json:7`) |
| `engines.vscode` | `^1.101.0` (`:16-18`) | `^1.101.0` (`:16-18`) |
| 클라이언트 소스 | 3개 파일 510줄 | 3개 파일 672줄 |
| `extensionDependencies` / 제안 API | 없음 / 없음 | 없음 / 없음. npm 의존에 `@vscode/python-environments`, `@vscode/python-extension`(`:2019-2021`) |
| 기여 수 | commands 7, configuration 19, jsonValidation 1 | commands 8, configuration 31, jsonValidation 1, configurationDefaults |
| 언어 서버 | 공개. 확장 안의 `dist/server.js`(`PR/vscode-pyright/src/extension.ts:75`) | 공개. 고른 환경의 `basedpyright-langserver`, 없으면 확장 안의 것 |

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** Pyright는 서버를 확장에 넣어 Node IPC로 띄우고 힙 3GB를 요청한다(`PR/vscode-pyright/src/extension.ts:53`, `:75-96`). 확장용 서버는 백그라운드 분석 스레드를 하나 쓴다(`PR/vscode-pyright/src/server.ts:5-6`). 독립 실행형 `pyright-langserver`는 0개다(`PR/pyright/src/langserver.ts:3-4`). basedpyright는 기본이 "프로젝트 환경에 설치된 것"이다(`BP/vscode-pyright/package.json:1937-1946`). 선택된 인터프리터 옆에서 `basedpyright-langserver`를 찾아 표준 입출력으로 띄우고, 없으면 번들로 돌아간다(`BP/vscode-pyright/src/extension.ts:173-253`).
- **b. 인터프리터.** 고르지 않는다. Python 확장의 `settings.getExecutionDetails(scope)`에 묻는다(`PR/vscode-pyright/src/extension.ts:329-360`). Python 확장이 없으면 "Python extension not found"를 로그에 남기고 넘어간다(`:330-331`). 그러면 서버가 설정의 `python.pythonPath`를 쓰거나(`PR/pyright-internal/src/pyrightServer.ts:87-97`) PATH의 `python3`, `python`을 실행해 찾는다(`PR/pyright-internal/src/common/fullAccessHost.ts:306-321`). basedpyright는 Environments 확장을 먼저 묻는다(`BP/vscode-pyright/src/extension.ts:61-108`, `:480-488`).
- **c. 범위.** `file`과 `untitled`의 Python 문서(`PR/vscode-pyright/src/extension.ts:101-104`). basedpyright는 `git` 스킴과 노트북도 넣는다(`BP/vscode-pyright/src/extension.ts:258-263`). 환경에서 서버를 찾는 기능은 첫 작업 폴더만 본다(`:182-183`).
- **d. 표준 밖 통신.** 파일 기반 취소(`PR/vscode-pyright/src/extension.ts:73`, `:84`, `:109`). 설정 답에서 사용자가 정하지 않은 `stubPath`를 지우고 `pythonPath`를 넣는다(`:128-172`). 초기화 옵션 `diagnosticMode`, `disablePullDiagnostics`(`:178-181`). 명령 `pyright.organizeimports`는 서버가 준 편집을 클라이언트가 문서에 적용하고(`:189-218`), `pyright.createtypestub`, `pyright.restartserver`는 `workspace/executeCommand`로 넘긴다(`:220-227`).
- **e. 변경 감지.** Python 확장의 변경 이벤트를 받으면 `didChangeConfiguration`을 `settings: null`로 보낸다(`:146-156`, `:372-390`). 재시작은 서버 명령이다.
- **f. 실패와 화면.** Pylance가 있으면 오류 알림을 띄우고 스스로 꺼진다(`:59-71`). basedpyright는 `python.languageServer`나 Pylance 타입 검사와 겹치면 모달 경고로 고칠지 묻는다(`BP/vscode-pyright/src/extension.ts:120-168`).

### 2. VS Code에 묶인 정도

Pyright: window 16(그중 `activeTextEditor` 15는 개발용 덤프 명령), commands 8, workspace 4(`getConfiguration`), extensions 2. basedpyright: window 17, workspace 12, commands 7, env 2, extensions 2. 필요한 화면 요소는 알림과 출력 채널뿐이다. 클라이언트에만 있는 로직은 1절의 d가 전부이고 모두 화면과 무관하다.

### 3. VS Code 없이 쓸 수 있는 부품

- npm `pyright`(MIT, `PR/pyright/package.json:6`): `pyright-langserver --stdio`(`:51-54`). `python.pythonPath`, `python.venvPath`, `python.analysis.*`를 `workspace/configuration`으로 받는다(`PR/pyright-internal/src/pyrightServer.ts:87-156`). `--cancellationReceive=file:<폴더>`도 받는다(`PR/pyright-internal/src/common/fileBasedCancellationUtils.ts:142-160`).
- npm과 PyPI의 `basedpyright`(MIT, `BP/pyright/package.json:6`): `basedpyright-langserver`(`:44-49`, `vendor/basedpyright/pyproject.toml:57-59`).
- `pyrightconfig.json` 스키마(`PR/vscode-pyright/package.json:1568-1573`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **서버 실행.** 클라이언트는 Node IPC, 힙 3GB, 분석 스레드 1개. Zed와 Setdown은 `langserver.index.js --stdio`라 분석 스레드가 없다(`ZPY:646`, `SD/catalog/profiles.json:46-51`). 힙 옵션은 `ZPY`와 `apps/desktop/src/main`을 검색해도 나오지 않는다.
2. **인터프리터.** 클라이언트는 Python 확장에 묻는다. Zed는 PET 결과를(`ZPY:737-765`), Setdown은 자체 탐색 결과를 넣는다(`SD/analysis-context.ts:71-84`).
3. **취소.** 클라이언트는 파일 기반. Zed와 Setdown은 표준 `$/cancelRequest`만 쓴다(추정. 파일 방식 인자가 없다는 것만 확인).
4. **기본 설정.** 클라이언트는 `diagnosticMode`를 초기화 옵션으로 넘긴다. Setdown은 `openFilesOnly`, `typeCheckingMode: basic`, `useLibraryCodeForTypes`, `autoSearchPaths`를 설정으로 준다(`SD/catalog/profiles.json:59-67`). `.vscode/settings.json`의 `python.analysis.extraPaths`와 `typeCheckingMode`도 읽는다(`SD/python-project-settings.ts:27-57`).
5. **타입 스텁.** Pyright 클라이언트에는 없다. Setdown은 Pylance처럼 스텁을 넣어 준다(`SD/python-library-stubs.ts:42-60`, `PL/USING_WITH_PYRIGHT.md:34-39`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것:** VS Code API 1.101 이상, `vscode-languageclient`가 쓰는 문서·설정·명령 API, Node IPC로 자식 프로세스 띄우기. 인터프리터를 자동으로 얻으려면 Python 확장(과 그 요구사항 전부)이 함께 있어야 한다.
- **막는 것:** 없다. MIT이고 닫힌 부분이 없다.
- **얻는 것:** (1) 분석 스레드 1개와 힙 3GB, (2) 파일 기반 취소, (3) `organizeimports` 명령. 세 가지 모두 Setdown의 서버 실행 인자와 클라이언트에 옮기면 되고, 확장 호스트를 들일 이유가 되지 않는다. (1)과 (2)가 큰 파일에서 응답성에 주는 효과는 측정하지 않았다(추정).

---

## Python: Pylance (`vendor/pylance-release`)

- 저장소에는 문서, 변경 기록, 릴리스 번호 파일만 있다. "The Pylance codebase is not open-source"(`PL/README.md:5`). 최신 릴리스는 Pylance 2026.4.1, 그 안의 Pyright는 1.1.414다(`PL/releases/latest-release.json:1`).
- 저장소의 `LICENSE`는 CC BY 4.0이고 문서에 대한 것이다(`PL/LICENSE:1`, `:57`). Pylance 제품의 라이선스 원문은 저장소에 없다. vscode-python 배포판 안내문이 "only available in binary form and is released under a Microsoft proprietary license"라고 적고 Marketplace 주소를 가리킨다(`VP/build/license-header.txt:6-7`).
- 사용 범위: "Pylance is licensed for use in Microsoft products and services only, so can only be used on official Microsoft builds of Visual Studio Code and GitHub Codespaces."(`PL/FAQ.md:17`). "To use Pylance, you must be running an official build of VS Code."(`PL/TROUBLESHOOTING.md:99`). 최소 VS Code 1.107.0(`PL/TROUBLESHOOTING.md:95`). 공개 계획 없음(`PL/FAQ.md:12`).
- Pyright보다 더 있는 것: 의미 색칠, 리팩터링 코드 액션, 내장·표준 라이브러리 설명문, IntelliCode, 인기 패키지 스텁 묶음(`PL/FAQ.md:9`, `PL/USING_WITH_PYRIGHT.md:34-39`).
- 클라이언트 로직은 볼 수 없다. vscode-python 쪽에서 보이는 것은 1.d의 전용 요청 네 개와 `api.client.start()` 호출뿐이다.

**결론.** Pylance는 어떤 방식으로도 Setdown에 넣을 수 없다. Pylance가 Pyright에 더한 것 가운데 스텁 묶음은 Setdown이 이미 따로 넣었다(`SD/python-library-stubs.ts:4-12`).

---

## 확인하지 못한 것

- PET의 소스와 라이선스. 두 확장은 빌드 때 받아 오고, Zed는 `zed-industries` 포크를 git 의존으로 쓴다(`vendor/zed/Cargo.toml:839`).
- Pylance 제품 라이선스 원문, Marketplace 약관 원문, jedi-language-server 라이선스.
- Pylance 내부 클라이언트가 하는 일.
- 실제 동작 전부. 아무것도 실행하지 않았다. VS Code가 아닌 확장 호스트(Theia 등)에서 이 확장들이 도는지도 보지 않았다.
- API 사용 횟수는 정규식 집계라 근사치다. 래퍼를 거친 호출은 메서드 이름 출현 수로만 보였다.
