# VS Code 확장 분석: Kotlin, Java

경로 줄임. 모두 저장소 루트 기준이다.

- `K/` = `vendor/kotlin-lsp/` (커밋 `a417592`, 2026-11-18)
- `KC/` = `vendor/kotlin-lsp/vscode-extension-core/src/`
- `J/` = `vendor/vscode-java/` (커밋 `d25cdc3`, 2026-11-18)
- `S/` = `apps/desktop/src/main/language/`
- `보고서` = `reports/2026_11_19_05_19_zed_project_engine_adoption_plan.md`
- "Zed Java 확장", "Zed Kotlin 확장"은 스크래치패드의 읽기 전용 사본(`src-zed-java`, `src-zed-kotlin`)이다.

"추정"이라고 적은 문장만 읽은 코드에서 직접 확인하지 못한 것이다.

## Kotlin: Kotlin by JetBrains (`vendor/kotlin-lsp`)

| 항목 | 값 |
|---|---|
| 버전 | `package.json`은 자리표시자 `0.0.1`이다(`K/kotlin-vscode/package.json:4`). 릴리스 표기는 서버 v271.2085.0, 확장 v0.0.86이다(`K/RELEASES.md:6-7`). |
| 라이선스 | 저장소 소스는 Apache 2.0이다(`K/LICENSE.txt`). 배포되는 VSIX는 "JETBRAINS FREE PLUGIN LICENSE AGREEMENT"를 따른다(`K/kotlin-vscode/LICENSE.txt:1-3`, `K/kotlin-vscode/package.json:21`). |
| `engines.vscode` | `^1.105.1`, Node `>=22.20.0` (`K/kotlin-vscode/package.json:1348-1351`) |
| 클라이언트 소스 크기 | 81개 파일 13,398줄. `kotlin-vscode/src` 1/56, `vscode-extension-core/src` 53/8,823, `vscode-language-kotlin/src` 2/1,706, `vscode-jvm-testing/src` 5/569, `vscode-testing/src` 20/2,244. `*.test.ts`, `*TestUtils.ts`, `*Fixture.ts`, `testing/` 42개는 뺐다. |
| `extensionDependencies` | 없다. |
| `enabledApiProposals` | 없다. |
| 기여 수 | commands 7, configuration 속성 33, debuggers 3, taskDefinitions 1, languages 1(`.kt`), grammars 1, breakpoints 1, views 0 (`K/kotlin-vscode/package.json:77-116, 119, 345, 545, 683, 1265-1297`) |
| 언어 서버 | IntelliJ IDEA와 Kotlin 플러그인 위에 만든 서버다(`K/README.md:11-15`). 알파이고 일부가 비공개다(`K/README.md:73-76`). 플랫폼별 VSIX에 들어 있다(`K/RELEASES.md:9, 12-17`). |

저장소는 읽기 전용 미러다(`K/README.md:92-93`). 런처, `lsp-router`, Gradle·Maven 가져오기 구현, 초기화 옵션 해석 코드는 저장소에 없다.

### 1. 클라이언트가 하는 일

**a. 도구 확보**

- VSIX는 두 종류로 만든다. 풀 번들은 서버를 `server/`에 풀어 넣고(`K/kotlin-vscode/build.sh:265-271`), 얇은 번들은 `{url, version, archiveName, sha256}`만 든 `server-bundle.json`을 넣는다(`K/kotlin-vscode/build.sh:170-210, 253-264`).
- 클라이언트는 내장 `server/`를 먼저 쓰고, 없으면 `~/.local/share/JetBrains/IntelliJServer/servers/<패키지>`에 내려받는다. 설치 잠금을 잡는다(`KC/serverBundleDownload.ts:55-77, 98-102, 114-142`).
- 내려받기는 `Range` 헤더로 이어받고(`KC/serverBundleDownload.ts:294-323, 396`), sha256을 검사하고(`:332-341`), `tar`로 푼다(`:720-753`).
- 진행 알림과 취소를 붙인다(`KC/lspClient.ts:769-774, 810-828`). 체크섬이 다르면 따로 알린다(`:829-836`). 실행 권한을 준다(`:839-841`).
- `intellij.serverPath`로 외부 서버를 지정할 수 있다(`KC/lspClient.ts:108-126, 860-862`).
- 활성화 첫 단계는 지역 검사다. `https://download.jetbrains.com/check-location`을 부르고 HTTP 451이면 활성화를 멈춘다(`KC/geoRestriction.ts:4, 13-31`, `K/kotlin-vscode/src/extension.ts:24-25`).
- 그 다음은 동의 절차다. `runPolicyGatedActivation`이 맡는데 이 함수는 `@jetbrains/intellij-vscode-extension-policy` 패키지에 있고 그 패키지는 저장소에 없다(`K/kotlin-vscode/src/extension.ts:17-21, 32-53`, `K/kotlin-vscode/package.json:49`). 릴리스 노트는 지역과 데이터 공유를 고르기 전에는 서버가 시작하지 않는다고 적는다(`K/RELEASES.md:215-217`).

**b. 런타임·JDK·환경 선택**

