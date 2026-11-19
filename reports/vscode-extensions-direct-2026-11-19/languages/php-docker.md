# PHP · Dockerfile · Docker Compose: VS Code 확장이 실제로 하는 일

작성일 2026-11-19 · 소스만 읽고 썼다. 빌드, 설치, 실행은 하지 않았다. "확인"은 아래 리비전의 소스에서 본 것이다. 소스가 저장소에 없어 보지 못한 것은 "추정" 또는 "확인 못 함"으로 적는다.

기준 리비전: `vendor/vscode-intelephense` 8935a6d · `vendor/vscode` d3d31f62268 (1.142.0, `vendor/vscode/package.json:3`) · `vendor/vscode-containers` b1eab41 · `vendor/docker-vscode-extension` 26e0ea2.

API 사용 횟수는 두 가지로 셌다. (1) `vscode.<이름공간>.<멤버>` 꼴은 과제에 적힌 grep 그대로. (2) `import { window, workspace } from 'vscode'`처럼 이름으로 가져온 파일은 앞에 `.`이나 글자가 붙지 않은 `window.` `workspace.` `commands.` … 를 따로 셌다. (2)는 같은 이름의 지역 변수가 섞일 수 있어 상한이다. 줄 수는 `wc -l`, 테스트 폴더 제외.

## 네 확장을 한 줄씩

- **PHP Intelephense**: 전문가가 쓴 분석 로직은 전부 비공개 서버(npm `intelephense`)에 있고 Setdown은 이미 그 서버를 돌린다. 확장의 클라이언트는 575줄이고, VS Code 밖에서도 뜻이 있는 것은 초기화 옵션 5개, 캐시 비우기, 라이선스 키 입력·활성화, 설정 병합뿐이다.
- **PHP Language Features (내장)**: 언어 서버가 없다. `php -l`을 돌려 문법 오류를 표시하고, 생성된 표에서 내장 함수 이름을 제안한다. Intelephense 안내문이 이 확장을 끄라고 한다.
- **Container Tools**: 언어 클라이언트는 이 저장소에 있다(160줄). Dockerfile 서버는 Setdown과 같은 rcjsuen 서버다. Compose 서버(Microsoft 자체 제작)는 스키마 검사를 하지 않으며, Setdown이 고른 `yaml-language-server`보다 Setdown 자체 측정에서 덜 답했다. 확장의 나머지 1.9만 줄은 컨테이너 관리다.
- **Docker DX**: 로직은 Go로 된 `docker-language-server` 실행 파일에 있다(저장소에 없음, Setdown 카탈로그에는 이미 있음). 클라이언트 1,422줄 중 언어 부분은 약 430줄이고, 서버에 넘기는 초기화 옵션과 실험 기능 선언이 핵심이다.

---

## PHP: PHP Intelephense (`vendor/vscode-intelephense`)

| 항목 | 값 |
| --- | --- |
| 버전 | 1.18.5 (`vendor/vscode-intelephense/package.json:13`) |
| 라이선스 | 클라이언트 MIT (`vendor/vscode-intelephense/LICENSE.txt:1-5`), 서버는 별도의 "Intelephense Licence" (`vendor/vscode-intelephense/LICENSE.txt:27-31`) |
| `engines.vscode` | `^1.91.0` (`vendor/vscode-intelephense/package.json:15-17`) |
| 클라이언트 소스 | 3개 파일 575줄 (`src/extension.ts` 397, `src/middleware.ts` 151, `src/embeddedContentUri.ts` 27) |
| `extensionDependencies` / `enabledApiProposals` | 둘 다 없음 (manifest에 해당 키 없음) |
| 기여 수 | commands 3 (`vendor/vscode-intelephense/package.json:80-96`), configuration 77 (같은 파일 `:112-1037`), languages 1 (id만, `:75-79`). views, debuggers, taskDefinitions 없음 |
| 언어 서버 | npm `intelephense` 1.18.5 (`vendor/vscode-intelephense/package.json:1059`). 비공개이고 저장소에 소스가 없다. `node_modules`가 없고 잠금 파일은 npm 레지스트리의 tarball만 가리킨다 (`vendor/vscode-intelephense/package-lock.json:1736-1738`) |

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** 내려받지 않는다. 서버가 확장 꾸러미 안에 들어 있다. 꾸러미에서 `node_modules` 중 `intelephense`만 남기고 (`vendor/vscode-intelephense/.vscodeignore:13-14`), `node_modules/intelephense/lib/intelephense.js`를 서버 모듈로 쓴다 (`vendor/vscode-intelephense/src/extension.ts:203-209`).
- **b. 런타임·환경.** Node IPC로 띄운다 (`vendor/vscode-intelephense/src/extension.ts:218-221`). 기본 런타임은 VS Code에 든 Node이고 (`vendor/vscode-intelephense/package.json:795-799`), `intelephense.runtime`으로 다른 Node 경로를, `intelephense.maxMemory`(256 이상)로 `--max-old-space-size`를 준다 (`vendor/vscode-intelephense/src/extension.ts:223-236`). 신뢰하지 않는 작업 공간에서는 이 둘을 작업 공간 설정으로 줄 수 없다 (`vendor/vscode-intelephense/package.json:60-68`).
- **c. 프로젝트 범위.** 루트를 정하는 코드가 없다. 문서 선택자(`php`, `file`·`untitled`)만 준다 (`vendor/vscode-intelephense/src/extension.ts:247-251`). 작업 공간 폴더 전달은 `vscode-languageclient` 기본 동작이다 (추정, 그 라이브러리는 읽지 않았다). 가상 작업 공간은 색인하지 않는다고 선언한다 (`vendor/vscode-intelephense/package.json:69-72`).
- **d. 표준 LSP 밖의 통신.**
  - 초기화 옵션 `storagePath`, `clearCache`, `globalStoragePath`, `licenceKey`, `isVscode: true` (`vendor/vscode-intelephense/src/extension.ts:238-244`).
  - 사용자 요청 `cancelIndexing` (`vendor/vscode-intelephense/src/extension.ts:26, 305-307`).
  - `workspace/configuration` 응답을 가로채 VS Code의 `files.associations`(값이 `php`인 것), `files.exclude`, `php.validate.run`을 합친다 (`vendor/vscode-intelephense/src/middleware.ts:32-82, 117-133`).
  - 코드 렌즈 명령 `editor.action.peekLocations`의 인자를 VS Code 객체로 바꾼다 (`vendor/vscode-intelephense/src/middleware.ts:84-114`). 서버가 VS Code 내장 명령 이름을 보낸다는 뜻이다.
  - 라이선스 키 활성화: `intelephense.com/activate`에 `sha256(홈 디렉터리)`와 키를 POST하고 응답을 `globalStoragePath/intelephense_licence_key_<키>`에 쓴다 (`vendor/vscode-intelephense/src/extension.ts:353-397`). 키는 `globalState`에 두고 기기 간 동기화 대상으로 등록한다 (같은 파일 `:78, 330`).
  - PHP 파일 속 HTML/JS/CSS는 VS Code의 서버로 넘기지 않는다. `embeddedContentUri.ts`는 어디서도 import되지 않고, 변경 기록이 "HTML/JS/CSS language service moved to server"라고 적는다 (`vendor/vscode-intelephense/CHANGELOG.md:1375`).
