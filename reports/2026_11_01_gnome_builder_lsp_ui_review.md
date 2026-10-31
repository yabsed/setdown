# GNOME Builder를 참고한 Setdown 언어 지원 UI 검토

2026년 11월 1일 · 설계 제안 · 제품 코드 변경 없음

**현재 LSP UI는 시각적으로 정돈되어 있지만, 사용자가 이해해야 할 개념까지 단순해진 상태는 아니다.** Python 파일 하나를 편집하려는 사람이 문서 언어, 분석 서버, Python 환경, 분석 루트, 검사 범위, 서버 프로세스 상태를 같은 화면에서 구별해야 한다. 문제는 색이나 여백보다 **첫 화면에 배정한 책임이 너무 많다는 것**이다.

권고는 **평소에는 작은 언어 버튼, 클릭하면 현재 문서의 짧은 요약과 환경 변경, 문제가 생기면 직접적인 복구 행동, 서버 관리와 원시 정보는 별도 상세 화면**이다. 현재 위치 표시줄과 사이드바를 사용하면 된다. 새 전역 상태 표시줄이나 IDE 모드는 필요하지 않다.

GNOME Builder에서 강하게 가져올 부분은 이 책임 분리다. Builder는 언어 모드, 코드 주변 기능, 프로젝트의 빌드 환경, 플러그인 설정, 로그를 각각 다른 접점에 배치한다. 동시에 프로젝트와 실행 환경을 내부에서 연결해 사용자에게 필요한 선택 자체를 줄인다. 다만 프로젝트 없는 편집, 실패의 발견 가능성, 여러 분석 도구 조합은 Setdown의 현재 보장을 유지하거나 더 명확하게 해야 한다.

