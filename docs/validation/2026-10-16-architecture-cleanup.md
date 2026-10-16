# 2026-10-16 구조 정리와 기능 보존 검증

[구조 분석안](../../reports/2026_10_16_21_20_repository_structure_and_growth_strategy.md)의
1·2단계를 구현했다. 사진 편집 연산, 영상 엔진, 확장 API, LSP 기능을 새로 추가하는
단계는 이번 작업에 포함하지 않는다. 현재 구조의 사용법은
[아키텍처 지도](../architecture/overview.md)에 기록했다.

## 기준과 변경 범위

- 변경 전 기준: `ab08e8ccb9a02bb247a88f7f784c210b1a30117b`.
- 비교 대상: 해당 커밋 위의 현재 작업 트리. 커밋·배포는 수행하지 않았다.
- npm 의존성과 lockfile, vendor gitlink, IPC wire format은 변경하지 않았다.
- 실행 환경의 큰 경계인 core/protocol/main/renderer/preload/runtime은 유지했다.

| 정리 대상 | 결과 |
| --- | --- |
| 앱 조립 | `renderer/app/`으로 이동. 브라우저 명령을 기능 모듈로 분리 |
| 공통 workspace | 탭·그룹·주소 UI를 함께 배치. 주소 탐색과 Back/Forward를 별도 controller로 분리 |
| 문서 내용 수명 | `DocumentSessions`와 기존 문서용 `DocumentContentOwner` 도입. NotebookStore 직접 접근을 notebook 공개 연결부에 모음 |
| 미디어 소비 API | 이미지·영상·PDF·주소 제안 화면에 필요한 포트만 전달 |
| 언어 기능 | `renderer/language/`으로 이동하고 결과 UI의 런타임 순환 참조 제거 |
| 프로세스 경계 | Node crypto/zlib 기반 확장 패키지 해석을 core에서 main/browser로 이동 |
| 외부 빌드 | uBlock recipe와 확장 preload 패치를 각각 분리. 기존 pin과 패치 실패 조건 유지 |
| 구조 검사 | 문자열 검색을 TypeScript AST와 실제 경로 해석으로 교체. 타입·dynamic import·별칭·기능 공개 연결부 검사 |
| 테스트 | 기능별 E2E/support/fixtures, 단일 suite manifest, 수집 전 미분류·누락·중복 검사 |
| CI | 일반 PR/main에 단위·구조·도구 검사 추가, 실제 clangd 명시 설치 |
| 문서·탐색 | 현재 계약과 날짜별 검증 기록 분리. 외부 코드 지도, IDE 검색·watcher 제외 추가 |

코드 줄 수를 줄이는 것 자체가 목적은 아니다. 운영 소스는 290개/31,419줄에서
299개/31,614줄로 바뀌었다. 주석·공백·선언 파일·복사된 JS를 포함하고, 테스트·JSON
catalog·vendor·산출물을 제외한 물리적 줄 수다. 연결부가 생겨 총량은 조금 늘었지만
내용과 화면의 소유자가 명확해졌다.

| 기존 집중 지점 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| TabController | 851줄 | 686줄 |
| workspace 조립 | 570줄 | 525줄 |
| 전역 view 및 액션 타입 | 165줄 | 표시 상태 53줄, 액션 타입은 ports로 분리 |
| preview 계약 진입 문서 | 1,839줄 | 469줄, 기능 계약·날짜별 기록은 연결 문서로 보존 |

## 보존한 동작과 검증 범위

탭 탐색은 기존 요청 세대, 직렬 처리, beforeunload 취소, 늦은 응답 폐기 순서를
유지한다. 문서 내용의 저장 확인·dirty 판단·전송용 직렬화·해제를 기존 소유자에
위임하며 미디어 화면 캐시에 편집 상태를 넣지 않는다. NotebookStore의 내용은
화면 표시 목록을 다시 만들 때도 유지된다. 저장 응답보다 최신인 편집을 깨끗한
상태로 바꾸지 않는 검사도 추가했다.

