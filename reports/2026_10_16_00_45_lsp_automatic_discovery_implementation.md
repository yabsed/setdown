# 설치된 LSP 자동 탐색과 연결 구현

설계: [LSP discovery and connection design](2026_10_16_00_09_lsp_discovery_and_connection_design.md). 기준 커밋: `6b0db3c3ce0b7c18383e4292f57b8dba24849a39`.

이번 구현은 설치된 서버를 사용하기 위해 연결 JSON을 먼저 작성해야 했던 흐름을 바꾼다. 기본 프로필이 있는 언어는 파일을 열면 서버를 찾고, 실행 중 설치한 서버는 기존 **Edit → Language Support… → Rescan installed servers**에서 연결한다. 설치 자체는 사용자에게 맡긴다.

## 제공되는 동작

- 내장 Pyright는 그대로 사용한다. clangd, rust-analyzer, gopls, fortls는 설치된 실행 파일을 자동 탐색한다. 명시적으로 저장된 비활성화는 유지한다.
- Fortran 기본 프로필에 `fortran` ID, 대소문자를 구분하지 않는 확장자, `.fortls` 계열 루트 설정과 실행 인수를 포함했다. `pip install fortls` 후 `.f90`를 열 때 확장자·언어 ID·인수를 다시 입력하지 않는다.
- 첫 네이티브 LSP 연결과 명시적 Rescan에서 필요한 환경을 비동기로 조회한다. 활성 venv/Conda 환경은 상속값을 유지한다. 지원하는 Unix 셸 환경 조회는 5초, Python scripts 조회는 3초, 출력은 합계 1 MiB로 제한한다. 실패 시 상속 환경을 사용하고 이유를 표시한다.
- PATH 순서, 사용자 bin, Cargo/Go의 설정된 bin, pipx/uv의 설정된 노출 디렉터리, 필요한 Python scripts 디렉터리를 확인한다. 후보를 건강 검사 목적으로 실행하지 않는다.
- PATH의 첫 후보를 사용하고 PATH 밖에 동등한 후보가 여러 개이면 선택을 요구한다. 직접 선택한 경로가 사라져도 다른 설치본으로 몰래 바꾸지 않는다. **Use automatic detection**으로 수동 선택을 해제할 수 있다.
- 탐색 결과의 절대 경로와 환경을 묶어서 실제 서버에 전달한다. 전역 `process.env`나 사용자 셸 설정을 변경하지 않는다. 발견 결과를 사용자 실행 파일 선택으로 영구 저장하지 않는다.
- 서버가 없는 기본 자동 프로필은 조용한 unavailable 상태다. 편집과 저장이 가능하며 설치되지 않은 서버에 변경 요청을 계속 쌓지 않는다.
- Rescan은 unavailable/failed 문서를 현재 미저장 내용으로 다시 연결한다. 정상 세션은 유지한다. 새 파일도 같은 창·서버·루트의 살아 있는 세션을 공유하며, 발견한 새 실행 파일은 새 세션 또는 명시적 재시작부터 사용한다.
- 설정 변경은 영향을 받는 서버만 모든 창에서 다시 연결한다. 다른 언어 서버, Monaco 모델, Undo 기록은 유지한다.
- 탐색 중 문서가 닫히거나 설정이 바뀌면 늦게 도착한 결과로 서버를 생성하지 않는다. Rescan과 기존 탐색이 겹치면 오래된 결과를 버리고 새 탐색 세대로 연결한다.

## 코드의 책임

| 모듈 | 책임 |
| --- | --- |
| `core/document/language-definition.ts` | 자동 사용 정책과 fortls 기본 연결 데이터 |
| `main/language/server-environment.ts` | 사용자 환경 스냅샷, 셸 helper, 제한 시간·출력 제한·취소 |
| `main/language/server-discovery.ts` | 후보 탐색·선택·캐시·재탐색 세대, Python 경로 조회 |
| `main/language/server-registry.ts` | 설정 우선순위·사용자 선택·호환성, 실행 계획 생성 |
| `main/language/language-manager.ts` | 소유권 검사, 실제 세션 공유, 대상 서버 갱신, Rescan IPC |
| `renderer/editor/language-client.ts` | unavailable 상태, 최신 모델로 재시도, 대상 binding 교체 |
| `renderer/editor/LanguageSupport.svelte` | 후보·탐색 상태·Rescan·자동 탐색 복귀 |

실행 계획을 위한 별도 중복 레지스트리는 만들지 않았다. 기존 `ServerRegistry.launch()`가 실제 발견된 경로와 환경을 받아 계획을 생성한다. 세션은 그 계획을 fingerprint에 포함하며, 살아 있는 세션의 계획은 Rescan 때문에 바뀌지 않는다.

설정 형식은 version 1을 유지하며 선택적 필드만 추가했다. 기존 사용자 정의 fortls가 새 기본 프로필과 ID가 겹쳐도 사용자 정의가 우선한다. 기존 args, 설정, enabled 값과 preferred 서버를 유지한다. 손상된 설정을 빈 파일로 덮는 방식의 마이그레이션은 하지 않는다.

## 검증 범위와 남은 확장

전체 단위 테스트 **110개 파일·761개 테스트**, 미리보기 계약의 **112개 Electron 시나리오**, 별도 실제 fortls·rust-analyzer **2개 통합 시나리오**를 통과했다. 빌드와 타입 검사에서도 오류·Svelte 경고가 없었다.

성능 비교는 최초 5회에서 수정 없는 Markdown의 첫 Esc가 **35 → 121ms**로 기준을 초과했다. 별도 추적으로 원인을 단정하지 않고, 같은 빌드·허용 기준으로 사전에 정한 5회를 추가 측정했다. 최초 실패 표본을 포함한 **10회 합산은 48개 항목 모두 기준을 충족**했다. 해당 첫 Esc의 합산 중앙값은 **39 → 53.5ms**다. 첫 측정의 변동이 해결됐다고 주장하지 않으며 원본 표본과 각 배치 결과를 함께 보존했다.

전체 수치와 검증 범위는 [미리보기 성능 계약](../docs/preview-performance-contract.md)에 기록했다. 테스트는 임시 HOME·PATH·설정 디렉터리를 사용하고, GUI는 Xvfb·별도 runtime·D-Bus에서 실행한다. 실제 서버 검증에는 설치된 fortls와 clangd, 내장 Pyright 및 별도의 검증된 rust-analyzer 바이너리를 사용한다.

Mason의 331개 항목 전부를 자동 연결하는 구현은 아니다. 연결 정의가 없는 항목은 기존 설치 안내와 수동 연결을 유지한다. 이번 기본 자동 프로필은 네이티브 실행과 fortls 흐름에 한정한다. gopls는 공통 탐색 경로를 사용하지만 실서버 통합 검증은 아직 없다.

후속 범위는 Node 패키지와 런타임의 자동 조합, npm wrapper, pipx/uv/Go 도구 자체의 설치 경로 질의, 프로젝트별 Python/Node 환경 선택이다. Windows 네이티브 경로 분기는 유지하지만 이번 검증은 Linux에서 실행했으며 Windows 실행 검증을 대신하지 않는다. 네트워크 파일 시스템 경로의 개별 I/O deadline과 별도 진단 복사 UI도 추가 과제다.

Fortran의 문법 색상과 semantic tokens는 이번 연결 기능과 별도다. fortls가 실행되어 hover와 자동 완성을 제공한다고 색상이나 지원하지 않는 LSP 기능까지 완성되었다고 판단하지 않는다.
