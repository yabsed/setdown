# Setdown의 Chrome 확장 지원 강화 전략

작성: 2026-10-16 · 분석 기준: `a14c44007715cb1ff810458aff9c74cee7d00bd8`

대상: Surfshark와 ChatGPT 대화를 PDF·Markdown 등으로 내보내는 확장. 특정 내보내기 확장 이름이 지정되지는 않았으므로, 실제 스토어의 **ChatGPT Exporter**를 대표 사례로 조사했다. 아래 본문은 구현 전 분석 기록이다. 승인 후 구현 내용과 현재 제한은 [확장 런타임 문서](../docs/browser-extension-runtime.md)를 기준으로 한다.

## 후속 검증 정정

초기 진단은 Playwright의 Linux 기본값(`--no-sandbox`)으로 실행됐다. 이 조건에서는 Electron의 service-worker preload가 실행되지 않아 워커 `windowId=0`과 일부 API `undefined`가 관측됐다. 제품과 같은 `chromiumSandbox: true`로 변경 전 코드를 재검증하면 워커 호환 계층은 실행되고 창 ID도 팝업과 일치한다. 따라서 아래의 “창 ID 차이”는 제품 전체의 결함으로 일반화할 수 없다. 다만 워커에 Setdown 자체 패치가 없는 문제(`browser !== chrome`, native header event 차이), 빈 downloads/privacy 구현 및 실제 프록시 미적용은 재확인됐다. [sandbox 활성화 재검증 원본](chrome-extension-audit-2026-10-16/baseline-sandbox-on.json)

승인 후 구현에서는 프레임·워커를 같은 패치 소스로 빌드하고 GUI 테스트의 sandbox 기본값을 제품과 맞췄다. 아래 표는 초기 관측 기록으로 남긴다.

## 1. 제안하는 방향

**현재 Electron 구조와 확장 라이브러리를 유지하면서, 확장이 기대하는 브라우저 동작을 Setdown에 연결하는 계층을 먼저 완성하는 것이 가장 낫다.** 우선 ChatGPT 내보내기를 실제 사용 가능한 첫 목표로 삼고, Surfshark는 프록시·인증·개인정보 설정을 검증하는 별도의 단계로 진행한다.

설치 경로를 새로 만드는 일이 핵심은 아니다. 현재도 스토어 링크, CRX·ZIP, 폴더 설치, 수동 업데이트, 재시작 복원, 활성화·비활성화가 있다. 부족한 것은 **설치된 확장이 올바른 탭을 대상으로 실행되고, 필요한 API가 실제 효과를 내며, 실패를 정확히 알리는 것**이다.

이번 분석의 핵심 결과는 다음과 같다.

| 확인한 사실 | 전략에 주는 의미 |
| --- | --- |
| 일반 확장 팝업을 새 웹 탭으로 열어, 팝업 자신이 활성 탭이 된다 | ChatGPT Exporter의 페이지 선택·메시지 전달부터 고쳐야 한다 |
| MV3 워커는 실행되지만 팝업과 API 보정 상태·창 ID가 다르다 | MV3 지원을 로딩 여부로 판정하면 안 된다 |
| `chrome.downloads.download()`는 성공처럼 끝나지만 다운로드하지 않는다 | 존재 여부 검사 대신 결과·이벤트·오류 의미를 검증해야 한다 |
| 대표 ChatGPT Exporter는 Markdown 저장에 Blob과 `<a download>`를 사용한다 | 범용 downloads API 전체 구현보다 빠른 실사용 개선 경로가 있다 |
| `chrome.proxy.settings.set()` 콜백 뒤에도 실제 프록시는 `DIRECT`였다 | Surfshark를 현재 지원한다고 표시할 수 없다 |
| 같은 환경에서 `session.setProxy()`는 실제 로컬 프록시를 통과했다 | Electron 엔진 교체 전에 설정 연결 계층을 검증할 가치가 있다 |
| 선택 권한 요청이 자동 승인되고, 해제 후에도 `contains()`가 참이다 | 호환성 확대와 함께 권한의 실제 의미를 정리해야 한다 |