- 클라이언트는 서버를 돌릴 JVM을 고르지 않는다. 런처 `bin/intellij-server`를 실행할 뿐이다(`KC/serverBundleDownload.ts:150-153`). 런처 소스는 저장소에 없다.
- 실행 환경은 확장 호스트의 `process.env`에 `IJ_JAVA_OPTIONS`, `INTELLIJ_DATA_SHARING`, `INTELLIJ_REGION`을 더한 것이다(`KC/lspClient.ts:971-977, 1409-1437`). `JAVA_HOME`은 손대지 않고 그대로 넘어간다.
- 프록시 설정과 WSL 여부를 JVM 옵션으로 바꿔 넣는다(`KC/proxySettings.ts:5-31`, `KC/wslJvmOptions.ts:8-16`, `KC/lspClient.ts:962-966`).
- 프로젝트 JDK는 설정으로만 받는다. `intellij.jdkForSymbolResolution`이 초기화 옵션 `defaultSdk`가 된다(`K/kotlin-vscode/package.json:887-891`, `KC/lspClient.ts:115, 1274-1277, 1298`). 프로젝트별 `java-home`은 `intellij.projects`에 적는다(`K/kotlin-vscode/package.json:755-886`).
- 빌드 JDK는 서버가 고른다. 후보 출처 목록이 서버 API에 있다(`K/buildtool.api/src/com/jetbrains/ls/buildtool/api/BuildJdk.kt:10-37`). Gradle·Maven 가져오기는 `JAVA_HOME`을 따르고, 없으면 서버 JRE를 쓴다(`K/RELEASES.md:47, 249-251`).

**c. 프로젝트 범위와 가져오기**

- `.kt` 파일을 열거나 작업 폴더에 `build.gradle(.kts)`, `settings.gradle(.kts)`, `pom.xml`이 있으면 활성화한다(`K/kotlin-vscode/package.json:1333-1343`).
- 초기화 옵션으로 `defaultSdk`, 폴더 URI별 `buildTools`, `projects`를 보낸다(`KC/lspClient.ts:1269-1309, 1332-1336`, `KC/initializationSettings.ts:13-55`). 값 하나의 형식이 틀리면 서버가 전체를 버리므로 보내기 전에 걸러낸다(`KC/initializationSettings.ts:3-7, 212-268`).
- `intellij.buildTool`은 `null`이면 자동 감지, 빈 문자열이면 가져오기를 끈다(`K/kotlin-vscode/package.json:708-712`).
- 빌드 도구가 겹쳐 가져오기가 막히면 서버가 `intellij/workspaceImportStatus`로 알리고, 클라이언트는 막힌 폴더를 상태 모델에 담는다(`KC/lspClient.ts:709-737`, `KC/statusBarModel.ts:29-55`). 사용자가 선택을 닫아 버리면 "Choose a build tool to start project import." 경고를 띄우고, 누르면 다시 가져온다(`KC/lspClient.ts:720-726`). 선택 창 자체는 서버가 `intellij/chooseAction`으로 띄운다(추정).
- 가져오기 자체는 서버가 한다. Gradle, Maven, 실험적 AGP를 지원한다(`K/README.md:61-62`).
- 문서 선택자에 `java`도 넣고 `file`, `jar`, `jrt`, `untitled` 스킴을 받는다(`KC/lspClient.ts:1045-1073`).
- 서버에 직접 붙지 않고 `lsp-router`를 거친다. 라우터가 `initialize`를 읽어 작업 폴더별 서버를 찾거나 띄우고, 여러 편집기가 서버 하나를 같이 쓴다(`KC/lspRouter.ts:3-12, 60-68`, `KC/lspClient.ts:905-907`). 라우터를 쓰지 않을 때만 `--stdio`로 띄운다(`KC/lspClient.ts:998-1004`).

**d. 표준 LSP 밖의 통신**

- `intellij/*` 메서드가 13개다. 가져오기 관련은 `intellij/reloadWorkspace`(`KC/extension.ts:163-165`), `intellij/importLog`(`KC/lspClient.ts:157`), `intellij/workspaceImportStatus`(`:159-166`), `intellij/workspaceImportState`(`KC/workspaceImport.ts:13-28`), `intellij/stopServer`(`KC/lspClient.ts:586`)다.
- 나머지는 `buildOutput`, `processInput`, `relatedTests`, `editOptions`, `copyToClipboard`, `runEditorCommand`, `chooseAction`, `showConflicts`다(`KC/buildTaskModel.ts:34`, `KC/externalTerminal.ts:23`, `KC/relatedTests.ts:27`, `KC/editOptions.ts:19-20`, `KC/intellijExtensions.ts:17-57`).
- 실험 기능 다섯 개(`conflictView`, `actionChooser`, `copyToClipboard`, `runEditorCommand`, `editOptions`)와 `indexDir`를 `capabilities.experimental`로 알린다(`KC/intellijExtensionsClientFeature.ts:7-14`, `KC/lspClient.ts:264-269`).
- `workspace/executeCommand`로 서버 명령을 부른다. `decompile`(`KC/decompiler.ts:74`), `interpolateFileTemplate`(`KC/fileTemplates.ts:51-52`), 작업 공간 내보내기(`KC/extension.ts:137-157`)다.
- 미들웨어는 셋이다. 문서 열기 실패 시 클립보드 대체, 인레이 힌트의 `jar`/`jrt` 위치 이동, 호버 안의 명령 링크 허용이다(`KC/middleware.ts:12-78`).

**e. 변경 감지와 재시작**

- 빌드 파일은 서버가 직접 감시하고 다시 가져온다. 클라이언트는 일부러 감시하지 않는다(`KC/autoReloadWorkspace.ts:85-93`, `K/buildtool.api/src/com/jetbrains/ls/buildtool/api/BuildTool.kt:38-43`).
- 클라이언트가 보는 파일은 `.vscode/settings.json` 하나다. 저장하면 `intellij.workspace.reloadOnBuildFileSave` 값(always/prompt/never)에 따라 다시 가져오거나 묻는다(`KC/autoReloadWorkspace.ts:31-37, 111-125`, `KC/autoReloadWorkspaceModel.ts:1`).
- 설정이 바뀌면 종류를 나눈다. 초기화 옵션에 속하면 `intellij/reloadWorkspace`로 옵션을 다시 보내고, 실행 옵션에 속하면 재시작을 묻는다(`KC/lspClient.ts:1082-1101, 1123-1205`, `KC/extension.ts:167-204`).
- 명령은 재시작, 캐시 삭제 후 재시작, 작업 공간 다시 가져오기다(`KC/lspClient.ts:239, 243`, `KC/extension.ts:221`).
- 라우터가 띄운 서버는 편집기를 닫아도 남는다. 완전히 끄려면 `intellij/stopServer`를 보낸다(`KC/lspClient.ts:601-621, 666-675`).

