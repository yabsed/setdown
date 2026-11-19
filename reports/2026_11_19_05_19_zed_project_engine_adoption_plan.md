# 일반 코드의 언어 지원을 Zed 프로젝트 엔진에 맡기는 계획

작성일: 2026-11-19 · 계획 보고서 · 기준 `3597c4203ae9dfda2b4aa99d5ef746558bf3db51` · Zed `vendor/zed` `b5cd310b3b54dfc659fcc06453e6358843dfe216` (1.29.0)

1~10절은 소스를 읽고 쓴 계획이다. 쓸 때는 호스트를 새로 컴파일하거나 실행해 보지 않았고 코드도 바꾸지 않았다. 그 안에서 "확인"은 해당 버전의 소스에서 본 것이고, "추정"과 "제안"은 따로 표시한다. **11절부터는 그 뒤 실제로 실행하고 구현한 결과다.** 지금 어디까지 왔는지는 12절, 아직 확인하지 않은 것은 14절에 있다.

## 결론

**가능하다. 노트북을 뺀 일반 코드 파일에서는 "어떤 서버를, 어느 폴더에서, 어떤 환경과 설정으로 띄우고, 문서를 어떻게 동기화하는가"를 전부 Zed에 맡길 수 있다.** Zed에는 화면 없이 이 일을 하는 조립 예가 이미 있고([headless_project.rs](../vendor/zed/crates/remote_server/src/headless_project.rs)), 우리 호스트는 그 재료인 `project` 크레이트를 이미 링크하고 있다([Cargo.toml](../tooling/language-host/Cargo.toml)).

지금은 Zed에게 "이 서버의 실행 파일과 기본 설정을 알려 달라"는 질문 하나만 한다. 계획은 질문을 바꾸는 것이다. **Setdown은 Zed에게 "이 폴더를 열었고, 이 파일의 현재 내용은 이것이다"만 알려 주고, 나머지 판단은 Zed가 한다.**

Setdown에 남는 것은 네 가지다.

- Monaco 편집기와 그 문서(내용, 저장, 되돌리기). Zed는 분석용 사본만 갖는다.
- 노트북 경로 전체. 요청대로 건드리지 않는다.
- 화면(언어 버튼, 상태 문장, 환경 선택, 도구 목록).
- 제품 정책. 단, 코드가 아니라 Zed 설정 형식의 데이터 파일로 표현한다.

2026-11-09 보고서([Zed 도입 설계 검토](zed-integration-2026-11-09/README.md))의 용어로는 B(도구 호스트)가 끝난 상태에서 C(프로젝트 호스트)로 가는 계획이다. 그 보고서가 장기 목표로 둔 D(Zed가 텍스트와 되돌리기까지 소유)와 E(Zed 편집 화면)는 이 계획에 넣지 않는다.

먼저 할 일은 0단계 실험 하나다. 통과하지 못하면 거기서 멈추고 9절의 작은 대안으로 간다.

## 1. 지금 위치

| 일 | 지금 하는 쪽 | 근거 |
| --- | --- | --- |
| 서버 실행 파일 찾기, 검증, 다운로드 | Zed | [main.rs](../tooling/language-host/src/main.rs)의 `prepare` |
| 어댑터 기본 설정, 프로젝트 셸 환경 | Zed | 같은 파일 |
| 파일에 붙일 서버 고르기 | Setdown | [supported-languages.ts](../apps/desktop/src/core/document/supported-languages.ts), [server-registry.ts](../apps/desktop/src/main/language/server-registry.ts) |
| 분석 루트 찾기 | Setdown | [language-root.ts](../apps/desktop/src/main/language/language-root.ts) |
| Python 환경, TypeScript SDK, C++ 빌드 폴더 | Setdown | [analysis-context.ts](../apps/desktop/src/main/language/analysis-context.ts) |
| `.zed/settings.json` 읽기 | Setdown (`lsp.*`의 두 키만) | [zed-project-settings.ts](../apps/desktop/src/main/language/zed-project-settings.ts) |
| 서버 프로세스, 문서 동기화, 기능 협상, 진단 | Setdown | [server-session.ts](../apps/desktop/src/main/language/server-session.ts), [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts) |
| Python과 JS/TS | Setdown (번들 서버라 Zed를 거치지 않음) | [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts)의 `bundledNode` 제외 |

호스트가 Zed의 `Project`, `Worktree`, `LspStore`를 만들지 않기 때문에 위 표의 아래쪽 여섯 줄이 Setdown에 남아 있다. 이 계획은 그 여섯 줄을 옮긴다.

## 2. 전환 후 구조

호스트 프로세스 안에 Setdown 창마다 Zed 프로젝트 하나를 둔다. 창을 나누는 이유는 지금과 같다. 같은 파일을 두 창에서 다르게 고치고 있을 때 내용이 섞이면 안 된다.

