# Setdown LSP 전수 조사와 확장 계획

작성: 2026-10-16. Setdown 분석 기준: `34ef4df5c85e436baa62bf6641122d005fa7fcf2`.

이 문서는 구현 계획이다. 현재 코드, 설치된 라이브러리, 참조 서브모듈과 공식 명세를 조사했다. 새 기능을 구현하거나 서버별 호환성·성능 시험을 실행한 결과가 아니다. 아래의 **현재**는 코드에서 확인한 사실이고, **제안**과 단계별 완료 조건은 앞으로 해야 할 일이다.

## 1. 결론: 연결 가능한 서버 수 다음에는, 연결해서 쓸 수 있는 기능을 늘려야 한다

Setdown은 여러 언어 서버를 발견하고 연결하는 기반을 갖췄다. 하지만 연결된 서버에서 가져오는 편집 기능은 아직 좁다. renderer가 호출할 수 있는 LSP 요청은 **9개**이며, 이것으로 자동완성·hover·함수 인자 도움말·정의 이동·참조·문서 심벌·이름 변경이라는 **7개 기능군**을 제공한다. 진단은 별도의 서버 알림으로 받는다. 서버가 더 많은 기능을 제공해도 현재 연결부에는 그 결과를 전달하고 표시할 길이 없다.

따라서 다음 목표는 **언어별 기능 추가가 아니라, 서버 capability에 따라 작동하는 공통 편집 기능 확장**이어야 한다. C++용 코드 액션, Rust용 코드 액션을 따로 만드는 대신 하나의 코드 액션 연결을 만들고 각 서버가 실제로 제공하는 결과를 사용한다.

우선 적용할 가치가 큰 묶음은 다음과 같다.

| 순서 | 사용자에게 생기는 변화 | 주요 작업 |
| --- | --- | --- |
| 1 | 함수·타입·변수 색깔이 정확해지고 코드 탐색이 편해진다 | Semantic Tokens, 선언/타입/구현 이동, 심벌 강조, 구조적 선택·접기 |
| 2 | 오류 수정, import 정리, 코드 정렬을 할 수 있다 | 공통 텍스트 편집 검증, Code Actions, formatting, 제한된 서버 command 연결 |
| 3 | 서버가 원래 지원하는 기능이 빠지지 않고, 준비 상태도 이해할 수 있다 | 동적 등록, pull diagnostics, 진단 정보 보존, 파일 감시, progress/log, 설정·저장 연동 |
| 4 | 프로젝트 전체를 탐색하고 파일 이동에 맞춰 코드를 고칠 수 있다 | workspace symbols, 호출/타입 계층, Explorer 파일 작업 연동 |
| 5 | 필요한 언어에서 더 많은 도움을 받는다 | 인레이 힌트·CodeLens 세부 기능, 보조 서버, 가상 문서, 일부 서버 전용 확장 |

이 표는 체감 효과 순서다. 실제 착수는 **P0 공통 경계 정리 → P1 읽기·탐색 → P2 수정 → P3 호환성 → P4 프로젝트 기능** 순서로 한다. progress/log 같은 가벼운 기반은 P0에 먼저 넣는다. 인레이 힌트의 기본 표시도 P1에 포함하고, command·편집을 수반하는 동작은 P2 이후에 붙인다.

큰 새 화면부터 만들 필요는 없다. 가능한 기능은 기존 Monaco의 우클릭 메뉴, 전구, hover, Peek, 접기와 선택 UI를 사용한다. 서버 상태와 실패 원인은 이미 있는 Language Support 패널에 둔다. 최근 제거한 편집기 위 `Language support stopped · Restart` 버튼은 되살리지 않는다.

## 2. 조사 범위와 ‘전수’의 기준

설치된 패키지는 Monaco **0.56.0**, `vscode-languageserver-protocol` **3.18.3**, `vscode-jsonrpc` **9.0.1**, Pyright **1.1.414**다. 버전은 실제 `node_modules`와 [desktop package.json](../apps/desktop/package.json)을 함께 확인했다.

메시지 목록의 기준은 고정된 참조 저장소의 [protocol/metaModel.json](../vendor/vscode-languageserver-node/protocol/metaModel.json)이다. 메타모델 버전은 **3.18.0**, 요청 **69개**, 알림 **26개**, 합계 **95개**다. 부록은 이 목록의 모든 method를 하나씩 판정한다. 일부 capability 아래의 옵션은 별도 표에서 다룬다. 메시지 개수는 구현률이 아니다. `shutdown` 하나와 여러 파일을 안전하게 수정하는 `workspace/applyEdit` 하나의 비용은 크게 다르다.

3.18에 추가된 inline completion, text document content, 여러 범위 formatting 등도 누락시키지 않았다. 다만 라이브러리 버전이 3.18이라고 서버가 이 기능을 제공하는 것은 아니다. 사용할 수 있는 기능은 초기화와 동적 등록에서 협상한 내용으로 결정한다. 서버별 비표준 method와 VS Code 확장 API 전체는 표준 95개와 분리한다.

실제로 읽은 Setdown 경로는 다음과 같다.

| 책임 | 코드와 확인한 내용 |
| --- | --- |
| 공개 연결 규약 | [protocol/language.ts](../apps/desktop/src/protocol/language.ts): 9개 method 허용 목록, 문서 버전, 이벤트, 동기화 옵션 |
| 프로세스·JSON-RPC | [server-session.ts](../apps/desktop/src/main/language/server-session.ts): initialize capability, 서버 요청 처리, timeout/cancel, watcher, 종료 |
| 창·문서·세션 소유권 | [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts): IPC 검증, 서버 선택, 응답/진단 버전 검사, catalog feature 목록 |
| renderer 연결 | [language-client.ts](../apps/desktop/src/renderer/editor/language-client.ts): provider 등록, 순서 보장, resolve, 이름 변경 편집 검증 |
| 결과 변환 | [language-conversion.ts](../apps/desktop/src/renderer/editor/language-conversion.ts): completion, range, Markdown, diagnostics |
| 모델·화면·테마 | [monaco-editor.ts](../apps/desktop/src/renderer/adapters/monaco-editor.ts), [live-document-model.ts](../apps/desktop/src/renderer/editor/live-document-model.ts), [theme.ts](../apps/desktop/src/renderer/theme.ts) |
| 문서 열기·저장 | [workspace-controller.ts](../apps/desktop/src/renderer/workspace/workspace-controller.ts), [tab-controller.ts](../apps/desktop/src/renderer/workspace/tab-controller.ts), [auto-save.ts](../apps/desktop/src/renderer/workspace/auto-save.ts) |
| 파일 작업 | [explorer-controller.ts](../apps/desktop/src/renderer/project/explorer/explorer-controller.ts), [explorer-service.ts](../apps/desktop/src/main/project/explorer-service.ts), [file-system.ts](../apps/desktop/src/main/documents/file-system.ts), [protocol/explorer.ts](../apps/desktop/src/protocol/explorer.ts) |
| 설정·프로필·검증 | server registry/profile 정의, [language-support.md](../docs/language-support.md), client/manager/session unit tests, Python/clangd/fortls/rust-analyzer Electron tests, [성능 계약](../docs/preview-performance-contract.md) |

## 3. 현재 구조에서 지킬 것과 바꿀 것

### 3.1 보존할 기반

현재 구조의 가장 좋은 부분은 **문서 모델이 중심**이라는 점이다. LSP가 자기 텍스트 저장소를 새로 만들지 않고, 기존 Monaco 모델을 따른다. 일반 편집과 Working Tree가 모델과 Undo를 공유하며, 과거 Git revision은 LSP 문서에서 제외된다. Save As와 서버 재시작도 모델을 교체하지 않는다.

renderer는 변경 내용을 순서대로 보내고, 요청 전에 전송 큐를 기다린다. 동시 다중 커서 편집은 내림차순 offset으로 LSP의 순차 변경으로 변환한다. 응답은 연결 generation과 모델 version을 확인한다. main은 창의 소유권, 허용 method, 현재 문서 버전을 확인한다. 서버는 창·서버·root·설정에 따라 분리되고 마지막 문서를 닫으면 종료된다.

이 보장은 새 기능에도 그대로 적용해야 한다. 특히 빠른 응답을 위해 오래된 수정 결과를 적용하거나, 여러 창의 같은 경로를 하나의 미저장 버퍼로 합치면 안 된다.

### 3.2 기능을 늘릴 때 막히는 네 군데

**첫째, 현재 IPC는 거의 모든 요청을 현재 문서 요청으로 바꾼다.** `language-manager.ts`는 `completionItem/resolve`를 제외하면 params에 소유 문서의 `textDocument.uri`를 덧붙인다. `workspace/symbol`, `workspace/executeCommand`, 각종 item resolve, hierarchy 후속 요청은 다른 형태다. 허용 목록에 문자열만 추가하는 식으로 확장하면 요청 의미와 소유권이 뒤섞인다.

**둘째, 서버에서 클라이언트로 오는 동작을 처리할 통로가 좁다.** configuration과 workspaceFolders에는 응답하지만 `workspace/applyEdit`는 항상 거절한다. 동적 capability 등록, refresh, progress, 메시지·문서 표시 요청은 연결하지 않았다. 서버가 초기화 이후 기능을 등록하는 방식이면 현재 정적 provider 등록으로는 기능이 나타나지 않는다.

