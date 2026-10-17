# LSP 개혁 적용 검증

2026년 10월 17일 [서브모듈 감사 보고서](../../reports/2026_10_17_12_31_setdown_lsp_submodule_audit.md)에서 재현한 핵심 결함 8종을 수정했다. 같은 nbformat 파일의 rename 대상이 단독 열기·프로젝트 열기·상위 저장소 열기 모두 4개 파일로 일치한다. TypeScript 힌트와 CSS 진단도 별도 사용자 설정 없이 나온다. 일반 문서와 노트북의 응답 수명, Monaco worker, 분석 문맥 표시를 함께 보강했다.

비교 기준은 `63ca82e`이다. 이 커밋은 감사 도구와 보고서를 추가한 상태이며, 감사 대상 제품 코드 `a00d7ae`와 제품 구현이 같다. 변경한 소스의 해시는 [source-sha256.json](../../reports/lsp-reform-validation-2026-10-17/source-sha256.json)에 기록했다.

## 적용한 동작

| 영역 | 수정 결과 | 주요 코드 |
| --- | --- | --- |
| 분석 프로젝트 | UI에서 연 폴더와 분석 루트를 분리한다. Python 프로젝트 표식, 중첩 TS 패키지, Cargo workspace의 members·exclude·package.workspace를 읽고 `.git` 파일인 서브모듈 경계도 지킨다. | [language-root.ts](../../apps/desktop/src/main/language/language-root.ts) |
| 서버 프로필 | TypeScript·JavaScript의 inlay 설정을 workspace settings로 전달한다. CSS·SCSS·Less에는 서버가 기대하는 validate·lint·completion·hover 기본 설정을 제공한다. 알 수 없는 configuration section은 명세대로 `null`을 유지한다. | [프로필 생성기](../../apps/desktop/scripts/update-language-profiles.py) |
| 노트북 자동완성 | 세 trigger kind를 LSP 값으로 변환하고 협상한 trigger character를 사용한다. lazy resolve와 셀 내부 추가 편집을 지원하며, 이전 노트북 버전·다른 셀·위조 핸들의 결과를 거절한다. 실제 구현 범위에 맞춘 별도 client capabilities를 보낸다. | [notebook-language.ts](../../apps/desktop/src/renderer/notebook/notebook-language.ts), [host](../../apps/desktop/src/main/language/notebook-language-host.ts) |
| 진단 등록 | 정적·동적 diagnostic provider를 등록 ID별로 유지한다. 각각의 resultId와 결과를 캐시하고, 해제한 제공자의 진단만 없앤다. | [server-capabilities.ts](../../apps/desktop/src/main/language/server-capabilities.ts), [language-diagnostics.ts](../../apps/desktop/src/renderer/language/language-diagnostics.ts) |
| 오류와 취소 | JSON-RPC code·message·data가 Electron IPC에서 사라지지 않는다. 서버가 취소한 의미 토큰·허용된 pull diagnostics는 같은 버전에서만 최대 3회 시도한다. 간격은 25·50ms이며 사용자 취소나 버전 변경은 중단한다. rename·command는 재실행하지 않는다. | [language-request.ts](../../apps/desktop/src/protocol/language-request.ts) |
| resolve 수명 | 반환 중 4,096개를 넘었다고 첫 항목을 퇴출하지 않는다. 응답 전체를 원자적으로 예약하고, 약 32MiB의 세션별 저장 예산을 넘으면 새 응답을 거절한다. completion 목록의 dispose와 문서 수명을 연결했다. lazy document link·code lens의 핸들도 유지한다. | [server-items.ts](../../apps/desktop/src/main/language/server-items.ts) |
| Monaco | 일반 편집기·Git diff·노트북이 공통 worker dispatcher를 사용한다. JSON·CSS·HTML·TS/JS는 해당 worker를 필요할 때 로드한다. 내장 언어 서비스가 있는 언어는 연결된 외부 서버가 해당 모델의 기능과 표시 진단을 맡고, 실패 시 내장 검증을 복구한다. | [monaco-runtime.ts](../../apps/desktop/src/renderer/editor/monaco-runtime.ts), [builtin-diagnostics.ts](../../apps/desktop/src/renderer/language/builtin-diagnostics.ts) |
| 분석 문맥 | 실제 루트와 선택 이유, 명시한 Python interpreter, 서버가 보고한 TS 버전·출처, 탐색한 C++ compilation database, 초기화/실행 중 실패를 표시한다. 발견만 한 실행 파일은 `Detected`, 초기화한 세션은 `Ready`로 구분한다. | [LanguageSupport.svelte](../../apps/desktop/src/renderer/language/LanguageSupport.svelte), [server-session.ts](../../apps/desktop/src/main/language/server-session.ts) |

