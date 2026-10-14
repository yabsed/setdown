# Chrome Web Store 확장 설치

Setdown의 Browser → Extensions에서 **Install from Chrome Web Store…**를 누른다.
확장 상세 페이지의 링크 또는 32자리 확장 ID를 붙여 넣고 **Install extension**을 누르면,
패키지를 받은 뒤 이름·버전·요청 권한을 확인하는 창이 열린다. Install을 선택해야 확장이 실행된다.

현재 `chromewebstore.google.com/detail/…` 링크, 이전 `chrome.google.com/webstore/detail/…` 링크,
ID 단독 입력을 지원한다. **Browse Chrome Web Store**로 스토어를 탐색한 뒤 링크를 입력할 수 있다.
스토어 웹페이지 자체의 설치 버튼을 바꾸는 연동은 포함하지 않는다.

설치한 확장은 기존 목록에서 Popup/Options를 열거나 Disable/Enable/Remove로 관리한다.
앱을 다시 열면 같은 ID로 복원한다. **Update from Web Store**는 최신 패키지를 다시 받아 확인 후 교체한다.
꺼 둔 확장은 업데이트해도 꺼진 상태를 유지한다. 자동 업데이트는 하지 않는다.

## 구현 경계

- `electron-chrome-web-store@0.13.0`의 `downloadExtension`을 재사용한다. Google의 다운로드 경로,
  CRX 해제 및 공개 키 처리는 이 라이브러리가 담당한다. 최초 스토어 설치 요청 때만 import한다.
- 목록 링크에서 ID만 추출한다. 임의 URL을 다운로드 대상으로 사용하지 않는다.
- 요청한 ID, 패키지 ID, manifest 공개 키에서 얻은 ID를 일치시킨 뒤 기존 staging/확인/registry 경로로 넘긴다.
- ID 비교는 CRX 암호학적 서명 검증과 다르다. 사용 중인 라이브러리는 서명을 검증하지 않으며 기존 설치 확인창에도 이를 표시한다.
- 다운로드와 확인 단계에서는 확장 코드를 실행하지 않는다. 취소·다운로드 실패·요청 창 종료 시 준비 파일을 정리한다.
- 한 번에 하나의 설치 확인을 처리한다. 설치 교체·활성화·삭제는 registry 변경 순서를 직렬화한다.
- 활성 확장 업데이트에서 native load 또는 저장 실패가 발생하면 이전 파일·설정된 활성 상태로 되돌린다.
  프로세스 강제 종료까지 원자적으로 복구하는 transaction journal을 구현한 것은 아니다.
- 내장 uBlock은 Setdown이 관리하며, 같은 ID의 수동 설치로 덮어쓸 수 없다.
- 별도 extension profile이나 updater를 만들지 않고 기존 browser session과 `browser-extensions.json`을 사용한다.
- 다운로더의 네트워크 동작과 CRX 해제는 upstream 구현을 따른다. 별도 다운로드 취소 UI/진행률/시간 제한은 이번 범위에 포함하지 않는다.

Electron의 확장 API 호환성 한계는 유지된다. 설치 성공은 모든 API와 사이트에서의 정상 동작을 보장하지 않는다.
실제 스토어 검증에서는 2026-10-14에 **Dark Reader 4.9.133 (Manifest V3)**을 다운로드·설치했고,
`Dark Reader settings` 팝업이 열리며 renderer가 충돌하지 않는 것을 확인했다. 전체 기능 호환성 판정은 아니다.

## 검증

- 링크/ID 검증, 다운로드 ID 불일치, 취소 시 정리, 업데이트 실패 복구, 변경 순서, 비활성 상태 유지에 대한 단위 검사.
- 실제 CRX3를 로컬 HTTP fixture로 전달하는 Electron E2E: UI 입력, 확인 취소/승인, content script 실행,
  같은 ID로 업데이트, 다운로드 실패 시 기존 버전 유지, 재시작 복원, 비활성화와 삭제.
  다운로드 응답과 native 확인창의 사용자 선택만 제어하고 upstream 해제·제품 설치·native 확장 로딩을 실행한다.
- 실제 Google 다운로드를 사용한 별도 smoke 검사: 격리된 Xvfb와 임시 프로필에서 Dark Reader 설치·팝업 실행.
- 기존 `.crx` 파일 설치기의 CRX3 ZIP 시작 위치를 `12 + headerSize`로 수정했다. CRX2 경로와 함께 검사한다.

전체 단위 테스트 **96개 파일 / 688개 사례**와 `npm run test:preview-contract`가 통과했다.
계약 검사는 TypeScript·빌드, Svelte 오류/경고 0개, 단위 41개 파일/282개 사례, 비교기 자체 검사 3개,
격리된 실제 Electron GUI **87개 사례**를 포함한다. 시나리오 생략이나 재시도는 추가하지 않았다.