**셋째, 편집 적용 코드가 이름 변경 안에 들어 있다.** 현재 `textChanges()`와 `workspaceEdit()`는 버전, 범위, 겹침, 미열린 대상 문서 등을 검사한다. 앞으로 formatting, code actions, inlay hint edits, willSave, applyEdit가 각각 이를 다시 구현하면 유지보수 비용과 데이터 손상 가능성이 커진다.

**넷째, 상태 표시와 capability 선언이 기능 구현에서 분리돼 있다.** initialize의 client capabilities, renderer의 provider 분기, main의 `features` 목록이 세 군데에 있다. 지금 catalog는 7개 provider 여부만 나열한다. 이를 그대로 확장하면 UI에 ‘지원’이라고 나오지만 실제 실행 경로는 없는 상태가 생기기 쉽다.

## 4. 이미 지원하는 기능에도 남아 있는 빈틈

새로운 provider만 늘리는 것보다 기존 결과를 온전히 전달하는 일이 먼저인 경우가 있다.

| 기능 | 현재 지원 | 빠진 세부 사항과 계획 |
| --- | --- | --- |
| Completion | trigger, snippets, insert/replace range, 추가 text edits, 정렬, incomplete, 조건부 resolve | `labelDetails`, list `itemDefaults`·3.18 `applyKind`, `insertTextMode`, deprecated/commit-character capability 정합성 점검. server command는 현재 버린다. 광고한 옵션과 실제 변환을 함께 늘린다 |
| Completion resolve | 원본 item을 WeakMap에 보관하고 버전 검증 | 앞으로 다른 resolve에도 원본 `data`와 세션 출처를 보존해야 한다. 수락 후 추가 편집과 typing 사이의 race도 실제 Monaco에서 검증 |
| Hover | Markdown/plaintext, range, 여러 content | HTML/command 신뢰를 주지 않는 현재 정책 유지. 링크 탐색과 가상 문서는 별도 URI 정책 필요 |
| Signature help | 기본 signature/parameter, trigger/retrigger 문자 | 요청의 `SignatureHelpContext`를 보내지 않는다. signature별 `activeParameter`를 변환하지 않는다. 이 옵션들을 지원할 때만 대응 capability 광고 |
| Definition/references | Location/LocationLink, file URI, 기존 탭 이동 | 선언·타입·구현 이동 미연결. 현재 non-file URI는 제외되므로 서버가 가상 문서를 반환하면 이동 불가 |
| Document symbols | 계층형과 평면형 응답, Monaco 문서 심벌 | 프로젝트 전체 symbol 검색 없음. 평면형 deprecated 정보 등 변환 보완. 별도 Outline UI는 LSP 요청 추가와 다른 작업 |
| Rename | prepare, 미열린 파일, 버전/범위/겹침 검사, 최대 200문서 | 리소스 create/rename/delete와 annotation/snippet edit 거절. prepare의 defaultBehavior는 미지원이며 현재 광고도 하지 않음. 실제 연결 서버 비교와 대상 동기화 정책을 공통화 |
| Push diagnostics | 심각도·source·code·tags, 버전 일치 검사 | `relatedInformation`, `codeDescription`, 원본 `data`가 marker로 이어지지 않는다. 버전 없는 진단·닫힌 파일 진단은 전달되지 않는다. 코드 액션에는 표시용 marker와 별도로 원본 Diagnostic 보관 필요 |
| 문서 동기화 | None/Full/Incremental, openClose, save/includeText | willSave/willSaveWaitUntil, 동적 동기화 등록, untitled URI, notebook 동기화 없음 |
| Configuration | dotted/nested section, initializationOptions, 초기 변경 알림 | `scopeUri`별 설정 없음. 설정 변경 시 서버 재시작. 런타임 변경 가능한 설정도 재시작과 분리할 여지 |
| Cancellation | RPC 취소, stale 응답 제거, 요청 수 상한 | 구조화된 LSP error code가 renderer까지 보존되지 않는다. `ServerCancelled` 재요청과 `ContentModified` 처리, partial result 생명주기 추가 필요 |

위 옵션 중 광고하지 않은 기능을 서버가 보내지 않는 것은 정상이다. 따라서 ‘결과가 손실된다’와 ‘기능을 아직 협상하지 않는다’를 구분해야 한다. 이 표는 모두 현재 버그라는 주장이 아니라, 다음 확장에서 같이 다룰 호환성 범위다.

별도 method가 없는 선택 기능도 다음처럼 처리한다.

| 공통 계약·옵션 | 현재와 계획 |
| --- | --- |
| 위치 인코딩 | 현재 UTF-16만 광고하고 다른 선택은 거절한다. Monaco와 일치하므로 유지. UTF-8/32 변환은 필요 서버가 확인될 때만 추가하며 모든 range·diagnostic·edit·token 경로를 함께 변경해야 함 |
| untitled 문서 | 현재 saved file만 연결. P5에서 명시적으로 언어를 고른 draft에 `untitled:` URI를 부여하는 방안 검토. 가짜 디스크 파일을 만들지 않고, 저장 시 close/open과 동일 모델·Undo를 유지. 서버가 지원하는 경우에만 활성화 |
| document selector | 현재 모델별 정확한 소유권 검사. 동적 등록 시 language/scheme/glob을 해석하되 서버의 selector가 창/문서 권한을 넓히지는 않음 |
| 작업 중 응답·부분 응답 | workDone과 partialResult는 모두 progress를 사용해도 의미가 다름. P0 상태 표시와 P4 결과 병합을 구분. 최종 결과·취소·restart 시 같은 요청의 임시 결과를 정리 |
| LSP 오류 코드 | P0부터 `RequestCancelled`, `ContentModified`, `ServerCancelled`, 오류 data를 보존. 재시도 가능한 읽기 요청만 제한적으로 재요청하고 command/편집을 자동 재실행하지 않음 |
| WorkspaceEdit 옵션 | 현재 documentChanges/text edit와 abort만 선언. P2 annotation·변경 metadata, P4 resource operations와 실패 결과를 실제 동작에 맞춰 광고. 3.18 snippet edit는 public snippet/Undo 경로를 검증하기 전 보류 |
| Markdown·문자열 표시 | 현재 HTML과 command 신뢰를 끈다. markup/regex engine·locale 등 추가 협상도 실제 renderer와 일치할 때만 선언. diagnostic의 Markdown 메시지는 지원 광고 전까지 안전한 텍스트로 표시 |

서버는 클라이언트 전체와 협상하지만 Monaco는 모델별 provider를 가진다. 따라서 초기 capability와 이후 등록 옵션을 모델 선택·언어 변경에 반영하는 작업까지 완료해야 ‘지원’으로 센다.

## 5. 가장 먼저 추가할 기능

### 5.1 Semantic Tokens: 색깔은 provider와 테마가 함께 책임진다

표준 semantic tokens는 텍스트 범위를 함수·타입·매개변수 같은 종류와 modifier로 분류한다. 실제 색상은 에디터가 정한다. syntax highlighting 위에 보완하는 정보이며, 서버가 모든 키워드·문자열을 색칠해 준다는 보장은 없다. [공식 Semantic Highlight Guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide)

현재는 initialize capability, 허용 method, provider가 모두 없다. 여기에 한 가지가 더 있다. 설치된 Monaco의 `standaloneThemeService.js`는 `semanticHighlighting = false`이고 기본 설정은 `configuredByTheme`다. Setdown은 이를 명시적으로 켜지 않는다. **provider만 등록하면 실제 색깔이 바뀌지 않을 수 있다.**

구현은 다음 순서로 한다.

1. 실제 server legend와 capability를 읽어 full/range provider를 등록한다. UTF-16, relative token format, 미지원 overlap/multiline 여부를 정직하게 협상한다.
2. 모델·세션·legend epoch별로 resultId를 소유한다. full부터 적용하고 delta를 붙인다. delta는 텍스트 범위가 아니라 이전 정수 배열에 대한 수정이다. 잘못된 offset·정수·legend index·길이는 거절하고 full 요청으로 복구한다.
3. `workspace/semanticTokens/refresh`에 응답하고 해당 세션의 provider를 무효화한다. 숨겨진 모델은 dirty로 표시한 뒤 보일 때 다시 요청할 수 있다. 다른 서버의 resultId를 섞지 않는다.
4. Monaco 공개 옵션 `'semanticHighlighting.enabled': true`와 기존 theme rules를 연결한다. standalone은 VS Code의 `semanticTokenColors` JSON을 그대로 읽는 구조가 아니다. 설치된 구현은 `type.modifier`를 token theme rule로 찾으므로 그 경로를 기준으로 표준 type/modifier 색상을 정의한다. 내부 service를 직접 import하지 않는다.
5. 일반 편집과 live Working Tree에 동일하게 적용하고, immutable revision은 기존 syntax 강조를 유지한다. 서버 실패·닫기·언어 변경 시 semantic 데이터와 provider를 해제한다.

