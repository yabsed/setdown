# Min의 방문 디테일을 Setdown에 적용

기준 checkout: `cf6d026ce9f3854f217f671964c76ca53c554402` · Electron `44.7.2`.
참고 Min: `vendor/min`, `c92079cde045c38ab844e53501e9c5178d503a45`.
관련 조사: [Min 디테일 감사](../docs/min-browser-details-audit-2026-10-14.md).

목표는 기존 Setdown의 문서 작업 화면을 유지하면서 웹을 방문할 때 걸리는 부분을 줄이는 것이다.
Electron, 기존 uBlock Origin, native WebContentsView, 주소창·탭·Browser 패널을 사용한다.
엔진 교체나 새 브라우저 홈 화면은 이번 변경의 범위가 아니다.

## 구현한 사용자 동작

| 상황 | 적용한 동작 |
| --- | --- |
| 사이트가 알림·카메라·마이크·위치를 요청 | 작업을 중단시키는 Allow 모달 대신 해당 탭의 주소창에 요청 표시. 눌러서 native 메뉴에서 이번 페이지 허용/거절 |
| 같은 권한을 반복 요청 | 동일 요청 병합, 대기와 callback 수 제한, 거절 기억, 90초 만료 |
| 페이지 이동·탭 이동·종료·충돌 | 이전 문서의 권한·인증 대기를 종료. 과거 요청의 허용 클릭이 새 문서로 넘어가지 않음 |
| HTTP Basic/Digest 인증 | 주소창의 Sign in을 사용자가 눌러야 입력창 표시. origin과 realm을 표시하고 해당 challenge에만 응답 |
| 이미지 우클릭 | 실제 이미지 복사, 이미지 주소 복사, 새 배경 탭에서 열기, 다운로드 |
| 링크 우클릭 | 배경/전경 탭에서 열기, 주소 복사, 다운로드. mailto는 주소만 복사 |
| 선택한 글·입력 영역 우클릭 | 선택 글 검색, 편집 가능 상태에 맞춘 메뉴, 서식 없이 붙여넣기, 맞춤법 제안과 사전 추가 |
| 숨은 탭 | native 창에서 분리하면서 WebContents·폼·history 유지. Chromium background throttling 활성화 |
| 소리 나는 탭 | 탭의 작은 음소거 버튼. 음소거 후에도 해제 버튼 유지. Site controls에서도 조절 |
| 닫은 웹 탭 | Ctrl/Cmd+Shift+T 및 File 메뉴로 복구. 창별 최대 10개 URL/title 메타데이터, 폼과 비밀번호는 저장하지 않음 |
| 새로고침 | 웹 페이지에 Ctrl/Cmd+R, Ctrl/Cmd+Shift+R, F5, Shift+F5. 주소창 reload는 Shift 클릭으로 캐시 무시 |
| 페이지 찾기 | 실제 native request ID와 검색어가 맞는 결과만 표시. 한글 조합 중 Enter/Esc를 검색 명령으로 처리하지 않음 |
| Esc | 페이지의 입력·조합·dialog/popover·fullscreen/pointer lock·preventDefault 처리가 Reader 진입보다 우선 |
| 연속 popup | 실제 popup WebContents/opener를 유지하면서 10초에 5개 상한. 배경 탭의 popup은 전경을 빼앗지 않음 |
| 외부 앱 링크 | 기존 allowlist 유지, 대화상자 중복 금지, 탭별 20초에 2회 상한, 응답 뒤 owner/document 재검사 |
| 로딩 실패 | DNS/offline/timeout/connection/certificate/crash 구분. 실패한 원래 URL을 보여 주고 그 URL로 다시 시도 |
| PDF 다운로드 완료 | Downloads에 결과를 남김. 완료 순간 현재 문서를 다른 탭으로 바꾸지 않음 |
| 사이트 초기화 | Site controls에서 현재 origin의 데이터만 삭제. 공유 cookie는 관련 하위 도메인에도 영향을 준다고 확인창에 명시 |

## 정책과 수명

### 권한

[`browser-permissions.ts`](../apps/desktop/src/main/browser/browser-permissions.ts)가 request/check 양쪽의 정책을 담당한다.
권한은 현재 탭의 문서 수명에만 유지한다. hostname만 같은 다른 scheme/port에 공유하지 않는다.
cross-origin 요청, subframe 요청, 소유 탭을 확인할 수 없는 service worker 요청은 거절한다.
마이크와 카메라는 별도 grant다. 마이크 허용이 카메라 허용으로 확대되지 않는다.

