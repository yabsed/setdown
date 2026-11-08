# 주소창·브라우저 메뉴·시작 화면 정리

주소창이 좁아졌을 때 입력창처럼 긴 검색 버튼이 남고 다른 도구가 더보기로 숨겨지던 동작을 수정했다. Browser의 중복 Appearance와 비밀번호 관리 기능을 제거하고, 시작 화면에 Open Terminal을 추가했다. 기준 소스는 `94180fc`다.

## 동작

- 주소에 사용할 폭이 180 CSS px 미만이면 같은 자리의 28 px 돋보기 버튼으로 바뀐다. 여유 폭이 220 px 이상이면 주소 입력창으로 돌아가 남는 폭을 채운다. 글자 입력·IME 조합 도중에는 형태를 바꾸지 않는다.
- 확장 기능·사이트 정보·북마크·읽기 모드·확대/축소는 원래 도구 버튼으로 표시한다. 더보기 메뉴는 제거했다. 모든 버튼을 담을 수 없을 만큼 좁으면 도구 영역 안에서 가로로 스크롤하며, 옆 분할 화면을 침범하거나 콘텐츠 높이를 바꾸지 않는다.
- 돋보기를 누르면 주소 입력칸과 추천 목록만 열린다. 현재 주소를 입력칸에 선택된 상태로 넣어 복사·교체할 수 있다. 별도의 Current address 제목·주소 표시·Copy 버튼은 제거했다. Escape와 바깥 클릭으로 닫히며, 기존 Markdown URL 삽입창의 X 닫기 규칙과는 별개다.
- Browser 사이드바는 Bookmarks·History·Downloads·Extensions만 표시한다. 테마 설정은 View → Theme에서 계속 사용할 수 있고, 사이트별 원래 색상 설정은 사이트 정보 버튼에 남아 있다.
- 비밀번호 관리의 사이드바·열쇠 버튼·저장/채우기 코드·preload API·IPC·금고·잠금 감시기를 제거했다. 기존 암호화 파일은 삭제하지 않으며 더 이상 앱에서 읽지 않는다. 웹사이트 자체 로그인 폼과 HTTP 인증은 별도 기능으로 유지한다.
- 시작 화면의 Open Web Page 옆에 Open Terminal을 추가했다. 기존 터미널 생성 경로를 사용하여 현재 프로젝트 폴더에서 실행하고 입력 포커스를 넘긴다. 버튼들은 좁은 화면에서 기존처럼 줄바꿈한다.

## 검증

모든 GUI 검사는 Xvfb·별도 runtime directory·별도 D-Bus에서 실행했다. 기준본은 별도 체크아웃과 설치된 의존성, 동일한 고정 커밋의 vendor 소스를 사용했다. 양쪽 빌드는 `SETDOWN_BUILD_SOURCEMAP=0`이다. 최초 검증과 최종 성능 비교는 `MemoryMax=3G`, `MemoryHigh=2800M`, `MemorySwapMax=0`, workspace 분할 검증은 `MemoryMax=1800M`, `MemoryHigh=1600M`, `MemorySwapMax=0`에서 실행했다. 가용 메모리 2 GiB 미만에서 해당 검증 scope만 종료하는 감시기를 함께 사용했다.

비밀번호 기능 제거에 따라 그 기능의 단위 검사 2개와 Electron 검사 2개를 함께 제거했다. 주소창 검사에는 Browser의 네 메뉴, 비밀번호 버튼/API의 부재를 추가했고, 기존 터미널 수명 검사에는 시작 화면 버튼으로 새 PTY를 열어 실제 프로젝트 폴더에서 명령을 실행하는 확인을 추가했다. 다른 필수 시나리오와 성능 허용치는 유지한다.

최초 `npm run test:preview-contract` 실행에서 단위 검사 936개, 도구 검사 14개, 타입 검사와 프로덕션 빌드는 통과했다. 새 Browser 메뉴 확인 단계는 접힌 Folder Tools를 먼저 열지 않아 실패했다. 실제 UI의 Toggle Folder Tools 클릭을 추가해 진입 순서를 바로잡았으며, assertion·timeout·retry 설정은 변경하지 않았다. 수정 후 주소창과 시작 화면 터미널의 실제 Electron 검사 2개가 통과했다.

제품 코드는 최초 빌드 이후 바뀌지 않았다. 전체 Electron 재실행에서는 workspace 이전 239개 시나리오와 일부 workspace 검사가 완료됐지만, 가용 RAM이 1894 MiB로 내려가 감시기가 중단했다. [중단 로그](validation/electron-partial.log)와 [메모리 기록](validation/electron-partial-memory.json)을 보존했다. 남은 workspace 94개를 별도로 실행했으며, 이 중 92개는 통과하고 기존 드래그 검사 2개가 실패했다.