**f. 실패 처리와 화면**

- 서버 시작을 60초 기다린다(`KC/lspClient.ts:108, 1041`). 넘으면 프로세스를 죽이고 이유를 적은 오류를 띄운다(`KC/launchedServerStartup.ts:103-133, 150-166`).
- 종료 코드 7은 라이선스 문제로 보고 재시작하지 않는다(`KC/launchedServerStartup.ts:4-7, 33-41`, `KC/lspClient.ts:566-572`).
- 초기화가 실패하면 다시 시도하지 않는다(`KC/lspClient.ts:1378-1385`). 잘못된 설정 값은 경고로 알린다(`:1214-1243`).
- 상태 표시줄 항목 두 개와 빌드 오류 항목을 둔다(`KC/statusBar.ts:111, 116, 130-136`). 가져오기 로그는 출력 채널로 간다(`KC/lspClient.ts:681-695`, `KC/extension.ts:339-353`).
- 다른 Kotlin 확장이 깔려 있으면 제거를 권한다(`KC/extensionConflict.ts:151-170`).

### 2. VS Code에 묶인 정도

세는 법. 테스트를 뺀 81개 파일에서 `import * as X from 'vscode'`의 별칭과 `{ window, workspace, … } from 'vscode'` 이름 import를 읽고, `별칭.네임스페이스.멤버`와 앞에 `.`이나 글자가 없는 `네임스페이스.멤버`를 셌다. 주석과 문자열을 걸러내지 않아서 `workspace.json` 2건과 `tasks.json` 2건은 손으로 뺐다.

| 네임스페이스 | 사용 수 | 주로 쓰는 멤버 |
|---|---|---|
| `window` | 70 | `showErrorMessage` 17, `showInformationMessage` 11, `showWarningMessage` 9, `activeTextEditor` 9, `showTextDocument` 7, `showQuickPick` 5 |
| `workspace` | 44 | `getConfiguration` 8 |
| `commands` | 30 | `executeCommand` 17, `registerCommand` 13 |
| `debug` | 12 | 디버그 어댑터 등록 (`KC/dap.ts:189-191`) |
| `extensions` 8, `env` 6, `languages` 4, `tasks` 1, `tests` 1 | | |
| `notebooks`, `lm`, `chat`, `authentication`, `l10n` | 0 | |

- 81개 중 43개 파일이 `vscode`를 import한다.
- 필요한 화면 요소는 상태 표시줄 항목, 출력 채널 2개, 버튼 달린 알림, 진행 알림, 빠른 선택 목록, 웹뷰 패널 1개(`KC/editOptions.ts:49`), 진단 모음(`KC/autoReloadWorkspace.ts:98`), `jar`/`jrt` 문서 제공자(`KC/decompiler.ts:89-91, 124`), 테스트 탐색기(`K/vscode-testing/src/testController.ts:33`), 작업 제공자(`KC/buildTask.ts:99`)다.
- VS Code 화면 없이도 뜻이 있는 로직은 따로 분리되어 있다. `vscode-extension-core/src`에서 `vscode`를 import하지 않는 파일이 28개 4,254줄이다. 내려받기(`serverBundleDownload.ts` 826줄), 초기화 옵션 검사(`initializationSettings.ts` 268줄), 시작 감시(`launchedServerStartup.ts` 167줄), 라우터 인자(`lspRouter.ts` 68줄), 상태 모델(`statusBarModel.ts` 208줄)이 여기에 든다.
- VS Code 안에서만 뜻이 있는 것은 동의 절차, 설정 화면과 `.vscode/settings.json` 연동, 디버그·테스트·작업 연동, 다른 확장 충돌 검사다.

### 3. VS Code 없이 쓸 수 있는 부품

- **서버 단독 배포본.** 플랫폼별 압축 파일이 따로 나온다(`K/RELEASES.md:20-29`). `bin/intellij-server --stdio`로 띄우고, LSP를 쓰는 어느 편집기에서나 쓰도록 만들었다고 적혀 있다(`K/README.md:46-54, 83-86`). 일부 비공개다(`K/README.md:73-76`). 단독 배포본의 이용 조건 문서는 저장소에서 찾지 못했다.
- **`lsp-router`.** 런처 옆에 실행 파일로 들어 있다(`KC/lspRouter.ts:17-27`). 소스는 저장소에 없다.
- **클라이언트 로직 파일.** 위 28개 파일은 Apache 2.0 소스이고 `vscode` 없이 읽고 옮길 수 있다. npm 패키지로 나와 있지는 않다(추정: 의존성이 `workspace:*`이고 `K/kotlin-vscode/package.json:41-47`, 저장소에 작업 공간 정의와 잠금 파일이 없다).
- **서버 API 소스.** `api.features` 90개 파일 4,083줄, `buildtool.api` 9개 834줄, `features-impl` 137개 13,479줄이 있다. 프로토콜 동작을 확인하는 근거로 쓸 수 있다.
- **확장 자체(VSIX).** JetBrains 약관 3.4는 역공학(b), 수정(c), 제3자 제공·재배포(d), 경쟁 제품 개발(f)을 금한다(`K/kotlin-vscode/LICENSE.txt:82-101`).

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown은 Kotlin 도구로 `kotlin-lsp`를 쓰고 Zed Kotlin 확장으로 준비한다(`apps/desktop/src/core/document/supported-languages.ts:13`, `S/catalog/zed-profiles.json:61156-61164`).