대기 종류는 탭당 최대 4개, 동일 종류의 callback은 최대 8개다.
넘치는 요청은 즉시 거절한다. 지원하지 않는 clipboard-read, display capture, USB 등의 요청도 즉시 거절한다.
sanitized clipboard write, fullscreen, pointer lock은 소유한 보이는 페이지에만 허용하며 Chromium의 사용자 활성화 제약을 유지한다.
위치 권한 정책은 존재하지만 위치 제공 서비스/API key를 새로 구성한 것은 아니다.

[`browser-auth.ts`](../apps/desktop/src/main/browser/browser-auth.ts)는 탭·소유 창·요청 token별 callback을 갖는다.
한 탭의 중복 challenge와 proxy 인증은 거절하며 120초 후 만료한다.
입력한 자격 증명은 Setdown 파일이나 event에 기록하지 않는다. Chromium 자체의 인증 cache는 그대로 사용한다.
로그인 form을 가진 일반 웹사이트와 popup 기반 로그인은 기존 웹페이지에서 동작한다.

### 메뉴와 키보드

[`browser-context-menu.ts`](../apps/desktop/src/main/browser/browser-context-menu.ts)는 실제 native context-menu 이벤트로 메뉴를 만든다.
메뉴 생성 당시 문서·owner·frame을 확인하고, native 좌표에 앱 줌을 다시 곱하지 않는다.
입력 작업은 focus가 여전히 원래 frame에 있을 때만 실행한다. 비밀번호 선택은 검색 메뉴로 보내지 않는다.
새 native view 생성은 메뉴 dispatch 다음 task로 보내고, 실행 직전에 원래 문서/owner가 유효한지 다시 확인한다.

