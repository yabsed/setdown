# GNOME Builder 기반 프로젝트 분석 환경 구현 — 2026-10-30

GNOME Builder의 `context → tooling → service → providers → editor status` 책임
구조를 Setdown의 Electron/Monaco 편집기에 연결했다. 단순히 환경 경로를 표시하는
것이 아니라, 같은 분석 계획으로 서버를 실행하고 현재 문서의 환경 선택·복구 UI를
구동한다. GTK 위젯이나 새로운 문서 모델을 끼워 넣지 않는다.

기준 커밋은 `a0396f6`이다. 이 커밋에 이미 등록된 `vendor/gnome-builder`의 고정
리비전 `0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718`을 유지했다.
[사전 소스 분석 보고서](../../reports/2026_10_30_gnome_builder_lsp_porting_report.md)의
설계를 실제 코드로 구현한 변경이다.

## 구현한 흐름

| Builder에서 가져온 책임 | Setdown 구현 | 실제 동작 |
| --- | --- | --- |
| 프로젝트 문맥과 tooling 준비 | [AnalysisContextService](../../apps/desktop/src/main/language/analysis-context.ts) | 프로젝트 근거, 환경 후보, 선택, 실행 인자를 하나의 계획으로 생성 |
| configure 단계 | [AnalysisPreparation](../../apps/desktop/src/main/language/analysis-preparation.ts) | 사용자가 선택한 CMake/Meson 구성 실행, 취소, 출력 제한, 생성 DB 선택 |
| 서비스 수명과 supervision | [LanguageServiceSupervisor](../../apps/desktop/src/main/language/language-supervisor.ts), [LanguageManager](../../apps/desktop/src/main/language/language-manager.ts) | 문서/창별 소유권 유지, 영향받은 세션만 재연결, 제한된 자동 복구 |
| provider별 책임 | [LanguageFeaturePlan](../../apps/desktop/src/renderer/language/language-feature-plan.ts) | 실제 provider 등록과 화면의 기능 표시가 같은 capability 계획 사용 |
| 간결한 편집 상태와 필요한 순간의 설정 | [AnalysisEnvironment](../../apps/desktop/src/renderer/language/AnalysisEnvironment.svelte), [DocumentLanguageStatus](../../apps/desktop/src/renderer/language/DocumentLanguageStatus.svelte) | 작은 언어 버튼에서 현재 프로젝트 환경·문제·복구에 접근 |
| 진단 출처와 문맥 | [DiagnosticStore](../../apps/desktop/src/renderer/language/diagnostic-store.ts) | 원본 진단, provider, channel, epoch, version, 환경 문맥 보존 |
| 서버의 사용자 선택 요청 | [ServerSession](../../apps/desktop/src/main/language/server-session.ts) | `window/showMessageRequest`를 상태창에서 처리, 세션에 묶인 응답과 만료 |

Builder 원형은 [IdeLspService](../../vendor/gnome-builder/src/libide/lsp/ide-lsp-service.c),
[IdeSubprocessSupervisor](../../vendor/gnome-builder/src/libide/threading/ide-subprocess-supervisor.c)
등이며, Setdown의 기존 JSON-RPC, 취소, 동적 capability, edit 검증은 유지했다.

## 사용자에게 달라지는 점

### Python

`.venv`/`venv`, host 환경, Conda metadata, Python Jupyter kernel 정보를 후보로
제시한다. 후보를 찾아보는 동안 해당 프로젝트 실행 파일을 실행하지 않는다.
선택한 interpreter를 **실제 Pyright client configuration**에 넣어 import와 타입
해석에 사용한다. 번들 Pyright 프로세스의 Node 실행 파일과는 구분된다.

프로젝트 선택은 일반 `.py`와 `.ipynb`에 공통 기본값으로 적용된다. 기존 노트북별
명시적 선택은 우선한다. 정지한 노트북은 바뀐 기본값을 반영하며, 실행 중인 kernel은
변수와 현재 분석 환경을 유지하고 별도로 환경을 바꾸도록 안내한다. 프로젝트
환경 변경만으로 셀을 실행하거나 kernel을 종료하지 않는다.