테스트 파일 이동 전후 수집 목록의 제목 다중집합을 비교했다. 기본 Electron
시나리오 **163개**, 그 안의 계약 시나리오 **128개**가 모두 대응한다. 브라우저
대형 파일 분리로 기본 spec 파일 수는 49개에서 60개, 계약 spec은 29개에서
40개로 늘었다. 공통 fixture의 setup/teardown과 native 입력 동작을 유지했다.
동영상 fixture 두 개는 바이트 동일성도 확인했다.

계약 단위 목록의 기존 68개 고유 파일을 유지하고 문서 세션 테스트를 추가했다.
기존 목록에 두 번 있던 explorer 서비스 경로는 한 번만 등록했다. 기본 단위
테스트는 계속 구현 옆의 `*.test.ts`를 자동 수집한다.

| 실행 | 결과 |
| --- | --- |
| 변경 전 전체 단위 테스트 | 121파일, 847개 통과 |
| 변경 전 Electron 계약 | 128개 통과 |
| 변경 후 전체 단위 테스트 | 122파일, 852개 통과 |
| CI 정책·빌드 도구 검사 | 65 + 9 = 74개 통과 |
| 변경 후 계약 단위 테스트 | 69파일, 461개 통과 |
| TypeScript·Svelte·제품 빌드 | 통과, Svelte 오류·경고 0 |
| 변경 후 Electron 계약 | 128개 통과, 5.8분 |
| 나머지 기본 Electron 시나리오 | 32개 통과. 아래 3개는 변경 전후 동일 실패 |
| 실제 IPython 커널 | 4개 통과 |
| 외부 Fortran 서버·notebook 도구 | fortls 1개, notebook-tools 1개 통과. Rust는 실행 파일 미설치로 미검증 |
| 전체 성능 비교 | 80회 앱 실행, 48개 비교 항목, 회귀 0개 |

로컬 환경은 Linux x64, Node 22.23.1, Electron 44.7.2, Python 3.13.11,
clangd 22.1.0, fortls 3.2.2다.

모든 GUI 실행은 Xvfb, 별도 runtime directory, 별도 D-Bus 세션을 사용했다.
사용자 데스크톱의 Wayland socket을 상속하지 않는다. retry, assertion,
성능 허용 오차를 바꿔 성공 처리하지 않는다.

첫 GUI 실행에서는 이동한 동영상 fixture의 상대 경로를 놓쳐 두 사례가 ENOENT로
실패했다. 경로를 수정하고 계약 전체를 다시 실행했다. 커널 검증의 첫 Python
환경에는 pandas가 없었다. pandas/NumPy가 설치된 기존 Python으로 다시 검증하고,
manifest와 테스트 설명에도 실제 환경 조건을 명시했다. 이 실패들은 통과 결과에
포함하지 않는다.

## 기존 기본 suite의 실패 3개

계약 밖의 35개를 실행하자 처음에는 변경 전후 모두 31개 통과/4개 실패였다.
동일한 candidate 테스트 코드를 두 독립 앱에 적용해 비교했다. Reload 메뉴의
부분 문자열 선택자는 `Reload Without Cache`도 선택하고 있었다. 해당 테스트만
`menu-reload` ID로 정확히 지정하고 변경 전후에서 각각 통과했다. 화면 복원과
폴더·패널 폭 검사는 그대로 유지했다.

나머지 세 사례는 제품 코드나 assertion을 바꾸지 않고 실패 근거를 남겼다.
따라서 **기본 Electron 전체가 통과했다고 주장하지 않는다**. 최종 개별 결과의
합은 160개 통과, 기존 실패 3개이며, 필수 계약 128개는 모두 통과했다.

