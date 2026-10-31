# 문서 소유권에 따른 언어 지원 UI — 2026-11-01

전역 Language Support는 사용할 수 있는 도구를 관리하고, 현재 문서의 분석 상태와
설정 진입점은 그 문서를 보는 편집 그룹에 둔다. 문서를 닫았는데 전역 사이드바에
닫힌 문서 안내만 남던 구성을 제거했다. 기존 화면을 재사용하는 것이 단순함을
보장한다는 최초 판단은 [설계 보고서의 후속 검토](../../reports/2026_11_01_gnome_builder_lsp_ui_review.md#후속-검토-화면의-위치보다-소유권을-먼저-정한다)에서 명시적으로 폐기했다.

## 설계 근거와 적용 범위

Builder `0e4dbc7afb05983fbe7f4ec922d09a40f4ac1718`의 buffer 언어 메뉴, application
tweaks의 플러그인 설정, 프로젝트 omnibar, `IdeLspService`의 tooling 문맥을 확인했다.
가져온 것은 **문서·프로젝트·앱의 책임과 수명을 구분하는 구조**다. GTK 위젯이나
Builder의 한 프로젝트 중심 배치를 그대로 이식한 것으로 표현하지 않는다.
Setdown은 한 창에 다른 프로젝트, 같은 문서의 여러 뷰, 웹 페이지를 함께 둘 수 있다.

| 질문 | 화면 | 실제 소유권 |
| --- | --- | --- |
| 어떤 도구를 사용할 수 있는가 | 왼쪽 카탈로그 | 설치·연결 프로필·전역 기본값 |
| 이 파일에서 무엇이 동작하는가 | 탭의 언어 버튼 → 짧은 요약 | 현재 문서의 관측 |
| 어떤 언어로 해석할 것인가 | 문서 언어 선택 | 공유 문서 모델 |
| 어떤 환경과 분석 도구를 쓸 것인가 | 문서에서 진입한 프로젝트 선택 | 표시된 분석 root, 같은 root의 다른 탭·창에도 적용 |
| 자세한 결과·설정·출력이 필요한가 | 같은 그룹의 상세 → 해당 도구 | 처음 연 문서와 프로젝트/세션 |

정상 상태에서는 언어명만 보인다. 조치가 필요한 환경 문제, 보조 도구 실패,
자동 복구와 복구 중단, 서버의 선택 요청은 각각 구분한다. 연결됐다는 사실을
검사 완료로 표현하지 않고, 결과 수신·버전 누락·최신 변경 후 대기를 별도로 설명한다.
기본 문법 검사, 여러 provider, 고급 JSON, 수동 연결, 로그, 명시적 configure와 취소는
유지한다. 간결한 화면을 만들기 위해 서버 정책이나 진단을 축소하지 않았다.

짧은 선택 화면은 바깥 클릭으로 닫힌다. 긴 상세·설정·출력은 다른 그룹을 클릭해도
처음 문서에 남으며 자신의 그룹을 넘지 않는다. 대상 문서, 경로, 언어가 바뀌거나
뷰가 닫히면 그 검사를 끝낸다. 비동기 응답은 문서 incarnation으로 검증하며,
환경 선택에는 예상 root를 함께 전달한다. 전역 카탈로그는 Explorer 폴더의 설정을
암묵적으로 읽거나 수정하지 않는다.

## 실제 검증 범위

- 두 프로젝트를 나란히 열고 다른 그룹에 포커스가 있는 동안 환경과 고급 연결 설정을
  적용한다. 저장 파일에서 처음 프로젝트만 바뀌었음을 확인하고, 미저장 내용과 Undo도
  검사한다. 문서를 닫아도 카탈로그는 도구 목록으로 남는다.
- 좁은 화면의 환경 누락 상태에서 문제와 해결 버튼이 첫 화면에 있고, 상태 표시가
  유지되는지 확인한다. Escape의 단계별 이동과 composition 중 Escape도 검사한다.
- 마지막 뷰를 닫은 문서의 검사 상태가 Problems 요약에 남지 않는지 확인한다.
- 기존 실제 Python import 복구, TypeScript SDK/비활성화, clangd 빌드 DB,
  CMake/Meson configure·취소, 서버 자동/수동 복구, 프로세스 정리, 미저장 버퍼 검사를
  새 진입 경로로 실행한다. 테스트의 기존 기능·프로세스 검증은 유지한다.
- 전체 preview 계약은 일반 Markdown, Git review, native view 경계, 포커스·IME,
  노트북·미디어·웹의 기존 시나리오를 포함한다. GUI는 모두 Xvfb, 별도 runtime와
  D-Bus에서 실행한다. 사용자 데스크톱을 사용하지 않으며 retry는 0이다.

검사 중 그룹 포커스 갱신을 문서 교체로 오인해 상세를 닫던 반응성 처리를 수정했다.
오류 안내의 CSS 이름 충돌과 카탈로그의 `Python` 표시명 때문에 고급 interpreter
필드가 빠지던 경우도 바로잡았다. 테스트 fixture에는 실제 프로젝트 marker를 두어
상위 저장소를 분석 root로 오인하지 않게 했다.

## 실행 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 전체 contract의 단위 검사 | 100개 파일, 755개 통과 | `preview-contract.log` |
| 빌드 도구 검사 | 14개 통과 | `preview-contract.log` |
| 제품 빌드 / TypeScript / Svelte | 성공, Svelte 오류·경고 0 | `preview-contract.log` |
| 전체 Electron 실행 | 272개 통과, 이전 clangd 메뉴 경로를 기대한 1개 실패, 14.3분 | `preview-contract.log` |
| clangd 경로 수정 후 재검증 | 해당 파일의 실제 서버 시나리오 3개 모두 통과 | `clangd-final.log` |
| 최종 테스트 TypeScript 검사 | 통과 | `test-typecheck.log` |

전체 실행 뒤 변경한 코드는 테스트의 진입 경로뿐이다. `F1 → Language Support`가
현재 문서 상세를 여는 것을 확인하고, **Manage analysis tools…**로 카탈로그에
이동하도록 수정했다. native chooser 선택, 설정 저장, 실제 진단, 재시작, 호버,
rename·Undo 검증은 유지했다. **제품 코드가 동일한 상태에서 273개 고유 Electron
시나리오를 검증했으며, 전체 명령이 한 번에 모두 통과했다고 합산하지 않는다.**
자동 retry나 assertion 완화는 없다. 중간 fixture 실패와 중단한 실행 로그도 보존했다.

baseline은 별도 체크아웃 `83d447bd61df81e1f9fbb2df2b9b3c0c05610442`다. 원본 설치의
의존성을 reflink로 독립 복사하고 고정 vendor 소스로 baseline 자체를 빌드했다.
candidate와 baseline 모두 `SETDOWN_BUILD_SOURCEMAP=0`으로 빌드했다.
비교 실행 결과는 아래와 같다.

## 동일 조건 미리보기 비교

[comparison.json](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/benchmark/comparison.json)의
**48개 비교 항목에서 회귀 0개**다. Linux x64, AMD Ryzen 7 8845HS,
Electron 44.7.2, Node 22.23.1, 같은 Xvfb `:99`에서 3회씩 AB/BA 순서를 교대했다.
8개 시나리오마다 새 앱과 profile을 사용해 총 48번 실행하고 240개 왕복 cycle을
측정했다. `/tmp/.git`의 영향을 피하도록 두 앱에 같은 `/var/tmp` 임시 경로를
사용했다. 이미 검사한 양쪽 빌드를 `--skip-build`로 측정했으며, 실행 중 harness와
빌드 hash가 바뀌지 않았음을 runner가 확인했다. 두 lockfile hash도 같다.

표는 **기준 → 변경, 밀리초**다. 첫 번째와 두 번째는 각각 독립 항목이며, 반복은
각 앱의 3–5회차 중앙값을 구한 뒤 세 번 실행의 중앙값을 취한다. 편집 없는/있는
경우와 source 준비 시간 0/3000ms를 따로 비교했다. 준비 대기 3000ms 자체는 입력
지연에 더하지 않으며, 전환 시점까지 끝나지 않은 작업은 측정에 포함된다.

`captureMs`는 Escape부터 최신 내용이 포함된 비어 있지 않은 native capture까지로,
polling·IPC·readback을 포함한다. 모니터에 픽셀이 실제 제시되는 시각은 아니다.
더블클릭은 실제 Chromium 입력으로 측정한다. 판정식은 기존 **25% 초과와 50ms
초과를 동시에 만족할 때 회귀**를 유지했다. 이 결과를 모든 환경의 성능 향상이나
P95 측정으로 해석하지 않는다.

가장 큰 증가는 일반 Markdown / 준비 0ms / 편집 없음의 첫 더블클릭에서
17 → 44ms(+27ms)였다. 상대 증가는 크지만 기존 50ms 문턱을 넘지 않았으므로
계약상 회귀로 판정하지 않았다. 아래 표에 감소와 증가를 모두 남긴다.

### Escape → 최신 미리보기 capture

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | 반복 |
| --- | --- | --- | --- | --- | --- |
| Markdown | 0ms | 없음 | 59 → 60 | 35 → 30 | 29 → 25 |
| Markdown | 0ms | 있음 | 344 → 340 | 101 → 99 | 91 → 86 |
| Markdown | 3000ms | 없음 | 27 → 23 | 21 → 16 | 27 → 21 |
| Markdown | 3000ms | 있음 | 116 → 96 | 96 → 83 | 90 → 96 |
| Git 리뷰 | 0ms | 없음 | 1115 → 1100 | 25 → 22 | 29 → 30 |
| Git 리뷰 | 0ms | 있음 | 1159 → 1184 | 1683 → 1699 | 177 → 177 |
| Git 리뷰 | 3000ms | 없음 | 34 → 24 | 26 → 27 | 17 → 17 |
| Git 리뷰 | 3000ms | 있음 | 230 → 232 | 190 → 178 | 180 → 176 |

### 더블클릭 → 편집기

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | 반복 |
| --- | --- | --- | --- | --- | --- |
| Markdown | 0ms | 없음 | 17 → 44 | 34 → 31 | 14 → 12 |
| Markdown | 0ms | 있음 | 19 → 17 | 16 → 16 | 14 → 13 |
| Markdown | 3000ms | 없음 | 17 → 18 | 13 → 11 | 13 → 12 |
| Markdown | 3000ms | 있음 | 18 → 18 | 15 → 13 | 14 → 12 |
| Git 리뷰 | 0ms | 없음 | 22 → 23 | 11 → 11 | 12 → 12 |
| Git 리뷰 | 0ms | 있음 | 23 → 23 | 22 → 22 | 19 → 20 |
| Git 리뷰 | 3000ms | 없음 | 27 → 25 | 11 → 11 | 19 → 19 |
| Git 리뷰 | 3000ms | 있음 | 24 → 24 | 20 → 18 | 18 → 17 |

## 화면과 원자료

- [정상 문서의 짧은 요약](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/compact-normal.png)
- [환경 누락과 첫 화면의 복구 행동](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/compact-missing.png)
- [다른 그룹과 독립된 프로젝트 설정](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/project-pinned.png)
- [문서 수명과 독립된 도구 카탈로그](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/catalog-independent.png)
- [검증한 소스·테스트 파일의 해시](../../reports/gnome-builder-lsp-ui-implementation-2026-11-01/source-index.json)

현재 동작의 유지 계약은 [Language support](../language-support.md#current-file-support)에 있다.
실제 native 언어 서버 검증 범위는 해당 머신에서 실행한 서버에 한정한다. 모든
카탈로그 서버 또는 다른 운영체제의 동작을 이번 검사로 보장한다고 주장하지 않는다.