| 차이 | VS Code 확장 | Zed 확장과 Setdown |
|---|---|---|
| 내려받기 검증 | sha256 검사, 이어받기, 설치 잠금, 취소 (`KC/serverBundleDownload.ts:114-142, 294-341`) | Zed 확장은 GitHub의 `RELEASES.md`를 읽어 주소를 얻고 체크섬 없이 받는다(Zed Kotlin 확장 `src/language_servers/kotlin_lsp.rs:101-115, 169`). 상태는 "확인 중"과 "내려받는 중" 둘이다(`:29-38`). Setdown은 30분을 기다린다(`S/zed-language-host.ts:82-84`). 보고서는 370 MB 내려받기가 이 제한에 걸렸고 설치 표시가 없었다고 적는다. 둘 다 고쳤고 진행률은 여전히 없다(`보고서:313-314, 329-330`). |
| 실행 방식 | 라우터를 거쳐 서버를 공유한다. `--eula`, 지역, 데이터 공유 값을 넘긴다(`KC/lspClient.ts:957-960, 1004, 1427-1435`). | `bin/intellij-server --stdio`를 환경 변수 없이 실행한다(Zed Kotlin 확장 `src/kotlin.rs:41-49`). Setdown은 로그인 셸 환경을 더한다(`S/server-environment.ts:67-97`, `S/language-manager.ts:574-575`). |
| 초기화 옵션 | `defaultSdk`, `buildTools`, `projects`를 검사해 보낸다(`KC/lspClient.ts:1269-1309`). | Zed 확장에는 초기화 옵션 함수가 없고 설정을 `kotlin` 아래에 감싸 넘길 뿐이다(Zed Kotlin 확장 `src/kotlin.rs:56-70`). Setdown은 사용자가 적은 값만 그대로 전달한다(`S/language-provisioner.ts:171-172`). |
| JDK 선택 | 클라이언트는 고르지 않는다. 환경을 그대로 넘기고 설정 두 개를 받는다(`KC/lspClient.ts:971-977, 1274-1277`). | 같다. Setdown이 넘긴 `JAVA_HOME`의 JDK 17이 분석에 쓰여 거짓 오류가 났고, 빌드 파일이 요구하는 JDK를 넘기는 수정은 미적용이다(`보고서:315, 331`). |
| 가져오기 상태 | `intellij/workspaceImportStatus`, `intellij/importLog`를 받아 상태 표시줄과 로그에 보인다(`KC/lspClient.ts:157-166, 681-703`). 빌드 도구 충돌을 물어본다(`:709-737`). | Setdown의 세션에는 표준 메서드 처리기만 있다(`S/server-session.ts:94-135`). `apps/desktop/src`와 `tooling/language-host/src`에서 `intellij/`를 grep으로 찾지 못했다. |
| 다시 가져오기 | 설정 변경 시 재시작 없이 `intellij/reloadWorkspace`를 보낸다(`KC/extension.ts:167-204`). | Setdown은 계획 입력 파일이 바뀌면 세션을 다시 연결한다(`S/language-manager.ts:697-701, 734-738`). 빌드 파일 감시는 양쪽 다 서버가 한다(`KC/autoReloadWorkspace.ts:85-93`). |
| 실패 처리 | 60초 제한, 종료 코드 7은 재시작 안 함(`KC/launchedServerStartup.ts:4-7, 103-133`). | Setdown은 실패를 분류하고 세 번까지 다시 연결한다(`S/language-manager.ts:684-692`). |

### 5. 이 확장을 그대로 돌린다면

**호스트가 제공해야 하는 것**

- VS Code API 1.105.1 수준의 확장 호스트와 Node 22.20 이상(`K/kotlin-vscode/package.json:1348-1351`).
- 2절의 화면 요소 전부. 동의 절차는 비공개 패키지가 그리므로 어떤 API를 쓰는지 소스로 확인할 수 없다.
- 언어 기능 제공자 등록 API 전체. 확장은 `vscode-languageclient`로 서버와 말하므로 Setdown의 자체 세션(`S/server-session.ts`)을 쓰지 않는다(추정: `vscode-languageclient`의 일반 동작이며 저장소에 그 소스는 없다).
- 디버그, 작업, 테스트 API. 디버거 3종, 작업 정의 1종, 테스트 컨트롤러를 등록한다(`KC/dap.ts:36-38, 189-191`, `KC/buildTask.ts:99`, `K/vscode-testing/src/testController.ts:33`).

**막는 것**

- 약관. VSIX를 Setdown에 넣어 배포하면 3.4(d)에, 확장 동작을 고쳐 쓰면 3.4(c)에 걸린다(`K/kotlin-vscode/LICENSE.txt:82-101`). 법적 판단은 추정이다.
- 비공개 부분. 정책 패키지가 없고 작업 공간 정의와 잠금 파일이 없어서 이 저장소로는 VSIX를 만들 수 없다(추정). 쓰려면 Marketplace나 Open VSX의 배포본을 받아야 한다(`K/RELEASES.md:11, 205-206`).
- 활성화 때 JetBrains 서버로 지역 검사를 보낸다(`KC/geoRestriction.ts:13-19`). 지역과 데이터 공유를 고르기 전에는 서버가 뜨지 않는다(`K/RELEASES.md:215-217`).
- 서버가 편집기와 따로 살아남는 공유 데몬 구조다(`KC/lspClient.ts:666-675`).

**지금의 Setdown보다 얻는 것**

1. 검증되는 내려받기와 진행·취소 화면.
2. 가져오기 상태, 로그, 빌드 도구 선택이 화면에 보인다.
3. `defaultSdk`, `buildTools`, `projects` 설정과 재시작 없는 다시 가져오기.
4. `jar`/`jrt` 안의 소스 열기, 테스트, 디버그, 빌드 작업.