| 기존 실패 | 변경 전후 공통 실패 지점 |
| --- | --- |
| `git/git-review-cold-escape.spec.ts` | 숨겨진 diff에서 변경 marker를 찾는 사전 검사에서 20초 후에도 0개 |
| `git/git-review-instant-escape.spec.ts`의 첫 사례 | 다음 설치를 강제로 보류한 상태에서 visible review를 찾지 못함 |
| `git/git-review-reading-position.spec.ts` | 명시적 Source → Ctrl+Home → Esc 뒤 scrollY가 기대 0과 다름 |

테스트 이동과 같은 작업을 이유로 이 시나리오를 삭제·skip하거나 허용 조건을
느슨하게 만들지 않았다. 이 세 검사의 전제와 현재 Git preview 동작 사이의 차이는
별도 조사 항목이다. 이번 정리에서 새로 발생한 실패로 관측되지는 않았다.

Rust GUI suite는 rustup 실행 shim만 있고 실제 rust-analyzer가 설치되지 않아
실행하지 않았다. fortls와 실제 Pyright/basedpyright·clangd 검사 결과를 Rust의
호환성 검증으로 대신하지 않는다.

## 성능 비교 조건

첫 호출은 측정 전에 Git diff를 읽다가 Node `spawnSync`의 기본 1MiB 버퍼를
넘어 `ENOBUFS`로 중단됐다. 파일 이동을 포함한 diff는 약 1.13MB였다. 전체 diff를
해시할 수 있도록 메타데이터용 버퍼를 32MiB로 늘리고 실제 오류도 표시하게 했다.
불완전한 diff를 허용하지 않으며 시나리오·측정·허용 오차는 변경하지 않았다.
도구 검사 9개를 재실행해 통과한 뒤 별도 결과 디렉토리에서 비교를 시작했다.

별도 baseline clone에 독립된 설치 의존성을 복사하고 변경 전 소스로 생성한
빌드 결과를 배치했다. candidate는 최종 계약 명령에서 빌드했다. 이미 현재 소스로
빌드한 두 산출물을 사용하므로 비교에는 `--skip-build`를 사용한다. 비교기는
각 빌드의 해시와 각자 설치한 Electron을 확인하며 candidate의 동일한 측정 코드를
양쪽에 사용한다.

일반 문서/Git review × 편집 없음/있음 × 준비 시간 0/3000ms의 8가지 조건을
각 버전에서 5회씩 실행한다. 동일 디스플레이에서 AB/BA 순서를 번갈아 사용하고,
각 앱의 첫째·둘째·3–5회 중앙값을 구분한다. 판정 기준은 기존대로 **25%와 50ms를
동시에 초과하는 증가**다. 이 값은 화면 표시 자체가 아니라 검증된 native capture까지의
관측 시간이며, 5회로 P95를 주장하지 않는다.

완료: `2026-10-16T13:11:00.424Z` → `2026-10-16T13:16:56.313Z` (UTC).

기기: AMD Ryzen 7 8845HS w/ Radeon 780M Graphics, linux x64, 격리 display `:99`.
판정: **통과**, 회귀 0개. 단위는 ms다.