full/range/delta와 refresh의 계약은 [LSP Semantic Tokens 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/language/semanticTokens.md), 구현 비교는 [공식 클라이언트 semanticTokens.ts](../vendor/vscode-languageserver-node/client/src/common/semanticTokens.ts)를 따른다.

**Fortran의 흰 글자는 이것만으로 해결되지 않는다.** 조사한 설치본 fortls의 `serve_initialize()`에는 semanticTokensProvider가 없다. 공식 소스도 확인했다. 해당 서버에서 공급하지 않는 token을 Setdown이 받을 수는 없다. Fortran의 기본 문법 강조는 검증된 grammar/tokenizer를 도입하는 별도 작업이다. 언어 서버 설치와 문법 설치를 같은 것으로 표시해서는 안 된다. [fortls 구현](https://raw.githubusercontent.com/fortran-lang/fortls/master/fortls/langserver.py)

### 5.2 탐색·선택·접기: 작은 비용으로 체감이 큰 묶음

`declaration`, `typeDefinition`, `implementation`은 기존 definition의 URI/LocationLink 변환을 공통화해 연결한다. 서버가 지원할 때만 Monaco 메뉴에 나타나게 한다. `documentHighlight`는 같은 문자열이 아니라 같은 심벌의 read/write 위치를 강조한다. `selectionRange`는 식 → 인자 → 문장처럼 의미 있는 선택 확대를 제공한다. `foldingRange`는 들여쓰기 추정보다 정확한 접기를 제공한다.

이 기능들은 Monaco 0.56의 공개 provider API에 대응점이 있다. 다만 folding의 문자 단위 범위·collapsedText처럼 Monaco가 직접 표현하지 않는 세부 옵션은 지원한다고 광고하지 않는다. selection의 부모 범위가 자식을 포함하는지, highlight와 folding이 문서 경계를 벗어나지 않는지도 검사한다.

`documentLink`는 프로젝트 파일이나 문서 링크를 지원한다. 링크를 찾는 것과 여는 권한은 다르므로 기존 Setdown 탭 열기와 HTTP(S) 열기 정책을 재사용한다. `command:`·`javascript:`·임의 외부 프로토콜을 그대로 실행하지 않는다. 링크 resolve도 세션에 귀속한다.

`documentColor`는 CSS의 색상 칩·색 선택기용이다. 코드의 의미 기반 색칠과는 별개다. 색상 표시를 먼저 연결하고, 선택 후 `colorPresentation`이 만드는 text edits는 P2의 검증 경로로 적용한다.

### 5.3 Inlay Hints와 CodeLens: 기능은 지원하되 화면은 절제한다

Inlay hints는 추론된 타입이나 인자 이름을 본문 사이에 표시한다. 보이는 범위만 요청하고, 라벨·tooltip·위치·textEdits·command의 resolve를 구분한다. 힌트가 보였다는 이유로 원문이 바뀌면 안 된다. 명시적인 수락 동작만 text edits를 적용한다. [Inlay Hint 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/language/inlayHint.md)

제안하는 기본값은 **지원 가능하지만 표시 여부는 쉽게 끌 수 있게** 하는 것이다. 초기에는 언어별 opt-in이나 눌렀을 때 표시하는 방식으로 검증하고, 밀도와 줄바꿈을 보고 기본값을 결정한다. CodeLens는 더 눈에 띄므로 기본 off, 필요할 때 켠다. 참조 수 같은 렌즈도 실제로는 server command인 경우가 있으므로 숫자 표시만 붙이고 모든 command를 실행 가능하게 해서는 안 된다.

## 6. 수정 기능의 중심: 공통 Workspace Edit 처리

### 6.1 Code Actions와 formatting을 같이 설계해야 하는 이유

오류에 전구가 나타나고 import 추가, 안전한 수정, 함수 추출 등을 고를 수 있게 하는 표준이 Code Actions다. 응답에는 직접 편집, 나중에 resolve할 편집, server command가 올 수 있다. action kind·disabled 이유·preferred 여부를 보존하고, UI에 보이는 액션과 실제 실행 능력이 일치해야 한다. [Code Action 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/language/codeAction.md)

Format Document/Selection은 그보다 좁은 텍스트 편집이지만 같은 버전·범위·Undo 검증이 필요하다. 인레이 힌트 수락, 자동 import, willSave 결과까지 이 검증을 공유해야 한다.

현재 이름 변경의 검증을 `workspace-edits` 역할로 분리하되, **모든 기능에 rename의 재요청 루프를 복사하면 안 된다.** 이름 변경은 미열린 파일을 동기화한 뒤 다시 계산할 수 있다. command 실행은 부작용이 있을 수 있어 같은 방식으로 재실행할 수 없다.

### 6.2 제안하는 편집 절차

1. 요청/사용자 동작 시작 시 세션 epoch, 관련 모델 version, 문서 generation을 기록한다. 원본 응답과 `data`는 출처를 보존한다.
2. 편집 대상 URI를 main에서 검증하고, 허용된 텍스트 문서를 기존 `prepareLanguageDocument()` 경로로 준비한다. 코드 액션이 JSON이나 설정 파일을 고칠 수 있으므로 ‘같은 확장자/같은 LSP 언어만 허용’하는 규칙을 일반화하지 않는다.
3. 열린 문서는 현재 버퍼를 기준으로 한다. 미열린 대상은 디스크 상태와 로드 시점을 기록한다. version이 null인 편집을 현재 버전으로 위조하지 않는다. 새로 로드한 내용과 서버의 기준이 어긋나면, 재계산 가능한 요청은 다시 계산하고 그 외에는 거절하거나 변경 내용을 확인할 수 있게 한다.
4. 모든 대상의 범위·겹침·중복 URI·문서 수·총 편집량을 검증한 뒤 적용한다. 같은 위치의 여러 삽입 순서, CRLF, emoji·한글, 여러 documentChanges의 순서를 별도로 다룬다.
5. 기존 모델의 Undo 가능한 편집 API를 사용한다. 언어 지원이 직접 파일을 덮어쓰거나 `setValue()`로 Undo를 지우지 않는다. 자동 저장은 기존 사용자 설정을 따르되 편집 묶음 적용 중에는 `AutoSaveController.hold()` 같은 기존 조정 수단으로 경합을 막는다.
6. 적용 직전에 다시 version을 확인하고 완료·실패를 정확히 반환한다. 탭 닫기·Save As·restart로 권한이 만료된 결과는 적용하지 않는다.

provider가 Monaco에 반환해서 적용할 편집과, `workspace/applyEdit`처럼 Setdown이 직접 적용해야 할 편집은 같은 검증 계획을 사용하되 실행자는 하나만 둔다. provider 내부에서 먼저 적용하고 동일한 WorkspaceEdit를 다시 반환하는 중복 적용을 막는다.

텍스트만 다루는 P2에서는 annotation의 label·확인 필요성을 처리하되, 아직 구현하지 않은 resource/snippet edit를 capability에 넣지 않는다. 확인이 필요한 변경은 기존 diff 컴포넌트를 사용한 임시 변경 보기로 구체화한다. Git index에 임시 변경을 쓰지 않는다.

### 6.3 Monaco가 대신 해주지 않는 부분

설치된 `StandaloneBulkEditService`는 **이미 로드된 모델의 text edit만** 지원하고 파일 create/rename/delete는 거절한다. 모델별로 Undo 경계를 만든다. Setdown 성능 계약도 현재 Undo를 **파일별**로 명시한다.

따라서 ‘Monaco WorkspaceEdit를 반환하면 VS Code처럼 모든 파일 작업과 전체 변경 Undo까지 완성된다’고 가정하면 안 된다. 초기 확장에서도 파일별 Undo를 유지한다. 여러 파일을 한 번에 되돌리는 전역 Undo가 필요하면 별도의 제품 기능으로 설계하고 검증한다. 디스크 파일 작업과 메모리 편집 전체의 원자성도 현재 제공되지 않는다.

### 6.4 서버 command와 `workspace/applyEdit`

`workspace/executeCommand`는 LSP 서버에 명령 ID와 인자를 전달하는 요청이다. **OS shell command와는 다르다.** 이 기능을 지원하려고 임의 문자열을 shell에 넘길 이유는 없다. 다만 서버가 해당 명령으로 프로젝트를 수정하거나 다른 작업을 할 수 있으므로 사용자 동작과 응답 출처를 연결해야 한다. [Execute Command 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/workspace/executeCommand.md)

command ID를 Monaco 전역 명령 ID로 직접 등록하지 않는다. Setdown의 공통 command handler 하나가 세션·항목 handle을 받아, 해당 서버가 제공한 command인지 확인한 뒤 같은 세션에 전달하게 한다. VS Code 전용 client command는 자동으로 호환되지 않는다. 필요하면 작고 명시적인 어댑터를 둔다.

`workspace/applyEdit`에는 원래 사용자 action의 ID가 항상 붙어 오는 것이 아니다. ‘직전에 command가 있었으니 모든 applyEdit를 허용’하는 시간 기반 추정은 불충분하다. 서버·대상 범위·pending operation을 제한하고 연결을 증명할 수 없는 편집은 변경 확인 화면으로 보낸다. 응답은 실제 처리 결과에 따라 `applied`, `failureReason`, 지원 범위 안의 `failedChange`를 채운다. main이 renderer 응답을 기다리면서 그 renderer의 정상 LSP request 처리까지 막는 교착도 피해야 한다. [Apply Edit 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/workspace/applyEdit.md)

## 7. 진단은 기능 추가이면서 호환성 수정이다

### 7.1 현재의 실제 제약: fortls 진단

`LanguageManager.open()`의 진단 callback은 `params.version === binding.version`인 경우만 전달한다. 설치된 fortls의 `send_diagnostics()`는 `{ uri, diagnostics }`를 전송하며 version이 없다. **현재 연결에서는 fortls 진단이 이 조건을 통과하지 못한다.** 실제 Fortran E2E도 hover·completion·rescan을 검증하며 진단까지 검증하지 않는다.

이것은 LSP 연결 성공과 모든 기능의 성공이 다르다는 구체적인 예다. 다만 이 보고서에서 새 실행으로 재현한 결과는 아니며, 양쪽 소스와 기존 테스트를 대조한 판정이다.

### 7.2 버전 검사를 지우지 않고 지원 폭을 넓힌다

제안하는 정책은 세 가지다.

| 진단 종류 | 처리 |
| --- | --- |
| version이 있는 push | 현재 version/generation 검사 유지 |
| pull 지원 | 요청 전 동기화 큐를 비우고 요청 시점 version과 연결 epoch를 기록. 중간 입력이 있으면 폐기. resultId/full/unchanged, refresh, 관련 문서, 취소를 관리 |
| version 없는 push만 지원 | 별도 best-effort 모드로 제공. 원래 version 없음 상태를 유지하고, 새 입력·문서 닫기·세션 변경 시 제거. 상세 화면에서 오래된 결과를 완전히 판별할 수 없다는 지원 범위를 표시 |

best-effort 모드는 편집기 생태계와의 호환성을 위한 **의도적인 계약 변경**이다. 기존 versioned 서버의 검증을 약화하지 않는다. unversioned 진단을 현재 버전으로 표기하거나, debounce 이후 도착했으므로 최신이라고 가정하지 않는다. 버전 없는 결과로 Quick Fix를 직접 적용하지 않고 action을 현재 문맥에서 다시 요청·검증한다. 기능 도입 시 [성능 계약](../docs/preview-performance-contract.md)의 진단 보장과 테스트를 함께 수정해야 한다.

pull 진단도 요청 때 버전 표식을 붙였다는 이유로 서버 내부 분석의 최신성까지 보장하지 않는다. 보장할 수 있는 것은 오래된 요청 응답을 새 버퍼에 적용하지 않는 클라이언트 규칙이다. [Pull Diagnostics 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.18/language/pullDiagnostics.md)

진단 저장소는 표시용 Monaco marker와 원본 LSP Diagnostic을 나눈다. code actions에 필요한 `data`, 관련 위치, 오류 설명 링크를 원본 그대로 보존한다. 추후 보조 서버가 들어오면 `(session, provider, uri)`별 소유권과 marker owner를 나눠야 한다. 지금의 `setdown-language` 하나로 모든 서버 진단을 덮어쓰면 안 된다.

프로젝트 전체 diagnostics는 모든 파일을 editor model로 여는 방식으로 만들지 않는다. 닫힌 파일 결과는 경량 저장소에 두고, 파일을 열 때 버퍼 기준으로 재확인한다. UI는 기존 패널 안의 Problems 보기로 시작할 수 있다. 열지 않은 프로젝트 전체 분석은 사용자 요청·서버 지원·예산이 있을 때 수행한다.

## 8. 보이지 않는 기능이 실제 호환성을 결정한다

### 8.1 Dynamic registration과 refresh

서버는 initialize 응답 이후에도 `client/registerCapability`로 기능을 등록할 수 있다. feature별로 registration ID, document selector, 옵션을 보관하고 unregister 시 정확히 해제한다. main의 세션 상태와 renderer provider 상태가 같은 epoch를 보도록 한다.

모든 기능에 `dynamicRegistration: true`를 먼저 붙이지 않는다. 실제 등록·해제 경로가 있는 기능부터 광고한다. registration method는 실제 request method와 다를 수 있다. 예를 들어 semantic tokens의 등록은 `textDocument/semanticTokens`이고 full/range/delta 중 하나가 아니다. 명세의 RegistrationType을 기준으로 한다.

`workspace/*/refresh`는 **요청**이므로 응답이 필요하다. 단순 알림처럼 처리하지 않는다. 응답 후 재계산을 합치고, 사용자에게 안 보이는 모델까지 한꺼번에 계산하지 않는다. 공식 클라이언트의 [features.ts](../vendor/vscode-languageserver-node/client/src/common/features.ts), [semanticTokens.ts](../vendor/vscode-languageserver-node/client/src/common/semanticTokens.ts), [diagnostic.ts](../vendor/vscode-languageserver-node/client/src/common/diagnostic.ts)가 비교 대상이다.

### 8.2 파일 감시와 설정

현재 watcher는 프로필의 확장자·파일명만 보고 변경을 전달한다. 서버가 요청한 glob, RelativePattern, create/change/delete 종류를 등록·해제하는 기능은 없다. 파일 감시는 `(창, root)` 아래에서 공유하고 subscription별 필터를 적용하는 방향이 낫다. 같은 root에 서버가 늘 때 root 전체 watcher가 그대로 늘어서는 안 된다.

제외 디렉터리 정책과 서버 요청 범위가 충돌할 수 있다. 무조건 node_modules 전체를 다시 감시하는 식으로 고치지 않는다. 실제 설정 파일이나 특정 외부 dependency에 대한 한정된 감시는 별도로 허용하되, 대량 glob·root 밖 경로에는 수명과 개수 예산을 둔다. 구현 전까지 해당 지원을 광고하지 않는다.

configuration은 현재 사용자 단위다. 프로젝트별 옵션이 필요하면 `scopeUri`와 root를 기준으로 **사용자 설정 → 프로젝트 설정 → 언어/서버 설정**의 명시적 합성 규칙을 만든다. 프로젝트 파일이 실행 파일·임의 command 권한까지 자동으로 바꾸지 않게 한다. 서버 launch/initializationOptions 변경은 restart, 런타임 settings 변경은 didChangeConfiguration으로 분리할 수 있다.

### 8.3 progress, 로그, 오류

현재는 stderr 마지막 8 KiB를 실패 메시지에 붙이지만 `window/logMessage`, `$/logTrace`, `$/progress`는 사용자에게 전달하지 않는다. 긴 인덱싱이 ‘멈춤’처럼 보이고, 어떤 요청이 실패했는지 찾기 어렵다.

Language Support 세션 상세에 bounded log와 현재 progress를 둔다. progress begin/report/end, 서버가 만든 token, request의 workDone token, partial result token은 각각의 역할과 수명을 구분한다. 취소 버튼은 해당 작업만 취소한다. 로그에 전체 문서나 환경 변수를 기본 저장하지 않는다. trace는 필요할 때만 켜고 상한을 둔다.

`window/showMessageRequest`는 선택이 필요한 경우에만 기존 UI에 표시하고, 닫거나 창이 사라지면 null로 응답한다. 일반 메시지는 기록하고 중요도에 맞춰 표시한다. 반복 메시지가 편집을 가리는 모달을 계속 만들면 안 된다. `window/showDocument`는 검증된 URI에 대해 소유 창에서 처리하고 결과를 반환한다.

이 작업이 elan 다운로드 문제를 자동으로 해결하는 것은 아니다. `lake serve` 이전 launcher 다운로드는 LSP progress가 오기 전일 수 있다. 시작 준비 상태와 initialize timeout을 별도로 설계하고, 제한 없는 timeout 연장으로 숨기지 않는다. 설치·toolchain 준비를 Setdown이 몰래 대신하는 계획도 아니다.

### 8.4 저장 전 작업

Format on Save를 기존 `didSave` 뒤에 붙이면 저장된 텍스트와 화면이 달라진다. 사용자 저장, Save All, 닫기 전 저장, 자동 저장을 다루는 공통 저장 진입점이 필요하다.

제안 순서는 저장 이유 기록 → 현재 편집 동기화 → 제한된 willSave/willSaveWaitUntil → 설정된 code actions/format → 결과 적용 및 재동기화 → 최종 snapshot 저장 → 그 snapshot으로 didSave다. 실제 서버 조합에서 순서가 충돌하면 프로필과 정책으로 결정하되 반복 루프를 만들지 않는다.

자동 정렬·source.fixAll은 기본 off, 명시적 저장의 formatting부터 검증한다. 입력이 바뀌면 오래된 저장 전 편집을 적용하지 않는다. 서버 응답 실패는 일반 저장을 무한히 막지 않아야 한다. 전체 시간 예산과 종료 정책을 둔다. Sublime LSP의 [save_command.py](../vendor/sublime-lsp/plugin/save_command.py)와 [formatting.py](../vendor/sublime-lsp/plugin/formatting.py)는 저장을 작업열로 처리한다는 참고이지, 순서를 그대로 복사하라는 뜻은 아니다.

## 9. 프로젝트 기능은 별도 UI와 파일 작업 계약이 필요하다

### 9.1 Workspace symbols, Call/Type hierarchy

프로젝트 심벌 검색은 문자열 grep과 다르다. 이름·종류·위치·컨테이너를 서버 index에서 가져온다. 검색 입력을 debounce하고 이전 요청과 partial results를 취소하며 결과 수를 제한한다. 선택 전 URI가 확정되지 않는 WorkspaceSymbol은 `workspaceSymbol/resolve`로 완성한다. 기본은 이미 실행 중인 관련 서버에 질의하고, 설치 목록의 모든 서버를 검색을 위해 시작하지 않는다.

Monaco 0.56의 공개 `languages` API에는 workspace symbol, call hierarchy, type hierarchy provider 등록점이 없다. VS Code 내부 구현이 있다는 사실과 standalone 공개 API는 다르다. 이 기능들은 Setdown의 Search 패널에 **Text / Symbols** 선택을 추가하거나, 호출한 경우에만 열리는 결과 트리를 구현해야 한다. 내부 workbench API를 가져와 연결했다고 끝내면 업그레이드 비용이 커진다.

Call hierarchy의 prepare → incoming/outgoing, type hierarchy의 prepare → super/sub 요청은 원본 item/data와 세션 handle로 이어진다. 현재 문서 URI를 강제로 붙이는 방식은 맞지 않는다. 트리는 펼친 노드만 요청하고 순환·깊이·개수 한도를 둔다. 탐색 결과는 기존 탭 열기와 source selection을 사용한다.

### 9.2 Explorer rename/move와 import 갱신

파일을 옮겼다고 텍스트 심벌 rename을 보내면 안 된다. 파일 작업용 `workspace/willRenameFiles`와 `didRenameFiles`가 따로 있다. create/delete도 will/did 쌍이다. 파일 watcher가 변경을 보았다는 사실만으로 같은 동작을 대신할 수 없다.

현재 Explorer는 main에서 파일을 먼저 변경하고 결과를 renderer에 돌려준다. 전처리 hook은 동기식이다. LSP의 will 요청은 비동기이며 편집을 돌려줄 수 있으므로, 진입점을 **계획 → 대상·버퍼 확인 → will 요청/편집 검증 → 적용·파일 작업 → 실제 결과 통지**로 확장해야 한다. UI 버튼 callback에만 연결하면 cut/paste, 드래그, 다중 이동, 디렉터리 이동이 빠진다.

기존 [ExplorerOperationResult](../apps/desktop/src/protocol/explorer.ts)는 부분 성공을 표현하고 `undoable: false`다. 파일 작업과 텍스트 편집 전체를 완전한 transaction이라고 광고하면 안 된다. 대상 충돌·읽기 전용·외부 변경을 미리 확인하고, 도중 실패하면 완료한 파일 작업과 적용한 편집을 기록해 복구 가능한 상태를 표시해야 한다. 새 요청은 진행 중인 작업을 중복 실행하지 않는다. did 알림은 실제 성공한 항목만 보낸다.

처음에는 텍스트 편집과 안전한 파일 rename 연동부터, 그 뒤 create/delete와 디렉터리·다중 작업으로 넓힌다. 서버가 반환한 resource operation은 일반 Explorer 사용자 동작과 구분해 재귀적인 will 호출을 막는다. 서버 필터와 case sensitivity를 존중한다. [공식 클라이언트 fileOperations.ts](../vendor/vscode-languageserver-node/client/src/common/fileOperations.ts)

## 10. 최대한 적용하되, 다른 제품 기능과 혼동하지 않을 것

| 항목 | 판단 |
| --- | --- |
| Inline completion | 3.18 표준, Monaco 공개 UI 있음. 실제 지원 서버가 있을 때 P5 연결. 일반 completion 결과를 임의로 AI 제안처럼 만들지 않음 |
| Linked editing | HTML 시작/끝 태그 등의 동시 편집. P2에 포함하되 IME·다중 커서·Undo 검증 필요 |
| Virtual document content | 3.18의 `workspace/textDocumentContent`와 refresh는 P5. 현재 `file:` 문서와 다른 readonly identity·수명·탭 모델 필요. 모든 서버 전용 가상 URI가 이 표준을 쓰는 것은 아님 |
| Multi-root | 현재는 창당 프로젝트 root를 기준으로 세션 분리/재시작. 여러 workspaceFolders를 편집하는 제품 기능이 생길 때 didChangeWorkspaceFolders 구현. 준비만을 위해 서버를 합치지 않음 |
| 여러 서버 병행 | Pyright + Ruff 같은 조합에 유용. primary/diagnostics/formatting 역할과 우선순위를 명시한 P5 작업. completion 중복·진단 덮어쓰기·format 경합 해결 전 자동 활성화하지 않음 |
| Notebook 동기화 | 표준이지만 cell 모델·notebook 수명·저장 구조가 선행. 현재 일반 텍스트 LSP 확장의 완료 조건에서 보류 |
| Inline values | 디버깅 중 값 표시용. 현재 debug adapter/session을 붙이는 계획은 없으므로 보류. 인레이 힌트와 다름 |
| Moniker | 저장소/인덱스 간 symbol identity. 현재 연결할 소비자가 없으므로 보류 |
| Telemetry | 서버 telemetry/event를 제품 분석 시스템으로 자동 전송할 필요 없음. 수집·전송 기능 도입하지 않음 |
| clangd 전용 기능 | source/header 전환, fileStatus는 효과가 큼. 표준 기능 후 작은 어댑터로 제안. 표준 semantic/inlay 기능이 있는 서버에 옛 확장을 중복 구현하지 않음 |
| rust-analyzer·Lean 전용 UI | expand macro, runnable, proof goal 등은 표준 기능과 분리. 특히 runnable 실행·Lean Infoview는 각각 실행 정책·전용 화면이 필요 |
| 문법 강조·언어 스니펫·주석 규칙 | 일부 completion snippet은 LSP지만 grammar·기본 언어 설정 전체는 별도. Fortran 문법 지원을 LSP 완성도에 숨기지 않음 |
| 디버거·테스트 러너·빌드·패키지 설치 | LSP 일반 지원만으로 제공되지 않음. 별도 작업 범위 |

clangd와 rust-analyzer 공식 문서도 서버 기능과 에디터 표시를 구분한다. [clangd features](https://clangd.llvm.org/features), [clangd extensions](https://clangd.llvm.org/extensions), [rust-analyzer features](https://rust-analyzer.github.io/book/features.html)

## 11. 어떤 코드를 재사용할 것인가

현재 335줄인 `language-client.ts`를 그대로 몇 배 늘리는 것도, VS Code의 모든 service를 즉시 도입하는 것도 비용이 있다. 선택 기준은 기능 개수가 아니라 **Setdown의 문서 소유권과 UI 계약을 유지하며 줄일 수 있는 코드의 양**이다.

| 선택 | 얻는 것 | 비용/판정 |
| --- | --- | --- |
| 현재 JSON-RPC + standalone Monaco 유지, 기능별 분리 | 기존 모델·Undo·Electron IPC 경계를 유지. 작은 provider는 공개 API로 연결 | 공통 capability/변환/스케줄러는 직접 관리해야 함. P0–P3 권고 |
| `monaco-languageclient` + Monaco VS Code API 서비스 | 공식 vscode-languageclient의 많은 feature 구현 재사용 | 참조 버전은 Codingame의 model/files/configuration/editor 등 service에 의존. 문서·URI·저장·Undo 통합 검증 필요. 플러그인 하나 추가하는 작업이 아님 |
| 공식 클라이언트에 자체 가짜 `vscode` shim | 기존 UI를 두면서 많은 구현을 재사용할 것처럼 보임 | workspace/events/documents/commands/files 계약까지 흉내 내는 호환 계층을 소유하게 됨. 권하지 않음 |

`monaco-languageclient` 자체는 `BaseLanguageClient`를 상속하는 얇은 연결이고, 복잡도는 의존 service와 공식 client에 있다. [참조 index.ts](../vendor/monaco-languageclient/packages/client/src/index.ts), [package.json](../vendor/monaco-languageclient/packages/client/package.json), [프로젝트 설명](https://github.com/TypeFox/monaco-languageclient)

권고는 **지금의 model/transport 경계를 유지하고, 공식 client에서 feature 단위 생명주기·변환 규칙을 배워 필요한 부분을 구현하는 것**이다. 원본 코드의 실질적인 복사·수정이 발생하면 MIT 고지와 출처를 남긴다. JSON-RPC framing, language parser, language server, semantic painter는 새로 만들지 않는다.

다만 P4 이후 프로젝트 UI·가상 문서·multi-server까지 커지기 전에 대안을 다시 측정한다. 독립 실험에서 기존 live model/Save As/Working Tree/IME를 그대로 유지할 수 있고, 번들·startup·메모리와 회귀 검사에서 수용 가능하다면 공식 client 쪽으로 이동하는 편이 더 경제적일 수 있다. 이번 조사에는 그 실험이 없으므로 ‘항상 더 무겁고 느리다’고 단정하지 않는다.

참고 구현의 역할은 다음처럼 나눈다.

- **vscode-languageserver-node**: feature 등록, capability, resolve 변환, pull diagnostics, progress, 파일 작업. 가장 직접적인 프로토콜 참고.
- **Sublime LSP**: 기존 에디터에 기능을 붙이는 구조, session/buffer/view 수명, 작업별 서버 선택, 저장 작업열, 변경 검토. [sessions.py](../vendor/sublime-lsp/plugin/core/sessions.py), [session_buffer.py](../vendor/sublime-lsp/plugin/session_buffer.py), [edit.py](../vendor/sublime-lsp/plugin/edit.py).
- **Monaco 실제 설치본**: 어떤 공개 provider·편집 동작·테마 규칙이 실제 배포 버전에서 가능한지 확인하는 기준.
- **VS Code**: UI와 workspace orchestration 참고. 내부 workbench service를 standalone 공개 API로 착각하지 않음.

## 12. 제안하는 코드 책임 경계

아래 이름은 새 파일을 이미 만들었다는 뜻이 아니라 역할별 분리안이다. 처음부터 모든 파일을 생성하지 않고 해당 기능을 넣는 단계에서 추출한다.

```text
기존 문서/Monaco 모델
  ├─ LanguageClient: 모델 연결, 동기화, version/generation, 수명
  ├─ features/: Monaco provider와 기능별 결과 변환
  └─ WorkspaceEditCoordinator: 버전 검증, 대상 준비, Undo 가능한 텍스트 편집
             │ typed IPC / 세션·문서·결과 handle
  LanguageManager: 창/문서/세션 권한, 요청 경로, 설정
  ├─ SessionFeatures: 정적/동적 capability, refresh, progress
  ├─ Command/Result broker: 원본 item, command, edit 제안의 출처와 수명
  └─ FileOperation coordinator: Explorer·저장·파일 작업 연동
             │
  ServerSession: 프로세스, JSON-RPC, 취소, 초기화, 종료
```

중요한 경계는 다음 다섯 가지다.

1. **요청 종류를 구분한다.** 문서 요청은 기존 id/version을 사용한다. item resolve·hierarchy는 원본 item handle을 사용한다. workspace 요청은 main이 발급한 해당 창의 session handle을 사용한다. renderer의 임의 method/URI 전달 창구로 넓히지 않는다.
2. **기능 정의와 권한 검증을 분리한다.** 한 feature 정의에서 client capability·server capability 해석·provider·refresh method·UI label을 관리하되, main의 입력 검증은 유지한다. 실제 설치·사용 가능한 feature에서 capability와 상세 UI를 산출한다.
3. **리소스는 소유자가 해제한다.** provider, watcher registration, item/command handle, resultId, progress token, diagnostic cache는 epoch·닫기·restart에서 해제한다. WeakMap만으로 renderer 밖 pending operation까지 정리되지는 않는다.
4. **편집 정책은 별도다.** 서버가 같은 언어라고 외부 파일 편집 권한을 얻는 것은 아니다. 반대로 외부 dependency 정의를 읽는 탐색까지 막을 필요도 없다. 읽기 대상과 수정 대상을 나누고 canonical path·symlink·대상 창을 main에서 확인한다.
5. **동시에 하는 일의 양을 제한한다.** 사용자 입력에 필요한 completion/hover를 먼저 처리하고, 보이는 범위의 hint/token, 뒤이어 background diagnostics를 처리한다. 취소된 RPC가 실제로 끝날 때까지 세는 기존 in-flight 제한을 유지하며, background refresh 폭주가 64개 제한으로 서버를 죽이지 않도록 요청 전에 합치고 제한한다.

LSP 서버는 현재 사용자 권한의 native process다. 위 편집·command 검증이 서버 프로세스 자체를 sandbox로 만드는 것은 아니다. 이번 기능 확장을 설치 파일 진위 검증이나 sandbox 구현으로 설명해서는 안 된다.

## 13. 구현 단계와 완료 조건

비용 표기는 기존 구조 대비 상대값이다. S는 기존 provider 변환 중심, M은 상태/캐시·여러 경로 연동, L은 편집·파일·새 UI의 통합을 뜻한다. 정확한 일정은 실제 서버 검증 이후 산정한다.

| 단계 | 구현 단위 | 비용 | 완료 조건 |
| --- | --- | --- | --- |
| **P0 기반** | 7개 provider를 점진적으로 분리, 공통 feature metadata, 문서/item/workspace 요청 구분, 구조화 오류, 세션 event/request 통로, bounded log/progress | M | 기존 기능 회귀 없음. 미지원 capability 광고 없음. 다른 창/epoch/handle 접근 거절. sidebar에서 준비/분석/실패 구분 |
| **P1 읽기·탐색** | Semantic Tokens full/range/delta/refresh와 theme, 선언/타입/구현, document highlight, selection/folding, links, 기본 inlay hints·색상 칩 | M | 실제 C++/Rust에서 토큰 적용과 테마 확인. 서버 미지원 시 syntax 유지. stale·닫기·restart·숨김 refresh 정리 |
| **P2 수정** | 공통 text edit 검증, Code Actions/resolve, 서버 command/applyEdit 제한 경로, document/range formatting, linked editing, color presentation, hint edits, CodeLens | L | unsaved·Undo·CRLF/Unicode·미열린 대상·typing race 검증. 지원 못 하는 command/resource edit를 실행 가능한 것으로 표시하지 않음 |
| **P3 호환성** | 필요한 기능의 dynamic register/unregister, pull diagnostics/refresh, unversioned 정책, 진단 원본 보존, server watcher, scope 설정, 저장 전 작업·on-type format | L | fortls 진단 정책이 명확하고 실제 검증됨. static/dynamic 서버 모두 동작. 서버 지연에도 입력·저장 가능. 저장 snapshot 일치 |
| **P4 프로젝트** | workspace symbols/resolve와 partial results, call/type hierarchy, Problems 보기, Explorer will/did 파일 작업, 필요한 resource edit | L | 검색이 전체 서버 실행을 유발하지 않음. 실제 파일 이동/import 갱신, 취소·부분 실패·dirty 대상·자동 저장 경합 검증 |
| **P5 선택 확장** | 역할별 보조 서버, 3.18 inline completion/가상 문서, 선별된 clangd/rust-analyzer 확장 | L/기능별 | primary/formatter/diagnostics 충돌 없음. virtual URI readonly 수명. 지원 서버·버전·제약 기록 |

P0에서 동적 등록·refresh를 전달할 통로를 먼저 마련한다. P1은 구현한 feature의 정적 capability부터 연결할 수 있고, P3에서 watcher·diagnostics·동기화까지 등록 범위를 넓힌다. P3 pull을 제공하려면 필요한 diagnostic dynamic registration도 같은 배포에 들어가야 한다. 단계는 코드를 나누는 단위이며 누락된 선행 조건을 건너뛰는 허가가 아니다.

첫 구현 묶음은 **P0의 최소 경계 + P1**이 적합하다. 이후 P2의 편집 중심부를 완성하면 Code Actions, formatting, 자동 import, hint edit가 같은 경로로 확장된다. 새 서버 하나를 등록할 때 이 경로들을 다시 작성하지 않는 것이 성공 기준이다.

## 14. 검증 계획

### 14.1 Fake server는 프로토콜 변형, 실제 서버는 사용 경험을 검증한다

mock 응답만으로 ‘지원 완료’라고 하지 않는다. 반대로 실제 서버 하나가 우연히 모든 응답을 잘 주었다고 모든 합법적인 응답 형태가 검증되는 것도 아니다.

| 검증 층 | 필수 사례 |
| --- | --- |
| 변환/단위 | UTF-16·emoji·CRLF, LocationLink, completion defaults·resolve, token legend/delta 오류, zero-length insert 순서, 잘못된 range, annotation |
| fixture LSP | static/dynamic 등록·해제, range-only/full-only tokens, delta 실패 복구, refresh 폭주, partial results, versionless push, full/unchanged pull, showMessageRequest, command→applyEdit, 무응답·취소·종료 |
| 소유권/데이터 보호 | 타 창 id, 이전 epoch의 item handle, 경로 위조, symlink, 외부 편집 대상, mutable/immutable review, 더 늦은 입력, 여러 모델의 revision 변경, 재시작 중 resolve |
| 실제 Electron | 메뉴·전구·색상 픽셀/토큰 표시·inlay 배치·접기·선택·rename/Undo·format/Undo·모든 테마·확대·IME·분할 창·native preview focus |
| 파일/저장 | Save As, Save All, 자동 저장 중 수정, 미열린 대상, 파일 이동 실패/부분 성공, 닫기 취소, 서버 미응답에도 일반 저장 유지 |

실제 서버 역할은 분담한다.

- **clangd**: semantic tokens, fixes, formatting, 타입·구현 탐색, C++ 프로젝트 설정. compile_commands와 실제 include 경로를 사용한다.
- **rust-analyzer**: token delta, inlay hints, assists, 복합 workspace edit. toolchain과 설정을 고정한다.
- **Pyright**: 기존 Python 기능 회귀, 선언/타입 이동, workspace symbols, code actions 등 실제 광고된 기능. Pylance와 동일하다고 가정하지 않는다. 현재 공식 소스는 별도의 capability/동적 기능 구성을 사용한다. [Pyright languageServerBase.ts](https://raw.githubusercontent.com/microsoft/pyright/main/packages/pyright-internal/src/languageServerBase.ts)
- **fortls**: versionless 진단, completion/hover와 추가 탐색. semantic tokens 미지원 상태가 정상적으로 표현되는지 확인한다.
- **HTML/CSS/JSON 또는 TS 서버**: linked editing, document colors/links, formatting, 파일 rename 연동 중 해당 서버가 지원하는 것을 실제 검증한다. package bin을 흉내 낸 fixture 연결을 실제 upstream 서버 검증으로 세지 않는다.

최초 연결 시 initialize 결과와 활성 등록 목록을 테스트 artifact로 저장해 기대 capability를 명시한다. 기능을 필수 검증으로 지정한 테스트 서버가 없으면 skip으로 성공 처리하지 않고 준비 미완료로 보고한다.

### 14.2 성능과 UI 계약

테마·편집 모델·저장·source/reader 경로가 바뀌는 단계에서는 [preview performance contract](../docs/preview-performance-contract.md)에 따라 전체 `npm run test:preview-contract`를 실행한다. GUI는 항상 격리된 Xvfb/runtime/D-Bus에서 실행한다. preview 성능 경로 변경 시 독립 baseline과 같은 환경에서 `bench:preview`를 수행하며 ordinary/Git, 편집 유무, 준비 시간 유무, first/second/warm을 나누어 보고한다.

LSP 자체에는 별도 측정도 필요하다. completion/hover 지연, 입력 지연, main/renderer RSS, 서버별 RSS, 토큰·진단 cache 크기, pending RPC 수, watcher 수, 종료 뒤 잔존 process를 기록한다. 작은 기존 테스트를 대형 repository 인덱싱 성능 보장으로 확대해석하지 않는다. 새 허용치는 먼저 baseline을 측정한 뒤 정하고, 실패했다고 사후에 늘리지 않는다.

숨긴 탭은 문서가 열려 있는 한 필요한 동기화는 유지하되, 화면 전용 계산은 뒤로 미룬다. 버퍼를 서버에서 닫아 메모리를 줄이는 정책은 semantic token 구현에 섞지 않는다. Markdown/PDF/web만 쓰는 경우 새로운 LSP 시작·토큰 계산·프로젝트 스캔이 없어야 한다.

## 15. 제품에서 보여줄 지원 정보

서버 카드에 ‘설치됨’만 표시하면 이번 문제를 반복한다. 현재 네 그룹은 유지하고 상세 화면에 해당 세션의 기능 상태를 짧게 표시한다.

| 표시 | 의미 |
| --- | --- |
| 사용 가능 | 서버가 제공하고 Setdown이 구현했으며 현재 문서에서 활성화됨 |
| 표시 꺼짐 | inlay hints/CodeLens처럼 사용자 설정으로 비활성화 |
| 서버 미지원 | 해당 세션에서 capability를 제공하지 않음 |
| Setdown 미지원 | 서버는 제공하지만 아직 연결하지 않은 기능 |
| 제한 지원 | 예: version 없는 push 진단, 파일별 Undo, text-only workspace edit |
| 확인 전 | 세션이 시작되지 않았거나, 클라이언트가 기능을 협상하지 않아 지원 여부를 판정할 수 없음 |

서버가 capability를 보내지 않았다는 것만으로 프로그램 자체에 기능이 없다고 단정하지 않는다. 클라이언트의 선언에 따라 기능을 숨기거나 나중에 등록하는 서버도 있다. 이 표의 ‘미지원’은 현재 세션에서 확인 가능한 범위에 한정한다.

이 표를 기본 목록 모든 행에 길게 넣지 않는다. 언어 로고·설치 상태는 그대로 두고, 상세의 Features/Logs에서 확인하게 한다. negotiated 상태는 서버별로 고정된 marketing 목록이 아니라 실제 세션에서 계산한다. 진단 관련 원시 로그나 자동 탐지 경로를 일반 사용 흐름에 쏟아내지 않는다.

## 16. 참조 기준과 한계

| 참조 | 조사한 고정 revision | 용도 |
| --- | --- | --- |
| Setdown | `34ef4df5c85e436baa62bf6641122d005fa7fcf2` | 현재 동작 판정 |
| vscode-languageserver-node | `b8c8db0b6a5c1a257d224cda3f0c21ce0a8a3203` | 95개 메시지 기준, feature 구현·변환 |
| monaco-languageclient | `c52125a809e5993509d53f10f5b478c989b18f5d` | 공식 client 재사용 비용 |
| Sublime LSP | `c65e2bc62882d876ec55035185ce63c51963f4ef` | editor 통합, 수명, 저장·편집 흐름 |
| VS Code | `d3d31f62268b169a2dfab62ffb2d7d38158a5b7c` | workbench/API 비교 |
| Monaco 참조 저장소 | `fdf1ee75a63b85433a591db4e1184022cad8483b` | 참고 checkout. 실제 API 판단은 설치된 0.56.0의 monaco.d.ts와 구현 기준 |

온라인 공식 문서는 조사 날짜의 내용이다. 웹 spec 페이지가 본문 대신 목차만 반환한 경우에는 공식 저장소의 해당 3.18 Markdown 원문과 고정된 메타모델·타입을 확인했다. 서버 지원 여부는 실행 시 capability가 최종 기준이다. 설치본 fortls의 source 확인은 해당 로컬 버전의 관찰이며 모든 배포 버전에 대한 보장이 아니다.

보고서 작성 과정에서는 제품 코드·의존성·사용자 설정을 바꾸지 않았다. 빌드·GUI·benchmark도 다시 실행하지 않았다. 아래 전수 목록의 method 집합과 참조 링크는 문서 검증 대상으로 확인한다.

## 부록 A. 표준 method 95개 전수 목록

`C→S`는 Setdown에서 서버로, `S→C`는 서버에서 Setdown으로 가는 메시지다. `구현`도 모든 선택 옵션이 완성됐다는 뜻은 아니다. `제한`은 중요한 일부만 처리함, `거절`은 의도적으로 실패 응답함, `미지원`은 현재 제품 경로가 없음이다. 단계 번호는 13절과 같다. `보류`에는 10절의 제품 선행 조건이 필요하다.

### A.1 요청 69개

| # | Method | 방향 | 현재 | 적용 계획 |
| --- | --- | --- | --- | --- |
| 1 | `textDocument/implementation` | C→S | 미지원 | P1 · 구현 위치 이동 |
| 2 | `textDocument/typeDefinition` | C→S | 미지원 | P1 · 타입 정의 이동 |
| 3 | `workspace/workspaceFolders` | S→C | 제한 | 현재 고정 root 하나 반환; multi-root 제품 도입 시 확장 |
| 4 | `workspace/configuration` | S→C | 제한 | section 처리; P3 scopeUri별 설정 |
| 5 | `textDocument/documentColor` | C→S | 미지원 | P1 · 색상 칩 |
| 6 | `textDocument/colorPresentation` | C→S | 미지원 | P2 · 검증된 색상 변경 text edit |
| 7 | `textDocument/foldingRange` | C→S | 미지원 | P1 · 서버 기반 접기 |
| 8 | `workspace/foldingRange/refresh` | S→C | 미지원 | P1/P3 · 3.18 접기 무효화 |
| 9 | `textDocument/declaration` | C→S | 미지원 | P1 · 선언 이동 |
| 10 | `textDocument/selectionRange` | C→S | 미지원 | P1 · 구조적 선택 확대 |
| 11 | `window/workDoneProgress/create` | S→C | 미지원 | P0 · 서버 progress token 등록 |
| 12 | `textDocument/prepareCallHierarchy` | C→S | 미지원 | P4 · 호출 계층 시작 |
| 13 | `callHierarchy/incomingCalls` | C→S | 미지원 | P4 · 호출자, 세션 귀속 item |
| 14 | `callHierarchy/outgoingCalls` | C→S | 미지원 | P4 · 피호출자, 세션 귀속 item |
| 15 | `textDocument/semanticTokens/full` | C→S | 미지원 | P1 · legend와 전체 token |
| 16 | `textDocument/semanticTokens/full/delta` | C→S | 미지원 | P1 · resultId·배열 delta |
| 17 | `textDocument/semanticTokens/range` | C→S | 미지원 | P1 · 범위 token, range-only 서버 |
| 18 | `workspace/semanticTokens/refresh` | S→C | 미지원 | P1 · 응답 후 세션별 무효화 |
| 19 | `window/showDocument` | S→C | 미지원 | P3 · URI 검증·소유 창·선택/focus 정책 |
| 20 | `textDocument/linkedEditingRange` | C→S | 미지원 | P2 · 태그 등 연동 편집 |
| 21 | `workspace/willCreateFiles` | C→S | 미지원 | P4 · 파일 생성 전 편집 제안 |
| 22 | `workspace/willRenameFiles` | C→S | 미지원 | P4 · 파일/폴더 이동 전 참조 갱신 |
| 23 | `workspace/willDeleteFiles` | C→S | 미지원 | P4 · 삭제 전 편집 제안 |
| 24 | `textDocument/moniker` | C→S | 미지원 | 보류 · 외부 symbol index 소비자 없음 |
| 25 | `textDocument/prepareTypeHierarchy` | C→S | 미지원 | P4 · 타입 계층 시작 |
| 26 | `typeHierarchy/supertypes` | C→S | 미지원 | P4 · 상위 타입 |
| 27 | `typeHierarchy/subtypes` | C→S | 미지원 | P4 · 하위 타입 |
| 28 | `textDocument/inlineValue` | C→S | 미지원 | 보류 · debugger context 필요 |
| 29 | `workspace/inlineValue/refresh` | S→C | 미지원 | 보류 · inline value 도입과 함께 |
| 30 | `textDocument/inlayHint` | C→S | 미지원 | P1 · 범위 힌트; P2 편집/command |
| 31 | `inlayHint/resolve` | C→S | 미지원 | P1 tooltip/location; P2 edit/command |
| 32 | `workspace/inlayHint/refresh` | S→C | 미지원 | P1 · 보이는 범위 무효화 |
| 33 | `textDocument/diagnostic` | C→S | 미지원 | P3 · pull full/unchanged/resultId |
| 34 | `workspace/diagnostic` | C→S | 미지원 | P3/P4 · 닫힌 문서·background 예산 |
| 35 | `workspace/diagnostic/refresh` | S→C | 미지원 | P3 · pull 상태 무효화 |
| 36 | `textDocument/inlineCompletion` | C→S | 미지원 | P5 · 3.18, 실제 지원 서버 조건 |
| 37 | `workspace/textDocumentContent` | C→S | 미지원 | P5 · 3.18 가상 문서 읽기 |
| 38 | `workspace/textDocumentContent/refresh` | S→C | 미지원 | P5 · 가상 문서 수명/갱신 |
| 39 | `client/registerCapability` | S→C | 미지원 | P0 통로; 구현한 feature부터 P1–P3 순차 광고 |
| 40 | `client/unregisterCapability` | S→C | 미지원 | P0 통로; 등록 ID별 provider/watcher 해제 |
| 41 | `initialize` | C→S | 제한 | 현재 UTF-16·7개 기능 중심; P0 feature별 capability 구성 |
| 42 | `shutdown` | C→S | 구현 | bounded shutdown 유지 |
| 43 | `window/showMessageRequest` | S→C | 미지원 | P3 · 사용자 선택 또는 null 응답 |
| 44 | `textDocument/willSaveWaitUntil` | C→S | 미지원 | P3 · 시간 제한·버전 검증·저장 전 edits |
| 45 | `textDocument/completion` | C→S | 제한 | 기본·snippet·edit 지원; P0/P2 defaults/세부 필드·command |
| 46 | `completionItem/resolve` | C→S | 제한 | 현재 출처·버전 확인; P0/P2 공통 item handle 및 편집 정책 |
| 47 | `textDocument/hover` | C→S | 구현 | 현재 안전한 Markdown; URI/가상 문서 정책은 별도 |
| 48 | `textDocument/signatureHelp` | C→S | 제한 | P1 · context·signature별 activeParameter |
| 49 | `textDocument/definition` | C→S | 제한 | 현재 file URI; P1 공통 location 변환, P5 virtual URI |
| 50 | `textDocument/references` | C→S | 제한 | 현재 file URI와 최종 응답; P4 partial result |
| 51 | `textDocument/documentHighlight` | C→S | 미지원 | P1 · read/write/text 강조 |
| 52 | `textDocument/documentSymbol` | C→S | 제한 | 계층/평면 처리; P1 변환 보완, Outline은 별도 UI |
| 53 | `textDocument/codeAction` | C→S | 미지원 | P2 · 전구·quickfix·refactor·source action |
| 54 | `codeAction/resolve` | C→S | 미지원 | P2 · 원본 data·버전·편집 검증 |
| 55 | `workspace/symbol` | C→S | 미지원 | P4 · 검색·결과 제한·취소 |
| 56 | `workspaceSymbol/resolve` | C→S | 미지원 | P4 · 원본 symbol의 위치 확정 |
| 57 | `textDocument/codeLens` | C→S | 미지원 | P2 · 명시적 활성화, 실행 경로 있는 lens |
| 58 | `codeLens/resolve` | C→S | 미지원 | P2 · 지연 command 해결 |
| 59 | `workspace/codeLens/refresh` | S→C | 미지원 | P2/P3 · 렌즈 무효화 |
| 60 | `textDocument/documentLink` | C→S | 미지원 | P1 · 링크 탐색 |
| 61 | `documentLink/resolve` | C→S | 미지원 | P1 · URI 검증 후 링크 활성화 |
| 62 | `textDocument/formatting` | C→S | 미지원 | P2 · 명시적 Format Document |
| 63 | `textDocument/rangeFormatting` | C→S | 미지원 | P2 · Format Selection |
| 64 | `textDocument/rangesFormatting` | C→S | 미지원 | P2 후속 · 3.18 여러 선택 범위; 공개 API 경로 확인 후 광고 |
| 65 | `textDocument/onTypeFormatting` | C→S | 미지원 | P3 · 선택적 입력 중 정렬, IME 검증 |
| 66 | `textDocument/rename` | C→S | 제한 | 현재 text-only·200문서·파일별 Undo; P2 공통화, P4 resource edit |
| 67 | `textDocument/prepareRename` | C→S | 제한 | range/placeholder; defaultBehavior는 미광고, 필요 시 P2 |
| 68 | `workspace/executeCommand` | C→S | 미지원 | P2 · 사용자 동작·서버 출처 제한 broker |
| 69 | `workspace/applyEdit` | S→C | 거절 | 현재 applied:false; P2 text edit, P4 resource edit |

### A.2 알림 26개

| # | Method | 방향 | 현재 | 적용 계획 |
| --- | --- | --- | --- | --- |
| 1 | `workspace/didChangeWorkspaceFolders` | C→S | 미지원 | 보류 · 현재 root 변경은 restart; multi-root 도입 시 |
| 2 | `window/workDoneProgress/cancel` | C→S | 미지원 | P0 · 취소 가능한 해당 progress에 한정 |
| 3 | `workspace/didCreateFiles` | C→S | 미지원 | P4 · 실제 성공한 생성 통지 |
| 4 | `workspace/didRenameFiles` | C→S | 미지원 | P4 · 실제 성공한 이동/이름 변경 통지 |
| 5 | `workspace/didDeleteFiles` | C→S | 미지원 | P4 · 실제 성공한 삭제 통지 |
| 6 | `notebookDocument/didOpen` | C→S | 미지원 | 보류 · notebook/cell 모델 선행 |
| 7 | `notebookDocument/didChange` | C→S | 미지원 | 보류 · cell 구조·metadata·텍스트 순서 |
| 8 | `notebookDocument/didSave` | C→S | 미지원 | 보류 · notebook 저장 계약 선행 |
| 9 | `notebookDocument/didClose` | C→S | 미지원 | 보류 · notebook/cell 수명 선행 |
| 10 | `initialized` | C→S | 구현 | 현재 초기화 완료 후 통지 |
| 11 | `exit` | C→S | 구현 | 현재 shutdown 후 통지·kill deadline |
| 12 | `workspace/didChangeConfiguration` | C→S | 제한 | 현재 초기 설정 통지; 변경은 restart, P3 live settings |
| 13 | `window/showMessage` | S→C | 미지원 | P0/P3 · 상세 기록·중요도별 표시 |
| 14 | `window/logMessage` | S→C | 미지원 | P0 · stderr와 별도 bounded log |
| 15 | `telemetry/event` | S→C | 미지원 | 보류 · 수집/외부 전송 불필요 |
| 16 | `textDocument/didOpen` | C→S | 구현 | 현재 saved live file, openClose 옵션; untitled는 별도 확장 |
| 17 | `textDocument/didChange` | C→S | 구현 | None/Full/Incremental, UTF-16, 순서·버전 유지 |
| 18 | `textDocument/didClose` | C→S | 구현 | 현재 문서/세션 수명과 연동 |
| 19 | `textDocument/didSave` | C→S | 구현 | 현재 save/includeText·실제 저장 snapshot |
| 20 | `textDocument/willSave` | C→S | 미지원 | P3 · 실제 저장 이유와 전처리 |
| 21 | `workspace/didChangeWatchedFiles` | C→S | 제한 | 현재 profile 고정 필터; P3 동적 glob/RelativePattern |
| 22 | `textDocument/publishDiagnostics` | S→C | 제한 | 현재 version 일치만; P3 unversioned 정책·정보 보존 |
| 23 | `$/setTrace` | C→S | 미지원 | P0 · 진단 목적 opt-in |
| 24 | `$/logTrace` | S→C | 미지원 | P0 · opt-in, bounded 기록 |
| 25 | `$/cancelRequest` | 양방향 | 구현 | JSON-RPC cancellation 사용; P0 이후 새 요청 종류도 소유권 검증 |
| 26 | `$/progress` | 양방향 | 미지원 | RPC 라이브러리와 별개로 앱 처리 없음; P0 workDone, P4 partial results |

이 목록은 위 고정 메타모델의 requests/notifications method 집합과 일대일로 대조했다. 비표준 서버 method는 이 표에 섞지 않았다. 옵션·응답 variant까지 포함한 구현 완료 판정은 각 단계의 capability 및 실제 서버 검증을 따른다.
