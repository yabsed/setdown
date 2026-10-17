**Setdown LSP 실전 점검 — 기능의 폭은 넓고, 프로젝트와 서버를 해석하는 경계는 아직 얇다**

2026년 10월 17일 · 기준 커밋 `a00d7aef1c6c5868777fc5b04fb97ef225ce69a4`

Setdown에서 같은 Python 함수의 이름을 바꿨다. 파일만 열었을 때는 두 파일이 바뀌었다. 그 파일이 속한 서브모듈을 프로젝트로 열자 네 파일이 바뀌었다. Setdown 저장소 전체를 프로젝트로 열면 다시 두 파일만 바뀌었다. 마지막 경우에는 서버가 조사한 Python 파일이 1,036개로 늘었는데도 결과는 더 불완전했다. 이번 조사에서 가장 중요한 발견이다. 서버에 연결되고 자동완성이 뜬다는 사실만으로 프로젝트 단위 작업을 믿을 수는 없다.

현재 구현의 기반은 상당히 갖춰져 있다. 요청 허용 목록은 43개이고, 기능 목록은 27종이며, 서버 프로필은 195개다. 코드 액션, 의미 토큰, 인레이 힌트, 계층 탐색, 동적 등록, pull diagnostics도 이미 존재한다. 이번에 실행한 기존 LSP 단위·통합 테스트 82개와 실제 Electron 테스트 14개는 모두 통과했다. 다음 개발의 우선순위는 기능 이름을 더 늘리는 데 두기보다, **프로젝트 범위·서버별 설정·노트북 경로·협상한 기능의 수명**을 일치시키는 데 두는 것이 좋다.

아래 판단은 실제 서브모듈을 Setdown으로 연 결과, 제품 코드를 직접 실행한 경계 조건 실험, 명세와 구현을 읽고 제안하는 개선으로 나누었다. 여덟 가지 발견 중 앞의 다섯 가지는 실제 서버와 서브모듈에서 관측했다. 나머지 세 가지는 제품의 실제 클래스를 사용하되 서버 응답이나 입력 크기를 통제한 실험으로 확인했다. 발생 빈도까지 입증한 것은 아니다.

| 우선순위 | 발견 | 확인한 결과 | 근거의 성격 |
| --- | --- | --- | --- |
| 높음 | 프로젝트 루트에 따라 Python 이름 변경 범위가 달라짐 | 같은 심볼이 2 / 4 / 2개 파일로 변경됨 | 실제 Pyright 응답, 일반 편집 UI |
| 높음 | TypeScript 인레이 설정의 전달 위치가 맞지 않음 | 같은 파일에서 설정 경로만 바꾸자 힌트 0 → 11개 | 실제 TypeScript 서버 비교 |
| 높음 | CSS 기본 프로필과 서버의 설정 처리가 맞지 않음 | 잘못된 CSS에 진단 0개와 서버 예외; 설정을 주면 진단 2개 | 실제 CSS 서버 비교; 예외의 직접 원인은 서버 |
| 중간 | Monaco worker 선택이 언어를 구분하지 않음 | JSON을 열면 `Missing requestHandler or method: doValidation` | 실제 Chromium 콘솔과 제품 코드 |
| 높음 | 노트북의 기능 협상과 실제 경로가 어긋남 | 서버가 지원하는 completion resolve를 main이 거절 | 실제 basedpyright + 별도 변환 경계 실험 |
| 높음 | 같은 문서에 동적 등록된 진단 제공자를 덮어씀 | `types`, `lint` 두 등록 중 `lint`만 남음 | 제품 클래스에 복수 등록을 주입 |
| 중간 | 서버의 요청 취소를 빈 결과로 바꿈 | 재요청 지원을 광고하지만 `ServerCancelled` 뒤 요청은 1회뿐 | 제품 renderer provider에 취소 응답 주입 |
| 중간 | 응답을 반환하기 전에 resolve 핸들이 만료될 수 있음 | 4,097개 항목을 반환하면서 첫 항목의 resolve는 즉시 실패 | 제품 핸들 저장소의 크기 경계 실험 |

여기서 ‘높음’은 조용한 결과 누락이나 편집 범위의 차이를 먼저 해결하자는 뜻이다. 보안 심각도나 모든 사용자에게 발생하는 빈도를 뜻하지 않는다. 상세 관측의 색인은 [summary.json](lsp-submodule-audit-2026-10-17/summary.json), 원본 응답과 로그는 [실험 디렉터리](lsp-submodule-audit-2026-10-17/)에 있다.

먼저 조사 범위를 분명히 할 필요가 있다. 초기화된 서브모듈 26개, 추적 파일 99,209개의 구성을 조사했다. 이 중 11개 서브모듈의 14개 파일을 골라 루트·설정·UI 조건을 바꾼 26개 시나리오를 정리했다. Python, C, C++, TypeScript, JavaScript, JSON, HTML, CSS에서는 실제 서버를 실행했다. Rust는 실제 연결을 시도했지만 설치된 실행 파일이 rustup shim이고 서버 컴포넌트가 없어 시작하지 못했다. Python 노트북도 별도로 열었다. 26개 서브모듈의 모든 파일을 검사한 전수 평가나 언어별 지원율은 아니다.