| 대상 | 편집 | 준비 ms | 회차 | 방향 | 변경 전 | 변경 후 | 차이 | 회귀 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- |
| 일반 문서 | 있음 | 3000 | 첫째 | Esc → capture | 107 | 99 | -8 | 없음 |
| 일반 문서 | 있음 | 3000 | 둘째 | Esc → capture | 103 | 101 | -2 | 없음 |
| 일반 문서 | 있음 | 3000 | 3–5 중앙값 | Esc → capture | 92 | 91 | -1 | 없음 |
| 일반 문서 | 있음 | 3000 | 첫째 | double-click → editor | 20 | 15 | -5 | 없음 |
| 일반 문서 | 있음 | 3000 | 둘째 | double-click → editor | 12 | 13 | +1 | 없음 |
| 일반 문서 | 있음 | 3000 | 3–5 중앙값 | double-click → editor | 13 | 12 | -1 | 없음 |
| 일반 문서 | 있음 | 0 | 첫째 | Esc → capture | 420 | 404 | -16 | 없음 |
| 일반 문서 | 있음 | 0 | 둘째 | Esc → capture | 97 | 99 | +2 | 없음 |
| 일반 문서 | 있음 | 0 | 3–5 중앙값 | Esc → capture | 91 | 93 | +2 | 없음 |
| 일반 문서 | 있음 | 0 | 첫째 | double-click → editor | 18 | 19 | +1 | 없음 |
| 일반 문서 | 있음 | 0 | 둘째 | double-click → editor | 17 | 15 | -2 | 없음 |
| 일반 문서 | 있음 | 0 | 3–5 중앙값 | double-click → editor | 13 | 13 | +0 | 없음 |
| 일반 문서 | 없음 | 0 | 첫째 | Esc → capture | 43 | 44 | +1 | 없음 |
| 일반 문서 | 없음 | 0 | 둘째 | Esc → capture | 22 | 21 | -1 | 없음 |
| 일반 문서 | 없음 | 0 | 3–5 중앙값 | Esc → capture | 27 | 19 | -8 | 없음 |
| 일반 문서 | 없음 | 0 | 첫째 | double-click → editor | 18 | 18 | +0 | 없음 |
| 일반 문서 | 없음 | 0 | 둘째 | double-click → editor | 30 | 35 | +5 | 없음 |
| 일반 문서 | 없음 | 0 | 3–5 중앙값 | double-click → editor | 12 | 11 | -1 | 없음 |
| 일반 문서 | 없음 | 3000 | 첫째 | Esc → capture | 40 | 41 | +1 | 없음 |
| 일반 문서 | 없음 | 3000 | 둘째 | Esc → capture | 25 | 22 | -3 | 없음 |
| 일반 문서 | 없음 | 3000 | 3–5 중앙값 | Esc → capture | 24 | 23 | -1 | 없음 |
| 일반 문서 | 없음 | 3000 | 첫째 | double-click → editor | 16 | 16 | +0 | 없음 |
| 일반 문서 | 없음 | 3000 | 둘째 | double-click → editor | 12 | 11 | -1 | 없음 |
| 일반 문서 | 없음 | 3000 | 3–5 중앙값 | double-click → editor | 11 | 11 | +0 | 없음 |
| Git review | 있음 | 3000 | 첫째 | Esc → capture | 229 | 229 | +0 | 없음 |
| Git review | 있음 | 3000 | 둘째 | Esc → capture | 180 | 187 | +7 | 없음 |
| Git review | 있음 | 3000 | 3–5 중앙값 | Esc → capture | 173 | 176 | +3 | 없음 |
| Git review | 있음 | 3000 | 첫째 | double-click → editor | 20 | 22 | +2 | 없음 |
| Git review | 있음 | 3000 | 둘째 | double-click → editor | 18 | 17 | -1 | 없음 |
| Git review | 있음 | 3000 | 3–5 중앙값 | double-click → editor | 18 | 17 | -1 | 없음 |
| Git review | 없음 | 0 | 첫째 | Esc → capture | 954 | 950 | -4 | 없음 |
| Git review | 없음 | 0 | 둘째 | Esc → capture | 20 | 19 | -1 | 없음 |
| Git review | 없음 | 0 | 3–5 중앙값 | Esc → capture | 26 | 26 | +0 | 없음 |
| Git review | 없음 | 0 | 첫째 | double-click → editor | 24 | 23 | -1 | 없음 |
| Git review | 없음 | 0 | 둘째 | double-click → editor | 11 | 12 | +1 | 없음 |
| Git review | 없음 | 0 | 3–5 중앙값 | double-click → editor | 13 | 12 | -1 | 없음 |
| Git review | 있음 | 0 | 첫째 | Esc → capture | 1035 | 1024 | -11 | 없음 |
| Git review | 있음 | 0 | 둘째 | Esc → capture | 1481 | 1494 | +13 | 없음 |
| Git review | 있음 | 0 | 3–5 중앙값 | Esc → capture | 180 | 175 | -5 | 없음 |
| Git review | 있음 | 0 | 첫째 | double-click → editor | 22 | 21 | -1 | 없음 |
| Git review | 있음 | 0 | 둘째 | double-click → editor | 20 | 19 | -1 | 없음 |
| Git review | 있음 | 0 | 3–5 중앙값 | double-click → editor | 17 | 18 | +1 | 없음 |
| Git review | 없음 | 3000 | 첫째 | Esc → capture | 28 | 30 | +2 | 없음 |
| Git review | 없음 | 3000 | 둘째 | Esc → capture | 23 | 23 | +0 | 없음 |
| Git review | 없음 | 3000 | 3–5 중앙값 | Esc → capture | 19 | 17 | -2 | 없음 |
| Git review | 없음 | 3000 | 첫째 | double-click → editor | 23 | 23 | +0 | 없음 |
| Git review | 없음 | 3000 | 둘째 | double-click → editor | 11 | 12 | +1 | 없음 |
| Git review | 없음 | 3000 | 3–5 중앙값 | double-click → editor | 17 | 18 | +1 | 없음 |

