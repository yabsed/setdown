# JSON · CSS · HTML · YAML 확장 분석

소스를 읽고 쓴 것이다. 빌드하거나 실행한 것은 없다. "추정"은 읽은 코드에서 따라 나오지만 끝까지 따라가 보거나 실행해 보지 않은 것이다.

**경로 약칭** (모두 저장소 루트 기준으로 펴면 된다)

| 약칭 | 실제 경로 |
| --- | --- |
| `EXT/` | `vendor/vscode/extensions/` (VS Code 1.142.0, `vendor/vscode/package.json:3`) |
| `ZED/` | `vendor/zed/crates/` |
| `SD/` | `apps/desktop/src/main/language/` |
| `HOST/` | `tooling/language-host/src/` |
| `LSE/` | `apps/lsp-benchmark/work/profile/language-packages/servers/json-language-server/node_modules/vscode-langservers-extracted/` (4.10.0) |
| `ZLSE/` | `apps/lsp-benchmark/work/profile/language-packages/extensions/work/html/node_modules/@zed-industries/vscode-langservers-extracted/` (4.10.8) |
| `YLS/` | `apps/lsp-benchmark/work/profile/language-packages/servers/yaml-language-server/node_modules/yaml-language-server/` (2.0.0) |

`LSE/`, `ZLSE/`, `YLS/`는 이 기기에서 Zed 엔진이 내려받아 둔 설치본이고 깃이 무시하는 경로다(`apps/lsp-benchmark/.gitignore:1`). 커밋된 소스가 아니므로 "지금 이 기기에 깔린 판"의 근거로만 썼다. `yaml-language-server`와 `vscode-{json,css,html}-languageservice` 라이브러리의 소스는 `vendor/`에 없다.

**API 사용 횟수를 센 방법.** 네 확장 모두 `import { window, workspace … } from 'vscode'`처럼 이름을 가져와 쓴다. 그래서 과제에 주어진 `vscode.` 접두 정규식과, 접두 없는 `(window|workspace|commands|languages|env|extensions|l10n).이름`(바로 앞 글자가 식별자나 점이 아닌 것만) 정규식을 따로 돌려 더했다. 테스트 폴더는 뺐고, 지역 변수 때문에 잘못 잡힌 것(`languages.add` 등)은 손으로 뺐다. `WorkspaceConfiguration.update`나 `context.globalState`처럼 객체를 거치는 호출은 이 수에 들어 있지 않다.

---

## JSON: JSON Language Features (`vendor/vscode/extensions/json-language-features`)

이 블록에서 `client/…`, `server/…`, `package.json`은 `EXT/json-language-features/` 아래다.

| 항목 | 값 |
| --- | --- |
| 버전 | 10.0.0, VS Code에 내장. 따로 게시되지 않는다 (`package.json:5`) |
| 라이선스 | MIT (`package.json:7`) |
| `engines.vscode` | `^1.77.0` (`package.json:9-11`) |
| 클라이언트 소스 | 9개 파일 2,087줄 (`client/src`, `test/` 제외). 큰 것: `jsonClient.ts` 1,054, `languageStatus.ts` 364, `node/jsonClientMain.ts` 175, `node/schemaCache.ts` 147, `utils/urlMatch.ts` 130 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | `extensionsAny` (`package.json:12-14`) |
| 기여 | 명령 2 (`json.clearCache`, `json.sort`, `package.json:201-212`), 설정 9 (`:40-151`), `jsonValidation` 4 (`:172-195`), `jsonValidationRegistry` 1 (`:196-200`), 언어별 편집기 기본값 3 (`:152-171`) |
| 언어 서버 | `vscode-json-languageserver` 1.3.4. 같은 폴더의 `server/` (9개 파일 1,027줄). `vscode-json-languageservice ^6.0.0-next.4` 위에 얹은 얇은 층이다 (`server/package.json:2-18`) |

### 1. 클라이언트가 하는 일

**a. 도구 확보.** 없다. 확장 폴더 안의 `server/{out|dist}/node/jsonServerMain`을 그대로 쓴다 (`client/src/node/jsonClientMain.ts:28-29`).

**b. 런타임 선택.** 없다. `LanguageClient`에 모듈 경로와 `TransportKind.ipc`만 준다 (`client/src/node/jsonClientMain.ts:36-43`). 브라우저 판은 Web Worker다 (`client/src/browser/jsonClientMain.ts:17`).

**c. 스키마 결정.** 이 확장의 본체다.

- **파일 이름 → 스키마 주소 표를 클라이언트가 만든다.** 길이 둘이다. ① `json/schemaAssociations` 알림: 설치된 모든 확장의 `contributes.jsonValidation`과, `jsonValidationRegistry`가 가리키는 등록부 파일을 읽어 합친다 (`client/src/jsonClient.ts:568`, `:829-911`). ② `json.schemas` 설정: 사용자 · 워크스페이스 · 폴더 범위를 `inspect`로 따로 읽고, 상대 주소를 설정 파일 위치 기준으로 풀고, `${workspaceFolder}`를 펴고, 폴더 범위 항목에 `folderUri`를 붙인다 (`:915-1034`). 표준 `didChangeConfiguration`을 가로채 이 계산 결과를 대신 보낸다 (`:309`).
- **표의 대부분은 다른 확장이 낸다.** 내장 확장 10개가 `jsonValidation` 64건을 낸다. `package.json`은 `npm` 확장이(`EXT/npm/package.json:341`), `tsconfig.json`은 `typescript-language-features`가(`EXT/typescript-language-features/package.json:75`), VS Code 설정 파일들은 `configuration-editing`이(`EXT/configuration-editing/package.json:74`) 낸다. JSON 확장 자신은 4건뿐이다.
- **스키마 내용은 서버가 아니라 클라이언트가 가져온다.** 클라이언트가 `handledSchemaProtocols: ['file']`을 주므로(`client/src/jsonClient.ts:298`) 서버는 `file:` 밖의 주소를 전부 `vscode/content` 요청으로 되묻는다 (`server/src/jsonServer.ts:91-113`). 클라이언트는 주소별로 다르게 답한다 (`client/src/jsonClient.ts:408-466`). `vscode:`는 `workspace.fs`로 읽는다. 그 내용은 VS Code 본체의 가상 파일 시스템이 준다 (`vendor/vscode/src/vs/workbench/contrib/preferences/common/settingsFilesystemProvider.ts:49-66`). http(s)가 아닌 것은 `workspace.openTextDocument`로 읽는다. http(s)는 내려받기 설정 → 워크스페이스 신뢰 → 신뢰 도메인 순으로 검사한 뒤 받는다.
- **신뢰 판정.** 주소가 `json.schemaDownload.trustedDomains`(기본 8개, `package.json:130-141`) 패턴에 맞거나, localhost이거나, 위 표나 `json.schemas`에 적힌 주소와 같으면 통과한다 (`client/src/jsonClient.ts:715-745`, `client/src/utils/urlMatch.ts:36-84`). 따라서 막히는 것은 파일 안 `$schema`가 가리키는 낯선 도메인이다(추정: 판정 코드에서 따라 나온다).
- **내려받기와 캐시.** `request-light`로 받고 ETag와 본문을 `globalStorageUri/json-schema-cache`와 `globalState`에 둔다. schemastore.org 주소는 이틀 안에 받은 것이 있으면 요청 없이 캐시를 쓴다 (`client/src/node/jsonClientMain.ts:84-175`, `client/src/node/schemaCache.ts:21-147`).
- **어떤 언어에 붙는가.** `json`, `jsonc`, `snippets`에 다른 확장의 `jsonLanguageParticipants`를 더한다 (`client/src/languageParticipants.ts:40-55`).

