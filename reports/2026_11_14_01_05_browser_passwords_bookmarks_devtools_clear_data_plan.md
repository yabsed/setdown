# 브라우저 기능 4종 구현 방법: 비밀번호, 북마크 내보내기, 웹 개발자 도구, 인터넷 사용 기록 삭제

기준 checkout: `f90f276` (v2.7.0) · Electron `44.7.2`.
이 문서는 구현 전 조사 결과로 쓰였고, 같은 날 네 기능을 모두 구현했다. 현재 동작과 보장은
[계약 문서](../docs/contracts/workspace.md#browser-library-passwords-bookmark-export-page-developer-tools-clearing-data)가
기준이다. "현재 상태"는 구현 전의 Setdown 코드, "참고 구현"은 `vendor/` 서브모듈 소스에서
직접 확인한 내용이다.

구현하면서 이 계획과 달라진 점:

- **비밀번호 관리자는 처음이 아니다.** 2026-11-09에 제품 결정으로 제거된 구현이 있었다
  (`passwords.v1.enc`, 잠금/해제 단계 포함). 이번 구현은 그 결정을 요청에 따라 되돌린 것이고,
  예전 파일은 읽지도 건드리지도 않는다.
- 채우기 UI는 포커스 때 자동으로 뜨는 메뉴가 아니라 주소창의 열쇠 버튼, 입력 필드의
  컨텍스트 메뉴, Ctrl+\로 했다. 포커스마다 메뉴가 입력을 가로채는 것을 피했다.
- 저장 확인에서 사용자 이름과 비밀번호를 고치는 기능은 넣지 않았다. 비밀번호를 셸로
  보내지 않기 위해서다. 관리 화면의 수동 추가가 그 역할을 한다.
- 북마크 자동 백업, 종료 시 삭제, 비밀번호 생성, HTTP 인증 저장은 넣지 않았다.

## 요약

| 기능 | 현재 상태 | 권장 방식 | 가장 가까운 참고 구현 | 규모 |
| --- | --- | --- | --- | --- |
| 비밀번호 저장·채우기·CSV | 없음 | 메인 프로세스 저장소(`safeStorage`) + 페이지 프리로드 감지 + 셸 UI | Min 전체 흐름, VS Code의 키링 처리 | 큼 |
| 북마크 내보내기/가져오기 | 가져오기(HTML)만 있음 | 기존 파서의 역함수로 내보내기 추가 | Brave의 Netscape 작성기, Min의 내보내기 | 작음 |
| 웹 페이지 개발자 도구 | 메뉴 항목이 앱 셸을 엶 | 분리 창 + F12/Inspect | VS Code 내장 브라우저, Min | 작음 |
| 인터넷 사용 기록 삭제 | 방문 기록 전체, 사이트 하나의 데이터만 | 항목 선택 대화상자 + `session.clearData` | Min, VS Code 내장 브라우저, Brave | 중간 |

권장 순서는 북마크 내보내기 → 개발자 도구 → 사용 기록 삭제 → 비밀번호다.

서브모듈 조사로 바뀐 결론은 다음과 같다.

- **비밀번호를 페이지 로드 때 자동으로 채우지 않는다는 권장이 확정에 가까워졌다.** Min은
  사용자가 열쇠 버튼을 눌러야 채우고, Brave는 Chromium을 패치해 계정을 고르기 전에는 채우지
  않게 만든다.
- **키링이 없을 때는 "저장 거부"보다 "메모리에만 보관"이 낫다.** VS Code가 그렇게 한다.
- **개발자 도구 단축키는 F12와 Ctrl+Shift+I를 웹 페이지에 주고, 앱 셸 도구는
  Ctrl+Shift+Alt+I로 옮긴다.** Min과 VS Code가 모두 페이지 쪽에 주 단축키를 준다.
- **사용 기록 삭제의 시간 범위는 넣지 않는다.** Electron 기반 참고 구현 셋 모두 전체 삭제만
  한다.
- **Chrome 프로필에서 비밀번호를 직접 읽어 오는 가져오기는 하지 않는다.** Brave조차 암호화
  때문에 포기했다. CSV가 유일한 현실적 경로다.

## 참고한 서브모듈

| 서브모듈 (커밋) | 무엇인가 | 참고한 부분 | 라이선스 |
| --- | --- | --- | --- |
| `min` (`c92079cd`) | Electron 브라우저. 이미 Places를 가져다 쓰고 있다 | 네 기능 전부 | Apache-2.0 |
| `vscode` (`d3d31f6`) | **내장 브라우저**(`platform/browserView`)가 있다. 샌드박스 `WebContentsView` + 영구 세션으로 Setdown과 구조가 가장 가깝다 | 개발자 도구, 데이터 삭제, 키링 처리 | MIT |
| `brave-core` (`97d6dfd`) | Chromium 위의 Brave 계층 | 채우기 정책, 가져오기 한계, 북마크 형식, 삭제 대상 | MPL-2.0 |
| `jupyterlab-desktop` (`0e46b48`) | Electron 앱 | `basic_text` 처리, 세션 삭제 | BSD |
| `ublock-origin` (`8dd4894`) | 내장된 확장 | 확장 데이터가 어디에 있는지 | GPL-3.0 |
| `xdg-desktop-portal` (`faab6c7`) | 포털 명세 | Secret 포털 | LGPL |
| `aura-browser`, `theia`, `pulsar` | 프로토타입 브라우저, Electron 앱 | 쓸 내용 거의 없음(아래 각 절에 한 줄씩) | — |

Min 코드는 Places 때처럼 옮겨 쓸 수 있다(`MIN-LICENSE.txt`를 이미 배포한다). Brave는
Chromium 내부 API에 묶여 있어 코드가 아니라 **결정**만 참고한다. `bypass-paywalls-chrome-clean`은
소스 없이 문서만 있는 체크아웃이라 참고할 것이 없었다.

## 공통 전제

- 웹 탭은 `persist:setdown-browser` 세션을 쓰는 샌드박스 `WebContentsView`다
  (`main/browser/browser-manager.ts`). 모든 프레임에 격리된 프리로드
  (`browser-runtime/page-preload.ts`)가 들어가며, 웹 페이지 JS에는 어떤 API도 노출하지 않는다.
- 방문 기록과 북마크는 별도 파티션 `persist:setdown-places`의 IndexedDB에 있고, 숨은
  `WebContentsView`(`browser-runtime/places.ts`)가 `MessagePort`로 요청을 처리한다.
- GUI 테스트는 `scripts/with-isolated-display.sh`의 격리 디스플레이에서 돌린다. 웹 탭 스펙이
  계약 스위트에 들어 있으므로 `npm run test:preview-contract`로 확인한다.

---

## 1. 비밀번호 저장, 채우기, 가져오기/내보내기

### 현재 상태

- 저장소, 감지, 채우기 코드가 없다. HTTP 기본 인증 대화상자(`browser-auth.ts`)만 있고 그것도
  저장하지 않는다.
- 확장 API `privacy.services.passwordSavingEnabled`는 "지원하지 않음"으로 응답한다
  (`browser-extensions.ts`). 내장 uBlock은 이 설정을 쓰지 않는다. uBO가 건드리는 `privacy`
  설정은 `networkPredictionEnabled`, `webRTCIPHandlingPolicy`, `hyperlinkAuditingEnabled`
  셋뿐이다(`ublock-origin/platform/chromium/webext.js:133-136`).

### 참고 구현: Min

Min에는 처음부터 끝까지 동작하는 구현이 있다. 흐름은 그대로 쓸 만하고, 보안 관련 세부는
고쳐야 한다.

| 부분 | Min이 하는 일 | Setdown에서 |
| --- | --- | --- |
| 저장 (`main/keychainService.js`) | `safeStorage`로 암호화한 파일 하나. 형식 `{ version: 1, credentials: [{ domain, username, password }] }` | 형식과 방식 채택. 원자적 쓰기, 0600, 백엔드 확인을 추가 |
| 키 (`passwordManager.js`) | `www.`를 뗀 **호스트 이름** | **출처(scheme+host+port)**로 바꾼다. 호스트 이름만 쓰면 `http://` 페이지가 `https://` 계정을 받는다 |
| 출처 판정 | 채울 때는 프레임 URL을 쓴다("it's important to use frameURL here and not the tab URL"). 저장할 때는 프리로드가 보낸 `window.location.hostname`을 믿는다 | 두 경우 모두 메인이 `event.senderFrame.origin`으로 정한다 |
| 조회 (`keychain.js`) | UI 프로세스가 **전체 목록**을 받아 거기서 걸러 낸다 | 메인에서 걸러 필요한 계정만 내보낸다 |
| 채우기 시점 (`preload/passwordFill.js`) | 포커스된 필드 옆에 열쇠 버튼을 그리고, **누르면** 요청한다. 계정이 하나면 바로 채우고 여러 개면 목록을 띄운다. 단축키 `mod+\`도 있다 | 사용자 동작이 있어야 채운다는 원칙 채택 |
| 채우기 UI | 버튼과 목록을 **페이지 DOM에** 넣는다 | 네이티브 메뉴로 바꾼다(아래) |
| 필드 찾기 | 이름 휴리스틱: `user, name, mail, login, auth, identifier, account, acct`, 제외 `confirm, filename`, 유형 `text/email`. 사용자 이름과 비밀번호 필드가 **둘 다** 있어야 동작("to reduce the false-positive rate") | 목록과 "둘 다 있어야" 규칙 채택 |
| 제출 감지 | `submit` 이벤트, `button[type=submit]` 클릭, 그리고 페이지 세계에 스크립트를 넣어 `HTMLFormElement.prototype.submit`을 가로챔 | 앞의 둘만 채택. 페이지 세계에 코드를 넣지 않는다는 Setdown 원칙과 충돌한다 |
| 저장 확인 (`passwordCapture.js`) | 상단 막대에 사용자 이름과 비밀번호를 **고칠 수 있게** 보여 주고 저장 / 이 사이트는 안 함 / 닫기. 같은 계정·비밀번호가 이미 있으면 묻지 않는다 | 채택 |
| 값 넣기 | `.value` 설정 후 `keydown, keypress, keyup, input, change` 발생 | 채택 |
| 비밀번호 생성 | 비밀번호 필드의 컨텍스트 메뉴. 16자, 확인 필드를 위해 5분간 같은 값 재사용, 넣은 뒤 저장 확인을 띄움 | 선택 기능으로 나중에 |
| 목록 화면 (`passwordViewer.js`) | 보기/숨기기, 삭제, "저장 안 함" 사이트 목록 | 채택 |
| CSV | 헤더 `url,username,password`. 가져올 때 헤더를 소문자로 바꾸고, 같은 도메인·사용자 이름은 가져온 쪽으로 덮어쓴다. 가져오기와 내보내기 전에 확인을 받는다 | 채택하고 형식을 넓힌다(아래) |

Min에는 Bitwarden과 1Password의 CLI를 호출하는 어댑터도 있다(`bitwarden.js`,
`onePassword.js`). 저장소를 인터페이스 뒤에 두면 나중에 같은 방식으로 붙일 수 있다.

### 참고 구현: 채우기 시점에 대한 Brave의 결정

Brave는 Chromium의 채우기 코드에 한 줄을 넣는다.

```
patches/components-password_manager-core-browser-password_form_filling.cc.patch
+  wait_for_username = true;
```

페이지 로드 때 채우지 않고 사용자가 계정을 고른 뒤에만 채운다는 뜻이다. Min의 열쇠 버튼과
같은 결정이다. 로드 때 채우면 페이지에 심긴 스크립트가 사용자가 아무것도 하지 않아도 값을
읽을 수 있다.

### 참고 구현: 키링이 없을 때

`safeStorage`는 Linux에서 키링이 없으면 `basic_text`(고정 키 난독화)로 떨어진다. 세 앱의
대응이 다르다.

| 앱 | 대응 |
| --- | --- |
| Min | 확인하지 않고 그대로 쓴다 |
| jupyterlab-desktop | `basic_text`면 저장하지 않는다(`sessionconfig.ts:276-282`). 사용자에게 이유를 알린다: "the operating system secure credential store is not available" |
| VS Code | 암호화가 안 되면 **메모리에만** 보관한다(`platform/secrets/common/secrets.ts:227-238`). 처음 저장할 때 한 번 경고하고, `basic_text`일 때만 "약한 암호화 사용"을 선택지로 준다 |

VS Code 방식이 가장 낫다. 저장 기능이 그 세션 동안은 동작하고, 디스크에는 평문에 가까운
것이 남지 않는다.

복호화에 실패하는 경우(키링 교체, 다른 계정으로 복사)도 정해야 한다. VS Code는 해당 값을
지우고(`secrets.ts:151-155`), Brave는 읽을 수 없는 항목을 건너뛴다
(`kSkipUndecryptablePasswords`). Setdown은 파일 하나에 전부 들어 있으므로 **지우지 않고
파일 이름을 바꿔 보존한 뒤 알린다.** 조용히 덮어쓰면 복구할 길이 없다.

### 권장 구조

```
웹 페이지 프레임 (격리 프리로드)
  ├─ 로그인 폼 제출 감지 ──► main: PasswordStore ──► 셸: 저장 확인 (값 수정 가능)
  └─ 필드 포커스 알림 ────► main: 프레임 출처 확인 ──► 네이티브 메뉴 ──► 그 프레임에만 채움
```

**저장소 (`main/browser/browser-passwords.ts`, 새 파일)**

- `userData/browser-passwords.bin`. Min의 형식에 출처와 시각을 더한다:
  `{ version: 1, credentials: [{ id, origin, username, password, created, modified, lastUsed }], neverSave: [origin] }`.
- 임시 파일에 쓰고 `rename`, 권한 0600(jupyterlab-desktop의 `appdata.ts:278-280`과 같다).
- 시작할 때 `safeStorage.getSelectedStorageBackend()`를 확인한다. `basic_text`면 메모리에만
  보관하고 한 번 알린다.
- 복호화한 목록은 메인 메모리에만 둔다. 셸에는 목록 화면을 열 때 출처와 사용자 이름만
  보내고, 비밀번호는 "보기"나 "복사"를 누른 항목 하나만 보낸다. Min과 VS Code는 평문을
  UI 프로세스로 넘기는데, 따르지 않는다.

**감지와 채우기 (`browser-runtime/page-preload.ts`에 추가)**

- Min의 필드 휴리스틱과 제출 감지(`submit`, 제출 버튼 클릭)를 옮긴다. 스크립트로 그리는
  로그인 폼을 위해 포커스 시점에 필드를 다시 찾는다(Min의 포커스 처리기가 이미 그렇게 한다).
- 프리로드는 `{ username, password }`만 보내고 출처는 메인이 정한다.
- `https:`와 `localhost`만 대상으로 한다.
- 필드에 포커스가 가면 프리로드가 위치만 알리고, 메인이 기존
  `showContextMenu(owner, items, { source, point })`로 계정 메뉴를 띄운다. Min처럼 페이지
  DOM에 목록을 그리면 페이지가 그 요소를 읽거나 흉내 낼 수 있다.
- 단축키(Min의 `mod+\`)로도 같은 메뉴를 연다.

**저장 확인과 관리 화면 (셸)**

- 권한 요청과 같은 경로로 알린다(`BrowserPermissionRequest`가 주소창 아이콘으로 뜨는 방식).
  Min처럼 값을 고칠 수 있게 하고 "저장 / 이 사이트는 안 함 / 닫기"를 준다.
- `BrowserSidebar.svelte`에 "Passwords" 섹션: 검색, 보기, 복사, 수정, 삭제, 수동 추가,
  "저장 안 함" 목록.

**가져오기/내보내기 (CSV)**

- 내보내기 헤더는 Chrome과 같은 `name,url,username,password,note`. Min의
  `url,username,password`를 포함하므로 Min과도 호환된다.
- 가져오기는 헤더 별칭을 받는다. Brave의 Safari CSV 가져오기가 쓰는 목록이 좋은 출발점이다
  (`csv_safari_password_sequence.cc`): `url|website|origin|hostname|login_uri`,
  `username|user|login|account`, `password`, `notes`. `url`, `username`, `password`가 필수이고
  같은 열 이름이 두 번 나오면 오류다.
- 파서는 `core/browser/password-csv.ts`에 순수 함수로 둔다. Min은 `papaparse`를 쓰지만
  RFC 4180 파서는 작아서 직접 쓰는 편이 의존성을 늘리지 않는다.
- 중복(같은 출처·사용자 이름)은 Min처럼 가져온 쪽으로 덮어쓰되, 건수를 확인 대화상자에
  보여 준다. 북마크 가져오기와 같은 크기·개수 상한을 둔다.
- 내보낸 파일은 평문이다. Min처럼 내보내기 전에 확인을 받고 0600으로 쓴다.

**하지 않는 것: 다른 브라우저 프로필에서 직접 가져오기**

Brave는 Chrome의 `Login Data`를 읽지 않는다:
"We can't import passwords from Chrome due to encryption"
(`common/importer/chrome_importer_utils.cc:136-163`). 원본 브라우저의 OS 키링 항목이 있어야
복호화되기 때문이고, Brave끼리만 가능하다. Setdown도 CSV만 지원한다.

### 나중에 고려할 것

- 저장 기능이 생기면 `privacy.services.passwordSavingEnabled`를 실제로 구현할 수 있다.
  비밀번호 관리자 확장이 내장 저장을 끄는 데 쓰는 설정이다.
- Flatpak으로 배포하게 되면 `org.freedesktop.portal.Secret`이 앱별 마스터 비밀을 준다
  (`xdg-desktop-portal/data/org.freedesktop.portal.Secret.xml`). 지금의 일반 설치에서는
  `safeStorage`가 libsecret을 직접 쓰므로 필요 없다.

### 테스트

- 단위: 저장소 왕복(`safeStorage` 대역), `basic_text`에서 디스크에 쓰지 않음, 복호화 실패 시
  파일 보존, CSV 파서/직렬화 왕복과 헤더 별칭, 출처 일치 규칙(다른 포트·서브도메인·`http`는
  불일치).
- E2E: `test/support/browser/browser-fixture.ts`에 로그인 폼 페이지 추가. 제출 → 저장 확인 →
  재방문 시 메뉴로 채우기, 로드 직후에는 필드가 비어 있음, 교차 출처 iframe에 상위 페이지
  계정이 뜨지 않음, CSV 내보내기 후 다시 가져오기.

### 위험

- 보안 결정이 많다. "저장 + 메뉴로 채우기" → "관리 화면" → "CSV" 순으로 나눠 검토한다.
- 이름 휴리스틱은 놓치는 사이트가 있다. 관리 화면의 수동 추가가 그 구멍을 메운다.

---

## 2. 북마크 내보내기/가져오기

### 현재 상태

- **가져오기는 이미 있다.** Browser 패널의 "Import bookmarks…"가 Netscape 북마크 HTML을
  읽는다(`main/browser/bookmark-import.ts`의 `parseBookmarks`). 폴더 구조와 순서를 유지하고
  "Imported <날짜>" 폴더 아래에 넣으며 방금 가져온 묶음을 되돌릴 수 있다.
- **내보내기가 없다.** Places 서비스에 북마크 전체를 꺼내는 요청도 없다.
- `BookmarkNode`는 `{ id, parentId, kind, title, url?, order, batch? }`다. 추가 날짜가 없다.

### 참고 구현

| 출처 | 확인한 내용 | 반영 |
| --- | --- | --- |
| Brave (`ios/browser/api/bookmarks/exporter/bookmark_html_writer.cc:60-69`) | 헤더 원문: `<!DOCTYPE NETSCAPE-Bookmark-file-1>`, 자동 생성 주석, UTF-8 `META`, `<TITLE>Bookmarks</TITLE>`, `<H1>Bookmarks</H1>`, `<DL><p>`. 항목에 `ADD_DATE`, `LAST_MODIFIED` | 헤더를 그대로 쓴다. Chrome이 만드는 파일과 같아진다 |
| Brave (`browser/ui/browser_commands.cc:183-190`) | 기본 파일명 `bookmarks_YYYY_MM_DD.html`, HTML 필터 | 같은 파일명 |
| Min (`js/bookmarkConverter.js`) | "Chrome will only parse the file if it contains newlines after each bookmark" | **항목마다 줄바꿈을 넣는다.** 빠뜨리면 Chrome이 못 읽는다 |
| Min (같은 파일) | 3일마다 `bookmarksBackup.html`로 자동 백업. 512바이트보다 작으면 쓰지 않는다. 데이터베이스가 날아간 뒤 빈 결과가 백업을 덮어쓰는 것을 막는다 | 선택 기능으로 권장(아래) |
| Min | 폴더 대신 태그를 쓰는 평면 구조. 가져올 때 `ADD_DATE`를 읽는다 | 구조는 참고하지 않는다. Setdown은 폴더를 유지한다 |
| Brave (`utility/importer/chrome_importer.cc`) | Chrome의 `Bookmarks` JSON 직접 읽기: 임시 복사본을 읽고, `roots.bookmark_bar`와 `roots.other`만 가져오며, 날짜는 1601년 기준 마이크로초라서 `time / 1'000'000.0 - 11644473600.0`으로 바꾸고, "Imported from <브라우저>" 폴더에 넣는다 | "Chrome에서 가져오기"를 만들 때의 명세 |
| aura-browser | 북마크가 UI 페이지의 `localStorage`에 평면 배열로 있다 | 참고할 것 없음 |

### 구현

1. `browser-runtime/bookmarks.ts`의 `BookmarkStore`에 전체 노드를 돌려주는 `all()`을 추가하고,
   `places.ts`에 `bookmark-export` 액션을 추가한다.
2. `core/browser/`에 `serializeBookmarks(nodes): string`을 둔다. `parseBookmarks`의 역함수다.
   - 위 Brave 헤더를 쓴다.
   - 폴더는 `<DT><H3>제목</H3>` 뒤에 `<DL><p>` … `</DL><p>`, 북마크는
     `<DT><A HREF="…">제목</A>`. 항목마다 줄바꿈.
   - 제목과 URL은 HTML 이스케이프한다. 형제 노드는 `order`로 정렬한다.
   - `parentId`가 가리키는 폴더가 없는 노드는 최상위로 올린다.
3. `browser-manager.ts`에 `browser:bookmark-export` 채널. 가져오기와 같은
   `pathDialog.showSaveDialog`를 쓴다.
4. `BrowserBookmarks.svelte`의 가져오기 버튼 옆에 "Export bookmarks…".

**날짜**: `ADD_DATE`를 왕복시키려면 `BookmarkNode`에 `added?: number`를 추가해야 한다(Dexie
스키마 변경 없이 필드만 추가 가능). 별표로 추가한 북마크는 `order`가 `Date.now()`라 사실상
추가 시각이다. 1차에서는 날짜 없이 내보내도 Chrome과 Firefox가 읽는다.

### 선택 확장

- **자동 백업**: Min처럼 주기적으로 `userData`에 HTML 백업을 쓴다. 북마크는 IndexedDB 한
  곳에만 있어서, 프로필이 손상되면 복구할 길이 없다. 크기 하한 검사를 함께 넣는다.
- **Chrome에서 가져오기**: 위 Brave 명세대로 `Bookmarks` JSON을 읽는다. 파일 하나라 쉽다.
- **병합**: 지금은 항상 "Imported <날짜>" 폴더로 들어간다. Brave(iOS)는 제목이 같은 폴더를
  합치고 URL 중복은 그대로 둔다.

### 테스트

- 단위: `parseBookmarks(serializeBookmarks(nodes))`가 구조·순서·제목을 보존, 특수 문자
  이스케이프, 빈 폴더, 고아 노드.
- E2E: `browser/bookmark-import.spec.ts`에 내보내기 → 새 프로필에서 가져오기 왕복 추가.

---

## 3. 웹 페이지 개발자 도구

### 현재 상태

- `View → Toggle Developer Tools`(Ctrl+Shift+I)는 `state().window.webContents`, 즉 **앱 셸**의
  도구를 연다(`main/menu/application-menu.ts`). 웹 탭을 검사할 방법이 없다.
- 웹 탭의 `webPreferences`에 `devTools: false`는 없다. API만 부르면 열린다.
- 웹 탭 컨텍스트 메뉴(`browser-context-menu.ts`)에 "검사" 항목이 없다.

### 참고 구현

| 출처 | 페이지 도구 | 앱 셸 도구 |
| --- | --- | --- |
| Min (`main/menu.js:322-360`) | Ctrl+Shift+I와 **F12**(단축키를 둘 주려고 숨긴 메뉴 항목을 하나 더 둔다). 선택된 탭의 `toggleDevTools` | Ctrl+Shift+**Alt**+I, 개발 모드에서만 |
| VS Code 내장 브라우저 (`browserDevToolsFeature.ts:65`, `browserView.ts:680`) | F12. 대상은 포커스가 아니라 **활성 편집기가 브라우저인지**로 정한다. `webContents.toggleDevTools()`를 인자 없이 호출 | Ctrl+Shift+I는 개발 빌드에서만 단축키로 걸고, 릴리스에서는 Help 메뉴에 둔다 |
| jupyterlab-desktop (`sessionwindow.ts:1390-1394`) | 자식 `WebContentsView`마다 `openDevTools()` | — |
| Theia, Pulsar | 없음(셸 도구만) | Pulsar는 Inspect를 개발 모드에서만 보여 준다 |

그 밖에 가져올 세부:

- **Inspect**: Min(`webviewMenu.js:276-278`)과 VS Code(`browserViewMainService.ts:714-715`)
  모두 컨텍스트 메뉴에서 `inspectElement(x, y)`를 부른다. VS Code는 빌드 종류로 막지 않는다.
- **열림 상태 알림**: VS Code는 `devtools-opened`/`devtools-closed`를 받아 UI에 상태를
  보낸다(`browserView.ts:280-287`). 버튼의 눌림 표시와 절전 보호에 쓸 수 있다.
- **도구 창에서의 단축키**: VS Code는 도구 창의 키 입력도 앱 단축키로 전달한다
  (`browserView.ts:475-478`). Min은 닫기 단축키(Ctrl+W)가 도구 창에 포커스가 있을 때 도구를
  닫게 한다(`main/menu.js:381-392`의 "a devtools window is focused, close it").
- 참고 구현 중 **탭 안에 도킹하는 것은 없다.** 전부 Electron 기본 동작(뷰에서는 분리 창)에
  맡긴다.
- Brave는 여는 방식을 바꾸지 않는다. 광고 차단 규칙을 Network 패널에 보여 주는 CDP 이벤트를
  추가했는데, Setdown의 범위는 아니다.

### 구현

1. **컨텍스트 메뉴**: `browserContextMenu`에 "Inspect"를 추가하고
   `contents.inspectElement(params.x, params.y)`를 부른다. 프레임 유효성을 확인하는 `action()`
   헬퍼가 이미 있다.
2. **단축키**: 웹 탭의 `before-input-event` 처리(Ctrl+T, Ctrl+W, Ctrl+F를 가로채는 곳)에
   F12와 Ctrl+Shift+I를 추가해 그 탭의 `toggleDevTools()`를 부른다. 열 때는
   `openDevTools({ mode: 'detach' })`로 분리 창을 명시한다.
3. **메뉴**: `Toggle Developer Tools`(F12, Ctrl+Shift+I)는 활성 탭이 웹 탭이면 그 탭을,
   아니면 지금처럼 셸을 대상으로 한다(VS Code의 "활성 편집기" 방식). 셸 도구는
   "Toggle App Developer Tools"(Ctrl+Shift+Alt+I, Min의 단축키)로 항상 열 수 있게 한다.
4. **절전 보호**: `browser-manager.ts`의 `reclaim` 안 `eligible` 조건식에
   `!entry.contents.isDevToolsOpened()`를 추가한다. 도구를 열어 둔 탭이 잠들면 디버깅이
   끊긴다.
5. **닫기**: Ctrl+W가 도구 창에 포커스가 있을 때는 도구만 닫는다(Min).

분리 창은 셸의 네이티브 뷰 배치(`browser:layout`), 드래그 가림막, 오버레이 캡처와 엮이지
않는다. 변경이 작고 회귀 위험이 낮다.

### 탭 안 도킹은 권하지 않는다

1판에서는 2단계로 적었다. `setDevToolsWebContents`로 별도 뷰에 그릴 수는 있지만, 그룹 영역
분할, 경계 드래그, 탭 이동 시 소유권, 가림막과 오버레이까지 모두 처리해야 한다. 참고 구현
어디에도 없는 기능이고, 분리 창으로 부족하다는 근거가 생기기 전에는 만들 이유가 없다.

### 확인이 필요한 점

- PDF 탭과 리더 화면은 셸이 직접 그린다. "Inspect"는 원본 웹 문서를 가리키므로 항목을
  비활성화한다.
- 탭을 다른 창으로 옮길 때 분리 창 도구가 유지되는지는 실제로 옮겨 봐야 안다.

### 테스트

- E2E: "Inspect" 후 `isDevToolsOpened()`가 참, 탭을 닫으면 도구 창도 닫힘, 도구가 열린 탭은
  절전 대상에서 빠짐, 문서 탭이 활성일 때는 셸 도구가 열림.
- 격리 디스플레이에서 분리 창이 사용자 데스크톱에 뜨지 않는지 확인한다.

---

## 4. 인터넷 사용 기록 삭제

### 현재 상태

- Browser 패널 History의 "Clear history…": 방문 기록 전체 삭제. 북마크는 유지한다
  (`places.ts`의 `delete-history`).
- 사이트 메뉴의 "Clear This Site's Data…": 현재 출처 하나의 쿠키, 저장소, 캐시를
  `session.clearData`로 지우고 새로고침한다.
- 모든 사이트의 쿠키·캐시를 한 번에 지우는 기능은 없다.

### 참고 구현

| 출처 | 지우는 것 | 눈여겨볼 점 |
| --- | --- | --- |
| Min (`!clearhistory`, `main/remoteActions.js:48-75`) | 방문 기록(북마크 제외) + 웹 파티션의 `clearStorageData` + 캐시 + DNS 캐시 + 인증 캐시 | 확인 한 번에 전부. 항목 선택도 시간 범위도 없다. 주석: `file://` 데이터는 지우지 않는다. 북마크 같은 브라우저 내부 데이터가 거기 있기 때문이다 |
| VS Code 내장 브라우저 (`browserSession.ts:367-372`) | 신뢰 상태, 기록, **권한**, 그리고 `electronSession.clearData()` | Electron 데이터만이 아니라 앱이 따로 들고 있는 상태도 함께 지운다. 지운 뒤 새로고침은 하지 않는다 |
| jupyterlab-desktop (`utils.ts:159-166`) | 캐시, 인증 캐시, 저장소 | `Promise.allSettled`로 실행한다. 하나가 실패해도 나머지가 실행되고 멈추지 않는다 |
| Brave (`browser/browsing_data/brave_clear_browsing_data.cc`) | Chromium의 항목 목록 + 종료 시 삭제 | 쿠키 삭제는 `ORIGIN_TYPE_UNPROTECTED_WEB`만 대상이다. **확장 출처는 지우지 않는다.** 북마크는 삭제 항목에 아예 없다 |

Electron 기반 셋(Min, VS Code, jupyterlab-desktop) 모두 시간 범위 없이 전체를 지운다.

### 확장 데이터 (1판 정정)

1판은 "`clearStorageData`를 쓰면 uBlock의 필터와 설정이 날아간다"고 썼다. uBO 소스를 보면
더 정확히 말할 수 있다.

- uBO의 IndexedDB(`uBlock0CacheStorage`)와 Cache Storage에는 **다시 만들 수 있는 캐시**만
  있다(컴파일된 필터 목록 등). `src/js/cachestorage.js:252`.
- 사용자 설정, 사용자 필터, 허용 목록은 `chrome.storage.local`에 있다:
  "User assets are NOT persisted in the cache storage"(`src/js/assets.js:885`).

따라서 확장 출처의 IndexedDB를 지워도 uBO는 캐시를 다시 만든다. 다만 다음 시작이 느려지고,
다른 확장은 IndexedDB에 사용자 데이터를 둘 수 있다. `clearStorageData`가
`chrome.storage.local`까지 지우는지는 확인하지 않았다. 결론은 같다: 기존 코드처럼 웹 출처
마스크를 쓰는 **`session.clearData`만 쓴다**(`extensions/extension-network.ts`의 주석).
Brave가 확장 출처를 삭제 대상에서 빼는 것과 같은 결정이다.

### 지울 수 있는 데이터 (Setdown 코드에서 확인한 위치)

| 항목 | 저장 위치 | 지우는 방법 |
| --- | --- | --- |
| 방문 기록 | `persist:setdown-places` IndexedDB | 기존 `places.deleteHistory()` |
| 쿠키, 사이트 저장소 | `persist:setdown-browser` 세션 | `session.clearData({ dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL'] })` |
| 캐시 | 같은 세션 | `clearData({ dataTypes: ['cache'] })`, `clearCodeCaches`, `clearSharedDictionaryCache` |
| HTTP 인증, DNS 캐시 | 세션 메모리 | `clearAuthCache()`, `clearHostResolverCache()` (Min과 같다) |
| 다운로드 목록 | `userData/browser-downloads.json` | `BrowserDownloads`에 목록 비우기 추가(파일은 지우지 않음) |
| 닫은 탭 기록 | 메모리의 `closedTabs` | 비우기. 열린 탭과 `browser-tabs.json`은 유지 |
| 사이트 설정 | `userData/browser-theme-settings.json`(원본 색 유지 사이트), 메모리의 권한 결정 | 각 모듈에 초기화 메서드 추가(VS Code가 권한을 함께 지우는 것과 같다) |
| 저장된 비밀번호 | (1절) | `PasswordStore.clear()` |

북마크는 Min과 Brave처럼 삭제 항목에 넣지 않는다.

### 구현

1. **메인**: `browser:clear-data` 채널 하나가 선택된 항목 목록을 받아 위 표의 동작을
   실행한다. 항목 이름은 허용 목록으로 검증한다. `Promise.allSettled`로 실행하고 실패한
   항목을 결과로 돌려준다.
2. **셸**: Browser 패널에 "Clear browsing data…" 대화상자. 항목별 체크박스, 기본 선택은
   방문 기록·쿠키·캐시. 비밀번호와 사이트 설정은 기본 해제.
3. **삭제 후 처리**: 쿠키나 저장소를 지웠으면 열린 웹 탭을 새로고침한다. 사이트별 삭제가
   이미 그렇게 한다. VS Code는 새로고침하지 않는데, 그러면 열린 페이지가 지워진 로그인
   상태를 화면에 그대로 보여 준다.
4. **진입점**: `Ctrl+Shift+Delete`, 명령 팔레트, History의 기존 버튼 옆.

### 시간 범위는 넣지 않는다

- `session.clearData`에는 시간 범위 옵션이 없다.
- 방문 기록은 URL별로 `lastVisit`과 `visitCount`만 저장한다.
- Electron 기반 참고 구현 셋 모두 전체 삭제만 한다.

### 선택 확장: 종료 시 삭제

Brave에는 항목별 "종료 시 삭제" 설정이 있다. 만든다면 Brave가 겪은 문제 둘을 그대로 따른다.

- 삭제가 끝날 때까지 종료를 미룬다(Brave는 종료 중에 동기적으로 기다린다).
- **OS가 세션을 끝내는 중이면 삭제를 건너뛴다**: "Do not clear browsing data when the OS is
  ending session"(`brave_clear_browsing_data.cc:186-190`). 로그아웃이나 재부팅 중에 지우다
  강제 종료되면 데이터가 깨진다.

### 테스트

- 단위: 항목 허용 목록 검증, 각 모듈의 초기화 메서드, 한 항목 실패 시 나머지가 실행됨.
- E2E(`browser/privacy.spec.ts` 확장): 쿠키와 `localStorage`를 심은 뒤 삭제하면 사라지고
  북마크는 남음, 캐시만 선택하면 로그인이 유지됨, **삭제 후에도 uBlock이 차단하고 사용자
  필터가 남아 있음**, 열린 탭이 새로고침됨.

---

## 결정 사항

서브모듈 조사로 권장안의 근거가 생긴 항목과, 여전히 선택이 필요한 항목을 나눈다.

**근거가 생겨 권장안을 굳힌 것**

| 결정 | 권장 | 근거 |
| --- | --- | --- |
| 비밀번호 채우기 시점 | 사용자 동작 후에만 | Min의 열쇠 버튼, Brave의 `wait_for_username = true` |
| 키링이 없을 때 | 메모리에만 보관하고 알림 (1판의 "거부"에서 변경) | VS Code |
| 개발자 도구 형태 | 분리 창만 (1판의 "2단계 도킹" 삭제) | 참고 구현 어디에도 도킹이 없음 |
| 삭제의 시간 범위 | 전체 기간만 | Electron 기반 셋 모두 |
| 다른 브라우저에서 비밀번호 직접 가져오기 | 하지 않음, CSV만 | Brave도 포기 |

**여전히 정해야 하는 것**

1. **개발자 도구 단축키**: 활성 탭이 웹 탭일 때 Ctrl+Shift+I가 페이지 도구를 열게 하면,
   지금 그 단축키로 셸 도구를 여는 습관이 바뀐다. 셸 도구는 Ctrl+Shift+Alt+I로 옮긴다.
2. **비밀번호 채우기 UI**: 네이티브 메뉴(권장, 페이지가 건드릴 수 없음) 대 Min처럼 페이지
   안의 열쇠 버튼(구현을 그대로 옮길 수 있고 눈에 잘 띔).
3. **북마크 자동 백업**을 내보내기와 함께 넣을지.
4. **종료 시 삭제**를 1차 범위에 넣을지. 권장은 나중이다.
