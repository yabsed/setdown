# Min 소스에서 고른 Setdown 웹 방문 경험의 필수 디테일

작성일: 2026-10-14  
상태: 조사 당시의 소스 분석과 구현 명세. 이후 적용한 코드와 검증·남은 범위는 [구현 보고서](../reports/2026_10_14_min_browser_details_implementation.md)에 따로 기록한다. 아래의 모든 제안이 구현됐다는 의미는 아니다.

## 1. 제품 방향과 이 문서의 판단

Setdown의 목표는 **문서를 읽고 쓰다가 웹을 자연스럽게 방문할 수 있는, 예쁜 작업 공간**이다. 탭·주소창·분할 화면·테마는 기존 Setdown의 것을 유지한다. 웹 방문을 위해 별도의 브라우저 제품 사용법을 배우게 하지 않는다.

현재 과제에는 Electron을 유지하는 접근이 적합하다. 알림 요청의 표시 방식, 우클릭 이미지 복사, 팝업의 수명, 숨겨진 탭의 작업량, 오류에서 돌아오는 방법은 대부분 우리가 이미 쓰는 Electron API와 작은 제품 정책으로 개선할 수 있다. 이 일을 위해 CEF 전환이나 Rust 호스트를 선행 조건으로 삼지 않는다.

이것은 모든 Chrome 기능을 Electron에서 제공할 수 있다는 주장이 아니다. Chrome 확장 전체 호환성, 비밀번호 관리자, 브라우저 동기화, Chrome Memory Saver와 동등한 탭 폐기 정책은 이번 목표에서 제외한다. 기존 uBlock과 이미 제공하는 확장 기능은 유지하지만, 새로운 브라우저 플랫폼을 만드는 방향으로 범위를 넓히지 않는다.

**필수로 가져올 것은 Min의 기능 개수가 아니라 일상적인 방문을 방해하지 않는 동작이다.** Min과 Setdown을 비교해 다음 세 종류를 구분한다.

- **필수 보완:** 지금 빠져 있거나 동작 계약이 불완전한 부분. 권한 요청, 이미지 복사, 메뉴 대상의 정확성, 창 종료 시 미저장 웹 상태 등이 해당한다.
- **기존 구현 유지:** 팝업의 실제 WebContents 인계, 페이지를 살려 두는 탭 전환, 지연 복원, 다운로드 기록, 탭별 줌 등. Min을 참고한다는 이유로 다시 만들지 않는다.
- **조건부·제외:** 자동 탭 폐기, 전체 페이지 상시 색인, 사이트별 JS 패치, 새 비밀번호 저장소, 번역 엔진 등. 현재 목표에 비해 비용 또는 동작 변경이 크다.

사용자에게 보이는 변화는 필요한 순간의 작은 메뉴와 상태 표시여야 한다. 평소의 주소창 높이, 문서 영역, 탭 폭, 분할 구성, 폰트와 테마는 그대로 둔다. 새 기능 때문에 빈 화면에서도 아이콘을 나열하거나 상시 패널을 추가하지 않는다.

## 2. 조사 기준과 근거

### 2.1 조사한 실제 체크아웃

| 대상 | 고정 기준 |
| --- | --- |
| Setdown | `cf6d026ce9f3854f217f671964c76ca53c554402` |
| Min submodule | `c92079cde045c38ab844e53501e9c5178d503a45`, 1.35.7 |
| Min의 Electron 선언 | 43.4.1 |
| Setdown의 Electron 선언 | 44.7.2 |
| Min 소스 규모 | `main/`, `js/`, `pages/` 아래 JS 123개, 18,823줄, 565,688자 |

규모는 위 세 디렉터리의 `*.js`를 집계한 값이며 외부 라이브러리·CSS·HTML을 포함하지 않는다. “약 2만”은 이 범위에서는 문자 수보다 줄 수에 가깝다. 이 수치를 전 파일 정독 완료의 의미로 쓰지 않는다. 권한, View 수명, 탭 상태·복원, 메뉴, 입력, 다운로드, 필터링, 주소 처리, 오류, Reader, Places 관련 파일은 본문을 읽고 호출 경로를 추적했다. 비밀번호 공급자·번역 엔진·태스크 관리 UI 전체를 이번 분석 대상으로 확장하지 않았다.

판단은 IDE에 열려 있는 과거 CEF 파일 이름이 아니라 위 체크아웃의 Electron 제품 코드에 근거한다. 조사 시작 당시 별도로 존재하던 `vendor/cef/`, `vendor/cef-project/`, `vendor/chromium/` 작업 트리는 변경하지 않는다.

아래의 **확인**은 소스에서 확인했다는 뜻이다. **제안**은 Setdown에 적용할 동작이며, **실증 필요**는 Electron을 실제 실행해 검증해야 하는 부분이다. 기존 테스트의 존재와 이번 조사에서 테스트를 실행했다는 주장을 구분한다.

### 2.2 Min 근거 지도

본문의 M 번호는 이 표의 파일과 심벌을 가리킨다. Min 링크는 모두 위 커밋에 고정되어 있다.