**d. 표준 LSP 밖의 통신.**

- 클라이언트 → 서버: 알림 `json/schemaAssociations`, `json/schemaContent`. 요청 `json/validate`, `json/validateContent`, `json/languageStatus`, `json/sort` (`client/src/jsonClient.ts:28-83`).
- 서버 → 클라이언트: 요청 `vscode/content` (`:408`).
- 초기화 옵션: `handledSchemaProtocols`, `provideFormatter: false`, `customCapabilities.rangeFormatting.editLimit` (`:297-301`).
- 미들웨어: 설정 전송 교체, 스키마 오류 진단 걸러내기, 완성 항목의 범위를 삽입/교체 둘로 나누기, 호버 마크다운 다시 싸기, 문서 기호 개수 한도 감시 (`:307-397`).
- 서식은 서버 기능을 끄고 클라이언트가 `json.format.enable`에 따라 범위 서식 제공자를 직접 등록한다 (`:636-666`).
- 서버가 돌려주는 "Sort JSON" 코드 액션의 명령 `json.sort`는 서버가 아니라 클라이언트가 구현한다 (`server/src/jsonServer.ts:476-489`, `client/src/jsonClient.ts:266-283`).

**e. 변경 감지와 재시작.** 확장 목록이 바뀌면 등록부 감시자를 다시 달고 0.5초 뒤 표를 다시 보낸다 (`client/src/jsonClient.ts:570-613`). 언어 참가자가 바뀌면 2초 뒤 서버를 재시작한다 (`:190-204`). 내려받기 설정, 신뢰 도메인, 워크스페이스 신뢰가 바뀌면 `json/validate`로 다시 검증한다 (`:619-632`, `:668-676`). 편집기에 열려 있는 스키마 문서가 바뀌면 `json/schemaContent`를 보낸다 (`:472-478`, `:520-521`). `**/*.json` 감시 결과는 서버로 가고(`:305`) 서버는 그 스키마를 버리고 다시 진단한다 (`server/src/jsonServer.ts:414-425`).

**f. 실패 처리와 화면.** 서버 진단 중 코드 0x10000 이상을 "스키마를 가져오지 못함"으로 본다 (`client/src/jsonClient.ts:1046-1054`). 내려받기를 꺼 둔 경우 그 진단을 숨긴다 (`:285-291`). 언어 상태 항목이 원인마다 다른 버튼을 단다: 워크스페이스 신뢰 관리, 설정 열기, 신뢰 도메인 고르기, 다시 시도 (`client/src/languageStatus.ts:338-361`). 빠른 수정 2종(`client/src/jsonClient.ts:527-566`)과 신뢰 범위를 고르는 선택 창이 있다 (`:747-817`). 평소에는 "이 파일에 쓰인 스키마" 상태 항목과 그 목록을 보여 준다 (`client/src/languageStatus.ts:112-217`). 개요 항목이 한도를 넘으면 경고 항목이 뜬다 (`:271-279`). 상태 표시줄 항목 `status.json.resolveError`도 만들지만 이 파일에 `show()` 호출은 없다 (`client/src/jsonClient.ts:224-227`).

### 2. VS Code에 묶인 정도