- **e. 변경 감지와 재시작.** 작업 공간에 저장한 버전이 지금 버전과 다르면 `storagePath`를 지우고 `clearCache: true`로 시작한다 (`vendor/vscode-intelephense/src/extension.ts:80-92`). "Index workspace"는 클라이언트를 멈추고 `clearCache: true`로 새로 만든다 (같은 파일 `:293-303`). 키를 넣으면 재시작한다 (`:341-348`). `runtime`과 `maxMemory`는 클라이언트를 만들 때만 읽고 바뀜을 듣지 않는다 (`:223-225`).
- **f. 실패 처리와 화면.** 상태 표시줄 항목이 없다. `start()`에 실패 처리가 없어 (`vendor/vscode-intelephense/src/extension.ts:111-113`) 실패 화면은 전부 `vscode-languageclient` 기본값이다. 출력 채널은 자동으로 열지 않는다 (`:253`). 자체 화면은 셋이다: 새 버전 알림과 구매 안내 (`:265-284`), 키 입력 상자 (`:309-328`), 활성화 실패 오류 (`:337`).

### 2. VS Code에 묶인 정도

- 전부 이름으로 가져온다 (`vendor/vscode-intelephense/src/extension.ts:13`, `vendor/vscode-intelephense/src/middleware.ts:16-24`). `vscode.` 꼴은 0회. 이름 꼴: workspace 8 (`getConfiguration` 6, `onDidChangeTextDocument` 1, `onDidChangeConfiguration` 1), window 5 (`showInformationMessage` 2, `showInputBox` 1, `showErrorMessage` 1, `activeTextEditor` 1), commands 3, languages 1, env 1. 나머지 이름공간 0. `ExtensionContext`는 `globalState` 7, `storagePath` 3, `globalStoragePath` 2, `workspaceState` 2, `asAbsolutePath` 2.
- 필요한 UI: 알림, 입력 상자, 명령 팔레트. 상태 표시줄, 퀵 픽, 웹뷰, 트리 뷰, 터미널, 작업, 디버그는 쓰지 않는다.
- VS Code 없이도 뜻이 있는 것: 초기화 옵션, 버전이 바뀌면 캐시 비우기, 키 활성화, `cancelIndexing`, 제외 목록 병합.
- VS Code 안에서만 뜻이 있는 것: `setLanguageConfiguration`(문서 주석 줄바꿈 규칙, `vendor/vscode-intelephense/src/extension.ts:39-76`), `<?=` 뒤 `?>` 자동 삽입 (`:116-201`), `peekLocations` 인자 변환, `globalState` 동기화.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 `intelephense` 1.18.5.** `intelephense --stdio`로 표준 LSP를 말한다 (Setdown이 그렇게 쓴다: `apps/desktop/src/main/language/catalog/profiles.json:4141-4147`). 클라이언트가 저장 위치를 주지 않으면 `~/.config/intelephense/` 아래를 쓰고 키는 `…/global/licence.txt`에서 읽는다 (`vendor/vscode-intelephense/CHANGELOG.md:190-194`).
- **라이선스.** 비공개다. "The language server (intelephense) is proprietary" (`vendor/vscode-intelephense/README.md:40`). 유료 기능은 "rename; code folding; find all implementations; go to type definition; go to declaration; smart select; code actions; code lens; type hierarchy; inlay hints; document links" (`vendor/vscode-intelephense/LICENSE.txt:41-43`).
- 클라이언트 575줄은 MIT다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

Zed에서 PHP는 Zed 확장이 제공한다 (`vendor/zed/docs/src/languages/php.md:8`). Zed의 기본 서버는 phpactor이고 Intelephense는 설정으로 고른다 (`vendor/zed/assets/settings/default.json:2599`, Windows만 기본이 Intelephense: `:2964`). Setdown은 Intelephense를 기본 도구로 정했고 (`apps/desktop/src/core/document/supported-languages.ts:12`), PHP는 Zed 프로젝트 엔진 목록에 없어 Setdown 자체 클라이언트로 돈다 (`apps/desktop/src/main/language/zed-settings.ts:12`).