드래그 실패에는 `dragstart` 기록 자체가 없었다. 동일 조건의 진단에서 기준본은 16개 모두 통과했고 수정본은 다른 드래그 위치 1개가 실패했으므로, 기준본의 기존 오류라고 단정하지 않았다. 포인터·포커스 기록을 보강하고 테스트 준비 순서를 확인했다. 기존 helper는 탭의 선택 상태만 기다렸고, native reader의 문서 표시와 탭 배치 안정성을 확인하지 않고 원시 CDP 좌표로 드래그를 시작했다. 해당 시나리오에 현재 문서의 실제 표시 확인과 Playwright의 안정된 hover 단계를 추가했다. 드래그·네이티브 뷰 숨김·분할 위치·양쪽 문서 표시 assertion은 그대로 유지한다. [최초 workspace 실패](validation/electron-workspace.log), [기준본 진단](validation/drag-baseline-diagnosis.log), [수정본 진단](validation/drag-candidate-diagnosis.log), [포인터 기록 진단](validation/drag-input-trace.log)을 보존했다.

보강 후 [타입 검사](validation/typecheck-final.log)는 오류·경고 0개, [workspace 전체 검사](validation/electron-workspace-final.log)는 94개 모두 통과했다. 앞서 완료한 239개와 합쳐 계약 목록의 333개 시나리오가 누락 없이 검증됐음을 [목록 대조 결과](validation/electron-coverage.json)로 확인했다. 하나의 중단 없는 계약 실행이 성공한 것으로 표시하지 않는다. 최초 계약 실행의 메뉴 진입 실패는 [로그](validation/contract-initial.log)에 남겼다.

1800M 한도로 시작했던 성능 측정에서는 `memory.events high`가 337334회까지 증가했고 기준본의 Git 미리보기 표시가 30초 안에 완료되지 않았다. 이 실행은 실패한 불완전 측정이며 성공 결과에 포함하지 않았다. [제한된 실행 기록](benchmark-resource-limited/comparison.json)과 [실패 로그](benchmark-resource-limited/1-baseline.log)를 보존했다. 시스템 여유를 확인한 후 기준본·수정본 모두 동일한 3 GiB scope에서 새 비교를 시작했다. 소스·빌드·하네스·시나리오·허용치는 바꾸지 않았고, 최종 비교에서 메모리 제한에 따른 회수 이벤트는 관찰되지 않았다. 최종 실행의 [최저 가용 RAM](validation/benchmark-final-memory.json)은 3291 MiB였다.

## 최종 결과

| 검사 | 결과 | 기록 |
| --- | --- | --- |
| 계약 단위 검사 | 117개 파일, 936개 검사 통과 | [초기 계약 로그](validation/contract-initial.log) |
| 빌드·벤치마크 도구 검사 | 14개 통과 | [초기 계약 로그](validation/contract-initial.log) |
| 프로덕션 빌드·타입 검사 | 빌드 완료, 타입 오류·경고 0개 | [빌드 로그](validation/contract-initial.log), [최종 타입 검사](validation/typecheck-final.log) |
| 실제 Electron 계약 시나리오 | 239 + 94 = 333개, 분할 검증 완료 | [커버리지 대조](validation/electron-coverage.json) |
| 기준본 대비 전환 성능 | 각 버전 3회, 48개 비교 모두 기존 허용 기준 통과 | [전체 수치](benchmark-summary.md), [원시 결과](benchmark/comparison.json), [실행 로그](validation/benchmark-final.log) |

성능 결과는 모든 동작이 더 빨라졌다는 뜻은 아니다. 예를 들어 준비 대기 없이 수정한 Git review의 warm 캡처 중앙값은 176 → 226 ms였다. 첫 번째·두 번째·warm, 일반 Markdown·Git review, 수정 유무·준비 대기 유무를 각각 기록했고 기존 25%와 50 ms를 **모두 초과**하는 악화 기준은 변경하지 않았다. 이번 측정은 전환 지연이며 메모리 절감률 측정이 아니다.

## 화면

- [Open Terminal이 추가된 시작 화면](welcome-terminal.png)
- [좁은 주소창의 돋보기와 원래 도구 버튼](compact-search-button.png)
- [넓어진 주소 입력창](expanded-address.png)
- [주소 입력과 추천만 있는 검색창](compact-search.png)
- [Appearance·Passwords를 제거한 Browser 메뉴](browser-sidebar.png)

작업은 소스와 개발용 프로덕션 빌드에 반영했다. 실행 중인 설치 앱의 교체·재시작은 하지 않았다.