Language Support의 Connection settings에서 `root`에 절대 경로를 지정하면 그 경로 아래 파일의 분석 루트를 고정할 수 있다. 다른 프로젝트는 자동 탐색한다. Python interpreter를 고정하려면 `settings.python.pythonPath`를 지정한다. 프로젝트 안의 실행 파일을 새로 자동 실행하는 환경 탐색은 추가하지 않았다.

TS 버전 표시는 서버의 `$/typescriptVersion` 통지를 사용한다. 이번 gitgraph 표본에서는 `5.9.3 (workspace)`였다. C++ 패널의 compilation database 표시는 파일 탐색 결과이며, 실제 선택한 컴파일 명령은 서버 출력과 함께 확인해야 한다. [TypeScript 서버의 버전 통지](https://github.com/typescript-language-server/typescript-language-server#typescript-version-notification)

내장 진단 adapter 자체는 다른 모델과 실패 후 복구를 위해 유지한다. 중복 결과 표시를 막았다는 뜻이며, 내장·외부 분석의 CPU 비용을 없앴다는 주장은 아니다. C/C++·Python처럼 Monaco의 내장 언어 서비스가 없는 언어에는 기존 단어 제안을 유지한다.

## 같은 서브모듈로 재검사한 결과

11개 서브모듈의 커밋과 14개 파일의 해시는 기존 감사와 일치한다. 26개 시나리오 중 24개는 연결 및 요청 검사를 수행했고, TypeScript 서버 미설치 1개와 Rust 도구체인 부재 1개는 각각 기존 환경 조건을 확인했다. 검사 중 원본 파일은 모두 그대로다. [환경과 커밋](../../reports/lsp-reform-validation-2026-10-17/environment.json), [최종 원시 응답](../../reports/lsp-reform-validation-2026-10-17/evidence.json), [검증된 요약](../../reports/lsp-reform-validation-2026-10-17/summary.json)

| 관측 | 수정 전 | 수정 후 |
| --- | --- | --- |
| nbformat rename 파일 수, 단독/프로젝트/상위 저장소 | 2 / 4 / 2 | 4 / 4 / 4, 동일 파일 집합 |
| 같은 세 방식의 실제 rename UI | 일부 방식에서 대상 누락 | 모두 4개 dirty 탭, 파일 저장 없음 |
| 기본 설정의 gitgraph TS inlay hints | 0 | 12 |
| 잘못된 CSS, 기본 설정 | `validProperties` 예외와 진단 누락 | 오류 1개와 경고 1개, 실제 Monaco 표시도 확인 |
| JSON worker | `doValidation` 오류 | 콘솔 오류 없음 |
| nbformat 노트북 completion resolve | 허용 경로 누락 | 원본 서버 데이터로 문서 설명 반환 |

최종 관측의 nbformat rename 요청은 단독 312ms, 프로젝트 299ms, 상위 저장소 294ms였다. 각 1회 관측이므로 통계적 성능 비교로 사용하지 않는다. C/C++ 표본의 Qt 헤더·생성 헤더와 Rust 도구체인은 여전히 준비되지 않았다. 해당 대형 프로젝트의 완전한 의미 분석 품질까지 검증한 것은 아니다. 대신 별도 clangd fixture는 실제 compile database와 `.clangd`를 사용해 진단, 서버 completion, rename, Undo, formatting, 헤더 이동을 검증했다.

## 회귀 검사

- LSP 단위·실제 서버 검사: **104개 통과**. Pyright 1.1.414, basedpyright 1.40.2, clangd 22.1.0을 실제 실행하는 검사를 포함한다. [로그](../../reports/lsp-reform-validation-2026-10-17/unit-final.log.txt)
- `test:preview-contract`: **473개 단위 검사, tooling 11개, 기존 Electron 130개 통과**. 빌드·TypeScript·Svelte 검사도 통과했다. [전체 로그](../../reports/lsp-reform-validation-2026-10-17/preview-contract-final.log.txt)
- 신규 Electron 검사 **2개 통과**. 실제 IPC의 ServerCancelled 재요청, 두 진단 제공자의 독립 해제, 4,097개 목록 첫 항목 resolve, 외부 서버 없는 JSON·CSS·HTML worker를 검사했다. 두 검사를 contract manifest에도 추가하고 해당 설정으로 별도 실행했다. 현재 contract GUI 대상 **132개 모두 검증**했다. [추가 검사 로그](../../reports/lsp-reform-validation-2026-10-17/added-contract-tests.log.txt)
- 생성 프로필 검사: **195개 프로필 일치**. `npm run check:language-profiles --workspace @setdown/desktop`.

첫 빌드는 TypeScript worker 번들 때문에 Node 기본 2GB 힙 한도를 넘었다. renderer 빌드 전용 실행기에 4GB 한도를 지정해 해결했다. Electron 실행의 힙 설정은 바꾸지 않았다. 첫 GUI 검사의 실패 2개도 보존했다. 미시작 서버의 `Ready` 기대값은 `Detected`로 바꿨고, C++ completion은 유효한 함수 호출 문맥에서 검사하며 IPC 응답에 `greeting`이 실제 포함되는지 확인하도록 강화했다. [초기 빌드 실패](../../reports/lsp-reform-validation-2026-10-17/preview-contract-build-oom.log.txt), [초기 GUI 검사](../../reports/lsp-reform-validation-2026-10-17/preview-contract-first.log.txt)

감사 도구의 TS 선언 위치는 원래 LSP completion이 0개였고, 기존 UI 목록은 내장 단어 제안이었다. 외부 서비스가 이 기능을 맡은 뒤에는 `No suggestions.`가 올바른 화면이다. 관측 도구에 Go to Line 종료·편집기 포커스 확인을 추가하고, LSP 응답을 기다린 뒤 이 안내문을 확인하게 했다. 초기 실패 자료는 `evidence-initial.json`, `evidence-before-ui-fence.json`, `evidence-ts-gitgraph-focus-failure.json`에 남겼다.

모든 GUI 실행은 Xvfb, 분리된 runtime directory·D-Bus, 제거된 Wayland socket 환경을 사용했다. 사용자 데스크톱에 창을 띄우지 않았다.

## 미리보기 성능 비교

기준 버전과 수정 버전을 독립 설치·빌드하고 동일 Xvfb display `:99`에서 번갈아 측정했다. 8개 시나리오 × 2개 버전 × 5회 반복, 총 **80회 Electron 실행**을 완료했다. 다른 회귀 검사는 종료한 뒤 측정했다. 기존 상대 25%·절대 50ms 기준을 모두 넘는 회귀는 **48개 비교 중 0개**였다. 가장 큰 증가값은 편집이 있는 Git review, 준비 시간 0ms의 둘째 capture에서 **40ms**였다.

표의 값은 기준 → 수정, 단위는 ms다. 첫째와 둘째는 각 5회 실행의 중앙값이다. warm은 각 실행의 3–5 cycle 중앙값을 구한 뒤 5회 실행의 중앙값을 사용한다. capture는 Esc부터 최신 내용의 비어 있지 않은 native capture까지이며 polling·IPC·readback을 포함한다. 모니터의 실제 표시 시각을 재는 값은 아니다. 편집 시 최신 내용 확인과 모든 cycle을 그대로 유지했다. [원시 비교와 반복별 측정값](../../reports/lsp-reform-validation-2026-10-17/preview-comparison.json), [실행 로그](../../reports/lsp-reform-validation-2026-10-17/preview-benchmark.log.txt)

| 문서 | 준비 | 편집 | cycle | Esc → capture | 더블클릭 → 편집기 |
| --- | --- | --- | --- | ---: | ---: |
| Markdown | 0ms | 없음 | 첫째 | 33 → 42 | 16 → 18 |
| Markdown | 0ms | 없음 | 둘째 | 19 → 23 | 34 → 35 |
| Markdown | 0ms | 없음 | warm | 23 → 20 | 11 → 11 |
| Markdown | 0ms | 있음 | 첫째 | 439 → 425 | 16 → 18 |
| Markdown | 0ms | 있음 | 둘째 | 107 → 96 | 13 → 15 |
| Markdown | 0ms | 있음 | warm | 90 → 90 | 13 → 15 |
| Markdown | 3000ms | 없음 | 첫째 | 43 → 42 | 17 → 16 |
| Markdown | 3000ms | 없음 | 둘째 | 23 → 23 | 12 → 11 |
| Markdown | 3000ms | 없음 | warm | 21 → 23 | 11 → 11 |
| Markdown | 3000ms | 있음 | 첫째 | 109 → 107 | 19 → 15 |
| Markdown | 3000ms | 있음 | 둘째 | 100 → 98 | 13 → 17 |
| Markdown | 3000ms | 있음 | warm | 91 → 91 | 13 → 14 |
| Git review | 0ms | 없음 | 첫째 | 929 → 968 | 24 → 24 |
| Git review | 0ms | 없음 | 둘째 | 19 → 28 | 11 → 11 |
| Git review | 0ms | 없음 | warm | 20 → 23 | 12 → 13 |
| Git review | 0ms | 있음 | 첫째 | 993 → 978 | 24 → 23 |
| Git review | 0ms | 있음 | 둘째 | 1458 → 1498 | 22 → 21 |
| Git review | 0ms | 있음 | warm | 174 → 176 | 19 → 19 |
| Git review | 3000ms | 없음 | 첫째 | 27 → 33 | 22 → 23 |
| Git review | 3000ms | 없음 | 둘째 | 23 → 23 | 11 → 11 |
| Git review | 3000ms | 없음 | warm | 17 → 18 | 18 → 17 |
| Git review | 3000ms | 있음 | 첫째 | 228 → 226 | 22 → 22 |
| Git review | 3000ms | 있음 | 둘째 | 185 → 185 | 17 → 17 |
| Git review | 3000ms | 있음 | warm | 176 → 175 | 18 → 17 |

전체 launch 로그와 화면·cycle artifact는 저장소의 `test-results/lsp-reform-preview-20261017/`에 보존했다. 기준 checkout은 `/tmp/setdown-lsp-reform-base-63ca82e`이다.

## 재현 방법과 후속 범위

저장소 루트에서 실행한다. 서브모듈 관측의 외부 서버 설치는 [원래 감사의 실행 방법](../../reports/2026_10_17_12_31_setdown_lsp_submodule_audit.md)을 따른다. 기준 버전은 별도 checkout에 해당 lockfile로 의존성을 설치해야 한다.

```sh
npm run check:language-profiles --workspace @setdown/desktop
npm test --workspace @setdown/desktop -- --run src/main/language src/renderer/language src/renderer/notebook/notebook-language.test.ts src/protocol/language-request.test.ts
npm run test:preview-contract
bash apps/desktop/scripts/with-isolated-display.sh node reports/lsp-reform-validation-2026-10-17/probe.mjs
node reports/lsp-reform-validation-2026-10-17/verify.mjs
npm run bench:preview -- --baseline /tmp/setdown-lsp-reform-base-63ca82e --output /absolute/path/to/new-results
```

보고서에서 장기 과제로 분류한 기능별 복수 서버 조합, `scopeUri`별 환경 설정, `showMessageRequest`의 사용자 action UI는 후속 범위로 남아 있다. 이번 진단 제공자 분리는 한 서버 세션 안의 여러 등록을 다룬다. 일반 LSP 문서의 주 서버는 여전히 하나이며, native notebook 동기화와 기존 workspace edit·Undo 소유권을 유지했다.