1. **확보.** 확장은 서버를 꾸러미에 넣어 온다 (`vendor/vscode-intelephense/.vscodeignore:13-14`). Setdown은 PHP 파일을 열 때 사람에게 묻지 않고 준비를 시작한다. 지원 언어의 도구는 자동 설치 대상이고 (`apps/desktop/src/main/language/server-registry.ts:117-120`), 찾기와 설치는 Zed의 `php` 확장이 맡는다 (`apps/desktop/src/main/language/catalog/zed-profiles.json:60862-60864`, `apps/desktop/src/main/language/language-manager.ts:552-570`, `apps/desktop/src/main/language/language-provisioner.ts:153-165`). 이미 깔린 프로그램을 쓰는지 새로 받는지는 그 확장이 정하는데, 소스가 저장소에 없어 확인 못 했다.
2. **전송과 메모리.** 확장은 Node IPC와 `--max-old-space-size` 설정 (`vendor/vscode-intelephense/src/extension.ts:218-236`). Setdown은 표준 입출력이고 (`apps/desktop/src/main/language/server-session.ts:69-73`) 메모리 설정에 해당하는 항목이 프로필에 없다 (`apps/desktop/src/main/language/catalog/profiles.json:4141-4152`).
3. **초기화 옵션.** 확장은 5개를 보낸다 (`vendor/vscode-intelephense/src/extension.ts:238-244`). Setdown 프로필에는 초기화 옵션이 없고 (`apps/desktop/src/main/language/catalog/profiles.json:4123-4171`), Zed `php` 확장이 돌려주는 값과 합쳐 보낸다 (`apps/desktop/src/main/language/language-provisioner.ts:178-179`). 그 확장의 소스는 저장소에 없어 실제로 무엇이 가는지 확인 못 했다.
4. **라이선스 키.** 확장은 명령, 입력 상자, 활성화 요청을 갖는다 (`vendor/vscode-intelephense/src/extension.ts:309-397`). Setdown에는 화면이 없다. 사람이 키 파일을 직접 두거나 초기화 옵션 `licenceKey`를 적어야 한다 (`vendor/zed/docs/src/languages/php.md:65-79`).
5. **설정.** 확장은 설정 77개를 보여 주고 편집기의 파일 연결·제외 설정을 합친다 (`vendor/vscode-intelephense/src/middleware.ts:66-82`). Setdown은 프로필의 설정으로 `workspace/configuration`에 답하는데 (`apps/desktop/src/main/language/server-session.ts:106-107`) 그 설정이 비어 있다 (`apps/desktop/src/main/language/catalog/profiles.json:4152`).
6. **색인.** 확장에는 색인 다시 만들기와 취소 명령이 있다 (`vendor/vscode-intelephense/src/extension.ts:293-307`). Setdown에는 일반 재시작만 있다 (`apps/desktop/src/main/language/language-manager.ts:351-359`).
7. **실패.** 확장은 라이브러리 기본값에 맡긴다 (`vendor/vscode-intelephense/src/extension.ts:111-113`). Setdown은 1·3·5초 간격으로 세 번 다시 붙고 (`apps/desktop/src/main/language/language-supervisor.ts:8-11`) 상태 문장을 낸다 (`apps/desktop/src/main/language/language-manager.ts:692-693`).