- **횟수(126).** `l10n` 49, `workspace` 34, `window` 17, `commands` 13, `extensions` 6, `languages` 5, `env` 2. 많은 것: `l10n.t` 47, `workspace.getConfiguration` 16, `window.activeTextEditor` 7, `commands.executeCommand` 7, `commands.registerCommand` 6.
- **필요한 화면.** 언어 상태 항목, 선택 창 2종, 코드 액션, 정보 · 오류 알림, 출력 채널. 본체 명령도 부른다: `workbench.action.openSettings`, `workbench.trust.manage`(`client/src/jsonClient.ts:127-128`), `vscode.open`, `workbench.extensions.action.showExtensionsWithIds`, `workbench.action.openSettingsJson`(`client/src/languageStatus.ts:49`, `:103`, `:154`).
- **다른 확장에서 읽는 것.** `contributes.jsonValidation`, `jsonValidationRegistry`, `jsonLanguageParticipants`. 셋 다 제안 API `extensions.allAcrossExtensionHosts`로 읽는다 (`client/src/jsonClient.ts:840`, `:876`, `client/src/languageParticipants.ts:47`). 이 API는 `extensionsAny`가 허용되지 않은 확장이 부르면 검사에 걸린다 (`vendor/vscode/src/vs/workbench/api/common/extHost.api.impl.ts:634-635`).
- **화면 없이도 뜻이 있는 것.** 신뢰 도메인 판정 규칙, ETag 캐시, 내려받기 함수, `json.schemas` 범위 계산 규칙. 합쳐 600줄 안팎이다.
- **VS Code 안에서만 뜻이 있는 것.** 확장 기여 수집, 워크스페이스 신뢰, `vscode://schemas/…` 읽기, 설정 편집기 열기, 언어 상태 항목.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 `vscode-json-languageserver`** (MIT). `vscode` 모듈을 쓰지 않는다 (`server/src/node/jsonServerMain.ts:6-13`). `handledSchemaProtocols`를 주지 않으면 http(s)와 file을 서버가 직접 읽는다 (`server/src/jsonServer.ts:91`, `server/src/node/jsonServerMain.ts:27-56`). 설정 · 표 · 초기화 옵션의 계약이 문서로 있다 (`server/README.md:43-117`).
- **재포장 `vscode-langservers-extracted`** (MIT). 같은 서버를 npm으로 묶은 것이다. 이 기기 설치본은 4.10.0이고 `vscode-json-languageservice ^5.3.11`을 쓴다 (`LSE/package.json`). 내장 서버(6.x)보다 한 세대 앞선 판이다. `json/validateContent`는 없다 (`LSE/lib/json-language-server/jsonServer.js:81-111`).
- **라이브러리 `vscode-json-languageservice`.** Monaco의 JSON 워커도 같은 것을 쓴다 (`vendor/monaco-editor/package.json:95`). Setdown은 이 워커를 로컬 검사에 이미 쓴다 (`apps/desktop/src/renderer/language/language-runtime.ts:7`, `apps/desktop/src/renderer/language/builtin-diagnostics.ts:45-49`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **서버 확보.** 확장은 VS Code에 든 것을 쓴다. Zed는 `PATH`의 `vscode-json-language-server`를 먼저 찾고, 없으면 npm에서 `vscode-langservers-extracted` 최신판을 깔아 `--stdio`로 띄운다 (`ZED/languages/src/json.rs:40-41`, `:136-138`, `:156-239`).
2. **누가 스키마를 내려받는가.** 확장은 클라이언트가 받는다(1-c). Zed는 초기화 옵션으로 `provideFormatter: true`만 준다 (`ZED/languages/src/json.rs:261-263`). 그러면 서버 기본값에 따라 서버가 http(s)를 직접 받는다. 신뢰 도메인 검사도, 디스크 캐시도 없다. 프록시만 Zed가 넘긴다 (`:310-314`). Setdown의 "자동 설치 끔"은 호스트의 HTTP만 막으므로(`HOST/main.rs:230-233`) 서버의 스키마 내려받기는 막지 못한다(추정).
3. **어떤 파일에 어떤 스키마.** 확장은 내장 64건 + 설치한 확장 + `json.schemas`다. Zed는 고정 목록이다: Zed 자신의 설정 파일들, `tsconfig.json`, `package.json`, JSONC (`ZED/json_schema_store/src/json_schema_store.rs:429-481`). 그 위에 `lsp.json-language-server.settings`를 합친다 (`ZED/languages/src/json.rs:316-323`). Setdown은 여기에 SchemaStore 주소 6건을 얹고, Zed가 가진 두 파일 이름은 뺀다 (`SD/catalog/profiles.json:4409-4451`, `SD/zed-settings.ts:26`, `:87-92`).
4. **`package.json`과 `tsconfig.json`의 스키마.** VS Code는 schemastore.org 주소와 확장에 든 보조 스키마를 쓴다. Zed는 소스에 넣어 둔 사본을 `zed://schemas/…` 주소로 내고, 서버의 `vscode/content` 요청에 답한다 (`ZED/json_schema_store/src/json_schema_store.rs:17-18`, `:141-169`, `ZED/project/src/lsp_store/json_language_server_ext.rs:22`, `:82-105`). Setdown 호스트도 이 처리기를 켠다 (`HOST/main.rs:226-227`).
5. **변경 알림.** Zed가 보내는 비표준 알림은 `json/schemaContent` 하나이고 Zed 자신의 동적 스키마에만 쓴다 (`ZED/project/src/lsp_store/json_language_server_ext.rs:41-80`). `json/schemaAssociations`는 `ZED/` 어디에도 없다. 로컬 스키마 파일을 고쳤을 때: VS Code는 `**/*.json` 감시를 서버에 넘긴다. Zed는 서버가 등록한 감시만 넘기는데(`ZED/project/src/lsp_store.rs:14015-14018`) JSON 서버는 등록하지 않는다. 그래서 서버가 옛 스키마를 계속 쓸 수 있다(추정).
6. **서식과 정렬.** Zed와 Setdown은 서버 서식을 켠다 (`SD/catalog/profiles.json:4491-4492`). "Sort JSON" 액션은 서버가 계속 내놓지만(`LSE/lib/json-language-server/jsonServer.js:650-667`) Setdown은 그 명령을 서버로 되돌려 보낸다 (`apps/desktop/src/renderer/language/language-edit-features.ts:45-47`). 서버는 그 명령을 모르므로 동작하지 않을 것이다(추정, 실행해 보지 않음).
7. **화면.** `json/languageStatus`를 부르는 코드가 Setdown과 호스트에 없다. 어떤 스키마가 쓰였는지, 왜 못 가져왔는지 알려 주는 곳이 없다. 스키마 오류는 보통 진단으로만 보인다(추정).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** 제안 API `extensionsAny`. 모든 확장의 `package.json`을 돌려주는 확장 등록부. `vscode://schemas/…`와 등록부 파일을 내는 가상 파일 시스템. 범위별 `inspect`와 쓰기가 되는 설정 저장소. 워크스페이스 신뢰. 파일 감시. `globalState`와 `globalStorageUri`. 언어 상태 항목 · 선택 창 · 코드 액션 · 범위 서식 등록. 위 2절의 본체 명령들. `vscode-languageclient` 10.x 자체가 `vscode ^1.91.0`을 요구한다 (`vendor/vscode-languageserver-node/client/package.json`).
- **막는 것.** 따로 게시되지 않고 VS Code 빌드의 일부로만 컴파일된다 (`package.json:22`, `:32`; `vendor/`에 `client/out`이 없다). 가장 큰 이득인 "다른 확장이 낸 스키마 표"는 그 확장들(`npm`, `typescript-language-features`, `configuration-editing` 등)도 함께 깔려 있어야 생긴다.
- **얻는 것.** ① 스키마 내려받기에 신뢰 도메인과 워크스페이스 신뢰 검사. ② ETag 디스크 캐시, 곧 오프라인에서도 남는 스키마. ③ "어떤 스키마가 쓰였나"와 실패 원인별 조치 버튼. ④ 폴더 범위 `json.schemas`와 `${workspaceFolder}` 해석. ⑤ 최신 서비스 판(6.x). 다만 ⑤는 `server/`만 따로 빌드해도 얻는다.

---

## CSS · SCSS · Less: CSS Language Features (`vendor/vscode/extensions/css-language-features`)

이 블록에서 `client/…`, `server/…`, `package.json`은 `EXT/css-language-features/` 아래다.

| 항목 | 값 |
| --- | --- |
| 버전 | 10.0.0, VS Code에 내장 (`package.json:5`) |
| 라이선스 | MIT (`package.json:7`) |
| `engines.vscode` | `^1.77.0` (`package.json:9`) |
| 클라이언트 소스 | 9개 파일 777줄. 큰 것: `cssClient.ts` 193, `dropOrPaste/dropOrPasteResource.ts` 153, `requests.ts` 90, `customData.ts` 88 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | 없음 |
| 기여 | 명령 0, 설정 98 (대부분 린트 규칙 수준, `package.json:35`부터), `jsonValidation` 2 (`:984-993`), 언어별 편집기 기본값 3 |
| 언어 서버 | `vscode-css-languageserver` 10.0.0. 같은 폴더의 `server/` (13개 파일 1,047줄). `vscode-css-languageservice ^7.0.0-next.2` (`server/package.json:4`, `:15`) |

### 1. 클라이언트가 하는 일

**a. 도구 확보 · b. 런타임 선택.** 둘 다 없다. 확장 폴더의 서버 모듈을 IPC로 띄운다 (`client/src/node/cssClientMain.ts:16-19`, `:26-29`).

**c. 데이터 결정.** 스키마는 없고 "사용자 정의 데이터"가 있다. 사용자 정의 속성 · at-규칙 · 의사 클래스를 적은 JSON 파일이다. 클라이언트는 워크스페이스 폴더별 `css.customData` 설정과 다른 확장의 `contributes.css.customData`에서 파일 주소를 모은다 (`client/src/customData.ts:40-88`). 주소 목록만 `css/customDataChanged`로 보내고(`client/src/cssClient.ts:105-108`) 내용은 서버가 읽는다 (`server/src/cssServer.ts:190-196`, `server/src/customData.ts:9-20`).

**d. 표준 LSP 밖의 통신.**

- 클라이언트 → 서버: 알림 `css/customDataChanged` (`client/src/cssClient.ts:11-13`).
- 서버 → 클라이언트: 요청 `fs/content`, `fs/stat`, `fs/readDir` (`client/src/requests.ts:11-18`). 클라이언트가 `handledSchemas: ['file']`을 주므로(`client/src/cssClient.ts:56`) `file:`이 아닌 주소일 때만 온다 (`server/src/requests.ts:104-137`). 원격 · 가상 워크스페이스용이다.
- 초기화 옵션 `provideFormatter: false`. 서식은 클라이언트가 언어별 `*.format.enable`에 따라 등록하고 `css.format.*` 값을 요청 옵션에 끼워 넣는다 (`client/src/cssClient.ts:57`, `:150-190`).
- 미들웨어: 완성 항목 범위 나누기, 색 항목 라벨 꾸미기 (`:61-95`).
- 서버와 무관한 것: `#region` 접기 주석 완성(`:122-148`), 파일을 끌어다 놓거나 붙여 넣으면 `url()`을 넣는 제공자 (`client/src/dropOrPaste/dropOrPasteResource.ts:138-145`).

**e. 변경 감지와 재시작.** `css` · `scss` · `less` 설정 구획을 동기화한다 (`client/src/cssClient.ts:53`). 서버는 문서마다 `workspace/configuration`으로 범위 설정을 되묻고, 설정이 바뀌면 캐시를 비운다 (`server/src/cssServer.ts:155-180`). 확장 목록이나 `css.customData`가 바뀌면 주소 목록을 다시 보낸다 (`client/src/customData.ts:15-28`). 재시작 논리는 없다.

**f. 실패 처리와 화면.** 화면이 없다. `window.*` 호출이 0건이다. 사용자 정의 데이터를 못 읽으면 조용히 빈 데이터가 된다 (`server/src/customData.ts:14-16`, `:27-29`).

### 2. VS Code에 묶인 정도

- **횟수(28).** `workspace` 14, `l10n` 7, `languages` 4, `extensions` 3. `window`와 `commands`는 0.
- **필요한 화면.** 없다. 편집기 쪽 등록 지점만 넷이다: 범위 서식, 완성, 끌어 놓기 편집, 붙여 넣기 편집.
- **다른 확장에서 읽는 것.** `contributes.css.customData` (`client/src/customData.ts:79-83`). 정식 API `extensions.all`로 읽는다.
- **VS Code 없이도 뜻이 있는 것.** 사용자 정의 데이터 주소 목록을 서버에 알리는 것(알림 한 번), `css.format.*`를 서식 옵션에 넣는 것, `#region` 완성. **VS Code 안에서만 뜻이 있는 것.** 다른 확장의 기여 읽기, 끌어 놓기 · 붙여 넣기 제공자, 가상 파일 시스템 중계.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 `vscode-css-languageserver`** (MIT). `file:` 읽기와 디렉터리 나열을 Node로 직접 한다 (`server/src/node/cssServerMain.ts:21-33`, `server/src/node/nodeFs.ts:19-68`). `@import`나 `url()` 경로 완성이 클라이언트 도움 없이 된다.
- **재포장 `vscode-langservers-extracted` 4.10.0.** `vscode-css-languageservice ^6.2.14` (`LSE/package.json`). `css/customDataChanged`를 받는다 (`LSE/lib/css-language-server/cssServer.js:83`).
- **라이브러리 `vscode-css-languageservice`** (MIT). Monaco의 CSS 워커와 같다 (`vendor/monaco-editor/package.json:93`). Setdown이 로컬 검사에 쓴다 (`apps/desktop/src/renderer/language/builtin-diagnostics.ts:51-56`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **서버 확보.** Zed는 `PATH`의 `vscode-css-language-server`, 없으면 npm `vscode-langservers-extracted` 최신판이다 (`ZED/languages/src/css.rs:18-19`, `:39-88`). 서비스 판이 내장(7.x)보다 낮다(3절).
2. **설정.** 확장은 VS Code 설정 98개를 구획째 넘긴다. Zed는 `css` · `less` · `scss`에 빈 `lint`만 주고 `lsp.vscode-css-language-server.settings`를 합친다 (`ZED/languages/src/css.rs:156-177`). Setdown의 기본값도 `validate` · `lint` · `completion` · `hover`뿐이다 (`SD/catalog/profiles.json:1897-1916`). 린트 규칙을 바꾸려면 Zed 설정 형식으로 적어야 한다.
3. **SCSS와 Less.** 확장은 세 언어를 한 서버에 붙인다 (`client/src/cssClient.ts:43`). Zed 본체에는 SCSS와 Less 언어가 없어서, Setdown이 이름과 파일 끝만 가진 언어를 등록하고 CSS 서버를 지정한다 (`SD/zed-settings.ts:47-63`, `HOST/project_host.rs:690-710`, `HOST/main.rs:238-241`).
4. **서식.** Zed와 Setdown은 `provideFormatter: true`로 서버 서식을 켠다 (`ZED/languages/src/css.rs:144-146`, `SD/catalog/profiles.json:1928-1930`). 확장이 끼워 넣는 `css.format.*` 옵션은 전달되지 않는다(추정).
5. **사용자 정의 데이터.** `ZED/`, `SD/`, `HOST/` 어디에도 `customDataChanged`가 없다. 지금은 쓸 수 없다.
6. **`fs/*` 요청.** 로컬 파일만 여는 한 오지 않는다(1-d). Setdown에 처리기가 없어도 문제가 되지 않는다.

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** 제안 API는 없다. 확장 등록부(`extensions.all`, `extensions.getExtension`), 범위별 `inspect`가 되는 설정, `workspace.fs`, 완성 · 범위 서식 · 끌어 놓기 · 붙여 넣기 등록 지점, `vscode-languageclient`.
- **막는 것.** JSON과 같다: 따로 게시되지 않고 VS Code 빌드로만 컴파일된다. 서버 경로를 자기 확장 ID로 찾는다 (`client/src/node/cssClientMain.ts:16`).
- **얻는 것.** ① `css.customData`와 다른 확장이 낸 데이터. ② `css.format.*` 서식 옵션. ③ `url()` 붙여 넣기. ④ `#region` 완성. ⑤ 최신 서비스 판(7.x). 네 확장 중 얻는 것이 가장 적다. ①은 알림 한 번, ⑤는 서버만 새로 빌드하면 된다.

---

## HTML: HTML Language Features (`vendor/vscode/extensions/html-language-features`)

이 블록에서 `client/…`, `server/…`, `package.json`은 `EXT/html-language-features/` 아래다.

| 항목 | 값 |
| --- | --- |
| 버전 | 10.0.0, VS Code에 내장 (`package.json:5`) |
| 라이선스 | MIT (`package.json:7`) |
| `engines.vscode` | `^1.77.0` (`package.json:9-10`) |
| 클라이언트 소스 | 8개 파일 946줄. 큰 것: `htmlClient.ts` 349, `customData.ts` 143, `autoInsertion.ts` 98, `languageParticipants.ts` 86 |
| `extensionDependencies` | 없음 |
| `enabledApiProposals` | `extensionsAny` (`package.json:17-19`) |
| 기여 | 명령 0, 설정 24, `jsonValidation` 2 (`package.json:248`), 언어별 편집기 기본값 2 |
| 언어 서버 | `vscode-html-languageserver` 10.0.0. 같은 폴더의 `server/` (26개 파일 3,229줄). `vscode-html-languageservice ^6.0.0-next.2`, `vscode-css-languageservice ^7.0.0-next.2` (`server/package.json:4`, `:14-15`). 내장 JS 분석용 `typescript`는 서버 패키지가 아니라 `EXT/package.json:7`(`^6.0.3`)에서 온다 |

### 1. 클라이언트가 하는 일

**a. 도구 확보 · b. 런타임 선택.** 둘 다 없다 (`client/src/node/htmlClientMain.ts:23-24`, `:32-33`). 서버는 TypeScript 라이브러리 파일을 `extensions/node_modules/typescript/lib`라는 고정 위치에서 읽는다 (`server/src/modes/javascriptLibs.ts:14`). VS Code 폴더 구조를 전제한 것이다.

**c. 데이터와 내장 언어 결정.**

- **내장 언어.** 클라이언트가 `embeddedLanguages: { css, javascript }`를 준다 (`client/src/htmlClient.ts:151`, `:162`). `<style>`과 `<script>`를 나눠 CSS 서비스와 TypeScript 서비스에 맡기는 일은 전부 서버 안에서 한다 (`server/src/modes/languageModes.ts:116-133`). 옵션을 주지 않아도 서버 기본값이 같다 (`server/src/htmlServer.ts:160`).
- **사용자 정의 데이터.** `html.customData` 설정과 다른 확장의 `contributes.html.customData`에서 주소를 모은다 (`client/src/customData.ts:111-119`, `:128-129`). CSS와 달리 **내용도 클라이언트가 읽어 준다**: 서버가 주소마다 `html/customDataContent`로 되묻는다 (`server/src/htmlServer.ts:109-113`, `client/src/customData.ts:53-63`).
- **어떤 언어에 붙는가.** `html`에 다른 확장의 `htmlLanguageParticipants`를 더한다. Handlebars는 이 길로 붙는다 (`client/src/languageParticipants.ts:39-51`, `EXT/handlebars/package.json:45-50`).

**d. 표준 LSP 밖의 통신.**

- 클라이언트 → 서버: 알림 `html/customDataChanged`. 요청 `html/autoInsert`, `html/semanticTokens`, `html/semanticTokenLegend` (`client/src/htmlClient.ts:22-59`).
- 서버 → 클라이언트: 요청 `html/customDataContent`, `fs/stat`, `fs/readDir` (`client/src/requests.ts:11-15`). 뒤의 둘은 `file:`이 아닐 때만 온다 (`server/src/requests.ts:61-78`).
- **닫는 태그와 따옴표 자동 넣기.** 클라이언트가 문서 변경을 직접 듣는다. 마지막 글자가 `>` · `/` · `=`이면 0.1초 뒤 `html/autoInsert`를 보내고, 문서 판이 그대로면 편집기에 스니펫을 넣는다. 되돌리기 중에는 하지 않는다 (`client/src/autoInsertion.ts:46-97`).
- **의미 토큰.** 표준 기능이 아니라 위 사설 요청 둘로 받아서 클라이언트가 제공자를 등록한다 (`client/src/htmlClient.ts:234-257`). 서버 기능 선언에 의미 토큰이 없다 (`server/src/htmlServer.ts:200-225`).
- **태그 이름 함께 고치기**는 표준 `linkedEditingRange`다 (`server/src/htmlServer.ts:216`, `:546-564`). 클라이언트 코드가 없다.
- 서식은 JSON · CSS와 같은 방식이다 (`client/src/htmlClient.ts:164`, `:259-288`). `#region`과 HTML 뼈대 스니펫 완성은 클라이언트 것이다 (`:290-339`).

**e. 변경 감지와 재시작.** `html` · `css` · `javascript` · `js/ts` 네 구획을 동기화하고(`client/src/htmlClient.ts:159`) 서버는 문서별로 되묻는다 (`server/src/htmlServer.ts:122-135`). 언어 참가자가 바뀌면 2초 뒤 재시작한다 (`client/src/htmlClient.ts:120-135`). 사용자 정의 데이터 파일이 편집기에서 바뀌면 다시 알린다 (`client/src/customData.ts:39-44`).

**f. 실패 처리와 화면.** 알림 하나뿐이다. `auto-rename-tag` 확장이 깔려 있으면 내장 기능을 켜라고 한 번 권한다 (`client/src/htmlClient.ts:101-118`). 서버가 보낸 원격 측정 이벤트를 Microsoft 수집기로 넘긴다 (`:224-227`, `client/src/node/htmlClientMain.ts:21`).

### 2. VS Code에 묶인 정도

- **횟수(41).** `workspace` 16, `l10n` 8, `window` 8, `extensions` 5, `languages` 3, `commands` 1.
- **필요한 화면과 편집기 기능.** 정보 알림 1, 출력 채널 1. 편집기 쪽 요구가 더 크다: 변경 이유(되돌리기 여부)가 붙은 문서 변경 이벤트, 활성 편집기의 선택 영역, `insertSnippet` (`client/src/autoInsertion.ts:47`, `:83-88`).
- **다른 확장에서 읽는 것.** `htmlLanguageParticipants`, `contributes.html.customData`. 둘 다 제안 API `allAcrossExtensionHosts`로 읽는다.
- **VS Code 없이도 뜻이 있는 것.** 자동 넣기의 시점 규칙(약 100줄), 사용자 정의 데이터 전달, 의미 토큰 요청. **VS Code 안에서만 뜻이 있는 것.** 다른 확장 기여 읽기, `auto-rename-tag` 안내, 원격 측정.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 `vscode-html-languageserver`** (MIT). `vscode` 모듈을 쓰지 않는다. 다만 TypeScript 라이브러리 위치가 VS Code 폴더 구조에 묶여 있다(1-a).
- **재포장.** `vscode-langservers-extracted` 4.10.0과 Zed의 포크 `@zed-industries/vscode-langservers-extracted` 4.10.8. 둘 다 `vscode-html-languageservice ^5.2.0`이고 `typescript`를 자기 의존성으로 가진다(`^4.0.5`, `^5.4.5`) (`LSE/package.json`, `ZLSE/package.json`). `html/autoInsert`, `html/customDataContent`, `linkedEditingRange`가 들어 있다 (`LSE/lib/html-language-server/htmlServer.js:93-105`, `:277`).
- **라이브러리 `vscode-html-languageservice`** (MIT). Monaco의 HTML 워커와 같다 (`vendor/monaco-editor/package.json:94`, `apps/desktop/src/renderer/language/language-runtime.ts:9`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **서버 확보.** Zed 본체의 언어 크레이트에 HTML은 없다. Zed 확장 `html` 0.3.2가 맡는다 (`vendor/zed/extensions/html/extension.toml:1-15`). 그 확장은 `PATH`의 `vscode-html-language-server`를 찾고, 없으면 npm에서 Zed 포크 패키지 최신판을 깐다 (`vendor/zed/extensions/html/src/html.rs:5-8`, `:19-55`, `:65-91`). Setdown은 `html-lsp`를 이 확장에 묶어 두고 파일을 열 때 확장을 싣는다 (`SD/catalog/zed-profiles.json:60800-60810`, `SD/project-languages.ts:201-202`, `:268-277`, `HOST/main.rs:244`, `:272-276`).
2. **초기화 옵션.** Zed 확장은 `provideFormatter: true`만 준다 (`vendor/zed/extensions/html/src/html.rs:102-109`). 내장 CSS · JS 분석은 서버 기본값으로 켜진다(1-c).
3. **설정.** 확장은 네 구획을 넘긴다. Zed 확장은 `lsp.<서버>.settings`에 적힌 것만 답한다 (`vendor/zed/extensions/html/src/html.rs:93-100`). 아무것도 없으면 "null"이 가고, 그러면 `<style>` 안 CSS 검사가 죽는다. 그래서 Setdown이 자기 기본 설정을 그 자리에 넣는다 (`SD/zed-settings.ts:79-86`, `SD/catalog/profiles.json:3987-3992`).
4. **닫는 태그 자동 넣기.** `html/autoInsert`를 보내는 코드가 `ZED/`, `SD/`, `HOST/`에 없다. Setdown에서는 서버가 닫는 태그를 넣어 주지 않는다.
5. **태그 이름 함께 고치기.** 표준 요청이라 Setdown이 이미 한다 (`apps/desktop/src/renderer/language/language-navigation-features.ts:41-43`, `apps/desktop/src/renderer/adapters/monaco-editor.ts:186`).
6. **사용자 정의 데이터와 의미 토큰.** 둘 다 사설 요청이라 Setdown에 없다. HTML 안 스크립트의 의미 색칠은 오지 않는다(추정).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** 제안 API `extensionsAny`. 확장 등록부. 변경 이유가 붙은 문서 변경 이벤트와 `insertSnippet`이 되는 편집기 객체. 의미 토큰 · 완성 · 범위 서식 등록 지점. 범위 설정. `workspace.fs`. `globalState`. `@vscode/extension-telemetry`가 요구하는 것들.
- **막는 것.** 따로 게시되지 않는다. 서버가 `extensions/node_modules/typescript`를 전제한다. 원격 측정 키가 들어 있다 (`package.json:8`).
- **얻는 것.** ① 닫는 태그와 속성 따옴표 자동 넣기. ② `html.customData`(웹 컴포넌트 태그 설명 등). ③ 내장 스크립트의 의미 색칠. ④ Handlebars 같은 참가 언어. ⑤ 최신 서비스 판과 TypeScript 6. 이 중 ①은 요청 하나와 시점 규칙 100줄이다.

---

## YAML: YAML (Red Hat) (`vendor/vscode-yaml`)

이 블록에서 `src/…`, `package.json` 등은 `vendor/vscode-yaml/` 아래다.

| 항목 | 값 |
| --- | --- |
| 버전 | 2.1.0 (`package.json:18`), 커밋 `8582b6d` |
| 라이선스 | MIT (`package.json:17`) |
| `engines.vscode` | `^1.91.0` (`package.json:28`) |
| 클라이언트 소스 | 16개 파일 1,843줄 (`src/`, 테스트는 `test/`에 따로). 큰 것: `schema-status-bar-item.ts` 394, `extension.ts` 322, `schema-extension-api.ts` 168, `telemetry.ts` 159 |
| `extensionDependencies` | 빈 배열 (`package.json:318`) |
| `enabledApiProposals` | 없음 |
| 기여 | 명령 0(실행 중 `yaml.select.json.schema` 하나를 등록, `src/schema-status-bar-item.ts:57-61`), 설정 30 (`package.json:92-304`), 언어 1과 문법 1 (`:63-91`), `[yaml]` 편집기 기본값 (`:305-316`) |
| 언어 서버 | `yaml-language-server` (Red Hat, MIT). `package.json:379`는 버전을 `next`로 적고 잠금 파일은 2.0.0이다 (`package-lock.json:10325-10326`). webpack이 `dist/languageserver.js`로 묶는다 (`webpack.config.js:21`). 소스는 `vendor/`에 없다 |

### 1. 클라이언트가 하는 일

**a. 도구 확보 · b. 런타임 선택.** 없다. 묶여 있는 `dist/languageserver.js`를 IPC로 띄운다 (`src/node/yamlClientMain.ts:29`, `:38-39`).

**c. 스키마 결정.** 길이 여섯이고, 그중 클라이언트가 하는 것은 넷이다.

- **(서버) SchemaStore 목록.** 서버가 직접 `https://www.schemastore.org/api/json/catalog.json`을 받아 파일 이름 패턴으로 맞춘다. 기본으로 켜져 있다 (`YLS/out/src/yamlSettings.js:28-29`, `YLS/out/src/languageserver/handlers/settingsHandlers.js:193-253`). 클라이언트 코드는 관여하지 않는다.
- **(서버) Kubernetes.** `src/`에 "kubernetes"라는 글자가 한 번도 없다. `yaml.schemas`의 `kubernetes` 키워드를 버전 붙은 주소로 바꾸는 것도, `apiVersion`과 `kind`를 읽어 CRD 스키마를 고르는 것도 서버다 (`YLS/out/src/languageservice/utils/schemaUrls.js:5-36`, `YLS/out/src/languageservice/services/k8sSchemaUtil.js:12-102`, `YLS/out/src/languageservice/services/yamlSchemaService.js:354-358`). 확장은 설정 이름만 선언한다 (`package.json:158-172`).
- **(클라이언트) 다른 확장의 `yamlValidation`.** 설치된 확장의 `contributes.yamlValidation`을 모아 `json/schemaAssociations`로 보낸다 (`src/extension.ts:224`, `:270-305`).
- **(클라이언트) 다른 확장이 API로 등록한 제공자.** `activate`가 돌려주는 객체로 다른 확장이 `registerContributor`를 부른다. 서버는 문서마다 `custom/schema/request`로 "이 파일의 스키마가 있나"를 묻고, 클라이언트는 등록된 제공자를 차례로 부른다. 라벨(예: `apiVersion: x/v1`)이 있으면 열린 문서 본문에 정규식을 대 본다 (`src/schema-extension-api.ts:66-133`, `src/extension.ts:165-170`).
- **(클라이언트) 스키마 내용 내려받기.** 클라이언트가 `yaml/registerContentRequest`를 보내면(`src/extension.ts:237`) 서버는 http(s) 스키마를 직접 받지 않고 `vscode/content`로 되묻는다 (`YLS/out/src/languageservice/services/schemaRequestHandler.js:152-162`). 클라이언트는 `http.proxy` 설정을 적용하고, ETag를 `globalStorage/schemas_cache`에 두고, 일시 오류(429 · 502 · 503 · 504)는 두 번 더 시도하고, 그래도 안 되면 캐시된 사본을 돌려준다 (`src/json-schema-content-provider.ts:53-108`, `src/json-schema-cache.ts:13-99`, `src/schema-request-retry.ts:7-22`). JSON 확장과 달리 신뢰 도메인 검사는 없다.
- **(클라이언트) 사람이 고른 스키마.** 상태 표시줄에서 고르면 `yaml.schemas`와 `yaml.disableSchemaDetection` 설정을 범위별로 고쳐 쓴다 (`src/schema-status-bar-item.ts:254-353`).

**d. 표준 LSP 밖의 통신.**

- 클라이언트 → 서버 알림: `json/schemaAssociations`, `yaml/registerCustomSchemaRequest`, `yaml/registerContentRequest`, `yaml/supportSchemaSelection` (`src/extension.ts:43-83`, `:224-239`). 뒤의 셋은 "나는 이것을 할 수 있다"는 신고다. 보내지 않으면 서버가 혼자 한다.
- 클라이언트 → 서버 요청: `yaml/get/jsonSchema`, `yaml/get/all/jsonSchemas`(`src/schema-status-bar-item.ts:35-38`), `json/schema/modify`(`src/schema-extension-api.ts:36`, `:155-157`).
- 서버 → 클라이언트 요청: `custom/schema/request`, `custom/schema/content`, `vscode/content`, `fs/readFile`, `fs/readUri` (`src/extension.ts:165-192`). 뒤의 둘은 웹 판 서버만 쓴다 (`YLS/out/src/webworker/yamlServerMain.js:14-25`).
- 서버 → 클라이언트 알림: `yaml/resultLimitReached`, `yaml/schema/store/initialized` (`src/extension.ts:196-218`).
- 미들웨어: 서버가 `workspace/configuration`으로 설정을 가져갈 때 답을 고친다. Docker, GitHub Actions, dbt, Azure Pipelines 확장이 깔려 있으면 그 확장이 맡는 파일 패턴을 `disableSchemaDetection`에 더한다 (`src/autoDisableSchemaDetection.ts:14-88`, `src/extension.ts:138-142`).

**e. 변경 감지와 재시작.** `.json` · `.yaml` · `.eyaml` · `.yml` 감시를 서버에 넘긴다 (`src/extension.ts:130`). 확장 목록이 바뀌면 설정을 다시 가져가게 하고 연결표를 다시 보낸다 (`:227-233`). 서버 오류는 3번까지 넘기고 그 뒤 끈다. 서버가 죽으면 4번까지 재시작하고, 3분 안에 5번 죽으면 오류 알림을 띄우고 멈춘다 (`src/telemetry.ts:19-44`, `src/extension.ts:110`).

**f. 실패 처리와 화면.** 상태 표시줄에 쓰인 스키마 이름, 없으면 "No JSON Schema", 여럿이면 "Multiple JSON Schemas"를 보여 준다. 언어 ID가 `yaml`일 때만이다 (`src/schema-status-bar-item.ts:89-122`). 누르면 여러 개를 고를 수 있는 선택 창과 스키마 버전 선택 창이 뜬다 (`:124-205`, `:355-384`). 그 밖의 알림: 개요 한도 초과(`src/extension.ts:196-214`), 충돌하는 확장 4종을 지우라는 권유(`src/extensionConflicts.ts:10`, `:56-66`), `devfile.yaml`이 있으면 OpenShift Toolkit 설치 권유(`src/recommendation/openShiftToolkit.ts:15-46`). 출력 채널은 스스로 열리지 않는다 (`src/extension.ts:132`). 시작 성공 여부와 서버 오류 문장을 Red Hat 원격 측정으로 보낸다 (`:241-246`, `src/telemetry.ts:20`, `:108`).

### 2. VS Code에 묶인 정도

- **횟수(47).** `workspace` 18, `window` 18, `commands` 5, `extensions` 5, `l10n` 1, `languages` 0. 정규식이 놓친 줄바꿈 호출 `vscode.window.withProgress` 1건을 더했다 (`src/recommendation/handlerImpl.ts:14-15`). 설정 쓰기 5건(`src/schema-status-bar-item.ts:262-351`)은 객체 호출이라 이 수에 없다.
- **필요한 화면.** 상태 표시줄 항목, 항목 버튼이 달린 다중 선택 창, 정보 · 오류 알림, 진행 알림, 출력 채널, `json-schema:` 주소로 스키마를 읽기 전용 문서로 여는 내용 제공자 (`src/extension.ts:150-155`).
- **다른 확장과의 관계.** `contributes.yamlValidation`을 읽는다. 다른 확장에 API 객체를 내준다. 설치 여부를 보는 확장 ID가 9개다(충돌 4, 자동 비활성 4, 권유 1). 본체 명령으로 확장을 지우고 깔고 창을 다시 연다 (`src/extensionConflicts.ts:59-66`, `src/recommendation/handlerImpl.ts:18`). 반대쪽도 있다: Docker 확장은 이 확장이 깔려 있으면 자기 Compose 서버를 끈다 (`vendor/docker-vscode-extension/src/extension.ts:146-155`).
- **VS Code 없이도 뜻이 있는 것.** ETag 캐시와 재시도(약 320줄), 재시작 정책, 세 가지 신고 알림. **VS Code 안에서만 뜻이 있는 것.** 다른 확장의 기여와 API 제공자, 충돌 · 권유 · 자동 비활성, 설정 파일 고쳐 쓰기, 원격 측정. 줄 수로는 이쪽이 절반을 넘는다.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 `yaml-language-server`** (MIT, npm, 실행 파일 `bin/yaml-language-server`). 1-c의 서버 몫 둘(SchemaStore, Kubernetes)과 `yaml.schemas`, 파일 첫머리 `# yaml-language-server: $schema=…` 주석 해석이 모두 서버 안에 있다 (`YLS/out/src/languageservice/services/yamlSchemaService.js:370-375`). 클라이언트의 신고가 없으면 http(s) 스키마도 서버가 직접 받고 같은 재시도 규칙을 쓴다 (`YLS/out/src/languageservice/services/schemaRequestHandler.js:85-100`, `:163-176`). 디스크 캐시는 없다.
- **`request-light`** (MIT). 확장과 서버가 같이 쓰는 HTTP 라이브러리다 (`package.json:375`).
- 이 확장의 클라이언트 코드 중 npm으로 따로 나온 것은 없다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

1. **서버 확보.** 확장은 빌드 때 잠근 판(2.0.0)을 묶는다. Zed는 `PATH`의 `yaml-language-server`, 없으면 npm 최신판을 깐다 (`ZED/languages/src/yaml.rs:21`, `:42-89`). 이 기기 설치본도 2.0.0이다 (`YLS/package.json`).
2. **신고 알림.** Zed는 셋 다 보내지 않는다(`ZED/`에 `yaml/`로 시작하는 요청 이름이 없다). 그래서 서버가 스키마를 직접 받고, 다른 프로그램이 스키마를 끼워 넣을 길이 없고, 스키마 선택 요청도 꺼져 있다 (`YLS/out/src/yamlSettings.js:55-57`).
3. **SchemaStore와 Kubernetes.** 서버 몫이라 Setdown에서도 같다. `docker-compose.yml`이나 `.github/workflows/*.yml`이 설정 없이 스키마를 받는 것은 이 때문이다(추정: 목록 내용은 받아 보지 않았다). Setdown의 YAML 기본 설정은 비어 있다 (`SD/catalog/profiles.json:9325`).
4. **설정.** Zed는 `[yaml].editor.tabSize`와 `yaml.format.enable`을 주고 `lsp.yaml-language-server.settings`를 합친다. `yaml.schemas`의 상대 경로는 프로젝트 기준으로 푼다 (`ZED/languages/src/yaml.rs:158-170`, `:174-204`). 확장은 VS Code 설정 30개와 상태 표시줄 선택 결과를 쓴다.
5. **Compose 파일.** 확장은 Docker 확장이 있으면 Compose 파일에서 스키마 감지를 끈다 (`src/autoDisableSchemaDetection.ts:20-32`). Setdown은 반대로 Docker Compose를 YAML 서버에 맡긴다 (`SD/zed-settings.ts:48-51`).
6. **화면.** 어떤 스키마가 쓰였는지 보여 주거나 고르게 하는 곳이 Setdown에 없다(`yaml/get/…` 요청을 보내는 코드가 없다).

### 5. 이 확장을 그대로 돌린다면

- **호스트가 줘야 하는 것.** 제안 API는 없고 최소 `vscode ^1.91.0`. 시작할 때 `@redhat-developer/vscode-redhat-telemetry` 서비스를 기다리므로(`src/node/yamlClientMain.ts:22`) 그 라이브러리가 쓰는 API가 있어야 한다. 상태 표시줄, 항목 버튼이 달린 다중 선택 창, 내용 제공자, 세 범위에 쓰는 설정 저장소, 확장 등록부와 확장 설치 · 삭제 명령, `globalState`, 다른 확장에 `activate` 반환값을 내주는 구조.
- **막는 것.** `vendor/`에는 소스만 있고 `dist/`가 없다. webpack 빌드가 필요하다. 서버 버전이 `next`로 떠 있어 빌드 시점에 따라 달라진다. 원격 측정 라이브러리가 필수 의존이다.
- **얻는 것.** ① 쓰인 스키마 이름 표시와 스키마 · 버전 고르기. ② ETag 디스크 캐시와 오프라인 대체, 프록시 설정. ③ 서버가 연달아 죽을 때의 재시작 정책과 알림. ④ 다른 확장이 주는 스키마. 그 확장들도 함께 돌 때만 생긴다. ⑤ 전용 확장이 있는 파일에서 스키마 감지를 끄는 조정. 이것도 그 확장들이 있을 때만 뜻이 있다.
- **얻지 않아도 이미 있는 것.** SchemaStore 맞추기, Kubernetes 키워드와 CRD 감지, 주석으로 스키마 지정, `yaml.schemas`. 사람들이 이 확장의 기능이라고 여기는 것의 대부분은 서버에 있고 Setdown이 이미 쓰고 있다.
