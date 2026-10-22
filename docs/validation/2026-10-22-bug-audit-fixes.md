# 잠재 버그 감사 후 수정 검증

검증일: 2026년 10월 22일. 대상은 [감사 보고서](../../reports/2026_10_22_potential_bug_audit.md)의 F01–F26이다. 수정 전 기준은 `2b85ddb`이며, 이 커밋의 제품 코드는 감사 당시 `c38b90d`와 같다.

26개 결함에 대한 수정을 적용했다. 저장 충돌과 외부 변경 보호, Git의 파일 선택 경계, 초안 자산 이전을 우선 처리했다. 감사 당시의 실패 재현은 그대로 보존하고, 해당 조건에서 올바른 동작을 요구하는 테스트를 정규 테스트 모음에 추가했다. 전체 단위 테스트 956개, 실제 Electron 189개와 성능 비교 48개 항목이 통과했다.

## 항목별 수정

아래에서 **감사 회귀**는 [bug-audit.integration.test.ts](../../apps/desktop/src/main/documents/bug-audit.integration.test.ts)의 해당 F 번호 테스트를 가리킨다. 임시 파일·실제 Git 저장소를 사용하며, 경쟁 조건에 필요한 완료 시점만 통제한다.

| ID | 수정한 동작 | 회귀 검증 |
| --- | --- | --- |
| F01 | 창별 감시 callback을 저장하고 해당 callback만 해제한다. | 감사 회귀: 다른 창의 listener 유지 |
| F02 | 파일 삭제·접근 불가를 외부 변경으로 전달한다. 화면에 버퍼가 보존됐음을 알리고 자동 재로딩을 막는다. | 감사 회귀: 삭제 이벤트 전달 |
| F03 | UUID와 독점 생성으로 임시 파일을 구분한다. main의 목적지별 큐 안에서 충돌 확인과 저장을 수행한다. | 감사 회귀, 두 창 자동 저장 충돌, 임시 파일 작성 중 외부 변경 취소·정리 |
| F04 | 임시 파일 생성 후 기존 권한을 복원해 umask의 영향을 제거한다. | 감사 회귀: `0666` 유지 |
| F05 | Save As 목적지의 심볼릭 링크를 먼저 해석한다. 끊어진 링크도 대상 파일을 생성하고 링크 자체는 보존한다. | 감사 회귀, dangling symlink 저장 |
| F06 | Markdown 구문으로 확인한 목적지와 HTML `src`·`href`·`poster`만 재작성한다. 코드·본문·외부 URL은 보존한다. | 감사 회귀, [asset-references.test.ts](../../apps/desktop/src/core/markdown/asset-references.test.ts) |
| F07 | 자산 경로 비교에는 디코딩한 경로를 쓰고 새 목적지는 세그먼트별로 인코딩한다. | 감사 회귀, 참조 정의·중첩 인용·괄호·CRLF 보존 |
| F08 | Git hunk 내부와 파일 헤더를 구분해 `---`·`+++` 본문도 변경으로 센다. | 감사 회귀: hunk 시작·길이 |
| F09 | rename의 이전 경로를 보존해 HEAD를 읽고, patch 조회에도 이전 경로를 포함한다. | 감사 회귀: 원문 보존, 내용 불변 rename의 hunk 없음 |
| F10 | Git 실행 경계에 `--literal-pathspecs`를 적용한다. | 감사 회귀: `[ab].txt` 선택 시 다른 파일의 Stage·Discard 방지 |
| F11 | 저장소가 아니라는 탐색 결과는 캐시에 고정하지 않는다. | 감사 회귀: 외부 `git init` 직후 재탐색 |
| F12 | Git 조작에서 마지막 심볼릭 링크 항목을 보존한다. working-tree 비교도 대상 본문 대신 링크 값을 읽는다. | 감사 회귀: Stage·Discard 후 대상 파일 보존 |
| F13 | Unicode 대소문자 무시 검색을 원문에서 수행하고 원문 오프셋을 반환한다. | 감사 회귀, 실제 Chromium에서 `İ` 뒤의 검색 결과 |
| F14 | 복사 중 소유한 임시 디렉터리에 필요한 쓰기 권한을 유지하고 완료 후 원래 권한을 복원한다. 실패 정리도 읽기 전용 하위 폴더를 처리한다. | 감사 회귀: 원본·복사본 `0555`, 임시 폴더 잔존 없음 |
| F15 | 코드 셀 직렬화에서 Markdown 전용 attachments를 제외한다. | 감사 회귀, 실제 `nbformat.validate` |
| F16 | Markdown을 같은 파일 핸들에서 읽고 전후 상태와 현재 경로의 inode를 확인한다. 변경이 끼어들면 읽기를 거부한다. | 감사 회귀: 내용과 버전이 어긋나는 읽기 차단 |
| F17 | 저장 응답의 자산 이동 정보를 최신 편집 버퍼에도 적용한다. 새 입력과 dirty 상태를 유지한다. | 감사 회귀, [text-workspace.test.ts](../../apps/desktop/src/renderer/workspace/text-workspace.test.ts)의 모델·revision 검사 |
| F18 | 붙여넣은 이미지와 로컬 문서 링크의 예약 문자를 인코딩한다. Crossnote의 중복 인코딩도 경로 해석 어댑터에서 처리한다. | 감사 회귀, 실제 이미지 로딩·문서 열기, 예약 문자를 포함한 상위 폴더 |
| F19 | 일반 New File로 만든 HWPX에도 유효한 빈 문서 템플릿을 쓴다. 빌드 시 빈 HWP를 변환하고 내용 손실·비어 있는 본문을 검사한다. | 감사 회귀, 실제 HWP 엔진에서 새 HWPX 본문과 section 검사 |
| F20 | 해제한 자동완성 명령에 제한된 유예 수명을 부여하고 메모리 압박 시 회수한다. 선택된 항목의 삽입 직후 명령은 유지한다. | 감사 회귀, [server-items.test.ts](../../apps/desktop/src/main/language/server-items.test.ts)의 명령 실행·만료 검사 |
| F21 | HWP를 nonblocking으로 열고 일반 파일 여부를 확인한다. | 감사 회귀: FIFO 거부 |
| F22 | 자동 저장 큐에 세대 번호를 적용하고 저장 시작 전과 준비 완료 후 활성화 상태를 다시 확인한다. | 감사 회귀: 비활성화 후 다음 탭 저장 금지 |
| F23 | Git Markdown을 기존 4 MB 문자열 한도 대신 16 MiB 바이트 경로로 읽는다. 없는 원본과 읽기 실패를 구분한다. | 감사 회귀: 4.1 MB 원문 전체 일치 |
| F24 | Reader 내보내기에 제목 자체의 id와 하위 anchor를 중복 없이 보존한다. | 감사 회귀: 제목 anchor |
| F25 | 실제 검색은 계산된 CSS와 조상 요소의 숨김 상태를 확인한다. 정적 프로젝트 색인도 inline 숨김 선언을 제외한다. | 감사 회귀, 실제 Chromium의 `display:none !important` 검색 제외 |
| F26 | 일반 URL 전체를 IPC에서 디코딩하지 않는다. Reader가 Crossnote 전송 포장만 한 번 해제하고 URL 파서에는 원래 escape를 넘긴다. | [open-link.test.ts](../../apps/desktop/src/main/ipc/open-link.test.ts), Reader 메시지 테스트, 실제 문서 링크 |