Setdown의 측정에서 Intelephense는 nikic/FastRoute에서 시작, 오류 표시, 호버, 완성, 정의 이동을 모두 답했다 (`apps/lsp-benchmark/results/medium.md:13`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** VS Code 1.91 이상의 API, 저장 위치와 `globalState`를 가진 `ExtensionContext`, 기여된 설정 77개의 기본값을 돌려주는 `workspace.getConfiguration`, 알림과 입력 상자, `languages.setLanguageConfiguration`. 그리고 번들에 든 `vscode-languageclient` 9.0.1이 부르는 API 전부다 (`vendor/vscode-intelephense/package.json:1061`, 외부로 남기는 모듈은 `vscode`뿐: `vendor/vscode-intelephense/webpack.config.js:19-20`). 뒤쪽이 양으로는 대부분이다 (그 라이브러리는 이 분석에서 읽지 않았다).
- **막는 것.** 서버 라이선스다. 재배포 금지: "Reproduce, copy, distribute, resell or otherwise use the whole or any part of the Software for any purpose except where permitted by item 3 INTENDED USE" (`vendor/vscode-intelephense/LICENSE.txt:72-73`). 허용된 사용은 "An individual end user may use the Software paired with a Language Server Protocol compatible Integrated Development Environment or text editor" (`:51-53`). 따라서 서버가 든 확장 꾸러미를 Setdown에 넣어 배포할 수 없다.
- **지금 Setdown에도 걸리는 조항 둘.**
  - "By installing this software you agree to be bound by the provisions of this agreement" (`vendor/vscode-intelephense/LICENSE.txt:33-34`). Setdown은 묻지 않고 준비를 시작하고 (위 4절 1번), 이 문구를 보여 주는 코드는 찾지 못했다.
  - "Disable, modify or hide notifications sent by the Software" 금지 (`vendor/vscode-intelephense/LICENSE.txt:74`). Setdown 자체 클라이언트는 `window/showMessage`를 기록에만 남긴다 (`apps/desktop/src/main/language/server-session.ts:120-121`). 이것이 "hide"에 해당하는지는 법적 판단이라 여기서 정하지 못한다.
  - 또 Setdown 카탈로그는 이 서버의 라이선스를 MIT로 적고 있다 (`apps/desktop/src/main/language/catalog/mason.json:3707-3709`). 위 라이선스 문서와 맞지 않는다. 이 값이 화면에 나오는 곳은 찾지 못했다.
- **얻는 것.** (1) 키 입력과 활성화 화면. (2) 색인 다시 만들기·취소 명령. (3) 설정 77개와 편집기 파일 설정 병합. (4) 버전이 바뀔 때 캐시 비우기. (5) `<?=` 자동 닫기와 문서 주석 줄바꿈. 분석 품질은 달라지지 않는다. 서버가 같다.

---

## PHP: PHP Language Features, VS Code 내장 (`vendor/vscode/extensions/php-language-features`)

| 항목 | 값 |
| --- | --- |
| 버전 | 10.0.0, VS Code 1.142.0에 내장되어 끌 수는 있고 지울 수는 없다 (`vendor/vscode/extensions/php-language-features/package.json:5`, `vendor/vscode/extensions/php-language-features/README.md:3`) |
| 라이선스 | MIT (`vendor/vscode/extensions/php-language-features/package.json:7`) |
| `engines.vscode` | `0.10.x` (같은 파일 `:9-11`) |
| 클라이언트 소스 | 11개 파일 7,265줄. 그중 6,363줄은 생성된 표다 (`src/features/phpGlobalFunctions.ts` 6,039줄, `src/features/phpGlobals.ts` 324줄). 로직은 902줄 |
| `extensionDependencies` / `enabledApiProposals` | 없음 |
| 기여 수 | configuration 4 (`vendor/vscode/extensions/php-language-features/package.json:30-64`), jsonValidation 1 (`composer.json`, `:65-70`). commands 0 |
| 언어 서버 | 없다. 확장 호스트 안에서 진단, 완성, 호버, 시그니처 도움말 제공자를 직접 등록한다 (`vendor/vscode/extensions/php-language-features/src/phpMain.ts:13-22`) |

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** 내려받지 않고 사람의 `php`를 쓴다. 찾는 순서: 작업 공간의 `php.validate.executablePath`, 사용자 설정의 같은 값, 없으면 PATH에서 `which('php')` (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:307-328, 338-344`). 상대 경로는 첫 작업 공간 폴더에 붙인다 (`:319-325`).
- **b. 런타임.** `php -l -n -d display_errors=On -d log_errors=Off`를 첫 작업 공간 폴더에서 돌린다 (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:88-89, 219, 228`). 기본은 저장할 때 `-f <파일>` (`:221-223`, 기본값 `vendor/vscode/extensions/php-language-features/package.json:54-61`). 입력할 때로 바꾸면 250ms 뒤 본문을 표준 입력으로 넣는다 (`validationProvider.ts:181, 239-242`).
- **c. 프로젝트 범위.** 없다. 파일 하나씩 검사한다.
- **d. 통신.** LSP가 아니다. 출력에서 `(Parse|Fatal) error: … in … on line N`을 정규식으로 찾아 그 줄 전체에 진단을 건다 (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:87, 206-217`).
- **e. 변경 감지.** 설정이 바뀌면 설정을 다시 읽고 진단을 지운 뒤 열린 문서를 모두 다시 검사한다 (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:109, 137-169`).
- **f. 실패와 화면.** `php`가 없거나 실행에 실패하면 "Open Settings" 단추가 달린 알림을 한 번 띄우고 검사를 멈춘다. 실행 파일 설정이 바뀔 때까지 다시 시도하지 않는다 (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:150-152, 190-196, 229-237, 281-293`).
- **신뢰.** 자체 확인 창은 없다. VS Code의 작업 공간 신뢰를 쓴다. 신뢰된 작업 공간에서만 검사하고 (`vendor/vscode/extensions/php-language-features/src/features/validationProvider.ts:177`), 실행 파일 경로는 신뢰되지 않은 작업 공간에서 제한 설정이다 (`vendor/vscode/extensions/php-language-features/package.json:19-28`).
- **내장 완성 자료.** 전역 변수, 내장 함수, 컴파일 시점 상수, 키워드 표에서 접두사가 맞는 것을 내고, 현재 파일에서 `$변수`와 `function 이름(`을 정규식으로 찾아 더한다 (`vendor/vscode/extensions/php-language-features/src/features/completionItemProvider.ts:66-111`). 함수 표는 생성 파일이고 (`vendor/vscode/extensions/php-language-features/src/features/phpGlobalFunctions.ts:6`) 설명이 달린 항목이 1,518개다 (`description:` 줄을 센 값). 호버와 시그니처 도움말도 같은 표를 읽는다 (`vendor/vscode/extensions/php-language-features/src/features/hoverProvider.ts:26-31`, `vendor/vscode/extensions/php-language-features/src/features/signatureHelpProvider.ts:89-100`).

### 2. VS Code에 묶인 정도

- `vscode.` 꼴: workspace 13, l10n 6, languages 4, window 1, commands 1. 이름 꼴: 제공자 세 파일에서 `workspace.getConfiguration` 3. 나머지 이름공간 0.
- 필요한 UI: 알림 한 종류와 진단 표시뿐이다.
- VS Code 없이도 뜻이 있는 것: `php -l` 실행과 출력 해석, 함수 표. VS Code 안에서만 뜻이 있는 것: 제공자 등록과 작업 공간 신뢰 판단.

### 3. VS Code 없이 쓸 수 있는 부품

- `php` 실행 파일 (사람이 설치한 것, 확장에 들어 있지 않다).
- 함수·상수 표 6,363줄 (MIT). 로직 902줄은 다시 쓰는 편이 빠르다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. Setdown은 `php -l` 검사도 내장 함수 표도 없다. PHP의 진단과 완성은 Intelephense가 낸다 (`apps/desktop/src/core/document/supported-languages.ts:12`, `apps/lsp-benchmark/results/medium.md:13`).
2. Intelephense 안내문은 이 내장 확장을 끄라고 한다 (`vendor/vscode-intelephense/README.md:44-48`). 둘을 함께 켜면 겹친다는 뜻이다.
3. Zed의 PHP 확장은 `php`가 PATH에 있어야 한다고 적는다 (`vendor/zed/docs/src/languages/php.md:14-16`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** 완성·호버·시그니처 제공자 등록, 진단 모음, 문서 열림·저장·변경 이벤트, 작업 공간 신뢰 값, `l10n`.
- **막는 것.** 없다 (MIT, 닫힌 부분 없음).
- **얻는 것.** (1) 설치된 PHP 버전 그대로의 문법 오류. (2) 내려받기 없이 동작. Intelephense를 쓰는 한 둘 다 이미 있다.

---

## Dockerfile · Compose: Container Tools (`vendor/vscode-containers`)

| 항목 | 값 |
| --- | --- |
| 버전 | 2.5.4-alpha (`vendor/vscode-containers/extensions/vscode-containers/package.json:3`) |
| 라이선스 | MIT (`vendor/vscode-containers/LICENSE.md:7-13`) |
| `engines.vscode` | `^1.109.0` (`vendor/vscode-containers/extensions/vscode-containers/package.json:3381-3383`) |
| 클라이언트 소스 | 확장 본체 252개 파일 19,036줄. 그중 언어 관련은 348줄이다: `src/extension.ts:198-357` 160줄, FROM 줄 이미지 완성 3개 파일 188줄. Compose 패키지의 VS Code 쪽은 3개 파일 150줄, 공용 정의 6개 파일 170줄, Compose 서버는 24개 파일 2,234줄 |
| `extensionDependencies` | `vscode.docker`, `vscode.yaml` (같은 `package.json:3417-3420`) |
| `enabledApiProposals` | 없음 |
| 기여 수 | commands 101 (`:2635-3171`), configuration 56 (`:1640-2634`), views 7 (`:3172-3213`), debuggers 2 (`:681-973`), taskDefinitions 4 (`:974-1600`), walkthroughs 1 (`:3223-3365`), languageModelTools 1 (`:3366-3379`), languages 2 (`:1601-1627`) |
| 언어 서버 | Dockerfile: npm `dockerfile-language-server-nodejs` ^0.15.0 (`:3441`), 공개(MIT로 기록: `apps/desktop/src/main/language/catalog/mason.json:2187-2197`), 소스는 저장소에 없다. Compose: 이 저장소의 `packages/compose-language-service` 1.0.0, MIT (`vendor/vscode-containers/packages/compose-language-service/package.json:2-7`) |

언어 클라이언트는 이 저장소에 있다. `vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:233-290`이 Dockerfile, `:292-355`가 Compose다. 관리 기능은 다루지 않는다. 규모만 적으면 명령 85개 파일 4,780줄, 트리 뷰 50개 4,225줄, 작업 18개 2,052줄, 디버깅 13개 1,979줄, 파일 생성 31개 1,785줄이다.

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** 내려받지 않는다. 두 서버를 빌드 때 확장 안에 묶는다 (`vendor/vscode-containers/extensions/vscode-containers/esbuild.mjs:21-31`).
- **b. 런타임.** 둘 다 Node IPC, 인자 `--node-ipc` (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:251-256, 316-321`). 런타임을 고르는 설정이 없다.
- **c. 프로젝트 범위.** 루트 로직이 없다. Dockerfile은 `file` 스킴의 `dockerfile` 문서 (`:37-39`), Compose는 `dockercompose` 문서 (`:329-331`)가 대상이다. 두 언어 id는 VS Code 내장 확장이 정한다 (`vendor/vscode/extensions/docker/package.json:17-29`, `vendor/vscode/extensions/yaml/package.json:18-30`). 가상 작업 공간은 지원하지 않는다 (`vendor/vscode-containers/extensions/vscode-containers/package.json:3385`).
- **d. 표준 LSP 밖의 통신.**
  - Dockerfile: `workspace/configuration`에 VS Code 설정을 그대로 답한다 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:202-218, 264-268`). 대상은 `docker.languageserver.*` 설정 10개다 (`vendor/vscode-containers/extensions/vscode-containers/package.json:2418-2544`).
  - Compose: 서버가 편집기의 탭 크기와 줄 끝을 묻는 요청 `$/textDocument/documentSettings`, 바뀌면 알리는 `$/textDocument/documentSettings/didChange` (`vendor/vscode-containers/packages/compose-language-service/src/common/DocumentSettingsClientCapabilities.ts:28-40`, `vendor/vscode-containers/packages/compose-language-service/src/vscode/DocumentSettingsClientFeature.ts:44-76`).
  - Compose: Red Hat YAML이나 Docker DX가 깔려 있으면 겹치는 기능을 끄라고 실험 기능으로 알린다 (`vendor/vscode-containers/packages/compose-language-service/src/vscode/AlternateYamlLanguageServiceClientFeature.ts:25-53`). 서버는 그에 따라 기능을 뺀다 (`vendor/vscode-containers/packages/compose-language-service/src/service/ComposeLanguageService.ts:99-148`).
  - Compose 코드 렌즈가 부르는 명령 `vscode-containers.compose.up`은 확장이 구현한다 (`vendor/vscode-containers/packages/compose-language-service/src/service/providers/ServiceStartupCodeLensProvider.ts:48-54`).
  - 서버 없이 클라이언트가 직접 하는 것: FROM 줄에서 Docker Hub를 검색해 이미지 이름을 제안한다 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:77-84`, `vendor/vscode-containers/extensions/vscode-containers/src/dockerHubSearch.ts:75`).
- **e. 변경 감지와 재시작.** 어떤 설정이든 바뀌면 Dockerfile 서버에 `didChangeConfiguration`을 보낸다 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:220-229`). Compose 서버 켜고 끄기는 VS Code를 다시 시작해야 반영된다 (`vendor/vscode-containers/extensions/vscode-containers/package.nls.json:218`). 언어 서버를 다시 띄우는 코드나 명령은 찾지 못했다 (`src`와 manifest를 `restart`로 검색).
- **f. 실패 처리와 화면.** 두 클라이언트 모두 `callWithTelemetryAndErrorHandling` 안에서 시작한다 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:235, 294`). 이 함수는 저장소에 없는 `@microsoft/vscode-azext-utils`의 것이라 실패 때 사람이 무엇을 보는지 확인 못 했다. 언어 클라이언트는 트리, 디버그, 작업 등록 뒤에 시작하고 (`:105-117`) 활성화 오류는 다시 던지므로 (`:56`), 앞 단계가 실패하면 언어 서버가 뜨지 않는다.

