# 표 편집기와 링크 삽입 기능 구현 보고서

## 결론

Setdown Editor에 표 편집기와 URL·로컬 파일 링크 삽입 기능을 추가했다. 두 기능은 Markdown 원문을 감추는 범용 서식 도구가 아니라, 사람이 직접 처리하기 번거로운 구조 생성과 경로 escaping만 대신한다. Monaco model은 계속 편집 상태와 undo history의 단일 소유자이며, 삽입 결과도 평범한 Markdown 텍스트다.

## 제품 원칙

이번 기능은 다음 기준으로 범위를 정했다.

- 짧은 Markdown 문법을 대신 입력하는 toolbar는 만들지 않는다.
- 열 개수, 정렬, 셀 escaping처럼 손으로 맞추기 번거로운 구조는 UI가 생성한다.
- 파일 시스템 기준 경로와 Markdown destination escaping은 앱이 계산한다.
- 결과는 언제나 사용자가 Monaco에서 직접 읽고 수정할 수 있는 Markdown이어야 한다.
- 한 번의 삽입은 Monaco undo 한 번으로 되돌릴 수 있어야 한다.

## 표 편집기

Editor 탭 바에 표 아이콘을 추가했다. 대화상자는 다음을 편집한다.

- 1~12개 열
- 0~30개 데이터 행
- header 셀과 data 셀의 실제 내용
- 열별 기본·왼쪽·가운데·오른쪽 정렬

표 editor의 1~3열은 사용 가능한 가로 폭을 균등하게 나눈다. 4열부터는 열당 170px의 최소 폭을 유지하고 editor 내부에서 가로로 스크롤한다. 적은 열에서도 input의 intrinsic width 때문에 불필요한 스크롤이 생기지 않도록 grid 자체는 container 폭을 기준으로 배치한다.

생성 결과는 GFM pipe table이다.

```markdown
| 이름 | 값 |
| --- | ---: |
| alpha | 10 |
```

셀의 `|`는 `\|`로 escape하고 줄바꿈은 `<br>`로 직렬화한다. 현재 문서의 첫 newline을 감지해 LF, CRLF, CR 형식을 유지한다. 삽입 위치가 다른 block과 붙어 있으면 앞뒤 blank line을 자동으로 보완한다.

스프레드시트에서 복사한 tab-separated text를 선택하고 표 편집기를 열면 첫 행을 header로, 나머지를 data row로 불러온다. 사용자는 정렬이나 셀 내용을 확인한 뒤 Markdown 표로 치환할 수 있다.

삽입 후 첫 header를 선택한다. 따라서 사용자는 기본 `열 1` 값을 곧바로 덮어쓸 수 있다.

표 셀에서 Enter를 누르는 동작은 표 삽입을 확정하지 않는다. Enter는 다음 셀로, Shift+Enter는 이전 셀로 이동하며, 한글 IME 조합 중인 Enter는 가로채지 않는다. 표 삽입은 사용자가 `삽입` 버튼을 명시적으로 활성화했을 때만 실행된다.

## URL 링크

Editor 탭 바, Monaco context menu, 애플리케이션의 Insert 메뉴에서 링크 대화상자를 열 수 있다. `Ctrl/Cmd+K`도 같은 명령을 실행한다.

대화상자는 다음 값을 받는다.

- 표시할 텍스트
- URL 또는 상대 경로
- 선택적 title
- OS 파일 선택기로 고른 로컬 파일

destination은 항상 CommonMark angle destination으로 생성한다.

```markdown
[문서](<./My File (final).md> "설명")
```

이 형태는 공백과 괄호가 있는 경로를 별도 percent encoding 없이 명확하게 보존한다. label의 대괄호와 destination의 angle bracket, title의 quote와 backslash는 각 문맥에 맞게 escape한다.