| 재료 | 서버 | 실제 확인한 범위와 한계 |
| --- | --- | --- |
| `nbformat/nbformat/notebooknode.py` | Pyright | hover, 정의, 참조, 자동완성·resolve, 이름 변경, 호출 계층; 세 가지 루트 비교 |
| `sublime-lsp/plugin/core/url.py` | Pyright | `parse_uri` 탐색·자동완성·호출 계층 |
| `jupyterlab/jupyterlab/commands.py` | Pyright | `ProgressProcess` 탐색·참조·호출 계층; Jupyter 개발 의존성 일부 없음 |
| `dolphin/src/global.cpp` | clangd | `homeUrl` 탐색, 의미 토큰, 인레이 4개, 서식 응답; Qt와 빌드 설정 불완전 |
| `ptyxis/src/ptyxis-util.c` | clangd | 함수 탐색, 자동완성 100개, 인레이 29개, 서식 응답; 생성 헤더와 GLib 환경 불완전 |
| `gitgraph.js/packages/gitgraph-core/src/branches-order.ts` | TypeScript language server | 탐색·토큰·이름 변경, `this.get` 자동완성 UI, 설정에 따른 인레이 비교; 서버 미설치 상태도 별도 확인 |
| `crossnote/src/utility.ts` | 같은 서버 | 자동완성 1,019개와 resolve, 토큰, 심볼, 서식 응답 |
| `monaco-languageclient/packages/vscode-ws-jsonrpc/src/socket/writer.ts` | 같은 서버 | 클래스 정의·참조·호출 계층·토큰 |
| `readability/Readability-readerable.js` | 같은 서버 | 자동완성 1,004개와 resolve, 함수 이름 변경·토큰 |
| `nbformat/nbformat/v4/nbformat.v4.schema.json` | JSON language server | 자동완성 27개, 심볼·접기·서식·진단 요청; 별도로 Monaco worker 오류 |
| `readability/test/test-pages/001/source.html` | HTML language server | 자동완성 116개와 resolve, 접기·서식·진단 요청 |
| `min/css/windowControls.css` | CSS language server | 자동완성 888개, hover·접기·서식; 기본/명시 설정 및 잘못된 CSS 비교 |
| `brave-core/tools/crates/vendor/itoa/src/lib.rs` | rust-analyzer | 연결 시도와 실패 설명까지만 확인; 의미 분석 품질은 미평가 |
| `nbformat/tests/test4.5.ipynb` | basedpyright | native notebook 동기화로 연결, 정의·참조·자동완성 응답; resolve 거부 확인 |

표의 ‘서식 응답’은 반환된 편집을 검사했다는 뜻이며 원본 파일에 적용·저장했다는 뜻은 아니다. 클래스 선언부나 HTML 태그에서 자동완성·정의가 비어 있는 응답도 있었지만, 빈 결과 자체를 오류로 세지 않았다. Python과 TypeScript 자동완성은 각각 실제 입력·멤버 참조 위치에서 UI까지 확인했다. [Python 화면](lsp-submodule-audit-2026-10-17/python-completion-ui.png)과 [TypeScript 화면](lsp-submodule-audit-2026-10-17/ts-gitgraph-completion-ui.png)을 남겼다.

모든 GUI 실행은 저장소의 `with-isolated-display.sh`를 거쳤다. Xvfb뿐 아니라 Wayland 소켓, runtime directory, D-Bus 세션도 분리했다. 매 시나리오가 새 Electron 프로세스와 임시 사용자 설정을 사용했고, 노트북 코드는 실행하지 않았다. 이름 변경과 잘못된 CSS 삽입은 저장하지 않은 버퍼에서만 했다. 표본 파일의 전후 SHA-256과 내용 일치 여부를 기록했으며 모두 원본과 같았다.

실행 버전은 Electron 44.7.2, Monaco 0.56.0, Pyright 1.1.414, basedpyright 1.40.2, clangd 22.1.0이다. 추가 서버는 `/tmp`에 설치한 typescript-language-server 6.0.2와 vscode-langservers-extracted 4.10.0이다. 임시 설치에 TypeScript 7.0.2도 포함됐지만, 실제 서버 로그가 선택한 컴파일러는 저장소의 **TypeScript 5.9.3**이다. 설치한 버전과 실제 사용한 버전을 혼동하면 이 비교를 재현하기 어렵다. [환경 기록](lsp-submodule-audit-2026-10-17/environment.json)과 [임시 도구 lockfile](lsp-submodule-audit-2026-10-17/tools/package-lock.json)을 함께 보관했다.

가장 먼저 고칠 곳은 프로젝트를 정하는 정책이다. `notebooknode.py`의 `from_dict`를 `from_dict_audit`로 바꿨을 때 서버 응답은 다음과 같았다. 시간은 renderer에서 main을 거쳐 응답을 받을 때까지의 단일 관측이다. 반복 측정의 중앙값, 순수 서버 처리 시간, 성능 회귀 벤치마크가 아니다.

| 여는 방식 | 실제 일반 Python 세션 루트 | Pyright가 열거한 소스 | rename 응답 대상 | rename 관측 시간 |
| --- | --- | ---: | ---: | ---: |
| 파일만 열기 | `vendor/nbformat/nbformat` | 40개 | 2개 파일 | 292ms |
| nbformat 프로젝트 열기 | `vendor/nbformat` | 72개 | 4개 파일 | 319ms |
| Setdown 전체 프로젝트 열기 | 저장소 루트 | 1,036개 | 2개 파일 | 5,170ms |

두 파일은 `notebooknode.py`와 같은 디렉터리의 `__init__.py`였다. 올바른 서브모듈 루트에서는 `nbformat/v4/nbjson.py`와 `tests/test_validator.py`가 더해졌다. 실제 F2 UI에서도 단독 파일은 두 개, nbformat 프로젝트는 네 개의 수정된 탭을 만들었다. 전체 프로젝트 UI 관측은 5초 assertion을 넘겨 실패했고, 실패 직후 캡처에는 이름 변경과 두 개의 수정된 탭이 보였다. 이 시나리오를 시간 내 성공으로 바꾸어 집계하지 않았다. [원본 응답](lsp-submodule-audit-2026-10-17/evidence.json), [UI 결과](lsp-submodule-audit-2026-10-17/evidence-python-standalone-rename-ui_python-project-rename-ui_python-superproject-rename-ui.json), [전체 프로젝트 실패 직후 화면](lsp-submodule-audit-2026-10-17/python-superproject-rename-ui-failure.png)에 차이가 남아 있다.