`pyrightconfig.json`, `pyproject.toml`, `executionEnvironments`의 원래 의미는
서버에 남겨 둔다. 기존 문서별 `workspace/configuration` scope와 explicit 설정도
유지한다. 새 프로젝트 interpreter 선택이 있을 때만 이를 공통 기본값으로 적용한다.

### C / C++

root, `build`, `builddir`, `out/build`, 그리고 해석 가능한 로컬 CMake preset의
literal build directory에서 DB를 찾는다. 하나뿐이면 자동 사용하고, 여러 개면
선택을 요청한다. 외부 build folder도 native chooser로 선택할 수 있다.

선택한 DB 디렉터리가 `--compile-commands-dir`로 전달된다. 기존 구현처럼
발견 사실만 설명하고 clangd 실행에는 반영하지 않는 상태를 없앴다.

CMake/Meson 프로젝트에서는 **Configure project**를 눌러 앱의 user-data 아래
독립 빌드 캐시에 DB를 만들 수 있다. 프로젝트를 여는 것만으로 configure를 실행하지
않는다. 같은 프로젝트의 중복 configure는 다른 창에서도 막는다. 취소 시 프로세스를
정리하며, Linux에서는 해당 프로세스 그룹도 종료한다. 최대 실행 시간 120초,
보관 출력 64 KiB를 적용한다. 생성 헤더와 프로젝트 의존성은 추가 빌드가 필요할 수 있다.

### TypeScript / JavaScript

기본값은 bundled SDK다. 프로젝트 SDK는 metadata로 발견해 표시하며 사용자의
선택 뒤 실제 `tsserver.path`에 적용한다. SDK 경로·선택 근거와 서버가 보고한
버전/출처를 확인할 수 있다. 저장된 SDK가 사라졌을 때 선택을 유지하고 문제를 표시한다.

### 언어 공통

- 현재 파일에서 primary provider와 **Basic editing**을 프로젝트별로 선택한다.
  다른 프로젝트의 기본값, 기존 전역 설정, 언어 인식과 문법 강조는 유지된다.
- 현재 문서의 **Restart project services**는 이 창에서 그 문서를 담당하는
  세션만 재연결한다. 저장된 프로젝트 환경 변경은 해당 root의 같은 언어 세션에
  반영한다. 서버에 보내는 것은 최신 미저장 버퍼이며 Monaco 모델은 재생성하지 않는다.
- 예기치 않은 서버 종료는 1초, 3초, 5초 지연으로 분당 최대 3회 복구한다.
  반복 실패 뒤에는 이유와 수동 복구 동작을 남긴다. rename, code action, save
  participant, workspace edit를 자동 재실행하지 않는다.
- 연결 성공, 환경 문제, 진행률, 해당 열린 문서의 결과 수신을 구분한다.
  `Open-file checks`가 프로젝트 전체 인덱싱 완료나 모든 검사의 성공을 뜻하지 않는다.
- 오류 개수나 문자열 패턴으로 진단을 숨기지 않는다. quick fix에는 같은 provider의
  원본 diagnostic을 돌려준다. 기존 version/epoch 검증과 취소도 유지한다.
- 서버의 선택 요청은 모달 대신 상태창에 나타난다. 응답은 원래 세션의 request ID와
  action index로 검증하고, 종료 또는 120초 경과 시 정리한다.
- Rust/Go도 동일한 문맥 서비스에서 Cargo/Go/toolchain 설정 근거와 변경을 추적한다.
  toolchain 및 의존성 해석은 기존 native server에 맡긴다.

## 저장과 수명

`project-analysis.json`에 root별 interpreter/SDK/compilation DB 선택을 저장한다.
`language-servers.json`에는 기존 형식과 호환되는 project provider/disabled 선택을
추가한다. `notebook-python.json`의 기존 파일별 선택은 그대로 보존한다.

환경 변수는 main에 남는다. renderer는 표시용 경로·선택 근거·상태만 받으며,
선택 IPC는 현재 창이 소유한 파일과 fresh candidate를 검증한다. arbitrary executable
문자열을 후보 ID 대신 전달하거나 다른 창의 문서를 지정하면 거부한다.