### 2. VS Code에 묶인 정도

- 확장 전체, `vscode.` 꼴: l10n 234, workspace 58, window 52, commands 26, env 23, extensions 7, debug 4, tasks 3, languages 1. 이름 꼴(65개 파일, 상한): l10n 189, window 18, workspace 16, tasks 6, commands 5, debug 4, extensions 1, env 1. `lm`은 직접 부르지 않고 azext 라이브러리를 거친다 (`vendor/vscode-containers/extensions/vscode-containers/src/copilot/registerContainersLMTools.ts:6-10`).
- 언어 부분만: `workspace.getConfiguration` 3, `onDidChangeConfiguration` 1, `createFileSystemWatcher` 1, `extensions.getExtension` 2, `window.visibleTextEditors` 1, `window.onDidChangeTextEditorOptions` 1, `languages.registerCompletionItemProvider` 1.
- 확장 전체가 필요로 하는 UI: 트리 뷰 7, 상태 표시줄, 퀵 픽, 알림, 출력 채널, 둘러보기, 터미널, 작업, 디버그. 언어 부분은 출력 채널만 쓴다.
- VS Code 없이도 뜻이 있는 것: 두 서버, 편집기 탭 크기 전달, 다른 YAML 서버와 겹침 피하기. VS Code 안에서만 뜻이 있는 것: 코드 렌즈의 실행 명령, 설정 화면.