얻지 못하는 것도 있다. 보고서 13.2의 JDK 17 문제(`보고서:315`)는 클라이언트에 JDK를 고르는 로직이 없으므로 확장을 돌려도 그대로다. 1~3번은 Apache 2.0 소스로 공개된 클라이언트 로직과 `intellij/*` 메서드를 Setdown의 세션에 옮겨도 얻을 수 있다.

## Java: Language Support for Java(TM) by Red Hat (`vendor/vscode-java`)

| 항목 | 값 |
|---|---|
| 버전 | 1.59.0 (`J/package.json:8`) |
| 라이선스 | EPL-2.0 (`J/package.json:7`, `J/README.md:324-326`) |
| `engines.vscode` | `^1.77.0` (`J/package.json:26-27`) |
| 클라이언트 소스 크기 | `src` 67개 파일(`.ts`, `.tsx`) 11,542줄. 테스트는 `test/`에 따로 있어 들어가지 않는다. |
| `extensionDependencies` | 없다. |
| `enabledApiProposals` | 없다. 붙여넣기 제공자는 API가 있을 때만 등록한다(`J/src/pasteEventHandler.ts:40-41`). |
| 기여 수 | commands 31, configuration 속성 136(13개 묶음), keybindings 6, languages 3, grammars 8, customEditors 1, views 0, debuggers 0, taskDefinitions 0. 자체 기여점 `javaBuildFilePatterns` 2, `javaBuildTools` 2, `javaShortcuts` 4 (`J/package.json:74, 78`). |
| 언어 서버 | Eclipse JDT Language Server (`J/README.md:11`). 공개 소스이나 이 저장소에는 없다. 빌드 때 옆 폴더의 소스로 만들거나 스냅숏을 받아 `server/`에 넣는다(`J/scripts/server.mjs:12-13, 24-66`). |

벤더된 저장소에는 `server/`와 `jre/`가 없다. 둘은 빌드 산출물이다.

### 1. 클라이언트가 하는 일

**a. 도구 확보**

- 실행 중에는 아무것도 내려받지 않는다. 서버, JRE, Lombok이 VSIX 안에 들어 있다.
- 플랫폼별 VSIX 여섯 종에 JRE를 넣는다(`J/README.md:60`). JRE 25를 JustJ에서 받아 넣는 것은 빌드 스크립트다(`J/scripts/jre.mjs:10, 58-60, 79`).
- "universal" 판에는 JRE가 없고 사용자가 Java 25 이상을 갖춰야 한다(`J/README.md:18, 62`).
- 서버 위치는 `../server`이고 `JDT_LS_PATH` 환경 변수로 바꿀 수 있다(`J/src/javaServerStarter.ts:277-283`).
- Lombok jar 1.18.49도 들어 있다(`J/scripts/lombok.mjs:13-15`, `J/src/lombokSupport.ts:59-68`).

**b. 런타임·JDK·환경 선택**

- 서버를 돌릴 JRE는 세 단계로 찾는다. 내장 `jre/`(`J/src/requirements.ts:36, 126-138`), 25 이상인 `java.jdt.ls.java.home` 설정(`:63-67`), 컴퓨터에 깔린 JDK 중 25 이상(`:77-91`) 순이다.
- 못 찾으면 "Java 25 or more recent is required" 메시지와 "Get the Java Development Kit" 버튼을 띄운다(`J/src/requirements.ts:111-113, 183-191`).
- 설치된 JDK 탐색은 npm `jdk-utils`가 한다(`J/src/jdkUtils.ts:4, 39-51`). 출처 순서는 환경 변수, SDKMAN·jEnv·jabba·asdf, `/usr/lib/jvm` 같은 공용 위치다(`J/src/jdkUtils.ts:53-64`).
- 프로젝트용 JDK는 서버용과 따로 다룬다. 기본 프로젝트 JDK는 설정, `java.configuration.runtimes`, 서버용 JRE 순으로 정한다(`J/src/requirements.ts:92-109`).
- `java.configuration.detectJdksAtStart`가 켜져 있으면 찾은 JDK를 `JavaSE-N` 이름으로 `java.configuration.runtimes`에 더해 서버에 보낸다(`J/src/utils.ts:273-276, 286-324`). 서버 자체의 JDK 탐색은 끈다(`J/src/javaServerStarter.ts:211-213`).
- Gradle과 JDK가 안 맞으면 서버가 이벤트를 보낸다. 클라이언트는 맞는 JDK를 다시 찾아 "Use Java N as Gradle JVM"을 제안하고, 고르면 `java.import.gradle.java.home`을 쓰고 다시 가져온다(`J/src/standardLanguageClient.ts:229-246, 709-721`).
- 실행 인자를 조립한다. 모듈 열기, 가져오기 모드, 인코딩, Lombok 에이전트, 힙 덤프, 공유 인덱스, AppCDS, OS별 `-configuration`, `-data`다(`J/src/javaServerStarter.ts:148-301`). 프로젝트가 쓰는 Lombok 버전이 1.18.4 이상이면 그 jar를 에이전트로 쓴다(`J/src/lombokSupport.ts:96-134`).
- 환경은 `process.env`에 로캘 보정을 더한다. 로캘이 비었거나 C이면 `C.UTF-8`로 바꾼다(`J/src/javaServerStarter.ts:45, 106-129`).
- 작업 폴더가 지정한 Java 경로나 JVM 인자는 사용자에게 확인을 받는다(`J/src/settings.ts:165-246`).

**c. 프로젝트 범위와 가져오기**

