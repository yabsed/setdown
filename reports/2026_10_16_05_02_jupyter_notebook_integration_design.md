# Setdown의 Jupyter Notebook 편집 지원 설계

작성일: 2026년 10월 16일

분석 기준: Setdown HEAD `1f37fa1b3d3520d6cd918777248c9f5d9ce69344`와 로컬 작업 트리, 아래에 고정한 서브모듈

범위: `.ipynb` 읽기와 편집, 기존 Markdown·Python·LSP 재사용, 저장과 출력 보존, 이후 커널 실행으로 확장하는 구조

**Setdown에는 노트북의 구성 요소를 편집할 기반이 이미 있다. 새로 필요한 핵심은 Markdown 렌더러나 Python 에디터가 아니라, 셀들을 하나의 저장 가능한 문서로 관리하는 계층이다.** 기존 Monaco, Crossnote 렌더링, 언어 서버 관리, 탭과 파일 저장 기반을 재사용하고, 그 사이에 Notebook 문서 모델·파일 코덱·셀 좌표 변환을 추가하는 방향을 권한다.

첫 제품 목표는 **Python이나 Jupyter를 설치하지 않아도 `.ipynb`를 열고, Markdown과 코드 셀을 편집하고, 저장된 출력을 읽고, 정보 손실 없이 다시 저장하는 것**이다. Python 코드 셀에는 번들된 Pyright를 연결하되, 앞 셀의 정의를 뒤 셀에서 이해하도록 연결해야 한다. 커널 실행은 별도의 후속 기능으로 설계한다. 편집과 LSP가 커널 시작을 기다리게 해서는 안 된다.

JupyterLab 전체 화면을 Setdown 안에 넣거나 VS Code Jupyter 확장을 그대로 실행하는 방식은 권하지 않는다. Setdown의 문서 경험을 유지하면서 기존 자산을 활용하려면, UI와 문서 소유권은 Setdown에 두고 Jupyter의 형식·통신 규약과 필요한 라이브러리를 사용하는 편이 적합하다.

## 1. 사용자가 얻게 될 동작

`.ipynb`를 Explorer에서 열면 기존 탭 안에 셀들이 이어지는 문서가 나타난다. Markdown은 Setdown의 읽기 스타일로, Python은 기존 코드 에디터의 색상과 입력 방식으로 표시한다. 이미 저장된 표·그림·텍스트 출력은 해당 코드 아래에 나타난다.

Markdown은 더블클릭해서 편집하고, Esc로 그 셀의 읽기로 돌아온다. 코드는 클릭해서 편집한다. 셀 추가·삭제·이동·종류 변경·복제는 셀 주변의 작은 도구와 우클릭 메뉴에 둔다. 저장, 저장 안 된 표시, 외부 변경 충돌, 탭 닫기, 검색은 Setdown의 기존 문법을 따른다. 노트북 전용 Activity Bar나 큰 관리 화면부터 만들 필요는 없다.

노트북 기능은 다음 네 가지로 구분해야 한다.

| 기능 | 필요한 것 | 필요하지 않은 것 |
| --- | --- | --- |
| 셀 편집과 `.ipynb` 저장 | 파일 코덱, 셀 모델, Monaco, 저장 조정 | Python 설치, 실행 중인 커널 |
| Markdown과 저장된 출력 보기 | Markdown 렌더링, MIME별 출력 표시 | 코드를 다시 실행하는 것 |
| Python 자동완성·정의 이동·진단 | Pyright, 셀을 연결한 분석 문서, 좌표 변환 | 실행 결과나 커널 변수 |
| 셀 실행·중단·재시작 | Jupyter 커널 연결과 실행 상태 관리 | LSP가 실행 엔진 역할을 하는 것 |

예를 들어 저장된 `DataFrame` 표는 커널 없이 읽을 수 있다. 반면 실행 중에만 존재하는 변수의 실제 값이나 동적 속성은 정적 분석 결과와 다르다. LSP 지원을 완료해도 Jupyter 실행을 구현한 것은 아니다.

## 2. 현재 Setdown에서 재사용할 수 있는 것과 바꿔야 하는 것

### 현재 `.ipynb`가 열리는 경로

[document-profile.ts](../apps/desktop/src/core/document/document-profile.ts)는 Markdown·PDF·이미지·동영상 이외의 파일을 일반 텍스트로 분류한다. 따라서 `.ipynb`는 현재 셀 문서가 아니라 JSON 문자열을 편집하는 경로로 들어간다. 언어 카탈로그에는 `.ipynb`가 JSON 언어의 확장자로도 등록되어 있다. 이는 노트북 셀에 Python LSP가 붙는다는 뜻이 아니다.

[DocumentManager.read](../apps/desktop/src/main/documents/document-manager.ts)는 일반 텍스트를 [readTextFile](../apps/desktop/src/main/documents/text-file.ts)로 읽는다. [text-codec.ts](../apps/desktop/src/core/document/text-codec.ts)의 일반 텍스트 한도는 16 MiB다. 출력 이미지가 큰 노트북은 코드가 몇 줄 안 되어도 이 한도를 넘을 수 있다. 노트북 경로를 추가할 때에는 파일 전체 크기, 셀 source 총량, 출력 크기를 구분해야 한다.

### 재사용 지도

| 기존 구성 | 가져올 부분 | 그대로 적용할 수 없는 부분 |
| --- | --- | --- |
| [MonacoEditorAdapter](../apps/desktop/src/renderer/adapters/monaco-editor.ts) | 로딩, 테마, 언어 등록, 편집 옵션, 기존 언어 기능의 연결 방식 | 현재 `ensureModel`은 탭 하나에 파일 모델 하나를 만들고 파일 경로로 언어를 결정한다 |
| [DocumentModelOwner](../apps/desktop/src/renderer/editor/live-document-model.ts) | 문서가 모델을 소유하고 화면은 빌려 쓰는 수명 관리 | 셀을 화면에서 숨겼다고 텍스트 모델과 Undo를 없애면 안 된다. path 대신 notebook ID와 cell ID가 필요하다 |
| [LanguageClient](../apps/desktop/src/renderer/editor/language-client.ts)와 [LanguageFeatureContext](../apps/desktop/src/renderer/editor/language-feature-context.ts) | Monaco provider, 취소, 버전 검증, 진단·완성·탐색·편집 기능 | Binding은 현재 `DocumentTab`과 실제 파일 경로에 묶여 있다. 요청과 결과의 셀 좌표 변환이 없다 |
| [LanguageManager](../apps/desktop/src/main/language/language-manager.ts) | 서버 검색, 프로세스 관리, root 선택, 창 소유권, 명령 허용 범위 | `open`은 열린 실제 파일을 검증하고, `applyEdit`은 workspace 내부 `file:` URI를 검증한다. 이를 무조건 완화해서는 안 된다 |
| [PreviewRenderer](../apps/desktop/src/main/preview/preview-renderer.ts), [render-worker](../apps/desktop/src/main/preview/render-worker.ts) | utility process에서 Crossnote 실행, 테마·수식 캐시, source anchor, HTML fragment 생성 기반 | 현재 요청·캐시·source 위치는 문서 단위다. 셀 키와 셀별 revision, attachment 해석이 필요하다 |
| [DocumentManager](../apps/desktop/src/main/documents/document-manager.ts), [file-system.ts](../apps/desktop/src/main/documents/file-system.ts) | 파일 읽기, atomic write, 디스크 변경 확인, 저장 대화상자 | 현재 저장 payload는 문자열이다. 셀 편집마다 JSON 전체 문자열을 만들어 전달하는 방식은 피해야 한다 |
| [DocumentActions](../apps/desktop/src/renderer/workspace/document-actions.ts), [AutoSaveController](../apps/desktop/src/renderer/workspace/auto-save.ts) | 저장 직렬화, 저장 중 새 수정 보존, Save All과 종료 흐름 | 현재 `document.kind !== undefined`이면 저장하지 않는다. `kind: 'notebook'`만 추가하면 편집한 내용이 저장 대상에서 빠진다 |
| [WorkspaceState](../apps/desktop/src/core/workspace/workspace-state.ts), [TabController](../apps/desktop/src/renderer/workspace/tab-controller.ts) | 탭, split, 제목·dirty 표시, 닫기와 이동 | `DocumentTab`은 `text`, `savedText`, 전체 문서 revision에 의존한다. 노트북 전용 content와 view state를 표현해야 한다 |

