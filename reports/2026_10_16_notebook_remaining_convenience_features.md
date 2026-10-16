# Setdown에 남아 있는 VS Code Jupyter 편의 기능과 도입 우선순위

기준일: 2026-10-16, Asia/Seoul.

**구현 반영:** 직접 제공하는 편의 기능과 JupyterLab·nbconvert·nbdime·Jupytext·Ruff 연동을 추가했다. 아래 대응표 이후의 비교는 구현 전 기준을 보존한 조사 기록이다.

Setdown에 먼저 추가할 기능은 **그림 저장·확대, 위/아래 범위 실행, 전체 출력 정리, 셀 나누기·합치기, Markdown 제목 목차**다. 이미 있는 문서 모델·실행 큐·출력 데이터를 활용하면서 노트북을 읽고 실험하는 데 필요한 반복 조작을 줄인다. 공유용 HTML 내보내기는 공식 `nbconvert`를 연결하는 방식이 적합하다.

변수 탐색기와 표 뷰어도 유용하지만 커널의 실제 값을 조회하는 별도 경로가 필요하다. 디버깅, 원격 실행, 위젯까지 한 번에 구현하면 IDE 기반을 크게 늘리게 된다. 외부 라이브러리로 맡길 수 있는 기능부터 연결하고, Setdown은 문서의 읽기·편집·실행 흐름에 집중하는 편이 맞다.

## 구현 후 사용 경로

아래 원래 목록에 있던 기능을 다음 경로로 연결했다. 실제 검증 결과와 사용상의
경계는 [노트북 문서](../docs/notebooks.md)와 [성능 계약](../docs/preview-performance-contract.md)에 기록한다.

| 항목 | 구현 경로 |
|---|---|
| 그림 원본 저장·확대, 실행 범위, 전체 출력 정리 | 노트북 출력 버튼과 Commands 메뉴 |
| 셀 분할·병합, 전체 접기, 줄 번호·단축키 | 공통 셀 명령; 구조 Undo 적용 |
| 목차·Sticky 제목·섹션 접기 | 전체 Markdown 셀 파싱과 셀 단위 표시 상태 |
| traceback 이동, 출력·Markdown 검색, 전체 바꾸기 | 셀/파일 이동과 제한 시간 있는 검색 worker |
| 변수·표·stdin | 기존 jupyter_client 커널 연결; 명시적인 변수 조회와 100행 미리보기 |
| Conda·kernelspec 검색 | 로컬 metadata에서 Python executable만 발견; launch 명령은 실행하지 않음 |
| HTML·Markdown·script·PDF | 별도 환경의 nbconvert; 현재 snapshot 변환 |
| 셀 단위 Git 비교 | nbdime로 HEAD와 현재 snapshot 비교 |
| 셀 간 이름 변경·수정·포맷 | 검증된 LSP workspace edit와 Ruff; 원자적인 소스 변경 |
| 위젯·대화형 그래프·디버깅·비 Python 커널 | 앱 웹 탭에서 실제 JupyterLab 사용; 로컬 노트북 화면과 별도 커널 |
| 원격 커널 | 원격 JupyterLab URL에 연결하여 서버의 파일·세션 UI 사용 |
| Python `# %%` | Jupytext로 현재 편집 내용을 별도 interactive notebook으로 변환·열기 |

JupyterLab에서 저장한 파일은 기존 외부 변경 처리로 반영한다. 원격 서버로 로컬
파일을 자동 업로드하거나, `.py`와 변환 노트북을 자동 동기화하지 않는다.
metadata·attachment가 서로 다른 셀의 병합은 데이터 손실 대신 명시적인 오류로
막는다. VS Code와 같은 화면을 복제한 구현이라는 뜻은 아니다.

## 비교 기준