| 번호 | 파일 / 읽은 핵심 |
| --- | --- |
| M01 | [main/permissionManager.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/permissionManager.js): request/check, pending/granted, 탐색 시 정리 |
| M02 | [js/navbar/permissionRequests.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/permissionRequests.js): 권한 요청 아이콘, 클릭 허용 |
| M03 | [main/viewManager.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/viewManager.js): View 생성, 팝업 인계, 외부 앱, HTTP 인증, focus/destroy |
| M04 | [js/webviews.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/webviews.js): 선택 시 생성, placeholder, 캡처, 전체 화면, 오류, history |
| M05 | [js/browserUI.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/browserUI.js): 전경/배경 탭, 선택과 닫기, 팝업 탭 |
| M06 | [js/tabState/tab.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/tabState/tab.js): lastActivity, 임시 상태, hasWebContents |
| M07 | [js/navbar/tabActivity.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/tabActivity.js): 비활성 탭의 색 흐림 |
| M08 | [js/sessionRestore.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/sessionRestore.js): 원자적 저장, 비공개 탭 제외, 손상 파일 백업 |
| M09 | [main/windowManagement.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/windowManagement.js): 창에서 View 분리, 마지막 창 종료 시 정리 |
| M10 | [js/webviewMenu.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/webviewMenu.js): 이미지 복사, 링크/이미지 저장, 붙여넣기, 맞춤법, PiP |
| M11 | [js/preload/default.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/preload/default.js): 휠/스크롤 IPC, 메뉴 hit test, PiP |
| M12 | [js/tabAudio.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/tabAudio.js): 재생 표시와 음소거 |
| M13 | [js/findinpage.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/findinpage.js): 검색 종료·선택·focus·탐색 정리 |
| M14 | [js/keybindings.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/keybindings.js), [defaultKeybindings.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/defaultKeybindings.js): 입력 문맥, Esc, 강력 새로고침, 닫은 탭 복원 |
| M15 | [js/navbar/tabEditor.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/tabEditor.js), [util/keyboardNavigationHelper.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/util/keyboardNavigationHelper.js): 주소 편집, IME, 키보드 이동 |
| M16 | [js/webviewGestures.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/webviewGestures.js): 가로 스크롤과 뒤로 가기 구분, iframe 예외 |
| M17 | [main/download.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/download.js), [js/downloadManager.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/downloadManager.js): DownloadItem, 저장/열기/드래그, PDF 응답 |
| M18 | [main/remoteActions.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/remoteActions.js): 사전 추가, 저장소 정리, 파일 드래그 |
| M19 | [pages/error/error.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/pages/error/error.js): 오류 분류, 재연결, SSL 오류 처리 |
| M20 | [main/filtering.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/filtering.js): 팝업/요청 필터, 추적 매개변수 제거 |
| M21 | [main/UASwitcher.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/UASwitcher.js), [js/preload/siteUnbreak.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/preload/siteUnbreak.js): UA와 사이트별 우회 |
| M22 | [main/main.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/main.js): 숨은 서비스 창, 화면 경계, mouse app-command, occlusion 플래그 |
| M23 | [main/prompt.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/prompt.js), [minInternalProtocol.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/main/minInternalProtocol.js): 인증 창과 내부 리소스 경계 |
| M24 | [js/places/places.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/places/places.js), [placesService.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/places/placesService.js): 기록 선별, 검색 캐시, 보존 기간 |
| M25 | [js/preload/textExtractor.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/preload/textExtractor.js): 로드/SPA 탐색 후 본문 추출 |
| M26 | [js/readerView.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/readerView.js), [readerDecision.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/readerDecision.js), [preload/readerDetector.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/preload/readerDetector.js): Reader 진입과 사이트별 기억 |
| M27 | [js/util/urlParser.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/util/urlParser.js), [navbar/navigationButtons.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/navigationButtons.js): URL 표현과 탐색 |
| M28 | [js/navbar/progressBar.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/progressBar.js), [tabColor.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/tabColor.js): 지연 로딩 표시와 사이트 색상 |
| M29 | [js/tabRestore.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/tabRestore.js), [navbar/tabContextMenu.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/navbar/tabContextMenu.js): 닫은 탭 10개, 복제, 새 창 |
| M30 | [js/pdfViewer.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/pdfViewer.js), [util/proxy.js](https://github.com/minbrowser/min/blob/c92079cde045c38ab844e53501e9c5178d503a45/js/util/proxy.js): PDF 전달, 세션별 proxy |

### 2.3 Setdown 근거 지도

| 번호 | 현재 구현과 조사 지점 |
| --- | --- |
| S01 | [browser-manager.ts](../apps/desktop/src/main/browser/browser-manager.ts): `installPermissions`, `openEntry`, `layout`, `close`, `adopt`, `browser:restore` |
| S02 | [browser-runtime.ts](../apps/desktop/src/renderer/browser/browser-runtime.ts): 분할별 표시 집합, reader/overlay 동안 숨김, focus 이벤트의 소유 탭 검사 |
| S03 | [LocationBar.svelte](../apps/desktop/src/renderer/browser/LocationBar.svelte): 34px 주소창, IME, 검색, 줌, 오류 표시 |
| S04 | [browser-downloads.ts](../apps/desktop/src/main/browser/browser-downloads.ts), [BrowserDownloads.svelte](../apps/desktop/src/renderer/browser/BrowserDownloads.svelte): 네이티브 전송, 기록, 사용자 명령 |
| S05 | [browser-places.ts](../apps/desktop/src/main/browser/browser-places.ts), [places.ts](../apps/desktop/src/browser-runtime/places.ts): 분리된 검색 서비스, 요청 timeout, 42일 기록 정리 |
| S06 | [browser-extensions.ts](../apps/desktop/src/main/browser/browser-extensions.ts), [build-browser.mjs](../apps/desktop/scripts/build-browser.mjs): uBlock 시작, 세션 preload, 응답 헤더 호환 |
| S07 | [page-preload.ts](../apps/desktop/src/browser-runtime/page-preload.ts): 격리된 프레임 정책, 창 드래그 CSS 제외, 휠 줌, uBlock 스타일 |
| S08 | [browser-url.ts](../apps/desktop/src/core/browser/browser-url.ts), [protocol/browser.ts](../apps/desktop/src/protocol/browser.ts): 허용 URL과 제한된 IPC 명령 |
| S09 | [window-manager.ts](../apps/desktop/src/main/windows/window-manager.ts), [window-ipc.ts](../apps/desktop/src/main/ipc/window-ipc.ts): 창 닫기와 IPC 소유자 |
| S10 | [menu-overlay.ts](../apps/desktop/src/main/menu/menu-overlay.ts): 살아 있는 웹 화면 위의 네이티브 메뉴 레이어 |
| S11 | [document-manager.ts](../apps/desktop/src/main/documents/document-manager.ts), `pasteImage`: 클립보드 PNG/파일을 Markdown 자산으로 저장 |
| S12 | [tab-controller.ts](../apps/desktop/src/renderer/workspace/tab-controller.ts), [tab-navigation.ts](../apps/desktop/src/core/workspace/tab-navigation.ts): 웹/파일 공통 탭, 닫기, 탐색 journal |
| S13 | [browser.spec.ts](../apps/desktop/test/e2e/browser.spec.ts): 실제 Electron의 페이지 보존·팝업·분할·줌·다운로드·Reader 검사 |
| S14 | [browser-downloads.test.ts](../apps/desktop/src/main/browser/browser-downloads.test.ts), [browser-extensions.spec.ts](../apps/desktop/test/e2e/browser-extensions.spec.ts): 다운로드 순서와 확장 동작 |
| S15 | [preview-performance-contract.md](preview-performance-contract.md): 기존 화면·입력·상태·지연 보장 |

## 3. 먼저 바로잡아야 할 사실

### 3.1 지금 보이는 알림 확인창은 교체 가능한 Setdown 코드다

S01의 `installPermissions`는 권한 요청마다 `dialog.showMessageBox`를 호출한다. 메시지는 `Allow <permission>?`, 설명은 origin, 버튼은 Deny/Allow다. 제시된 이미지와 같은 형태의 창을 생성하는 직접적인 경로가 현재 코드에 있다. Chrome이 강제로 제공해서 바꿀 수 없는 UI가 아니다.

권한 확인·요청 핸들러는 이미 둘 다 설치되어 있다. 빠진 것은 API 연결 자체보다 요청의 수명, 세부 권한 구분, 거절 기억, 표시 정책이다. 현재 `Set<string>`은 origin과 permission만 저장하며, 허용한 `media` 안에서 마이크와 카메라를 구분하지 않는다. 응답 시에는 WebContents가 파괴됐는지만 검사한다. 그 사이 같은 WebContents가 다른 페이지로 이동했는지, 탭이 다른 창으로 옮겨졌는지 검사하지 않는다.

### 3.2 Min의 흐려진 탭은 메모리가 회수된 탭이 아니다

M07은 마지막 활동으로부터 330,000ms, 즉 5분 30초가 지나면 `fade` CSS 클래스를 붙인다. 7.5초마다 갱신한다. 이 파일에는 페이지 정지나 WebContents 파괴가 없다.

실제 자원 경로는 M03·M04·M06·M08·M09에 있다. 저장한 탭의 메타데이터와 WebContents 존재 여부를 분리하고, 없는 View는 선택 시 만든다. 선택을 바꾸면 기존 View를 창에서 분리하지만, 열린 페이지를 무조건 파괴하지 않는다. 탭/태스크를 닫거나 마지막 창이 사라질 때 View를 정리한다.

`main/`과 `js/`에서 discard, freeze, unload, memory, lastActivity, hasWebContents 및 destroy 호출을 검색하고 해당 경로를 읽었다. **이 리비전에서 일정 시간 비활성이라는 이유로 실행 중인 탭을 자동 폐기하는 정책은 찾지 못했다.** Chromium 내부 최적화가 없다는 뜻은 아니다. Min에 Chrome Memory Saver 같은 자체 정책이 있다고 주장할 근거가 없다는 뜻이다.

### 3.3 Setdown은 이미 일부 기반을 갖췄다

S01의 `browser:restore`는 저장된 URL/제목을 `dormant`에 넣는다. 이 시점에는 모든 웹 페이지의 View를 만들지 않는다. 처음 활성화될 때 생성한다. 기존 live 탭은 숨겨 두며 입력값, JS 상태, history를 유지한다. 팝업은 URL만 복사하는 대신 `options.webContents`를 인계한다.

S04는 다운로드를 경로 대신 고유 ID로 관리하고, 진행 이벤트를 200ms 단위로 합치며 완료 상태를 즉시 보낸다. S05는 Places를 별도 View에서 실행한다. S11에는 Markdown 이미지 붙여넣기까지 있다. 이미지 우클릭 복사를 연결하면 “웹에서 본 자료를 문서로 가져오기”가 기존 경로로 이어진다.

S02의 변수 이름 `frozen`은 overlay 캡처를 표시하는 동안 native layout을 비우는 상태다. **Chromium의 페이지 freeze를 호출한다는 뜻이 아니다.** 이름만 보고 이미 탭 절전이 구현되어 있다고 해석하지 않는다.

## 4. 적용 목록: 기능 추가보다 동작 계약

P0는 권한 오동작·데이터 손실·잘못된 대상 실행을 먼저 막는 작업, P1은 일상적인 웹 방문에 반드시 채울 작은 기능, P2는 별도 실증 후 판단할 항목이다. “유지”도 합격 기준이다. 이미 좋은 구현을 바꾸는 일을 신규 성과로 세지 않는다.

### 4.1 권한과 대화상자

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| P01 | 알림 요청이 작업을 가로막지 않음 | M01–02, 아이콘 요청 | 요청마다 모달 | P0: 작은 요청 표시로 변경 |
| P02 | 동일 요청 합치기, 거절 후 반복 억제 | M01, 알림 중복 검사 | 중복 큐·거절 기억 없음 | P0: 유한 큐와 재요청 정책 |
| P03 | origin·탭·문서 수명에 권한 묶기 | M01, 탐색/파괴 시 정리 | origin grant만 유지 | P0: 문서 세대와 소유자 검사 |
| P04 | 카메라·마이크를 따로 허용 | M01, mediaTypes 검사 | `media` 전체 허용 | P0: capability 구분 |
| P05 | 권한 조회와 실제 요청의 일관성 | M01, 두 handler | 둘 다 있으나 세부 문맥 누락 | P0: 공통 결정 함수 |
| P06 | 페이지의 복사 버튼은 자연스럽게 | M01, sanitized-write 별도 처리 | 복사 쓰기도 모달 후보 | P1: 읽기와 쓰기 분리 |
| P07 | fullscreen·pointer lock 종료 경로 | M01/M04/M14 | 요청 창만 있고 통합 경로 부족 | P1: Esc와 원래 분할 복원 |
| P08 | 지원하지 않는 권한을 정직하게 종료 | M01/M03 | allowlist 밖은 거절 | 유지 + 지원 표 명시 |
| P09 | 웹 alert/confirm 폭주 제어 | M03, safeDialogs | safeDialogs 활성화 | 유지 + 회귀 시나리오 |
| P10 | HTTP 인증이 필요한 페이지 접근 | M03/M23 | 전용 login 처리 없음 | P1: 소유 탭에 묶인 인증 요청 |

### 4.2 비활성 탭·창과 자원

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| L01 | 복원된 미방문 탭 지연 생성 | M04/M06/M08 | dormant 복원 있음 | 유지, 요청 수로 검증 |
| L02 | 안 보이는 웹 탭의 실제 숨김 | M03/M04 | setVisible(false) | P0: visibility/CPU 실증 |
| L03 | 포커스 없는 분할도 보이면 활성 | Min은 선택 View 중심 | 분할별 표시 집합 있음 | 필수 유지 |
| L04 | 탭 전환 때 살아 있는 상태 유지 | M03/M04 | live WebContents 유지 | 필수 유지 |
| L05 | 창 이동·닫기 때 정확한 소유권 | M09, 분리/마지막 창 정리 | adopt, owner close 있음 | P0: 종료·pending 경로 보완 |
| L06 | 문서만 열면 브라우저 비용 최소화 | M22, 숨은 서비스 창과 비교 | 확장 지연 시작, Places 별도 | 유지 + 불필요 초기 요청 점검 |
| L07 | 캡처·이벤트·캐시에 상한 | M04/M24의 비용 관찰 | 필요 시 캡처, 다운로드 합치기 | P1: 상태 이벤트 중복 줄이기 |
| L08 | 자동 freeze/discard | 해당 정책 확인 못 함 | 자동 폐기 없음 | P2: 기본 도입 제외 |

### 4.3 우클릭·이미지·클립보드

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| C01 | 이미지 픽셀 복사 | M10, copyImageAt | 없음 | P1 최우선 |
| C02 | 이미지 주소 복사·새 탭 열기 | M10, srcURL | 없음 | P1 |
| C03 | 이미지/링크 다른 이름으로 저장 | M10/M17, downloadURL | 메뉴 연결 없음 | P1, 기존 다운로드 재사용 |
| C04 | 링크 주소·메일 주소 복사 | M10 | 없음 | P1 |
| C05 | 선택 문구 검색 | M10 | copy만 제공 | P1 |
| C06 | 서식 없이 붙여넣기와 editFlags | M10 | 기본 편집 role만 제공 | P1 |
| C07 | 메뉴를 연 탭·프레임에 실행 | M10의 전역 selected 의존 주의 | entry 캡처, frame/세대 검사 없음 | P0 |
| C08 | 맞춤법 제안과 사전 추가 | M10/M18 | 메뉴 없음 | P1, 제공 언어 범위 명시 |
| C09 | PiP·영상 프레임 관련 동작 | M10/M11 | 전용 연결 없음 | P2, 이미지 복사 뒤 별도 실증 |

### 4.4 탐색·팝업·입력

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| N01 | opener/POST/about:blank 팝업 보존 | M03/M05 | 실제 WebContents 인계 | 필수 유지·POST 테스트 확대 |
| N02 | 배경 탭과 과도한 팝업 구분 | M03/M20 | disposition 사용, 자체 한도 없음 | P1: 전경 탈취·폭주만 제한 |
| N03 | 외부 앱 링크 중복 억제 | M03, 20초 내 최대 2회 | allowlist + 확인, 제한 없음 | P1 |
| N04 | Ctrl+클릭·중클릭 시 원래 작업 유지 | M05 | 네이티브 disposition 경로 | P1: 실제 입력으로 확인 |
| N05 | Esc가 현재 동작부터 정리 | M13/M14 | 로딩 중 stop, 아니면 Reader | P0: fullscreen/검색/IME 우선 |
| N06 | 검색 응답이 다른 탐색에 섞이지 않음 | M13 | findId 검사, requestId 생략 | P1 |
| N07 | 강력 새로고침과 일관된 탐색 | M14/M27 | 일반 reload, 통합 history 있음 | P1: 캐시 우회만 소규모 추가 |
| N08 | 닫은 웹 탭 다시 열기 | M29/M14 | 해당 웹 탭 stack 없음 | P1, 메타데이터 복원 |

### 4.5 오류·다운로드·사이트 데이터

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| D01 | 실패 종류와 재시도 대상 유지 | M19/M04 | main-frame 오류 문자열 | P1 |
| D02 | TLS 실패 시 안전한 실패 유지 | M19의 HTTP 변경은 제외 | 별도 우회 없음 | 유지, downgrade 금지 |
| D03 | 다운로드 진행·완료·중단 의미 보존 | M17 | 이미 더 세밀한 구현 | 유지 |
| D04 | 다운로드 완료가 탭 선택을 뺏지 않음 | M17과 현재 비교 | PDF 완료 시 자동 openFile | P1: 사용자가 연 목적 구분 |
| D05 | 깨진 사이트 데이터만 초기화 | M18, 저장소 정리 | history 삭제만 제공 | P1: 범위 제한한 복구 동작 |
| D06 | 기록 삭제와 북마크·로그인 분리 | M24 | 분리·직렬화 구현 | 유지 |

### 4.6 외관을 유지하는 세부 동작

| ID | 디테일 | Min 근거 | Setdown 현재 | 판단 |
| --- | --- | --- | --- | --- |
| U01 | 음소거 접근점과 정확한 상태 | M12 | main 상태·명령 있음, UI 연결 부족 | P1: 먼저 메뉴 한 항목 |
| U02 | 주소 입력 IME·전체 선택·늦은 검색 취소 | M15 | 구현되어 있음 | 유지 |
| U03 | 메뉴를 열어도 영상과 입력 상태 유지 | M04의 placeholder와 비교 | 네이티브 메뉴 overlay 있음 | 유지, 권한 UI에도 적용 |
| U04 | shell 테마와 웹 사이트 스타일 구분 | M28의 사이트 색상은 제외 | Setdown 테마 유지 | 유지 |
| U05 | 로딩 표시가 탭 폭·화면 크기를 바꾸지 않음 | M28, 지연 진행바 | 로딩선·안정된 탭 폭 | 유지 |
| U06 | 좌표와 줌을 한 번만 변환 | M10/M16 | app/tab 줌 분리 있음 | 필수 유지 |
| U07 | 새로 추가한 UI의 키보드·접근성 | M02/M15 | 기존 버튼 label 있음 | P1: 요청 UI/메뉴까지 동일 수준 |

## 5. 권한 요청: 가장 먼저 손볼 부분

### 5.1 Min에서 배울 점과 그대로 가져오면 안 되는 점

Min은 pending과 granted를 main에 보관하고 renderer에는 직렬화 가능한 설명만 보낸다. renderer가 권한을 스스로 허용하지 않고 permissionId로 main에 응답한다. 알림·마이크·카메라·pointer lock을 탭 아이콘으로 표현해서 탐색을 막지 않는다. 이것이 가져올 핵심이다. [M01, M02]

다만 그대로 복사할 구현은 아니다. M01은 권한 식별에 `URL.hostname`을 사용하므로 scheme과 port가 구분되지 않는다. Setdown의 현재 `URL.origin` 사용이 더 적합하다. Min의 승인 IPC는 permissionId로 pending을 찾으며 그 자리에서 창 소유자를 검증하지 않는다. 권한 정리 함수는 배열에서 항목을 빼지만 대기 callback을 명시적으로 거절하는 처리가 보이지 않는다. 요청마다 navigation listener를 붙이는 구조도 반복 요청에서 주의해야 한다.

이는 소스에서 발견한 검토 사항이며 실행으로 확인한 취약점 판정이 아니다. 새 구현에서는 이런 수명과 소유권의 불확실성을 남기지 않는다는 뜻이다. Min의 알림 중복 처리는 두 번째 요청을 즉시 거절하고 첫 요청을 남기는 방식이며, 소스에도 여러 callback을 합쳐야 한다는 TODO가 있다.

### 5.2 제안하는 평상시 경험

첫 방문 페이지가 알림을 요청해도 OS 모달을 열지 않는다. 해당 탭의 기존 주소 영역에만 작은 “권한 요청” 접근점을 표시한다. 주소창 높이와 문서 viewport는 바뀌지 않는다. 키보드 포커스는 원래 문서나 페이지에 남긴다.

사용자가 요청 표시를 눌렀을 때만 정확한 사이트 주소와 요청 종류, 허용/거절을 보여 준다. 마이크와 카메라는 각각 무엇을 허용하는지 읽을 수 있어야 한다. 보이지 않는 탭은 전경으로 튀어나오지 않는다. 모든 창에 요청을 뿌리고 renderer가 숨기는 구조 대신 소유 창에 필요한 항목만 보낸다.

초기 정책은 다음과 같이 좁게 시작한다. 이는 Min의 현재 기본값 설명이 아니라 Setdown에 대한 제안이다.

| 요청 | 기본 동작 | 사용자가 허용한 경우 | 기억 범위 |
| --- | --- | --- | --- |
| 알림 | 보이는 페이지에서 조용한 요청 표시, 배경 요청은 전경을 방해하지 않고 거절 | “이번 실행 동안 허용”처럼 범위를 명시 | 브라우저 session + 전체 origin, 앱 종료까지 |
| 마이크/카메라 | 해당 탭의 작은 요청 UI, 종류 구분 | 해당 문서의 요청된 capability만 | 문서 교체/종료 전까지 |
| 클립보드 쓰기 | 페이지의 일반 복사 동작은 별도 모달 없이 처리하는 정책 검증 | 콘텐츠 읽기 권한으로 확장하지 않음 | 작업 단위 |
| 클립보드 읽기 | 기본 거절, 기능 필요가 확인된 경우 별도 요청 설계 | 쓰기 허용과 독립 | 전역 자동 승인 없음 |
| fullscreen | 표시된 페이지의 명시적 진입을 네이티브 동작과 연결 | 복귀 경로가 검증된 경우만 | 영구 grant 불필요 |
| pointer lock | 필요한 탭에서만 요청, Esc 해제 보장 | 그 문서에만 허용 | 일시적 |
| 위치 | 공급자와 패키지 환경에서 실제 동작을 검증하기 전에는 지원 약속 안 함 | 지원하게 되면 별도 명세 | 현재 일괄 허용 금지 |
| 화면 공유·USB·HID·Serial 등 | 전용 선택 UI가 없는 기능은 명시적으로 거절 | 범용 Allow 버튼으로 첫 장치를 선택하지 않음 | 지원 기능 추가 시 별도 정책 |

알림의 허용을 session 범위로 제안하는 이유는 Electron의 permission check가 WebContents 없이 들어올 수도 있기 때문이다. 문서만의 임시 grant와 사이트 알림 grant를 구별해야 한다. `webContents === null`이라는 이유만으로 무조건 허용하지 않으며, 검증된 origin에 사용자가 명시적으로 만든 알림 grant가 있을 때만 조회한다. 앱 종료 이후의 푸시 알림이나 서비스 워커 상시 실행까지 지원한다는 의미는 아니다.

권한 확인 API와 요청 API를 함께 구현해야 하고, 하위 프레임 요청은 top-level URL만으로 식별하면 안 된다는 점은 [Electron session 문서](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler)와 현재 설치된 타입 선언에서도 확인했다.

### 5.3 요청 큐와 수명

main의 요청 모델에는 최소한 requestId, ownerWindow, tabId, webContentsId, documentGeneration, requestingOrigin, permission, mediaTypes, createdAt, 상태가 필요하다. callback은 main에만 남는다. renderer에는 표시용 데이터와 제한된 응답 명령만 보낸다.

여기서 documentGeneration은 S01의 현재 `navigation` 카운터를 그대로 뜻하지 않는다. 그 카운터는 주로 `load()` 경쟁을 제어한다. 웹 안의 링크·reload·redirect까지 포함하는 cross-document 수명을 별도로 추적해야 한다. 같은 URL을 reload해도 새 문서이고, same-document history 이동은 동일 문서다.

일반 PermissionRequest에는 요청 프레임 ID나 모든 권한에 통용되는 userGesture가 제공된다고 가정하지 않는다. 현재 타입에 있는 `requestingUrl`, `isMainFrame`과 native 문서 수명으로 확인 가능한 범위를 사용한다. 정확한 요청 프레임을 식별할 수 없는 교차 출처 하위 프레임의 신규 허용은 첫 버전에서 거절한다. URL이 같은 여러 프레임 중 하나를 임의로 골라 grant를 넘기지 않는다.

권한 큐의 필수 규칙은 다음과 같다.

1. 같은 문서·origin·권한·mediaTypes 요청을 하나의 UI로 묶되 callback별 완료 상태를 유지한다. 카메라 요청을 마이크 요청의 중복으로 합치지 않는다.
2. 사용자 응답, 문서 교체, 탭 종료, 창 종료, timeout 중 먼저 발생한 사건이 요청을 한 번만 완료한다.
3. 기다리는 요청 수와 최대 대기 시간에 상한을 둔다. 예를 들어 문서당 4개, 창당 16개, 60초를 초기 검증값으로 쓸 수 있으나 이것은 기존 Min 값이나 측정된 최적값이 아니다.
4. 거절한 동일 요청이 같은 문서에서 즉시 UI를 다시 띄우지 못하게 한다. 거절과 무응답 만료는 내부 상태에서 구분한다.
5. 허용 직전에 현재 owner, WebContents, 문서 세대, 요청 origin을 재검사한다. 다른 창으로 이동한 요청은 취소하거나 새 소유자에게 명시적으로 이관하며 이전 창의 버튼은 무효화한다.
6. callback을 거절하고 끝낸 후에 UI에서 허용을 눌렀다고 이미 실패한 웹 Promise가 살아나는 것처럼 처리하지 않는다. 그 선택은 이후 요청에 적용된다. 현재 요청을 유지하는 UI와 앞으로의 사이트 설정을 구분한다.
7. 권한을 거절했다고 페이지 전체를 오류 화면으로 바꾸지 않는다. 복사 실패나 알림 거절은 사이트가 처리할 수 있는 결과다.

### 5.4 마이크 허용이 카메라 허용이 되지 않게

현재 `origin|media` 하나로 grant를 기억하는 구현은 바꿔야 한다. check의 `mediaType`과 request의 `mediaTypes`를 공통 capability 집합으로 정규화한다. 요청된 집합이 이미 허용된 집합의 부분집합일 때만 재사용한다. 마이크를 허용한 뒤 카메라를 요구하면 추가 요청이다.

종류가 unknown이거나 비어 있는 후속 check는 “media니까 모두 허용”으로 처리하지 않는다. 현재 Electron 버전에서 실제 호출 순서를 fixture로 기록하고, 동일 문서의 명시적 허용과 연결되는 좁은 규칙을 만든다. Min 코드에 있는 unknown 처리와 미디어 grant 병합 TODO도 참고하되 그대로 재현하지 않는다.

grant를 지운 것과 이미 시작된 MediaStream을 멈춘 것은 별개다. 첫 버전의 “권한 초기화”가 활성 통화의 강제 종료를 뜻한다고 표시하지 않는다. 사용 중인 캡처를 종료하는 기능을 제공하려면 실제 트랙 중지, OS 표시, 다시 요청하는 동작을 별도로 검증해야 한다.

### 5.5 작은 요청 UI도 네이티브 View 위에서 동작해야 한다

S01의 웹 페이지는 WebContentsView다. shell DOM에 높은 z-index의 popover를 추가하는 것만으로 그 위에 항상 표시된다고 가정할 수 없다. 초기 구현은 주소창 안의 요청 표시와 기존 native overlay 방식을 연결하거나, 내용이 웹 viewport와 겹치지 않는 작은 영역을 사용한다.

S10의 MenuOverlay는 이미 live 웹 페이지를 숨기지 않고 위에 표시된다. 그 소유자·세대·닫기 규칙을 참고할 수 있다. 다만 application-menu 명령 검증을 범용 IPC로 풀어서는 안 된다. 권한 응답 전용 메시지를 추가하고 원래 문서와 창에 결부한다. 메뉴를 여는 동안 비디오가 멈추거나 capturePage를 주기적으로 호출하게 만들면 이 작업의 목적과 어긋난다.

## 6. 비활성 탭과 창: 메모리 절약의 정확한 범위

### 6.1 처음 적용할 상태 모델

| 상태 | 의미 | 기본 동작 |
| --- | --- | --- |
| Dormant | 메타데이터만 있고 아직 방문하지 않은 복원 탭 | WebContents 생성·네트워크 시작 안 함 |
| Visible | 어떤 분할/창에서 실제로 표시 중 | 입력과 렌더링 유지 |
| HiddenLive | 방문했지만 현재 가려진 탭 | 페이지를 유지하고 네이티브 background 정책 사용 |
| Closing | 사용자 닫기 확인 중 | 새 명령을 제한하고 beforeunload 결과 대기 |
| Closed | 닫기 완료 | View, listener, pending 요청, overlay 참조 정리 |
| Failed | renderer 종료 등으로 정상 동작 불가 | 해당 탭에만 복구 경로 제공 |

Visible은 “전체 앱에서 선택된 탭 하나”를 뜻하지 않는다. 좌우 분할 둘 다 보이면 둘 다 Visible이다. 문서 편집기에 focus가 있어도 옆의 웹 영상은 보이는 페이지다. OS 창의 비활성, 최소화, 다른 창에 가림, Setdown 내부 탭 숨김을 같은 상태로 뭉개지 않는다.

이 모델은 Min의 `hasWebContents`와 현재 Setdown의 `dormant/views` 구분을 명확히 하는 것이지 새 브라우저 엔진을 만드는 작업이 아니다. 초기에 Freeze/Discard 상태를 넣어 실행 가능한 기능처럼 보이게 하지 않는다.

### 6.2 숨기면 무엇이 줄고 무엇이 남는가

hidden 상태에서 Chromium이 타이머와 애니메이션 작업량을 줄일 수 있도록 실제 View visibility를 전달한다. 하지만 JS heap, DOM, history, 사이트 상태를 유지하는 한 상당한 메모리는 남는다. “CPU를 덜 사용한다”와 “탭 메모리를 반환했다”는 다른 합격 기준이다.

[Electron WebPreferences 문서](https://www.electronjs.org/docs/latest/api/structures/web-preferences)는 backgroundThrottling의 기본값이 true이며, 같은 창의 일부 WebContents에서 false를 쓰면 창 전체의 프레임 처리에 영향을 줄 수 있다고 설명한다. S01의 일반 웹 View는 이 옵션을 끄지 않는다. S05의 Places만 false인데 그 View는 창에 붙이지 않는 별도 서비스다. 이 설정을 웹 View에 복사하지 않는다.

Min M22의 `disable-backgrounding-occluded-windows`는 과거 flicker 우회를 위한 플래그다. 현재 Setdown에 무조건 추가하면 절전 목표와 충돌할 수 있다. 창 가림 처리를 바꾸는 플래그가 필요한지는 현재 버전에서 재현한 문제와 비교 측정으로 결정한다.

### 6.3 지연 복원을 이미 있는 수준 이상으로 과장하지 않기

Setdown의 dormant 복원은 유지한다. “복원 탭이 100개면 처음부터 100개 사이트가 요청을 보내지 않는다”를 검증하면 된다. 반면 사용자가 새 배경 탭을 여는 경우에는 곧 볼 페이지를 미리 로드하기를 기대할 수 있다. 모든 배경 탭을 방문할 때까지 로드하지 않는 정책은 별도 동작 변경이므로 초기 작업에 섞지 않는다.

현재 디스크 저장은 URL과 제목 중심이다. 이것을 재시작 후 폼·JS heap·모든 웹 history 복원이라고 표현하지 않는다. 동일 실행 중 살아 있는 탭의 상태 보존과 프로세스 재시작 후 복구는 다른 계약이다.

S01의 restore는 손상된 JSON을 읽지 못하면 빈 배열로 처리한다. M08처럼 원본 파일을 백업하고 “복원에 실패했다”는 작은 안내를 남기는 보완은 가치가 있다. 읽기 실패 직후 빈 목록을 저장해 원본 증거를 덮어쓰지 않도록 한다.

### 6.4 닫힌 탭과 닫힌 창의 정리

탭을 숨길 때는 파괴하지 않고, 닫기를 완료할 때는 정확히 해제한다. 실제 WebContents뿐 아니라 권한 callback, 인증 요청, context menu, find 요청, popup 연결, 예약된 UI 업데이트도 탭 수명에 속한다.

S01의 `close()`는 `waitForBeforeUnload: true`를 사용한다. 이 동작을 유지한다. 반면 창 전체 종료에서는 S09가 문서 dirty 상태를 확인하고, S01의 창 `closed` 핸들러가 웹 contents를 닫는다. 이 경로만으로 “웹 탭의 beforeunload가 창 닫기를 막는다”는 보장은 성립하지 않는다. **창을 닫기 전에 모든 관련 웹 탭의 종료 허용을 조정하는 경로를 검증·보완해야 한다.**

여러 웹 탭과 수정된 Markdown이 섞여 있어도 하나를 거절하면 창이 남아야 한다. 허락을 구하는 도중에 일부 탭을 먼저 파괴해서, 마지막 거절 뒤 원래 작업 공간이 반쯤 사라지는 방식도 안 된다. 종료 조정은 기존 문서 확인 흐름과 합쳐야 하며, 원시 destroy를 호출해 “닫기 성공”을 만들지 않는다.

창 간 이동에서는 S01의 `adopt`처럼 같은 live View를 이동한다. 탭 ID만 넘겨 새 URL을 로드하는 접근은 폼과 popup opener를 잃는다. 지연 응답이 이동 전 창의 선택 상태를 바꾸지 못하도록 pending 요청도 같이 관리한다.

### 6.5 자동 탭 폐기는 이번 필수 목록에 넣지 않는다

Electron의 backgroundThrottling은 Chrome의 탭 Memory Saver와 같은 제품 기능이 아니다. 이 조사에서 찾은 Min 정책도 자동 폐기를 제공하는 근거가 아니다. 단순히 `destroy()`하고 URL을 기억하는 코드는 짧아도 사용자 상태를 보존하지 못한다.

특히 “오디오가 들리지 않는다”는 안전한 폐기 조건이 아니다. 음소거 영상, WebRTC, 업로드, 채팅 연결, 저장되지 않은 웹 폼, opener를 유지하는 로그인 팝업이 있을 수 있다. dirty 입력 감지만으로 사이트의 미저장 상태 전체를 판별할 수도 없다. 모든 사이트를 투명하게 직렬화하는 코드를 직접 만드는 것은 원래의 유지보수 최소화 목표와 충돌한다.

나중에 메모리 측정에서 필요성이 확인되면, 먼저 사용자가 선택하는 “이 페이지 메모리 해제” 같은 명시적 동작을 검토한다. 재방문 시 reload한다는 사실을 알려야 한다. 자동 정책은 보호 조건과 복원 지연이 실증된 범위에서 별도 결정한다. 새로고침을 숨겨서 기존 경험이 보존된 것처럼 만들지 않는다.

### 6.6 작게 시작할 성능 계측

별도 상시 대시보드를 만들 필요는 없다. 개발용 로그와 benchmark 산출물에 다음을 남긴다.

- 저장된 탭 수, live WebContents 수, 실제 보이는 View 수, 닫힌 뒤 남는 참조 수.
- 탭별 native visibility와 페이지의 visibilityState, rAF 증가량, timer 진행량, 네트워크 요청 수.
- Electron 전체 프로세스 트리의 메모리와 CPU. JS heap만으로 앱 메모리 절감을 주장하지 않는다.
- 첫 방문, 두 번째 전환, warm 전환의 지연. dormant에서 처음 여는 경우와 live 복귀를 분리한다.
- 반복 열기→숨김→복귀→닫기 후 안정 상태. renderer 공유와 Chromium 캐시 때문에 닫자마자 RSS가 시작값과 같아야 한다고 단정하지 않는다.

측정은 동일 버전·프로필·fixture·가상 display에서 baseline과 candidate를 비교한다. 일률적인 “30% 절감” 같은 목표 수치는 측정 전에 만들지 않는다.

## 7. 이미지 복사와 문맥 메뉴: 가장 작은 변경으로 큰 차이

### 7.1 이미지 자체와 이미지 주소는 다른 명령이다

M10의 핵심은 이미지 URL을 다시 받아서 변환하는 방식이 아니라, context-menu 이벤트의 좌표를 `copyImageAt(x, y)`에 전달하는 것이다. 현재 Electron 44.7.2 타입에도 이 API가 존재한다. [Electron API 설명](https://www.electronjs.org/docs/latest/api/web-contents#contentscopyimageatx-y)

Setdown의 S01 context-menu에는 링크 새 탭 열기, 기본 편집, Back/Forward/Reload, 외부 브라우저 열기만 있다. 다음 정도면 충분하다.

| 문맥 | 표시할 동작 | 구현 경로 |
| --- | --- | --- |
| 이미지 | 이미지 복사 | 원래 WebContents의 native copyImageAt |
| 주소가 있는 이미지 | 이미지 주소 복사 | srcURL을 텍스트로 복사 |
| HTTP(S) 이미지 | 새 탭에서 이미지 열기 | 기존 create/openLink |
| 저장 가능한 이미지 | 이미지 다른 이름으로 저장 | 원래 페이지의 downloadURL → 기존 DownloadItem |
| 링크 | 링크 주소 복사, 새 탭 열기, 링크 저장 | linkURL + 기존 탐색/다운로드 경로 |
| mailto 링크 | 이메일 주소 복사 | 주소 부분만 추출, subject/body와 구분 |
| 선택 텍스트 | 복사, 선택 문구 검색 | native copy + 기존 검색 URL 규칙 |
| 편집 가능한 입력 | 실행 취소/다시 실행/잘라내기/복사/붙여넣기/서식 없이 붙여넣기/전체 선택 | 해당 contents의 편집 명령 |

이 메뉴를 모든 위치에 한꺼번에 표시하지 않는다. 빈 페이지에는 이미지 항목이 없고, 복사할 이미지 데이터가 없으면 이미지 복사가 활성화되지 않는다. 실제 `mediaType`, `hasImageContents`, `editFlags`, `mediaFlags`를 기준으로 노출한다.

이미지 복사는 재다운로드가 아니므로 로그인 쿠키나 만료된 서명 URL을 별도로 다루지 않고 현재 표시된 픽셀을 활용할 수 있다. 다만 blob/data 이미지, cross-origin iframe, canvas는 종류별 실증이 필요하다. Min의 구현이 image만 처리한다고 해서 canvas까지 자동 지원한다고 쓰지 않는다. 영상 프레임 복사도 별도 명령이다.

사용자가 Setdown의 native 메뉴에서 선택한 복사와 웹사이트 JS의 클립보드 권한 요청은 별개다. 이미지 복사를 구현하기 위해 웹사이트 전체에 clipboard-read를 허용할 필요는 없다. 메뉴 명령은 신뢰된 main에서 원래 페이지를 대상으로 실행한다.

### 7.2 Setdown다운 사용 흐름

웹의 그림에서 “이미지 복사”를 선택하고 Markdown 편집기에 붙여넣는다. S11의 기존 `pasteImage`가 PNG를 문서 자산으로 저장하고 Markdown 링크를 만든다. 새로운 스크랩 패널이나 드래그 라이브러리를 만들 필요가 없다.

합격 기준은 메뉴가 뜨는 것에서 끝나지 않는다. 실제 클립보드에 image/png가 들어오고, 다른 텍스트를 덮어쓰지 않는 불필요한 중간 동작이 없으며, 붙여넣은 이미지의 내용·투명도와 저장 경로가 올바른지 확인한다. 이미지 주소 복사는 텍스트로 남아야 하며 픽셀 복사와 혼동하지 않도록 이름을 구분한다.

화면 캡처로 이미지를 복사하면 현재 줌과 배경·주변 픽셀이 섞일 수 있다. 페이지를 통째로 capturePage한 뒤 자르는 방식은 첫 선택지가 아니다. 네이티브 이미지 복사를 우선하고, 지원하지 않는 종류는 명확히 비활성화하거나 별도 처리한다.

### 7.3 메뉴를 연 순간의 대상을 유지한다

Min M10은 여러 클릭 handler에서 `tabs.getSelected()`를 다시 읽는다. Setdown은 분할 화면이 있으므로 이 패턴을 가져오면 안 된다. 오른쪽 웹 페이지에서 우클릭한 뒤 왼쪽 탭으로 focus가 이동했다고 해서 왼쪽에서 복사하거나 저장하면 안 된다.

메뉴를 만들 때 tabId, owner, WebContents, 문서 세대, source frame, 좌표를 캡처한다. 실행할 때 native 대상이 살아 있고 같은 문서인지 확인한다. context-menu의 `frame`은 뒤늦게 접근하면 없어질 수 있다. callback에서 프레임이나 소유자가 달라졌다면 그 명령을 취소한다. 이미 끝난 메뉴가 새 페이지에 실행되지 않게 한다.

좌표는 원래 이벤트의 웹 좌표를 해당 네이티브 API에 전달하는 경로부터 검증한다. shell의 group offset이나 앱 줌을 무조건 더하지 않는다. 메뉴를 화면 어디에 띄우는 좌표와 이미지 hit-test 좌표는 서로 다를 수 있다. app zoom, website zoom, OS scale, 스크롤, iframe을 조합한 테스트로 결정한다.

첫 구현은 main이 만드는 native Menu를 그대로 확장하면 된다. 이 기능 때문에 renderer로 이미지 바이트를 보내거나 모든 웹 메뉴를 Svelte로 다시 만들 필요가 없다. `browser:call-any-method` 같은 범용 IPC도 필요 없다.

### 7.4 저장은 같은 브라우저 세션을 사용한다

이미지/링크 저장은 S01에서 소유한 contents의 다운로드 경로를 사용한다. 별도 Node fetch를 추가하면 쿠키, 인증, redirect, referrer, 취소와 기존 다운로드 목록의 일관성을 다시 구현하게 된다.

첫 버전의 새 탭 열기는 현재 허용된 HTTP(S) URL에 제한한다. blob URL은 해당 문서와 세션의 수명에 묶이므로 일반 주소로 저장해 나중에 복원할 수 있다고 취급하지 않는다. data URL을 허용하려고 전체 주소 parser의 허용 범위를 넓히지도 않는다. 이미지 픽셀 복사가 가능한 것과 그 원본 URL의 새 탭 탐색이 가능한 것은 별개다.

HTTP(S)라도 원래 frame의 referrer 정책과 다운로드 서버 조건 때문에 저장이 달라질 수 있다. 현재 API의 다운로드 옵션과 실제 요청 헤더를 fixture에서 확인한다. 저장을 위해 페이지 전체의 CORS/CSP를 완화하는 구현은 제외한다.

### 7.5 편집 메뉴와 맞춤법

S01은 편집 가능한 곳에 기본 role 메뉴를 제공한다. 여기에 `pasteAndMatchStyle`, 전체 선택, editFlags 기반 enabled 상태를 채운다. 편집 명령은 원래 페이지의 selection과 focus를 대상으로 해야 한다. 문서 편집기가 뒤에 있다고 해서 Monaco에 붙여넣어서는 안 된다.

M10은 dictionarySuggestions 중 최대 3개와 사전 추가를 제공한다. Setdown도 Electron이 실제로 반환한 제안이 있을 때만 조용히 표시하면 된다. 설치된 사전과 OS에 따라 지원 언어가 다르므로 한글 맞춤법 엔진이 새로 생기는 것처럼 설명하지 않는다. 비밀번호 입력에는 선택 문구 검색이나 민감한 텍스트 미리보기를 넣지 않는다.

검색 문구는 URL로 안전하게 인코딩하고 기존 검색 제공자 규칙을 공유한다. 화면에 보일 메뉴 label은 길이를 제한하되 명령의 원문을 잘못 자르지 않는다. page title, link text, suggestion은 텍스트로 취급하며 HTML로 렌더링하지 않는다.

## 8. 팝업·외부 앱·탐색: 로그인과 링크가 자연스럽게 이어지게

### 8.1 실제 팝업 인계는 유지한다

M03의 `createWindow` 경로와 S01의 구현이 중요한 이유는 popup이 단순 URL이 아니기 때문이다. 빈 창에 내용을 쓰는 코드, form POST를 target에 보내는 코드, 부모와 postMessage로 통신하는 로그인 흐름이 존재한다.

S13은 about:blank popup에 제목·본문을 쓰고 opener identity를 검사한다. 이 기반을 유지하면서 POST body, referrer, noopener, 부모가 먼저 닫히는 경우, popup의 window.close까지 테스트를 넓힌다. Min의 “features가 없는 URL은 새 탭으로 재생성” 분기를 Setdown 전체 팝업에 적용하지 않는다. 그 구분만으로 POST나 opener 의미가 필요 없다고 판단할 수 없다.

또한 popup을 Setdown의 탭으로 표현한다고 해서 원래 창 열기 의미가 사라지는 것은 아니다. 사이트가 popup 크기 변경을 요청했다고 Setdown 전체 창을 임의로 바꾸지 않는다. 로그인 완료 후 닫히는 자식 탭 때문에 원래 문서가 닫히지 않아야 한다.

### 8.2 팝업 제한은 광고 필터를 다시 만드는 일이 아니다

Min은 M20의 ABP 기반 filterPopups를 호출한다. Setdown에는 이미 uBlock이 있다. Min의 필터 엔진과 필터 목록을 추가로 탑재하면 요청 처리의 소유자가 둘이 되고 예외 설정도 달라진다.

Setdown에 필요한 추가 정책은 한 페이지가 순식간에 많은 탭을 만들거나 계속 전경을 빼앗지 못하게 하는 것이다. 한도 초과는 조용한 blocked count와 수동 재시도 경로로 표현할 수 있다. 정확한 한도는 실제 로그인·결제·자료 열기 흐름을 검증해 정한다.

네이티브 window-open details의 disposition과 features를 사용자 동작의 완벽한 증거로 취급하지 않는다. 일반 요청 구조에 없는 userGesture 필드를 있는 것처럼 설계하지 않는다. 소유 페이지, 최근 명시적 명령, 실제 전달 정보로 판단할 수 있는 범위만 사용하고, 정상 popup을 복구 불가능하게 차단하지 않는다.

배경 열기는 제목이나 로드 완료 이벤트 때문에 나중에 전경으로 바뀌어서는 안 된다. Ctrl/Cmd+클릭·중클릭·Shift 조합은 OS별 실제 입력으로 확인한다. 테스트가 native disposition을 거치지 않고 바로 addTab만 호출하면 이 동작을 검증한 것이 아니다.

### 8.3 외부 앱 링크는 작고 제한된 요청으로

S01은 HTTP(S), mailto, tel만 외부 열기에 허용한다. 이 범위를 모든 OS 등록 protocol로 확대하는 일을 이번 개선에 섞지 않는다. 직접 선택한 “기본 브라우저로 열기”는 기존 동작을 유지한다.

M03에서 배울 것은 요청 횟수 제한과 redirect 경로를 함께 생각한 점이다. 같은 페이지가 반복 호출해 확인창을 쌓지 못하도록 문서·origin·목적지별로 합친다. 사용자가 취소하면 같은 탐색에서 즉시 재요청하지 않는다. 창이 닫히거나 다른 페이지로 바뀌면 이전 응답은 폐기한다.

현재 will-redirect는 비웹 URL을 차단한다. 향후 특정 외부 앱 protocol을 지원한다면 직접 클릭뿐 아니라 HTTP redirect를 통한 callback도 같은 검증 경로로 연결해야 한다. “모든 redirect를 shell.openExternal로 넘기기”는 해결책이 아니다.

### 8.4 Esc의 우선순위

현재 S01은 웹 페이지의 Esc에서 로딩이면 stop, 아니면 Reader 진입을 실행한다. 이 단축키는 기존 제품 경험이므로 유지하되, 더 가까운 작업이 Esc를 먼저 소비해야 한다.

제안 순서는 다음과 같다.

1. 한글 등 IME 조합 중이면 앱의 화면 전환을 실행하지 않는다.
2. Setdown이 연 권한 UI·검색·메뉴가 있으면 해당 UI부터 닫는다.
3. HTML fullscreen 또는 pointer lock이면 네이티브 해제를 우선한다.
4. 사이트의 입력·dialog 문맥에서 Esc를 처리해야 하는 경우를 확인한다.
5. 페이지 로딩을 중지한다.
6. 앞 단계가 처리하지 않은 기존 웹 방문 문맥에서 Reader로 전환한다.

네이티브 before-input-event는 사이트 DOM handler보다 먼저 올 수 있다. “defaultPrevented를 보면 된다”로 해결하지 않는다. main이 알고 있는 fullscreen/overlay/IME 상태를 먼저 사용하고, DOM 문맥 확인이 필요한 부분은 격리된 preload에서 제한된 상태만 전달한다. 모든 키 입력이나 선택 텍스트를 상시 main으로 보내는 구조는 피한다.

사이트의 모든 custom modal을 완벽하게 알아내는 것은 일반화하기 어렵다. 지원할 문맥과 알려진 예외를 테스트로 한정하고, Reader 전환이 사이트 기본 입력을 삼키는 재현이 있으면 단축키 정책을 재검토한다. 이번 문서에서 해결된 것으로 표시하지 않는다.

### 8.5 찾기·새로고침·뒤로 가기

M13은 검색을 시작한 탭을 기억하고 탐색이나 숨김 때 정리한다. Setdown도 findId로 탭을 구분하지만, 같은 탭에서 새 검색이 시작된 뒤 이전 found-in-page 결과가 오면 requestId를 구분하지 않는다. requestId와 문서 세대를 함께 보관해 오래된 결과가 숫자 표시를 덮지 못하게 한다.

검색을 닫을 때 기존 페이지로 focus를 돌리는 동작과, 다른 탭을 클릭해서 검색이 숨겨질 때 그 탭의 focus를 뺏지 않는 동작을 구분한다. 검색 입력의 composition 중 Enter가 다음 결과로 이동하지 않도록 한다. 현재 주소 입력의 IME 처리는 이미 있으므로 이를 훼손하지 않는다.

M14의 reloadIgnoringCache는 작은 메뉴/단축키 추가로 가져올 수 있다. 쿠키·로그인·사이트 저장소 삭제와는 별개다. 기존 일반 새로고침과 강력 새로고침 모두 protection 준비 경로, crash 복구, 현재 탐색 generation을 존중해야 한다.

S12의 파일↔웹 통합 history는 Min의 웹 전용 back 처리를 그대로 넣으면 깨질 수 있다. 모든 탐색 버튼과 명령을 기존 tab journal로 보낸다. Min의 내부 Reader/error 페이지를 두 칸 건너뛰는 규칙을 그대로 추가하지 않는다. Setdown의 Reader는 원래 live 페이지를 남겨 두는 구조이기 때문이다.

M22의 mouse back/forward는 Windows에서만 별도로 연결하고 Linux 중복 처리를 피한다. Setdown도 지원 OS에서 실제 mouse back/forward가 한 번만 동작하는지 확인한다. 가로 스크롤을 뒤로 가기로 바꾸는 M16의 제스처 엔진은 초기 필수 도입에서 제외한다. 표나 코드 블록을 가로로 스크롤하다 탐색이 바뀌면 손해가 더 크다.

### 8.6 실수로 닫은 페이지 복구

Min M29는 비공개/빈 탭을 제외하고 최근 10개를 저장한다. Setdown에도 메뉴와 Ctrl/Cmd+Shift+T 같은 익숙한 접근점으로 웹 탭 복원을 제공할 가치가 있다. 큰 새 패널이 필요하지 않다.

닫기를 허용하고 실제로 닫힌 뒤에만 stack에 넣는다. URL·제목·필요한 navigation metadata를 제한된 개수로 저장하되, 원래 WebContents를 숨겨서 계속 유지하지 않는다. 취소한 닫기, 내부 확장 페이지, about:blank, 파일↔웹 전환 중간 단계는 잘못된 “닫은 웹 탭”으로 기록하지 않는다.

이 기능은 페이지 재방문이지 미저장 웹 상태의 완전 복원 약속이 아니다. history pageState를 사용할 경우에도 용량·직렬화 범위·민감한 폼 정보의 보관 위치를 따로 검토한다. 처음에는 메모리 내 제한된 metadata stack으로 범위를 좁힌다.

## 9. 오류·다운로드·데이터 복구의 디테일

### 9.1 오류를 작은 복구 경로로 바꾼다

M19는 DNS, offline, TLS, renderer crash를 구분한다. Setdown은 main-frame did-fail-load와 render-process-gone을 받으며, ERR_ABORTED를 오류로 보여 주지 않는 처리가 이미 있다. 이 점은 유지한다.

필요한 보완은 실패한 원래 URL, 원인 분류, 다시 시도 가능 여부를 직렬화 가능한 상태로 남기는 것이다. 오류 화면을 별도 URL로 navigate하여 history를 오염시키지 않는다. TLS 실패, 오프라인, 주소 없음, protection 준비 실패를 모두 같은 “Reload”로만 설명하지 않는다.

Min의 SSL 오류 일부에서 https를 http로 바꿔 재시도하는 코드는 가져오지 않는다. 실패한 보안 연결을 조용히 낮추는 것은 방문 경험 개선이 아니다. 현재 Setdown의 검증을 유지하고 원래 URL로 다시 시도하게 한다.

M19의 online 이벤트 재시도는 주의해서 적용한다. 네트워크가 돌아왔다고 모든 실패 탭을 동시에 다시 열지 않는다. 첫 버전은 재시도 버튼으로 충분하다. 자동 복구를 추가한다면 현재 표시 중인 실패한 안전한 탐색만 대상으로 하고, POST 재전송·결제·이미 사용자가 다른 곳으로 이동한 경우를 제외할 수 있어야 한다.

renderer가 멈춘 탭 때문에 전체 앱을 다시 시작하지 않도록 해당 탭에 실패 상태를 표시한다. unresponsive 처리에 강제 kill을 추가한다면 다른 탭이 같은 프로세스를 공유하는 영향도 검토한다. 자동 reload 반복으로 문제를 숨기지 않는다.

### 9.2 HTTP 인증은 비밀번호 관리자와 분리한다

M03은 login 이벤트의 Basic 인증을 작은 입력창으로 처리한다. 회사 내부 문서나 개발 서버 방문에 필요한 기능이다. Setdown의 HTTP 인증 handler는 origin/host/realm과 proxy 여부를 사용자가 이해할 수 있게 표현하고, 해당 요청에만 자격 증명을 전달한다.

첫 버전은 자체 비밀번호 저장소를 만들지 않는다. 취소·탭 종료·탐색·timeout에서 callback을 끝내고, 동시에 요청한 다른 창의 인증값과 섞지 않는다. M23처럼 전역 promptAnswer/promptOptions 하나를 공유하는 구조는 가져오지 않는다.

Basic만 처리한다면 지원 범위를 명확히 한다. 다른 scheme을 Basic으로 오인해 응답하지 않는다. proxy 인증은 방문 사이트와 요청 주체가 다르므로 이름을 분리한다. 인증 정보나 URL의 민감한 query를 일반 진단 로그에 기록하지 않는다.

### 9.3 다운로드 관리자는 이미 있으므로 그대로 연결한다

Setdown의 다운로드 구현은 이번 비교에서 유지할 자산이다. 고유 ID, pause/resume/cancel, 알 수 없는 total의 진행 표시, 재시작 후 interrupted 상태, 완료 파일 열기, 기록만 지우기는 이미 존재한다. [S04, S14]

이미지/링크 저장을 붙일 때 별도 다운로드 bar를 추가하지 않는다. Min M17의 하단 40px bar를 옮기면 웹·문서 viewport가 바뀐다. 기존 Browser Downloads에 기록과 진행 상태를 연결한다.

다운로드 완료는 곧 “지금 이 문서를 읽겠다”는 의도가 아니다. S01은 MIME이 PDF이면 완료 시 openFile을 호출한다. 문서 작성 중 배경 다운로드가 끝났다는 이유로 새 탭이 선택되는지 검증하고, “다운로드”와 “Setdown에서 열기”의 사용자 의도를 구분한다.

출발한 페이지를 닫은 뒤에도 진행 중인 다운로드를 어떻게 처리할지 명세해야 한다. 탭 close와 다운로드 cancel을 자동으로 같은 동작으로 묶지 않는다. 반대로 앱 종료 시 현재 전송을 백그라운드에서 계속한다고 약속하지 않는다. 기존 재시작 후 interrupted 표시는 정직하게 유지한다.

같은 파일 이름의 동시 다운로드, 저장창 취소, 알 수 없는 길이, 서버 중단, 리다이렉트, 파일이 디스크에서 삭제된 뒤 열기를 확인한다. Min의 경로-keyed map이나 완료 시 received=total을 가정하는 방식을 현재 코드에 덮어쓰지 않는다.

### 9.4 사이트 복구는 전체 기록 삭제와 분리한다

로그인 상태가 꼬였을 때 “이 사이트 데이터 초기화”는 작은 메뉴로 제공할 수 있다. 하지만 M18의 전체 저장소 정리를 그대로 호출하면 다른 사이트의 로그인과 동작까지 바뀐다.

현재 URL의 origin을 main에서 파싱하고, 관련 쿠키·storage의 정확한 범위를 보여 준 뒤 초기화한다. 쿠키는 domain/path로 공유될 수 있고 storage는 origin/partition 규칙이 있으므로 “이 탭만 초기화”라고 부정확하게 표현하지 않는다. 같은 사이트를 연 다른 탭에 영향이 있을 수 있음을 해당 작업 UI에서 짧게 알린다.

브라우저 session과 Places, extension, Markdown preview session을 구별한다. 초기화가 북마크나 uBlock 설정을 지우면 실패다. reset과 reload 사이에 같은 origin의 다른 탭이 데이터를 다시 만들 수 있는 경우도 테스트한다.

히스토리 삭제는 이미 북마크와 쿠키를 보존한다. 사이트 데이터 초기화가 이 기능을 대체하지 않는다. 단순히 메모리를 줄이려고 clearCache/clearStorageData를 주기적으로 실행하는 정책은 도입하지 않는다.

### 9.5 기록 저장과 UI 이벤트도 작은 비용으로 유지한다

M24는 즉시 떠난 페이지를 기록하지 않기 위한 500ms 지연, 과도하게 긴/data URL 제외, 내부 페이지 제외를 구현한다. S05에는 이미 42일 보존과 북마크 예외가 있다. 그대로 보존하면서 실패한 페이지나 내부 확장 페이지가 실제 방문 기록에 섞이지 않는지 확인한다.

현재 S01은 did-finish-load에서 방문을 기록하고 URL/title 업데이트를 shell에 보낸다. SPA 탐색에서 주소와 기록의 의미가 맞는지 확인할 가치가 있다. M25처럼 모든 history API를 monkey-patch하고 매번 본문 전체를 추출하는 방식은 필요하지 않다. native navigation 이벤트로 해결 가능한 범위부터 사용한다.

S02는 page 이벤트가 올 때 tab chrome을 갱신하고 layout을 강제로 동기화한다. 잦은 title/audio/loading 이벤트가 실제로 바뀐 상태인지 비교하여 불필요한 IPC·layout을 줄일 여지가 있다. 다만 bounds·visibility·focus 갱신을 title 갱신과 함께 무턱대고 debounce하면 첫 표시와 클릭 타이밍이 달라질 수 있다. 상태 표시 합치기와 반드시 즉시 적용할 presentation을 구분한다.

## 10. Min에서 그대로 가져오지 않을 구현

이 표는 Min을 낮게 평가하기 위한 것이 아니다. 다른 제품의 역사적 선택을 현재 Setdown의 요구로 오해하지 않기 위한 제외 목록이다.

| Min의 구현 / 관련 근거 | Setdown 판단 |
| --- | --- |
| 5분 30초 뒤 탭 fade, 7.5초 주기 갱신 [M07] | 메모리 절약으로 소개하지 않는다. 기존 탭 디자인 변경도 필수 아님 |
| 15초마다 선택 페이지 capture [M04] | 주기 캡처를 추가하지 않는다. 필요할 때만 기존 overlay 캡처 사용 |
| hostname 기반 권한 공유 [M01] | origin·profile·문서 수명을 구분 |
| 권한 승인 버튼을 다시 누르면 reload [M02] | 미저장 폼을 잃는 부작용이 있으므로 명시적 의미 없이 사용하지 않음 |
| renderer에서 임의 WebContents 메서드 호출 [M03/M04] | 현재의 제한된 BrowserApi 유지 |
| 탭 닫기에 native destroy 사용 [M03/M05] | Setdown의 beforeunload 확인을 우회하지 않음 |
| 요청된 popup을 features 유무만으로 URL 탭으로 재생성 [M03] | 실제 contents 인계 유지 |
| window.close/window.open/chrome 객체 사이트별 패치 [M21] | 현재 버전 재현 없는 패치 금지, 기존 확장 API와 충돌 방지 |
| Google 대상 Firefox UA 추정, 전역 client hints 변경 [M21] | 자동 이식 제외. 특정 사이트 재현과 native request 소유권 검토 필요 |
| sslError 재시도의 HTTP 전환 [M19] | 제외 |
| PDF/Reader를 위한 응답 CORS 헤더 변경 [M17/M30] | 전체 웹 session 정책으로 복사하지 않음 |
| ABP 파서와 자체 필터 엔진 추가 [M20] | 기존 uBlock 유지 |
| 모든 요청의 추적 매개변수 제거 [M20] | 서명 URL/로그인/다운로드를 깨뜨릴 수 있어 기본 도입 제외 |
| pushState 패치와 상시 본문 추출 [M25] | 방문 기록 때문에 전체 페이지를 계속 스캔하지 않음 |
| 사이트 favicon/theme-color로 shell 색상 변경 [M28] | Setdown의 테마와 대비 유지 |
| 가로 휠 이벤트 전체 IPC + 자체 swipe 판단 [M11/M16] | 기존 휠 줌 유지, 뒤로 가기 제스처는 조건부 |
| 별도 다운로드 하단 bar [M17] | 기존 sidebar 사용 |
| Reader 진입/해제 시 페이지 navigate [M26] | Setdown의 live 페이지 보존 유지 |
| Min 태스크/번역/비밀번호·새 탭 홈 전체 | 이번 범위 밖 |

특히 네트워크 hook의 소유권은 작게 보이지만 중요하다. Electron WebRequest는 같은 이벤트에 마지막으로 붙인 listener만 사용하는 특성이 있다. Min의 UA/PDF/filter hook을 각각 덧붙여 기존 uBlock 경로를 덮어쓰면 기능이 조용히 사라질 수 있다. [Electron WebRequest 문서](https://www.electronjs.org/docs/latest/api/web-request#class-webrequest)

S06은 이미 응답 헤더 filtering을 보존하는 호환 패치를 갖고 있다. 새로운 요청 처리가 꼭 필요하다면 기존 listener의 소유자와 합성 가능성을 먼저 확인한다. “짧은 hook 하나”를 이유로 필터링 계약을 깨지 않는다.

## 11. 구현 위치와 작업 순서

### 11.1 작은 모듈 경계

새 플랫폼이나 브라우저 프레임워크를 추가하지 않는다. BrowserManager는 session·View 소유와 네이티브 이벤트 연결을 유지하고, 커지는 정책만 분리한다. 아래 이름은 새로 만들 후보이며 현재 존재하는 파일이라고 오해하지 않는다.

| 후보 / 기존 파일 | 맡을 일 | 맡기지 않을 일 |
| --- | --- | --- |
| 신규 `main/browser/browser-permissions.ts` | request/check 공통 정책, callback 수명, grant, 유한 큐 | 디자인 전체, 웹 문서 조작 |
| 신규 `main/browser/browser-context-menu.ts` | native params에서 메뉴 생성, 대상 재검증, copy/save 명령 | 별도 이미지 다운로더 |
| 신규 `main/browser/browser-prompts.ts` 또는 작은 기존 분리 | HTTP auth·외부 앱 요청의 소유권과 종료 | 범용 임의 입력 실행기 |
| 기존 S01 | 탭 identity, 문서 세대, native visibility, close/adopt | 모든 UI 상태를 한 클래스에 추가 |
| 기존 S03과 필요한 작은 컴포넌트 | 요청 표시, 음소거 접근점, 키보드 조작 | 주소창 재디자인 |
| 기존 S08 | 구체적인 permission reply/find request 상태 타입 | 임의 메서드 호출 RPC |
| 기존 S04·S11 | 다운로드와 Markdown 자산 저장 | 중복 저장 파이프라인 |

권한 응답은 ownerId를 renderer가 임의로 지정하는 형식으로 만들지 않는다. S09의 WindowIpc가 얻은 실제 sender의 창과 main의 request owner를 비교한다. requestId만 맞으면 다른 창에서 승인할 수 있는 구조를 피한다.

화면의 표시 상태와 사용자 명령 대상은 다를 수 있다. 기존 group owner를 재사용한다. “마지막으로 선택한 전역 web tab”을 새로 만들면 분할·창 이동·배경 popup에서 기존 구조와 충돌한다.

### 11.2 단계별로 완료할 결과

| 단계 | 결과 | 주요 항목 | 완료 판단 |
| --- | --- | --- | --- |
| A | 권한 요청의 정확성 | P02–P05, P08, L05 | 중복·탐색·종료·다른 창 승인·media 확대가 정확히 처리됨 |
| B | 조용한 권한 표시 | P01, P06, U03/U07 | 페이지가 모달을 쌓지 못하고 사용자 작업·영상이 유지됨 |
| C | 자료 가져오기 | C01–C08 | 웹 이미지 → clipboard → Markdown 자산까지 실제 동작 |
| D | 방문 중 걸리는 부분 | N01–N07, P07/P10, D01/D02, U01 | 로그인 popup·Esc·find·실패 복구가 기존 작업과 충돌하지 않음 |
| E | 자원과 복원 | L01–L07, N08, D03–D06 | 지연 생성·닫기 정리·복원·다운로드 완료가 검증됨 |
| F | 필요성 확인 후 선택 | L08, C09, swipe·추가 장치 권한 | 성능/사용 사례 근거가 있을 때만 별도 결정 |

가장 먼저 작은 사용자 체감을 내고 싶다면 C의 이미지 복사부터 독립적으로 구현할 수 있다. 다만 권한 UI를 예쁘게 바꾸는 작업은 A를 건너뛰지 않는다. 모달을 작은 popover로만 바꾸고 기존 grant 오류를 유지하면 완료가 아니다.

창 전체 닫기 조정은 별도 난도가 있다. `WebContents.close()`를 순서대로 호출하면 일부 contents는 확인 전에 파괴될 수 있고, 그것은 취소 가능한 사전 검사 API가 아니다. 따라서 여러 탭 종료를 원자적으로 되돌릴 수 있다고 가정하지 않는다. native beforeunload의 실제 순서를 검증하고 기존 문서 close 흐름과 결합한 정책을 결정해야 한다. 무조건 destroy하거나, DOM에 합성 beforeunload 이벤트를 보내는 것으로 네이티브 확인을 완전히 대체했다고 처리하지 않는다.

## 12. 검증 명세

### 12.1 테스트 환경과 현재 상태

이 문서는 조사 시점의 산출물이다. 조사 단계에서는 제품 코드를 수정하거나 GUI·unit suite를 실행하지 않았고 S13–S15를 읽어 기존 보장과 추가할 검사를 구분했다. 후속 구현의 실행 결과는 [구현 보고서](../reports/2026_10_14_min_browser_details_implementation.md)를 참조한다.

실제 구현 시 모든 GUI 테스트는 [with-isolated-display.sh](../apps/desktop/scripts/with-isolated-display.sh)를 사용한다. Xvfb뿐 아니라 Wayland socket, runtime directory, D-Bus도 분리한다. 클립보드 검사는 그 가상 display의 클립보드에만 접근한다. 사용자 바탕화면에 테스트 창이나 인증창을 띄우지 않는다.

외부 뉴스/로그인 사이트 대신 loopback HTTP(S) fixture, 두 origin, iframe, POST 수신 서버, test 이미지, streaming 다운로드를 사용한다. 권한 테스트에서 fake media device는 가능하지만 자동 승인 플래그로 실제 request/deny 경로를 건너뛰지 않는다. Linux에서 통과한 것을 Windows에서 검증했다고 쓰지 않는다.

### 12.2 추가해야 할 핵심 시나리오

| 그룹 | 실제로 재현할 상황 | 합격 조건 |
| --- | --- | --- |
| 권한 반복 | 같은 문서에서 알림 요청 20회 | 모달 20개가 생기지 않음, 대기 상한, 모든 callback 종료 |
| 권한 거절 | 거절 직후 재요청 | 전경·focus를 빼앗지 않음, 같은 문서에서 반복 표시 안 함 |
| 권한 경쟁 | 요청 뒤 다른 URL로 탐색하거나 동일 URL reload | 이전 허용 버튼이 새 문서에 grant를 만들지 않음 |
| 권한 소유 | 요청 중 탭을 다른 창으로 이동 | 이전 창의 승인이 거절되거나 올바르게 이관됨 |
| origin 경계 | 같은 host의 다른 port, http/https, 교차 출처 iframe | grant가 잘못 공유되지 않음 |
| media | audio 허용 후 video, audio+video, unknown check | 허용 범위가 의도 없이 넓어지지 않음 |
| 알림 조회 | WebContents가 없는 check와 명시적 사이트 grant | null에서 crash/자동 승인 없음, session 정책과 일치 |
| 요청 종료 | 탭 종료·창 종료·시간 만료와 허용 클릭 경쟁 | callback 정확히 한 번, 큐와 listener 누수 없음 |
| 조용한 UI | 한쪽은 영상, 다른 쪽은 Markdown 한글 입력 | 요청 도착으로 IME·selection·영상 진행·viewport가 변하지 않음 |
| 이미지 복사 | 일반 PNG, 투명 PNG, 인증 이미지, blob/data, iframe | 지원한 유형에서 실제 bitmap이 clipboard에 들어옴 |
| 이미지 붙여넣기 | 웹 이미지 복사 후 문서 붙여넣기 | PNG 자산과 Markdown 링크 생성, 원본 내용 확인 |
| 메뉴 대상 | 오른쪽 우클릭 후 focus 변경/탐색/탭 이동 | 원래 유효한 대상에만 실행, stale 대상은 취소 |
| 좌표 | 앱 줌·웹 줌·OS scale·스크롤·iframe 조합 | 다른 이미지나 화면 위치가 복사되지 않음 |
| 편집 | contenteditable, 일반 input, 비밀번호, 서식 있는 clipboard | enabled 상태 정확, pasteAndMatchStyle, 원래 frame selection 유지 |
| popup | about:blank 문서 쓰기, POST, noopener, postMessage, close | opener/body/referrer 의미 보존, 부모 문서 유지 |
| 배경 열기 | Ctrl/Cmd+클릭·중클릭·연속 팝업 | 정상 배경 로드, 갑작스런 선택 이동/무제한 생성 없음 |
| 외부 앱 | 같은 링크 반복, redirect, 취소 후 재요청 | 요청 합치기, allowlist 보존, 실제 외부 앱 실행은 테스트 stub으로 제한 |
| Esc | IME, 검색, fullscreen, pointer lock, 로딩, 일반 Reader | 가까운 동작만 해제, 두 개의 동작이 연속 실행되지 않음 |
| 찾기 | 입력을 빠르게 변경하고 같은 탭에서 탐색 | 이전 requestId 결과가 새 검색 표시를 덮지 않음 |
| 종료 | 수정된 웹 폼과 Markdown, 여러 창/분할 | 취소가 실제 작업을 보존, 강제 destroy로 우회하지 않음 |
| 지연 복원 | 저장된 100개 URL, 두 개만 실제 활성화 | 방문하지 않은 페이지의 요청/View 생성 없음 |
| hidden | live 웹 탭 전환·최소화·분할의 비포커스 탭 | native/page visibility 일치, 보이는 분할을 절전 처리하지 않음 |
| 자원 정리 | 반복 열기·숨김·복귀·닫기 | live identity 보존, 종료 후 pending와 owned View 누적 없음 |
| 다운로드 | 동일 경로, 미상 크기, 중단, 재시작, 배경 PDF 완료 | 상태·파일 보존, 완료가 현재 편집 focus를 빼앗지 않음 |
| 오류 | DNS/offline/TLS/renderer 종료/ERR_ABORTED | 원인과 재시도 대상 정확, HTTPS downgrade·재시도 폭주 없음 |
| 데이터 초기화 | 같은 사이트의 여러 탭과 별도 origin | 설명한 범위만 초기화, 북마크·uBlock·문서 상태 보존 |
| 기록 복원 | 손상 JSON, 마지막 저장과 종료 경쟁 | 원본 백업, 빈 데이터로 조용히 덮어쓰지 않음 |

순수 정책 테스트는 callback 중복 완료, grant 집합, owner/generation 검증처럼 실제 결함을 잡는 데 사용한다. 메서드 이름을 호출했는지만 확인하는 mock 테스트로 native visibility나 clipboard 동작을 증명하지 않는다.

웹 context menu는 Svelte DOM 메뉴가 아닐 수 있다. 테스트는 실제 우클릭으로 Electron이 만든 params를 얻고, 필요하면 제한된 test harness로 그 메뉴의 실제 callback을 실행한다. 임의로 만든 params만으로 이미지 복사를 통과 처리하지 않는다. 이미지 테스트는 clipboard 결과 또는 최종 PNG의 픽셀을 확인한다.

### 12.3 기존 보장을 다시 통과해야 하는 범위

S15는 “기존 외관이 비슷하다”보다 강한 보장을 갖고 있다. 웹/Markdown 분할, native bounds, app와 tab zoom, Reader 전환, 메뉴 overlay, focus/IME가 연결되어 있으므로 관련 구현을 바꾸면 기존 계약 검사를 수행한다.

```bash
npm run test:preview-contract
```

presentation, visibility, native bounds/zoom, source↔reader, preparation 같은 성능 경로를 변경하면 동일 설정의 baseline을 준비해서 비교한다.

```bash
npm run bench:preview -- --baseline /absolute/path/to/installed-baseline
```

ordinary Markdown/Git review, 수정 유무, preparation 포함/제외, first/second/warm을 나눠 보고한다. 여기에 웹 탭의 cold/live 복귀·CPU·메모리 측정을 추가할 수 있지만 기존 48개 지연 비교를 대체하지 않는다. 새 기준으로 기존 성능 실패를 숨기지 않는다.

이미 존재하는 S13의 live video 메뉴, 웹 상태·분할, popup opener, 웹 줌, 창 이동 ownership, 파일↔웹 history, Reader 복귀 검사를 유지한다. 이 문서에 새 검사가 적혔다고 테스트가 구현된 상태는 아니다.

## 13. 이번 조사로 확정할 적용 기준

Setdown은 **기존 화면을 유지하면서 Electron의 작은 연결부를 완성하는 방향**으로 진행한다. Min을 통째로 이식하지 않는다. 단순히 코드를 짧게 만드는 것보다 소유해야 할 동작의 범위를 작게 유지한다.

필수 결과는 다음과 같다.

- 사이트의 알림·권한 요청이 사용자의 작업을 가로막거나 잘못된 문서에 허용되지 않는다.
- 이미지·링크·선택 텍스트를 복사하고 저장하는 기본 동작이 문맥에 맞게 제공된다.
- 방문하지 않은 복원 탭은 지연 생성하고, 숨겨진 live 탭은 상태를 보존하며, 닫힌 자원은 정리한다.
- popup·외부 앱·검색·Esc·오류·다운로드의 작은 동작이 기존 문서 작업과 충돌하지 않는다.
- 화면·focus·한글 입력·분할·줌·전환 성능의 기존 보장을 유지한다.

이 기준을 만족시키는 데 CEF가 필요하다는 근거는 이번 조사에서 나오지 않았다. 자동 메모리 회수나 완전한 브라우저 기능을 먼저 약속하기보다, 이미지 한 장을 자연스럽게 복사하고 불필요한 Allow notifications 창 하나를 없애는 작업부터 완성한다.