- 서버 모드가 셋이다. 기본은 Hybrid이고(`J/src/settings.ts:275-284`), 가벼운 "구문 서버" 프로세스를 먼저 띄운 뒤 표준 서버를 띄운다(`J/src/extension.ts:502-514`, `J/src/syntaxLanguageClient.ts:20`). 신뢰하지 않는 작업 폴더는 LightWeight로 고정한다(`J/src/extension.ts:217-221`).
- 작업 공간 데이터는 VS Code의 작업 공간 저장소 아래 `jdt_ws`에 둔다(`J/src/extension.ts:171`).
- 빌드 파일이 여러 프로젝트에 있으면 자동으로 가져올지 직접 고를지 묻는다(`J/src/settings.ts:376-416`, `J/src/extension.ts:802-825`). 아무것도 고르지 않으면 "No Projects Imported" 상태가 된다(`J/src/extension.ts:820-824`).
- Maven과 Gradle 파일이 함께 있으면 "Build tool conflicts are detected in workspace. Which one would you like to use?"를 묻고, 고르지 않은 쪽 가져오기를 초기화 옵션에서 끈다(`J/src/extension.ts:874-902`).
- 초기화 옵션으로 `bundles`, `workspaceFolders`, 설정 전체, 확장 기능 목록, `triggerFiles`를 보낸다(`J/src/extension.ts:244-277`).
- `bundles`는 설치된 다른 확장의 `contributes.javaExtensions`에서 모은 jar 경로다(`J/src/plugin.ts:51-69`). 디버거나 테스트 확장은 이 길로 서버 안에 플러그인을 넣는다. 이 저장소에 디버거와 테스트 실행기는 없다.
- 서버가 만든 `.classpath`, `.project`, `.settings`를 탐색기에서 숨길지 묻는다(`J/src/settings.ts:13, 89-131`).

**d. 표준 LSP 밖의 통신**

- 형식을 정의한 메서드가 36개다. `java/*` 29개, `language/*` 3개, `$/progress`, `workspace/executeClientCommand`, `workspace/notify`, `workspace/willRenameFiles`다(`J/src/protocol.ts:110-157, 461`).
- `language/status`가 시작과 가져오기 진행을 알린다(`J/src/protocol.ts:110`, `J/src/standardLanguageClient.ts:121-193`).
- `language/eventNotification`이 Gradle·JDK 불일치, Gradle 래퍼 갱신, 소스 무효화를 알린다(`J/src/standardLanguageClient.ts:200-281`).
- `language/actionableNotification`은 버튼이 달린 서버 알림이다(`J/src/standardLanguageClient.ts:283-318`).
- `workspace/executeClientCommand`는 서버가 클라이언트 명령을 시키는 요청이다(`J/src/standardLanguageClient.ts:320-322`).
- 명령 상수가 93개다(`J/src/commands.ts`). 서버 명령은 `java.execute.workspaceCommand`를 통해 `workspace/executeCommand`로 보낸다(`J/src/extension.ts:562-588`).
- 미들웨어가 저장 전 정리, 설정 전달, 코드 액션, 참조 찾기를 가로챈다(`J/src/extension.ts:280-437`).

**e. 변경 감지와 재시작**

- 설정 변경은 `java`, `editor.insertSpaces`, `editor.tabSize`, `files.associations` 묶음을 서버에 보낸다(`J/src/extension.ts:240-242, 316-324`). 시작 직후에는 자동으로 찾은 JDK를 넣어 한 번 더 보낸다(`:843-849`).
- 재시작이 필요한 키가 바뀌면 "Java Language Server configuration changed, please reload"를 띄운다(`J/src/settings.ts:34-87, 133-142`).
- 빌드 파일을 감시하는 코드는 `src`에 없다. `createFileSystemWatcher`를 grep으로 찾지 못했고, chokidar는 힙 덤프만 본다(`J/src/extension.ts:1367`). 감시는 서버가 등록하고 `vscode-languageclient`가 수행한다(추정).
- 빌드 파일이 바뀐 뒤의 동작은 `java.configuration.updateBuildConfiguration` 설정(disabled/interactive/automatic, 기본 interactive)이 정한다(`J/package.json:525-538`). 물음에 대한 답을 설정에 써 넣는 것은 클라이언트다(`J/src/standardLanguageClient.ts:435-437, 903-915`).
- 다른 확장이 설치·제거되면 번들을 다시 읽거나 창 새로 고침을 권한다(`J/src/plugin.ts:98-122`).
- 프로젝트의 Lombok 의존성이 바뀌면 재시작을 권한다(`J/src/lombokSupport.ts:136-195`).
- 명령으로 작업 공간 정리, 서버 재시작, 서버 모드 전환을 한다(`J/src/extension.ts:645, 702-733, 974-986, 1391-1410`).

**f. 실패 처리와 화면**

- JRE를 못 찾으면 메시지와 버튼을 띄우고 활성화를 멈춘다(`J/src/extension.ts:200-213`).
- 서버가 죽으면 다시 띄운다. 3분 안에 5번 죽으면 멈추고 "Show logs"를 내민다(`J/src/clientErrorHandler.ts:39-77`).
- 힙 덤프 파일이 생기면 메모리 부족으로 보고 JVM 인자 수정을 권한다(`J/src/extension.ts:72-87, 181, 1365-1389`).
- 상태 표시가 여섯 가지다. Lightweight Mode, No Projects Imported, 진행 중, Error, Warning, Ready다(`J/src/serverStatusBarProvider.ts:17-73`). 언어 상태 항목과 런타임 표시가 따로 있다(`J/src/languageStatusItemFactory.ts:41, 61`, `J/src/runtimeStatusBarProvider.ts:142-144`).
- 가져오기 진행은 알림과 터미널 모양 작업 창에 보인다(`J/src/serverTaskPresenter.ts:31-44, 139-140`).
- 클라이언트 로그, 서버 표준 출력, 서버 오류 로그를 여는 명령이 있다(`J/src/extension.ts:622-628`).

### 2. VS Code에 묶인 정도