### 3. VS Code 없이 쓸 수 있는 부품

- **`dockerfile-language-server-nodejs`**: `docker-langserver --stdio`, 표준 LSP (`apps/desktop/src/main/language/catalog/profiles.json:2336-2342`). Setdown의 기본 Dockerfile 도구와 같은 서버다.
- **`@microsoft/compose-language-service`**: 실행 이름 `docker-compose-langserver` (`vendor/vscode-containers/packages/compose-language-service/package.json:40-42`), Node 22 이상 (`:52-54`), MIT. VS Code 밖에서 쓰라고 안내한다 (`vendor/vscode-containers/packages/compose-language-service/README.md:33`). 편집기가 탭 크기를 답하지 않으면 본문에서 추측한다 (`vendor/vscode-containers/packages/compose-language-service/src/service/ComposeDocument.ts:73-87`).
- 이 서버는 스키마 검사를 하지 않는다: "At present schema validation is not supported" (`vendor/vscode-containers/packages/compose-language-service/src/service/providers/DiagnosticProvider.ts:27-29`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

Zed에서 Dockerfile은 Zed 확장이 제공한다 (`vendor/zed/docs/src/languages/docker.md:16-21`). Setdown은 Dockerfile과 Compose 둘 다 Zed 프로젝트 엔진으로 돌린다 (`apps/desktop/src/main/language/zed-settings.ts:12`).

1. **Dockerfile 서버는 같다.** 확장은 묶어 오고 (`vendor/vscode-containers/extensions/vscode-containers/esbuild.mjs:21-25`), Setdown은 Zed의 `dockerfile` 확장으로 받는다 (`apps/desktop/src/main/language/catalog/zed-profiles.json:60853-60855`).
2. **Dockerfile 규칙 설정.** 확장은 10개 설정을 화면에 내고 서버 질문에 답한다 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:202-218`). Setdown 프로필의 설정은 비어 있어 (`apps/desktop/src/main/language/catalog/profiles.json:2347`) Zed에 넘기는 값이 없고 (`apps/desktop/src/main/language/zed-settings.ts:83-86`), 서버 기본값으로 돈다.
3. **Compose 서버가 다르다.** 확장은 Microsoft 서버, Setdown은 `yaml-language-server`다 (`apps/desktop/src/core/document/supported-languages.ts:17`). Setdown은 이것을 측정으로 정했다 (`apps/lsp-benchmark/README.md:42-45`). 같은 파일에서 `yaml-language-server`는 틀린 키를 표시하고 완성을 냈고 (`apps/lsp-benchmark/results/compose-yaml-language-server.md:7, 20-23`), Microsoft 서버는 둘 다 못 했다 (`apps/lsp-benchmark/results/light.md:13`). Zed 문서는 Compose에 Microsoft 서버를 쓰는 커뮤니티 확장을 안내한다 (`vendor/zed/docs/src/languages/docker.md:10-14`).
4. **탭 크기.** 확장은 전용 요청으로 답한다 (`vendor/vscode-containers/packages/compose-language-service/src/vscode/DocumentSettingsClientFeature.ts:46-58`). Zed의 YAML 어댑터는 작업 공간 설정에 `[yaml].editor.tabSize`를 넣어 준다 (`vendor/zed/crates/languages/src/yaml.rs:152-161`).
5. **Setdown에 없는 Compose 기능.** 이미지 이름의 Docker Hub 링크, 서비스 실행 코드 렌즈 (`vendor/vscode-containers/packages/compose-language-service/src/service/ComposeLanguageService.ts:55-66`), FROM 줄 이미지 완성 (`vendor/vscode-containers/extensions/vscode-containers/src/dockerfileCompletionItemProvider.ts:23-27`).
6. **프로젝트 범위.** 확장에는 로직이 없다. Setdown은 열린 폴더, 저장소, 프로젝트 표지, 단일 파일 순으로 정한다 (`apps/desktop/src/main/language/zed-settings.ts:136-145`).
7. **재시작.** 확장의 Compose 토글은 VS Code 재시작이 필요하다 (`vendor/vscode-containers/extensions/vscode-containers/package.nls.json:218`). Setdown은 설정이 바뀌면 Zed에 다시 적용하고 (`apps/desktop/src/main/language/project-languages.ts:153-159`) 재시작 요청이 있다 (`tooling/language-host/src/project_host.rs:617-627`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** VS Code 1.109 이상. 내장 확장 `vscode.docker`와 `vscode.yaml`. 트리 뷰, 작업, 디버그, 파일 시스템 제공자 (`vendor/vscode-containers/extensions/vscode-containers/src/extension.ts:93-103`), 상태 표시줄, 터미널 환경 변수 모음 (`:165-174`), 언어 모델 도구. 언어 부분만 켜는 길이 없다. 활성화 함수 하나가 전부 등록한다 (`:50-121`).
- **막는 것.** 라이선스는 없다 (MIT). 막는 것은 크기다. 언어 348줄을 돌리려고 관리 기능 1.9만 줄이 쓰는 API를 호스트가 구현해야 한다.
- **얻는 것.** (1) Dockerfile 규칙 10개의 설정 화면. (2) FROM 줄 이미지 이름 완성. (3) Compose 이미지 링크와 실행 코드 렌즈. Compose 검사는 지금보다 나빠진다 (위 4절 3번).

---

## Dockerfile · Compose · Bake: Docker DX (`vendor/docker-vscode-extension`)

| 항목 | 값 |
| --- | --- |
| 버전 | 0.18.0 (`vendor/docker-vscode-extension/package.json:5`) |
| 라이선스 | Apache-2.0 (`vendor/docker-vscode-extension/package.json:7`, `vendor/docker-vscode-extension/LICENSE:2`) |
| `engines.vscode` | `^1.92.0` (`vendor/docker-vscode-extension/package.json:8-10`) |
| 클라이언트 소스 | 13개 파일 1,422줄 (`src/ui-test` 제외). 언어 클라이언트는 `src/utils/lsp/lsp.ts` 318줄과 `src/utils/lsp/languageClient.ts` 113줄 |
| `extensionDependencies` / `enabledApiProposals` | 없음 |
| 기여 수 | commands 2 (`:29-40`), configuration 10 (`:145-231`), languages 1 (`dockerbake`, `:41-50`), grammars 1, debuggers 1 (`:72-144`), breakpoints 1. views, taskDefinitions 없음 |
| 언어 서버 | `docker-language-server` 0.20.1, Go 실행 파일. 빌드 때 GitHub 릴리스에서 받는다 (`vendor/docker-vscode-extension/build/downloader.mjs:80-84`). 소스는 저장소에 없다. Setdown 카탈로그는 Apache-2.0으로 적는다 (`apps/desktop/src/main/language/catalog/mason.json:2136-2146`). 보조로 `dockerfile-language-server-nodejs` 0.14.1을 묶는다 (`vendor/docker-vscode-extension/package.json:252`) |

### 1. 클라이언트가 하는 일

- **a. 도구 확보.** 실행 중에는 내려받지 않는다. 플랫폼별 실행 파일이 확장의 `bin/`에 들어 있다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:37-51`). 꾸러미는 플랫폼마다 따로 만든다 (`vendor/docker-vscode-extension/README.md:68`). x64·arm64의 Windows, Linux, macOS만 지원한다 (`lsp.ts:25-35`). 실행 권한이 없으면 `chmod 755`를 한다 (`lsp.ts:104-123`).
- **b. 런타임·환경.** `docker-language-server start`를 표준 입출력으로 띄운다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:92-100`). `docker` CLI가 PATH에 있고 Docker 엔진이 떠 있어야 한다고 적는다 (`vendor/docker-vscode-extension/README.md:15`). 활성화 때 `docker -v`와 `docker buildx version`을 돌린다 (`vendor/docker-vscode-extension/src/extension.ts:338-339`).
- **c. 프로젝트 범위.** 루트 로직이 없다. `file` 스킴의 `dockerfile`, `dockerbake`, `dockercompose`가 대상이다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:234-238`).
- **d. 표준 LSP 밖의 통신.**
  - 초기화 옵션: Compose 지원 여부, 겹치는 진단 빼기, 원격 측정 수준 (`vendor/docker-vscode-extension/src/utils/lsp/languageClient.ts:29-37`).
  - 실험 기능 선언 `dockerLanguageServerCapabilities`: 클라이언트 이름과 세션, 클라이언트가 실행할 수 있는 명령 `dockerLspClient.bake.build` (`languageClient.ts:38-46`). 그 명령은 `docker buildx bake`를 VS Code 작업으로 돌린다 (`vendor/docker-vscode-extension/src/extension.ts:38-66`).
  - 설정이 바뀌면 바뀐 설정 이름 목록을 `didChangeConfiguration`으로 보낸다 (`vendor/docker-vscode-extension/src/extension.ts:275-299`).
  - 인라인 완성 기능을 따로 등록한다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:251`). Bake 대상 제안에 쓴다 (`vendor/docker-vscode-extension/README.md:56`).
  - 진단의 출처 이름을 "Docker DX (…)"로 바꾼다 (`lsp.ts:215-219`). Scout 진단에는 설정 화면을 여는 코드 액션을 클라이언트가 붙인다 (`lsp.ts:150-204`).
- **e. 변경 감지와 재시작, 다른 확장과의 공존.**
  - 듣는 변경은 설정 6개와 VS Code의 원격 측정 설정뿐이고, 서버에 알리기만 한다 (`vendor/docker-vscode-extension/src/extension.ts:260-300`). 서버를 다시 띄우는 명령이 없다 (기여 명령은 Bake 빌드와 Scout 검사 둘: `vendor/docker-vscode-extension/package.json:29-40`).
  - Microsoft 확장이 없을 때만 rcjsuen 서버를 함께 띄운다. 그 서버의 진단은 버리고 나머지 기능만 쓴다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:270-293, 303-311`).
  - Microsoft 확장이 있으면 겹치는 진단을 빼라고 서버에 알린다 (`vendor/docker-vscode-extension/src/utils/lsp/languageClient.ts:21-25, 35`).
  - Red Hat YAML이 있고 사람이 정한 값이 없으면 자기 Compose 기능을 끄도록 사용자 설정을 쓴다 (`vendor/docker-vscode-extension/src/extension.ts:146-157`). Compose 토글은 VS Code 재시작이 필요하다 (`vendor/docker-vscode-extension/package.json:150`).