## 추가로 확인한 통합 경계

예약 문자 링크를 실제 Electron에서 검증하며 생성 함수만 수정해서는 충분하지 않음을 확인했다. Crossnote 0.9.35는 인코딩된 URL 경로를 파일명으로 결합해 `%23`을 `%2523`으로 바꾸고 있었다. 고정된 버전의 resolver에 작은 어댑터를 설치해 URL 경로를 먼저 해석한다. 이 어댑터는 Crossnote의 내부 메서드를 사용하므로, 의존성을 갱신할 때 [preview-local-links.spec.ts](../../apps/desktop/test/e2e/preview/preview-local-links.spec.ts)의 실제 렌더링 검사를 유지해야 한다.

Crossnote의 click 메시지는 URL 전체를 추가 인코딩해 전달한다. 이 전송 포장은 Reader에서 제거하고, 파일명 안의 `%23`·`%25`와 외부 쿼리의 `%26`은 보존하도록 경계를 분리했다. 기존 부모 상대경로 링크도 함께 검사한다.

HWPX의 기존 upstream fixture는 유효한 파일이지만 예시 본문을 포함하고 있었다. 새 문서에는 사용하지 않고, 기존 빈 HWP를 엔진으로 변환한 뒤 다시 열어 본문이 비어 있음을 빌드와 GUI 양쪽에서 검증한다.