이는 rename 프로토콜이 파일을 떨어뜨렸다는 증거와는 다르다. **Setdown이 선택한 분석 문맥에 따라 서버가 찾는 사용처가 달라진 것**이다. Pyright의 import 해석에는 루트와 실행 환경이 관여한다. 더 큰 폴더를 분석한다고 프로젝트 내부 import가 더 정확해지는 것은 아니다. 이 실험만으로 5초의 지연 전부를 파일 수 하나에 귀속할 수도 없다. [Pyright import 해석 문서](https://raw.githubusercontent.com/microsoft/pyright/main/docs/import-resolution.md)

원인은 코드에서 바로 읽힌다. [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts)의 `rootFor`는 파일이 UI에서 연 프로젝트 안에 있으면 그 프로젝트 루트를 그대로 채택한다.

```ts
const rootFor = (definition: LanguageServerDefinition) =>
  state.projectRoot && isInside(canonicalPath(state.projectRoot), file)
    ? canonicalPath(state.projectRoot)
    : standaloneLanguageRoot(file, definition);
```

단독 파일 경로의 사정도 좋지 않다. [server-definitions.ts](../apps/desktop/src/main/language/server-definitions.ts)는 marker를 찾아 조상을 올라가지만, [Pyright override](../apps/desktop/scripts/language-profiles/overrides.json)는 `rootMarkers: []`로 지정돼 있다. 따라서 파일의 디렉터리에서 멈춘다. 분석 완료 전에 rename을 보내지 않도록 첫 진단을 기다리는 기존 장치는 유용하다. 다만 잘못 선택한 루트에서 분석이 끝나기를 기다려도 누락된 사용처는 돌아오지 않는다.

개선은 UI의 폴더와 언어 서버의 분석 루트를 별도 개념으로 만드는 데서 시작해야 한다. Python은 `pyrightconfig.json`, `pyproject.toml`과 패키지 환경을, TypeScript는 tsconfig와 패키지·workspace 관계를, Rust는 Cargo workspace를 해석해야 한다. `.git`이 디렉터리뿐 아니라 파일인 서브모듈 경계도 고려해야 한다. 모든 언어에 ‘가장 가까운 marker’를 일괄 적용하면 monorepo에서 반대 방향의 문제가 생긴다. 언어별 후보·우선순위·명시적 사용자 override를 두고, Language Support에 선택한 루트와 이유를 보여주는 편이 좋다. Python interpreter와 설정도 해당 분석 프로젝트에 묶어야 한다. [Pyright 설정 문서](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md)

그다음은 프로필의 품질이다. 195개의 프로필이 있다는 사실과 195개의 서버가 적절히 설정된다는 사실 사이에는 간격이 있다. [프로필 생성기](../apps/desktop/scripts/update-language-profiles.py)는 Helix 설정의 `config`를 일반적으로 `initializationOptions`에 복사한다.

```python
if server.get('config'):
    definition['initializationOptions'] = dict(server['config'])
```

TypeScript 프로필의 `typescript.inlayHints`와 `javascript.inlayHints`도 이 위치에 들어간다. 그러나 이번 서버가 읽는 이 힌트 설정은 workspace configuration이다. `branches-order.ts`에서 기본 설정의 힌트는 0개였다. 같은 서버와 파일에 Setdown의 기존 설정 API로 `settings.typescript.inlayHints`를 전달하자 11개가 나왔다. provider 자체가 빠진 문제가 아니라 값이 도달하는 통로의 문제다. [비교 결과](lsp-submodule-audit-2026-10-17/evidence-ts-gitgraph-configured.json), [서버 설정 문서](https://raw.githubusercontent.com/typescript-language-server/typescript-language-server/master/docs/configuration.md)

CSS에서는 그 간격이 진단 누락으로 드러났다. `windowControls.css`를 기본 프로필로 열면 서버가 `Cannot read properties of null (reading 'validProperties')`를 기록했다. 그 상태에서 다음 한 줄을 저장하지 않은 버퍼에 추가했다.

```css
.audit { zzz-invalid-property: 1; color: ; }
```

기본 설정의 `textDocument/diagnostic` 응답은 `kind: "full", items: []`였다. `settings.css`, `settings.scss`, `settings.less`에 `validate: true`, `lint: {}`, `completion: {}`, `hover: {}`를 지정한 비교에서는 예외가 없어지고 `property value expected`, `Unknown property: 'zzz-invalid-property'`라는 두 진단이 돌아왔다. 최신 버전으로 요청한 최종 비교에는 stale 요청 오류가 없다. [CSS 원본 비교](lsp-submodule-audit-2026-10-17/evidence-css-min-invalid_css-min-configured-invalid.json)

여기에는 책임을 정확히 나눠야 할 이유가 있다. LSP의 `workspace/configuration`은 찾지 못한 설정에 `null`을 반환하도록 정한다. Setdown의 일반 설정 조회가 `null`을 반환하는 것은 명세에 맞는다. 이번 CSS 서비스 6.3.10은 그 값을 lint 설정까지 전달한 뒤 역참조해 예외를 냈다. 직접 원인은 서버의 null 처리이고, Setdown에는 이 조합을 정상 작동시키는 기본 프로필과 호환성 검증이 부족하다. 공통 configuration handler가 모든 `null`을 `{}`로 바꾸게 고치면 다른 서버에 대한 계약을 깨뜨린다. 서버별 기본값 또는 확인된 upstream 수정 버전으로 해결해야 한다. [LSP configuration 규칙](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/configuration.md), [CSS validation 구현](https://raw.githubusercontent.com/microsoft/vscode-css-languageservice/main/src/services/cssValidation.ts), [lint 설정 구현](https://raw.githubusercontent.com/microsoft/vscode-css-languageservice/main/src/services/lintRules.ts)

프로필 생성기는 앞으로 실행 인자, 초기화 옵션, workspace 설정을 별도 데이터로 다뤄야 한다. 외부 편집기의 프로필은 출처와 버전을 가진 입력 자료로 쓰고, Setdown에서 실제로 읽히는 필드는 대표 서버별로 검증해야 한다. TypeScript의 힌트와 CSS의 진단처럼 결과가 달라지는 작은 실전 검사가 유용하다. 모든 서버를 한꺼번에 설치하는 CI보다, 자주 쓰는 서버의 버전을 고정한 소규모 호환성 집합부터 만드는 편이 관리하기 쉽다.

서버까지 가는 길만 살피면 놓치는 문제도 있었다. JSON 스키마를 열었을 때 외부 JSON 서버는 응답했지만, Chromium 콘솔에는 `Missing requestHandler or method: doValidation`이 나타났다. [일반 편집기](../apps/desktop/src/renderer/adapters/monaco-editor.ts), [Git 편집기](../apps/desktop/src/renderer/project/source-control/GitDiffEditor.svelte), [노트북 편집기](../apps/desktop/src/renderer/notebook/NotebookSurface.svelte)가 각각 전체 Monaco를 가져오면서 모든 worker 요청을 같은 worker로 보낸다.

```ts
window.MonacoEnvironment = {
  getWorker: () => new workerModule.default()
};
```

일반 editor worker에는 JSON language worker의 `doValidation`이 없다. 실제 오류가 그 worker에서 발생한 점과 위 코드가 일치한다. 따라서 JSON LSP가 전부 고장 났다는 결론은 과하다. 확인된 결함은 **동시에 활성화된 Monaco 내장 서비스의 worker 배선**이다. worker 선택을 한 모듈로 모으고 언어 label에 맞게 분기하거나, 외부 서버가 맡는 기능에 대해서만 내장 provider를 비활성화해야 한다. 외부 서버가 없을 때의 대체 기능, 중복 진단·자동완성 방지, 늦은 로딩을 함께 설계해야 한다. 공식 Monaco 통합 예제도 언어별 worker를 구분한다. [Monaco ESM 통합 문서](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)

노트북은 다른 종류의 경계 문제를 보인다. `test4.5.ipynb`는 basedpyright에 native notebook으로 연결됐고 자동완성 응답에 551개 항목이 있었다. 서버는 resolve를 지원한다고 알렸다. 그러나 같은 Setdown 요청 통로로 `completionItem/resolve`를 보내면 `Invalid notebook language request.`가 돌아왔다. [노트북 관측](lsp-submodule-audit-2026-10-17/evidence-python-standalone-rename-ui_python-project-rename-ui_python-superproject-rename-ui_css-min_rust-brave_notebook-nbformat.json)

[NotebookLanguageHost](../apps/desktop/src/main/language/notebook-language-host.ts)의 허용 목록에는 `textDocument/completion`만 있고 `completionItem/resolve`가 없다. renderer의 [NotebookLanguage](../apps/desktop/src/renderer/notebook/notebook-language.ts)도 resolver를 설치하지 않는다. 반면 서버 초기화에는 일반 문서와 같은 client capability를 써서 resolve 속성을 광고한다. 지원한다고 협상한 기능을 실제 경로에서는 제공하지 않는 셈이다.

자동완성 문맥도 별도 구현 사이에서 어긋났다. 일반 편집기는 Monaco의 trigger 종류를 LSP 값으로 변환하지만 노트북은 그대로 보낸다.

```ts
context: {
  triggerKind: context.triggerKind,
  triggerCharacter: context.triggerCharacter
}
```

제품의 노트북 provider에 Monaco의 0, 1, 2를 넣어 보면 전송값도 0, 1, 2다. LSP 값은 1, 2, 3이어야 한다. trigger 문자도 `['.']`로 고정돼 서버가 알린 `[`, 따옴표 등을 반영하지 않는다. 이 변환 실험은 가짜 port를 사용했고, 실제 노트북에서 모든 자동완성이 실패했다고 주장하는 근거로 쓰지 않았다. 실제 서버가 잘못된 문맥을 관대하게 처리하면 일부 동작은 가능하다. [LSP completion 규칙](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/completion.md), [경계 실험 결과](lsp-submodule-audit-2026-10-17/protocol-evidence.json)

일반 문서와 노트북이 공유할 것은 completion·signature·range·resolve 변환과 capability 계약이다. 셀 URI, 셀 버전, 노트북 버전, 여러 셀에 걸친 편집의 적용 여부는 별도 문서 어댑터에 남기는 편이 안전하다. 현재 command가 붙은 completion을 버리는 방어를 지우고 그대로 실행하는 식의 수정은 피해야 한다. 지원할 수 있는 command와 편집 경계를 먼저 정한 뒤 capability도 그 범위에 맞춰야 한다. LSP가 노트북 셀 URI와 문서 동기화를 별도로 정의한 이유도 이런 문맥을 보존하기 위해서다. [LSP notebook 문서](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/notebookDocument/notebook.md)

현재의 공통 feature 목록을 확장해 각 기능의 요청·resolve method, 일반 문서와 노트북에서의 구현 여부를 함께 관리할 수 있다. 이 정의에서 capability와 IPC 허용 범위를 만들고, 광고한 기능마다 실제 provider까지 도달하는 계약 검사를 붙이면 세 목록이 다시 어긋나는 것을 막기 쉽다. 아직 구현하지 않은 노트북 기능은 해당 경로의 capability에서 제외하고, 구현과 검사가 함께 준비됐을 때 광고해야 한다.

앞의 문제들이 서버와 문서 종류에 관한 것이라면, 다음 세 가지는 기능의 수명에 관한 것이다. 이번 표본에서 자연 발생한 실패와 구분하기 위해 [별도 스크립트](lsp-submodule-audit-2026-10-17/protocol-probe.mjs)가 실제 제품 클래스를 번들링해 실행했다. Monaco·IPC 경계는 통제된 대체 객체로 구성했고, 사용하지 않는 결과 UI mount만 stub으로 바꿨다.

첫째, 동적 등록은 여러 제공자가 동시에 살아 있을 수 있는 구조여야 한다. [ServerCapabilitiesState](../apps/desktop/src/main/language/server-capabilities.ts)는 registration ID별로 항목을 저장하지만, 특정 문서의 capability를 만들 때 같은 필드에 반복해서 대입한다.

```ts
if (key && this.matches(options.documentSelector, uri, language))
  Object.assign(result, { [key]: options });
```

같은 Python 문서에 identifier가 `types`, `lint`인 진단 제공자 둘을 등록하면 마지막 `lint`만 남는다. 등록 ID를 보관하는 것과 각 등록을 실행 가능한 provider로 유지하는 것은 다르다. renderer의 pull diagnostics도 binding당 하나의 `resultId`와 진단 배열만 가진다. 이 구조로는 겹치는 복수 진단 제공자의 결과와 캐시를 독립적으로 다루기 어렵다. 등록·해제를 provider 인스턴스 단위로 처리하고, 진단 상태를 최소한 세션·등록/identifier·문서별로 나눠야 한다. 해제할 때도 그 제공자의 결과만 제거해야 한다. [등록 규칙](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/registerCapability.md), [pull diagnostics 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/pullDiagnostics.md)

둘째, 오류를 빈 값으로 통일하면 서버의 취소 의미가 사라진다. [LanguageClient.request](../apps/desktop/src/renderer/language/language-client.ts)는 실패를 기록하고 `null`을 반환한다. `serverCancelSupport: true`를 광고하는 의미 토큰 요청에 `ServerCancelled(-32802)`를 주입했을 때도 결과는 `null`, 요청 횟수는 1이었다. 의미 토큰 명세는 이 capability를 지원하는 클라이언트가 서버 취소 뒤 다시 요청하도록 요구한다. [semantic tokens 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/semanticTokens.md)

해결하려면 JSON-RPC 오류의 `code`, `message`, `data`를 IPC를 넘어 보존해야 한다. 일반 실패, 사용자 취소, 서버 취소, 내용 변경을 구분하고 해당 feature가 재요청을 결정하게 해야 한다. pull diagnostics의 취소 데이터도 같은 통로로 전달할 필요가 있다. 새 버전이 이미 생겼다면 옛 버전을 재실행하지 않아야 하고, 연속 취소에는 횟수·대기 제한이 있어야 한다. 이는 제품의 프로토콜 처리 개선이며, 실패한 테스트를 재시도해서 통과시키자는 제안이 아니다. 이름 변경이나 command 같은 작업을 무조건 재실행해서도 안 된다.

셋째, resolve 핸들의 저장 한계가 반환한 결과의 유효성을 깨뜨릴 수 있다. [ServerItems](../apps/desktop/src/main/language/server-items.ts)는 renderer가 임의의 command나 서버 데이터를 제출하지 못하도록 원본 항목을 main에 보관한다. 이 소유권 검증은 유지해야 한다. 다만 현재는 결과를 재귀 순회하면서 `label`, `title`, `range`, `name`, `command` 중 하나만 있어도 핸들을 붙이고, 마지막에 오래된 항목을 삭제한다.

```ts
const resultWithHandles = visit(result);
while (this.items.size > 4096)
  this.items.delete(this.items.keys().next().value!);
return resultWithHandles;
```

단순 completion 4,097개를 반환시키면 첫 항목은 사용자가 선택하기도 전에 `Invalid or expired language item`이 된다. 마지막 항목은 정상적으로 resolve된다. 실제 표본의 최대 completion은 1,019개였으므로 이번 서브모듈 실행이 이 한계를 직접 넘긴 것은 아니다. 다만 resolve하지 않을 range·symbol과 이전 응답도 같은 한도를 소비한다. 필요한 응답 종류만 저장하고, 현재 UI에 제공한 목록의 수명과 저장소 수명을 연결하는 방식이 필요하다. 바이트 단위 상한도 두되, 이미 제공한 목록을 몰래 무효화하는 방식으로 상한을 지켜서는 안 된다.

이 문제를 해결할 참고 구현은 이미 서브모듈 안에 있다. [vscode-languageserver-node의 client](../vendor/vscode-languageserver-node/client/src/common/client.ts)는 `handleFailedRequest`에서 취소 코드를 구분하고 취소 데이터를 보존한다. [diagnostic 구현](../vendor/vscode-languageserver-node/client/src/common/diagnostic.ts)은 실행 중인 요청·오래된 요청·다시 예약할 요청을 구별한다. [Sublime LSP의 sessions.py](../vendor/sublime-lsp/plugin/core/sessions.py)는 진단 제공자를 registration ID로 등록·해제한다. Setdown이 여기서 가져올 것은 거대한 클래스의 모양보다 상태 전이와 소유권 규칙이다.

[monaco-languageclient](../vendor/monaco-languageclient/packages/client/src/wrapper/lcwrapper.ts)는 vscode-languageclient와 Monaco의 VS Code API 호환 계층을 연결한다. 이를 도입하면 프로토콜 처리의 많은 부분을 위임할 수 있지만 현재 Setdown의 IPC 검증, 일반 탭·Git 편집기의 공유 모델, Undo와 다중 파일 편집을 어떻게 보존할지 검증해야 한다. 즉시 전면 교체를 권하기에는 근거가 부족하다. 현재 어댑터의 conformance를 먼저 보강하고, 별도 실험에서 번들 크기·시작 비용·모델 소유권·노트북 호환성을 비교하는 편이 낫다.

[JupyterLab의 virtual document](../vendor/jupyterlab/packages/lsp/src/virtual/document.ts)는 셀·외부 언어 조각·원래 위치를 추적하는 자료 구조를 제공한다. 나중에 Markdown fenced code나 혼합 언어 문서를 지원한다면 이런 위치 대응 모델을 참고할 가치가 있다. 현재 Python 노트북의 native 동기화를 성급하게 합친 가상 파일로 바꿀 근거는 아니다. Markdown을 열기만 해도 서버와 workspace 분석을 시작하는 방식 역시 현재 제품의 가벼운 기본 동작과 충돌한다.

환경 때문에 기능이 제한된 경우는 별도로 다뤄야 한다. Dolphin에서는 Qt 헤더를, Ptyxis에서는 생성된 `config.h`와 개발 의존성을 찾지 못했다. clangd는 빌드 명령이 없으면 fallback 명령으로 분석하므로 잘못된 진단이 생길 수 있다. 이번 결과는 clangd 연결·요청 경로가 작동한다는 근거지만 이 두 프로젝트의 정확한 C/C++ 분석 품질을 보증하지는 않는다. Language Support에서 compile database 탐색 결과와 실제 빌드 명령을 확인할 수 있게 하는 개선이 적절하다. 개발 환경이 준비된 별도 시나리오도 필요하다. [clangd compile commands 설명](https://clangd.llvm.org/design/compile-commands)

Rust에서는 실행 경로를 발견한 것만으로 `available: true`였지만 실제 시작은 실패했다. 오류 로그가 남는 점은 좋다. 다만 ‘실행 파일 발견’, ‘서버 시작 성공’, ‘분석 준비’를 서로 구분하면 사용자 판단이 쉬워진다. 모든 후보를 발견 즉시 실행하기보다 선택·연결 시점에 제한된 확인을 하고 결과를 캐시하는 방식을 권한다. JupyterLab의 누락된 Python 패키지와 Crossnote의 일부 타입 선언 문제도 의존성 환경의 문제로 분류했다. basedpyright가 nbformat의 오래된·비정상 노트북 fixture를 읽다 낸 오류 역시 이 표본의 특성까지 함께 보아야 한다.

장기적으로는 복수 서버를 기능별로 조합할 수 있다. 현재 생성기는 Ruff나 ESLint 같은 보조 서버가 주 서버를 대체하지 않도록 기본 선택에서 조심스럽게 다룬다. 이 정책은 현재 구조에서 합리적이며 LSP 위반도 아니다. 다만 Pyright의 타입 정보와 Ruff의 lint를 함께 쓰려면 URI당 주 서버 하나라는 모델을 확장해야 한다. 진단은 제공자별로 합치고, formatting·rename은 명시적으로 하나를 선택하며, code action은 원래 서버와 command 소유권을 유지해야 한다. 동적 등록과 resolve 수명 문제를 먼저 고치면 이 확장을 위한 기반도 만들어진다.

같은 맥락에서 설정 조회의 `scopeUri`, 여러 workspace folder, watcher 범위도 분석 프로젝트와 함께 설계해야 한다. 현재 configuration handler는 section만 조회하고 세션 설정을 반환한다. 단일 루트·동일 설정에서는 충분하지만 중첩 프로젝트의 interpreter와 설정을 나누기에는 부족하다. watcher가 넓은 루트 전체를 감시하는 비용도 루트 선택과 연결된다. 이번 조사는 watcher의 CPU·메모리 비용을 측정하지 않았으므로 수치상 회귀로 주장하지 않는다. [workspace configuration](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/configuration.md), [watched files 명세](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/didChangeWatchedFiles.md)

사용자와 서버가 대화할 통로도 개선할 수 있다. `showMessageRequest`는 현재 로그를 남기고 항상 `null`을 반환한다. 이는 명세상 가능한 취소 응답이지만, 서버가 환경 선택이나 재시작을 제안해도 사용자가 행동을 고를 수 없다. 문서·서버 문맥을 붙인 비차단 알림에서 실제 action을 선택하도록 연결하면 좋다. 이것은 위의 데이터 누락 문제보다 뒤에 둘 제품 개선이다. [showMessageRequest 정의](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/showMessageRequest.md)

구현 순서는 다음처럼 나누면 각 변경의 효과를 확인하기 쉽다. 표의 완료 기준은 앞으로 추가할 검사이며 이번에 이미 통과했다고 주장하는 항목이 아니다.

| 작업 묶음 | 주로 바꿀 모듈 | 완료 기준 |
| --- | --- | --- |
| 분석 프로젝트와 환경 | `language-manager`, `server-definitions`, `python-analysis`, registry | 세 가지 여는 방식에서 nbformat rename 대상이 일치; 중첩 패키지·서브모듈·Cargo workspace fixture로 의도한 경계를 검증 |
| 서버 프로필 | `update-language-profiles.py`, overrides, 생성 프로필 | TS 힌트와 CSS 오류 진단이 기본 설정으로 나옴; 초기화 옵션과 workspace 설정 변경이 각각 올바른 통로로 전달됨 |
| 노트북 completion 계약 | `notebook-language`, `notebook-language-host`, `language-features` | 세 trigger 값, 협상한 문자, lazy resolve, 추가 편집을 검사; 닫힌 셀·바뀐 버전에는 적용하지 않음 |
| provider와 요청 수명 | `server-capabilities`, `language-client`, `language-diagnostics`, `server-items` | 겹친 두 진단 등록의 독립 실행·해제, 서버 취소 후 올바른 재요청, 살아 있는 completion 목록의 resolve 보장 |
| Monaco 서비스 배선 | 공통 Monaco 초기화와 일반/Git/노트북 진입점 | JSON/CSS/HTML의 worker 오류 없음; 내장·외부 서비스 중복 없음; 외부 서버 없는 상태도 검사 |
| 사용자가 확인할 문맥 | Language Support UI, discovery, server session | 실제 루트·interpreter·TS 버전·compile database·최근 실패 단계가 설명됨 |
| 기능별 복수 서버 | registry, provider dispatch, 진단·액션 집계 | 타입 서버와 linter 동시 사용; 편집·command의 원래 서버 식별과 Undo 유지 |

검사는 세 층으로 유지하는 것이 좋다. 첫 층은 이번 경계 실험을 작고 결정적인 회귀 테스트로 옮기는 것이다. 등록·해제 순서, cancellation code와 data, 4,096개 안팎의 목록, 셀 좌표·UTF-16 변환을 검사한다. 두 번째는 고정한 실제 서버와 작은 프로젝트 fixture다. 폴더 구조, 미저장 버퍼, 환경 설정, 서버의 동적 응답이 기대한 결과를 만드는지 본다. 세 번째는 실제 서브모듈에서 UI와 응답을 함께 확인하는 정기 검사다. 서브모듈이 변하면 commit과 파일 hash를 기록하고, 기대값을 바꾼 이유도 검토해야 한다.

새 검사는 기존의 강점을 보존해야 한다. 현재 테스트가 확인하는 미저장 버퍼, Unicode 증분 변경, 열지 않은 파일의 rename, Undo, Save As 재연결, 서버 crash 뒤 복구, 프로세스 회수, Git Working Tree의 공유 모델은 중요한 자산이다. 오래된 편집을 막는 generation·version 검사와 main 소유의 URI·command 검증도 유지해야 한다. 이번 조사에서 잘못된 버전으로 보낸 관측 요청이 거절된 것은 그 방어가 작동한 사례였다. [기존 테스트 로그](lsp-submodule-audit-2026-10-17/unit-unsandboxed.log), [Electron 테스트 로그](lsp-submodule-audit-2026-10-17/e2e.log)

workspace edit의 resource operation은 현재 capability에서 빈 목록으로 제한한다. 파일 생성·삭제를 지원한다고 허위 광고한 것은 아니다. 이를 확장한다면 문서 편집과 파일 작업의 실패·취소·Undo 모델을 먼저 정해야 한다. 버전 없는 push diagnostics도 서버가 버전을 보내지 않은 한 최신 스냅샷의 결과라고 증명할 수 없다. 현재의 best-effort 처리를 절대적인 최신성 보장으로 설명해서는 안 된다. [WorkspaceEdit 규칙](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/types/workspaceEdit.md), [publishDiagnostics 규칙](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md)

Monaco 초기화나 source/reader 전환에 영향을 주는 개선을 실제로 구현할 때는 [preview 성능 계약](../docs/preview-performance-contract.md)의 검사를 함께 실행해야 한다. `npm run test:preview-contract`와 설치된 별도 baseline을 사용하는 `npm run bench:preview -- --baseline /absolute/path/to/installed-baseline`이 해당한다. baseline과 candidate는 같은 격리 display를 쓰고, 일반 Markdown·Git review 각각에서 편집 유무와 준비 시간 유무를 나눠 첫째·둘째·warm cycle을 보고해야 한다. 이번에는 제품 코드를 바꾸지 않았으며 이 preview 벤치마크를 수행했다고 주장하지 않는다. 앞의 LSP 요청 시간도 그 벤치마크를 대신하지 않는다.

보고서와 실험 도구만 추가했다. 제품 구현과 서브모듈 소스는 수정하지 않았다. 다음 변경의 출발점으로는 루트 선택과 프로필 전달을 권한다. 둘 다 이번 재료에서 사용자에게 돌아가는 결과를 실제로 바꾸었고, 현재의 넓은 기능 지원을 더 믿을 수 있게 만드는 데 직접 연결된다.

<details>
<summary>실행 방법, 증거 파일, 실패한 관측의 처리</summary>

아래 명령은 저장소 루트 기준이다. 현재 설치된 저장소 의존성을 사용했다. 외부 서버는 증거 디렉터리의 lockfile로 임시 경로에 재현할 수 있다.

```sh
npm run build
npm run build:electron --workspace @setdown/desktop
npm test --workspace @setdown/desktop -- --run src/main/language src/renderer/language src/renderer/notebook/notebook-language.test.ts

# 기존 GUI suite는 apps/desktop에서 실행
cd apps/desktop
bash scripts/with-isolated-display.sh ../../node_modules/.bin/playwright test test/e2e/language --config playwright.config.ts
cd ../..

# 조사용 외부 서버: 사용자 전역 설치와 프로젝트 package 파일을 바꾸지 않음
mkdir -p /tmp/setdown-lsp-audit-tools-20261017
cp reports/lsp-submodule-audit-2026-10-17/tools/package.json /tmp/setdown-lsp-audit-tools-20261017/
cp reports/lsp-submodule-audit-2026-10-17/tools/package-lock.json /tmp/setdown-lsp-audit-tools-20261017/
npm ci --prefix /tmp/setdown-lsp-audit-tools-20261017 --ignore-scripts --no-audit --no-fund

# 전체 관측 또는 이름으로 선택한 관측. 같은 이름의 JSON은 다시 쓸 수 있음
bash apps/desktop/scripts/with-isolated-display.sh node reports/lsp-submodule-audit-2026-10-17/probe.mjs python-standalone python-project python-superproject
bash apps/desktop/scripts/with-isolated-display.sh node reports/lsp-submodule-audit-2026-10-17/probe.mjs css-min-invalid css-min-configured-invalid
node reports/lsp-submodule-audit-2026-10-17/protocol-probe.mjs
python3 reports/lsp-submodule-audit-2026-10-17/summarize.py
```

`probe.mjs`는 독립 LSP 클라이언트를 만드는 대신 실제 Setdown renderer, preload API, IPC handler, LanguageManager, ServerSession을 통과시킨다. 문서를 여는 UI 통로를 이용하고 main handler를 감싸서 호출·응답을 관측한다. 일반 요청은 공개된 내부 language API로 보내며 자동완성과 rename 일부는 실제 키 입력으로 검증한다. 모든 기능의 UI를 검사한 것은 아니다. formatting 응답은 저장하지 않는다. 요청 오류를 JSON에 기록하고 다음 관측을 계속하므로 **프로세스 종료 코드 0은 모든 시나리오 통과를 뜻하지 않는다.**

```text
reports/
├── 2026_10_17_12_31_setdown_lsp_submodule_audit.md
└── lsp-submodule-audit-2026-10-17/
    ├── corpus.json              # 26개 서브모듈 commit·추적 파일·확장자
    ├── environment.json         # 실제 설치 환경
    ├── probe.mjs                # 실제 Setdown/Electron/서버 관측
    ├── protocol-probe.mjs       # 제품 클래스의 통제된 경계 실험
    ├── summarize.py             # 보고서가 사용한 결과의 색인 생성
    ├── summary.json             # 26개 시나리오의 원본 위치·요약
    ├── evidence.json            # 최초 기본 14개 시나리오
    ├── evidence-*.json          # 조건 비교·UI·추가 언어 결과
    ├── protocol-evidence.json   # 네 경계 실험
    ├── tools/package*.json      # 임시 외부 서버의 잠긴 의존성
    ├── *.log                   # build·단위·GUI·관측 로그
    └── *.png                   # 성공 및 실패 시점의 실제 화면
```

최초 build와 일부 단위 테스트는 실행 환경의 자식 프로세스 제한으로 `spawn EPERM`을 냈다. Svelte/typecheck와 Vite는 통과했고 Electron 빌드의 git 호출이 막혔다. 같은 소스에서 프로세스 실행을 허용한 뒤 Electron 빌드와 82개 테스트가 통과했다. 원래 실패 로그도 보존했다. 이를 제품 결함으로 세거나 assertion을 줄여 통과시키지 않았다.

관측 도구 자체에도 수정 과정이 있었다. 첫 rename UI 관측은 Go to Line 입력의 `:` 접두사가 빠져 목표 위치에 도달하지 못했다. 이를 수정한 별도 실행으로 두 루트의 UI 결과를 확인했다. 전체 프로젝트의 5초 rename assertion 실패는 그대로 남겼고 제한 시간을 늘려 성공으로 바꾸지 않았다.

기존 Python 식별자 안에서 Ctrl+Space를 누르는 관측은 10초 안에 위젯을 찾지 못했다. 그 결과는 실패 기록으로 남아 있다. 별도의 실제 타이핑 시나리오에서는 파일 끝에 `from_di`를 입력해 `from_dict` 제안을 확인했다. 두 조건을 같은 성공으로 합치지 않았다. 초기 TypeScript 클래스 선언부의 위젯은 단어 기반 제안일 수 있으므로 LSP UI 성공의 근거에서 제외하고, `this.get` 참조 위치의 후속 결과를 사용했다.

CSS 삽입 관측 초반에는 여러 변경 알림이 진행되는 동안 오래된 version으로 요청했고, 후속 계측 수정에도 Electron evaluate 인자 위치 오류가 있었다. 두 경우의 `Invalid or stale language request`는 관측 도구의 잘못이다. 그 JSON과 로그를 남겼고, 인자 위치를 고친 최종 비교에서 요청 오류 없이 진단 0개와 2개의 차이를 확인했다. 최종 CSS 근거는 `evidence-css-min-invalid_css-min-configured-invalid.json`이다. 앞선 실패는 `css-invalid-initial-probe.json`, `css-invalid-stale-probe.json`, `evidence-python-completion-ui_css-min-invalid_css-min-configured-invalid.json`의 CSS 항목에 남아 있다.

`summary.json`은 이 구분을 명시한 원본 선택 목록으로 생성했다. 원본에는 출력 길이를 줄이기 위해 completion 일부 항목, 의미 토큰 일부 정수, formatting 일부 편집만 저장한 곳이 있다. 전체 서버 wire trace나 성능 통계 자료라고 간주하면 안 된다. 서버 시작·기능 응답·UI 관측·환경 실패가 섞여 있으므로 시나리오 수를 나눠 지원률을 계산하지 않았다.

</details>

<details>
<summary>검토한 명세와 비교 코드</summary>

명세는 실제 설치된 protocol 패키지의 버전 번호와 구분했다. 주요 계약은 LSP 3.17의 원문으로 검토했고, [3.18 meta model](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/metaModel/metaModel.json)도 참조했다. 특정 패키지를 올리기만 하면 현재 어댑터가 그 기능을 모두 구현하게 되는 것은 아니다. 웹 문서는 2026-10-17 열람 기준이며 upstream main/master 링크는 이후 달라질 수 있다. 서브모듈 비교는 [corpus.json](lsp-submodule-audit-2026-10-17/corpus.json)의 commit에 고정된다.

| 읽은 자료 | 이번 판단에 사용한 부분 |
| --- | --- |
| [LSP 기본 specification](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/specification.md) | 초기화, capability 협상, 오류·취소의 기본 구분 |
| [completion](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/completion.md) | trigger 종류, item defaults, resolve 계약 |
| [semantic tokens](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/semanticTokens.md) | full/delta/range 및 서버 취소 |
| [pull diagnostics](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/pullDiagnostics.md) | identifier, resultId, unchanged 결과, 취소 후 재요청 |
| [publish diagnostics](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md) | 선택적인 version과 기존 진단 대체 |
| [register capability](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/registerCapability.md) | registration ID와 document selector |
| [configuration](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/configuration.md) | section, scopeUri, 누락 설정의 null |
| [watched files](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/didChangeWatchedFiles.md) | 등록한 watcher의 패턴과 상대 base |
| [willRenameFiles](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/workspace/willRenameFiles.md), [workspace edit](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/types/workspaceEdit.md) | 파일 작업과 문서 편집의 capability·실패 계약 |
| [didChange](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/textDocument/didChange.md), [willSaveWaitUntil](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/textDocument/willSaveWaitUntil.md) | 변경 순서, 저장 전 편집과 시간 제한 |
| [notebook](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/notebookDocument/notebook.md) | 셀 문서와 노트북 동기화 |
| [signature help](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/signatureHelp.md), [document highlight](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/documentHighlight.md) | 위치·enum·활성 서명 변환 점검 |
| [TypeScript 서버 설정](https://raw.githubusercontent.com/typescript-language-server/typescript-language-server/master/docs/configuration.md) | 초기화 옵션과 언어별 workspace 설정의 구분 |
| [Helix 언어 설정](https://raw.githubusercontent.com/helix-editor/helix/master/book/src/languages.md) | 가져온 프로필의 config·root 의미가 Setdown 정책과 같은지 검토 |
| [Pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md), [import resolution](https://raw.githubusercontent.com/microsoft/pyright/main/docs/import-resolution.md) | 프로젝트·환경에 따른 분석 차이 |
| [clangd compile commands](https://clangd.llvm.org/design/compile-commands) | 헤더·빌드 환경 누락과 fallback 분석 |
| [Monaco ESM 통합](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md) | 언어별 worker 선택 |
| [vscode-languageserver-node](../vendor/vscode-languageserver-node/client/src/common/) | 취소, 진단 요청 상태, feature 등록 수명 |
| [Sublime LSP](../vendor/sublime-lsp/plugin/core/sessions.py) | 진단 제공자별 등록·해제, refresh와 서버 메시지 처리 |
| [monaco-languageclient](../vendor/monaco-languageclient/packages/client/src/wrapper/lcwrapper.ts) | 기존 LSP 클라이언트와 Monaco 호환 계층의 연결 비용 |
| [JupyterLab virtual document](../vendor/jupyterlab/packages/lsp/src/virtual/document.ts) | 셀·추출 언어·원문 좌표 대응의 설계 참고 |

</details>