- **f. 실패 처리와 화면.**
  - 지원하지 않는 플랫폼이면 클라이언트를 만들지 않고 아무것도 표시하지 않는다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:240-243`, `vendor/docker-vscode-extension/src/extension.ts:113-114`).
  - 시작 실패는 원격 측정과 BugSnag로만 보낸다 (`extension.ts:117-141`). 사람이 보는 문장은 `vscode-languageclient` 기본값이다 (`vendor/docker-vscode-extension/src/utils/lsp/languageClient.ts:97-113`).
  - Dockerfile을 열면 `docker ps`를 돌려 엔진이 없을 때 Docker Desktop 설치·실행 알림을 띄운다 (`extension.ts:252-258`, `vendor/docker-vscode-extension/src/utils/monitor.ts:20-35`). 기본으로 켜져 있다 (`vendor/docker-vscode-extension/package.json:155-160`).
  - 출력 채널 "Docker Language Server" (`lsp.ts:209`).
- **원격 측정.** 기본값 `all` (`vendor/docker-vscode-extension/package.json:167-180`). 기기 id, 세션 id, Docker·Buildx 버전, 함께 깔린 확장 목록을 30초마다 보낸다 (`vendor/docker-vscode-extension/src/telemetry/client.ts:64-71, 81-105`, `vendor/docker-vscode-extension/src/extension.ts:327-348`). 저장소의 키는 비어 있어 직접 빌드하면 보내지 않는다 (`vendor/docker-vscode-extension/src/secrets.ts:1-6`, `client.ts:44-51`). 서버의 원격 측정은 별개다 (`vendor/docker-vscode-extension/TELEMETRY.md:35`).

### 2. VS Code에 묶인 정도

- 전부 `vscode.` 꼴이다. env 17, window 13, workspace 12 (줄이 나뉜 `vscode\n.workspace` 4회를 더하면 16), extensions 6, debug 3, tasks 2, languages 1, commands 1. 나머지 0.
- 필요한 UI: 알림, 출력 채널, 편집기 장식(빌드 단계 구분선, `vendor/docker-vscode-extension/src/utils/editor.ts:7-12`), 작업, 디버그. 상태 표시줄, 퀵 픽, 웹뷰, 트리 뷰는 쓰지 않는다.
- VS Code 없이도 뜻이 있는 것: 실행 파일 고르기, 초기화 옵션과 실험 기능 선언, 설정 변경 알림. VS Code 안에서만 뜻이 있는 것: 다른 확장 감지, Bake 작업 실행, 빌드 디버깅, 장식, Docker Desktop 알림.

### 3. VS Code 없이 쓸 수 있는 부품

- **`docker-language-server` 0.20.1.** `docker-language-server start --stdio` (`apps/desktop/src/main/language/catalog/profiles.json:2270-2276`). Dockerfile, Compose, Bake를 한 프로세스가 맡는다 (`:2227-2268`). Setdown 카탈로그가 같은 버전을 GitHub 릴리스에서 받도록 이미 적혀 있다 (`apps/desktop/src/main/language/catalog/mason.json:2146`).
- 이 서버가 내는 것: BuildKit·Buildx 빌드 검사, 이미지 취약점 표시(실험), Compose 파일 간 완성과 호버, Bake 완성과 이동 (`vendor/docker-vscode-extension/README.md:7-11`).
- 클라이언트 1,422줄은 Apache-2.0이다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **기본 도구.** 확장은 Go 서버가 주 서버다. Setdown의 기본 Dockerfile 도구는 rcjsuen 서버이고 (`apps/desktop/src/core/document/supported-languages.ts:16`), `docker-language-server`는 사람이 고르면 받는 카탈로그 도구다 (`apps/desktop/src/main/language/server-registry.ts:114-120`).
2. **한 언어에 서버 둘.** 확장은 Dockerfile에 두 서버를 함께 붙인다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:303-311`). Setdown은 언어마다 도구 하나를 답하게 한다 (`apps/desktop/src/main/language/zed-settings.ts:70-72`).
3. **초기화 옵션.** 확장은 세 옵션과 실험 기능 선언을 보낸다 (`vendor/docker-vscode-extension/src/utils/lsp/languageClient.ts:29-46`). Setdown 프로필은 설정이 비어 있고 초기화 옵션이 없다 (`apps/desktop/src/main/language/catalog/profiles.json:2222-2304`). 원격 측정 수준도 넘기지 않으므로 서버 기본값이 적용된다. 그 기본값이 무엇인지는 서버 소스가 없어 확인 못 했다.
4. **Compose.** 확장은 Go 서버로 Compose를 맡는다. Setdown의 측정에서 이 서버는 틀린 키를 표시하지 못했고 `healthcheck` 완성을 내지 못했다 (`apps/lsp-benchmark/results/compose-docker-language-server.md:7-9, 19-23`). Microsoft 쪽 코드도 "Docker DX does not provide Compose schema validation"이라고 적는다 (`vendor/vscode-containers/packages/compose-language-service/src/vscode/AlternateYamlLanguageServiceClientFeature.ts:32`).
5. **Bake.** 확장은 `docker-bake.hcl`을 `dockerbake` 언어로 등록한다 (`vendor/docker-vscode-extension/package.json:41-50`). Setdown의 지원 언어에는 Bake가 없다 (`apps/desktop/src/core/document/supported-languages.ts:5-20`).
6. **실패 표시.** 확장은 지원하지 않는 플랫폼에서 조용히 넘어간다 (`vendor/docker-vscode-extension/src/utils/lsp/lsp.ts:240-243`). Setdown은 내려받기 실패와 시작 실패를 나눠 상태로 낸다 (`apps/desktop/src/main/language/project-languages.ts:78-84`).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** VS Code 1.92 이상. `dockerfile`과 `dockercompose` 언어 id (의존 확장으로 적지 않았지만 활성화 조건이다: `vendor/docker-vscode-extension/package.json:21-26`). `vscode.env`의 기기·세션 id와 원격 측정 여부, `extensions.getExtension`, 작업 실행, 디버그 API, 인라인 완성, 편집기 장식. 그리고 `docker` CLI.
- **막는 것.** 라이선스는 없다 (Apache-2.0). 걸리는 것은 셋이다. 플랫폼별 실행 파일을 빌드 때 받아 묶어야 한다 (`vendor/docker-vscode-extension/build/downloader.mjs:69-86`). 저장소 빌드의 실행 파일은 서명되지 않는다 (`vendor/docker-vscode-extension/README.md:70`). Docker가 없는 사람에게 설치 알림이 뜬다.
- **얻는 것.** (1) Dockerfile 빌드 검사. (2) 이미지 취약점 표시. (3) Bake 파일 지원. (4) Dockerfile 빌드 디버깅. (1)~(3)은 서버가 내는 것이고, Setdown이 카탈로그의 `docker-language-server`를 Dockerfile 보조 도구로 붙이고 위 초기화 옵션을 넘기면 확장 없이 얻는다 (추정: 실험 기능 선언 없이 Bake 실행 렌즈가 오는지는 서버 소스가 없어 확인 못 했다).