| 일 | 전환 후 주인 | Zed에서 쓰는 것 (확인) |
| --- | --- | --- |
| 폴더 감시, 파일 목록 | Zed | `WorktreeStore` |
| 파일의 언어 판별(서버 연결용) | Zed | `LanguageRegistry` |
| 붙일 서버 고르기 | Zed | 설정의 `languages.<언어>.language_servers` |
| 루트 정하기 | Zed | 연 폴더가 루트. Rust는 `Cargo.toml`, Python은 `pyproject.toml`로 하위 프로젝트를 구분 ([rust.rs:282](../vendor/zed/crates/languages/src/rust.rs#L282), [python.rs:75](../vendor/zed/crates/languages/src/python.rs#L75)) |
| Python 환경 찾기 | Zed | `PythonToolchainProvider` ([python.rs:1314](../vendor/zed/crates/languages/src/python.rs#L1314)) |
| 프로젝트 셸 환경 | Zed | `ProjectEnvironment` |
| `.zed/settings.json`과 사용자 설정 전체 | Zed | `SettingsObserver` |
| 서버 시작, 초기화, 설정 응답, 동적 등록 | Zed | `LspStore` |
| `didOpen`/`didChange`/`didSave`, 파일 변경 감시 통지 | Zed | `LspStore` |
| 진단(밀어주기와 요청하기 둘 다) | Zed | `LspStoreEvent::DiagnosticsUpdated` |
| 편집 내용의 정본, 저장, 되돌리기 | Setdown | 변화 없음 |
| 완성, hover, 이동 등의 화면 표시 | Setdown | 변화 없음 |
| 편집 적용(이름 바꾸기, 서식, 빠른 수정) | Setdown | 변화 없음 |
| 노트북 | Setdown | 변화 없음 |

Setdown과 호스트 사이의 대화는 여섯 종류로 줄어든다(제안).

1. 폴더를 연다 / 닫는다.
2. 파일을 연다 / 닫는다 / 현재 내용이 이렇게 바뀌었다 / 저장했다.
3. 이 파일에 붙은 서버와 그 기능 목록을 알려 달라.
4. 이 서버에 이 LSP 요청을 보내고 답을 그대로 돌려 달라.
5. (호스트가 알림) 진단이 바뀌었다 / 서버 상태가 바뀌었다 / 서버가 질문을 한다.
6. 환경 목록을 달라 / 이 환경을 써라.

## 3. 요청을 전달하는 방식: LSP 원문 그대로

호스트가 완성이나 hover 요청을 처리하는 방법은 둘이다.

| | 원문 전달 | Zed의 기능 함수 호출 |
| --- | --- | --- |
| 방법 | Zed가 띄운 서버에 Setdown의 LSP 요청을 그대로 보내고 답을 그대로 받는다 | `Project::hover`, `completions` 같은 함수를 부르고 Zed 내부 타입을 Setdown 형식으로 바꾼다 |
| 우리가 새로 쓰는 코드 | 적다. 기능 수와 무관 | 기능마다 변환 코드. 현재 허용 목록은 43개 메서드 ([language.ts](../apps/desktop/src/protocol/language.ts)) |
| 렌더러 변경 | 거의 없음. 지금도 LSP 형식을 받는다 | 기능마다 있음 |
| Zed 버전을 올릴 때 | 접점이 좁다 | Zed 내부 타입이 바뀌면 변환 코드가 깨진다 |
| 편집 | 서버가 준 편집안을 Setdown이 기존 경로로 적용 | Zed가 자기 사본을 직접 고친다 (7절 위험) |
| Zed에서 못 얻는 것 | 여러 서버 결과 합치기, 어댑터의 완성 후처리 | 없음 |

**원문 전달을 권한다.** 서버 수명과 문서 동기화, 설정, 진단처럼 틀리기 쉬운 부분은 Zed가 맡고, LSP 답을 Monaco에 그리는 부분은 이미 있고 검증된 코드가 맡는다. LSP 형식은 표준이라 Zed 버전과 무관하게 유지된다. 필요한 Zed 함수는 공개되어 있다(확인): `LspStore::language_servers_for_local_buffer`, `language_server_for_id` ([lsp_store.rs:9961](../vendor/zed/crates/project/src/lsp_store.rs#L9961), [12053](../vendor/zed/crates/project/src/lsp_store.rs#L12053)), `LanguageServer::request`, `capabilities` ([lsp.rs:1511](../vendor/zed/crates/lsp/src/lsp.rs#L1511), [1478](../vendor/zed/crates/lsp/src/lsp.rs#L1478)).

여러 서버가 한 파일에 붙을 때 누구에게 묻고 결과를 어떻게 합칠지는 렌더러의 기존 규칙이 계속 정한다. 이 부분은 자체 구현으로 남는다.

## 4. 지울 수 있는 것과 남는 것

줄 수는 현재 파일 크기다. 이 저장소의 줄은 길어서 실제 분량은 숫자보다 크다.

| 파일 | 줄 | 전환 후 |
| --- | ---: | --- |
| [server-discovery.ts](../apps/desktop/src/main/language/server-discovery.ts), [server-environment.ts](../apps/desktop/src/main/language/server-environment.ts) | 297 | 삭제 |
| [language-provisioner.ts](../apps/desktop/src/main/language/language-provisioner.ts), [language-package-store.ts](../apps/desktop/src/main/language/language-package-store.ts) | 270 | 삭제. 설치와 실행 기록은 Zed가 관리 |
| [zed-project-settings.ts](../apps/desktop/src/main/language/zed-project-settings.ts) | 84 | 삭제. Zed가 설정 파일을 직접 읽음 |
| [tool-runtime.ts](../apps/desktop/src/main/language/tool-runtime.ts) | 90 | 삭제 후보. Java 실행 환경 고르기를 Zed 확장에 맡길 때 |
| [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts) | 903 | 크게 축소. 창과 문서의 소유 확인, 호스트로 전달, 노트북 분기만 남음 |
| [server-registry.ts](../apps/desktop/src/main/language/server-registry.ts) | 408 | 축소. 사용자 선택을 Zed 설정으로 쓰는 일과 도구 목록 화면용 조회만 남음 |
| Helix/Mason 프로필 생성 ([update-language-profiles.py](../apps/desktop/scripts/update-language-profiles.py), `profiles.json`, `mason.json`) | 164 + 데이터 | 5단계에서 삭제 여부 결정 |
| [language-root.ts](../apps/desktop/src/main/language/language-root.ts), [analysis-context.ts](../apps/desktop/src/main/language/analysis-context.ts), [python-project-settings.ts](../apps/desktop/src/main/language/python-project-settings.ts) | 420 | **노트북 전용으로 남음** |
| [server-session.ts](../apps/desktop/src/main/language/server-session.ts), [server-capabilities.ts](../apps/desktop/src/main/language/server-capabilities.ts), [server-items.ts](../apps/desktop/src/main/language/server-items.ts), [language-session-pool.ts](../apps/desktop/src/main/language/language-session-pool.ts) | 494 | **노트북 전용으로 남음** |
| [notebook-language-host.ts](../apps/desktop/src/main/language/notebook-language-host.ts) | 250 | 그대로 |
| 렌더러 `language-client.ts`와 `language-*-features.ts` | 약 900 | 그대로 |

정직하게 말해야 할 점이 둘 있다.

- **자체 LSP 클라이언트는 사라지지 않는다.** 노트북 경로가 `ServerSession`과 그 주변을 쓴다([notebook-language-host.ts](../apps/desktop/src/main/language/notebook-language-host.ts)의 import). 이 Zed 버전에는 노트북 문서 동기화가 없어서 노트북을 Zed로 옮길 수 없다(11-09 보고서 7절에서 확인). 일반 파일 쪽 책임이 빠지면서 이 코드는 노트북 한 가지 용도로 단순해진다.
- **호스트의 Rust 코드는 늘어난다.** 지금 272줄이다. 폴더와 사본 관리, 요청 전달, 이벤트 변환이 추가된다. 수백 줄에서 1천 줄대로 추정하며 0단계에서 실측한다. 이 코드는 LSP 지식이 아니라 Zed와 Setdown을 잇는 배선이다.

## 5. "Zed 그대로"로 가면 동작이 달라지는 곳

Zed의 판단을 그대로 받으면 지금과 결과가 달라지는 지점이 있다. 각 항목은 0~4단계에서 실제 프로젝트로 확인한다.

**기본 도구.** Zed의 기본값은 Python에 basedpyright와 ruff, JS/TS에 vtsls, PHP에 phpactor다([default.json](../vendor/zed/assets/settings/default.json)의 2626, 2556, 2599행). Setdown은 [lsp-benchmark](../apps/lsp-benchmark/README.md) 측정으로 pyright, typescript-language-server, intelephense를 골랐다. Zed에는 이 세 도구의 어댑터도 있으므로([python.rs:645](../vendor/zed/crates/languages/src/python.rs#L645), [typescript.rs:619](../vendor/zed/crates/languages/src/typescript.rs#L619)), 우리 선택을 Zed 설정 파일 한 장으로 유지할 수 있다. 권고: 선택은 데이터로 유지하고, 같은 벤치마크에서 Zed 기본값이 같거나 나으면 그 줄을 지운다.

**번들 서버.** 앱에 들어 있는 Pyright와 TypeScript 서버는 네트워크 없이 첫 실행부터 동작한다. Zed 어댑터로 옮기면 첫 사용 때 npm으로 내려받는다. 설정의 `lsp.<서버>.binary.path`로 번들 사본을 가리키면 오프라인 동작을 지킬 수 있다(`BinarySettings`에 `path`, `arguments`, `env`가 있음을 확인. 번들 경로로 실제 시작되는지는 미확인).

**루트.** Zed의 루트는 사용자가 연 폴더다. Setdown은 폴더 없이 파일 하나만 여는 일이 많고, 그때 루트 표시 파일을 위로 찾아 올라간다. 전환 후에는 "Zed 사용자라면 어느 폴더를 열었을까"만 Setdown이 정한다. 제안: 열려 있는 폴더가 파일을 포함하면 그 폴더, 아니면 Git 저장소 경계, 그것도 없으면 파일 하나. `/tmp/.git` 같은 빈 표시를 저장소로 보지 않는 현재 규칙은 이 판단에 그대로 남긴다.

**폴더 전체 읽기.** Zed는 연 폴더를 전부 훑고 변경을 감시한다. 지금 Setdown은 그러지 않는다. 큰 저장소에서 메모리와 CPU가 얼마나 드는지 0단계에서 측정한다. 이 기기는 13 GiB라 여유가 크지 않다.

**Python 환경.** Zed의 탐색기가 `.venv`, Conda, Poetry 등을 찾는다. 환경 선택 화면은 남기되, 목록과 적용은 Zed에 묻는다. 지금의 "유일하면 자동, 여러 개면 묻기" 규칙과 Zed의 기본 선택이 같은지는 미확인이다.

**TypeScript SDK.** Zed 어댑터는 연 폴더 바로 아래의 `node_modules/typescript/lib`만 본다([vtsls.rs:42](../vendor/zed/crates/languages/src/vtsls.rs#L42)). Setdown은 저장소 경계까지 위로 찾는다. 모노레포의 하위 패키지에서 결과가 달라질 수 있다.

**C/C++ 빌드 폴더.** Zed의 clangd 어댑터에는 `compile_commands.json` 탐색이 없다(확인: [c.rs](../vendor/zed/crates/languages/src/c.rs)에 해당 코드 없음). 빌드 폴더 선택과 **Configure project**는 Setdown 기능으로 남기고, 결과만 `lsp.clangd.binary.arguments` 설정으로 넘긴다.

**다운로드 정책.** Zed의 프로젝트 엔진은 서버를 시작할 때 다운로드를 허용으로 고정한다([lsp_store.rs:585](../vendor/zed/crates/project/src/lsp_store.rs#L585)). "다운로드 끔"은 지금처럼 호스트의 HTTP를 막는 방식으로, "묻고 설치"는 허락된 서버만 설정에 켜는 방식으로 지킨다. 확장이 자체 설치기를 돌리는 경우까지 막히는지는 실험이 필요하다.

**폴더 신뢰.** Zed는 신뢰하지 않은 폴더에서 서버 시작을 미룬다([lsp_store.rs:540](../vendor/zed/crates/project/src/lsp_store.rs#L540)). Setdown은 파일을 열면 바로 시작한다. 제안: 사용자가 Setdown에서 직접 연 파일과 폴더는 신뢰로 표시해 지금 동작을 유지한다.

**죽은 서버 되살리기.** Setdown은 1, 3, 5초 뒤에 다시 연결한다. 이 Zed 버전에서 자동 재시작 코드는 찾지 못했다. 재시도 시점은 Setdown이 정하고 Zed의 재시작 함수를 부르는 형태가 될 가능성이 높다.

**상태 문장.** "Java 21 이상이 필요합니다" 같은 원인별 문장은 지금 Setdown이 서버 종료를 직접 관찰해서 만든다. 전환 후에는 Zed의 상태 이벤트와 로그에서 같은 원인을 뽑아야 한다. 일부 원인은 덜 구체적이 될 수 있다.

**목록 밖 서버.** Helix/Mason에서 온 560개 프로필과 JSON으로 가져온 연결은 Zed 어댑터가 없다. 호스트에 "명령과 인수만 가진 어댑터" 하나를 두고 Zed의 등록부에 넣으면, 이 서버들도 Zed가 띄우고 동기화한다(제안, 미검증). 두 번째 실행 경로를 남기지 않기 위한 장치다.

## 6. Setdown의 선택을 Zed 설정으로 표현하기

지금 Setdown의 선택은 코드와 자체 JSON에 흩어져 있다. 전환 후에는 Zed 설정 형식 하나로 모은다(제안).

| 계층 | 내용 | 우선순위 |
| --- | --- | --- |
| Zed 기본값 | [default.json](../vendor/zed/assets/settings/default.json) | 가장 낮음 |
| Setdown 기본값 | 지원 언어의 도구 선택, 번들 서버 경로, JSON 스키마 주소 같은 [overrides.json](../apps/desktop/scripts/language-profiles/overrides.json)의 `settings` | |
| 사용자의 Zed 설정 | `~/.config/zed/settings.json` | |
| 화면에서 한 선택 | 언어별 기본 도구, 프로젝트별 환경, 연결 설정 | |
| 프로젝트의 `.zed/settings.json` | Zed가 직접 읽음 | 가장 높음 |

화면에서 한 선택과 프로젝트 파일 중 무엇이 이겨야 하는지는 정해야 한다. 지금 문서는 "Setdown의 명시적 연결 설정이 최종"이라고 한다([language-support.md](../docs/language-support.md)의 Zed 설정 공유 절).

얻는 것은 분명하다. 지금은 `.zed/settings.json`에서 `lsp.<서버>.settings`와 `initialization_options`만 반영된다. 전환 후에는 `languages.*.language_servers`, `binary`, 서식 설정 등 Zed 사용자가 쓰는 설정이 그대로 통한다.

## 7. 위험

**Zed가 자기 사본을 직접 고친다.** 가장 큰 위험이고 11-09 보고서도 같은 지점을 짚었다. 원문 전달 방식에서는 이름 바꾸기나 서식의 편집안이 Setdown으로 오므로 Zed의 편집 함수를 부르지 않는다. 그러나 서버가 먼저 보내는 `workspace/applyEdit`은 Zed의 처리기가 받고, 그 처리기는 사본을 고치고 파일을 만들고 옮기고 지운다([lsp_store.rs:3829-3938](../vendor/zed/crates/project/src/lsp_store.rs#L3829)). 막는 방법 두 가지를 0단계에서 실험한다.

- 호스트가 Zed에 넘기는 파일 시스템 객체를 감싸서 쓰기를 거부한다. vendor를 고치지 않는다.
- 사본에 Setdown이 보내지 않은 편집이 생기면 그 편집을 Setdown에 제안으로 보내고, 거부되면 사본을 Setdown의 현재 내용으로 되돌린다.

둘 다 안 되면 vendor에 작은 패치가 필요하다. 지금까지 vendor는 고치지 않았다.

**사본이 어긋난다.** 디스크의 파일이 바뀌면 Zed는 고치지 않은 사본을 스스로 다시 읽는다. 그 순간 Setdown이 보낸 변경과 순서가 엇갈릴 수 있다. 모든 변경에 Setdown의 판 번호를 붙이고, 어긋나면 전체 내용을 다시 보낸다. 한글 조합, 이모지, CRLF에서 위치가 맞는지 따로 본다.

**Zed 내부는 공개 SDK가 아니다.** 필요한 함수 일부는 크레이트 내부 전용이다. 예를 들어 사본을 서버에 등록하는 함수는 `LspStore`에서는 내부 전용이고 `Project`에서만 공개다([lsp_store.rs:5374](../vendor/zed/crates/project/src/lsp_store.rs#L5374), [project.rs:3389](../vendor/zed/crates/project/src/project.rs#L3389)). `Project::local`을 쓰려면 Zed 계정용 `Client`와 `UserStore`를 만들어야 한다. 어느 조립이 되는지가 0단계의 첫 질문이다.

**Zed를 올릴 때마다 호스트가 깨질 수 있다.** 접점을 2절의 여섯 종류로 묶어 두는 이유다.

**성능 계약.** 언어 제공자와 Electron 의존성은 [Preview 성능 계약](../docs/preview-performance-contract.md)의 범위다. 단계마다 `npm run test:preview-contract`와 `npm run bench:preview`를 돌린다. 허용치는 그대로 둔다.

**플랫폼.** 이 계획의 확인은 Linux 소스 기준이다. Windows는 별도 확인이 필요하다.

## 8. 단계

각 단계는 혼자 배포할 수 있고, 통과 조건을 만족해야 다음으로 간다. 측정 도구는 이미 있다. [lsp-benchmark](../apps/lsp-benchmark/README.md)가 실제 프로젝트의 파일을 제품 경로로 열어 진단, hover, 완성, 정의 이동을 기록한다. 같은 사례를 새 경로로 돌려 결과가 같거나 나아야 한다.

| 단계 | 하는 일 | 통과 조건 | 지우는 것 |
| --- | --- | --- | --- |
| 0. 실험 | 호스트에 Zed 프로젝트를 조립. 폴더 열기, 사본 동기화, 진단과 hover 원문 전달. 제품에는 연결하지 않음 | Rust, TypeScript, Python의 실제 프로젝트에서 저장하지 않은 내용에 대한 진단과 hover가 나옴. 서버발 `applyEdit`이 디스크와 Setdown 문서를 건드리지 못함. 큰 저장소의 메모리 측정값 | 없음 |
| 1. 설정 계층 | 6절의 계층을 만들고 Zed가 설정 파일을 직접 읽게 함 | `.zed/settings.json`의 `language_servers` 변경이 반영됨. 기존 YAML 사용자 태그 사례 유지 | `zed-project-settings.ts` |
| 2. 읽기 기능 | 일반 파일의 열기, 변경, 진단, 읽기 요청을 새 경로로. 언어군 단위로 전환 | 지원 언어 14종의 벤치마크 결과가 같거나 나음. 두 창의 서로 다른 미저장 내용이 섞이지 않음. 언어 E2E 통과 | 탐색, 설치, 루트 계산 중 일반 파일용 부분 |
| 3. 편집 기능 | 이름 바꾸기, 서식, 빠른 수정, 저장 전 편집, 파일 이름 변경 통지 | 편집이 Monaco의 되돌리기에 들어감. 오래된 판에 대한 편집 거부. 여러 파일 편집 | `language-manager.ts`의 일반 파일 세션 관리 |
| 4. 환경 | Python 환경 화면을 Zed에 연결. C++ 빌드 폴더를 설정으로 전달 | `project-environment.spec.ts`의 Python, clangd, TypeScript, CMake 사례 | `analysis-context.ts`의 일반 파일용 부분 |
| 5. 목록 밖 서버 | 명령만 가진 어댑터로 가져온 연결과 프로필 서버를 Zed가 띄움 | fortls 사례, 사용자 연결 가져오기 사례 | 일반 파일용 자체 실행 경로 전부. Helix/Mason 생성기는 결정에 따라 |
| 6. 정리 | 문서와 계약 갱신, 죽은 코드 제거 | 성능 계약, 전체 테스트 | 4절의 삭제 목록 |

2단계부터는 같은 문서를 두 경로가 동시에 맡지 않게 한다. 전환한 언어는 새 경로만, 전환하지 않은 언어는 기존 경로만 쓴다. 전환 스위치는 6단계에서 없앤다.

## 9. 0단계가 실패할 때의 작은 대안

Zed 프로젝트 조립이 안 되거나 메모리가 감당이 안 되면, 자체 클라이언트는 두고 판단만 더 넘긴다. 호스트에 질문 세 개를 추가한다: 이 파일의 루트는 어디인가, 이 폴더의 Python 환경은 무엇인가, 이 파일에 적용되는 Zed 설정은 무엇인가. 그러면 `language-root.ts`, `zed-project-settings.ts`, `analysis-context.ts`의 Python 부분이 Zed의 답으로 바뀐다. 줄어드는 양은 작고 문서 동기화와 서버 수명은 계속 Setdown 책임이다.

## 10. 정해 주셔야 할 것

| 질문 | 권고 |
| --- | --- |
| 기본 도구를 Zed 기본값으로 바꿀까, 벤치마크로 고른 현재 도구를 유지할까 | 현재 도구를 설정 데이터로 유지하고, 벤치마크에서 Zed 기본값이 같거나 나은 언어만 바꾼다 |
| Helix/Mason 프로필 560개와 JSON 연결 가져오기를 계속 지원할까 | JSON 가져오기는 유지. Helix/Mason 자동 프로필은 Zed 확장과 겹치는 범위를 센 뒤 5단계에서 결정 |
| 화면에서 한 선택과 `.zed/settings.json`이 다를 때 누가 이길까 | 프로젝트 파일. Zed 사용자의 기대와 같아진다. 지금 문서와는 반대다 |
| vendor에 작은 패치를 허용할까 | 0단계에서 패치 없이 안 될 때만. 패치는 파일로 보관하고 Zed 버전을 올릴 때 다시 적용 |

## 11. 0단계 실험 결과 (2026-11-19, 같은 날 실행)

호스트에 Zed 프로젝트를 조립했고([project_host.rs](../tooling/language-host/src/project_host.rs)), 실제 프로젝트로 돌렸다([project.mjs](../tooling/language-host/test/project.mjs)). 디버그 빌드, Linux, vendor 수정 없음. 제품에는 아직 연결하지 않았다.

```sh
node tooling/language-host/test/project.mjs target/language-host/debug/setdown-language-host
```

| 프로젝트 (고정 커밋은 [projects.mjs](../apps/lsp-benchmark/projects.mjs)) | 서버 | 서버 붙음 | 첫 hover | 저장 안 한 실수의 표시 | 호스트 메모리 |
| --- | --- | ---: | ---: | --- | ---: |
| p-queue `source/index.ts` | typescript-language-server (앱 번들 사본) | 1.0초 | 2.5초 | 표시됨, 되돌리면 지워짐 | 109 MiB |
| flask `src/flask/app.py` | pyright (앱 번들 사본) | 1.7초 | 2.8초 | `reportAssignmentType` | 118 MiB |
| walkdir `src/lib.rs` | rust-analyzer (Zed가 관리하는 사본) | 2.5초 | 4.4초 | `E0061` | 124 MiB |

세 경우 모두 디스크의 파일은 바뀌지 않았고, 사본이 편집기 내용과 어긋났다는 신호도 없었다. 변경은 한글과 이모지가 든 줄을 포함해 UTF-16 범위로 보냈다.

확인된 것:

- **조립.** `Project::local`이 화면 없이 동작한다. Zed 계정용 `Client`는 풀리지 않는 주소(`setdown.invalid`)로 만들어 Zed의 서비스에 닿지 못하게 했다.
- **서버가 먼저 보내는 편집.** 서버가 시작된 뒤 `workspace/applyEdit` 처리기를 호스트의 것으로 바꿀 수 있다. 시험용 서버가 파일 생성과 문서 편집을 요청했을 때 요청은 편집기 쪽으로 전달됐고, 파일은 생기지 않았고, 사본도 그대로였다. 7절의 파일 시스템 감싸기와 vendor 패치는 필요 없었다.
- **저장.** 편집기가 파일을 쓴 뒤 알리면 사본을 저장된 것으로 표시하고, 그때 Zed가 `didSave`를 보낸다. 호스트는 쓰지 않는다.
- **번들 서버.** `lsp.<서버>.binary.path`로 앱에 든 Pyright와 TypeScript 서버를 가리키면 그대로 시작된다.
- **폴더 전체 읽기.** 이 저장소 전체(서브모듈 53개, `vendor` 3.3 GB)를 열면 호스트가 56 MiB에서 296 MiB가 되고 약 30초 걸렸다. `apps/desktop`만 열면 102 MiB, 1초.

계획과 달랐던 것:

- **Python 환경은 Zed가 자동으로 고르지 않는다.** 감지는 프로젝트 엔진이 하지만, "아무것도 안 골랐으면 첫 번째를 쓴다"는 Zed의 화면 쪽 코드(`toolchain_selector`)에 있다. 호스트에 같은 규칙을 옮겼다. 옮기기 전에는 flask에서 `MapAdapter: Unknown`이 나왔다.
- **Zed는 묻지 않고 Prettier를 설치한다.** 기본 서식 설정이면 `npm install prettier@latest`가 실행됐다. 설정에 `"formatter": "language_server"`를 두면 실행되지 않는다. Setdown 기본값 계층에 들어가야 한다.
- **TypeScript 타입 자동 내려받기.** Zed 어댑터는 이를 끄지 않는다. `initialization_options`의 `disableAutomaticTypingAcquisition`으로 껐다. 역시 기본값 계층에 들어가야 한다.

5절의 "미확인" 가운데 번들 서버 경로와 Python 환경 기본 선택은 이로써 확인됐다.

## 12. 제품 연결 뒤 진행 상황 (2026-11-19 오후)

1단계(설정 계층)와 2·3단계의 뼈대가 제품에 들어갔고, 도구 6개가 새 경로를 기본으로 쓴다. 나머지 도구는 기존 경로 그대로다. 커밋은 아직 하지 않았다.

**지금 새 경로를 쓰는 도구:** `gopls`, `json-lsp`, `yaml-language-server`, `dockerfile-language-server`, `css-lsp`, `html-lsp`. 목록은 [zed-settings.ts](../apps/desktop/src/main/language/zed-settings.ts)의 `projectEngineTools`에 있다. 언어로는 Go, JSON, YAML, Dockerfile, Docker Compose, CSS, SCSS, Less, HTML이다.

**새 경로로 가지 않는 경우:** 노트북, 사용자가 직접 추가한 연결, 프로젝트 폴더별 선택이 있는 파일, 내려받기 규칙이 전체 설정과 다른 도구, Zed에 언어가 없는 방언(Go 템플릿). 환경 변수 `SETDOWN_LANGUAGE_ENGINE=legacy`는 전부 기존 경로로, `=zed`는 가능한 전부를 새 경로로 보낸다(측정용).

### 12.1 벤치마크

같은 실제 프로젝트, 같은 사례를 두 경로로 돌렸다. 웹 매니페스트, Prettier 파일, `jsconfig.json` 세 사례는 이번에 [cases.mjs](../apps/lsp-benchmark/cases.mjs)에 더했다(h5bp/html5-boilerplate, sveltejs/realworld의 실제 파일). 결과 파일은 [results](../apps/lsp-benchmark/results/)의 `legacy-light`, `engine-light`, `default-light`, `legacy-rust-go`, `engine-rust-go`다.

| 언어 | 기대한 답 (오류 없음, 실수 표시, hover, 완성) | 시작까지, 기존 경로 | 시작까지, 새 경로 |
| --- | --- | ---: | ---: |
| Go, Go 모듈 파일 | 둘 다 전부 맞음 | 0.1~0.3초 | 0.9~2.1초 |
| JSON, JSON with comments | 둘 다 전부 맞음 | 0.3~0.5초 | 1.4~1.5초 |
| 웹 매니페스트(`.webmanifest`), Prettier 파일, `jsconfig.json` | 둘 다 전부 맞음 | 0.3초 | 1.0초 |
| YAML, GitHub workflow | 둘 다 전부 맞음 | 0.4초 | 1.1~2.0초 |
| Dockerfile | 둘 다 전부 맞음 | 1.2초 | 2.3초 |
| Docker Compose | 둘 다 전부 맞음 | 0.4초 | 1.9초 |
| CSS, SCSS, Less | 둘 다 전부 맞음 | 0.3초 | 1.5~1.7초 |
| HTML | 둘 다 전부 맞음 | 2.0초 | 3.0초 |

15개 사례 모두 두 경로에서 기대한 답이 나왔다. 표의 시간은 같은 자리에서 연달아 돌린 마지막 실행의 값이다. **시작은 새 경로가 0.7~1.8초 느리다.** Zed는 도구를 처음 띄울 때 새 버전이 있는지 확인한다(HTML에서 잰 순서: 0.5초에 시작, 1.5초에 버전 확인, 2.7초에 서버 연결). 기존 경로는 한 번 준비한 실행 정보를 파일에 적어 두고 다시 쓴다. 이 차이를 받아들일지, 줄일 방법을 찾을지는 아직 정하지 않았다.

**실제 앱 테스트(E2E).** 언어 묶음 38개를 숨은 화면에서 실제 Electron으로 돌려 37개가 통과하고 1개가 실패했다. 실패한 것은 [language-registry.spec.ts](../apps/desktop/test/e2e/language/language-registry.spec.ts)의 "an imported npm profile starts automatically…"이고, 원인은 아래 12.3의 "설치된 프로그램 찾기"다. 테스트는 고치지 않았다.

### 12.2 새 경로에서 발견해 고친 것

| 증상 | 원인 | 고친 방법 |
| --- | --- | --- |
| `package.json`, `tsconfig.json`에서 hover와 완성이 없음. "오류 없음" 확인에 63초 | Zed의 JSON 서버는 스키마를 Zed에 되묻는다. 호스트가 그 질문에 답하는 부분을 켜지 않았다 | 호스트에서 `json_schema_store::init`을 부른다 |
| SCSS, Less 파일에 도구가 안 붙음 | Zed는 이 두 언어를 확장으로만 안다. 확장이 없으면 파일의 언어가 없다 | Setdown이 언어 이름과 파일 끝 이름을 호스트에 알려 등록한다. 확장은 설치하지 않는다 |
| Docker Compose 파일에 `yaml-language-server` 대신 `docker-language-server`가 붙음 | Docker 확장이 로드되면 Zed가 이 파일을 "Docker Compose" 언어로 보고 확장의 서버를 붙인다 | 위와 같은 등록에 더해, Zed가 내장한 서버를 어느 언어에든 설정으로 붙일 수 있게 했다. Zed가 Tailwind, ESLint에 쓰는 방식 그대로다 |
| HTML의 `<style>` 안 실수가 표시되지 않음 | HTML 서버의 CSS 검사기가 "설정 없음(null)"을 받으면 내부 오류로 멈춘다. Zed는 값이 없는 설정 질문에 null로 답한다. Zed 자체에서도 같은 일이 날 것으로 보이지만 Zed에서 직접 확인하지는 않았다 | 확장이 제공하는 서버에는 Setdown이 가진 그 도구의 설정을 `lsp.<서버>.settings`로 준다. 해당하는 도구는 지금 HTML 하나다 |
| `.webmanifest`, `.arb` 같은 파일에 도구가 안 붙음. `jsconfig.json`은 주석을 허용하지 않는 JSON으로 열림 | Setdown 목록이 아는 파일 이름이 Zed보다 많고, 몇 개는 Zed와 다르게 본다(`.prettierrc`는 Setdown에서 YAML, Zed에서 JSON) | 파일을 열 때 Setdown이 정한 문서 언어를 Zed 이름으로 알려 주고, 호스트가 Zed에서 사람이 파일 언어를 고를 때와 같은 방법으로 정한다. 문서 언어는 사람이 화면에서 보고 바꿀 수 있는 값이고 도구도 그 값으로 골랐으므로, 서버도 같은 값을 받는다 |
| Go 템플릿(`.gotmpl`)처럼 Zed에 언어가 없는 방언 | Zed에서 열면 어느 서버에도 속하지 않는 파일이 된다 | 그런 파일은 기존 경로에 남긴다 |
| `jsconfig.json`, `tsconfig.*.json`, Babel, ESLint, Prettier 파일에 스키마가 없음 | Zed는 `package.json`과 `tsconfig.json`의 스키마만 갖고 있다. 기존 경로는 여섯 가지 주소를 준다 | Setdown 목록의 나머지 주소를 기본값 계층의 `lsp.json-language-server.settings`에 넣는다. Zed의 JSON 어댑터가 자기 목록에 덧붙인다 |
| 호스트가 `setdown.invalid/telemetry/events`로 전송을 시도 | Zed의 사용 통계 기능. 주소가 풀리지 않아 실제로 나간 것은 없다 | 호스트가 가장 낮은 설정 계층에서 통계를 항상 끈다 |

vendor는 고치지 않았다. 호스트 쪽 변경은 [main.rs](../tooling/language-host/src/main.rs)와 [project_host.rs](../tooling/language-host/src/project_host.rs), 설정 쪽은 [zed-settings.ts](../apps/desktop/src/main/language/zed-settings.ts)와 그 단위 테스트다.

### 12.3 계획과 달라진 것

- **진단은 호스트가 요청한다.** JSON, CSS, HTML, rust-analyzer처럼 "물어봐야 진단을 주는" 서버는 Zed의 편집기 화면 코드가 묻는다. 호스트에는 그 화면이 없어서 같은 시점(파일이 서버를 얻었을 때, 내용이 바뀐 뒤, 서버가 작업을 끝냈을 때)에 호스트가 묻는다.
- **설정 계층은 네 개가 됐다.** Setdown 기본값, 사용자의 Zed 설정 파일, Language Support에서 한 선택, 프로젝트의 `.zed/settings.json` 순이다. [overrides.json](../apps/desktop/scripts/language-profiles/overrides.json)의 도구별 설정을 통째로 옮기지는 않았다. Zed 내장 서버는 Zed가 주는 설정을 그대로 쓴다.
- **설치된 프로그램 찾기가 달라진다. 정해야 한다.** 기존 경로에서 JSON 도구는 Setdown이 직접 찾았다. PATH에 없어도 npm 전역 패키지 폴더를 읽어 찾아냈고, 실패한 E2E가 이 동작을 확인하는 테스트다. 새 경로에서는 Zed의 JSON 어댑터가 찾는데, PATH만 보고 없으면 npm으로 새로 받는다([json.rs:167](../vendor/zed/crates/languages/src/json.rs#L167)). 그래서 PATH 밖에 설치된 프로그램은 쓰이지 않고, 도구 목록 화면은 여전히 "Found on this computer"로 그 프로그램을 보여 준다. 이 계획의 1절 표는 실행 파일 찾기를 Zed에 맡기고 4절은 [server-discovery.ts](../apps/desktop/src/main/language/server-discovery.ts)를 지우기로 했으므로 계획대로라면 Zed의 규칙을 받는 쪽이다. 그 경우 이 테스트는 기존 경로에 남는 도구로 옮기고, 도구 목록 화면이 Zed가 실제로 쓰는 프로그램을 보여 주게 고쳐야 한다. 반대로 지금 동작을 지키려면 Setdown이 찾은 프로그램을 `lsp.<서버>.binary`로 Zed에 넘긴다.
- **문서의 언어는 Setdown이 정한다.** 계획은 파일의 언어도 Zed가 판단하는 것이었다. 실제로는 Setdown이 아는 파일 이름이 더 많고, 사람이 화면에서 언어를 바꿀 수 있고, 도구도 그 언어로 고른다. 그래서 Setdown의 문서 언어를 Zed에 알려 준다.
- **프로젝트 폴더별 선택은 아직 Zed 설정에 자리가 없다.** 그런 선택이 있는 파일은 기존 경로에 남는다.
- **호스트 프로세스가 최대 셋이다.** 새 경로용 하나, 기존 준비 경로용 둘(내려받기 허용, 금지). 6단계에서 줄인다.

### 12.4 남은 것

- **Rust.** 새 경로에서 `Cargo.lock`이 없는 프로젝트를 열면 rust-analyzer가 진단을 끝내 주지 않는다. Zed가 처음 읽는 도중 생긴 `Cargo.lock` 변경을 서버에 알리면 rust-analyzer(0.3.3081, 0.3.3121)가 그 상태에 머문다. 저장, 편집으로 풀리지 않는다. 기존 경로는 8번 중 8번 통과했다. 그래서 Rust는 기존 경로에 있다.
- TypeScript/JavaScript, Python, C/C++, Svelte, PHP, Kotlin 묶음의 새 경로 벤치마크.
- 두 창이 같은 파일의 다른 내용을 가질 때의 확인, 호스트가 죽었을 때와 사본이 어긋났을 때의 확인.
- [project-languages.ts](../apps/desktop/src/main/language/project-languages.ts)와 호스트 이벤트의 단위 테스트.
- 4단계(환경), 5단계(목록 밖 서버), 6단계(정리와 문서).

## 13. Java와 Kotlin이 잘 안 되는 이유 (2026-11-19 조사)

새 경로와 무관하다. 둘 다 기존 경로에서 생기는 문제이고, 사용자의 두 프로젝트(Spring Boot 4.1.2, Gradle 9.7.0, `jvmToolchain(25)`)의 사본을 프로필 사본으로 열어 재현했다. 이 컴퓨터의 `JAVA_HOME`은 JDK 17이고 `/usr/lib/jvm`에 JDK 21과 25가 있다. Java 수정안은 적용하지 않았고, Kotlin은 설치가 끝나게 하는 것과 설치 중임을 보여 주는 것 두 가지를 적용했다.

### 13.1 Java

| 도구 | 일어나는 일 | 원인 |
| --- | --- | --- |
| `jdtls` (Zed 공식 Java 확장 6.8.30). 프로젝트에서 고른 도구 | 준비 4초 만에 실패하고 "다운로드 실패"로 표시됨 | 이 도구는 **실행에 Java 25가 필요**하다. Setdown이 설치된 JDK 25를 알려 주지 않는다. 오류 문구("require at least Java version 25")가 Setdown이 기대한 형태와 달라 Java 문제로 분류되지 않는다 |
| 같은 도구에 `lsp.jdtls.settings.java_home`으로 JDK 25를 알려 줌 | 8.7초에 준비, 22초쯤 Gradle 읽기 끝, 오류 0개, hover와 완성 정상 | 도구 자체는 문제없다 |
| `zed.java-eclipse-jdtls.java` (서드파티 확장, jdtls 1.49, 2025년 7월판). 전역 기본으로 고른 도구 | 시작은 되지만 모든 파일에 `java.lang.Object cannot be resolved` 같은 거짓 오류 | 이 판은 **Java 25를 분석하지 못한다**("Compiling for Java version '25' is not supported yet"). 설정으로 고칠 수 없다. 프로젝트 폴더에 `.project`, `.settings`도 남긴다 |

2026-11-19 오후 현재 사용자 프로필에서 이 프로젝트가 쓰는 도구는 셋째 줄의 서드파티 확장이다. `SurveysApplication.java`의 "String cannot be resolved to a type", "Implicit super constructor Object() is undefined"는 이 도구가 Java 25의 표준 라이브러리를 읽지 못해 내는 거짓 오류다. 같은 사본을 공식 `jdtls`와 JDK 25로 열면 오류가 없다.

수정안: 준비 실패 문구에서 요구 버전을 읽어, 설치된 JDK 중 그 버전 이상을 찾아 넘기고 다시 시도한다. JDK를 찾는 코드는 이미 있다([tool-runtime.ts](../apps/desktop/src/main/language/tool-runtime.ts)의 `installedJava`). 실패 문구 분류도 고친다([language-issue.ts](../apps/desktop/src/main/language/language-issue.ts)).

### 13.2 Kotlin

| 순서 | 일어나는 일 | 원인 |
| --- | --- | --- |
| 1 | 지금까지 실제로 실행된 것은 옛 도구(fwcd `kotlin-language-server` 1.3.13)뿐이다. `emptyList`, 리스트의 `+`, 람다의 `it`에 "Unresolved reference" 등 거짓 오류 7개 | 도구에 든 컴파일러는 Kotlin 2.1.0이고 프로젝트는 2.3.21이다. 2.1 컴파일러는 2.3 표준 라이브러리를 읽지 못한다. Gradle 의존성 읽기는 성공하고 Java 라이브러리는 정상이다. "읽지 못한다"는 도구의 로그가 아니라 버전 조합과 오류 양상에서 내린 판단이다 |
| 2 | (고침, 아래 1번) 공식 도구 `kotlin-lsp`의 자동 설치가 끝나지 않는다. 문서 패널에는 "No project checks are active for this document."만 보인다 | 370 MB 압축 파일을 받는 Zed 코드가 최적화 없는 빌드에서 초당 0.1~0.4 MB로 돈다(네트워크가 아니라 CPU 한계). 20~40분이 걸려 제한 시간 30분에 걸린다. `npm run dev`와 `install:linux` 설치본 모두 이 빌드다. 받는 내용은 메모리에만 있어 앱을 닫으면 처음부터다 |
| 3 | (고침, 아래 2번) 설치 중이라는 표시가 없다 | 확장이 제공하는 도구의 설치 상태는 Zed의 다른 통로로 나가고, 기존 준비 경로는 그 통로를 듣지 않는다 |
| 4 | 설치된 뒤에도 `Thread.startVirtualThread`에 "Unresolved reference", 완성 0개 | 도구가 **`JAVA_HOME`의 JDK 17로 분석**한다. 빌드 파일은 25를 요구한다. `JAVA_HOME`만 25로 바꿔 띄우면 오류 0개, 완성 정상 |

측정:

| 조건 | 결과 |
| --- | --- |
| 고치기 전 빌드로 자동 설치 | 30초 동안 56.8 MB에서 67.1 MB. 끝나지 않음 |
| `extension_host`만 최적화해 빌드한 호스트로 자동 설치 | 세 번 재서 115~123초에 도구 준비 (받기 약 100초, 풀기 약 15초). 최종 빌드에서는 2.5초에 "Downloading…"이 뜬다 |
| 위와 같고 `JAVA_HOME`을 JDK 25로 | 오류 0개 |
| 위와 같고 `JAVA_HOME`이 JDK 17 (이 컴퓨터 기본) | `startVirtualThread`에 거짓 오류 1개 |
| 설치가 끝난 뒤 다시 열기 | 4.6~5초에 준비. 받지 않고, "Setting up…"도 뜨지 않음 |

수정 세 가지 가운데 둘을 적용했다:

1. **적용함.** [Cargo.toml](../tooling/language-host/Cargo.toml)에 `[profile.dev.package.extension_host] opt-level = 3`. 위 측정이 이 설정이다. Zed 자신도 개발 빌드에서 `wasmtime`, `cranelift-codegen` 등을 이렇게 최적화하는데 호스트에는 그 설정이 없었다.
2. **적용함.** 확장 도구의 설치 상태를 기존 준비 경로가 받아 "Setting up…"으로 보여 준다. 호스트가 Zed의 상태 통로를 듣고 "Downloading…"을 전한다. Kotlin 확장은 이미 설치된 도구를 띄울 때도 0.4초쯤 "받는 중"이라고 알리므로, 1초 뒤에도 이어지는 받기만 전한다. Zed는 단계만 알리고 양은 알리지 않아서 진행률은 없다. 상태 버튼과 패널 알림에는 도는 고리를 넣었다(동작 줄이기 설정에서는 멈춘 고리). 실제 앱을 숨은 화면에서 띄워 확인했다: 도구가 없는 프로필로 Kotlin 파일을 열면 상태 버튼이 "Kotlin · Setting up…", 패널이 "Setting up Kotlin support… / Downloading…"을 보이고 고리가 돈다. 확장 자체를 처음 받는 프로필에서는 그 전 9초 동안 표시가 없다.
3. 미적용. JVM 도구를 띄울 때 프로젝트 빌드 파일이 요구하는 JDK를 `JAVA_HOME`으로 넘긴다. Zed에는 이 동작이 없어서 Setdown 자체 로직이 된다. Zed는 셸 환경을 그대로 쓴다.

**그때까지 쓰는 방법과 주의점.** `SETDOWN_LSP_INHERIT_ENV=1 JAVA_HOME=/usr/lib/jvm/java-25-openjdk npm run dev`로 띄운다. `JAVA_HOME`만 주면 되는 경우와 안 되는 경우가 갈린다. Setdown은 도구 환경을 로그인 셸에 다시 묻고([server-environment.ts](../apps/desktop/src/main/language/server-environment.ts)), 이 컴퓨터의 `~/.zshrc`는 `JAVA_HOME`을 JDK 17로 내보낸다. conda나 venv가 켜진 터미널에서 띄웠거나 `SETDOWN_LSP_INHERIT_ENV=1`이면 묻지 않고 터미널 환경을 그대로 쓴다. 벤치마크와 재현 도구도 프로세스 환경을 그대로 쓰므로, 위 표의 `JAVA_HOME` 결과는 "도구가 그 값을 받았을 때"의 결과다.

실제 앱 확인(숨은 화면, 프로젝트 사본, 공식 `jdtls`, conda `base`가 켜진 환경): `JAVA_HOME`을 25로 주면 6.5~6.8초에 Connected, 편집기의 오류 표시 0개. 아이콘으로 띄우는 설치본은 확인하지 않았다.

## 14. 아직 확인하지 않은 것

계획 때 적은 목록 가운데 호스트에서 Zed 프로젝트가 조립되고 실행되는지, 번들 서버를 `binary.path`로 가리켰을 때의 동작, Python 환경 기본 선택은 11절에서 확인했다. 남은 것과 새로 생긴 것은 다음과 같다.

- 폴더 전체 읽기의 메모리와 시간
- 확장의 자체 설치기에 대한 다운로드 차단
- Windows
- 새 JSON 사례 세 개(웹 매니페스트, Prettier 파일, `jsconfig.json`)를 고치기 전 상태로 돌려 실패하는지는 보지 않았다. 원인은 Zed 소스에서 읽은 것이다
- Zed가 언어 목록을 다시 읽을 때(확장을 다시 로드할 때) Setdown이 정한 문서 언어가 유지되는지
- 설치 중 표시는 Kotlin 도구로만 재현했다. Java 등 다른 확장 도구는 같은 코드를 지나지만 돌려 보지 않았다
- 아이콘으로 띄운 설치본에서 도구가 받는 `JAVA_HOME`
- `kotlin-lsp`를 Setdown에 같이 넣을 경우의 배포 조건. 넣지 않기로 했으므로 확인하지 않았다