문서·코드·이미지와 웹을 함께 다루는 Setdown에서 모든 Chrome API를 한 번에 재구현하는 전략은 유지보수 범위가 너무 넓다. **확장 이름·버전·사용 시나리오별 지원 범위를 명시하고, 공통 기반을 단계적으로 넓히는 전략**을 권한다. Electron도 임의의 스토어 확장과 완전한 호환성을 목표로 하지 않는다고 명시한다. 다만 공식 목록 밖의 API가 현재 버전에서 일부 작동할 수 있으므로, 문서에 없다는 이유만으로 미지원이라고 단정해서도 안 된다. [Electron 확장 지원 문서](https://www.electronjs.org/docs/latest/api/extensions)

## 2. 분석 방법과 검증 범위

코드만 읽고 가능성을 추정하는 데서 멈추지 않고, 설치된 라이브러리 구현과 실제 Electron 실행을 대조했다.

| 항목 | 기준 |
| --- | --- |
| Electron / Chromium | `44.7.2` / `152.0.7977.149` — 설치된 실행 파일에서 확인 |
| 확장 호환 계층 | `electron-chrome-extensions@4.9.0` |
| 스토어 패키지 처리 | `electron-chrome-web-store@0.13.0` |
| 실제 패키지 조사 | Google의 공개 CRX 배포 주소에서 다운로드 후 manifest·번들 정적 분석 |
| 실행 검증 | 직접 작성한 MV2·MV3 진단 확장, 로컬 HTTP 서버·로컬 프록시, 임시 프로필 |
| GUI 격리 | 저장소의 `with-isolated-display.sh`로 Xvfb·runtime directory·D-Bus 격리 |
| 계정 사용 | 실제 Surfshark 로그인·연결, 실제 ChatGPT 대화 내보내기는 수행하지 않음 |

관측값과 패키지 해시는 [검증 자료](chrome-extension-audit-2026-10-16/evidence.json)에, 재현 코드는 [진단 스크립트](chrome-extension-audit-2026-10-16/probe.mjs)에 남겼다. 실제 두 확장 패키지는 설치하거나 실행하지 않았으며 저장소에 복사하지 않았다. 진단 확장만 임시 프로필에서 실행했다.

이 보고서에서 **코드 확인**, **실행 확인**, **추가 검증 필요**를 구분한다. 기본 DNR 규칙 하나가 동작했다는 결과를 Surfshark 전체 광고 차단의 보장으로 확대하지 않는다. 함수가 존재한다는 결과도 정상 동작으로 계산하지 않는다.

## 3. 현재 구조에서 재사용할 부분

현재 실행 경로는 다음과 같다.

```text
BrowserExtensions.svelte / renderer actions
        ↓ 제한된 preload·protocol IPC
BrowserManager
        ├─ 브라우저 세션, 웹 탭·창 소유권, 다운로드, 사이트 권한, HTTP 인증
        └─ BrowserExtensions
              ├─ 패키지 검사·설치·registry·업데이트
              ├─ 내장 uBlock 시작 및 준비 확인
              └─ electron-chrome-extensions
                    ├─ tabs / windows / action 등 호환 구현
                    ├─ 확장 frame preload
                    └─ service-worker preload 등록
                              ↓
                    Electron / Chromium의 네이티브 확장 기능
```

웹은 `persist:setdown-browser`라는 별도 세션에 있고, 웹 탭의 실제 `WebContents`를 확장 호스트에 등록한다. 이 기반은 유지해야 한다. 앱 셸의 파일·프로젝트·터미널 권한을 확장에 전달할 이유가 없다. [BrowserManager](../apps/desktop/src/main/browser/browser-manager.ts#L63)

설치 절차도 상당 부분 갖춰져 있다. 실행 전에 staging에 패키지를 검사하고 설치 확인을 받으며, 기존 설치 교체 중 실패하면 파일과 registry를 복구한다. 비활성 확장을 업데이트할 때 비활성 상태도 보존한다. 이를 버리고 새 설치기를 만드는 것보다 호환성 진단 정보를 이 경로에 추가하는 편이 좋다. [확장 설치 관리](../apps/desktop/src/main/browser/browser-extensions.ts), [기존 설치 문서](../docs/chrome-web-store-installation.md)

uBlock은 단순한 로딩 테스트보다 훨씬 강한 기준을 이미 갖고 있다. 요청 차단, 스크립트 차단, 하위 프레임의 cosmetic CSS, 응답 헤더 필터, 재시작 후 필터링을 실제 Chromium에서 검증한다. 이 테스트는 확장 계층을 바꿀 때 지켜야 할 회귀 기준이다. [uBlock E2E](../apps/desktop/test/e2e/browser/ublock.spec.ts)

## 4. 호환성을 제한하는 구체적인 지점

### 4.1. 팝업을 탭으로 여는 방식이 대상 페이지를 바꾼다

`browser:extension-open`은 확장의 popup URL로 일반 웹 탭을 만든다. 내장 uBlock에만 원래 탭 ID를 query parameter로 전달하는 예외가 있다. 코드 주석도 팝업이 자신을 활성 탭으로 선택하는 문제를 설명한다. 다른 확장에는 이 보정이 없다. [팝업 열기](../apps/desktop/src/main/browser/browser-manager.ts#L690)

진단에서 원래 페이지의 native tab ID는 `5`였다. MV2 팝업의 `tabs.query({active:true,currentWindow:true})`는 팝업 ID `7`, MV3 팝업은 팝업 ID `8`을 반환했다. 대표 ChatGPT Exporter의 `popup.js`는 이 쿼리 결과에 `tabs.sendMessage(..., {cmd:"popup_select"})`를 보낸다. 따라서 이 경로에서는 대상 페이지가 잘못된다. 다만 페이지 내부의 별도 내보내기 버튼까지 모두 실패한다는 뜻은 아니다.

또한 UI는 manifest의 고정 `default_popup` 유무만 보고 Popup 버튼을 만든다. 팝업 없이 `action.onClicked`로 실행하는 확장, 실행 중 변경된 popup, 탭별 badge·enabled 상태를 정상적인 브라우저 action으로 다루지 않는다. [확장 UI](../apps/desktop/src/renderer/browser/BrowserExtensions.svelte), [정적 popup URL](../apps/desktop/src/main/browser/browser-extensions.ts#L335)

**권고:** popup을 일반 탭 목록에 추가하지 않는 action 실행 경로를 만든다. 기존 라이브러리의 `browser-action-list`와 popup 생성 기능을 먼저 검토하되, Setdown의 분할 화면·여러 창·native view 배치에 맞는 얇은 연결부를 둔다. 원래 웹 탭의 논리적 활성 상태를 유지하고, 팝업으로 실제 키보드 포커스만 이동시킨다. Options 페이지는 별도 탭으로 열어도 된다.

Chrome의 action은 동적 popup과 탭별 상태를 지원하며, popup이 있으면 클릭 시 `onClicked`를 함께 보내지 않는다. 이 구분을 그대로 지켜야 한다. [Chrome action 문서](https://developer.chrome.com/docs/extensions/reference/api/action), [기반 라이브러리의 브라우저 action 안내](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions)

### 4.2. MV3는 작동하는 부분과 연결되지 않은 부분이 섞여 있다

MV3 service worker 자체는 실행됐다. `storage.local`에 값을 쓰고 popup의 `runtime.sendMessage`에 응답하는 것까지 확인했다. 따라서 “MV3를 지원하지 않는다”는 진단은 틀리다.

하지만 같은 MV3 확장의 popup과 worker에서 다음 차이가 있었다.

| 항목 | popup frame | service worker |
| --- | --- | --- |
| `browser === chrome` | `true` | `false` |
| `chrome.downloads.download` | 함수이지만 빈 구현 | `undefined` |
| `privacy.network.webRTCIPHandlingPolicy.get` | 함수이지만 응답 없음 | `undefined` |
| 동일한 활성 탭의 `windowId` | `1` | `0` |
| `storage.session`, `scripting` | 노출됨 | 노출됨 |

호스트 라이브러리는 worker preload를 등록한다. 그러나 Setdown은 **frame preload만** 자체 패치 파일로 바꾸고 worker에는 upstream 파일을 남긴다. 등록 목록에서도 두 경로가 확인됐다. 이번 진단에서는 worker에 frame과 같은 호환 API 보정이 관측되지 않았다. 왜 worker 보정이 적용되지 않았는지는 별도 최소 재현으로 더 좁혀야 한다. 파일 등록만으로 적용을 보장할 수 없다는 점은 확인됐다. [호스트 preload 교체](../apps/desktop/src/main/browser/browser-extensions.ts#L355), [preload 빌드](../apps/desktop/scripts/build-browser.mjs)

**권고:** frame과 worker를 각각 명시적인 빌드·패키징 대상으로 다루고, 두 컨텍스트에서 동일한 tab/window 의미를 제공하도록 검증한다. DOM·`webFrame`에 의존하는 frame 코드를 worker에 그대로 붙이지 않는다. 실제 설치 패키지에서도 preload 경로가 존재하는지 검사한다. 워커 최초 시작뿐 아니라 중지 후 재기동·이벤트 수신·업데이트 뒤 listener 중복 여부를 검사해야 한다.

현재 기존 E2E에는 MV3 worker 파일이 포함되지만, 핵심 assertion은 로딩과 content script 실행이다. worker가 저장한 값이나 재기동 후 메시지 처리를 검증하지 않는다. 테스트가 이미 있다는 사실과 그 테스트가 보장하는 범위를 구분해야 한다. [확장 E2E](../apps/desktop/test/e2e/browser/browser-extensions.spec.ts#L107)

### 4.3. “성공한 것처럼 보이는 빈 구현”이 있다

설치된 `electron-chrome-extensions@4.9.0`의 preload에서 downloads 메서드는 `noop: true`로 선언되어 있다. 실제 진단에서도 callback은 호출되지만 download ID는 `undefined`이고 다운로드 항목이 생기지 않았다.

동일 preload의 `ChromeSetting` 클래스는 `get/set/clear`가 비어 있다. `privacy.network.webRTCIPHandlingPolicy.get()`은 500ms 관측 동안 callback을 호출하지 않았다. 이 구현을 Promise로 감싼 확장은 이후 처리가 진행되지 않을 수 있다.

오류 전파도 점검해야 한다. upstream의 `invokeExtension()`은 IPC 오류를 잡은 후 `undefined`를 반환하는 경로가 있고, Setdown의 CSS adapter도 실패를 성공 callback과 구별하지 않는다. uBlock cosmetic CSS를 best-effort로 처리하는 의도는 있지만, 그 정책을 모든 확장의 일반 API 계약으로 넓히면 안 된다.

근거: 설치된 `node_modules/electron-chrome-extensions/dist/chrome-extension-api.preload.js`의 `invokeExtension`, `ChromeSetting`, `downloads` 구현과 [Setdown CSS adapter](../apps/desktop/src/browser-runtime/extension-preload.ts), [실행 결과](chrome-extension-audit-2026-10-16/evidence.json).

**권고:** 지원할 API는 callback·Promise·`runtime.lastError`·이벤트까지 한 계약으로 구현한다. 지원하지 않는 호출은 확장이 이해할 수 있는 실패로 끝내고, 관리 UI에도 이유를 제공한다. 함수가 있다는 사실만으로 capability를 “지원”으로 표시하지 않는다.

### 4.4. 설치 확인과 확장 실행 권한은 별개다

Setdown의 설치 확인은 사용자에게 패키지 실행을 승인받는다. 하지만 `BrowserManager`가 호스트에 `requestPermissions` callback을 제공하지 않아, upstream은 선택 권한 요청을 기본적으로 허용한다. upstream의 `permissions.remove()`는 상태를 지우지 않고 `true`만 반환한다.

진단 확장의 `notifications` 권한 상태는 `없음 → 요청 true → contains true → 해제 true → contains true`였다. 이는 **호환 계층의 권한 장부와 응답**에 대한 결과다. 실제 OS 알림까지 허용됐다는 검증은 아니다.

`browser-permissions.ts`는 웹사이트의 카메라·위치·알림 등을 관리하는 별도 정책이다. 이 코드를 Chrome 확장의 optional permission·host permission 모델로 간주할 수 없다. [사이트 권한](../apps/desktop/src/main/browser/browser-permissions.ts), [호스트 callback 구성](../apps/desktop/src/main/browser/browser-manager.ts#L88)

추가로 확인한 문제는 다음과 같다.

- manifest 요약은 `optional_permissions`, `optional_host_permissions`, `content_scripts.matches`를 포함하지 않는다. 대표 Exporter의 ChatGPT 페이지 접근 범위도 명확하게 설명하기 어렵다.
- CSS IPC는 로드된 확장의 발신인지 확인하지만, 대상 페이지에 대한 host grant나 `activeTab` 승인을 확인하지 않는다. 모든 확장 origin에 이 연결부가 노출된다.
- 권한 장부만 고쳐도 네이티브 Chromium의 권한 집행과 자동으로 일치하는 것은 아니다. native API와 자체 IPC가 같은 결정을 따르도록 해야 한다.

근거: [manifest 파싱](../apps/desktop/src/main/browser/extension-package.ts#L59), [CSS IPC](../apps/desktop/src/main/browser/browser-extensions.ts#L365), 설치된 라이브러리 `dist/cjs/index.js`의 `requestPermissions`와 `PermissionsAPI`.

**권고:** 확장 ID·브라우저 프로필별로 필수/선택 권한, host 접근, 임시 `activeTab` 승인을 관리한다. 해제와 비활성화·삭제·navigation 후 철회까지 검증한다. `activeTab`은 단순히 “현재 탭 ID를 알고 있다”는 뜻이 아니라 사용자 action에 따라 주어지는 임시 접근 권한이다. [Chrome activeTab 문서](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Chrome permissions 문서](https://developer.chrome.com/docs/extensions/reference/api/permissions)

### 4.5. 탭·창·메뉴는 앱의 생명주기와 연결해야 한다

현재 호스트 callback은 주로 `createTab`, `selectTab`, `removeTab`이다. `windows.create`에 필요한 창 생성 callback은 없으며, upstream의 `windows.remove`는 별도 callback이 없을 때 `BrowserWindow.destroy()`로 내려간다. 문서 탭과 웹 탭이 함께 있는 Setdown에서 강제 창 파괴를 그대로 허용하는 것은 닫기·저장 정책과 맞지 않는다. 이 경로는 정적 코드 확인이며 실제 미저장 문서 손실을 재현한 것은 아니다.

페이지 context menu에도 라이브러리의 `getContextMenuItems()`를 합치지 않는다. 확장이 context menu를 등록했다고 해서 페이지에서 선택할 수 있는 상태는 아니다. [페이지 메뉴 구성](../apps/desktop/src/main/browser/browser-manager.ts#L362)

창 사이 탭 이동은 같은 `WebContents`를 유지하면서 확장 호스트에는 remove/add로 다시 등록한다. 화면 이동이 확장 입장에서 탭 종료·생성으로 관측될 수 있으므로, ID 안정성과 `onAttached/onDetached/onMoved` 의미를 별도로 검증해야 한다. 이것이 현재 드래그 UX 문제의 원인이라고 단정하는 것은 아니다. [탭 이동](../apps/desktop/src/main/browser/browser-manager.ts#L443)

**권고:** 문서와 웹을 함께 가진 창을 확장에 어떻게 노출할지 정의하고, 생성·이동·닫기를 기존 workspace 경로로 연결한다. 분할 화면에서는 여러 웹 페이지가 보여도 한 창의 논리적 활성 웹 탭은 명확해야 한다. 문서 탭을 선택했을 때 마지막 웹 탭을 유지할지, action을 비활성화할지도 명시한다. 초기에는 대상 웹 탭이 명확할 때만 action을 실행하는 편이 예측 가능하다.

### 4.6. uBlock을 위해 만든 예외가 모든 확장에 적용된다

자체 extension preload의 주석은 내장 확장만 대상으로 설명하지만, 실제 조건은 `location.protocol === 'chrome-extension:'`다. `/background.html`에서 `cachedManagedStorage`를 지우는 migration도 확장 ID를 검사하지 않는다. 같은 경로·키를 가진 다른 확장에도 적용될 수 있다. 일반 확장에 `tabs.insertCSS/removeCSS`를 덮어쓰는 범위도 같다. [extension-preload.ts](../apps/desktop/src/browser-runtime/extension-preload.ts#L3)

빌드 시 upstream preload를 패치하는 방식 자체는 원본 문자열의 정확한 출현 횟수를 검사하고 테스트도 있어 관리되고 있다. 문제는 그 패치가 담당하는 계약과 적용 대상이 분명하지 않다는 점이다. [패치 구현](../apps/desktop/scripts/browser/extension-preload.mjs), [패치 테스트](../apps/desktop/scripts/browser/extension-preload.test.mjs)

또한 `start()`는 내장 uBlock의 준비 완료를 기다린 다음 사용자 확장을 로딩한다. uBlock 실패가 사용자 확장 시작과 관리 UI까지 막는 구조다. **호스트 초기화·확장 관리의 가용성**과 **보호되지 않은 첫 페이지 탐색을 막는 기존 정책**은 분리할 수 있다. 이 개선을 위해 uBlock 준비 전에 웹을 조용히 탐색시키면 기존 보호 보장을 잃는다. [시작 순서](../apps/desktop/src/main/browser/browser-extensions.ts#L48)

**권고:** 공통 호환 코드와 내장 uBlock 전용 수정·migration을 분리하고, 전용 코드는 확인된 확장 ID·버전 범위에만 적용한다. 기존 uBlock 테스트를 유지한 상태에서 일반 확장 쪽을 넓힌다.

## 5. ChatGPT 대화 내보내기: 먼저 완성할 목표

### 실제 조사한 확장

스토어 ID는 `ilmdofdhpnhffldihboadndccenlnfll`이며, 조사 시 배포 서버에서 받은 패키지는 **ChatGPT Exporter 6.13.1, MV3**였다. 검색된 스토어 페이지는 다른 버전을 표시할 수 있어, 이 보고서는 다운로드한 파일의 manifest와 SHA-256을 기준으로 삼았다. 사용자가 특정 확장을 지정한 것은 아니므로 이 제품을 모든 내보내기 확장과 동일시하지 않는다. [제작자 스토어 페이지](https://chromewebstore.google.com/detail/chatgpt-exporter-chatgpt/ilmdofdhpnhffldihboadndccenlnfll)

정적 분석에서 확인한 실제 의존 경로는 다음과 같다.

| 경로 | 패키지에서 확인한 내용 | Setdown에서 할 일 |
| --- | --- | --- |
| 실행·대상 선택 | action popup → 활성 탭 query → `tabs.sendMessage` | popup의 원래 대상 탭을 유지 |
| 페이지 접근 | `chatgpt.com`, `chat.openai.com`의 선언형 content script | 최초 로딩·SPA 이동·확장 설치 후 재로드 검증 |
| 페이지 내부 연결 | `inj.js`를 web-accessible resource로 제공 | main world와 content script 사이 메시지·리소스 접근 검증 |
| 백그라운드 | MV3 worker, runtime messaging, local/session storage | worker 준비·재시작·동일한 tab/window 의미 검증 |
| Markdown 저장 | content script에서 Blob URL과 `<a download>` 생성 | 일반 브라우저 다운로드 경로를 보존하고 실제 파일 내용 확인 |
| 서비스 연동 | 제작자 도메인 content script, `externally_connectable`, 외부 메시지 | 허용 origin과 로그인·응답 전달 확인 |
| PDF | 제작자 PDF 서비스 호출 경로 | 서비스 인증·네트워크 실패·결과 파일을 별도 검증 |

필수 manifest 권한은 `storage`, `activeTab`이다. **이 버전에는 `downloads` 권한이 없다.** 그러므로 “ChatGPT 내보내기를 지원하려면 먼저 chrome.downloads 전체를 구현해야 한다”는 우선순위는 이 대표 사례에 맞지 않는다.

이번 진단에서는 일반 웹 탭에서 Blob을 만들고 `target="_blank"`인 다운로드 링크를 클릭하는 방식으로 한글이 포함된 파일을 저장했다. 다운로드 manager에 completed 항목이 생기고 파일 내용도 확인했다. 저장 위치만 임시 파일로 지정했으며 실제 Chromium 다운로드와 기존 manager 처리를 사용했다. 이는 **파일 저장 기반의 검증**이며, 실제 ChatGPT 대화 추출 성공을 의미하지는 않는다.

제작자는 Markdown 등과 PDF의 처리 경로를 구분하며, PDF에는 확장 로그인과 서버 처리가 필요하다고 설명한다. 패키지에서도 제작자 API의 PDF 경로를 확인했다. 따라서 PDF가 실패할 때 브라우저 호환성, 확장 계정, 서비스 응답을 분리해서 진단해야 한다. [제작자 설명](https://chromewebstore.google.com/detail/chatgpt-exporter-chatgpt/ilmdofdhpnhffldihboadndccenlnfll)

### 권장 완료 순서

1. **popup 대상과 runtime messaging:** 일반 탭·분할 화면·두 창에서 선택한 ChatGPT 탭에만 명령이 도착하도록 한다.
2. **Markdown 실사용:** 짧은 대화뿐 아니라 긴 대화·코드 블록·표·수식·한글·링크·이미지 참조를 포함한 파일이 저장되고 Setdown에서 다시 열리도록 한다.
3. **PDF 실사용:** 확장 로그인, 제작자 서비스 처리, 다운로드 완료와 문서 품질을 확인한다. 서비스 실패는 호환 API 실패와 구분한다.
4. **다른 구현 유형:** `chrome.downloads`, 인쇄, offscreen document 등을 쓰는 다른 exporter를 선정해 공통 API 범위를 넓힌다. 첫 제품이 통과했다고 모든 exporter 지원을 선언하지 않는다.

ChatGPT의 대화 추출 자체는 확장이 담당하게 두는 편이 좋다. 이번 패키지에는 화면 DOM뿐 아니라 대화 API를 사용하는 코드도 있다. Setdown에서 특정 ChatGPT 내부 구조를 다시 구현하면 사이트 변경에 대응해야 할 책임이 중복된다. Setdown은 script·messaging·resource·download 계약을 제대로 제공하고, 페이지 변화로 깨진 확장의 추출 로직은 별도 문제로 표시해야 한다.

검증 데이터에는 이미 화면에서 사라진 이전 메시지, 스트리밍 중인 응답, SPA에서 다른 대화로 이동한 상태를 포함한다. 파일이 생성됐다는 assertion만으로 대화 전체 보존을 보장할 수 없다. 실제 계정 검증은 사용자가 선택한 비민감 테스트 대화로 수행하고, 자동 회귀 테스트는 로컬 fixture를 사용한다.

## 6. Surfshark: 프록시 버튼을 표시하는 것보다 큰 범위

### 실제 조사한 확장

스토어 ID `ailoabdmgclmfmhdagmlohpjlbpffblp`, 조사 시 다운로드한 패키지는 **Surfshark 5.4.0, MV3**였다. Surfshark는 브라우저 확장을 브라우저 트래픽에 적용되는 proxy 방식으로 설명한다. OS 전체를 보호하는 앱과 적용 범위가 다르다. Setdown에서도 지원 범위를 browser session으로 명확히 해야 한다. [Surfshark 설명](https://surfshark.com/download/chrome), [공식 스토어 항목](https://chromewebstore.google.com/detail/surfshark-chrome-vpn-exte/ailoabdmgclmfmhdagmlohpjlbpffblp)

manifest와 `background.bundle.js`에서 다음을 확인했다.

- `proxy.settings.get/set/clear`, proxy 오류 이벤트. 실제 연결 설정은 `fixed_servers`, HTTPS proxy의 443 포트, bypass 목록을 사용한다.
- `webRequest.onAuthRequired`의 `asyncBlocking` 응답. 로그인뿐 아니라 proxy 인증까지 연결해야 한다.
- `privacy.network.webRTCIPHandlingPolicy.get/set/clear`.
- DNR의 static rulesets, dynamic/session rules, 활성 ruleset 조회·변경, matched rule 조회.
- `scripting` 실행·CSS·동적 content script 등록, `webNavigation`, context menu, local/session storage.
- `browsingData.remove`를 사용하는 재인증 관련 경로.
- 서비스 로그인 페이지에 선언된 content script. 현 패키지의 manifest에는 `nativeMessaging`이나 `identity`가 필수 권한으로 선언되어 있지 않다. 이 두 API를 Surfshark의 선행 필수 작업으로 추정해서 넣을 근거는 없다.

### 실행 결과를 어떻게 해석해야 하는가

| 실험 | 결과 | 의미 |
| --- | --- | --- |
| `chrome.proxy.settings` 존재 확인 | 객체 노출 | 지원 판단 근거로 부족 |
| 확장에서 로컬 HTTP proxy를 설정 | 성공 callback, 오류 없음 | 호출 표면은 존재 |
| 같은 browser session의 `resolveProxy()` | `DIRECT` | 실제 설정 적용 실패 |
| 해당 session에서 테스트 주소 요청 | 이름 해석 실패, proxy 수신 0건 | 실제 요청도 proxy로 가지 않음 |
| 대조군: 같은 session의 `setProxy()` | `PROXY 127.0.0.1:…`, 로컬 proxy 응답 수신 | Electron network 경로 자체는 활용 가능 |
| MV3 기본 DNR dynamic rule | 규칙 조회 가능, 요청 차단, 제거 후 HTTP 200 | 기본 차단 기능은 재사용 가능 |
| WebRTC privacy 설정 | frame은 빈 구현, worker는 해당 메서드 없음 | 연결됨 표시만으로 보호를 약속할 수 없음 |

proxy 실험은 로컬 HTTP proxy이며, 실제 Surfshark의 HTTPS proxy·유료 계정·인증을 검증한 것은 아니다. DNR도 한 종류의 기본 규칙에 대한 실험이다. static 대규모 rulesets, session rules, feedback API, 다른 확장과의 우선순위는 아직 검증하지 않았다.

Setdown의 `BrowserAuth.request()`는 `isProxy` challenge를 거절한다. 다만 확장의 네이티브 `onAuthRequired` 처리가 먼저 성공하는 경우까지 이 코드가 항상 막는다고 단정할 수는 없다. **확장 인증 handler와 앱의 login handler 사이 우선순위·중복 callback·실패 처리를 실제 407 proxy fixture로 검증해야 한다.** [현재 HTTP 인증](../apps/desktop/src/main/browser/browser-auth.ts#L12), [login 이벤트 연결](../apps/desktop/src/main/browser/browser-manager.ts#L263)

### 권장 구현 접근

**첫 단계는 Surfshark 전용 feasibility 검증이다.** 일반 proxy 설정 UI부터 만들거나 native API 존재 여부만 확인하고 지원을 약속하지 않는다.

1. 현재 네이티브 `chrome.proxy`가 설정을 실제 session에 전달하지 못하는 지점을 최소 재현으로 좁힌다. upstream에서 고칠 수 있는 문제라면 그 경로를 우선한다.
2. 필요할 때만 작은 `proxy.settings` adapter를 `session.setProxy()`에 연결한다. 이번 패키지가 실제 사용하는 HTTPS fixed server·bypass·get/clear·오류 이벤트부터 계약을 정의한다.
3. callback 성공은 설정 적용 이후에만 반환한다. 확장 간 설정 소유권, `levelOfControl`, 앱/시스템 설정 복원, disable/remove/crash 후 상태를 다룬다. `get()`에 실제와 다른 값을 돌려주면 연결 상태 UI도 틀어진다.
4. 인증이 필요한 로컬 proxy로 407 성공·실패·취소·timeout·동시 요청을 검증한다. 자격 증명이 다른 origin이나 extension에 전달되지 않도록 소유권을 유지한다.
5. WebRTC 설정과 browsing-data 중 실제 필요한 동작을 구현·검증하고, DNR·uBlock 공존을 확인한다. 미지원 보조 기능이 전체 worker 시작을 중단시키는지도 확인한다.
6. 이후 실제 계정으로 연결·지역 변경·재연결·로그아웃·재시작·확장 비활성화를 검증한다. 실제 요청 경로와 누출 검사까지 통과해야 지원 단계로 올린다.

Chrome proxy API는 설정 모드·bypass·설정 제어 의미를 갖고 있다. Electron의 `setProxy()` 한 줄로 모든 의미가 충족되지는 않는다. 또한 proxy 변경 후 기존 pooled connection이 재사용될 수 있어 연결 정리 정책이 필요하다. [Chrome proxy 문서](https://developer.chrome.com/docs/extensions/reference/api/proxy), [Electron session.setProxy 문서](https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig)

적용 범위도 테스트한다. Setdown의 웹 페이지·그 session의 다운로드는 대상이지만, 앱 셸의 별도 session, Node 네트워크, Git·LSP·터미널 트래픽까지 같은 보호를 받는다고 표시해서는 안 된다. 실제 Surfshark 확장이 약속하는 WebRTC·DNS·연결 오류 시 동작은 각각 검증 대상이다. 제품에 없는 kill switch를 UI에서 암시해서도 안 된다.

이 단계의 완료 조건은 “팝업에 Connected가 보임”이 아니다. **올바른 네트워크 경로, 인증, 해제·복원, 보호 범위가 실제 결과와 일치함**이다. 이것을 만족시키기 전에는 Surfshark를 실험적/미검증으로 표시한다. 당장 네트워크 보호가 필요한 사용 사례에는 OS VPN이나 해당 확장을 지원하는 외부 브라우저가 별도 대안이지만, 그것을 Setdown 확장 지원 완료로 계산하지 않는다.

## 7. 현재 지원 수준을 정리한 표

아래는 모든 Chrome API 목록이 아니라, 목표 확장과 현재 코드에서 중요하게 드러난 계약이다.

| 계약 | 현재 근거 | 판정 및 다음 작업 |
| --- | --- | --- |
| 패키지 설치·수동 업데이트·복원 | 기존 unit/E2E 통과 | 유지하고 진단·검증 정보 추가 |
| MV2/MV3 선언형 content script | 기존 E2E 통과 | SPA·프레임·권한·설치 시점 조합 확장 |
| MV3 worker 실행·기본 메시지 | 진단에서 실행 확인 | 중지/재시작과 host API 보정은 미완 |
| MV3 `scripting.executeScript` | 허용된 로컬 페이지에서 실행 확인 | `activeTab`, MAIN/ISOLATED world, 프레임 권한 검증 |
| `storage.local` | 기존 사용·진단 확인 | 보존·업데이트·삭제 정책 확인 |
| `storage.session` | MV3에서 노출 확인 | 수명·접근 수준은 미검증 |
| `storage.sync` | upstream이 local로 대체 | 실제 Chrome 계정 동기화로 설명하지 않기 |
| action popup·badge·click | upstream 일부 구현, Setdown UI는 정적 popup 탭 | 실행·대상·포커스·상태 연결 우선 |
| tabs/windows | 등록·생성·선택 일부 연결 | worker/frame 일치, 여러 창, 안전한 닫기 보완 |
| context menu | upstream 조회 API 있으나 페이지 메뉴에 미결합 | 기존 context menu에 통합 |
| 웹 페이지 Blob 다운로드 | 한글 파일 저장·manager 완료 확인 | exporter 파일 내용·취소·긴 이름 검증 |
| `chrome.downloads` | frame noop / worker 미노출 | 별도 adapter가 필요한 확장부터 구현 |
| `chrome.proxy.settings` | 노출되지만 실제 설정 미적용 | 네이티브 연결 문제 조사 후 제한된 adapter 검증 |
| `privacy` | frame 빈 설정 메서드 / worker 미노출 | 실제 WebRTC 설정과 읽기·복원 검증 |
| 기본 DNR dynamic block | 차단 및 제거 후 성공 확인 | Surfshark의 static/session/feedback 조합 검증 |
| `webRequest` | uBlock 요청·응답 필터 E2E 통과 | Surfshark 인증·여러 확장·worker 경로는 별도 검증 |
| 선택 권한 | 자동 승인, remove 후 상태 유지 | 승인·저장·철회·native 집행 일치 필요 |
| `browsingData` | 선언한 MV3에서도 미노출 | Surfshark가 쓰는 범위와 오류 처리부터 확인 |
| 외부 메시지·uninstall URL·badge text color | 진단에서 함수/이벤트 노출 | 존재 확인이며 실제 흐름은 미검증 |
| identity·native messaging·offscreen·side panel | 이번 목표에 대한 실행 검증 없음 | 필요한 확장/호출이 확인된 뒤 범위를 결정 |

이 표를 확장 관리 UI의 지원 데이터와 테스트 목록으로 발전시키는 것이 좋다. 단, manifest와 번들의 정적 분석만으로 모든 API 사용을 알아낼 수는 없다. 동적 호출·조건부 기능을 포함하므로 “알려진 요구사항”과 “실행으로 확인한 시나리오”를 함께 기록해야 한다.

## 8. 코드 구조: 작은 확장 하위 영역으로 책임을 나눈다

이번에 정리한 `main / renderer / protocol / browser-runtime` 경계는 유지할 가치가 있다. 확장 강화 때문에 곧바로 별도 npm package나 또 다른 범용 플러그인 framework를 만들 필요는 없다. 다만 지금의 `BrowserExtensions`에 proxy·download·action·권한·진단을 모두 더하면 다시 큰 관리 클래스가 된다.

아래는 구현이 늘어날 때의 책임 배치안이다. 빈 파일을 미리 만드는 계획이 아니며, 각 기능 PR에서 실제 책임이 생길 때 분리한다.

```text
apps/desktop/src/
  main/browser/
    browser-manager.ts             # 웹 session·native tab 소유권의 최종 책임
    browser-downloads.ts           # 기존 다운로드 기록·UI와 공유하는 기반
    browser-auth.ts                # 웹사이트 HTTP 인증
    extensions/
      extension-host.ts            # upstream 연결, frame/worker 등록, 수명
      extension-installation.ts    # staging·registry·교체·rollback
      extension-package.ts         # 기존 parser 이동/확장, capability 입력
      extension-actions.ts         # action 상태·popup·기존 창 경로 연결
      extension-permissions.ts     # grants·activeTab·철회
      extension-diagnostics.ts     # 컨텍스트·API·확장별 상태
      adapters/                    # 필요한 API만; proxy/downloads 등
  browser-runtime/extensions/
    frame-preload.ts               # 확장 frame 전용
    worker-preload.ts              # worker 전용
    builtin-ublock.ts              # 내장 확장 전용 예외·migration
  protocol/browser.ts             # UI가 필요한 명시적 요청·상태만
  renderer/browser/
    BrowserExtensions.svelte       # 설치·권한·상태·오류 표시
    … action UI …                 # 현재 웹 탭의 action 표시
```

책임 규칙은 파일 이름보다 중요하다.

- **탭·창 소유권은 한곳에 둔다.** 확장 host의 tab/window 정보는 BrowserManager와 workspace의 투영이다. 별도의 경쟁하는 탭 저장소를 만들지 않는다.
- **설치 가능성과 실행 가능성을 구분한다.** 설치 manager는 패키지와 desired enabled 상태, host는 loaded/ready 상태, diagnostics는 실제 실패와 지원 범위를 관리한다.
- **Chrome API 구현과 Setdown 작업을 분리한다.** 예를 들어 downloads adapter는 API 인자·숫자 ID·이벤트를 변환하고, 전송·저장 UI·기록은 기존 다운로드 기반을 사용한다.
- **권한 판단을 adapter마다 제각각 복사하지 않는다.** 호출 확장·프로필·대상 탭·프레임·grant를 공통 경계에서 검사한다. 외부 페이지에는 범용 IPC 실행기를 노출하지 않는다.
- **일반 웹의 preload를 확장 권한 통로로 쓰지 않는다.** page CSS 수신 등 필요한 좁은 동작과 확장 권한 검사를 분리한다.
- **preload 수정은 빌드 산출물의 우연한 모양에만 의존하지 않는다.** 작은 고정 패치는 지금의 검사를 유지하고, 패치가 늘어나면 upstream 기여나 범위가 작은 고정 fork를 검토한다. 검사를 없애서 업그레이드를 통과시키지 않는다.

`BrowserDownloads`는 UUID 기반 ID와 자체 상태 이름을 쓴다. Chrome downloads 계약은 지속적인 숫자 ID, 검색, 생성·변경 이벤트, 취소·중단 오류 등을 포함한다. 따라서 IPC를 그대로 alias하는 대신 ID와 상태를 변환하는 계층이 필요하다. Popup·worker·offscreen 등에서 시작된 전송은 현재 `will-download`의 “등록된 웹 탭이 없으면 취소” 조건과도 맞춰야 한다. [기존 다운로드 manager](../apps/desktop/src/main/browser/browser-downloads.ts), [다운로드 소유권 검사](../apps/desktop/src/main/browser/browser-manager.ts#L72), [Chrome downloads 계약](https://developer.chrome.com/docs/extensions/reference/api/downloads)

브라우저 action UI는 기존 라이브러리를 재사용하더라도 popup의 native bounds·focus·IME·닫힌 뒤 원래 입력 위치를 반드시 확인한다. 과거 주소창 선택 및 창 사이 탭 이동 문제와 같은 영역을 건드리기 때문이다. popup을 웹 문서와 같은 활성 탭으로 만드는 우회는 제거하되, 단순히 새 native 창을 띄우는 것으로 작업을 끝내지 않는다.

## 9. 권장 작업 순서와 완료 조건

| 단계 | 구현 범위 | 완료 조건 |
| --- | --- | --- |
| A. 진단 기반 | 이번 관측을 재현하는 fixture, 확장별 load/runtime 오류, capability 데이터 | “설치됨”과 “시나리오 검증됨”을 구별하고, 실패 API·컨텍스트를 알 수 있음 |
| B. 공통 실행 기반 | frame/worker 경로, action popup, tab/window 정합성, 선택 권한·uBlock 예외 범위 | 팝업 대상·권한 철회·worker 응답이 올바르고 기존 uBlock 회귀 없음 |
| C. ChatGPT Exporter | 실제 버전 고정, Markdown 흐름, PDF·로그인·외부 메시지 | 선택한 대화의 내용이 실제 파일에 보존되며 여러 창에서도 대상이 맞음 |
| D. Surfshark 검증·구현 | proxy 적용, 인증, privacy, 필요한 browsingData, DNR 공존 | 실제 연결 경로·보호 범위·해제/복원이 검증됨; 안 되는 기능은 명시 |
| E. 지원 범위 확대 | 실제 두 번째 exporter 등에서 확인된 downloads·메뉴·단축키 요구 | 새 확장 요구가 공통 계약과 회귀 fixture로 추가됨 |
| F. 배포 신뢰성 | 패키지 검증·업데이트 진단·crash recovery·설치 산출물 smoke test | 개발 실행과 실제 배포 패키지에서 동일한 지원 범위를 보장 |

B를 하나의 거대한 PR로 묶지는 않는다. 예를 들어 worker API 일치, action UI, permission grants, uBlock 전용 코드 분리는 독립적으로 리뷰할 수 있다. 각각 완료 조건을 먼저 정하고 기존 fixture를 유지한다. Surfshark의 작은 feasibility 검증은 일찍 해도 되지만, 그 불확실성이 ChatGPT 내보내기 개선 전체를 막게 하지 않는다.

난이도는 상대적으로 **ChatGPT의 popup·메시지·파일 저장 정합성 < 범용 downloads 계약 < Surfshark의 네트워크·인증·누출 관련 계약** 순이다. 정확한 기간은 worker 보정 실패 원인과 인증 경로의 최소 재현을 확인한 뒤 산정하는 편이 정직하다. 현재 정보만으로 “며칠이면 Chrome 수준”이라고 약속할 근거는 없다.

설치 신뢰성 보완은 새 설치 기능 추가와 구분한다. 현재 CRX의 ID/key 일치 검사는 payload의 암호학적 서명 검증과 같지 않다. 자동 업데이트를 추가하기 전에 CRX 서명 검증, 권한 증가 diff, 중단·timeout, 실패·프로세스 종료 뒤 복구를 정리해야 한다. 예외 처리 중 rollback과 process crash에도 일관적인 transaction은 다르다. 폴더 복사와 upstream 스토어 unpack 경로가 자체 ZIP parser의 크기 제한과 같은 보호를 받는지도 확인한다. [패키지 parser](../apps/desktop/src/main/browser/extension-package.ts), [설치·교체 코드](../apps/desktop/src/main/browser/browser-extensions.ts), [현재 알려진 제한](../docs/chrome-web-store-installation.md)

## 10. 테스트는 숫자보다 계약 단위로 늘린다

현재 4개 확장/uBlock E2E는 설치·업데이트·재시작·content script·필터링을 꽤 깊게 검증한다. 이를 불필요한 테스트로 볼 이유가 없다. 다만 새 목표의 실패는 그 assertion 바깥에 있었다. 다음은 추가할 가치가 있는 행동 계약이다.

| 계약 | 반드시 확인할 결과 |
| --- | --- |
| action | 원래 대상 tab ID, popup 유무별 click 전달, 동적 popup·badge, disabled 상태 |
| 포커스 | popup 입력·한글 IME·주소창 복귀·Escape·외부 클릭·창 이동·배율별 위치 |
| tab/window | 두 창·분할 화면·background tab 생성·이동·닫기, native ID 일치, 미저장 문서 보호 |
| MV3 | 첫 실행, idle 종료 후 이벤트로 재시작, reload/update, listener 중복 방지, frame/worker의 같은 결과 |
| 권한 | 거절·승인·철회·재시작, host 범위 밖 호출 거절, activeTab 수명, 파일 URL 기본 차단 |
| 내보내기 | page Blob/extension frame/worker 등 실제 시작 위치, 저장 취소, 한글·긴 이름, 파일 내용·완료 이벤트 |
| proxy | 고정 HTTPS proxy·bypass·407 인증, 설정 변경 후 연결, 오류·해제·disable·재시작 복원 |
| 네트워크 규칙 | static/dynamic/session 규칙, DNR와 uBlock 공존, 요청/응답 헤더·인증 우선순위 |
| 배포 | 설치 패키지의 frame/worker preload 경로, 사용자 확장 재시작, 의존성 버전 조합 |

자동 테스트는 결정적인 로컬 서버·작은 자체 확장을 사용한다. 실제 Surfshark/Exporter의 특정 버전 smoke test는 별도로 유지하고, 스토어 최신 버전 변경을 일반 unit/E2E의 불규칙한 실패 원인으로 섞지 않는다. 실제 계정이 필요한 검증은 별도의 명시적 절차로 두며 일반 CI 성공으로 대체하지 않는다.

네트워크 경로는 반드시 정상 대조군을 둔다. 이번 조사에서도 `chrome.proxy`가 실패한 뒤 같은 session의 `setProxy()`가 성공하는 것을 확인했고, DNR 규칙 제거 후 동일 URL이 200으로 돌아오는 것도 확인했다. 단순한 fetch 실패만으로 “규칙이 차단했다”고 판단하지 않는 방식이다.

GUI 테스트는 계속 격리 디스플레이에서 수행한다. native bounds·zoom·포커스·preview 경계를 변경하는 구현 단계에서는 [preview performance contract](../docs/preview-performance-contract.md)를 먼저 읽고 `npm run test:preview-contract` 및 해당 성능 경로의 benchmark를 수행한다. 테스트를 숨기는 것은 시나리오·IME·성능 허용치를 줄이는 이유가 아니다. 이번 작업은 보고서와 진단 자료만 추가했으므로 전체 preview 계약과 benchmark는 실행하지 않았다.

## 11. 대안 비교와 선택 기준

| 대안 | 장점 | 비용·제약 | 판단 |
| --- | --- | --- | --- |
| 현재 Electron + 기존 라이브러리 + 좁은 adapter | 현재 문서·웹 구조와 uBlock 자산 재사용 | API 의미·생명주기를 직접 검증해야 함 | **현재 권장** |
| 기존 라이브러리 upstream 개선 / 작은 고정 fork | 여러 앱에 공통인 호환 문제를 공유 가능 | 버전 고정·패치·라이선스 고지·회귀 관리 필요 | worker·오류 의미 등 공통 문제에 사용 |
| 모든 Chrome API를 Setdown에서 독자 구현 | 구현 방향을 직접 통제 | 엔진 권한·워커·설정 등 브라우저 수준 책임이 계속 증가 | 목표로 삼지 않음 |
| Chromium 기반 브라우저 전체를 유지하는 방향 | 확장 플랫폼과 가까운 위치에서 수정 가능 | 앱 구조·빌드·업데이트·OS 배포의 범위가 크게 바뀜 | 두 목표만으로 전환할 근거 부족 |
| 외부 브라우저 또는 OS VPN 연계 | 당장 일부 사용 목적 달성 가능 | Setdown 안의 확장 호환성과는 다른 결과 | 미지원 시나리오의 보조 경로 |

`electron-chrome-extensions`를 단순히 새 버전으로 바꾸면 해결된다고 가정하지 않는다. 현재는 패치 preload·uBlock·탭 등록이 설치된 `4.9.0`에 결합되어 있다. 업그레이드는 후보 버전에서 이번 실패 fixture가 개선되고 기존 보장이 유지되는지 확인한 뒤 한다. 공통 bug는 upstream에 제안할 수 있지만, 이번 보고서 작성 과정에서 외부 issue나 메시지를 게시하지 않았다.

엔진 전환을 다시 검토할 조건은 명확하다. 사용 목표가 “특정 확장 몇 개의 신뢰할 수 있는 사용”을 넘어 광범위한 스토어 호환성으로 바뀌거나, 필요한 권한·worker·네트워크 기능을 작은 adapter로 충족시킬 수 없다는 구체적 재현이 쌓일 때다. 그 전에는 작동하는 기반을 교체하는 비용보다 현재 연결부를 정리하는 효과가 크다.

## 12. 이번 작업의 검증 기록과 재현

| 검증 | 결과 |
| --- | --- |
| 확장 registry·패키지·스토어 URL 단위 테스트 | 3파일, **18개 통과** |
| preload patch Node 테스트 | **1파일 통과** |
| 확장 설치/업데이트·사용자 확장·uBlock E2E | **4개 통과**, 17.2초 |
| typecheck / Svelte 검사 / Vite 빌드 | 통과 |
| Electron 빌드 | 최초 sandbox에서 `spawnSync git EPERM`; 같은 빌드 단계를 제한 밖에서 재실행해 통과 |
| 진단 확장 | 팝업 대상·권한 해제·API 응답 문제 재현, MV3 기본 통신·script·DNR·Blob 저장 확인 |
| 실제 제품 계정으로 전체 사용 | 수행하지 않음 |

기존 테스트 명령은 `apps/desktop`에서 실행했다.

```sh
npm test -- src/main/browser/browser-extensions.test.ts src/main/browser/extension-package.test.ts src/core/browser/web-store.test.ts
node --test scripts/browser/extension-preload.test.mjs
bash scripts/with-isolated-display.sh npx playwright test test/e2e/browser/browser-extensions.spec.ts test/e2e/browser/ublock.spec.ts
```

조사용 진단은 root에서 현재 desktop build를 준비한 뒤 다음과 같이 재현할 수 있다. 이 스크립트는 정식 회귀 suite가 아니라 관측용 도구다. 알려진 미지원 결과를 성공 assertion으로 바꾸어 제품 지원을 주장하지 않는다.

```sh
bash apps/desktop/scripts/with-isolated-display.sh node reports/chrome-extension-audit-2026-10-16/probe.mjs
```

진단은 별도 임시 프로필과 자체 확장을 만들고 종료 시 프로필을 제거한다. 결과는 `/tmp/setdown-extension-audit-runtime.json`, warning은 `/tmp/setdown-extension-audit-runtime-stderr.log`로 기록한다. 보고서에 첨부한 `evidence.json`은 이번 실행의 고정 기록이며 재실행으로 자동 변경하지 않는다. 네트워크 판별용 `.invalid` 주소는 proxy 성공 시 로컬 서버로 전달되고, 미적용 상태에서는 이름 해석 실패로 관측한다. 사용자 확장이나 계정 상태는 사용하지 않는다.

실제 패키지의 SHA-256은 다음과 같다. 이후 버전의 결과와 혼동하지 않기 위한 식별자이며, 이 값을 기록한 것이 배포자의 CRX 서명을 검증했다는 뜻은 아니다.

```text
Surfshark 5.4.0
604a59cfc27ce0819958d6dd7db96d77671b7138d2c23cc3af435efedb58ea91

ChatGPT Exporter 6.13.1
d96387836acf6a80a18450b02c1a7bcc61f0ce24966deeda08689b1a9569f0a3
```

**다음 구현의 출발점은 action·worker·권한의 공통 계약이다.** 그 기반 위에서 ChatGPT 내보내기를 먼저 완료하고, Surfshark는 실제 네트워크 결과를 통과 조건으로 삼아 지원 범위를 결정한다.

## 13. 승인 후 구현 결과

공통 실행 기반과 내보내기·프록시의 주요 API를 구현했다. 위의 분석은 변경 전 기록이며, 현재 지원 범위는 [확장 런타임 문서](../docs/browser-extension-runtime.md)에 유지한다. Electron과 확장 라이브러리 버전은 그대로다.

| 영역 | 구현한 동작 |
| --- | --- |
| 주소창 action | 고정 아이콘 최대 3개와 확장 메뉴, 고정 상태 저장, 탭별 제목·아이콘·badge·활성 상태 |
| 팝업과 창 | 버튼 아래의 실제 자식 팝업, 원래 탭 대상 유지, 두 Setdown 창의 `currentWindow` 필터 보정, Escape·포커스 상실·탭 변경·탐색·창 이동 시 닫기 |
| MV3와 전용 코드 | frame/worker에 같은 API 보정 적용, uBlock 전용 DOM/CSS 처리는 내장 확장으로 제한 |
| 권한 | 구현한 선택 권한의 명시적 승인·거절·저장·철회, 실제 설정 재적용, 설치 확인에 content-script host와 선택 권한 표시 |
| 다운로드 | 기존 다운로드 관리자를 통한 HTTP(S) GET·대화상자·파일명 중복 처리·조회·제어·이벤트, 페이지 Blob 저장 유지 |
| 네트워크 | 브라우저 프로필의 프록시 설정·우선권·복원, 웹 탭의 407 인증, WebRTC IP 정책, 범위를 제한한 웹 데이터 삭제 |
| 경계와 오류 | 호출자 확장·프로필 확인, 명시적 Promise 오류와 callback `runtime.lastError`, 인증 응답의 별도 IPC와 인자 로그 제거 |

기능별 코드는 `src/main/browser/extensions/` 아래의 host·permissions·network·proxy-auth·downloads 모듈로 나눴다. 기존 설치·업데이트·복구와 다운로드 기록은 재사용한다. 라이브러리 내부 구조에 의존하는 지점은 host adapter에 모았으며, preload 패치는 적용 위치가 달라지면 빌드 단계에서 실패하도록 유지했다.

실제 실행에서 발견한 문제도 함께 수정했다. 라이브러리의 `tabs.query`가 `currentWindow`를 무시해 다른 창의 활성 탭까지 반환하는 문제를 보정했다. 파일 저장은 목적지를 먼저 독점 생성하여 기존 파일의 초기 잘림을 막고, 하위 폴더의 심볼릭 링크를 거절한다. 웹 데이터 삭제는 확장 저장소를 지우지 않는 Electron의 `clearData` 경로를 사용한다. 프록시 인증 응답은 upstream의 debug 로그에도 자격 증명이 남지 않는 별도 채널로 전달한다.

검증용 MV3 확장은 로컬 웹·프록시 서버와 임시 프로필에서 동작한다. API 반환값뿐 아니라 실제 프록시 응답 바이트, 407 재인증, WebRTC 정책, 쿠키와 저장소의 삭제 범위, 다운로드 파일 내용·중복 보존·이벤트, DNR 차단과 해제, 두 창의 팝업 대상을 확인했다. GUI는 Xvfb·runtime directory·D-Bus를 격리하고 Chromium sandbox를 켠 상태로 실행했다.

### 현재 검증한 범위와 남은 작업

이 구현으로 실제 Surfshark 계정의 연결이나 ChatGPT Exporter의 제품 전체 흐름을 인증한 것은 아니다. 자체 fixture의 성공을 제품 로그인·구독·실제 프록시 서버·ChatGPT DOM·서버 PDF 생성의 성공으로 대체하지 않았다.

- **Surfshark:** 웹 탭에서 시작된 프록시 407 인증은 통과했다. worker 요청의 인증 이벤트는 Electron에서 WebContents 없이 pid 0으로 올 수 있어 프로필을 증명할 수 없다. 이 경로에는 다른 프로필의 인증 정보를 전달하지 않는다. 실제 제품 호환성의 남은 제약이다.
- **ChatGPT 내보내기:** 원래 페이지를 대상으로 하는 팝업·메시지와 페이지 Blob 저장, HTTP(S) 다운로드 기반을 검증했다. 실제 제품의 대화 선택·로그인·PDF 백엔드·최근 ChatGPT 화면 변경은 별도 실사용 검증이 필요하다.
- **Chrome API 범위:** Chromium의 `activeTab`과 임의의 선택 host 권한을 가짜 승인하지 않는다. 이번 adapter가 지원하지 않는 입력은 오류를 반환한다. PAC는 현재 Electron의 의미와 일치하는 `mandatory: true` HTTP(S) URL만 지원하며, worker 간 Blob URL 변환·다운로드 body/headers·시간별 웹 데이터 삭제 등은 지원하지 않는다.
- **배포 신뢰성:** 기존 설치 확인과 실패 복구는 유지했다. CRX 서명 검증·자동 업데이트·프로세스 종료 중 설치 복구는 아직 별도 단계다.

따라서 원래 계획의 B와 C·D에 필요한 주요 공통 API는 구현했고, C·D의 실제 제품 인증과 F 전체를 완료로 표시하지 않는다.

## 14. 최종 회귀 검사와 성능 비교

| 검사 | 결과 |
| --- | --- |
| `test:preview-contract` 단위 검사 | 70파일 · 465개 통과 |
| 빌드 도구 검사 | 11개 통과 |
| TypeScript · Svelte · renderer/main 빌드 | 통과 · Svelte 오류 0 / 경고 0 |
| 실제 Electron 회귀 검사 | 129개 통과 · 6.0분 |
| 미리보기 성능 비교 | 통과 · 80회 새 앱 실행 · 48개 비교 항목 · 회귀 0개 |

[검사 로그](chrome-extension-runtime-2026-10-16/preview-contract.txt), [성능 비교와 빌드 식별자](chrome-extension-runtime-2026-10-16/preview-summary.json), [전체 측정 원본](chrome-extension-runtime-2026-10-16/preview-comparison.json.gz), [검증 요약](chrome-extension-runtime-2026-10-16/verification.json)을 보관했다. 전체 캡처·trace는 `/tmp/setdown-extension-preview-benchmark-complete`에 있다.

변경 전 기준은 별도로 설치·빌드한 `a14c44007715cb1ff810458aff9c74cee7d00bd8`이다. 후보는 위 전체 검사에서 빌드한 산출물이다. `--skip-build`는 이 두 빌드를 다시 하지 않는 옵션이며, 측정기는 양쪽 산출물과 공통 harness의 해시가 실행 중 유지되는지 검사했다. 같은 가상 디스플레이에서 AB/BA 순서를 교대하고, 버전마다 8개 시나리오를 5회 반복했다.

첫 측정은 대화 중단과 함께 종료됐다. 그 불완전한 결과는 최종 통계에 섞지 않았다. 소스·측정 시나리오·기존 허용치(25%와 50ms를 동시에 초과하면 회귀)를 변경하지 않고 전체 비교를 다시 완료했다.

아래 단위는 ms이며 각 칸은 **변경 전 → 변경 후**다. 첫 번째와 두 번째 cycle은 따로 집계했고, warm은 각 앱의 3~5번째 cycle 중앙값을 사용한다. 표에는 5회 실행의 중앙값을 기록했다. 사전 준비 0/3000ms는 입력 전 대기 조건이며 측정 시간에 포함하지 않는다. 읽기 전환은 Escape부터 최신 내용이 있는 native capture까지이므로 IPC·폴링·readback을 포함하며 모니터 표시 지연과 같지 않다.

### 읽기 화면 전환

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | warm |
| --- | --- | --- | ---: | ---: | ---: |
| 일반 Markdown | 0ms | 없음 | 50 → 41 | 23 → 20 | 20 → 20 |
| 일반 Markdown | 0ms | 있음 | 422 → 420 | 102 → 101 | 93 → 94 |
| 일반 Markdown | 3000ms | 없음 | 39 → 39 | 18 → 20 | 24 → 23 |
| 일반 Markdown | 3000ms | 있음 | 99 → 106 | 99 → 101 | 90 → 91 |
| Git 리뷰 | 0ms | 없음 | 922 → 920 | 20 → 22 | 25 → 20 |
| Git 리뷰 | 0ms | 있음 | 977 → 987 | 1456 → 1493 | 181 → 175 |
| Git 리뷰 | 3000ms | 없음 | 32 → 26 | 23 → 22 | 18 → 18 |
| Git 리뷰 | 3000ms | 있음 | 229 → 229 | 182 → 188 | 176 → 175 |

### 더블클릭으로 편집기 복귀

| 문서 | 사전 준비 | 편집 | 첫 번째 | 두 번째 | warm |
| --- | --- | --- | ---: | ---: | ---: |
| 일반 Markdown | 0ms | 없음 | 19 → 17 | 36 → 32 | 12 → 11 |
| 일반 Markdown | 0ms | 있음 | 21 → 18 | 13 → 15 | 13 → 13 |
| 일반 Markdown | 3000ms | 없음 | 16 → 17 | 11 → 11 | 11 → 11 |
| 일반 Markdown | 3000ms | 있음 | 20 → 20 | 14 → 13 | 14 → 13 |
| Git 리뷰 | 0ms | 없음 | 23 → 22 | 12 → 12 | 12 → 12 |
| Git 리뷰 | 0ms | 있음 | 23 → 22 | 21 → 20 | 19 → 18 |
| Git 리뷰 | 3000ms | 없음 | 24 → 23 | 11 → 11 | 17 → 17 |
| Git 리뷰 | 3000ms | 있음 | 22 → 20 | 18 → 17 | 18 → 18 |