Electron 44의 `findNext` 옵션은 이름과 달리 Chromium의 `new_session`을 뜻한다.
새 검색에는 true, 같은 검색의 다음/이전 결과에는 false를 전달한다.
[고정 버전의 구현](https://github.com/electron/electron/blob/v44.7.2/shell/browser/api/electron_api_web_contents.cc)의 `FindInPage`와 실제 페이지 검색으로 확인했다.
페이지 이동 시 찾기 상태를 닫고, 같은 URL을 reload해도 오래된 Reader snapshot을 제거한다.

### 탭과 데이터

이미 있던 복원 탭 지연 생성, 분할 화면의 여러 live page, popup의 opener/POST 보존,
다운로드 진행률 병합, 별도 Places 저장소, uBlock 필터와 확장 설정은 유지한다.
창을 옮긴 탭은 동일한 WebContents를 사용하며 이전 창의 pending 요청은 취소한다.
실제로 닫힌 탭만 복구 스택에 넣는다. beforeunload에서 Stay를 고르면 원래 폼과 탭을 유지한다.

사이트 초기화는 browser session의 `clearData({origins:[origin]})`를 사용한다.
북마크/방문 기록은 별도 Places session이므로 이 작업에서 지우지 않는다.
Chromium의 cookie 범위는 origin보다 넓을 수 있어 확인 문구에 이를 드러냈다.

## 의도적으로 가져오지 않은 것과 남은 범위

- 시간만 보고 live 탭을 파괴하는 자동 discard/freeze는 추가하지 않았다. 작성 중인 폼, 오디오, 통화, 다운로드를 잃지 않는 정책이 먼저 필요하다. Min의 탭 색상 fade도 메모리 회수 기능은 아니다.
- Min의 주기적 전체 페이지 캡처, 별도 광고 차단 엔진, HTTPS 실패 시 HTTP 전환, CORS 완화, 광범위한 UA/site patch는 추가하지 않았다.
- 새로운 비밀번호 관리 제품, 번역, task manager, 독립 다운로드 바, PiP 전용 DOM 조작은 범위 밖이다.
- 창 전체 종료에서 여러 웹 탭과 수정된 Markdown을 한 번에 취소 가능한 상태로 사전 검사하는 조정은 아직 없다. 개별 웹 탭의 native beforeunload와 기존 문서 종료 확인을 유지한다. `WebContents.close()`를 반복 호출하거나 합성 DOM 이벤트로 원자적 사전 검사를 구현했다고 주장하지 않는다.
- 닫은 탭 복구는 방문 URL 복구다. 직렬화한 웹 폼/비밀번호나 닫은 탭의 전체 renderer 실행 상태 복구가 아니다.
- 이번 검증 대상은 Linux의 격리된 display다. Windows/macOS의 native menu, OS 권한 대화상자, 실기 카메라/마이크는 별도 검증이 필요하다.

### 조사 목록과의 대응

원래 조사 문서의 48개 항목을 모두 신규 구현으로 세지는 않는다.

| 조사 ID | 이번 적용 상태 |
| --- | --- |
| P01–P06, P10 | 조용한 권한 요청·문서 수명·세부 capability·조회 일관성·클립보드 쓰기 분리·HTTP 인증 구현 |
| P07–P09 | Esc가 native fullscreen/pointer lock을 가로채지 않도록 보완. 미지원 권한 거절과 기존 safeDialogs 유지. OS별 fullscreen/실기 권한 및 alert 폭주 추가 실증은 남음 |
| L01–L06 | 기존 지연 복원·분할·live 상태·문서 전용 시작 경로 유지. 숨은 view 분리, 창 이동 시 pending 취소, 창 종료 후 메타데이터 정리 추가. 창 전체 종료 사전 조정은 남음 |
| L07–L08 | 새 요청 큐/복구 stack/팝업·외부 앱 횟수에 상한. 기존 캡처·다운로드 정책 유지. 일반 page 상태 event 병합과 자동 freeze/discard는 추가하지 않음 |
| C01–C08 | 이미지/링크/메일/선택 문구/편집/맞춤법 메뉴 및 원래 문서·frame 검사 구현 |
| C09 | 전용 PiP/영상 프레임 기능 제외 |
| N01–N04 | 실제 popup/opener와 Chromium 링크 disposition 유지. 배경 popup·연속 popup·외부 앱 요청 제한 추가. POST popup·Ctrl/중클릭 별도 추가 시나리오는 남음 |
| N05–N08 | Esc 문맥·검색 요청 수명·강력 새로고침·닫은 웹 탭 복구 구현 |
| D01–D06 | 오류 분류·실패 URL·다운로드 완료의 포커스 유지·사이트별 초기화 구현. TLS 실패·기존 다운로드 기록·북마크 분리는 유지 |
| U01–U07 | 음소거 버튼과 새 제어의 label/키보드 연결 추가. 기존 주소 IME·테마·native 메뉴·탭 폭·줌 경계 유지 |

## 검증 결과

전체 단위 테스트는 95개 파일, 681개 테스트가 통과했다.
권한 중복·만료·owner 검사, 마이크/카메라 분리, 겹치는 권한 요청의 답변 일관성,
인증 token 수명, 메뉴의 문서/frame 검사, 오류 분류를 포함한다.

GUI 검사는 `with-isolated-display.sh`를 통해 Xvfb와 별도 runtime/D-Bus session에서 실행한다.
사용자의 Wayland socket은 전달하지 않는다. 이미지 복사는 실제 Electron 메뉴에 X11 키 입력을 보내 선택하고,
클립보드에서 읽은 이미지의 크기와 픽셀을 검사한다. 권한·메뉴 callback을 직접 호출해 제품 동작을 대체하지 않는다.
이 추가 메뉴 검사의 실행 환경에는 Python 3, libX11, libXtst가 필요하다.

숨은 페이지의 visibility 검사에서는 Playwright가 원래 CDP session에 건 focus emulation을 해제한다.
그 synthetic capturer가 있으면 실제 native 숨김과 무관하게 DOM visibility를 visible로 고정하기 때문이다.
다른 focus/IME 시나리오에는 이 설정을 적용하지 않는다. 해당 테스트의 내부 session 접근은 현재 설치된 Playwright에 묶여 있다.
줌 회귀 검사는 원래 native view 참조를 보관해, 창에서 분리된 동안에도 동일한 ID·bounds·factor를 검증한다.
숨은 탭 검증은 visibility와 상태 보존을 확인한 것이다. 탭별 RSS/CPU 감소량이나 Chrome Memory Saver와 같은 회수 효과를 측정한 결과는 아니다.

`npm run test:preview-contract`는 빌드·TypeScript 검사, Svelte 오류/경고 0개,
계약 단위 테스트 38개 파일/264개 사례, 비교기 자체 테스트 3개, 실제 Electron GUI 85개 사례를 모두 통과했다.
초기 실행의 줌 테스트 실패는 숨은 view를 창의 children에서 찾던 검사 도우미를 고친 뒤 전체 재실행으로 해소했다.
기존 assert·시나리오·성능 허용치를 줄이거나 재시도를 추가하지 않았다.

### 비교 성능: 48개 항목 모두 통과

`npm run bench:preview -- --baseline /tmp/setdown-min-baseline-20261014 --runs 5`로 검사했다.
원본 `cf6d026`을 별도 checkout에 lockfile 기준으로 설치하고 두 앱을 빌드했다. 두 버전 모두 Electron 44.7.2다.
같은 Xvfb `:99`에서 AB/BA 순서를 교대했고, 버전별 5회 × 8개 시나리오로 총 80개의 새 앱 실행을 완료했다.
Linux x64 · Ryzen 7 8845HS · Node 22.23.1. 측정 및 빌드는 2026-10-14 23:02–23:10 KST에 수행했다.

회귀 판정은 기존 정책인 **25%와 50ms를 모두 초과하는 증가**다. 허용치를 바꾸지 않았고 회귀는 **0/48**이었다.
각 값은 반복 실행 간 중앙값이며, warm은 각 앱의 3–5번째 cycle 중앙값을 다시 집계했다.
표의 숫자는 **원본 → 변경본(ms)**이다. 준비 대기 0/3000ms는 입력 전 대기 조건이며 표의 입력 지연에 합산하지 않는다.
Esc는 최신 내용의 nonempty native capture까지, 복귀는 실제 double-click부터 editor까지 측정한다.
화면의 실제 표시 시각이나 P95를 뜻하지 않으며, 이 결과로 웹 탭 RAM 절감이나 전반적인 속도 향상을 주장하지 않는다.

| 대상 | 준비 대기 | 편집 | 동작 | 첫 cycle | 두 번째 | warm |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Markdown | 0ms | 없음 | Esc → Reader | 36 → 41 | 30 → 21 | 24 → 21 |
| Markdown | 0ms | 없음 | double-click → Editor | 38 → 18 | 36 → 38 | 12 → 12 |
| Markdown | 0ms | 있음 | Esc → Reader | 458 → 446 | 101 → 103 | 89 → 93 |
| Markdown | 0ms | 있음 | double-click → Editor | 21 → 18 | 16 → 14 | 14 → 15 |
| Markdown | 3000ms | 없음 | Esc → Reader | 42 → 41 | 17 → 18 | 19 → 23 |
| Markdown | 3000ms | 없음 | double-click → Editor | 16 → 16 | 12 → 11 | 11 → 12 |
| Markdown | 3000ms | 있음 | Esc → Reader | 108 → 111 | 104 → 97 | 93 → 90 |
| Markdown | 3000ms | 있음 | double-click → Editor | 16 → 20 | 16 → 16 | 15 → 16 |
| Git 리뷰 | 0ms | 없음 | Esc → Reader | 1024 → 1053 | 26 → 23 | 18 → 29 |
| Git 리뷰 | 0ms | 없음 | double-click → Editor | 26 → 22 | 11 → 12 | 12 → 13 |
| Git 리뷰 | 0ms | 있음 | Esc → Reader | 1112 → 1089 | 1651 → 1606 | 178 → 179 |
| Git 리뷰 | 0ms | 있음 | double-click → Editor | 23 → 22 | 20 → 21 | 17 → 19 |
| Git 리뷰 | 3000ms | 없음 | Esc → Reader | 32 → 27 | 17 → 21 | 16 → 16 |
| Git 리뷰 | 3000ms | 없음 | double-click → Editor | 24 → 25 | 11 → 12 | 17 → 17 |
| Git 리뷰 | 3000ms | 있음 | Esc → Reader | 233 → 231 | 190 → 182 | 186 → 175 |
| Git 리뷰 | 3000ms | 있음 | double-click → Editor | 22 → 21 | 18 → 18 | 16 → 18 |

원본부터 존재하던 준비 없는 Git 리뷰의 첫 진입 지연은 이번 변경에서도 남아 있다. 새 브라우저 디테일 추가가 그 지연을 해결했다는 의미는 아니다.

### 검사 원본

- [전체 단위 테스트](../test-results/min-browser-details-20261014/unit-tests.log)
- [빌드·타입·계약 단위·Electron GUI 검사](../test-results/min-browser-details-20261014/preview-contract.log)
- [추가 이미지 픽셀 검사: 1개 통과](../test-results/min-browser-details-20261014/image-pixel-e2e.log)
- [성능 비교 JSON: 원본 값·hash·조건·48개 판정](../test-results/min-browser-preview-comparison-20261014/comparison.json)
- [성능 검사 실행 로그](../test-results/min-browser-details-20261014/preview-benchmark.log)

`test-results/`의 파일은 이번 로컬 실행 artifact이며 Git 추적 대상은 아니다. 위 표는 보고서에 유지한다.

## 주요 변경 파일

- main 정책: [BrowserManager](../apps/desktop/src/main/browser/browser-manager.ts), [권한](../apps/desktop/src/main/browser/browser-permissions.ts), [인증](../apps/desktop/src/main/browser/browser-auth.ts), [메뉴](../apps/desktop/src/main/browser/browser-context-menu.ts)
- 화면: [LocationBar](../apps/desktop/src/renderer/browser/LocationBar.svelte), [TabChrome](../apps/desktop/src/renderer/tabs/TabChrome.svelte), [인증 dialog](../apps/desktop/src/renderer/browser/BrowserAuthDialog.svelte)
- 연결: [browser protocol](../apps/desktop/src/protocol/browser.ts), [browser runtime](../apps/desktop/src/renderer/browser/browser-runtime.ts), [page preload](../apps/desktop/src/browser-runtime/page-preload.ts)
- 회귀 보호: [browser E2E](../apps/desktop/test/e2e/browser.spec.ts), [preview 성능 계약](../docs/preview-performance-contract.md)