특히 [document-state.ts](../apps/desktop/src/core/document/document-state.ts)의 `applyTextRevision`, `isDirty`, `hasUnsavedText`도 `kind`가 있는 문서를 일반 편집 대상에서 제외한다. 확장자와 Svelte 화면을 추가하는 것만으로 끝낼 수 없는 이유다.

또 하나의 이름상 함정이 있다. 현재 render worker의 `Notebook.init`은 **Crossnote의 Markdown 작업 공간 객체**다. 이것은 Jupyter `.ipynb` 문서 모델이 아니다. 렌더링 기반은 재사용하지만 노트북 파일·셀 구조는 별도로 관리해야 한다.

## 3. 서브모듈에서 확인한 설계와 적용 범위

다음 revision은 저장소에 실제 체크아웃된 값이다. 참조 코드의 버전과 Setdown이 실행하는 npm 패키지의 버전은 구별한다.

| 서브모듈 | revision | 읽은 핵심 자료와 가져올 판단 |
| --- | --- | --- |
| `vscode` | `d3d31f62268b169a2dfab62ffb2d7d38158a5b7c` | [ipynb serializer](../vendor/vscode/extensions/ipynb/src/notebookSerializer.ts), [serializer helpers](../vendor/vscode/extensions/ipynb/src/serializers.ts), [NotebookTextModel](../vendor/vscode/src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts), [NotebookCellTextModel](../vendor/vscode/src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts): 파일 형식, 문서 모델, 셀 텍스트, 실행을 분리한다 |
| `vscode-jupyter` | `29e57a1eec77bc66c287321d3b1c41459d4458ed` | [CellExecutionQueue](../vendor/vscode-jupyter/src/kernels/execution/cellExecutionQueue.ts), [CellExecutionMessageHandler](../vendor/vscode-jupyter/src/kernels/execution/cellExecutionMessageHandler.ts): 실행 순서·취소·늦게 도착한 출력은 별도 문제다 |
| `jupyterlab` | `5d3ae70270ffd602eac1be77ca24ed7a88ad518a` | [NotebookModel](../vendor/jupyterlab/packages/notebook/src/model.ts), [windowing](../vendor/jupyterlab/packages/notebook/src/windowing.ts), [NotebookAdapter](../vendor/jupyterlab/packages/notebook/src/notebooklspadapter.ts), [VirtualDocument](../vendor/jupyterlab/packages/lsp/src/virtual/document.ts), [rendermime](../vendor/jupyterlab/packages/rendermime/src/renderers.ts), [services](../vendor/jupyterlab/packages/services/README.md): 모델·가상화·분석 문서·MIME·커널 통신의 경계 |
| `jupyterlab-desktop` | `0e46b48fedc0777fa33946ffe9bc3a16ee0d74a2` | [server.ts](../vendor/jupyterlab-desktop/src/main/server.ts), [registry.ts](../vendor/jupyterlab-desktop/src/main/registry.ts): Python 환경 선택, 서버 readiness, 포트·인증·종료 소유권 |
| `nbformat` | `4346f97c9d435f41ddfe76d28758b23796fdcf5a` | [v4.5 schema](../vendor/nbformat/nbformat/v4/nbformat.v4.5.schema.json), [rwbase.py](../vendor/nbformat/nbformat/v4/rwbase.py), [nbjson.py](../vendor/nbformat/nbformat/v4/nbjson.py), [validator.py](../vendor/nbformat/nbformat/validator.py): 형식 검증, 문자열 표현, 미래 형식의 보존 |
| `vscode-languageserver-node` | `b8c8db0b6a5c1a257d224cda3f0c21ce0a8a3203` | [protocol.notebook.ts](../vendor/vscode-languageserver-node/protocol/src/common/protocol.notebook.ts), [client notebook sync](../vendor/vscode-languageserver-node/client/src/common/notebook.ts): 표준 Notebook 동기화와 셀 URI 수명 |
| `crossnote` | `4ebb174a09ca974e87e30caeb980683cf4d06d94` | [Notebook engine cache](../vendor/crossnote/src/notebook/index.ts), [HTML sanitization](../vendor/crossnote/src/markdown-engine/sanitize.ts): 기존 렌더링 재사용, 문서 경로와 엔진 캐시의 관계 |
| `monaco-editor` | `fdf1ee75a63b85433a591db4e1184022cad8483b` | standalone editor의 공개 API와 모델 소유권. VS Code workbench의 Notebook UI까지 포함하는 패키지로 취급하지 않는다 |

실제 설치된 버전은 Monaco `0.56.0`, Crossnote `0.9.35`, Pyright `1.1.414`, `vscode-languageserver-protocol` `3.18.3`이다. JupyterLab 서브모듈의 Notebook 패키지는 `4.7.0-alpha.2`, services는 `7.7.0-alpha.2`다. 참조 중인 개발 브랜치를 그대로 production 의존성으로 지정하지 않는다. 라이브러리를 도입할 때 안정 버전을 고정하고 Setdown 빌드·패키징으로 확인한다.

### VS Code에서 가져올 가장 중요한 분리