분석 문맥은 짧게 캐시하고 알려진 설정과 후보/선택 경로를 감시한다. 세션이 닫히면
감시·자동 복구 timer·서버 요청을 정리한다. 프로세스나 미저장 URI 상태는 서로 다른
창 사이에서 공유하지 않는다.

## 검증

실행 로그와 스크린샷은
[`reports/gnome-builder-implementation-2026-10-30`](../../reports/gnome-builder-implementation-2026-10-30/)
에 보관한다. GUI는 모두 프로젝트의 isolated-display wrapper를 통해 Xvfb, 별도
runtime directory, 별도 D-Bus session에서 실행했다.

새 회귀 시나리오는 다음을 실제로 검증한다.

1. 가상환경에만 존재하는 Python 모듈의 import 경고가 선택 후 사라지고, 선택이
   앱 재실행 후 유지된다. 환경 변경 전후의 실제 Undo/Redo 경계와 미저장 텍스트를 비교한다.
2. 잘못된 C++ build configuration에서 발생한 오류가 올바른 DB 선택 후 사라진다.
   실제 clangd에는 외부 include 경로·define·C++ 표준이 전달된다.
3. TypeScript project SDK, 프로젝트 분석 끄기/다시 켜기, 현재 세션 재시작이 동작한다.
4. 명시적인 CMake UI 동작이 DB를 생성한다. 별도 실제 CMake/Meson 테스트는 재구성,
   취소와 중복 실행 방지도 검사한다.
5. 실행 중인 서버를 종료시키면 새 프로세스가 최신 미저장 내용을 받고 복구한다.
   편집 명령은 재실행되지 않는다.
6. 초기화 단계에서 계속 종료되는 서버는 최초 실행과 3회 복구 뒤 멈춘다. 상태창에
   중단 이유와 서버 이름을 표시하고, 수동 재시작과 일반 편집이 계속 동작한다.
7. 다른 창/다른 언어의 세션을 유지하는 restart, 위조 candidate와 외부 문서의 IPC
   거부, 제한된 복구 횟수, 서버 action 요청의 만료와 세션 소유권을 검사한다.

전체 계약 검사는 두 차례 모두 단위 696개, 검사 도구 14개, 실제 Electron 225개를
통과했다. 두 번째 실행에는 설정 상속과 프로젝트 단위 중복 configure 방지까지
포함한다. 이후 전역 카탈로그 제어와 프로젝트 선택의 범위를 구분하는 회귀 검사를
추가했다. 실행 중 프로세스 취소의 추가 검사는 실제 PID의 생존/종료까지 확인하고
3개 모두 통과했다. 최종 상태와 성능 결과는 아래에 기록한다.

이 머신에는 rustup의 `rust-analyzer` proxy는 있지만 실제 component가 없고,
`gopls`도 설치되어 있지 않다. 따라서 이번 실제 native 환경 검증 범위는 Pyright,
TypeScript, clangd, CMake, Meson이다. Rust/Go의 기존 제공 기능에 대해 새로 실제
서버 통과를 주장하지 않는다.

## 최종 실행 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 전체 preview contract, 두 번째 실행 | 97개 파일 / 단위 696개, 도구 14개, Electron 225개 통과 | `preview-contract-final.log` |
| 최종 코드의 contract 단위 검사 | 97개 파일 / 697개 + 도구 14개 통과 | `contract-unit-recovery.log` |
| 최종 코드의 전체 언어 Electron 검사 | 25개 통과, retry 0 | `language-electron-recovery.log` |
| 최종 제품 빌드 / typecheck / Svelte 검사 | 성공, Svelte 오류·경고 0 | `build-recovery.log`, `benchmark/candidate-build.log` |
| 실제 configure / 취소 검사 | CMake, Meson, PID 종료 확인 3개 통과 | `configure-cancellation.log`, 최종 단위 로그 |
| 비교 benchmark | 80회 실행, 400개 왕복 cycle, 48개 비교 항목 통과 | [comparison.json](../../reports/gnome-builder-implementation-2026-10-30/benchmark/comparison.json) |

225개 전체 GUI 검사 후 변경된 부분은 전역 카탈로그 표시 범위와 초기화 실패 시
복구 설명·서버 이름 전달이다. 이 최종 코드에서 697개 단위 검사와 전체 언어 GUI
25개를 다시 실행했다. 225개 전체 GUI를 마지막 수정 뒤 다시 실행한 것으로 합산하지
않는다. 새 테스트의 실패 로그도 원래 경로에 남겨 수정 전후를 확인할 수 있다.