각 값은 버전별 5회 실행의 중앙값이다. warm은 먼저 각 앱의 3–5회 중앙값을 구한 뒤
앱 사이 중앙값을 구했다. 편집 조건에서는 최신 편집 내용이 포함된 캡처만 허용한다.

재현에 사용할 식별 정보:

- lockfile SHA-256: `3b50516691763f1c6acf1d5d13ff78ec1f90e8a0cad16d065dbd8e1ddeee0237`
- fixture SHA-256: `a0ce32593f31ce0b79bc63e3867c0a227532954c45d50c92e2dfdc5518541314`
- harness SHA-256: `8f67502b3a8e6430afcb74c4714b122e57e63992354095a3aa1449f21e57ddda`
- 변경 전 renderer 산출물 SHA-256: `0140bb32071c0b63e82d9c4789555f8e9858c36c269f90dac84de07d6e3eb668`
- 변경 전 main 산출물 SHA-256: `4edc7c1f3b7117ba638c293b681fe49e9c1b727ad40dd00088661cb73a47a822`
- 변경 후 renderer 산출물 SHA-256: `52821f2844056566017de80f207c9bdd107b6affa173b64c41f25cc219796d2d`
- 변경 후 main 산출물 SHA-256: `26c2b65a94cf082b2ff35e9033af1819b4f98463e7a1e10e8a1704486790b6f3`

전체 원시 측정·실행 순서·로그·테스트 첨부물은 로컬
`test-results/architecture-refactor/`에 보존한다. 해당 경로는 Git ignore 대상이며
이 문서의 수치 표와 알려진 실패 기록은 저장소 문서로 남는다.
측정을 마친 뒤 임시 baseline 복제본과 그 중복 의존성 약 5.5GB는 정리했다.

## 남겨 둔 범위

사진 편집 이력과 바이너리 저장, VLC급 엔진, 새로운 확장 호환성, 지원 언어 확대는
후속 기능 작업이다. `DocumentContentOwner`는 현재 직렬화 가능한 문서용 경계이며
모든 미래 엔진을 포괄한다고 주장하지 않는다. MediaCache의 용량·보이는 화면 보호·
무효화 정책도 유지했다.

기능 내부 파일의 공개 진입점 규칙은 이번에 실제 경계를 정리한 language/notebook에
적용했다. 다른 모든 기능에 동일한 공개 API를 강제하지 않았다. 실제 GUI와 전체
성능 비교는 여전히 별도 검증 경로다. GitHub 원격 CI 실행이나 branch rule 변경,
Windows 패키징을 이번 로컬 검증의 성공으로 주장하지 않는다.