세는 법. `.d.ts`를 뺀 66개 파일에서 주석을 지우고 Kotlin과 같은 규칙으로 셌다. 함수 인자 `extensions.length` 2건과 지역 변수 `tasks.forEach` 1건은 손으로 뺐다.

| 네임스페이스 | 사용 수 | 주로 쓰는 멤버 |
|---|---|---|
| `window` | 159 | `activeTextEditor` 35, `showErrorMessage` 24, `showQuickPick` 23, `showInformationMessage` 19, `showWarningMessage` 19, `showTextDocument` 16 |
| `commands` | 141 | `executeCommand` 74, `registerCommand` 67 |
| `workspace` | 116 | `getConfiguration` 42, `workspaceFolders` 25, `findFiles` 10 |
| `env` 15, `languages` 11, `extensions` 7, `tasks` 2 | | |
| `debug`, `tests`, `notebooks`, `lm`, `chat`, `authentication`, `l10n` | 0 | |

- 66개 중 51개 파일이 `vscode`를 import한다. import하지 않는 15개는 웹뷰용 React 코드, 명령 상수, 작은 유틸리티다.
- 필요한 화면 요소는 버튼 달린 알림, 빠른 선택 목록, 진행 알림 4곳, 웹뷰 패널 3곳, 언어 상태 항목 3곳, 상태 표시줄 항목, 파일 열기 대화상자, `.class` 맞춤 편집기 1개, 작업과 가상 터미널이다.
- 그 밖에 작업 공간 신뢰 API(`J/src/extension.ts:217-221, 754-773`), 작업 공간·전역 저장소(`J/src/extension.ts:140-143`), 설치된 확장 목록(`J/src/plugin.ts:24, 143`)이 필요하다.
- Kotlin 확장과 달리 로직과 화면이 섞여 있다. JRE 찾기 파일도 `env`, `window`, `workspace`를 직접 쓴다(`J/src/requirements.ts:7`). 서버 인자 조립 파일도 `workspace`와 확장 컨텍스트를 쓴다(`J/src/javaServerStarter.ts:8`).
- VS Code 화면 없이 뜻이 있는 로직은 JRE·JDK 찾기 순서, JDK를 `JavaSE-N`으로 등록하는 규칙, 서버 실행 인자, 프로토콜 정의, 충돌 판정 규칙이다. VS Code 안에서만 뜻이 있는 것은 리팩터링 웹뷰, 코드 액션 화면, 클래스 파일 편집기, 다른 확장과의 번들 연동이다.

### 3. VS Code 없이 쓸 수 있는 부품

- **eclipse.jdt.ls.** 스냅숏이 `https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz`에 있다(`J/scripts/server.mjs:13`). `java -jar org.eclipse.equinox.launcher_*.jar -configuration … -data …`로 띄운다(`J/src/javaServerStarter.ts:175-177, 277-299`). 서버의 라이선스 문서는 이 저장소에 없다(EPL-2.0으로 알려져 있으나 여기서는 확인하지 못했다. 추정).
- **JustJ JRE 25.** 빌드 스크립트가 받는 주소가 적혀 있다(`J/scripts/jre.mjs:58-60`).
- **npm `jdk-utils` 0.6.** 설치된 JDK를 찾는 Node 라이브러리다(`J/src/requirements.ts:5`, `J/src/jdkUtils.ts:4`). `node_modules`가 없어 라이선스와 내부는 확인하지 못했다.
- **Lombok jar.** 에이전트로 붙이는 방식이 코드에 있다(`J/src/lombokSupport.ts:96-134`).
- **프로토콜 정의.** `J/src/protocol.ts`(509줄)는 `vscode`에서 `Command`, `Range` 형식만 가져온다(`J/src/protocol.ts:3`). `J/src/commands.ts`(380줄)는 `vscode`를 import하지 않는다. 둘 다 EPL-2.0이다.
- **확장 자체.** EPL-2.0이고 비공개 부분이 없다. 의존 확장도 제안 API도 없다.

### 4. Zed와 Setdown은 지금 어떻게 하는가

Setdown에는 Java가 지원 언어 목록에 없고(`apps/desktop/src/core/document/supported-languages.ts:13`에 Kotlin만 있다), `jdtls`는 Zed Java 확장으로 준비한다(`S/catalog/zed-profiles.json:60830-60838`).