### 비교 성능

원본 `06fa9d6b6f923b67c76e9b4f651083aad44509d3`을 별도 checkout에 독립 설치한 뒤 다음 명령으로 검사했다.

```sh
npm run bench:preview -- --baseline /tmp/setdown-webstore-baseline-20261014 --runs 5
```

같은 격리 Xvfb에서 AB/BA 순서를 교대해 버전별 5회 × 8개 시나리오, 총 **80개 새 앱 실행**을 완료했다.
누락·오래된 편집 내용·빌드 hash 변경 없이 **48개 비교 항목 모두 통과**했다.
기존 회귀 기준인 **25%와 50ms를 동시에 초과하는 증가**는 바꾸지 않았다.
표는 원본 → 변경본의 중앙값(ms)이다. warm은 각 실행의 3–5번째 cycle 중앙값을 다시 집계한다.
준비 대기 0/3000ms는 입력 전 조건이며 표의 지연에 합산하지 않는다. Esc는 최신 내용의 native capture까지,
복귀는 실제 double-click부터 editor까지 측정한다. 모니터 표시 시각이나 P95 측정은 아니다.

| 대상 | 준비 대기 | 편집 | 동작 | 첫 cycle | 두 번째 | warm |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Markdown | 0ms | 없음 | Esc → Reader | 28 → 34 | 18 → 24 | 24 → 19 |
| Markdown | 0ms | 없음 | double-click → Editor | 16 → 17 | 36 → 36 | 12 → 13 |
| Markdown | 0ms | 있음 | Esc → Reader | 448 → 438 | 102 → 97 | 91 → 91 |
| Markdown | 0ms | 있음 | double-click → Editor | 16 → 15 | 14 → 13 | 15 → 14 |
| Markdown | 3000ms | 없음 | Esc → Reader | 41 → 41 | 18 → 20 | 25 → 22 |
| Markdown | 3000ms | 없음 | double-click → Editor | 15 → 16 | 14 → 13 | 12 → 11 |
| Markdown | 3000ms | 있음 | Esc → Reader | 122 → 92 | 101 → 99 | 92 → 90 |
| Markdown | 3000ms | 있음 | double-click → Editor | 19 → 20 | 14 → 13 | 16 → 16 |
| Git 리뷰 | 0ms | 없음 | Esc → Reader | 980 → 997 | 24 → 25 | 28 → 29 |
| Git 리뷰 | 0ms | 없음 | double-click → Editor | 26 → 23 | 12 → 12 | 12 → 12 |
| Git 리뷰 | 0ms | 있음 | Esc → Reader | 1051 → 1118 | 1509 → 1546 | 174 → 179 |
| Git 리뷰 | 0ms | 있음 | double-click → Editor | 22 → 24 | 20 → 19 | 18 → 17 |
| Git 리뷰 | 3000ms | 없음 | Esc → Reader | 29 → 24 | 23 → 21 | 20 → 18 |
| Git 리뷰 | 3000ms | 없음 | double-click → Editor | 23 → 24 | 11 → 12 | 17 → 16 |
| Git 리뷰 | 3000ms | 있음 | Esc → Reader | 226 → 228 | 187 → 182 | 177 → 186 |
| Git 리뷰 | 3000ms | 있음 | double-click → Editor | 22 → 22 | 19 → 19 | 18 → 17 |

### 로컬 검사 원본

- [전체 단위 테스트](../test-results/chrome-web-store-20261014/units.log)
- [전체 계약 검사](../test-results/chrome-web-store-20261014/preview-contract.log)
- [확장 E2E](../test-results/chrome-web-store-20261014/extensions-e2e.log)
- [실제 Chrome 웹 스토어 다운로드·설치·팝업 확인](../test-results/chrome-web-store-20261014/live-store.log)
- [실제 스토어 확인 스크립트](../test-results/chrome-web-store-20261014/live-store-smoke.cjs)
- [80회 측정과 48개 비교의 원본 JSON](../test-results/chrome-web-store-preview-comparison-20261014/comparison.json)
- [성능 검사 실행 로그](../test-results/chrome-web-store-20261014/benchmark.log)

`test-results/`는 로컬 artifact이며 Git 추적 대상이 아니다. 위 결과 표는 문서에 유지한다.

관련 코드: [입력 검증](../apps/desktop/src/core/browser/web-store.ts),
[확장 설치·복구](../apps/desktop/src/main/browser/browser-extensions.ts),
[설치 확인 IPC](../apps/desktop/src/main/browser/browser-manager.ts),
[확장 UI](../apps/desktop/src/renderer/browser/BrowserExtensions.svelte),
[실제 확장 E2E](../apps/desktop/test/e2e/browser-extensions.spec.ts).

Upstream: [electron-chrome-web-store](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-web-store),
[Electron Extensions API](https://www.electronjs.org/docs/latest/api/extensions-api).