## 테스트 결과

| 실행 | 결과 | 근거 |
| --- | --- | --- |
| `npm test` | 139개 파일, **956개 테스트 통과** | [전체 단위 로그](bugfixes-2026-10-22/unit-complete.log.txt) |
| `npm run test:preview-contract` | 단위 **554개**, tooling **11개**, 실제 Electron **189개 통과** | [전체 계약 로그](bugfixes-2026-10-22/contract-complete.log.txt) |
| TypeScript·Svelte·production build | 통과, Svelte 오류·경고 0개 | 위 계약 로그 |
| `nbformat.validate` | 5.11.0에서 코드 셀 변환 결과 통과 | [검증 로그](bugfixes-2026-10-22/notebook-validation.log.txt), [직렬화 결과](bugfixes-2026-10-22/converted-code-cell.ipynb) |
| `git diff --check` | 통과 | 변경 파일 공백 검사 |

전체 Electron 검사는 retries 0으로 8.8분 동안 수행했다. 포커스·한글 IME·최신 revision·native bounds·zoom·일반 문서와 Git review 시나리오를 유지했다. 추가된 로컬 링크 GUI 테스트도 필수 계약 목록에 포함했다. 구현·테스트·의존성 파일 48개의 해시는 [source-sha256.json](bugfixes-2026-10-22/source-sha256.json)에 기록했다.

수정 과정의 실패도 남겼다. [초기 링크 검사](bugfixes-2026-10-22/local-links-before-transport-fix.log.txt)와 [실제 중복 인코딩 요청](bugfixes-2026-10-22/resource-url-before-fix.json)을 근거로 전송 포장·리소스 경로를 수정했다. [최종 요청](bugfixes-2026-10-22/resource-url-complete.json)은 예약 문자를 보존하고 이미지의 실제 너비가 1임을 보여준다. Crossnote 어댑터의 타입 선언 오류는 [타입 검사 로그](bugfixes-2026-10-22/contract-before-resolver-types.log.txt)에 있으며 수정 후 전체 계약 검사가 통과했다. 구현을 보완하기 전에 중단한 전체 실행은 통과 건수에 포함하지 않았다.

## 미리보기 성능 비교

별도 설치된 기준 checkout `/tmp/setdown-bugfix-base-2b85ddb`와 변경본을 비교했다. 기준과 변경본은 각각 독립된 `node_modules`를 사용하며 Electron 44.7.2와 Crossnote 0.9.35는 동일하다. 두 앱을 같은 격리 Xvfb에서 실행하고 AB/BA 순서를 교대했다.

기준본의 renderer·main 빌드와 변경본의 전체 production build를 완료한 뒤 `--skip-build`로 측정했다. 기준본은 자체 `npm ci` 설치를 사용하며, 공유 `node_modules` 링크는 없다. 벤치마크가 두 빌드의 해시와 fixture·harness 동일성을 기록하고 측정 전후 빌드 불변을 확인했다.

일반 Markdown·Git review × 편집 없음·있음 × 준비 시간 0·3000ms의 8개 시나리오를 사용했다. 각 앱에서 첫 번째·두 번째·3–5번째 전환을 구분하고, Esc부터 최신 내용의 native capture까지와 double-click부터 편집기로 돌아오기까지를 각각 측정했다. 증가율 25%와 절대 증가 50ms를 동시에 넘으면 회귀로 판단하는 기존 기준을 유지했다.

**80회 앱 실행, 48개 비교 항목 모두 통과했으며 허용 기준을 넘는 회귀는 0개다.**