VS Code는 파일을 읽고 쓰는 `NotebookSerializer`, 실행하는 `NotebookController`, 출력 형식을 표시하는 `NotebookRenderer`를 나눈다. 실제 셀 편집 UI는 VS Code core에 있다. 따라서 `vscode-jupyter`를 가져온다고 Setdown에 Notebook 에디터가 생기는 구조가 아니다. 이 분리 자체가 Setdown의 설계 기준으로 유용하다. [공식 Notebook API](https://code.visualstudio.com/api/extension-guides/notebook)

Setdown에는 각각 `NotebookCodec`, `NotebookExecutionService`, `NotebookOutputRegistry`에 해당하는 경계를 둔다. 이름을 그대로 복제할 필요는 없지만, 커널을 꺼도 편집·저장이 동작하는 분리는 유지한다.

VS Code의 serializer는 source를 줄 배열로 바꾸고, JSON key를 정렬하고, 일부 필드를 명시적으로 다시 구성한다. 그대로 복사하면 Setdown이 지원하지 않는 필드를 보존한다는 계약까지 자동으로 얻지는 못한다. `getNotebookMetadata`와 셀 생성 함수들이 실제로 어떤 필드를 다시 쓰는지 확인하고 자체 보존 정책을 정해야 한다.

### JupyterLab 전체 위젯을 도입하지 않는 이유

[Notebook 패키지](../vendor/jupyterlab/packages/notebook/package.json)는 CodeMirror·Lumino·Jupyter 문서 시스템·YDoc·UI 패키지 등에 의존한다. 현재 [NotebookModel](../vendor/jupyterlab/packages/notebook/src/model.ts)은 YNotebook을 소유하거나 외부 shared model을 받으며, Setdown의 Monaco 모델과는 다른 Undo·변경 이벤트 체계를 가진다.

이를 그대로 붙이는 것은 가능하지만, Monaco와 CodeMirror, Setdown과 JupyterLab 문서 소유권, 두 테마 체계를 함께 운영하게 된다. 현재 `windowing.ts`에는 전역 `IntersectionObserver`와 `ResizeObserver`를 대체하는 코드도 있다. 이 파일을 공용 shell에 import하는 선택은 기존 Markdown·PDF·브라우저의 observer 동작까지 검토해야 한다. 이는 해당 revision의 구현 사실이며 모든 버전의 JupyterLab에 대한 일반화는 아니다.

반면 문서와 셀을 나누고 화면 밖 셀의 비용을 줄이는 원칙, virtual document의 좌표 관리, services의 커널 프로토콜은 잘 분리해서 가져올 수 있다.

### 선택지 비교

| 방향 | 초기 장점 | Setdown에서 지불하는 비용 | 판단 |
| --- | --- | --- | --- |
| JupyterLab 서버와 화면 전체 내장 | 실행·위젯 등 많은 기능을 빨리 얻음 | 별도 Python 서버, 중복 Explorer·탭·설정·저장, Setdown UI와 연결 | 외부 Jupyter 열기에는 유용하나 기본 편집기로는 부적합 |
| JupyterLab Notebook 위젯만 내장 | 셀 UI와 많은 동작을 재사용 | CodeMirror·Lumino·YDoc와 기존 Monaco의 중복, 테마·수명 연결 | 비교용 spike는 가능하나 권장안 아님 |
| VS Code Jupyter 확장 직접 사용 | 풍부한 참조 구현 | VS Code extension host와 notebook workbench API가 필요 | standalone Monaco에 직접 설치하는 경로가 아님 |
| **Setdown 셀 문서와 UI, 기존 Monaco·Crossnote, 공식 Jupyter 통신** | 기존 디자인·저장·LSP를 통합 가능 | 셀 모델·구조 편집·좌표 변환은 직접 책임져야 함 | **권장** |

라이브러리 도입도 단계에 맞춰 제한한다. 편집 단계에는 기존 Monaco·Crossnote·DOMPurify를 유지하고, 원본 보존용 JSON 도구와 nbformat schema 검증에 필요한 의존성만 추가한다. `@jupyterlab/nbformat`은 타입·MIME 규약 참고 대상으로 검토하며, 전체 Notebook 위젯이나 YDoc를 함께 도입할 이유로 삼지 않는다. `@jupyterlab/services`는 실행 단계에서 lazy load한다. 서브모듈 소스는 참고 자료이며 배포 시 그 checkout을 빌드해야 하는 의존성으로 만들지 않는다. 소스·schema·fixture를 옮길 때에는 각 저장소와 해당 파일의 라이선스 및 저작권 고지를 함께 보존한다.

## 4. 파일 코덱은 UI보다 먼저 완성한다

### 읽을 수 있는 것과 안전하게 다시 쓸 수 있는 것을 구분한다

`.ipynb`는 JSON 안에 순서 있는 셀, metadata, source, 코드 출력과 실행 횟수, Markdown 첨부파일을 저장한다. source와 일부 텍스트 출력은 문자열 또는 문자열 배열로 존재할 수 있다. 배열은 빈 구분자로 합친다. `['print(', '1)']`를 `join('\n')`하면 원문을 바꾸게 된다. 셀 ID는 nbformat 4.5에서 추가되었으며 노트북 내에서 유일해야 한다. [nbformat 형식 설명](https://nbformat.readthedocs.io/en/latest/format_description.html)

권장 호환 정책은 다음과 같다.

| 입력 | 동작 |
| --- | --- |
| 정상 nbformat 4.0–4.5 | Markdown·code·raw 편집. 기존 minor version 유지 |
| ID가 없는 구형 v4 셀 | 내부용 stable ID를 만들되, 읽기만으로 파일을 4.5로 승격하거나 dirty로 만들지 않음 |
| 새 노트북 | nbformat 4.5와 유효한 cell ID를 사용 |
| 중복·불법 ID가 있는 4.5 파일 | 내부 식별자는 충돌 없이 분리. 원본을 몰래 정규화하지 않고 복구 선택 또는 JSON 보기 제공 |
| 미래 v4 minor와 모르는 셀·출력 | 해석 가능한 부분만 표시하고 미지원 부분은 원본 보존. 수정 보존을 증명할 수 없는 경우 읽기만 허용 |
| v3 또는 다른 major | 자동 변환하지 않고 JSON 보기와 별도 변환 안내 |
| 깨진 JSON·중복 key·잘못된 필수 필드 | 빈 노트북으로 대체하지 않음. 오류 위치와 원문 보기 제공 |

모르는 필드를 무조건 버리는 validator를 쓰지 않는다. 동시에 현재 버전의 잘못된 구조를 모두 정상이라고 허용하지도 않는다. [nbformat validator](../vendor/nbformat/nbformat/validator.py)는 미래 minor에 대해 추가 속성과 미지의 셀·출력을 허용하는 별도 처리를 한다. 이 구별을 따른다. TypeScript의 `@jupyterlab/nbformat` 인터페이스는 참고할 수 있지만 런타임 schema 검증의 대체재가 아니다.

### 보존 계약

편집한 셀의 source만 변경했다면, 다른 셀의 source·outputs·execution_count·attachments·metadata는 그대로 남아야 한다. notebook metadata의 `kernelspec`, `language_info`, widget state와 도구별 custom metadata도 보존 대상이다. 화면에 표시하지 못하는 MIME 데이터도 삭제하지 않는다.

열었다가 수정 없이 저장하면 원본 bytes를 그대로 사용한다. 실제 편집 저장에서는 바뀐 경로만 수정한다. JSON 전체를 매번 `JSON.parse → 새 DTO → JSON.stringify`하는 serializer를 기본으로 삼지 않는다. 이 방식은 모르는 속성, 큰 숫자의 정밀도, key 순서, 줄 배열 표현까지 바꿀 수 있다.

구현 후보는 **원본 JSON과 위치 정보를 유지하고 source·metadata·cell 배열 변경을 적용하는 코덱**이다. [jsonc-parser](https://github.com/microsoft/node-jsonc-parser)는 offset을 가진 parse tree와 변경 edit API를 제공한다. 사용한다면 production 직접 의존성으로 명시하고 comments·trailing comma를 금지하며 오류 목록을 반드시 검사한다. `.ipynb`를 JSONC로 확장하는 것은 목적이 아니다.

셀 이동은 원본 셀 조각을 재배치하고 수정된 조각만 다시 만든다. 미지원 필드의 값은 렌더링용으로 숫자에 변환했더라도 저장에서는 원래 표현을 보존한다. JSON 편집 라이브러리의 일반 object replacement만으로 이를 보장한다고 가정하지 말고, metadata 큰 정수·미지의 MIME·셀 이동 fixture로 검증한다.

새 셀은 안정된 형식으로 생성하되, 기존 파일 전체를 매번 정렬하지 않는다. 입력의 들여쓰기·문서 EOL·마지막 newline을 가능한 유지한다. 노트북 JSON의 EOL과 source 문자열 내부의 EOL은 별개다.

`metadata.trusted` 같은 저장값으로 권한을 부여하지 않는다. 새 실행의 `display_id` 등 일시 상태와 Setdown 내부 ID·선택·스크롤 상태는 일반 notebook 저장 데이터에 섞지 않는다. 원본에 있던 미지원 데이터 보존과 앱이 새 일시 데이터를 생성해서 저장하는 행동을 구분한다. [nbformat의 transient 처리](../vendor/nbformat/nbformat/v4/rwbase.py)

## 5. 문서 소유권과 저장 구조

### 하나의 Notebook 문서가 여러 셀을 소유한다

아래는 새 API를 결정하기 위한 개념 구조다. 각 항목을 그대로 별도 파일이나 클래스 하나씩 만들라는 뜻은 아니다.

```text
NotebookDocumentOwner
  notebookId, 실제 파일 경로, diskVersion
  원본 JSON과 저장 기준 revision
  cellOrder: CellId[]
  cells: Map<CellId, CellRecord>
    type, metadata, attachments, outputs
    source와 sourceRevision
    materialized Monaco model의 소유권
  구조 편집 history
  serialization cache

NotebookView
  activeCellId, selection, scroll anchor
  빌린 Monaco editor와 렌더링 결과

NotebookLanguageAdapter
  code projection, source map, projectionVersion

NotebookExecutionSession
  선택한 커널, 실행 요청, 출력 갱신, session generation
```

셀 ID는 위치가 아니다. 2번 셀을 8번으로 옮겨도 같은 셀이며, 진행 중인 렌더링·LSP 응답은 이전 배열 index가 아니라 ID와 revision으로 검증한다. 문서 ID는 세션 식별자이며 Save As 후에도 셀 소유권을 유지하고 경로 관련 캐시만 재설정할 수 있어야 한다.

현재 [DocumentModelOwner](../apps/desktop/src/renderer/editor/live-document-model.ts)의 원칙을 셀에 적용한다. Monaco 모델이 materialize된 셀의 텍스트는 그 모델에서 읽는다. snapshot 문자열은 직렬화 또는 아직 모델이 없는 셀의 보관값이다. Svelte state와 Monaco에 각각 수정 가능한 텍스트 원본을 두고 서로 덮어쓰게 만들지 않는다.

### `kind` 검사보다 편집 능력을 명시한다

노트북은 미디어처럼 `kind`가 있다는 이유로 read-only가 되어서는 안 된다. 텍스트와 노트북이 함께 사용할 작은 저장 참여 인터페이스를 도입한다.

```ts
interface EditableDocumentHandle {
  readonly id: string;
  readonly revision: number;
  isDirty(): boolean;
  prepareSave(): Promise<PreparedDocumentSave>;
  acceptSaved(receipt: DocumentSaveReceipt): void;
}
```

`PreparedDocumentSave`에는 파일 종류, 저장 대상, 캡처한 revision, 직렬화 결과를 식별할 수 있는 정보가 필요하다. 텍스트는 기존 문자열 경로를 감싼다. 노트북은 준비 시점에만 셀 문서를 JSON으로 직렬화한다. main은 창의 열린 문서 소유권과 저장 대상을 다시 확인하고 기존 atomic write·외부 변경 처리로 저장한다.

문자 입력 경로에서 JSON 전체를 생성하지 않는다. Dirty는 변경된 셀·구조·metadata·outputs와 저장 기준 상태를 비교한다. 단순히 `revision !== savedRevision`만 사용하면 Undo로 저장 상태로 돌아와도 계속 dirty가 된다. 셀별 상태 식별과 문서 구조의 저장 checkpoint를 함께 비교해야 한다.

저장 작업이 revision 20을 캡처한 후 사용자가 revision 21을 만들었으면, 20의 저장 완료가 21을 지우거나 clean으로 만들지 않아야 한다. 현재 [retainUnsavedRevision](../apps/desktop/src/core/document/document-save.ts)의 보장을 노트북 저장 receipt에도 적용한다.

### Undo는 별도 설계 항목이다

최초 편집 버전은 입력 중인 셀의 텍스트 Undo와 셀 추가·삭제·이동 등의 구조 Undo를 명확히 나눈다. 셀 편집에 focus가 있으면 Monaco Undo, 셀 선택 모드에서는 Notebook 구조 Undo다. 메뉴와 단축키도 같은 규칙을 사용한다. JupyterLab 모델 역시 문서 전체 Undo를 별도 옵션으로 다루므로, 여러 Monaco 모델이 생기면 Undo가 자동으로 문서 전체로 합쳐진다고 생각하면 안 된다.

삭제한 셀은 구조 Undo가 유효한 동안 source·metadata·outputs와 모델 history를 복구할 수 있어야 한다. 화면 가상화와 문서 삭제는 다른 수명이다. Split·merge·종류 변경은 구조 transaction 하나로 처리한다. 코드에서 Markdown으로 바꿀 때 기존 출력이 사라지는 효과도 Undo로 복원할 수 있어야 한다.

여러 셀에 걸친 rename·code action은 모든 대상과 버전을 먼저 검사하고 한 transaction으로 적용한다. 개별 셀의 Monaco Undo와 이 transaction을 조정하는 동작이 완성되기 전에는 해당 일괄 편집 기능을 노출하지 않는다. VS Code 내부 Undo 서비스를 복사하거나 Monaco의 private API에 의존하는 대신 공개 `pushStackElement`, `undo`, `redo`와 명시적인 구조 history로 먼저 검증한다.

### 원문 JSON과 다른 창

`Open as JSON`은 같은 파일을 별개의 수정 가능한 문서로 동시에 여는 기능이 되어서는 안 된다. 처음에는 같은 탭의 전용 모드 전환으로 제공한다. 전환 때 최신 셀 문서를 직렬화하고, JSON 모드에서는 셀 편집을 중지한다. 돌아올 때 parse·validation이 성공해야 모델을 교체한다. 전체 JSON을 수정한 뒤에도 셀별 Undo를 무조건 유지한다고 약속하지 않는다.

창 간 이동은 [TabTransferManager](../apps/desktop/src/main/tabs/tab-transfer-manager.ts)의 문자열 중심 payload를 확장해야 한다. 기본 편집 배포 전에 미저장 셀·순서·첨부파일·dirty 상태의 이동을 구현하거나, 노트북의 창 간 드래그를 명시적으로 비활성화해야 한다. 이동 후 빈 문서나 마지막 저장본으로 돌아가는 상태를 허용하지 않는다.

## 6. Markdown과 코드 편집을 Setdown답게 조합한다

### 셀 화면

노트북 표면은 Svelte shell 안에 둔다. 셀을 세로로 배치하고, 선택한 셀만 옅은 경계와 작은 도구를 표시한다. 코드 셀의 언어는 `.ipynb` 확장자가 아니라 notebook의 `language_info`, 확인 가능한 셀별 언어 metadata, 사용자의 선택으로 결정한다. 언어를 모를 때에도 source 편집과 보존은 가능해야 한다.

처음부터 모든 셀에 Monaco editor instance를 생성하지 않는다. 화면에 보이는 코드 셀은 구문 색상 표시를 제공하고, 편집할 셀에 실제 editor를 연결하는 방식부터 검증한다. split별 focus editor를 유지하고, 화면 밖으로 스크롤하더라도 IME 조합 중인 셀과 텍스트 선택 중인 셀을 제거하지 않는다. Monaco **모델**과 editor **화면 인스턴스**의 수명을 분리한다.

문서 검색은 화면에 mount된 셀의 DOM만 검색해서는 안 된다. 모든 source를 대상으로 cell ID와 셀 내부 범위를 찾고, 해당 셀을 화면에 가져온 다음 선택한다. 출력 검색은 source 검색과 구분해서 추가할 수 있다. Ctrl+C는 편집기 텍스트 선택을 우선하고, 셀 선택 모드의 복사는 cell payload를 별도 clipboard format으로 다루되 일반 텍스트 fallback도 제공한다.

### Markdown 재사용 경계

기존 render worker의 Crossnote 설정·수식 캐시·스타일·source anchor를 재사용하는 `renderMarkdownFragment` 경계를 추출한다. 현재 `htmlOnly` 경로는 출발점이지만, 그대로 renderer에 공개된 범용 API는 아니다. 노트북 셀용 요청과 응답을 새로 정의해야 한다.

필수 입력은 `{notebookId, cellId, sourceRevision, source, theme, baseDirectory, attachmentsVersion}`에 해당한다. main이 실제 문서에서 root와 리소스 권한을 계산한다. 임의의 경로를 renderer가 보내는 구조로 만들지 않는다. 결과가 돌아왔을 때 cell ID·revision·theme가 모두 일치해야 설치한다.

현재 Crossnote는 엔진을 파일 경로로 cache하고, render worker는 `activeRoot`·`allowedRoots`를 사용한다. 모든 셀 요청을 같은 파일 key로 병렬 실행하면 캐시·리소스 문맥을 혼동할 수 있다. 셀별 cache identity와 실제 asset base directory를 분리하고, 기존 전역 문맥이 남아 있는 동안에는 해당 worker 작업을 직렬화한다. 셀 수만큼 엔진·worker를 영구 보유하지 않도록 닫기·삭제·eviction도 설계한다.

Markdown source anchor는 `cellId + line + column`으로 확장한다. 각 셀의 1행이 같은 전역 위치로 취급되면 더블클릭 편집·검색·목차 이동이 틀어진다. heading ID와 attachment 이름도 셀 범위로 구분한다. `attachment:plot.png`는 notebook 폴더의 파일이 아니라 그 셀의 MIME bundle이다.

Crossnote의 일반 문서 확장 기능을 노트북에서 모두 자동 활성화하지 않는다. 셀 단위 Markdown에는 front matter, 파일 import, 전역 TOC, 셀 밖 reference link의 해석 차이가 있다. notebook 전용 render option으로 GFM·수식·일반 링크·첨부 이미지를 우선 맞추고, Setdown 전용 확장이 Jupyter에서 다르게 보일 수 있는 부분은 호환 fixture로 확인한다.

### 네이티브 뷰를 셀마다 만들지 않는다

기존 Markdown preview는 native `WebContentsView`다. 이를 셀마다 생성하면 셀마다 native bounds·focus·IME·zoom·수명 관리를 해야 하고 shell의 셀 UI와 겹침도 어려워진다. 이 비용은 기존 [preview 성능 계약](../docs/preview-performance-contract.md)의 보장을 훨씬 복잡하게 만든다.

초기 노트북은 정제된 Markdown fragment와 안전한 정적 출력을 shell 내부에 표시한다. 문서 스타일은 범위를 제한해서 적용한다. Shadow DOM은 CSS 격리에 도움을 주지만 보안 격리 경계가 아니다. 임의 HTML과 스크립트를 shell에 넣는 근거로 사용하지 않는다.

Crossnote의 Mermaid 등 별도 runtime을 필요로 하는 기능은 fragment HTML만 가져와도 동작한다고 약속하지 않는다. 최소 지원 범위를 먼저 정하고, 필요한 renderer를 노트북당 한 번 로드하거나 미지원 표시로 남긴다. 일반 `.md`의 렌더링 경로와 전환 성능은 그대로 유지한다.

## 7. 저장된 출력은 별도의 MIME 표시 계층으로 다룬다

출력은 Markdown 아래 붙이는 임의 HTML 문자열이 아니다. 하나의 출력이 `text/plain`, `text/html`, `image/png` 등의 여러 표현을 함께 가질 수 있다. `NotebookOutputRegistry`는 지원하는 표현 중 하나를 선택하고, 원본 MIME bundle은 문서 모델에 그대로 보존한다.

| 형식 | 첫 편집 버전의 표시 |
| --- | --- |
| stdout·stderr, `text/plain` | 텍스트로 표시하고 복사·선택 가능. ANSI escape는 제한된 스타일 변환만 허용 |
| `error` | 예외 이름·메시지·traceback 표시. HTML로 직접 해석하지 않음 |
| PNG·JPEG 등 정적 이미지 | 크기 제한과 lazy decode, object URL 수명 관리 |
| `text/html` | script·event handler·위험한 URL·form·외부 embed 제거 후 표 등 정적 내용 표시 |
| `text/markdown`, `text/latex` | 기존 Markdown·수식 기반의 제한된 표시 |
| `application/json` | JSON 데이터 보기. 문자열 배열이라고 임의로 합치지 않음 |
| SVG | 검증된 안전한 표시 경로가 생기기 전에는 다른 MIME fallback. 원본 데이터는 유지 |
| JavaScript·ipywidgets·Plotly 전용 MIME 등 | 지원하는 정적 fallback 또는 미지원 안내. 데이터 보존 |

JupyterLab의 [rendermime factories](../vendor/jupyterlab/packages/rendermime/src/factories.ts)는 safe 속성과 MIME 우선순위를 분리한다. 그러나 [renderHTML](../vendor/jupyterlab/packages/rendermime/src/renderers.ts)은 trusted 출력의 script를 실행하며, untrusted script에 실행 버튼을 제공하는 경로도 있다. 이 renderer를 Setdown shell에 무수정 연결하지 않는다. 초기에는 Setdown의 DOMPurify 사용 경험을 살린 정적 표시 정책을 사용한다.

브라우저 읽기 모드의 sanitizer도 그대로 복사하면 안 된다. [WebReaderSurface](../apps/desktop/src/renderer/browser/WebReaderSurface.svelte)는 `class`와 `style`을 제거하므로 수식·코드·표 표현에 필요한 구조가 깨질 수 있다. 출력과 Markdown에 각각 필요한 속성을 허용하고, arbitrary CSS가 앱 전체에 영향을 주지 않게 한다. 링크·로컬 이미지·첨부파일 접근은 해당 노트북의 리소스 범위에서만 허용한다.

읽기와 편집만으로 외부 스크립트 실행, 자동 다운로드, 커널 시작을 발생시키지 않는다. 추후 interactive widget은 별도 sandboxed output runtime, 제한된 메시지 포트, 명시적인 실행 신뢰 정책이 준비된 뒤 추가한다. 커널 실행 허용과 출력 JavaScript 허용은 별개다. [Jupyter Server 보안 모델](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)

## 8. 기존 Python LSP를 셀 문서로 확장하는 방법

### 셀마다 독립된 Python 파일을 만들면 안 된다

```python
# 첫 코드 셀
numbers = [1, 2, 3]

# 다음 코드 셀
numbers.append(4)
```

두 셀을 독립된 문서로 보내면 뒤 셀은 앞 셀의 `numbers` 정의를 알 수 없다. [JupyterLab VirtualDocument](../vendor/jupyterlab/packages/lsp/src/virtual/document.ts)는 root 언어의 가상 문서를 만들고 셀과 가상 문서의 위치를 연결한다. magic 등으로 추출되는 다른 언어의 문서도 별도로 취급한다. Setdown도 셀 편집 모델과 LSP가 분석하는 문서를 구분해야 한다.

LSP에는 3.17부터 `notebookDocument/didOpen`, `didChange`, `didSave`, `didClose`가 있다. 그러나 표준에 존재하는 것과 선택한 서버가 지원하는 것은 다르다. 서버의 Notebook sync capability와 selector를 확인해야 하며, 일반 문서 동기화와 중복해서 같은 셀을 보내면 안 된다. [프로토콜 타입과 변경 순서](../vendor/vscode-languageserver-node/protocol/src/common/protocol.notebook.ts)

### 현재 번들된 Pyright로 확인한 결과

로컬 Pyright `1.1.414`에 stdio LSP로 initialize·didOpen·hover·definition을 보냈다. 사용자 프로젝트나 노트북 코드는 실행하지 않았다. `/tmp`의 독립 디렉터리에서 분석 요청만 보냈고, 실험 종료 후 프로세스와 디렉터리를 정리했다.

첫 입력은 `numbers = [1, 2, 3]`, 빈 줄 두 개, `numbers.append(4)`였다. 두 번째 입력은 같은 디렉터리의 `helper.py`에 정의된 `twice(value: int) -> int`를 import해서 다른 셀에 해당하는 줄에서 호출했다.

| 검사 | 실제 결과 | 설계 의미 |
| --- | --- | --- |
| client가 notebook sync capability를 제시한 initialize | 서버 `textDocumentSync: 2`, `notebookDocumentSync` 필드 없음 | 현재 Pyright에 Notebook sync만 보내는 구현으로 해결되지 않음 |
| 합친 Python 텍스트를 디스크에 없는 `file:` URI로 didOpen | hover가 `numbers: list[int]`, definition이 앞 셀 위치를 반환 | 파일을 실제로 쓰지 않아도 cross-cell 분석 문서가 가능 |
| 같은 텍스트를 `setdown-notebook:` URI로 didOpen | 위의 단순 cross-cell hover·definition은 성공 | custom URI를 받는다는 것만으로 충분한 호환성을 판단할 수 없음 |
| 실제 폴더의 `helper.py`를 import한 `file:` 분석 문서 | 함수 signature와 실제 helper.py 정의 위치 반환 | 파일 경로의 분석 문맥을 유지하는 방식이 유리 |
| 같은 폴더 경로를 가진 custom URI 분석 문서 | `(import) twice: Unknown`, definition `null` | 이 실험에서 custom scheme은 로컬 import 해석을 보존하지 못함 |

이는 두 개의 작은 분석 사례에 대한 결과다. namespace package, 상대 import, 가상환경, magic, diagnostics·rename까지 검증한 결과는 아니다. Pyright의 [languageServerBase](https://github.com/microsoft/pyright/blob/1.1.414/packages/pyright-internal/src/languageServerBase.ts)도 기본 textDocument open/change 경로와 IPython 모드를 구분한다. VS Code에서 Pylance가 제공하는 Notebook 동작을 Setdown의 Pyright가 모두 제공한다고 가정하지 않는다.

### 권장 연결 구조

```mermaid
flowchart LR
  Cells[셀별 Monaco 모델] --> Projection[Notebook Python projection과 source map]
  Projection --> Transport[기존 LSP 서버 관리와 요청 전송]
  Transport --> Pyright[Pyright]
  Pyright --> Mapping[URI와 범위 변환 및 revision 검증]
  Mapping --> Cells
```

UI의 셀 URI는 `setdown-cell` 같은 내부 식별 형식을 사용해도 된다. 반면 Pyright에 전달하는 projection URI는 **main이 발급한, 실제 노트북 디렉터리에 속하는 충돌 없는 가상 `.py` file URI**를 우선 검증한다. 이 파일을 디스크에 만들지 않고 didOpen으로 내용을 공급한다. 실제 파일과 겹치지 않도록 확인하고 사용 중 충돌 시 새 URI로 재연결한다.

이 URI는 임의 파일 쓰기 권한이 아니다. main이 `{ownerWindow, notebookId, generation, projectionUri}`를 등록하고, 해당 노트북 소유권이 있는 요청만 허용한다. projection 대상으로 들어온 workspace edit은 source map으로 셀 편집으로 돌린다. Explorer·Open File·일반 파일 저장으로 넘기지 않는다. 닫기·Save As·외부 reload·창 이동 때 등록을 폐기하거나 갱신한다.

기존 `LanguageDocument.path`만 가상 경로로 바꿔 보내면 [LanguageManager.open](../apps/desktop/src/main/language/language-manager.ts)의 열린 파일 검증에 걸린다. 이를 제거하지 말고 일반 파일과 notebook projection에 대한 검증 경로를 구분한다. 요청 API의 method allowlist와 command 처리 경계도 유지한다.

### 코드 연결과 좌표 변환

Notebook projection은 코드 셀을 문서 순서로 합친 분석용 텍스트다. Markdown·raw·outputs는 제외한다. 각 구간에는 `cellId`, sourceRevision, 가상 문서 시작 위치, 실제 셀 범위를 기록한다. LSP의 UTF-16 위치와 Monaco 위치를 정확히 변환한다.

projectionVersion은 어떤 셀의 source가 바뀌거나 순서가 달라져도 증가한다. 뒤 셀에 대한 요청 중 앞 셀에 줄이 추가되면 뒤 셀 sourceRevision은 같아도 가상 위치가 바뀐다. 따라서 기존 요청의 model version만 검증해서는 부족하고 **notebook generation + projectionVersion + cell sourceRevision**을 함께 확인해야 한다.

projection 갱신도 입력 callback에서 notebook 전체를 반복 복사하는 구현을 피한다. 변경 셀의 구간과 이후 위치 인덱스를 갱신하고, 서버 전송은 기존 Full/Incremental 협상에 맞춰 합친다. completion·hover 요청 전에 해당 revision까지 동기화 큐를 flush하되 그동안의 새 입력은 별도 revision으로 유지한다. 서버 분석이 늦어져도 셀 입력과 저장을 막지 않는다.

서버의 capability를 그대로 모든 셀에 노출하지 않는다. 셀 변환기가 안전하게 지원하는 기능과 교집합을 취한다.

| 기능 | 필요한 변환과 검증 |
| --- | --- |
| Hover·signature help | 요청 위치와 응답 범위를 현재 셀로 변환 |
| Completion | insert/replace range, additionalTextEdits, import 삽입 대상까지 변환. 안전한 대상이 없으면 해당 후보의 편집을 적용하지 않음 |
| Definition·references·symbols | projection URI는 cell navigation으로, 실제 파일 URI는 기존 문서 탐색으로 분리 |
| Diagnostics | 전체 projection 진단을 셀별로 분배. Markdown·구분용 영역·오래된 projection 응답은 제외 |
| Rename·code action | 모든 편집 범위와 셀 revision을 먼저 검증. 여러 셀은 한 transaction으로 적용. 변환 불가능한 edit 하나가 있으면 전체 거절 |
| Formatting·willSave edits | 파일 전체 formatter의 결과를 셀에 그대로 적용하지 않음. 셀 경계를 넘지 않는 변환을 증명한 기능만 제공 |
| Semantic tokens | 가상 좌표의 delta encoding을 해석한 뒤 셀 범위로 재인코딩. projection 변경 시 resultId·delta cache를 일관되게 무효화 |
| Inlay hint·CodeLens·resolve·command | 원본 서버 항목과 projection snapshot을 보관하고 resolve 결과·추가 편집도 같은 변환 경로를 통과 |
| Folding·selection·linked editing·hierarchy | 셀 경계 및 결과에 포함된 URI를 모두 처리. 구현이 없는 항목은 capability를 숨김 |

현재 [language-edit-features.ts](../apps/desktop/src/renderer/editor/language-edit-features.ts)의 range 변환은 한 텍스트 모델과 서버 문서가 대응한다는 전제를 가진다. provider를 복제하기보다는 `LanguageFeatureContext` 아래에 identity/file adapter와 notebook adapter를 두고, 요청·결과 변환을 방법별로 명시한다. JSON 객체 전체를 재귀 순회해 이름이 `range`인 필드를 전부 이동시키는 범용 변환은 서버 opaque `data`까지 손상시킬 수 있어 피한다.

### Python Notebook 문법과 실행 순서의 한계

`%matplotlib`, `!pip`, `%%bash`, top-level await는 일반 `.py`와 동일하지 않다. 줄 앞의 `%`와 `!`를 정규식으로 지우는 구현은 문자열·multiline·magic 인수를 망가뜨릴 수 있다. 첫 projection은 일반 Python을 지원하고, 지원하지 않는 magic 셀은 source를 보존한 채 분석 제외를 표시한다. Python tokenizer 또는 검증된 IPython 변환을 적용할 때에도 원본으로 돌아오는 위치 지도가 필요하다.

빈 줄로 셀을 연결해도 미완성 괄호·문자열·들여쓰기로 인한 파싱 영향이 다음 셀에 번질 수 있다. 이런 경우의 진단 범위와 편집 도중 completion을 별도 fixture로 검증한다. 무해한 separator가 모든 Python 구문 경계를 강제로 끊는다고 가정하지 않는다. top-level await와 셀별 future import도 추가 호환 항목이다.

정적 분석의 기본 순서는 **화면의 셀 순서**로 한다. `execution_count`로 다시 정렬하지 않는다. 커널에서 실행한 실제 순서와 다를 수 있음을 받아들이고, 실행할 때마다 source를 재배치하지 않는다.

Python interpreter 선택도 별도다. Pyright 실행 파일의 위치, Python 분석 환경, Jupyter 서버의 Python, 실제 커널의 Python은 다를 수 있다. 나중에 커널을 선택하면 확인 가능한 interpreter 정보를 분석 환경에 반영하되, 같은 project root에서 서로 다른 환경을 쓰는 노트북은 서버 session key에 분석 환경을 포함하도록 설계한다. 셀마다 서버를 띄우지 않는다.

## 9. 이후 실행 기능은 공식 Jupyter 통신을 이용한다

실행이 필요해지는 단계에는 **Setdown main의 NotebookExecutionService → `@jupyterlab/services` → 로컬 Jupyter Server → 선택한 kernel** 구조를 권한다. 공식 services는 REST·WebSocket을 이용하며 Node에서도 사용할 수 있다. 파일 저장은 계속 Setdown의 DocumentManager가 소유하고, Jupyter Contents API로 동시에 저장하지 않는다. [services 문서](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.html), [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)

`@jupyterlab/services`가 Python 실행 환경을 설치해 주거나 standalone kernel을 직접 띄워 주는 것은 아니다. 사용자가 선택한 환경에 Jupyter Server와 원하는 kernel이 있어야 한다. 초기에 이 의존성을 편집 전제 조건으로 만들지 않는 것이 중요하다.

직접 ZeroMQ·connection file·message signing·프로세스 supervision을 작성하는 방식은 Python 패키지 설치량을 줄일 수 있지만 Setdown의 유지보수 범위가 크게 늘어난다. 단순히 셀 source를 매번 `python -c`로 실행하는 방식은 변수 상태·rich output·interrupt·입력 요청을 보존하지 못한다. 서버 경유 방식부터 시작하는 것이 기존의 ‘엔진을 되도록 직접 개발하지 않는다’는 방향에 맞는다.

### 서버와 커널의 소유권

JupyterLab Desktop의 환경 선택·readiness·종료 구조는 참조하되 전체 앱을 가져오지 않는다. Setdown은 선택된 executable과 검증된 argv로 실행하고, loopback 바인딩·임의 포트·인증 token·제한된 시작 timeout을 갖는다. 파일을 열었다는 이유만으로 설치나 서버 실행을 시작하지 않는다.

인증 token과 서버 연결 자격은 main에 보관하고 notebook JSON·renderer 출력·로그에 넣지 않는다. 실행 요청은 열린 노트북의 소유권을 확인한 typed IPC로만 전달한다. 실행 중 출력은 제한된 크기로 batch 전달하며, 한도에 걸려 표시를 줄인 상태와 저장할 원본 출력을 구별한다. 원본 자체를 더 받지 못하는 한도에서는 실행 중단이나 명시적인 데이터 손실 상태가 필요하며, 조용히 출력이 완전한 것처럼 저장하지 않는다.

커널 후보는 실제 kernelspec 조회 결과로 표시한다. notebook metadata의 `kernelspec.name`은 선택 힌트이며 executable 경로로 신뢰하지 않는다. LSP auto detection의 UI 경험은 재사용할 수 있지만, 언어 서버 목록과 커널 목록을 동일한 목록으로 합치지 않는다.

문서와 연결된 kernel의 상태는 `disconnected → starting → idle ↔ busy → restarting/failed`로 관리한다. 실행 요청은 `kernelGeneration + msgId + cellId + executedSourceRevision`을 가진다. 실행 중 셀을 이동해도 같은 셀에 결과를 붙이고, 삭제·재시작 후 도착한 응답은 새 셀이나 새 커널 결과로 오인하지 않는다. 코드가 실행 중 바뀌었다면 저장된 출력이 현재 source와 다를 수 있다는 상태를 유지한다.

닫힌 탭과 연결 종료도 구분한다. owned local kernel은 마지막 사용자가 닫거나 앱이 종료할 때 중단·종료하고 deadline 후 잔여 프로세스를 정리한다. 외부 서버에 연결한 kernel은 연결 해제와 shutdown을 별도 행동으로 다룬다. connection 객체를 dispose하는 것만으로 kernel이 종료되지 않는다는 점이 [services 수명 설명](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.html)에 명시되어 있다.

### 출력 메시지는 append 하나로 처리할 수 없다

[VS Code Jupyter 실행 큐](../vendor/vscode-jupyter/src/kernels/execution/cellExecutionQueue.ts)와 [메시지 처리기](../vendor/vscode-jupyter/src/kernels/execution/cellExecutionMessageHandler.ts)는 다음 경우를 다룬다. Setdown도 실행 단계의 완료 조건에 포함한다.

- stdout·stderr stream을 순서대로 합치고 폭주 시 UI 업데이트를 batch 처리한다.
- `execute_result`, `display_data`, `error`를 서로 다른 출력으로 보관한다.
- `clear_output(wait=true)`는 다음 출력이 올 때 교체한다.
- `display_id` 갱신은 이전 출력과 다른 셀의 해당 display에도 적용될 수 있다.
- 완료 판정은 shell reply와 IOPub idle을 함께 고려한다. [services의 KernelFuture](../vendor/jupyterlab/packages/services/src/kernel/future.ts)가 이미 이 수명을 처리한다.
- stdin 입력을 지원하지 않는 최초 실행 버전은 `allow_stdin:false`를 명시한다. 이후 password를 포함한 입력 UI를 추가한다.
- 커널 중단은 LSP request cancellation과 다르다. 출력은 저장 대상 변경이지만 busy 상태·통신 ID는 저장 대상이 아니다.

`transient.display_id`는 세션 갱신용이고 실행 결과의 영구 metadata로 새로 저장하지 않는다. [Jupyter 메시지 규약](https://jupyter-client.readthedocs.io/en/stable/messaging.html#update-display-data)

## 10. 실제 코드 변경 단위

새 모듈 이름은 제안이며 아직 구현된 파일이 아니다. 공용 계층 변경은 이 기능이 요구하는 저장·모델·좌표 경계에 한정한다.

| 영역 | 제안하는 변경 | 먼저 재사용할 기존 코드 |
| --- | --- | --- |
| `core/notebook/notebook-codec.ts` | schema 버전, 원본 보존, 셀 decode와 저장 patch | nbformat schema·fixtures, JSON parser |
| `core/notebook/notebook-model.ts` | stable cell identity, 구조 transaction, 저장 checkpoint | document-state·document-save의 revision 보장 |
| `core/document/document-profile.ts`, `core/workspace/workspace-state.ts` | notebook 분류·surface·tab과 편집 가능 문서 구분 | 기존 파일 분류·탭 navigation |
| `renderer/notebook/NotebookSurface.svelte`, `NotebookCell.svelte` | 셀 UI·가상화·focus·검색·셀 명령 | 기존 shell 테마·메뉴·Monaco 로더 |
| `renderer/notebook/notebook-editor.ts` | 셀 모델 소유·editor 대여·텍스트/구조 Undo 경계 | DocumentModelOwner와 Monaco 공개 API |
| `main/preview`의 fragment service | 셀별 Markdown 요청·캐시·첨부 리소스 | Crossnote worker·수식·source anchors |
| `renderer/notebook/notebook-outputs.ts` | MIME 선택·안전한 정적 표시·출력 가상화 | DOMPurify·이미지 URL 수명 관리 패턴 |
| `main/documents`와 저장 IPC | notebook 읽기·검증·저장 receipt·외부 변경 | 기존 atomic write·conflict 처리 |
| `renderer/workspace` | Save/Save As/Save All/auto-save/close를 document handle에 연결 | DocumentActions·AutoSaveController·TabController |
| `core/notebook/notebook-projection.ts` | 셀↔분석 문서 위치, generation, 변환 가능한 범위 | 기존 language-conversion의 좌표 기본 변환 |
| `main/language`, `renderer/editor` | notebook 분석 문서 등록, virtual URI 소유권, provider adapter | 기존 서버 검색·세션·취소·feature provider |
| `main/notebook/notebook-execution.ts` | 후속 단계의 서버·커널·실행·출력 갱신 | Jupyter services와 Desktop/VS Code 실행 설계 |

프로젝트의 [desktop-api.ts](../apps/desktop/src/protocol/desktop-api.ts), preload, [install-ipc.ts](../apps/desktop/src/main/ipc/install-ipc.ts)도 typed notebook payload를 전달해야 한다. 임의 JavaScript·임의 LSP method·임의 프로세스 실행을 notebook API에 넣지 않는다. media snapshot을 저장에서 제외하던 검사를 `canSave`와 문서 종류별 serializer로 치환하는 항목을 빠뜨리지 않는다.

기존 Git review는 우선 `.ipynb`의 raw JSON diff를 명시적으로 사용한다. notebook 편집 모델과 raw Working Tree diff가 각각 같은 파일을 수정하도록 동시에 열어 놓지 않는다. 최초에는 notebook이 열려 있으면 Working Tree JSON diff를 읽기 전용으로 하고 셀 편집 또는 단일 JSON 모드로 유도한다. 셀 단위 notebook diff와 merge는 후속 작업이다.

## 11. 구현 순서와 완료 조건

| 단계 | 제공하는 결과 | 다음 단계로 넘어갈 조건 |
| --- | --- | --- |
| A. 코덱과 문서 소유권 | notebook 읽기·편집 transaction·정확한 저장의 기반 | 미변경 byte 보존, 수정하지 않은 셀·출력·metadata 보존, 잘못된 파일을 덮어쓰지 않음 |
| B. 셀 편집과 정적 출력 | `.ipynb` 탭, Markdown·code·raw, 셀 명령, 저장·검색·닫기 | Python 미설치 환경에서 동작. IME·Undo·dirty·첨부 이미지·외부 변경·대용량 제한 검증 |
| C. Python LSP 연결 | cross-cell 완성·hover·진단·탐색, 안전한 편집 기능 | 실제 Pyright와 import·셀 재배치·취소·미저장 변경·다중 셀 edit 검증 |
| D. 선택적 커널 실행 | 환경 선택, 실행·Run All·중단·재시작, 출력 갱신 | 실제 ipykernel에서 실행 수명·출력 종류·종료·실패 복구 검증 |
| E. 추가 형식과 고급 UX | 다른 언어의 Notebook sync, widgets, 셀 diff, 내보내기 | 각 adapter의 실제 서버·renderer 호환성과 격리 검증 |

**첫 편집 기능의 배포 범위는 A–C로 잡는 것이 좋다.** C 안에서도 범위 변환이 완성된 기능부터 노출하되, 일반 `.py` 에디터의 기존 기능을 줄이지 않는다. D까지 해야 `.ipynb` 편집이 가능하다고 정의하면 파일 편집 요청이 환경 설치·원격 서버·위젯 지원 프로젝트로 커진다.

일정 추정 전에 두 가지 짧은 구현 검증이 필요하다. 첫째, 기존 Crossnote fragment를 셀 표면에 넣었을 때 수식·첨부·테마·더블클릭 위치를 유지하는가. 둘째, Monaco 셀 텍스트 Undo와 셀 삭제·복구 및 여러 셀 edit의 history가 정해진 규칙대로 동작하는가. 이 둘이 통과해야 UI 재사용 범위와 editor 인스턴스 정책을 확정할 수 있다.

## 12. 테스트 재료와 성능 기준

### 이미 서브모듈에 있는 실제 노트북

read-only 집계에서 `nbformat`에 20개, `jupyterlab`에 35개, `vscode-jupyter`에 56개로 총 **111개 `.ipynb` fixture와 예제**를 확인했다. 이는 JSON 파일 수이며 모두 정상 형식이라는 뜻은 아니다. 의도적으로 잘못된 ID·metadata·미래 형식·구형 v3를 담은 파일도 포함한다. JSON을 읽어 cell/output 종류를 집계했으며 schema 통과나 Setdown 실행 검사를 수행한 결과는 아니다.

| fixture | 활용할 검사 |
| --- | --- |
| [nbformat test4plus](../vendor/nbformat/tests/test4plus.ipynb) | minor 99, `future cell`, `future output`을 삭제하지 않음 |
| [ID가 없는 4.5](../vendor/nbformat/tests/v4_5_no_cell_id.ipynb), [중복 ID](../vendor/nbformat/tests/invalid_unique_cell_id.ipynb) | 자동 수정 없이 유효성 오류를 구별하고 내부 식별 충돌 방지 |
| [JupyterLab OutputExamples](../vendor/jupyterlab/examples/notebooks/OutputExamples.ipynb) | HTML·Markdown·수식·이미지·여러 MIME. 파일 크기 5,598,334 bytes |
| [JupyterLab windowed notebook](../vendor/jupyterlab/galata/test/galata/notebooks/windowed_notebook.ipynb) | 셀 가상화·스크롤·focus와 모델 수명 |
| [JupyterLab long outputs](../vendor/jupyterlab/galata/test/jupyterlab/notebooks/long_outputs.ipynb) | 긴 출력의 레이아웃·선택·batch 처리 |
| [VS Code mixed MIME](../vendor/vscode-jupyter/src/test/datascience/notebook/withMixedMimeTypeOutput.ipynb) | MIME 선택과 fallback, 원본 전체 bundle 보존 |
| [VS Code metadata](../vendor/vscode-jupyter/src/test/datascience/notebook/nbWithMetadata.ipynb) | tool별 metadata의 편집 저장 보존 |
| [VS Code standard widgets](../vendor/vscode-jupyter/src/test/datascience/notebook/standard_widgets.ipynb) | widget을 실행하지 않아도 데이터가 소실되지 않음 |

### 반드시 자동화할 동작

| 층 | 필수 검사 |
| --- | --- |
| Codec | no-op byte equality, 문자열/줄 배열 source, CRLF와 escaped newline, 빈 셀, raw, attachments, 큰 숫자 metadata, 미래 필드, invalid JSON·ID, 한 셀 수정 후 나머지 보존 |
| 문서 상태 | source·순서·metadata·outputs 각각의 dirty, Undo로 clean 복귀, 저장 도중 입력, 실패한 write와 외부 변경, Save As·창 닫기·삭제 복구 |
| Electron 편집 | 한국어 조합 중 Esc·셀 전환·스크롤, selection과 copy, 코드 자동완성, Markdown 더블클릭, split과 tab zoom, 숨겨진 셀의 focus 금지 |
| LSP | 앞 셀 변수·import, 현재 셀 앞에 셀 삽입·이동, stale 응답 폐기, emoji/UTF-16, cross-cell rename, import 추가 edit, 가상 URI에서 실제 파일로 정의 이동, unknown magic |
| 출력 | 악성 HTML·SVG·JS가 shell 권한을 얻지 못함, 미지원 MIME 저장 보존, 큰 이미지와 긴 stream, URL 해제·닫기·재열기 |
| 후속 실행 | 실행한 source snapshot, clear_output wait, display update, 오류·stdin·interrupt·restart·커널 종료, 닫은 셀의 늦은 메시지와 잔여 프로세스 |

### 기존 성능 보장을 유지하면서 새 기준을 만든다

Markdown fragment 추출, theme/CSS, source anchor, preview 의존성을 바꾸는 단계는 [preview performance contract](../docs/preview-performance-contract.md)의 대상이다. `npm run test:preview-contract`와 같은 환경의 baseline/candidate `npm run bench:preview -- --baseline /absolute/path/to/installed-baseline`을 실행한다. 일반 Markdown과 Git review의 첫 번째·두 번째·warm 전환, 수정 유무, 준비 시간 포함 여부를 분리한다. GUI는 [AGENTS.md](../AGENTS.md)에 따라 Xvfb와 격리된 runtime·D-Bus에서 실행한다.

Notebook에는 별도의 측정을 추가한다. 셀 수 10·100·1000, 출력 없음/큰 이미지/긴 stream, 처음 열기/재방문, 스크롤/셀 편집/저장, 실행 전후를 구분한다. 주로 다음을 기록한다.

- 파일 parse·첫 유효 셀 표시·첫 입력 가능까지의 시간.
- source 입력 시 전체 JSON 직렬화나 전체 Markdown 재렌더가 발생하는지.
- 활성 editor·유지 중인 text model·DOM cell·decoded image 개수와 RSS.
- 스크롤 도중 frame 지연, 큰 출력의 레이아웃 비용, 닫은 후 리소스 회수.
- LSP projection 재구성과 서버 진단 지연, Notebook 저장 직렬화 비용.

초기에는 현재 16 MiB 파일 한도를 명시적으로 유지할 수 있다. 다만 코드 source 한도와 notebook 전체 한도를 분리하고, 한도 초과 시 편집을 거절해도 원본을 자르거나 출력부터 제거하지 않는다. 실제 대형 fixture 측정 후 한도를 높인다. DOM 가상화는 JSON parse·base64 보관 비용까지 없애 주지 않는다.

성능 수치나 bundle 크기의 우열은 아직 측정하지 않았다. 본 보고서의 라이브러리 선택은 확인한 의존성과 소유권 구조에 근거한 판단이다. 이번에 실행한 검증은 위의 Pyright 프로토콜 실험과 fixture 집계이며, 제품 코드 변경이나 GUI 성능 검증은 포함하지 않는다.

## 13. 먼저 확정할 설계 결정

1. `.ipynb`를 편집 가능한 복합 문서로 추가하고, 기존 일반 텍스트 경로는 유지한다.
2. Markdown 렌더링과 Monaco·LSP provider는 재사용하되 셀 ID·revision·resource scope를 추가한다.
3. 파일 코덱의 정보 보존과 저장·Undo를 셀 UI보다 먼저 검증한다.
4. Pyright에는 notebook 전체 코드 projection을 보내며, main이 발급한 분석 URI와 좌표 변환을 관리한다.
5. 저장된 출력은 안전한 정적 MIME 표시부터 지원하고, 미지원 출력도 저장에서 보존한다.
6. 실행은 Jupyter services와 서버를 사용하는 후속 기능으로 분리한다. 편집에 커널을 요구하지 않는다.

이 방향이면 Setdown이 이미 가진 Markdown 읽기, Python 편집, LSP를 계속 발전시키면서 노트북을 추가할 수 있다. 새로 소유해야 하는 코드는 셀 문서의 일관성·저장 형식·좌표 변환·Setdown UI 연결에 집중된다. 가장 먼저 만들 부분은 `.ipynb` 버튼이 아니라 **기존 파일을 손상시키지 않는 NotebookCodec과 NotebookDocumentOwner**다.