### 미리보기 비교

기준은 별도 설치한 `a0396f6`, candidate는 이번 작업 트리다. 같은 Xvfb `:99`,
AMD Ryzen 7 8845HS, Linux x64, Electron 44.7.2, Node 22.23.1을 사용했다.
두 앱의 package-lock hash는 같다. 앱별로 8개 시나리오를 각각 새 프로세스에서
실행하고, AB/BA 순서를 교대하며 5회 반복했다. 실행 중 harness와 빌드 hash가
바뀌지 않았음을 runner가 확인한다. 제품 코드 파일별 식별자는
[source-index.json](../../reports/gnome-builder-implementation-2026-10-30/source-index.json)에 기록한다.

표의 값은 **기준 → 변경, 밀리초**다. 첫 번째와 두 번째는 각각 독립 항목이다.
반복은 한 프로세스의 3–5회차 중앙값을 구한 뒤 5개 프로세스의 중앙값을 취한다.
사전 준비 0ms는 즉시 전환, 3000ms는 입력 전에 준비할 시간을 제공한 경우다.
준비가 덜 끝난 경우의 잔여 작업은 입력 후 측정에 포함된다. 3000ms 대기 자체는
전환 시간에 더하지 않는다.

`captureMs`는 Escape keydown부터 최신 내용이 포함된 비어 있지 않은 native capture까지다.
IPC·polling·readback 비용을 포함하며 모니터에 픽셀이 실제 제시되는 시간은 아니다.
`doubleClickToEditorMs`는 실제 더블클릭 후 편집기로 돌아오는 시간이다.

기존 판정식인 **25% 초과와 50ms 초과를 동시에 만족하면 회귀**를 그대로 사용했다.
누락·중복 시나리오, 잘못된 cycle, 최신 수정이 없는 capture는 runner가 실패 처리한다.
48개 중 회귀는 0개다. 가장 큰 증가는 Git 리뷰 / 준비 0ms / 편집 있음의 첫 capture
31ms로, 이 결과를 성능 향상이라고 해석하지 않는다.

### Escape → 최신 미리보기 capture

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | 반복 |
| --- | --- | --- | --- | --- | --- |
| Markdown | 0ms | 없음 | 48 → 48 | 25 → 28 | 23 → 24 |
| Markdown | 0ms | 있음 | 311 → 309 | 81 → 81 | 95 → 89 |
| Markdown | 3000ms | 없음 | 39 → 43 | 20 → 24 | 24 → 25 |
| Markdown | 3000ms | 있음 | 108 → 105 | 95 → 94 | 88 → 88 |
| Git 리뷰 | 0ms | 없음 | 903 → 905 | 22 → 21 | 29 → 28 |
| Git 리뷰 | 0ms | 있음 | 964 → 995 | 1490 → 1503 | 182 → 181 |
| Git 리뷰 | 3000ms | 없음 | 31 → 25 | 20 → 22 | 17 → 17 |
| Git 리뷰 | 3000ms | 있음 | 231 → 231 | 188 → 186 | 175 → 172 |

### 더블클릭 → 편집기

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | 반복 |
| --- | --- | --- | --- | --- | --- |
| Markdown | 0ms | 없음 | 21 → 18 | 36 → 36 | 12 → 12 |
| Markdown | 0ms | 있음 | 19 → 18 | 14 → 14 | 14 → 14 |
| Markdown | 3000ms | 없음 | 16 → 17 | 11 → 12 | 11 → 11 |
| Markdown | 3000ms | 있음 | 16 → 15 | 13 → 12 | 14 → 14 |
| Git 리뷰 | 0ms | 없음 | 22 → 23 | 12 → 13 | 13 → 13 |
| Git 리뷰 | 0ms | 있음 | 23 → 15 | 21 → 23 | 20 → 20 |
| Git 리뷰 | 3000ms | 없음 | 24 → 25 | 12 → 11 | 19 → 18 |
| Git 리뷰 | 3000ms | 있음 | 23 → 22 | 19 → 20 | 19 → 17 |