현재 Setdown `3bbf4355a8e520fed17455a16f5db211b83ddb98`의 소스와 [노트북 기능 문서](../docs/notebooks.md)를 기준으로 비교했다. VS Code 본체는 vendor의 `d3d31f62268b169a2dfab62ffb2d7d38158a5b7c`, Jupyter 확장은 `29e57a1eec77bc66c287321d3b1c41459d4458ed`를 참조했다. 공개 기능 설명은 [VS Code Jupyter 안내](https://code.visualstudio.com/docs/datascience/jupyter-notebooks)와 [커널 관리 안내](https://code.visualstudio.com/docs/datascience/jupyter-kernel-management)를 확인했다.

이 문서의 현재 상태는 **코드와 명령 연결 경로를 확인한 결과**다. 새 GUI 재현이나 성능 측정 결과를 뜻하지 않는다. 도입 비용은 작업량 추정이며 기간을 확정한 일정이 아니다.

[이전 감사](2026_10_16_12_17_notebook_vscode_gap_analysis.md)의 초기 미구현 목록에는 이후 해결된 항목이 많다. 현재 남은 기능은 아래 목록을 기준으로 판단한다. 진단 정책은 최근 적용한 VS Code 수준의 기본 진단을 유지하며, 정밀 타입 검사 선택 기능은 도입 범위에 포함하지 않는다.

## 이미 제공하는 기능

| 기능 | 현재 상태와 근거 |
|---|---|
| 셀 선택과 편집 | 다중·범위 선택, 복사·잘라내기·붙여넣기, 묶음 드래그, 삭제·복제, 구조 Undo가 있다. [셀 컨트롤러][sd-controller], [문서 모델][sd-document] |
| 실행 | 현재 셀·선택 셀·전체 실행, Shift+Enter·Alt+Enter, 순차 실행 큐, 중복 예약 갱신, 중단·커널 초기화, 셀별 결과와 실행 시간을 제공한다. [화면][sd-surface], [실행 큐][sd-execution] |
| 출력 | 텍스트 복사, 입력·출력 개별 접기, MIME 선택, 정적 표·수식·이미지, 실행 결과 저장이 있다. [출력 UI][sd-outputs], [출력 변환][sd-content] |
| 코드 도움 | 노트북 전용 셀 동기화, 자동완성·hover·정의 이동, 기본 진단이 있다. 분석 Python과 실행 Python을 함께 선택한다. [분석 연결][sd-language], [환경 선택][sd-environments] |
| 읽기와 저장 | 셀 소스 검색, Markdown 읽기 상태 유지, 스크롤 중 높이·포커스 보존, metadata·attachments 보존 저장이 있다. [현재 계약][sd-docs] |

따라서 위 기능들을 다시 신규 과제로 잡을 필요는 없다. 아래에서 ‘부분 제공’은 기존 기능의 확장이 필요하다는 의미다.

## 먼저 도입할 편의 기능

P1은 다음 개선 묶음에 적합한 항목이다. 표의 비용은 현재 구조를 활용한다는 전제의 상대적 평가다.

| 우선순위 | 기능과 현재 차이 | 사용자에게 생기는 이점 | 예상 비용 |
|---|---|---|---|
| P1 | **그림 저장·확대**. 이미지는 표시하지만 저장·원본 확대 명령이 없다. 텍스트 출력 복사와는 별개다. [Setdown][sd-outputs] · [VS Code Jupyter][vs-plot] | 실험 그래프를 발표·논문에 옮기거나 작은 축·범례를 확인하기 쉬워진다. | 낮음∼중간 |
| P1 | **위쪽 셀 실행 / 현재 셀부터 아래 실행**. 선택·전체 실행은 있지만 범위 전용 명령이 없다. [Setdown][sd-surface] · [VS Code][vs-run] | 긴 데이터 준비 과정을 선택할 필요 없이 다시 실행하거나, 수정한 지점 이후만 재계산한다. | 낮음 |
| P1 | **모든 출력 지우기 / 전체 입력·출력 접기**. 개별 셀 조작만 있다. [Setdown][sd-cell] · [VS Code 편집][vs-edit] · [전체 접기][vs-collapse] | 공유 전 결과를 한 번에 정리하고, 코드나 결과 중 읽고 싶은 쪽에 집중한다. | 낮음∼중간 |
| P1 | **셀 나누기·합치기**. 셀 복제·이동은 있지만 split/join 연산이 없다. [Setdown][sd-document] · [VS Code][vs-cell-operations] | 긴 실험 코드를 준비·계산·시각화 단계로 나누고, 흩어진 설명을 합친다. | 중간 |
| P1 | **Markdown 제목 목차**. 검색은 있지만 노트북 전체 구조를 탐색하는 목차가 없다. [Setdown][sd-surface] · [VS Code][vs-outline] | 긴 노트북에서 ‘실험 설정’, ‘결과’, ‘분석’으로 바로 이동한다. | 중간 |
| P1 | **HTML 내보내기**. `.ipynb` 저장은 있지만 노트북 전용 export 경로가 없다. 기존 PDF exporter는 Markdown preview용이다. [현재 API][sd-api] · [PDF exporter][sd-pdf] · [VS Code Jupyter][vs-export] | Python 환경이 없는 사람에게 결과를 읽을 수 있는 문서로 전달한다. | 중간, `nbconvert` 연동 |

### 그림 저장은 현재 가진 원본 MIME에서 시작한다

첫 범위는 PNG·JPEG 등 **출력 bundle에 실제로 들어 있는 이미지의 원본 저장**과 확대 보기다. `NotebookOutputs`의 화면 캡처 대신 원본 bytes를 저장해야 화면 크기에 따라 해상도가 줄지 않는다. 저장 취소는 노트북을 바꾸지 않아야 한다.

VS Code Jupyter에는 SVG·PNG·PDF를 다루는 [Plot Viewer export][vs-plot]가 있다. 그러나 Setdown 출력이 PNG만 가진 경우 원본 벡터 그래프를 복원할 수는 없다. SVG 보존·표시와 PDF 변환은 별도 확장으로 잡는다. 처음부터 그림 편집기 전체를 만들 필요는 없다.

완료 기준: 원본 크기와 bytes 보존, 같은 셀의 여러 이미지 구분, 저장 취소, 노트북 dirty 상태 불변.

### 범위 실행은 기존 큐에 셀 ID를 넘긴다

[NotebookExecution.run(ids)][sd-execution]은 셀 목록을 받아 순차 실행할 수 있다. ‘위쪽 실행’은 현재 셀 전까지, ‘현재부터 아래 실행’은 현재 셀을 포함해 마지막까지의 코드 셀을 넘기면 된다. 현재 셀 포함 여부가 메뉴 이름과 일치해야 한다.

‘커널 초기화 후 전체 실행’도 유용한 추가 명령이다. 현재는 Reset kernel과 Run All을 따로 누른다. 이 복합 동작은 기존 커널 종료와 새 실행의 순서를 보장해야 하며, 단순히 두 버튼의 함수를 동시에 호출해서는 안 된다. 큐의 실패 시 중단·취소·실행 snapshot 규칙을 그대로 사용한다.

완료 기준: 실행 중 추가 요청, Markdown·raw 건너뛰기, 첫 셀·마지막 셀 경계, 실패 시 이후 셀 중단.

### 전체 정리와 셀 분할은 하나의 Undo로 되돌린다

현재 `NotebookDocument.clear(id)`는 셀마다 history를 만든다. 전체 출력 지우기를 단순 반복하면 Undo를 여러 번 눌러야 한다. 전체 조작용 transaction을 추가하고, 한 번의 Undo로 모든 출력과 실행 번호를 복원하도록 설계한다. 전체 접기는 저장 데이터를 수정하지 않는 표시 상태로 둔다.

셀 나누기·합치기는 source만 자르는 문제가 아니다. 새 ID, metadata, Markdown attachments, 기존 출력과 실행 번호의 처리 규칙을 함께 정해야 한다. 첫 범위는 같은 종류의 인접 셀 합치기와 커서 위치 나누기로 제한하는 편이 명확하다. 기존 결과가 바뀐 코드의 결과처럼 보이지 않도록 처리해야 한다. [문서 모델][sd-document]과 [VS Code의 셀 연산][vs-cell-operations]을 참고한다.

완료 기준: 한글·CRLF 경계, attachment 이름 충돌, 셀 ID, 포커스·선택 위치, Undo/Redo 후 원본 데이터 보존.

### 목차는 읽기 탐색부터 시작한다

코드 symbol까지 포함하는 Outline보다 Markdown 제목 계층부터 제공하는 편이 작고 유용하다. 이미 렌더링된 DOM만 탐색하면 가상화된 화면 밖 셀의 제목이 빠진다. 전체 셀 모델을 바탕으로 제목과 셀 ID를 연결해야 한다. fenced code 안의 `#`를 제목으로 취급하지 않도록 기존 Markdown 파서를 활용한다.

제목 클릭으로 이동한 뒤 Markdown 편집 모드가 열리지 않아야 한다. Sticky Scroll과 제목 아래 섹션 접기는 그다음 단계다. [VS Code Outline][vs-outline]과 [Sticky Scroll][vs-sticky]은 서로 연결되지만 별개의 기능이다.

## 그다음 검토할 기능

| 우선순위 | 기능 | 현재 빠진 부분과 구현 방향 |
|---|---|---|
| P2 | **오류 traceback에서 셀·파일로 이동** | 오류는 ANSI를 제거한 텍스트로 출력한다. 파일 경로·줄 번호가 이동 대상으로 연결되지 않는다. 실행 당시 셀/버전과 traceback 위치를 매핑하고, 셀이 바뀌면 과거 실행 위치임을 구분한다. [Setdown][sd-content] · [VS Code Jupyter][vs-traceback] |
| P2 | **출력·렌더링된 Markdown 검색, 노트북 전체 바꾸기** | 현재 검색 대상은 소스이며 대소문자를 무시한 문자열 찾기다. 출력 검색과 정규식·대소문자 선택, 셀을 가로지르는 replace UI가 없다. 표시가 잘린 출력과 화면 밖 셀도 다루어야 한다. 출력은 검색 대상으로만, source는 교체 대상으로 구분한다. [Setdown][sd-surface] · [VS Code][vs-find] |
| P2 | **변수 탐색기·DataFrame 뷰어** | 변수 목록과 타입·shape·미리보기 조회 API가 없다. 저장된 HTML 표 표시와 실행 중 Python 객체 탐색은 다르다. 명시적으로 연 패널에서 현재 커널의 값을 페이지 단위로 조회하고, 실행/초기화 후 갱신한다. [현재 API][sd-api] · [변수 제공자][vs-variables] · [Data Viewer][vs-data] |
| P2 | **`input()`·비밀번호 입력** | bridge가 `allow_stdin=False`를 사용한다. Jupyter `input_request`를 입력 UI로 연결하고 `input_reply`를 돌려줄 경로가 필요하다. 중단·커널 교체 시 대기 입력도 종료해야 한다. [Setdown][sd-bridge] · [VS Code Jupyter][vs-stdin] |
| P2 | **환경 검색 확대** | 파일별 선택 기억과 PATH·프로젝트 venv·현재 Conda는 지원한다. 모든 Conda 환경이나 등록된 kernelspec을 나열하는 기능은 없다. 이를 ‘환경 선택 미지원’으로 적으면 부정확하다. 기존 선택을 유지하면서 발견 범위를 늘린다. [Setdown][sd-environments] · [VS Code 커널 분류](https://code.visualstudio.com/docs/datascience/jupyter-kernel-management) |
| P2 | **노트북 셀 단위 Git 비교** | 현재는 읽기 전용 JSON diff다. source·output·metadata를 분리한 비교 화면이 있으면 결과 변경만으로 코드를 찾기 어려워지는 문제를 줄인다. 우선 읽기 전용 비교부터 도입한다. [Setdown][sd-diff] · [VS Code][vs-diff] |
| P2 | **줄 번호 전환과 셀 명령 단축키** | 코드 줄 번호는 이미 표시된다. 셀/전체 단위 전환, 위에 셀 추가, `A/B`, `M/Y`, 셀 단위 `DD`, 키보드 셀 이동 등은 부족하다. 텍스트 편집·IME 중에는 동작하지 않아야 한다. [현재 키 처리][sd-surface] · [셀 옵션][sd-cell] · [VS Code 삽입 명령][vs-insert] |

변수 뷰어가 필요해져도 처음에는 이름·타입·크기·작은 표 미리보기면 충분하다. 정렬·필터·변환·프로파일링을 모두 직접 만들면 별도 데이터 분석 제품을 운영하게 된다. 대형 배열을 매 실행마다 통째로 JSON으로 옮기는 방식도 피한다.

셀 전용 우클릭 메뉴와 명령 팔레트 연결은 위 기능의 공통 진입점으로 묶을 수 있다. 현재 Monaco 내부 메뉴와 노트북 구조 명령은 같은 범위가 아니다. 버튼을 셀마다 계속 늘리기보다 controller 명령을 메뉴·키보드·toolbar에서 공유하는 구성이 적합하다.

## 기반이 커지는 기능

다음 기능도 VS Code 생태계에는 있지만, 현재 제품 방향에서는 뒤로 두는 편이 낫다.

| 기능 | Setdown 상태 | 필요한 기반 |
|---|---|---|
| **ipywidgets와 Plotly·Altair 등 대화형 출력** | 정적 MIME 표시만 있다. HTML script를 실행하지 않으며 widget comm을 전달하지 않는다. | MIME별 renderer, 커널 comm 연결, 위젯 상태·수명 관리. 일반 HTML 허용만으로 해결되지 않는다. [출력 처리][sd-content], [bridge][sd-bridge], [VS Code Jupyter 위젯 구현][vs-widgets] |
| **Run by Line와 셀 디버깅** | 디버그 프로토콜·중단점 UI가 없다. | 커널 디버거, 셀 소스와 디버그 파일 매핑, pause·step·continue 수명 관리. [공식 기능 설명](https://code.visualstudio.com/docs/datascience/jupyter-notebooks#debug-a-jupyter-notebook) |
| **원격 Jupyter 서버 및 Python 외 커널** | 로컬 Python executable 실행 경로만 있다. | 서버·세션·커널 선택과 재연결, 원격 파일 위치 및 언어별 분석 경로. 로컬 Python 선택 UI의 작은 변경으로 끝나지 않는다. [현재 환경 선택][sd-environments], [공식 연결 방식](https://code.visualstudio.com/docs/datascience/jupyter-kernel-management#existing-jupyter-server) |
| **`.py`의 `# %%` 셀과 Interactive Window** | `.py` 편집과 `.ipynb` 실행이 분리돼 있다. | 코드 파일↔대화형 실행 결과의 소유권, 실행 위치, 별도 interactive 문서. [VS Code 공식 안내](https://code.visualstudio.com/docs/python/jupyter-support-py) |
| **노트북 셀 간 이름 변경·코드 수정·포맷** | 기본 분석은 있지만 셀 경계를 넘는 edit는 제한한다. | 여러 셀의 버전 확인과 원자적 수정·Undo. LSP가 edit를 반환한다는 것만으로 UI가 안전하게 적용할 수 있지는 않다. [현재 연결][sd-language] |

## 외부 도구를 어디에 사용할 것인가

VS Code에서 보이는 기능 전체가 Jupyter 확장 하나에 들어 있는 것은 아니다. 셀 편집·검색·Outline·diff는 VS Code 본체의 notebook workbench에 있고, 실행·변수 조회·위젯·export는 Jupyter 확장과 연결된다. [Notebook API](https://code.visualstudio.com/api/extension-guides/notebook)도 serializer·controller·renderer를 별도 책임으로 나눈다.

특히 [Data Viewer 구현][vs-data]은 `vscode`의 window·commands와 extension host 서비스를 사용한다. 확장 패키지를 설치하는 것만으로 Setdown의 Svelte/Monaco 화면에 바로 붙는 범용 컴포넌트는 아니다.

| 도입 대상 | 재사용할 외부 구현 | Setdown에 남는 작업 |
|---|---|---|
| HTML·Markdown·Python·PDF 내보내기 | [Jupyter nbconvert](https://nbconvert.readthedocs.io/en/latest/usage.html) | 파일 선택, 현재 편집 snapshot 전달, 진행·취소·오류 표시. 처음에는 HTML을 우선한다. |
| 셀 단위 diff·merge | [nbdime](https://nbdime.readthedocs.io/en/latest/) | 우선 외부 비교 화면 연결을 검토하고, 내장 비교가 필요하면 Git revision과 결과 표시를 연결한다. 일반 JSON diff 엔진을 직접 노트북용으로 확장하지 않는다. |
| 원격 서버 연결 | [JupyterLab services](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.html) | 서버 연결 정보, 세션 선택, 연결 상태 UI. 현재 로컬 실행은 이미 공식 `jupyter_client`를 쓰므로 유지한다. |
| `input()` 처리 | 기존 [jupyter_client와 stdin 프로토콜](https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-stdin-router-dealer-channel) | 입력 요청·응답용 IPC와 셀별 입력 UI. 별도 Jupyter 전송 계층을 만들 필요는 없다. |
| 저장된 widget 표시 | [`@jupyter-widgets/html-manager`](https://ipywidgets.readthedocs.io/en/stable/embedding.html) | 저장된 state와 renderer 연결. 이 embedder만으로 실행 중 Python과의 상호작용이 완성되지는 않는다. |
| 변수 탐색·표 뷰어 전체 | VS Code 구현은 동작·분할 조회 방식의 참고 자료 | 현재 조사한 자료에서 Setdown에 그대로 연결할 완성형 조합은 확인하지 못했다. 외부 UI 재사용 여부와 커널 조회 경로를 별도 검증해야 한다. |

`nbconvert`에는 이미 HTML·script·PDF exporter가 있다. PDF는 LaTeX 경로 또는 Chromium 기반 WebPDF 경로에 따라 추가 의존성이 생긴다. 이를 Setdown 내부에서 모두 재구현할 이유는 없다. 변환에는 사용자가 편집 중인 snapshot을 쓰고, 내보내기가 셀을 재실행하거나 원본을 덮어쓰지 않도록 경로를 분리한다. [nbconvert 사용법](https://nbconvert.readthedocs.io/en/latest/usage.html)

이 후보들은 사용 가능한 공식 구현이지, Setdown 통합을 검증한 패키지 조합은 아니다. 특히 위젯 embedder·원격 services·nbdime은 각자 UI 연결과 수명 관리 작업이 남는다.

## 권장 구현 묶음

1. **반복 조작 줄이기:** 그림 원본 저장·확대, 위/아래 실행, 전체 출력 지우기·접기. 기존 실행과 출력 구조를 최대한 사용한다.
2. **문서 구조 편집과 탐색:** 셀 나누기·합치기, Markdown 목차, 공통 셀 메뉴·단축키. 구조 Undo와 focus 계약을 함께 검증한다.
3. **공유와 오류 확인:** `nbconvert` HTML export, traceback 이동, 출력 검색. Python 환경이 없어도 결과를 읽고, 실패한 지점으로 쉽게 돌아오게 한다.
4. **사용 빈도를 보고 확대:** 변수·표 뷰어, `input()`, 환경 검색, `nbdime` 비교. 원격 실행·위젯·디버깅은 별도 요구가 있을 때 범위를 확정한다.

레이아웃·출력 표시·가상화를 바꾸는 구현은 기존 [preview performance contract](../docs/preview-performance-contract.md)를 따른다. 특히 목차 이동·전체 접기·출력 확대 후에도 스크롤 위치와 IME 포커스가 유지돼야 한다. 이 문서는 기능 조사와 도입 제안이며, 위 기능을 구현 완료한 기록은 아니다.

[sd-docs]: ../docs/notebooks.md
[sd-controller]: ../apps/desktop/src/renderer/notebook/notebook-controller.ts
[sd-document]: ../apps/desktop/src/core/notebook/notebook-document.ts
[sd-surface]: ../apps/desktop/src/renderer/notebook/NotebookSurface.svelte
[sd-execution]: ../apps/desktop/src/renderer/notebook/notebook-execution.ts
[sd-outputs]: ../apps/desktop/src/renderer/notebook/NotebookOutputs.svelte
[sd-content]: ../apps/desktop/src/renderer/notebook/notebook-content.ts
[sd-cell]: ../apps/desktop/src/renderer/notebook/NotebookCell.svelte
[sd-language]: ../apps/desktop/src/renderer/notebook/notebook-language.ts
[sd-environments]: ../apps/desktop/src/main/notebook/python-environments.ts
[sd-bridge]: ../apps/desktop/src/main/notebook/kernel-bridge.py
[sd-api]: ../apps/desktop/src/protocol/notebook.ts
[sd-pdf]: ../apps/desktop/src/main/preview/pdf-exporter.ts
[sd-diff]: ../apps/desktop/src/renderer/project/source-control/GitDiffEditor.svelte
[vs-plot]: ../vendor/vscode-jupyter/src/webviews/extension-side/plotting/plotViewer.node.ts
[vs-run]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/controller/executeActions.ts
[vs-edit]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/controller/editActions.ts
[vs-collapse]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/contrib/cellCommands/cellCommands.ts
[vs-cell-operations]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/controller/cellOperations.ts
[vs-outline]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/contrib/outline/notebookOutline.ts
[vs-sticky]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/viewParts/notebookEditorStickyScroll.ts
[vs-export]: ../vendor/vscode-jupyter/src/standalone/import-export/exportCommands.ts
[vs-traceback]: ../vendor/vscode-jupyter/src/interactive-window/outputs/tracebackFormatter.ts
[vs-find]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindReplaceWidget.ts
[vs-variables]: ../vendor/vscode-jupyter/src/standalone/variables/JupyterVariablesProvider.ts
[vs-data]: ../vendor/vscode-jupyter/src/webviews/extension-side/dataviewer/dataViewer.ts
[vs-stdin]: ../vendor/vscode-jupyter/src/kernels/execution/cellExecutionMessageHandler.ts
[vs-diff]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/diff/notebookDiffEditor.ts
[vs-insert]: ../vendor/vscode/src/vs/workbench/contrib/notebook/browser/controller/insertCellActions.ts
[vs-widgets]: ../vendor/vscode-jupyter/src/webviews/webview-side/ipywidgets/README.md