[전체 측정과 빌드·fixture·harness 해시](bugfixes-2026-10-22/preview-comparison.json), [실행 로그](bugfixes-2026-10-22/preview-benchmark.log.txt).

아래 수치는 ms 단위의 **기준 → 변경**이다. 첫 번째와 두 번째 값은 독립 실행 5회의 중앙값이며, Warm은 각 실행의 3–5번째 전환 중앙값을 다시 5회에 걸쳐 집계했다. Esc 측정은 최신 내용의 native capture까지이며 실제 모니터 표시 시각과는 다르다.

### Esc에서 최신 내용 캡처까지

| 대상 | 편집 | 준비 시간 | 첫 번째 | 두 번째 | Warm |
| --- | --- | --- | ---: | ---: | ---: |
| Markdown | 없음 | 0ms | 36 → 36 | 22 → 22 | 20 → 19 |
| Markdown | 있음 | 0ms | 455 → 451 | 94 → 104 | 91 → 91 |
| Markdown | 없음 | 3000ms | 42 → 41 | 23 → 15 | 21 → 23 |
| Markdown | 있음 | 3000ms | 107 → 105 | 101 → 95 | 90 → 93 |
| Git review | 없음 | 0ms | 1045 → 1081 | 21 → 22 | 29 → 30 |
| Git review | 있음 | 0ms | 1116 → 1142 | 1604 → 1656 | 177 → 178 |
| Git review | 없음 | 3000ms | 24 → 26 | 26 → 20 | 18 → 17 |
| Git review | 있음 | 3000ms | 231 → 229 | 183 → 187 | 179 → 175 |

### Double click에서 편집기까지

| 대상 | 편집 | 준비 시간 | 첫 번째 | 두 번째 | Warm |
| --- | --- | --- | ---: | ---: | ---: |
| Markdown | 없음 | 0ms | 18 → 26 | 34 → 33 | 13 → 12 |
| Markdown | 있음 | 0ms | 21 → 21 | 13 → 16 | 14 → 13 |
| Markdown | 없음 | 3000ms | 16 → 16 | 13 → 12 | 12 → 11 |
| Markdown | 있음 | 3000ms | 18 → 19 | 13 → 14 | 13 → 13 |
| Git review | 없음 | 0ms | 21 → 23 | 11 → 12 | 12 → 12 |
| Git review | 있음 | 0ms | 14 → 15 | 21 → 23 | 20 → 19 |
| Git review | 없음 | 3000ms | 25 → 24 | 11 → 12 | 17 → 18 |
| Git review | 있음 | 3000ms | 23 → 22 | 18 → 19 | 17 → 18 |

재현 명령:

```sh
npm test
npm run test:preview-contract
npm run bench:preview -- --baseline /tmp/setdown-bugfix-base-2b85ddb --skip-build --output /absolute/path/to/new-results
```

`--skip-build`는 두 checkout의 production build가 완료된 경우에 사용한다. 결과 디렉터리는 새 경로여야 한다.

## 검증 범위와 동작상 제한

GUI는 Linux의 격리된 Xvfb·runtime·D-Bus에서 실행한다. Windows와 macOS의 네이티브 실행 결과를 뜻하지 않는다. 자동 저장을 끄면 아직 시작하지 않은 작업은 취소하지만 이미 시작한 파일 I/O는 완료한다.

파일 저장 큐는 이 앱 프로세스의 요청을 직렬화한다. 외부 프로그램에는 같은 큐를 강제할 수 없으므로, 디스크 버전을 저장 직전 다시 확인해도 OS의 rename과 외부 쓰기를 하나의 트랜잭션으로 보장하지는 않는다. Git 원본 읽기가 16 MiB 한도를 넘거나 실패하면 빈 문서로 위장하지 않고 비교 불가 상태를 반환한다.

자산 재작성은 일반 Markdown 목적지·참조 정의와 HTML `src`·`href`·`poster`를 대상으로 한다. CSS URL이나 HTML `srcset`까지 지원한다는 의미는 아니다. 검색의 대소문자 무시는 Unicode 정규식 규칙을 사용하며 악센트 제거·언어별 음가 검색을 추가하지 않는다.