| 차이 | VS Code 확장 | Zed 확장과 Setdown |
|---|---|---|
| 서버 확보 | VSIX에 들어 있다(`J/src/javaServerStarter.ts:277-283`). | Zed 확장이 실행 중에 GitHub 태그로 최신 버전을 찾고 eclipse.org에서 받는다(Zed Java 확장 `src/jdtls.rs:76-80, 104-107`). 프록시 실행 파일과 Lombok도 따로 받는다(Zed Java 확장 `README.md:648-651`, `src/jdtls.rs:211-219`). |
| 서버용 JRE | 내장 JRE, 설정, 컴퓨터의 JDK 탐색 순이다(`J/src/requirements.ts:36, 63-67, 77-91`). | `java_home` 설정, `JAVA_HOME`, PATH의 `java` 순이고 탐색은 없다(Zed Java 확장 `src/config.rs:15-40`, `src/util.rs:243-272`). 25 미만이면 오류를 내고, `jdk_auto_download`가 켜져 있을 때만 Corretto 25를 받는다(`src/jdtls.rs:263-277`, `src/jdk.rs:17-19`). |
| Setdown의 보완 | 해당 없음 | Setdown은 설치된 JDK 중 맞는 것을 골라 `JAVA_HOME`에 넣는 로직이 있다(`S/tool-runtime.ts:39-51, 75-84`). 실행 파일 이름이 `jdtls` 또는 `jdtls.py`일 때만 작동한다(`S/tool-runtime.ts:55-63`). Zed 확장이 돌려주는 명령은 프록시 실행 파일이다(Zed Java 확장 `src/jdtls_server.rs:133-137`). 그래서 Zed 확장 경로에는 이 로직이 걸리지 않는다(추정: 호스트가 확장의 명령을 그대로 실행 파일로 돌려준다고 보았다). 순서로도 닿지 않는다. Java가 25 미만이면 확장이 준비 단계에서 오류를 내고(`S/language-manager.ts:570`), JDK를 고르는 호출은 그 뒤에 있다(`S/language-manager.ts:645-650`). 보고서 13.1의 "Setdown이 설치된 JDK 25를 알려 주지 않는다"와 맞는다(`보고서:300`). |
| 오류 분류 | 버튼이 달린 전용 메시지(`J/src/requirements.ts:111-113`) | Zed 확장의 문구는 "require at least Java version 25"다(Zed Java 확장 `src/jdtls.rs:34`). Setdown의 정규식은 "requires … Java 25" 꼴만 잡는다(`S/language-issue.ts:19`). 두 문구가 맞지 않는다. 보고서도 같은 원인을 적고 수정안을 냈다(`보고서:300, 306`). |
| 프로젝트 JDK 등록 | 찾은 JDK를 모두 `java.configuration.runtimes`에 넣는다(`J/src/utils.ts:286-324`). | Zed 확장은 사용자가 초기화 옵션에 직접 적게 한다(Zed Java 확장 `README.md:13, 251`). Setdown은 서버용 JDK를 바꿨을 때만 프로젝트 기본 JDK 하나를 등록한다(`S/tool-runtime.ts:87-90`, `S/language-manager.ts:662-664`). |
| 프로세스 구성 | 구문 서버와 표준 서버 두 개(`J/src/extension.ts:502-514`) | 프록시 뒤의 서버 하나(Zed Java 확장 `src/jdtls_server.rs:133-137`). 인자는 고정 목록이고 초기 힙이 1G다(`src/jdtls.rs:290-340`). |
| 확장 프로토콜 | `language/status`, `language/eventNotification`, `language/actionableNotification`, `workspace/executeClientCommand`를 처리한다(`J/src/standardLanguageClient.ts:121, 200, 283, 320`). | Zed 확장은 확장 기능으로 `classFileContentsSupport`, `resolveAdditionalTextEditsSupport` 둘만 알린다(Zed Java 확장 `src/jdtls_server.rs:158-169`). Setdown 세션에는 이 메서드들의 처리기가 없다(`S/server-session.ts:94-135`, grep으로 찾지 못함). |
| 가져오기 선택 | 빌드 도구 충돌과 가져올 프로젝트를 묻는다(`J/src/extension.ts:874-902`, `J/src/settings.ts:376-416`). | Zed 확장은 `workspaceFolders`에 루트 하나를 넣을 뿐이다(Zed Java 확장 `src/jdtls_server.rs:153-156`). |
| 재시도 | 3분에 5번까지(`J/src/clientErrorHandler.ts:39-77`) | Setdown은 세 번까지 다시 연결한다(`S/language-manager.ts:688-692`). |

### 5. 이 확장을 그대로 돌린다면

**호스트가 제공해야 하는 것**

- VS Code API 1.77 수준의 확장 호스트와 `vscode-languageclient` 10.1(`J/package.json:26-27`). 언어 기능은 그 라이브러리가 제공자 등록 API로 붙이므로 Setdown의 자체 세션을 쓰지 않는다(추정).
- 2절의 화면 요소. 사용량은 Kotlin 확장의 두 배를 넘는다(`window` 159 대 70, `commands` 141 대 30).
- 설치된 확장 목록과 `contributes` 읽기(`J/src/plugin.ts:51-69, 141-157`). 디버거와 테스트 확장까지 쓰려면 그 확장들도 같은 호스트에서 돌아야 한다.
- 작업 공간 신뢰, 작업 공간·전역 저장소, 웹뷰(React), 맞춤 편집기, 작업과 가상 터미널.

**막는 것**

- 라이선스는 막지 않는다. EPL-2.0이고 비공개 부분, 의존 확장, 제안 API가 없다.
- 배포. 벤더된 소스에는 서버와 JRE가 없다. 플랫폼별 VSIX를 받거나 빌드 스크립트를 돌려야 한다(`J/scripts/server.mjs`, `J/scripts/jre.mjs`). Marketplace 배포본의 이용 조건은 저장소에 없어 확인하지 못했다.
- 원격 측정 패키지 `@redhat-developer/vscode-redhat-telemetry`가 의존성에 있고 활성화 때 시작한다(`J/src/extension.ts:179`).
- 호스트 구현량. 화면과 로직이 섞여 있어 일부 API만 흉내 내서는 활성화가 끝나지 않는다(추정).

**지금의 Setdown보다 얻는 것**

1. Java 25가 없어도 서버가 뜬다. 내장 JRE와 JDK 탐색이 보고서 13.1의 문제를 없앤다.
2. 프로젝트 JDK 자동 등록과 Gradle·JDK 불일치 해결 제안.
3. 가져오기 진행, "No Projects Imported", 빌드 도구 선택이 화면에 보인다.
4. 구문 서버 덕분에 가져오기가 끝나기 전에도 문법 오류와 개요가 나온다.
5. 프로젝트의 Lombok 버전에 맞춘 에이전트.

1번과 2번은 화면 없이 옮길 수 있는 규칙이다. JRE 찾기 순서는 221줄(`J/src/requirements.ts`), JDK 등록은 40줄(`J/src/utils.ts:286-324`)이고 탐색은 `jdk-utils`가 한다. Setdown에는 같은 일을 하는 `S/tool-runtime.ts`가 이미 있으나 Zed 확장 경로에 연결되지 않았다. 3번은 `language/status` 등 네 메서드를 Setdown 세션이 받아야 한다.