텍스트를 선택한 상태에서 HTTP, HTTPS, mailto, tel URL을 붙여넣으면 대화상자를 거치지 않고 선택 영역을 링크로 변환한다. 선택 영역이 없고 붙여넣은 URL이 원격 이미지라면 기존 이미지 붙여넣기 동작을 유지한다.

## 로컬 파일 링크

로컬 파일은 main process의 OS 파일 선택기로 고른다. main process가 현재 문서 디렉터리에서 대상 파일까지의 상대 경로를 계산하고 separator를 `/`로 정규화한다. Windows에서 drive가 다르기 때문에 상대 경로를 만들 수 없는 경우에는 file URL로 fallback한다.

Untitled 문서는 최종 디렉터리가 없으므로 상대 경로를 확정할 수 없다. 이 경우 파일 선택에 앞서 Save dialog를 열어 문서를 저장한다. 저장을 취소하면 링크도 삽입하지 않는다. 임시 draft 디렉터리를 기준으로 조용히 잘못된 상대 경로를 만드는 동작은 허용하지 않았다.

renderer가 넘긴 문서 경로가 main process의 활성 문서와 다르거나 문서가 여전히 Untitled이면 파일 선택 IPC는 취소 결과를 반환한다. renderer가 임의의 다른 문서를 기준으로 경로를 계산하지 못하게 하는 경계다.

## 구조

`src/shared/markdown-insertions.ts`는 DOM이나 Monaco에 의존하지 않는 Markdown serializer다.

- `createMarkdownTable`
- `createMarkdownLink`
- `preferredEol`

`src/main/markdown-link.ts`는 로컬 파일의 portable Markdown destination만 계산한다. OS dialog와 IPC는 main process에 남기고, renderer에는 선택한 경로의 Markdown 표현만 반환한다.

renderer의 대화상자는 값을 수집한 뒤 `editor.executeEdits()`를 한 번 호출한다. 표와 링크 모두 Monaco undo stack, revision 증가, dirty 표시, debounced preview 갱신을 기존 경로 그대로 통과한다.

## CommonMark와 실제 renderer의 관계

링크 destination과 title escaping은 `vendor/commonmark-spec/spec.txt`의 Links 규칙을 기준으로 했다. 표는 CommonMark core가 아니라 GFM 확장이므로 실제 수용 여부는 Setdown의 Crossnote/markdown-it renderer로 검증해야 한다. serializer는 Crossnote가 기본 지원하는 보수적인 pipe table만 생성하며 Crossnote의 선택적 colspan/rowspan 확장은 생성하지 않는다.

## 검증

단위 테스트는 다음을 다룬다.

- 표 정렬 delimiter 생성
- 셀 pipe와 newline escaping
- 문서 newline 보존
- 공백과 괄호가 포함된 링크 destination
- label과 title escaping
- 로컬 파일 상대 경로의 `/` 정규화

Electron E2E는 실제 창에서 다음 순서를 검증한다.

1. Viewer에서 Editor로 전환
2. 2열 1행 표 구성
3. 오른쪽 정렬 설정
4. Monaco에 표 삽입
5. URL 링크 삽입
6. 저장
7. 디스크의 Markdown 결과 확인

구현 시점 검증 결과:

- TypeScript typecheck 통과
- Vitest 59개 통과
- Vite 및 Electron production build 통과
- 새 표·링크 Electron E2E 통과

## 의도적으로 제외한 범위

- 기존 Markdown 표를 다시 대화상자로 불러와 수정하는 round-trip editor
- 셀 병합과 rowspan/colspan 생성
- 여러 셀 붙여넣기의 CSV quote parser
- 링크 대상 존재 여부를 지속적으로 검사하는 diagnostics
- 원격 URL의 metadata를 읽어 title을 자동 생성하는 네트워크 요청
- 로컬 대상 파일을 문서 asset directory로 복사하는 attachment 기능

이 항목들은 단순 삽입과 다른 lifecycle을 가진다. 특히 기존 표 round-trip은 source range 탐지와 손실 없는 parsing이 필요하므로 별도 기능으로 다뤄야 한다.