[상태별 화면안 열기](gnome-builder-lsp-ui-2026-11-01/concept.html) · [정상 화면 이미지](gnome-builder-lsp-ui-2026-11-01/normal.png) · [환경 누락 화면 이미지](gnome-builder-lsp-ui-2026-11-01/missing.png) · [코드 근거와 분석 범위](#코드-근거와-분석-범위)

## 지켜야 할 Setdown의 방향

현재 README는 Markdown·코드·노트북·웹을 원하는 탭 배치로 함께 사용하는 작업 공간을 설명한다. 실제 계약도 파일 하나를 여는 것만으로 폴더를 프로젝트로 지정하지 않고, 분할 창의 문서·포커스·위치를 독립적으로 유지한다. 따라서 초기 보고서의 ‘탭 없는 단일 Markdown 앱’ 제안을 현재 철학으로 되돌려 적용해서는 안 된다. 현재 제품에서 유지해야 할 기준은 다음과 같다. [제품 소개][S-readme] · [워크스페이스 계약][S-workspace] · [그룹 소유권][S-groups]

| 기준 | 언어 지원 UI에 적용하면 |
| --- | --- |
| 작업 중인 문서가 중심이다 | 서버 목록보다 현재 파일에서 무엇이 가능한지 먼저 답한다 |
| 사용자가 탭과 분할을 구성한다 | 한 창에 프로젝트 하나만 있다고 가정하지 않는다 |
| 도구는 필요할 때 접근한다 | 정상 편집에 큰 설정 패널이나 지속적인 성공 메시지를 요구하지 않는다 |
| 같은 문서에서 작업을 이어 간다 | 환경 변경·서버 복구가 내용, Undo, 스크롤, 포커스를 흔들지 않는다 |
| 실제 상태를 정직하게 표현한다 | 연결됨·결과 수신·분석 범위·환경 문제를 내부에서 구별한다 |

이 기준은 기능을 줄이라는 뜻이 아니다. 일반 사용자는 언어 서버의 이름을 몰라도 편집할 수 있어야 하고, 문제가 생긴 사용자는 필요한 근거와 제어권에 도달할 수 있어야 한다.

## 지금 화면이 복잡하게 느껴지는 이유

### 서로 다른 질문이 같은 위계를 가진다

첫 스크린샷의 `Language support`에는 다음 질문이 함께 있다.

| 현재 항목 | 사용자가 실제로 묻는 질문 | 적합한 위치 |
| --- | --- | --- |
| Language mode | 이 문서를 어떤 언어로 읽을까 | 문서의 짧은 메뉴 |
| Python environment | 이 프로젝트의 패키지를 어디에서 찾을까 | 현재 프로젝트의 환경 선택 |
| Analysis provider | 어떤 분석 도구를 쓸까 | 상세 설정, 또는 선택이 필요한 순간 |
| Connected / 기능 목록 | 이 도구가 연결됐고 무엇을 제공할까 | 상세 정보; 제한이 있을 때만 요약 |
| Project root / 환경 근거 | 왜 이 환경이 적용되었을까 | 프로젝트 이름 옆 상세 정보 |
| Restart project services | 현재 분석을 복구할 수 있을까 | 실패 시 첫 행동, 정상 시 추가 동작 |
| Set up analysis… | 도구를 설치하거나 연결할까 | 선택한 언어·문제를 전달한 관리 화면 |

사용자는 매번 이 분류를 머릿속에서 해야 한다. `Language mode`는 문서 범위, 환경과 provider 선택은 프로젝트 범위, 카탈로그의 Enable/Disable은 전역 기본값, `Restart servers in this window`는 창 범위다. 같은 위치의 비슷한 버튼처럼 보이지만 영향 범위가 다르다. [문서 팝오버][S-status] · [환경 UI][S-env] · [서버 관리][S-catalog]

### 복구보다 설명이 앞에 있다

현재 팝오버는 언어 선택과 설명, 프로젝트 경로, provider, 환경 선택과 설명을 먼저 배치한다. 프로젝트 문제는 이 뒤에 나오고, provider 실패와 재시작은 더 아래에 있다. 작은 화면에서는 **정작 해결해야 하는 문제가 스크롤 아래로 내려갈 수 있는 순서**다.

정상 상태에서도 다음 내용을 반복해서 읽게 한다.

- 문법 강조가 서버 없이도 동작한다는 설명.
- 환경 변경이 Undo를 보존한다는 설명.
- 긴 프로젝트 경로와 interpreter 경로.
- 연결 상태와 지원 기능 목록.

문법 강조와 Undo 보존은 중요한 제품 보장이다. 그러나 일반적인 선택 화면에서 매번 읽어야 하는 주의사항으로 만들 필요는 없다. 실제 제한이 있는 경우의 설명과 사용 안내로 옮기는 편이 낫다. [현재 배치][S-status] · [환경 설명][S-env]

### 내부 사실을 사용자에게 유용한 의미로 바꾸는 단계가 부족하다

두 번째 스크린샷의 Pyright 화면은 이 문제가 더 분명하다.

| 표시 | 실제 의미 | 권장 표현 |
| --- | --- | --- |
| Executable: `…/electron/dist/electron` | 내장 Pyright를 실행하는 Node 호환 런타임 | 첫 화면에는 `Pyright · 앱에 포함됨`; 런타임 경로는 실행 정보에 |
| `ready`, Running, Connected | 서로 다른 표면에서 표현한 연결·세션 상태 | 사용자 화면에서는 `연결됨`으로 일관되게 표현하고 내부 상태는 상세에 |
| `completion, signatureHelp, …` | 프로토콜 기능 식별자 | 필요할 때 `자동완성`, `매개변수 힌트` 등의 사용자 용어 |
| `Analysis paths: []` | 클라이언트 설정에서 전달한 경로 정보 | 검색 경로 전체가 비었다고 오해하지 않도록 출처와 함께 상세에 |
| 긴 context 문자열 | 환경 선택·설정 파일·서버 책임의 여러 근거 | 환경, 설정 출처, 적용 범위라는 이름 있는 항목으로 |

Electron 경로는 이 화면의 오류 메시지가 아니다. 실제 `ServerRegistry`는 내장 서버를 `process.execPath`와 `ELECTRON_RUN_AS_NODE=1`로 실행한다. **정확한 구현 정보여도 정상 사용자의 첫 판단에는 도움이 되지 않는 사례**다. [내장 서버 실행][S-launch]

`Open-file checks`는 프로젝트 전체 검사가 끝났다고 주장하지 않는다는 점에서 정직하다. 다만 정상 상태에서 계속 차지하는 공간에 비해 사용자가 할 일을 알려주는 가치는 작다. 이 사실은 클릭 후 검사 범위에 남기고, 평소 버튼은 `Python`만 보여주는 것이 더 적절하다. `Python`이라는 언어명 자체를 ‘모든 분석 정상’의 인증 표시로 사용해서는 안 된다. [상태 요약 함수][S-label]

### 지금 잘된 부분도 있다

현재 파일 가까이에 진입점이 있고, 전역 카탈로그와 문서 상태가 분리되어 있으며, 기본 편집을 지원되는 상태로 다룬다. 고급 JSON, 로그, 환경의 근거도 이미 존재한다. 버퍼 보존·자동 복구·진단 소유권의 기반 역시 구현되어 있다. 이를 버리고 새로운 서버 관리 체계를 만드는 작업은 우선순위가 아니다. [현재 언어 지원 계약][S-language]

10월 30일 설계도 이미 짧은 현재 문서 요약과 실패 시 직접 복구를 제안했다. 현재 UI는 그 기반 기능을 갖추는 과정에서 설정과 설명이 한 팝오버에 누적된 모습이다. 이번 권고는 그 방향을 구체적인 노출 규칙과 화면 경계로 완성한다. [이전 UI 제안][S-prior]

## Builder가 실제로 나누어 놓은 책임

아래는 저장소에 고정된 Builder `0e4dbc7a`의 코드에서 확인한 동작이다. GNOME의 일반 디자인 지침과 Builder의 실제 구현을 구분한다.

### 언어 버튼은 문서의 언어만 선택한다

`gbp-editorui-workspace-addin.c`는 현재 buffer의 `language-id`에 연결된 syntax 메뉴를 상태 표시줄에 추가한다. 줄바꿈 형식, 인코딩, 들여쓰기, 커서 위치도 각각의 항목이다. 이 언어 메뉴에 서버 실행 경로나 프로젝트 환경 form을 함께 붙이지 않는다. **버튼 이름과 변경 대상이 일치한다.** [Builder 언어 메뉴][B-editor]

Setdown은 이 분리 원칙을 가져오되 상태 표시줄 전체를 복제할 필요가 없다. 위치 표시줄에 이미 있는 진입점을 쓰고, 그 안에서 ‘이 문서’와 ‘프로젝트 환경’을 명확히 나누면 된다.

### 기능은 코드를 다루는 위치에 나타난다

`gbp-codeui-hover-provider.c`는 포인터가 가리키는 줄의 diagnostics를 buffer에서 가져와 Hover에 표시한다. codeui 메뉴는 정의·참조·이름 변경·코드 동작의 진입점이다. 기능 목록을 먼저 읽지 않아도 코드 위에서 기능을 발견하는 구조다. [Builder 진단 Hover][B-hover] · [코드 메뉴][B-menu]

Setdown은 Monaco의 Hover·자동완성·빠른 수정·탐색을 이미 가지고 있다. 팝오버의 `Completion · Hover · …` 목록은 일상 동선에서 이 기능들을 중복 설명한다. 기능 제한이 발생했을 때 ‘자동완성은 사용 가능하지만 추가 lint 검사는 중단됨’처럼 차이를 설명하는 쪽이 유용하다.

### 환경은 프로젝트의 설정으로 다룬다

Builder의 프로젝트 omnibar에는 Branch, Build Profile, Runtime, Device 요약과 빌드 설정 문제 표시가 있다. 자세한 설정은 tweaks의 build configuration으로 이어지며 runtime, 환경 변수 등을 다룬다. **문서 언어를 정하는 장소와 프로젝트가 어떤 환경에서 동작하는지 정하는 장소가 다르다.** [프로젝트 요약][B-omni] · [빌드 환경 설정][B-tweaks]

이 구조는 단순히 form을 옮긴 결과만은 아니다. `IdeLspService`는 빌드 환경, host, 추가 경로, Builder 실행 환경 순으로 서버 실행 경로를 찾고 tooling 환경을 적용한다. 프로젝트 환경이 분석 실행의 입력이 되므로 사용자가 프로세스 경로를 일일이 조립할 필요가 줄어든다. [LSP 실행 환경][B-service]

Setdown의 대응물은 Python 환경, TypeScript SDK, C/C++ build configuration이다. `Runtime`이라는 일반 용어를 그대로 도입하기보다는 사용자가 실제로 고르는 대상의 이름을 보여주는 편이 좋다.

### 플러그인과 로그는 별도 관리 접점에 있다

Builder의 플러그인 설정은 이름·설명·활성화 switch를 가진 expander row로 구성된다. 이 목록은 application 설정에서 추가된다. 프로젝트의 개별 환경 선택과 전역 플러그인 활성화를 구분하는 실제 코드다. [플러그인 설정 생성][B-plugins]

공통 LSP client는 `$/progress`를 진행 알림으로 바꾸고 종료 시 철회한다. `window/showMessage`와 `window/logMessage`는 context log 경로로 전달한다. Messages 패널은 context의 로그를 표시하며, LSP stderr를 console에 보내는 옵션은 Build & Tooling 아래에 있다. **평상시 상태, 잠시 진행되는 작업, 문제 조사 자료가 같은 긴 화면을 공유하지 않는다.** [LSP 메시지 처리][B-client] · [진행 알림 UI][B-notification] · [Messages 패널][B-messages] · [로그 옵션][B-tweaks]

여기서 ‘조용함’을 무조건 복제하면 안 된다. 확인한 공통 코드의 `showMessage` 처리 자체가 Setdown처럼 필요한 복구 선택을 앞에 보여주는 체계는 아니다. Setdown의 직접 복구 버튼과 서버의 선택 요청 처리는 유지해야 한다.

### Builder도 전제를 가진다

| 그대로 일반화하면 안 되는 주장 | 코드가 실제로 말하는 것 | Setdown의 결정 |
| --- | --- | --- |
| 파일만 열어도 모든 LSP가 같은 방식으로 연결된다 | 공통 `bind_client_internal()`의 서비스 확보는 `ide_context_has_project()` 안에 있다 | 폴더 열기를 강제하지 않고 파일의 분석 문맥을 사용 |
| 파이프라인 준비가 곧 분석 완료다 | `ide_pipeline_is_ready()`는 pipeline의 loaded 상태를 반환한다 | 연결·환경·분석 결과를 별도로 보존 |
| 환경 때문에 생긴 진단을 알아서 제거한다 | 공통 client는 서버 진단을 받아 변환한다 | 실제 진단을 숨기지 않고 환경을 고침 |
| 빌드 오류 팝오버가 모든 LSP Problems의 구현이다 | `gbp-buildui-status-popover.c`는 build pipeline의 diagnostics에 연결된다 | 현재의 공통 DiagnosticStore와 Problems를 유지 |
| 작은 화면이면 실패도 잘 해결된다 | 조용한 로그 처리와 복구의 발견 가능성은 별개다 | 행동이 필요한 실패는 문서 가까이 드러냄 |

근거: [공통 서비스][B-service] · [파이프라인 상태][B-pipeline] · [LSP client][B-client] · [빌드 진단 팝오버][B-build-diag]. 별도 Foundry 프로젝트의 LSP 선택 기능을 이 Builder 버전의 기능으로 합쳐 서술하지 않는다.

GNOME HIG도 작은 팝오버에 여러 종류의 조작을 과도하게 섞지 말고, 자주 쓰는 행동을 가까이 두며, 덜 중요한 기능은 단계적으로 드러내라고 권한다. 이는 현재 팝오버의 문제를 설명하는 지침이지만, 특정 높이나 버튼 개수가 최적이라는 실험 결과는 아니다. [팝오버 지침](https://developer.gnome.org/hig/patterns/containers/popovers.html) · [설계 원칙](https://developer.gnome.org/hig/principles.html)

## 권장하는 정보 구조

사용자의 질문을 다음 세 단계로 나눈다. 화면을 세 개 새로 만드는 것이 아니라 기존 두 표면에 깊이를 부여한다.

```text
문서의 위치 표시줄
  Python ▾                         평소
  Python · 환경 선택 필요          조치가 필요한 경우
        │
        └─ 짧은 현재 문서 팝오버
             이 문서의 언어
             현재 프로젝트와 환경 → 환경 선택 화면
             필요한 조치 / 문제 보기
             자세히… ─────────────┐
                                  ↓
                     기존 Language Support 사이드바
                       현재 문서의 분석 상세
                       프로젝트 환경과 도구 설정
                       분석 도구 관리 → 기존 카탈로그
                       실행 정보 / 로그 / 고급 연결 설정
```

### 평상시 버튼

정상 동작 중에는 `Python ▾`처럼 언어명만 중립색으로 표시한다. 녹색 점이나 `정상`, `완료`를 기본 보상처럼 붙이지 않는다. 자동 복구 중이거나 필요한 기능이 제한되면 짧은 상태를 덧붙인다. 선택적으로 진행을 표시하되 입력마다 문구가 계속 깜박이거나 주소 영역 폭이 출렁이지 않게 한다.

좁은 그룹에서도 문제 아이콘과 접근성 이름은 유지한다. 보조 문구를 숨겨도 문제 여부까지 사라져서는 안 된다. 현재는 창 너비 media query로 보조 문구를 숨기므로, 구현 시에는 **창 전체가 아니라 실제 그룹에 남은 폭**을 기준으로 검토한다. [현재 responsive 규칙][S-status]

### 정상 상태의 짧은 팝오버

```text
코드 지원                                      ×

이 문서
언어                                Python  ›

프로젝트                        chess / backend
Python 환경                          .venv  ›

Pyright 연결됨 · 열린 파일의 검사 결과 수신

문제 보기                             자세히…
```

‘프로젝트’는 Explorer의 폴더를 무조건 사용하지 않고 **이 파일에 적용된 분석 루트**를 의미한다. `chess / backend`는 긴 경로의 읽기 쉬운 표시 예다. 같은 이름이 충돌하면 필요한 상위 경로를 추가하고, 키보드로 접근 가능한 상세에서 전체 경로를 확인·복사할 수 있어야 한다.

이 첫 화면에는 상시 provider dropdown, 전체 capability 목록, 원시 실행 경로, 매번 보이는 Refresh, 일반적인 Undo 설명을 두지 않는다. 환경을 바꿀 때 후보 목록이 있는 별도 선택 단계로 이동한다. 팝오버에 섹션을 계속 펼쳐 길게 늘리지 않는다.

정상 Pyright 예시의 ‘결과 수신’은 실제 관측이 있을 때만 쓴다. 연결만 됐거나 문서 수정 후 결과가 오래되었다면 각각 ‘연결됨 · 검사 결과 대기’, ‘최근 수정의 결과 대기’로 표시한다. 서버가 문서 버전을 보내지 않았다면 상세에서 확인 가능한 한계를 밝히며 ‘최신 내용 검증 완료’라고 쓰지 않는다.

### 실패 상태의 첫 화면

```text
코드 지원                                      ×

선택한 Python 환경을 찾을 수 없습니다
chess / backend · .venv/bin/python

[환경 선택…]

편집과 문법 강조는 계속 사용할 수 있습니다.
문서 언어  Python ›                   자세히…
```

순서는 **원인 → 영향 → 해결**이다. 환경이 없는데 ‘서버 재시작’을 첫 행동으로 두지 않는다. 반대로 프로세스가 반복 종료됐고 환경 누락 근거가 없다면 ‘분석 다시 시작’이 첫 행동이다. 에러 문자열만 보고 환경 문제로 추측하지 않고, 현재의 구조화된 issue code와 세션 상태를 사용한다. [환경 문제 생성][S-context]

자동 복구 중에는 `재연결 중`을 표시하고 포커스를 가져오지 않는다. 복구가 멈췄을 때 지속적인 상태와 직접 행동을 남긴다. 일시적인 toast만 띄우고 흔적을 지우면 문제를 놓친 사용자가 다시 찾기 어렵다.

### 환경 선택 화면

현재 환경 행을 누르면 같은 흐름 안에서 후보를 고르는 화면으로 이동한다. 정상 요약과 환경 목록을 동시에 길게 보여줄 필요가 없다.

```text
‹ 코드 지원                      Python 환경
적용 대상: chess / backend

● .venv                         현재 선택
  apps/backend/.venv/bin/python
○ 시스템 Python
  /usr/bin/python3

다른 Python 선택…
프로젝트 선택 해제 → 기본 설정 사용
```

선택의 출처는 `자동 감지`, `프로젝트에서 선택`, `연결 설정에서 지정`처럼 사용자에게 의미 있게 설명한다. Python 버전은 확인한 경우에만 붙인다. 후보 탐색을 위해 모든 interpreter를 실행하는 방식으로 UI를 단순화하지 않는다.

특히 현재 `Use automatic selection`은 프로젝트 override를 제거해 기존 연결 설정을 다시 드러낼 수 있다. UI에서 무조건 ‘시스템 기본값으로 돌아감’처럼 설명하면 틀린다. 사용자가 적용 전에 다음에 쓰일 값과 출처를 이해할 수 있게 해야 한다. 이는 문자열 교체만으로 해결되지 않을 수 있으므로, 필요한 경우 main의 선택 해석 결과에 출처 정보를 보강한다. [현재 환경 우선순위][S-context] · [설정 계약][S-language]

### 기존 사이드바의 역할

문서에서 `자세히…`로 들어오면 전체 서버 목록 대신 **방금 본 문서의 분석 상세**를 연다. 이 화면은 현재 프로젝트 이름, 사용 중인 도구, 검사 범위, 필요한 조치부터 보여준다. 그 아래에 환경 변경, 다른 도구 선택, 상세 실행 정보와 로그를 둔다. `분석 도구 관리`로 기존 카탈로그를 열고 Back으로 원래 문맥에 돌아온다.

카탈로그를 직접 여는 메뉴·명령은 유지한다. 전문 사용자의 수동 연결, JSON import, 실행 파일 선택, supplementary provider, formatter 제어는 제거하지 않는다. 주 서버와 보조 도구가 함께 실행될 수 있으므로 둘을 하나의 radio group으로 단순화하지 않는다.

Pyright 자체의 관리 화면은 다음 정도가 첫 화면이면 된다.

```text
‹ 분석 도구                         Pyright
Python 코드 분석 · 앱에 포함됨

이 창에서 사용 중
chess / backend                      연결됨

전역 기본값                         활성화
프로젝트별 사용 설정…
이 프로젝트의 분석 다시 시작

› 실행 정보와 로그
› 연결 설정
```

전역 비활성화와 현재 프로젝트 중지는 다른 동작으로 명명한다. 여러 세션이 있으면 root별 행에서 제어하고, 창 전체 재시작은 추가 동작으로 둔다. 현재의 넓은 재시작 버튼을 이름만 바꿔 좁은 행동인 것처럼 보이게 해서는 안 된다.

Builder의 utility pane 지침은 본문과 관련된 보조 정보·제어를 별도 패널에서 보여주는 근거가 된다. 다만 오른쪽 패널이나 새 단축키까지 기계적으로 복제하지 않고 Setdown의 기존 왼쪽 도구 영역과 탐색 방식을 따른다. [보조 패널 지침](https://developer.gnome.org/hig/patterns/containers/utility-panes.html)

## 상태를 줄여 보여주되 사실을 합치지 않는다

내부에는 이미 환경 상태, 분석 관측, 검사 범위, 신선도, provider별 상태가 있다. 이 정보는 유지하고 첫 화면에 보여줄 문장과 행동을 도출해야 한다. UI용으로 새 `ready` 하나를 만들어 모든 상태를 덮으면 이전 문제를 반복한다. [현재 분석 자료형][S-types]

| 상황 | 위치 표시줄 | 클릭 후 핵심 설명 | 첫 행동 |
| --- | --- | --- | --- |
| 연결·환경 사용 가능, 결과 수신 | Python | 사용 환경과 열린 파일의 결과 수신 | 환경 변경 또는 문제 보기 |
| 연결됐지만 결과가 아직 없음 | Python | 연결됨, 결과 대기 | 편집 계속; 필요 시 상세 |
| 분석 중이라고 실제 보고됨 | Python · 분석 중 | 서버가 보고한 작업 | 편집 계속 |
| 선택한 환경이 없어짐 | Python · 환경 선택 필요 | 선택한 경로와 누락 사실 | 환경 선택 |
| 여러 주 분석 도구 중 선택 필요 | Python · 분석 도구 선택 | 현재 언어의 후보 | 도구 선택 |
| 자동 복구 진행 | Python · 재연결 중 | 영향받은 도구와 복구 상태 | 기다리는 동안 편집 계속 |
| 자동 복구 종료 후 실패 | Python · 분석 중단 | 중단한 도구, 사용 가능한 기능 | 해당 분석 다시 시작 |
| 보조 lint 도구만 실패 | Python · 일부 검사 중단 | Pyright 기능은 가능, 해당 도구 검사 중단 | 보조 도구 복구 |
| 필요한 SDK·의존성 등의 일부 문제 | Python/TypeScript · 분석 제한 | 확인된 환경 제한과 영향 | 관련 환경·설정으로 이동 |
| 사용자가 프로젝트 분석을 끔 | Python · 기본 편집 | 프로젝트 분석 꺼짐, 가능한 로컬 기능 | 원하면 다시 켜기 |
| 서버가 없고 기본 편집만 가능 | 해당 언어 · 기본 편집 | 현재 제공 범위 | 필요할 때 분석 도구 연결 |
| 코드 자체의 오류가 있음 | 언어 지원 상태와 독립 | Problems와 코드 위에서 오류 설명 | 코드 수정·빠른 수정 |

요약 우선순위는 **즉시 필요한 사용자 선택과 복구 → 지속적인 기능 제한 → 진행 중인 작업 → 중립적인 정보**다. 정상 provider 하나가 있다고 다른 provider 실패를 덮지 않는다. 반대로 보조 도구 하나가 실패했다고 자동완성과 탐색까지 모두 사용할 수 없다는 인상을 주지 않는다.

현재 `supportLabel()`은 실패·선택 필요·환경 `action-needed`를 다루지만 `partial`을 독립적으로 요약하지 않는다. 개선 때 이 구분을 추가할 이유가 있다. 단, 가능한 의존성 누락처럼 확정하지 못한 문제는 ‘분석 불가’가 아니라 근거에 맞는 제한 설명으로 다뤄야 한다. [현재 요약][S-label] · [부분 환경 문제][S-context]

‘오류 0개’도 전체 검사가 끝났다는 뜻이 아니다. Problems가 비어 있는 상태, 서버 결과 대기, 분석 꺼짐을 서로 다른 빈 상태 문구로 표현해야 한다. 코드 오류 개수로 언어 서비스가 고장 났는지 판단하지 않는다.

## 적용 범위는 시각적 단순함보다 먼저 명확해야 한다

| 행동 | 소유 범위 | 화면이 밝혀야 하는 사실 |
| --- | --- | --- |
| 언어 모드 변경 | 현재 열린 문서 | ‘이 문서’에 적용; 전역 확장자 연결 변경으로 보이지 않게 함 |
| interpreter·SDK·build configuration 변경 | 해당 분석 root의 프로젝트 설정 | 실제 프로젝트 이름; 같은 root를 쓰는 다른 탭에도 영향 |
| 주 분석 도구 선택·기본 편집 | 프로젝트와 언어의 선택 | 다른 프로젝트의 기본값과 구별 |
| 전역 도구 Enable/Disable | 전역 기본 설정 | 프로젝트 override와 실제 세션 상태를 별도로 표시 |
| 현재 분석 재시작 | 현재 창에서 해당 문서를 제공하는 세션 | 같은 세션을 공유하는 파일도 재연결됨 |
| 창 전체 서버 재시작 | 이 창의 서버 세션들 | 현재 문서 전용 복구와 구별 |
| 노트북 kernel 변경 | 노트북 실행 세션 | 분석 기본값 변경만으로 실행 중 변수와 kernel을 갈아끼우지 않음 |

프로젝트 환경 변경은 저장된 preference이므로 같은 root를 구독하는 다른 창에도 영향을 줄 수 있다. 재시작 버튼의 창 범위와 혼동하지 않게 해야 한다. 적용 범위는 일반적인 긴 설명 대신 선택 화면의 제목·짧은 보조 문장에 둔다. [설정과 복구의 현재 계약][S-language]

사이드바는 읽기만 할 때 활성 문서를 따라갈 수 있다. 그러나 설정을 편집하거나 서버 응답을 기다리는 동안은 **처음 연 문서와 프로젝트를 고정**해야 한다. 다른 그룹을 클릭했다고 아직 적용하지 않은 설정이 다른 root로 저장되면 안 된다. 적용·취소 뒤 ‘현재 문서로 이동’을 제공하고, 문서가 닫혔다면 안전하게 비활성화한다. 서버의 선택 요청도 원래 세션에만 답한다.

현재 위치 표시줄의 언어 버튼은 일반 코드 문서에만 있고 Markdown·Git review·notebook 등에서는 제외된다. 이 차이를 무시한 채 ‘모든 탭에서 언어 버튼을 누르라’고 안내해서는 안 된다. 상세 사이드바와 명령은 지원되는 현재 자원을 받아 열고, 노트북에는 기존 환경·kernel 진입점을 재사용해야 한다. Git 비교에서는 어느 쪽 자원인지 명시하고 변경 가능한 Working Tree와 읽기 전용 snapshot을 구분한다. 모든 표면에 버튼을 복제하는 작업은 별도 필요성을 확인한 뒤 진행한다. [현재 노출 조건][S-location]

## 대표 사용 흐름으로 비교

### Python 파일을 처음 연다

프로젝트의 기존 선택과 탐색 결과로 연결할 수 있으면 조용히 시작한다. `.venv`가 있지만 선택이 필요한 현행 정책에서는 `환경 선택 필요`를 보여주고 후보 선택으로 바로 들어간다. UI 개편을 핑계로 기존 명시적 선택 정책까지 자동 변경하지 않는다. 선택 후 팝오버를 닫으면 편집 위치가 유지된다.

### 빨간 import 표시를 본다

먼저 코드 Hover에서 원래 진단을 본다. 환경 누락이 확인됐다면 언어 버튼에도 환경 문제를 표시한다. 사용자는 환경을 고르고 새로운 분석 결과를 기다린다. 정상 환경인데 import가 없을 수 있으므로, 모든 import 진단에 ‘환경을 바꾸면 해결’이라고 단정하거나 일괄 숨기지 않는다.

### C++에서 헤더를 찾지 못한다

컴파일 설정이 없으면 `빌드 설정 필요`에서 발견된 configuration 또는 외부 build folder를 고른다. 없을 때만 ‘프로젝트 구성’을 제안한다. 이 동작은 실제 configure code를 실행하므로 해당 단계에서 실행 사실·취소·결과를 보여준다. 정상 Python 팝오버까지 같은 설명으로 채울 필요는 없다.

### Pyright와 Ruff를 함께 사용하다 Ruff만 중단된다

‘Python 분석 실패’로 전체를 뭉뚱그리지 않는다. ‘일부 검사 중단’ 아래 Ruff의 영향과 복구를 보여주고 Pyright의 탐색·완성은 유지한다. supplementary 도구를 숨기는 것과 그 도구의 실패를 숨기는 것은 다르다.

### 서버를 직접 추가하고 싶다

`분석 도구 관리`로 들어가 기존 검색·수동 연결·JSON import를 사용한다. 단순한 첫 화면을 만들기 위해 고급 기능을 삭제하거나, 발견 가능한 수백 개 서버를 문서 팝오버에 다시 늘어놓지 않는다.

## 검토한 대안과 선택

| 대안 | 장점 | 남는 비용 | 판단 |
| --- | --- | --- | --- |
| 현재 팝오버에 접기만 더 추가 | 변경이 작고 모든 정보가 가까움 | 다른 범위의 설정이 계속 섞이고 접힘 제목을 탐색해야 함 | 임시 개선은 가능하나 최종 구조로 부족 |
| 모든 언어 지원 UI를 숨김 | 평상시 화면이 가장 작음 | 분석이 꺼졌거나 실패했을 때 발견·복구가 어려움 | 채택하지 않음 |
| Builder의 프로젝트·빌드 UI 전체 복제 | 강한 프로젝트 문맥과 일관된 환경 관리 | 단독 파일·여러 프로젝트·웹과 노트북에 불필요한 IDE 구조 | 채택하지 않음 |
| 두 개의 상시 버튼으로 언어와 분석을 완전히 분리 | 각 버튼의 뜻이 명확함 | 좁은 분할에서 주소와 도구 공간을 더 차지함 | 사용성 검토 때 비교 후보 |
| 한 진입점 안의 짧은 요약과 단계별 상세 | 현재 위치 유지, 복구가 가깝고 평소 조용함 | 별도 탐색 단계와 문맥 소유권 설계가 필요 | 권장 |

단순함은 버튼 수 하나로 평가하지 않는다. **정상 편집 중 주의를 요구하는 양, 환경 변경까지의 경로, 설정 범위의 오해, 실패 원인을 찾는 수고**를 함께 봐야 한다. 권장안은 이 기준으로 가장 타당한 설계 후보다. 실제 사용자 비교 없이 ‘누구에게나 가장 좋은 UI’라고 확정할 근거는 없다.

## 구현으로 옮길 때의 경계와 완료 기준

제품 코드를 변경하는 다음 단계에서는 다음 순서가 적절하다.

1. `document-support.ts`에서 provider별 사실을 보존하는 표시 규칙을 정한다. 기본·제한·복구 상태와 주요 행동을 일관되게 도출한다.
2. `DocumentLanguageStatus.svelte`를 짧은 요약으로 줄이고, `AnalysisEnvironment.svelte`의 후보 선택·상세 설명을 별도 단계로 배치한다. 오류는 form 뒤가 아니라 맨 앞에 둔다.
3. `LanguageSupport.svelte`에 문서에서 넘어온 context와 Back 탐색을 연결한다. 기존 카탈로그를 유지하고 raw context를 이름 있는 상세 항목으로 바꾼다.
4. 환경 해석에 필요한 출처·효력 범위가 부족한 부분만 구조화한다. renderer에서 경로 문자열을 파싱해 새 분석 규칙을 만들지 않는다.
5. 실제 화면에서 정상 편집·문제 해결·좁은 분할·키보드 흐름을 검증한다.

이번 UI 문제를 해결하기 위해 Monaco, LSP transport, 서버별 feature provider, 진단 저장소, 자동 복구 정책을 다시 작성할 필요는 없다. Builder의 C/GTK widget을 Svelte에 문자 그대로 붙이는 것도 실행 가능한 이식이 아니다. **상태와 설정의 소유권, 기본 노출, 기능의 위치, 상세로 이동하는 경로는 강하게 대응시키고, 렌더링과 입력은 Setdown의 기존 기반에 맞춘다.** 이후 원문 코드를 직접 이식하는 부분은 고정 commit·원본 파일·라이선스 표기를 함께 남긴다.

완료 판정은 다음 관찰 가능한 결과를 기준으로 한다. 아래 수치는 제안하는 검증 조건이며 측정 결과가 아니다.

| 검증 항목 | 완료 기준 |
| --- | --- |
| 정상 첫 화면 | 기본 배율의 1024×768 창과 좁은 분할에서 긴 경로·capability 목록 없이 핵심 요약과 행동 확인 가능 |
| 팝오버 크기 | 핵심 팝오버를 스크롤해 복구 버튼을 찾지 않음; 공간·확대 조건상 불가능하면 전체 form을 우겨 넣지 않고 상세 패널로 이동 |
| 환경 선택 | 언어 버튼 → 환경 행 → 후보 선택으로 도달; 문제 상태에서는 환경 행 탐색을 생략하고 첫 행동으로 진입 |
| 실패 복구 | 해당 문제와 첫 복구 행동이 첫 화면에 함께 보임; 잘못된 환경에는 무의미한 재시작을 우선하지 않음 |
| 부분 실패 | 보조 도구 실패를 알아볼 수 있고 살아 있는 기능도 이해 가능 |
| 상태 정확성 | 연결만으로 분석 완료를 주장하지 않음; stale·versionless 결과·분석 꺼짐·진단 0개를 구별 |
| 설정 범위 | 서로 다른 프로젝트 두 개와 같은 프로젝트 두 창에서 적용 대상이 표시와 일치 |
| 입력과 위치 | 미저장 내용·Undo·스크롤 유지, 상태 갱신으로 포커스 이동 없음, 한국어 IME 조합 중 Escape 보장 |
| Escape | 열린 선택 화면·팝오버부터 닫고 원래 진입점으로 복귀; 그 입력이 reader 전환으로 중복 처리되지 않음 |
| 접근성 | 색 외에 문구·아이콘 사용, 키보드로 전체 경로·선택·복구에 도달, 진행 알림이 반복 입력을 방해하지 않음 |
| 동시성 | 탭 전환·창 이동·서버 종료 뒤 늦은 응답이 다른 문서의 설정이나 화면을 덮지 않음 |
| 고급 사용자 | 기존 수동 연결·import·로그·provider 역할·formatter 설정으로 계속 도달 가능 |

비교 검토에서는 정상 파일 편집, 사라진 `.venv` 복구, C++ configuration 선택, 보조 도구 실패라는 네 과제를 사용한다. 완료 여부·틀린 설정 범위 선택·도움 요청·이동 경로를 관찰하고, 특히 작은 UI가 복구를 더 어렵게 만들지는 않는지 확인한다.

실제 GUI 검증은 프로젝트 규칙대로 Xvfb와 격리된 runtime·D-Bus에서 실행한다. 위치 표시줄·패널 배치 변경이 native bounds, source/reader 전환, 공통 CSS에 닿으면 preview 성능 계약의 전체 검사와 동일 조건 비교 benchmark도 적용한다. 이번 보고서는 제품 구현이나 그 검증의 통과를 주장하지 않는다.

## 코드 근거와 분석 범위

Setdown 기준은 `847bf92498bf69432bdce5a879ed7535467dc06b`다. Builder 기준은 기존 submodule의 `0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718`이며 commit 날짜는 2026년 10월 24일이다. 아래 Builder 링크는 이 commit에 고정했다. 공식 제품 소개와 HIG도 확인했지만, 과거 소개 이미지로 현재 제어의 위치나 동작을 추정하지 않았다. [Builder 공식 소개](https://apps.gnome.org/Builder/)

현재 UI 평가는 제공된 두 스크린샷과 해당 Svelte·상태·실행 코드를 근거로 한다. Builder 평가는 C·UI 정의의 호출 경로 분석이며 새 GUI 실행을 통한 비교 실험은 아니다. 동봉한 화면안은 제안의 정보량과 상태 차이를 검토하는 모형이고 실제 앱 스크린샷이 아니다. 기존 10월 30일 보고서의 구현 이전 결함을 현재 결함으로 재사용하지 않았다.

화면안 자체는 격리 Xvfb의 Chromium에서 1240·560·390px 너비와 다섯 상태의 배치, 예시 환경 선택과 Escape를 확인했다. 이는 HTML 모형의 표시 확인이며 Setdown 제품의 기능·접근성·성능 검증을 대신하지 않는다. [화면안 확인 기록](gnome-builder-lsp-ui-2026-11-01/artifact-check.json)

| 근거 | 확인한 책임 |
| --- | --- |
| [Setdown 문서 상태][S-status], [환경 선택][S-env] | 팝오버의 순서·제어·설명·포커스·반응형 규칙 |
| [Setdown 서버 관리][S-catalog], [표시 함수][S-label] | 원시 정보 노출, 조작 범위, 상태 요약 |
| [분석 문맥][S-context], [자료형][S-types], [실행][S-launch] | 선택의 출처·우선순위, 환경 이슈, Electron 경로의 의미 |
| [Builder editorui][B-editor], [Hover][B-hover], [코드 메뉴][B-menu] | 언어 선택과 코드 기능의 위치 |
| [Builder omnibar][B-omni], [tweaks][B-tweaks], [플러그인 설정][B-plugins] | 프로젝트·앱 범위와 상세 설정의 분리 |
| [Builder service][B-service], [client][B-client], [pipeline][B-pipeline] | 실행 환경, 프로젝트 전제, 진행·로그·진단의 의미 |
| [Builder 알림][B-notification], [Messages][B-messages], [빌드 진단][B-build-diag] | 진행·조사 자료·빌드 결과의 별도 표시 |

[S-readme]: ../README.md
[S-workspace]: ../docs/contracts/workspace.md
[S-groups]: ../docs/editor-groups-design.md
[S-language]: ../docs/language-support.md
[S-prior]: 2026_10_30_gnome_builder_lsp_porting_report.md#화면과-편집-동선은-어디까지-복제할-것인가
[S-status]: ../apps/desktop/src/renderer/language/DocumentLanguageStatus.svelte
[S-env]: ../apps/desktop/src/renderer/language/AnalysisEnvironment.svelte
[S-catalog]: ../apps/desktop/src/renderer/language/LanguageSupport.svelte
[S-label]: ../apps/desktop/src/renderer/language/document-support.ts
[S-context]: ../apps/desktop/src/main/language/analysis-context.ts
[S-types]: ../apps/desktop/src/core/document/analysis-context.ts
[S-launch]: ../apps/desktop/src/main/language/server-registry.ts
[S-location]: ../apps/desktop/src/renderer/workspace/location/LocationBar.svelte
[B-editor]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/editorui/gbp-editorui-workspace-addin.c#L430-L506
[B-hover]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/codeui/gbp-codeui-hover-provider.c#L43-L110
[B-menu]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/codeui/gtk/menus.ui
[B-omni]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/buildui/gbp-buildui-omni-bar-section.ui
[B-tweaks]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/buildui/tweaks.ui
[B-plugins]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/libide/gui/ide-application-tweaks.c#L39-L80
[B-service]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/libide/lsp/ide-lsp-service.c
[B-client]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/libide/lsp/ide-lsp-client.c
[B-pipeline]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/libide/foundry/ide-pipeline.c#L4288-L4305
[B-notification]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/libide/gui/ide-notifications-button.c
[B-messages]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/messages/gbp-messages-panel.c#L122-L145
[B-build-diag]: https://github.com/GNOME/gnome-builder/blob/0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718/src/plugins/buildui/gbp-buildui-status-popover.c