다시 실행하려면 설치된 기준 체크아웃을 유지한 상태에서 새로운 output 경로를 사용한다.
GUI wrapper는 npm script가 자동 적용한다. 이 머신에서는 상위 `/tmp/.git`의 영향을
피하도록 별도 TMPDIR를 지정했다.

```sh
run_tmp=$(mktemp -d /var/tmp/setdown-analysis-bench.XXXXXX)
TMPDIR="$run_tmp" npm run bench:preview -- \
  --baseline /tmp/setdown-builder-baseline-a0396f6 \
  --output /tmp/setdown-analysis-benchmark-new
```

### 실제 화면

- [Python 프로젝트 환경](../../reports/gnome-builder-implementation-2026-10-30/language-recovery/language-project-environme-34119-ject-scoped-after-reopening/python-project-environment.png)
- [C++ 빌드 환경](../../reports/gnome-builder-implementation-2026-10-30/language-recovery/language-project-environme-d6013-ithout-replacing-the-editor/cpp-build-environment.png)
- [TypeScript SDK](../../reports/gnome-builder-implementation-2026-10-30/language-recovery/language-project-environme-e8aeb-tart-retains-current-source/typescript-sdk.png)
- [CMake 구성](../../reports/gnome-builder-implementation-2026-10-30/language-recovery/language-project-environme-c5d6d-only-on-the-explicit-action/cmake-configuration.png)
- [서버 복구 후 편집기](../../reports/gnome-builder-implementation-2026-10-30/language-recovery/language-project-environme-7ca79-replaying-an-editor-command/recovered-editor.png)

## 검사 중 발견해 수정한 내용

- provider 상태 변경마다 환경 선택창이 새로 조회되어 busy 상태가 남던 문제를
  문서 경로/언어의 안정된 resource identity로 수정했다.
- Python 입력의 Undo 단계 수를 가정한 새 테스트를 수정했다. 환경 전환 이전의
  실제 Undo 결과와 이후의 결과를 동일한 `innerText` 방식으로 비교하고 Redo까지 확인한다.
  기존 테스트의 assertion, retry, 성능 허용치는 바꾸지 않았다.
- 문서별 `workspace/configuration` 설정 상속을 유지하도록 분석 계획의 configuration
  적용 경계를 보완했다.
- 두 창이 같은 빌드 캐시에 동시에 configure하는 경우를 프로젝트 단위로 막았다.
- 전역 서버 카탈로그의 활성화/비활성화는 기존 전역 기본값을 표시하고, 현재 파일
  선택창에서만 프로젝트별 override를 관리하도록 구분했다.
- 초기화 실패의 IPC 오류가 자동 복구 중단 이유를 덮어쓰지 않게 했다. 초기화 이전에도
  서버의 ID와 표시 이름을 전달해 실패 상태에서 해당 서비스의 재시작 버튼을 식별한다.

초기 샌드박스 빌드는 vendor Git subprocess에서 EPERM으로 실패하여 동일 빌드를
정상 프로세스 권한으로 실행했다. 테스트 임시 프로젝트는 상위 `/tmp/.git`의 영향을
피하도록 별도 `/var/tmp` TMPDIR에 만들었다.

성능 기준 체크아웃은 `/tmp/setdown-builder-baseline-a0396f6`에 별도 설치했다.
처음 사용한 `node_modules/.cache` 내부 worktree는 esbuild의 dependency-directory
동작 때문에 vendor tsconfig alias를 해석하지 못해 사용하지 않았다. 최종 기준
체크아웃은 자체 npm 설치, 자체 Electron, 고정 vendor source를 가지며 Git 상태가 깨끗하다.

## 범위

이 변경은 Builder의 프로젝트 분석·편집기 통합 구조를 Setdown에 적용한다.
GTK 자체, Flatpak/container runtime, 모든 build preset macro, debugger/profiler,
의존성 자동 설치까지 포함하는 전체 IDE 복제는 아니다. 알려지지 않은 build 설정은
기존 고급 연결 설정 또는 외부 build folder 선택으로 처리한다. GNOME Builder의
다른 기능을 구현했다고 표시하지 않는다.
