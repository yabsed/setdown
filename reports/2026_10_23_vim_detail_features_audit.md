# Vim 세부 기능 분석 — Setdown에 가져올 동작과 구현 순서

작성일: 2026-10-23 · 대상: 로컬 `vendor/vim` · 결과물: 조사·설계 보고서. 제품 구현 변경은 하지 않았다.

## 1. 결론

Vim에서 가장 먼저 가져올 것은 **편집 중에 생기는 위치·결과·복사 내용·설정의 맥락을 잃지 않게 하는 기능**이다. 키 하나로 여러 글자를 지우는 속도도 중요하지만, Setdown에서 더 큰 차이를 만드는 것은 다음과 같은 동작이다.

1. 검색 A → 정의 이동 → 검색 B 이후에도 검색 A의 결과와 선택 위치로 돌아간다.
2. 같은 파일 안에서 함수 정의를 따라갔다가 정확한 원래 열로 돌아간다. 마지막으로 수정한 곳에도 별도로 돌아간다.
3. 복사한 문단을 보관한 채 다른 문장을 삭제하고, 보관한 문단을 다시 붙인다.
4. 따옴표 안, 괄호 안, 문단, Markdown 절처럼 의미 있는 범위에 명령을 적용한다.
5. 같은 종류의 편집을 다른 위치에서 다시 실행한다. 한글 조합이나 자동완성 중간 상태는 반복 대상으로 삼지 않는다.
6. “왜 이 파일에서는 import를 못 찾는가”, “왜 들여쓰기가 4칸인가”에 적용된 설정과 출처로 답한다.

**첫 도입 묶음은 결과 목록 이력, 위치 이력, 설정 출처 표시, 복사 저장소, 기존 Monaco 명령의 노출**을 권한다. 텍스트 객체와 마지막 편집 반복은 그다음이다. 영구 Undo·분기 Undo·완전한 Vim 모드는 별도 규모의 작업으로 다루는 편이 타당하다.

이번 보고서는 14개 영역, **125개 기능 항목**을 분류했다. 동일 단축키의 변형을 모두 독립 기능으로 세지는 않았다. 넓은 범위의 기능 목록과 우선순위가 높은 부분의 구현 분석을 결합했다. Vim 전체 C 코드, 모든 플랫폼, 모든 runtime 플러그인을 전수 검증했다는 뜻은 아니다.

우선순위·현재 상태별로 정렬할 수 있는 [기능 목록 CSV](vim-feature-audit-2026-10-23/feature-inventory.csv)도 함께 제공한다. 빠르게 판단하려면 1·3·9절, 기능별 검토에는 4절, 설계 검토에는 5–8절, 재현 범위 확인에는 10절을 읽으면 된다.

## 2. 조사 기준과 증거의 수준

| 대상 | 기준 | 의미 |
| --- | --- | --- |
| Vim 소스 | `f9b3d0d8dd1a4345375fb401861d5f60ff7c7df1`, `v9.2.1225` | `vendor/vim`의 실제 checkout을 기준으로 했다. |
| Setdown | HEAD `62e2c88cfd32bee6d3ef922c242a8c301465279d` 및 조사 시점 working tree | `.gitmodules`와 Vim gitlink 추가는 이미 staged 상태였다. 이를 변경하지 않았다. |
| 실제 편집기 의존성 | Monaco `0.56.0`, Electron `44.7.2` | [desktop package](../apps/desktop/package.json). `vendor/monaco-editor`와 npm 설치본을 혼동하지 않는다. |
| 동작 재현 | `/usr/bin/vim`, Vim 9.2, patches 1–1129, Fedora 빌드 | 분석 소스보다 이전 patch level이다. 소스 checkout을 빌드한 결과로 표시하지 않는다. |
| Python runtime 재현 | 위 실행 파일에 checkout의 `runtime/ftplugin/python.vim` 직접 적용 | 적용·해제 동작만 확인했다. Python LSP나 Python omni-completion 실행 검증은 아니다. |
| 제품 검증 | 소스·계약·설치된 Monaco contribution 검사 | Setdown GUI에서 125개 기능을 실제 조작한 결과는 아니다. |

근거를 다음처럼 읽으면 된다.

- **제품**: Setdown의 코드·계약에 해당 기능의 구현이 있다. Vim과 세부 의미가 같다는 보장은 별개다.
- **기반**: 설치된 Monaco에 관련 구현·명령이 있고 Setdown이 editor main을 로드한다. 앱 메뉴 노출, 키 충돌, 문서 종류별 실행은 추가 GUI 확인이 필요하다.
- **부분**: 비슷한 기능이 있지만 범위·이력·수명·정책이 다르다.
- **제안**: 검토한 제품 경로에서 대응하는 서비스·명령을 확인하지 못했다. 새로 도입할 후보다.
- **보류**: 이식 비용, 중복, 제품 적합성을 고려해 후순위 또는 제외로 판단했다.

우선순위 **P0**는 최초 도입 묶음, **P1**은 기반을 만든 뒤 추가, **P2**는 수요·비용 확인 후 결정, **P3**는 현재 권장하지 않음을 뜻한다. 긴급 버그의 심각도나 작업 기간 추정이 아니다.

본문의 동작 근거는 고정된 로컬 도움말·소스가 우선한다. 온라인 [Vim motion 문서](https://vimhelp.org/motion.txt.html)는 operator와 이동의 결합을, [Quickfix 문서](https://vimhelp.org/quickfix.txt.html)는 일반적인 파일 위치 목록과 이력을 설명하는 보조 링크다. 온라인 문서의 최신 상태를 로컬 pin에 자동 대입하지 않았다.

### 2.1 구분해야 하는 네 층

| 층 | 예 | 이번 보고서에서의 취급 |
| --- | --- | --- |
| Vim core | motion, operator, register, undo, quickfix, buffer/window | 동작 계약과 상태 관리 구조를 분석한다. |
| 기본 runtime | Python/Markdown ftplugin, syntax, compiler 정의 | 언어별 작은 정책과 적용·해제 패턴을 참고한다. |
| 동봉 선택 패키지 | `editorconfig`, `comment`, `hlyank`, `matchit`, `cfilter`, `netrw` | 소스에 포함되어도 모든 설치에서 기본 활성화라고 쓰지 않는다. |
| 외부 생태계·다른 제품 | coc.nvim, 별도 LSP 클라이언트, Neovim 기능 | Vim core의 기본 기능으로 계산하지 않는다. 이번 submodule 이식 분석의 직접 대상이 아니다. |

특히 **Vim을 도입하면 처음의 Python import 밑줄 문제가 저절로 사라지는 것은 아니다.** 파일 경로를 찾는 `gf`, Python의 정적 분석, 노트북 커널의 실행 환경은 서로 다른 문제다. 자세한 연결은 6.1절에 정리했다.

## 3. Setdown이 이미 가진 기반

기능을 새로 만든다고 선언하기 전에 기존 구현을 구분해야 한다.

| 기반 | 실제 확인한 내용 | Vim에서 더 배울 차이 |
| --- | --- | --- |
| Monaco 명령 | 정렬, 행 결합, 대소문자·이름 형식 변환, 다중 커서, 선택 확장·축소, 괄호 선택, cursor undo | 명령을 발견하고 일관된 문맥에서 실행하도록 연결하는 제품 작업 |
| 언어 지원 | completion, hover, definition, references, rename, format, code action, semantic token, selection range, 계층 탐색 등 | “기능을 추가”하기보다 결과 이력·환경 설명·설정 출처를 보완 |
| 모델 소유권 | `DocumentModelOwner`가 텍스트와 Undo를 소유하고 view가 lease를 받음 | 같은 문서의 독립된 여러 view, view별 위치 목록에 적합한 출발점 |
| editor groups | split tree, 탭 이동, 그룹별 preview tab, 편집 시 pin | Vim window와 buffer의 다대일 관계까지 이미 완성됐다는 뜻은 아님 |
| 탭 방문 이력 | 파일·웹·터미널 방문, 같은 URL은 현재 항목 갱신, 최대 64개 | 같은 파일 내부의 여러 정확한 커서 위치 이력과 다름 |
| 검색 | 프로젝트 검색의 취소·최신 요청 검사, 열린 문서 내용 반영, source/reader 구분 | 검색 결과 집합 자체의 이력, 재방문, 배치 처리 |
| 저장 | 경로별 직렬화, 외부 변경 충돌, 원자적 쓰기, 임시 draft 파일 | crash recovery, 세션 복원, 영구 Undo는 각각 별도 계약 |
| 입력 보호 | composition guard, 비동기 navigation ticket, 미리보기 focus/IME 계약 | 매크로·모드 전환·결과 이동에도 같은 보호가 필요 |

근거: [Monaco adapter](../apps/desktop/src/renderer/adapters/monaco-editor.ts), [runtime](../apps/desktop/src/renderer/editor/monaco-runtime.ts), [live model](../apps/desktop/src/renderer/editor/live-document-model.ts), [editor groups](../apps/desktop/src/core/workspace/editor-groups.ts), [tab navigation](../apps/desktop/src/core/workspace/tab-navigation.ts), [language support](../docs/language-support.md), [document manager](../apps/desktop/src/main/documents/document-manager.ts).

## 4. 기능 목록: 14개 영역, 125개 항목

각 표의 근거 링크는 해당 묶음의 도움말·구현이다. “가져오기”에는 C 코드 복사뿐 아니라 동작 재설계, 기존 Monaco 기능 노출, 기존 서비스 확장이 포함된다. 키 표기는 Vim의 의미를 설명하기 위한 것이며 Setdown에 같은 키를 배정한다는 제안은 아니다.

### A. 이동과 선택 — 12개

근거: [motion.txt](../vendor/vim/runtime/doc/motion.txt), [textobject.c](../vendor/vim/src/textobject.c), [normal.c](../vendor/vim/src/normal.c), [visual.txt](../vendor/vim/runtime/doc/visual.txt).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| A01 | operator + motion, `d`/`c`/`y` + 범위 | 선택과 작업을 조합 | 제안 · P1 | 키 문법보다 범위 계산과 명령의 분리를 먼저 구현 |
| A02 | count, `3w`, `2d3w` | 같은 동작을 수량으로 지정 | 제안 · P2 | 숫자 prefix 전체 구현은 Vim 모드 단계; 일반 명령은 반복 횟수 입력으로 가능 |
| A03 | `w/b/e`와 `W/B/E` | 식별자 단위와 공백 구분 덩어리 단위를 선택 | 기반/부분 · P1 | Monaco word/subword 이동과 비교해 빈 부분만 추가 |
| A04 | `f/F/t/T`, `;`, `,` | 현재 줄의 특정 문자까지 빠르게 이동·선택 | 제안 · P1 | 다음 문자 찾기와 직전 문자 찾기 반복을 명령으로 제공 |
| A05 | `iw/aw` | 단어만 또는 주변 공백까지 처리 | 기반/부분 · P1 | delete에 따른 공백 처리까지 명세해야 smart select와 구분됨 |
| A06 | `i"/a"`, `i'/a'` | 문자열 내용 교체 시 따옴표 보존 | 기반/부분 · P1 | escape, 빈 문자열, 줄 경계를 테스트; Vim quote 객체는 기본적으로 한 줄 범위 |
| A07 | `i)/a)`, `i]/a]`, `i}/a}` | 중첩 괄호 안팎의 범위 선택 | 기반/부분 · P1 | Monaco bracket/selection provider 활용; 잘못된 문법의 fallback 정의 |
| A08 | `it/at` | HTML/XML tag 내부·전체 처리 | 기반/부분 · P2 | 언어 provider 우선; 정규식만으로 JSX까지 정확하다고 약속하지 않기 |
| A09 | `is/as`, `ip/ap` | 문장·문단 단위 편집 | 제안 · P1 | 한국어 문장, Markdown 목록·코드 fence는 Vim 휴리스틱과 별도 정책 |
| A10 | `gv`, Visual의 `o` | 마지막 선택 복원, 선택의 반대 끝 조작 | 기반/부분 · P1 | cursor undo와 별개인 ‘마지막 범위 다시 선택’의 가치가 큼 |
| A11 | Visual block, `I/A` | 여러 행의 같은 열에 삽입 | 기반/부분 · P1 | Monaco column selection·multicursor 재사용, 탭·한글·짧은 행 차이 확인 |
| A12 | `gj/gk`, `g0/g$` | 실제 행과 화면에 줄바꿈된 행을 구별 | 기반/부분 · P1 | 긴 Markdown 문단에서 중요; soft wrap과 파일 개행을 섞지 않기 |

### B. 작은 텍스트 변환 — 12개

근거: [change.txt](../vendor/vim/runtime/doc/change.txt), [ops.c](../vendor/vim/src/ops.c), [ex_cmds.c](../vendor/vim/src/ex_cmds.c), [텍스트 서식 안내](../vendor/vim/runtime/doc/usr_25.txt), [선택 comment 패키지](../vendor/vim/runtime/pack/dist/opt/comment/doc/comment.txt).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| B01 | `J`, `gJ` | 공백을 넣거나 그대로 행 결합 | 기반/부분 · P0 | `editor.action.joinLines` 노출; 공백 없는 결합은 별도 의미로 확인 |
| B02 | `>`, `<`, `=` | 들여쓰기 이동·재정렬 | 제품/기반 · P0 | 기존 indent와 formatter를 명령 이름으로 구분 |
| B03 | `gq`, `gw` | 문단을 폭에 맞춰 재배치, 커서 유지 옵션 | 부분 · P1 | Markdown 구조를 보존하는 reflow; wrap 보기와 다른 편집 |
| B04 | `gu`, `gU`, `g~` | 선택 범위의 소문자·대문자·case 반전 | 기반 · P0 | Monaco uppercase/lowercase 재사용; Unicode 정책 확인 |
| B05 | `:sort` | 행 정렬 | 기반 · P0 | 기본 명령 재사용, locale·숫자·키 기준은 명시적 옵션 |
| B06 | `:sort u`, `:sort n` 등 | 중복 제거·숫자 기준 정렬 | 부분 · P1 | 단순 사전순 정렬과 구분; 원래 순서 보존 중복 제거도 별도 명령 후보 |
| B07 | `Ctrl-A/Ctrl-X` | 커서 근처 정수 증감 | 제안 · P1 | 부호·진법·선행 0·날짜처럼 보이는 텍스트의 범위를 명시 |
| B08 | Visual의 `g Ctrl-A` | 여러 행에 증가하는 번호 부여 | 제안 · P1 | 목록 번호·실험 번호 작성에 직접 유용 |
| B09 | `:move`, `:copy` | 행 범위의 이동·복제 | 기반 · P0 | Monaco 행 이동·복제 이용; 목록 구조 편집은 후속 |
| B10 | `:retab`, 탭 관련 옵션 | 탭과 공백 정리 | 기반/부분 · P1 | 문자열 내용·Makefile 탭을 파괴하지 않도록 언어별 범위 구분 |
| B11 | 선택 `comment` 패키지 | 언어의 commentstring에 맞춘 주석 토글 | 기반 · P0 | Monaco comment contribution 활용; Vim core 명령이라고 오기하지 않기 |
| B12 | `r`, `R`, `gR` | 글자 교체·덮어쓰기·화면 열을 고려한 교체 | 기반/부분 · P2 | virtual replace까지 복제할 수요는 낮음; 조합 문자 검증 비용 큼 |

### C. 반복과 Undo — 10개

근거: [repeat.txt](../vendor/vim/runtime/doc/repeat.txt), [getchar.c](../vendor/vim/src/getchar.c), [register.c](../vendor/vim/src/register.c), [undo.txt](../vendor/vim/runtime/doc/undo.txt), [undo.c](../vendor/vim/src/undo.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| C01 | `.` | 마지막 편집을 새 위치에서 반복 | 제안 · P1 | 확정된 명령·범위 의도를 기록하는 Setdown 방식 권장 |
| C02 | count와 dot | 직전 편집의 반복 수 교체 | 제안 · P2 | 기존 count를 곱하는지 대체하는지 UI에서 모호하지 않게 |
| C03 | `q{reg}`, `@{reg}`, `@@` | 작업 기록·재생·직전 매크로 재생 | 제안 · P2 | 키 입력 녹화보다 명령 실행 이력 기반 설계 |
| C04 | `:normal`, `:argdo`, `:bufdo` | 범위·파일 집합에 동일 작업 | 부분/제안 · P2 | 임의 Ex 실행 대신 검토 가능한 배치 편집 계획 |
| C05 | `:global` | 조건에 맞는 행에 작업 적용 | 제안 · P1 | 일치 행 삭제·변환 UI; 두 단계의 대상 수집과 적용 |
| C06 | `u`, `Ctrl-R`, Undo 경계 | 사용자가 생각한 작업 단위로 취소 | 제품 · P0 | 새 명령도 기존 Monaco Undo에 들어가게 함 |
| C07 | `:undolist`, `g-/g+` | 되돌린 뒤 새 편집을 해도 이전 가지 방문 | 보류 · P2 | Monaco 선형 Undo와 구조가 다름; 작은 버튼 추가가 아님 |
| C08 | `:earlier 10s`, `:earlier 1f` | 시간·저장 경계를 기준으로 복귀 | 보류 · P2 | 문서 checkpoint가 우선; 정확한 시간 이동은 별도 이력 저장 필요 |
| C09 | `undofile`, `:wundo/:rundo` | 파일을 다시 열어도 Undo 유지 | 보류 · P2 | 디스크 내용 hash, 수명, 용량, 버전 호환성 설계 필요 |
| C10 | `:undojoin`, `Ctrl-G u` | 자동 수정 합치기·입력 그룹 분리 | 부분 · P1 | 붙여넣기·자동 서식·다중 view 전환에서 사용자 의도대로 묶기 |

### D. 복사·붙여넣기 저장소 — 8개

근거: [change.txt의 registers](../vendor/vim/runtime/doc/change.txt), [register.c](../vendor/vim/src/register.c), [hlyank 패키지](../vendor/vim/runtime/pack/dist/opt/hlyank/plugin/hlyank.vim).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| D01 | 이름 있는 `"a`–`"z` | 여러 조각을 이름별로 보관 | 제안 · P0 | 문자 이름 강제보다 제목·미리보기 있는 저장소 UI |
| D02 | uppercase register append | 여러 곳에서 복사한 내용을 하나로 모음 | 제안 · P1 | 구분 개행과 문자/행 타입의 결합 규칙 필요 |
| D03 | yank register `0` | 삭제 후에도 마지막 복사 유지 | 제안 · P0 | OS 클립보드와 별도로 마지막 명시적 복사 보존 |
| D04 | numbered delete / small-delete | 삭제한 조각을 다시 찾음 | 제안 · P1 | 크기·개수 상한 있는 삭제 기록; 모든 키 입력 로그는 필요 없음 |
| D05 | black-hole `_` | 저장소를 바꾸지 않는 삭제 | 부분 · P1 | Setdown 기본 Delete의 의미와 구별; 매크로·배치 삭제에 저장 여부 옵션 |
| D06 | character/line/block register type | 붙여넣기 형태 보존 | 기반/부분 · P1 | 멀티커서 순서·행끝 개행·직사각형을 명시적으로 저장 |
| D07 | `:registers`, register 선택 후 삽입 | 내용 확인 후 정확한 조각 붙이기 | 제안 · P0 | 복사 이력 검색, pin, 삭제를 같은 UI로 제공 |
| D08 | hlyank / 선택적 put highlight | 방금 복사·붙인 범위가 눈에 보임 | 제안 · P0 | 짧은 decoration, view 종료 시 해제; 움직임 감소 설정 존중 |

### E. 검색과 치환 — 10개

근거: [pattern.txt](../vendor/vim/runtime/doc/pattern.txt), [change.txt](../vendor/vim/runtime/doc/change.txt), [visual.txt](../vendor/vim/runtime/doc/visual.txt), [search.c](../vendor/vim/src/search.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| E01 | `incsearch` | 입력 중 일치 위치 확인, 취소하면 원위치 | 기반/부분 · P0 | 검색창 취소 시 selection·scroll 복귀까지 확인 |
| E02 | `hlsearch`, `:nohlsearch` | 검색어를 유지하며 강조만 잠시 숨김 | 기반/부분 · P1 | query 삭제와 highlight 숨기기를 구분 |
| E03 | `*`, `#`, `g*`, `g#` | 커서 단어/부분 문자열의 다음 사용처 | 기반/부분 · P0 | 검색어 escape와 whole-word 설정을 자동 구성 |
| E04 | `ignorecase`, `smartcase`, `\c/\C` | 대문자 입력 여부에 따른 검색 정책 | 부분 · P1 | 프로젝트 검색 현재 literal case-insensitive 경로와 구분 |
| E05 | `n/N`, wrapscan, search count | 방향·끝 도달·현재 결과 번호를 알 수 있음 | 기반/부분 · P0 | reader·source·프로젝트의 결과 수 의미를 일관되게 표시 |
| E06 | `/`·`?` history | 직전 검색을 재사용 | 기반/부분 · P0 | Monaco 파일 내 history와 프로젝트 결과 history는 별개 |
| E07 | `gn/gN`, `cgn` 뒤 `.` | 다음 일치 구간만 선택·교체 반복 | 부분 · P1 | replace all 전 단계로 유용; 검색 query에 연결된 범위 명령 |
| E08 | `:s`의 `g/c/n` | 전체·확인하며 교체·개수만 확인 | 기반/부분 · P1 | Monaco 치환 재사용, 프로젝트 치환은 별도 미리보기 필요 |
| E09 | range/marks에 대한 substitute | 선택 범위·특정 행 구간에서만 변환 | 기반/부분 · P0 | find in selection을 노출; 숨은 범위 상태를 눈에 보이게 |
| E10 | capture·표현식 치환·multiline pattern | 구조적인 반복 텍스트 변환 | 기반/부분 · P2 | JS regex와 Vim regex 문법을 섞지 않기; 임의 eval은 도입 불필요 |

### F. Quickfix와 작업 결과 목록 — 8개

근거: [quickfix.txt](../vendor/vim/runtime/doc/quickfix.txt), [quickfix.c](../vendor/vim/src/quickfix.c), [cfilter 패키지](../vendor/vim/runtime/pack/dist/opt/cfilter/plugin/cfilter.vim).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| F01 | 파일 위치의 공통 entry | 검색·진단·빌드 결과를 같은 방식으로 이동 | 부분 · P0 | provider는 유지하고 위치 참조·탐색 정책만 공통화 |
| F02 | list ID, `:colder/:cnewer` | 이전 결과 목록으로 복귀 | 제안 · P0 | query만 재실행하는 history와 별도로 snapshot 보관 |
| F03 | title, context, changedtick | 결과의 출처·갱신 상태를 확인 | 부분 · P0 | root·revision·실행 시점·취소 여부를 기록 |
| F04 | window-local location list | 분할 창마다 다른 탐색 작업 유지 | 부분/제안 · P1 | 그룹별 결과 소유권; 전역 Problems와 혼동하지 않기 |
| F05 | `:cnext/:cprev`, 파일별 이동 | 패널에 다시 손을 대지 않고 검토 | 부분 · P0 | focus를 강탈하지 않는 다음 결과 명령 |
| F06 | `:Cfilter`, invalid 항목 처리 | 기존 결과를 좁히고 파싱 실패 로그도 확인 | 제안 · P1 | Cfilter처럼 새 목록을 만들고 원본 목록으로 돌아갈 수 있게 함 |
| F07 | `:cdo/:cfdo` | 결과에 해당하는 위치·파일만 일괄 작업 | 제안 · P2 | preview, version guard, 파일별 실패·Undo 결과 필요 |
| F08 | `:make`, `errorformat`, compiler | 도구 출력에서 위치로 이동 | 부분/제안 · P1 | 터미널 텍스트 링크에서 작업 결과 수집으로 확장; compiler별 parser |

### G. 위치 기억과 복귀 — 8개

근거: [motion.txt](../vendor/vim/runtime/doc/motion.txt), [mark.c](../vendor/vim/src/mark.c), [tagsrch.txt](../vendor/vim/runtime/doc/tagsrch.txt), [undo.c](../vendor/vim/src/undo.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| G01 | `Ctrl-O/Ctrl-I` jumplist | 같은 파일·다른 파일에서 이전 탐색 위치 복귀 | 부분 · P0 | 탭 URL history와 독립된 정확한 위치 이력 |
| G02 | `g;`, `g,` changelist | 읽은 곳과 별개로 수정한 곳 복귀 | 제안 · P0 | 연속 타이핑은 합치고 의미 있는 편집 구간을 기록 |
| G03 | lowercase marks | 현재 문서의 이름 있는 위치 | 제안 · P1 | 메모 이름·목록 UI; 숫자 줄번호 고정 대신 anchor |
| G04 | uppercase marks | 여러 파일 사이의 작업 책갈피 | 부분/제안 · P1 | 브라우저 bookmark와 코드 위치 bookmark는 다른 모델 |
| G05 | last insert/change/operation marks | 마지막 삽입점·수정 범위 재방문 | 부분 · P1 | 편집 후 해당 영역 보기·다시 선택 명령 |
| G06 | tag stack | 정의를 연쇄로 따라간 뒤 역순 복귀 | 부분 · P0 | LSP definition 요청에서 출발점 기록; 이전 결과 UI와 연결 |
| G07 | `:keepjumps` | 내부 자동 이동이 사용자 이력을 오염시키지 않음 | 제안 · P0 | format·preview sync·scroll restoration에 origin 필드 |
| G08 | edit에 따른 mark 위치 보정 | 위에 행을 삽입해도 같은 문맥으로 복귀 | 부분 · P0 | 살아 있는 model의 decoration anchor; 닫힌 문서는 재확인 |

### H. 파일·버퍼·분할 창 — 9개

근거: [windows.txt](../vendor/vim/runtime/doc/windows.txt), [editing.txt](../vendor/vim/runtime/doc/editing.txt), [findfile.c](../vendor/vim/src/findfile.c), [window.c](../vendor/vim/src/window.c), [buffer.c](../vendor/vim/src/buffer.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| H01 | `Ctrl-^`, alternate file | 직전 작업 파일과 빠르게 왕복 | 부분 · P0 | 최근 탭 순환과 고정된 두 파일 왕복을 구별 |
| H02 | `:buffers`, `:b`, buffer MRU | 열린 문서 중 필요한 것을 찾음 | 부분 · P1 | 탭이 많을 때 검색 가능한 open-document 목록 |
| H03 | 하나의 buffer를 여러 window에서 표시 | 문서 위·아래를 동시에 독립적으로 편집 | 부분 · P1 | shared model 기반 확장; 탭 이동을 복제 view와 혼동하지 않기 |
| H04 | split focus·resize·equalize·maximize | 키보드로 작업 공간 정리 | 제품/부분 · P1 | editor groups 재사용; 임시 최대화 후 비율 복원 |
| H05 | `scrollbind`, `cursorbind` | 유사 문서의 대응 위치 비교 | 부분/제안 · P2 | Git diff의 동기 스크롤과 일반 문서 연동을 구별 |
| H06 | argument list | 열린 탭과 별개인 작업 대상 파일 집합 | 제안 · P2 | 고정한 검색 결과의 파일 집합으로 시작 가능 |
| H07 | `gf/gF`, `path`, `suffixesadd` | 텍스트 속 파일명·행 번호를 열기 | 부분 · P1 | Markdown 링크·LSP link 외 일반 경로 텍스트도 지원 |
| H08 | `includeexpr`, `:find` | 모듈 이름을 파일 후보로 변환 | 부분/제안 · P1 | 파일 열기 fallback로만 사용; LSP import 진단과 독립 |
| H09 | global/tab/window current directory | 서로 다른 프로젝트의 상대 경로 구별 | 부분 · P1 | process.cwd 변경 대신 resource별 root·base URI를 전달 |

### I. 언어·문서 작성 지원 — 11개

근거: [insert.txt](../vendor/vim/runtime/doc/insert.txt), [options.txt](../vendor/vim/runtime/doc/options.txt), [Python ftplugin](../vendor/vim/runtime/ftplugin/python.vim), [Python completion](../vendor/vim/runtime/autoload/python3complete.vim), [Markdown ftplugin](../vendor/vim/runtime/ftplugin/markdown.vim), [spell.txt](../vendor/vim/runtime/doc/spell.txt), [digraph.txt](../vendor/vim/runtime/doc/digraph.txt).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| I01 | buffer words completion | 서버가 없어도 문서의 단어 재사용 | 기반 · P0 | Monaco word suggestions의 범위·성능·중복 정책 노출 |
| I02 | whole-line completion | 비슷한 행 전체 재사용 | 부분/제안 · P1 | 반복 표·설정·문서 문구에 유용; 현재 문서부터 |
| I03 | file-name completion | 문자열·문서 속 상대 경로 입력 보조 | 부분 · P1 | 현재 파일의 디렉터리 기준, 공백·한글 경로 처리 |
| I04 | dictionary/thesaurus/register completion | 분야 용어·동의어·보관 문구 재사용 | 제안 · P2 | 프로젝트 용어집과 snippet 활용; 대형 사전 내장보다 수요 확인 |
| I05 | `omnifunc`, `completefunc` | 언어별 후보 생성기 연결 | 제품/부분 · P0 | 기존 LSP provider 유지; Vim Python introspection 직접 이식 불필요 |
| I06 | `autocomplete`, delay/timeout, fuzzy 옵션 | 자동 후보 표시의 지연·비용 조절 | 제품/부분 · P1 | 분석 pin에는 옵션 존재, autocomplete 기본 off; Setdown debounce·취소 정책 비교 |
| I07 | Python `]m/[m`, class/function motions | 현재 함수·다음 함수로 이동 | 부분 · P1 | LSP symbol 범위 우선; regex fallback의 오탐을 구별 |
| I08 | Markdown `[[/]]`, heading fold | 문서 절 단위 이동·접기 | 제품/부분 · P0 | 기존 outline·source mapping 활용; 코드 fence 안의 `#` 제외 |
| I09 | `K`, `keywordprg`, tag/preview | 커서의 개념에 대한 도움말 | 제품/부분 · P1 | hover와 공식 문서 열기를 구분; 외부 실행은 별도 사용자 명령 |
| I10 | spell, next misspelling, user dictionary | 영문 논문·문서 오타 교정 | 제안 · P1 | 코드/fence/URL 제외; 한국어 문법 교정까지 되는 기능으로 소개 금지 |
| I11 | digraph, abbreviation | 특수문자·자주 쓰는 문구 입력 | 기반/부분 · P1 | 수식 기호 picker·명시적 snippet; 한글 입력 중 자동 치환 금지 |

### J. 설정의 범위와 설명 가능성 — 8개

근거: [options.txt](../vendor/vim/runtime/doc/options.txt), [option.c](../vendor/vim/src/option.c), [filetype.txt](../vendor/vim/runtime/doc/filetype.txt), [Python ftplugin](../vendor/vim/runtime/ftplugin/python.vim), [EditorConfig 패키지](../vendor/vim/runtime/pack/dist/opt/editorconfig/plugin/editorconfig.vim).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| J01 | global / buffer-local / window-local | 파일별 편집 정책과 view별 표시 정책 분리 | 부분 · P0 | 언어 연결 scope는 이미 있음; 일반 편집 설정 모델로 확대 |
| J02 | `:setlocal` | 현재 파일만 임시 조정 | 부분/제안 · P1 | “이 파일에서만” 옵션과 영구 프로젝트 설정을 구분 |
| J03 | ftplugin | 언어별 주석·들여쓰기·이동 규칙 적용 | 부분 · P1 | language profile의 선언적 정책으로 구성 |
| J04 | `b:undo_ftplugin` | 언어·파일 전환 시 이전 규칙 제거 | 부분 · P0 | 재사용 view에 설정이 남는 버그 예방; lease/dispose 패턴 |
| J05 | `:verbose set`, `:verbose map` | 마지막 설정·매핑의 출처 확인 | 부분/제안 · P0 | effective value, source, override 이유를 표시 |
| J06 | 선택 EditorConfig 패키지 | 저장소의 들여쓰기·개행 규칙 일치 | 제안 · P1 | 지원 가능한 속성부터; Markdown trailing spaces는 신중히 적용 |
| J07 | modeline | 파일 자체가 일부 편집 설정 전달 | 보류 · P3 | 자동 코드 실행·무제한 옵션 허용 대신 선언적 설정으로 충분 |
| J08 | reset/default, local override 해제 | 왜 달라졌는지 알고 원래 정책으로 복귀 | 부분 · P0 | “자동 감지”·“상속값 사용”·“기본값”을 구별 |

### K. 저장·복원·파일 무결성 — 8개

근거: [recover.txt](../vendor/vim/runtime/doc/recover.txt), [undo.txt](../vendor/vim/runtime/doc/undo.txt), [usr_21.txt](../vendor/vim/runtime/doc/usr_21.txt), [editing.txt](../vendor/vim/runtime/doc/editing.txt), [fileio.c](../vendor/vim/src/fileio.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| K01 | swap/recovery | 비정상 종료 후 미저장 텍스트 회수 | 부분 · P1 | draft 존재와 crash recovery 보장을 구분; 복구 가능한 snapshot 계약 필요 |
| K02 | backup/writebackup | 저장 과정·덮어쓰기 후 이전 파일 회수 | 부분 · P2 | 기존 atomic write 보존; 사용자 local history는 별도 가치 |
| K03 | 외부 변경 감지·checktime | 디스크 변경을 모른 채 덮어쓰지 않음 | 제품 · P0 | 새 batch/macro도 기존 conflict 경로 사용 |
| K04 | mksession | 열었던 작업 공간 복원 | 부분/제안 · P1 | 그룹·탭·문서·dirty snapshot을 선언형 manifest로 저장 |
| K05 | mkview/loadview | 커서·접힘·스크롤 상태 복원 | 부분 · P1 | 현재 viewstate 수명과 재시작 후 수명을 명시 |
| K06 | viminfo | 검색·register·mark 등 작업 맥락 지속 | 부분/제안 · P2 | 복사 내용·최근 위치별 보존 정책을 분리 |
| K07 | fileformat/fileencoding/BOM/EOL | 파일 형식을 알고 보존·변환 | 부분 · P1 | 현 UTF-8/LF/CRLF 계약 내 표시부터; 추가 인코딩은 별도 작업 |
| K08 | readonly / nomodifiable | 실수 편집·변경 불가 상태 구분 | 제품/부분 · P0 | Git immutable snapshot 등에서 모든 새 명령의 enable 조건 통일 |

### L. 시야·접힘·작업 피드백 — 8개

근거: [fold.txt](../vendor/vim/runtime/doc/fold.txt), [fold.c](../vendor/vim/src/fold.c), [scroll.txt](../vendor/vim/runtime/doc/scroll.txt), [options.txt](../vendor/vim/runtime/doc/options.txt), [diff.txt](../vendor/vim/runtime/doc/diff.txt).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| L01 | fold open/close/all/level | 큰 문서를 원하는 깊이로 보기 | 기반/제품 · P0 | Monaco folding·LSP folding 활용, 명령 노출 |
| L02 | manual/indent/expr/syntax/marker/diff folds | 다양한 문서 구조에 맞는 접기 | 부분 · P2 | Markdown·코드 provider 위주; 모든 방식 이식 불필요 |
| L03 | foldtext, fold 상태 | 접힌 부분의 내용·규모를 이해 | 기반/부분 · P1 | heading·숨긴 행 수·diagnostic 유무 등 가벼운 정보 |
| L04 | `zz/zt/zb`, scrolloff | 커서를 중심·위·아래에 놓고 문맥 확보 | 기반/부분 · P0 | source reveal 정책과 reader anchor 이동을 구분 |
| L05 | relativenumber, cursorline, colorcolumn | 현재 위치·거리·권장 폭 파악 | 기반/부분 · P1 | Monaco options 노출; 상대 번호는 취향 옵션 |
| L06 | listchars, whitespace 표시 | 탭·후행 공백·공백 차이 확인 | 기반/부분 · P0 | 현재 selection-only 표시와 항상 표시 전환 |
| L07 | diff 이동·부분 적용·동기 스크롤 | 변경 부분 검토·선택 반영 | 제품/부분 · P2 | 기존 Git review 경로 우선; 독립 Vim diff 엔진 이식 불필요 |
| L08 | statusline·showcmd·recording 상태 | 현재 모드·대기 명령·기록 여부 확인 | 부분 · P1 | 새 모드/매크로 도입 시 필수; 상태를 색만으로 전달하지 않기 |

### M. 명령 발견과 작업 재사용 — 7개

근거: [cmdline.txt](../vendor/vim/runtime/doc/cmdline.txt), [map.txt](../vendor/vim/runtime/doc/map.txt), [helphelp.txt](../vendor/vim/runtime/doc/helphelp.txt), [ex_getln.c](../vendor/vim/src/ex_getln.c), [cmdexpand.c](../vendor/vim/src/cmdexpand.c).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| M01 | command name completion | 명령을 외우지 않고 찾음 | 기반/부분 · P0 | Monaco와 앱 명령의 검색 가능한 공통 목록 |
| M02 | 명령별 argument completion | 현재 문맥에 맞는 파일·옵션 후보 | 부분 · P1 | 모든 것을 문자열로 받기보다 typed argument |
| M03 | command history, `q:` | 이전 명령을 고쳐 다시 실행 | 부분/제안 · P1 | 성공한 명령과 인수만 기록; 취소·실패를 재생 목록과 구분 |
| M04 | fuzzy matching, lastused, wildmenu | 후보가 많아도 최근 작업을 빨리 찾음 | 부분 · P1 | 정렬 이유·prefix 우선·최근성 보정; 대형 목록 취소 처리 |
| M05 | `:map`, verbose mapping | 단축키·범위·출처 확인 | 부분/제안 · P0 | “이 키가 지금 무엇을 실행하는가” UI와 충돌 진단 |
| M06 | `:help {topic}`, helptags, tutor | 기능 발견에서 연습까지 연결 | 부분/제안 · P1 | 명령 설명·예시·도움말 링크를 같은 metadata로 제공 |
| M07 | `:messages`, verbose logs | 사라진 오류·상태 설명 다시 보기 | 제품/부분 · P0 | 언어 로그 외에도 실패한 편집·결과 갱신 이유를 추적 |

### N. 자동화와 선택 패키지 — 6개

근거: [autocmd.txt](../vendor/vim/runtime/doc/autocmd.txt), [job/channel 문서](../vendor/vim/runtime/doc/channel.txt), [job.c](../vendor/vim/src/job.c), [terminal.txt](../vendor/vim/runtime/doc/terminal.txt), [matchit](../vendor/vim/runtime/pack/dist/opt/matchit/doc/matchit.txt), [netrw](../vendor/vim/runtime/pack/dist/opt/netrw/doc/netrw.txt).

| ID | Vim 동작 | 사용자가 얻는 것 | Setdown 상태·순위 | 도입 판단 |
| --- | --- | --- | --- | --- |
| N01 | autocommand·augroup | 열기·저장·언어 변경에 규칙 적용 | 부분 · P1 | 타입 있는 lifecycle hook, 해제·중복 등록 방지; 임의 스크립트는 후순위 |
| N02 | job/channel | 외부 도구 실행 중에도 편집 유지 | 제품/부분 · P1 | 기존 language/terminal process host 재사용; 취소·종료 결과 통일 |
| N03 | `!` filter | 선택 텍스트를 외부 도구로 변환 | 제안 · P2 | 명시적 도구 설정·입출력 preview·revision 검사로 한정 |
| N04 | terminal buffer·terminal normal mode | 실행 출력에서 검색·선택·위치 이동 | 제품/부분 · P2 | xterm 기반과 Vim terminal 의미 차이 확인; core 교체 불필요 |
| N05 | 선택 matchit | 괄호를 넘어 if/endif·tag 등 짝 이동 | 기반/부분 · P2 | 언어 provider와 구조별 pairing; 단순 bracket matching과 구분 |
| N06 | 선택 netrw·termdebug·OSC52 등 | 파일·원격·디버그·터미널 복사 통합 | 보류 · P3 | 기존 Explorer·터미널·Electron 클립보드 우선, 별도 수요가 생길 때 검토 |

## 5. 코드에서 확인한 중요한 설계

### 5.1 Quickfix는 일회성 검색 패널보다 수명이 길다

`quickfix.c`의 `qf_new_list`, `qf_jump`, `qf_mark_adjust`, `getqflist`, `setqflist`를 보면 핵심은 행 렌더링이 아니라 **목록의 정체성, 이전 목록, 목록 안의 현재 위치, 편집에 따른 위치 변화**다. 목록의 순서 번호와 ID는 구분되고, 갱신에는 `changedtick`이 있다. location list는 window별로 소유되며 split에서는 복사된다. 텍스트가 삽입되거나 삭제되면 위치도 조정되고, 삭제된 대상은 무효화될 수 있다.

Setdown의 [search-controller](../apps/desktop/src/renderer/project/search/search-controller.ts)는 최신 query와 결과를 관리하고, [LanguageResults](../apps/desktop/src/renderer/language/LanguageResults.svelte)는 현재 source의 목록과 계층 탐색을 표시한다. 이 기반은 이미 유용하지만 **검색 A의 결과 집합을 보관하고 검색 B 이후 복귀하는 서비스**는 별개다. 언어 계층의 trail 또한 프로젝트 전체 검색 이력과 같지 않다.

도입할 데이터 모델의 예시는 다음과 같다. 아래 타입과 서비스 이름은 **제안**이며 현재 구현된 API가 아니다.

```ts
type ResultSet = {
  id: string;
  source: 'search' | 'references' | 'diagnostics' | 'task';
  scope: { workspaceId: string; groupId?: string };
  title: string;
  query?: string;
  revision: number;
  state: 'running' | 'complete' | 'cancelled' | 'stale' | 'truncated';
  selectedEntryId?: string;
  entries: ResultEntry[];
};
```

`ResultEntry`는 안정된 ID와 resource/cell/range, source revision, 간단한 문맥을 가진다. 생성·갱신의 소유자는 검색/LSP/task provider이고, 표시 목록은 그 데이터를 참조한다. 진단 전체를 검색 snapshot처럼 얼려서 현재 오류인 것처럼 표시하면 안 된다. **살아 있는 Problems와 사용자가 고정한 당시 결과**를 구분해야 한다.

현재 [search-service](../apps/desktop/src/main/project/search-service.ts)는 결과 300개, 후보 파일 크기 2,000,000 bytes, text 검색의 검사 파일 수 제한 등을 적용한다. 결과 이력에도 상한이 필요하며, 상한에 도달한 결과를 “모두 찾음”으로 표시해서는 안 된다. 현재 제한을 없애는 것은 이력 추가의 선행 조건이 아니다.

**수용 기준**: 검색 A→B→A에서 목록·선택·scroll 복원, 늦은 A 응답이 B를 덮지 않음, 같은 파일 앞부분 편집 후 위치 보정, 대상 삭제 시 무관한 행으로 점프하지 않음, 분할 그룹 A의 결과 탐색이 B의 목록을 덮지 않음.

### 5.2 방문 이력·점프 이력·수정 이력은 다른 데이터다

Setdown의 `recordVisit()`은 현재 방문과 kind·URL이 같으면 항목을 대체한다. 이는 주소창과 리소스 이동에는 맞지만 `a.py:10 → a.py:300 → a.py:10`을 표현하는 구조로는 부족하다.

Vim의 `mark.c`와 motion 도움말은 이를 나눈다. jumplist는 window별이며, changelist는 문서의 변경 위치를 다룬다. 이름 있는 mark는 또 다른 목적을 가진다. `:keepjumps`는 프로그램 내부 이동으로 사용자의 탐색 경로가 오염되는 것을 막는다.

Setdown에는 다음 구분을 권한다.

| 종류 | 기록 사건 | 기록하지 않는 사건 | 소유권 |
| --- | --- | --- | --- |
| 리소스 방문 | 주소창의 파일·웹·터미널 전환 | 파일 내부 이동 | 기존 tab navigation |
| 탐색 위치 | 정의, 참조, outline, 결과 선택, 명시적 줄 이동 | 매 키 입력, hydration, preview 동기화 | editor group 또는 명시한 탐색 session |
| 수정 위치 | 타이핑 그룹 종료, paste, 명령 편집, code action | selection 이동, 스크롤 | document |
| 책갈피 | 사용자가 위치를 저장 | 자동 탐색 | workspace + document reference |

열린 모델은 Monaco decoration/추적 가능한 범위를 사용하고, 닫힌 문서는 URI·마지막 범위·문맥·저장 revision을 저장한다. 닫힌 파일이 크게 바뀌면 정확한 위치를 보장할 수 없으므로 재탐색 또는 명시적인 stale 상태가 필요하다.

노트북은 파일 경로와 행만으로 부족하다. cell ID와 cell 내부 범위가 필요하며, 셀 삭제 후 이웃 셀의 같은 줄로 조용히 이동해서는 안 된다. main/renderer/LSP에 이미 쓰는 노트북 좌표 체계를 따라야 한다.

**수용 기준**: 같은 파일 내 왕복, 다른 파일 왕복, split 이동, Save As/rename, 삭제된 셀, 비동기 정의 응답 도착 전에 다른 곳으로 이동한 경우, 한국어 조합 중 탐색 요청을 모두 다룬다.

### 5.3 복사 저장소는 문자열 배열만으로 끝나지 않는다

`register.c`의 register 구현은 이름·append·종류·기본 register와의 관계를 관리한다. `do_record()`가 매크로 기록 중 기본 yank register를 보존하는 것도 작은 동작이 큰 불편을 막는 예다.

Setdown의 일반 Delete는 Vim의 `d`와 같은 register 갱신을 할 필요가 없다. 사용자에게 필요한 것은 “복사본 보관”, “삭제 후 복사본 유지”, “이전 조각 선택”, “어디에 붙었는지 확인”이다. 이를 다음처럼 제품 동작으로 옮길 수 있다.

- OS 클립보드와 앱의 복사 저장소를 분리한다. 저장소 선택이 곧 OS clipboard 교체를 의미할 필요는 없다.
- 명시적 copy/cut에서만 항목을 만들고, 프로젝트·문서 이름, 시각, plain text를 기본으로 보관한다.
- 멀티커서는 조각 순서와 분배 정책을 저장한다. 단일 큰 문자열로 합치면 다른 커서 수에서 예기치 않은 결과가 난다.
- 행 단위 복사에는 마지막 개행을 보존한다. Markdown의 후행 두 공백을 자동으로 정리하지 않는다.
- 기본은 제한된 수의 메모리 저장소로 시작하고 pin·삭제를 제공한다. 재시작 후 지속은 별도 명시적 정책으로 추가한다.
- paste highlight는 실제 적용된 range를 기준으로 짧게 표시하고, model/view가 사라지면 해제한다.

선택 패키지 `hlyank`는 `TextYankPost`/`TextPutPost`의 범위와 register type을 사용하고, timer 종료 시 window가 남아 있는지 확인한다. 가져올 디테일은 **정확한 범위와 늦은 정리의 수명 검사**다. Blink 자체를 위해 별도 렌더러를 만들 필요는 없다.

**수용 기준**: 복사→삭제→원래 복사 붙이기, CRLF와 끝 개행, 한글·emoji, 다중 커서 수 불일치, readonly target, view 폐기 뒤 decoration timer, 한 번 Undo로 paste 취소.

### 5.4 텍스트 객체는 키 매핑보다 범위 의미가 어렵다

`textobject.c`에는 `current_word`, `current_sent`, `current_block`, `current_tagblock`, `current_par`, `current_quote` 등 서로 다른 계산이 있다. 특히 `i`/`a`가 언제나 “괄호 포함/미포함”이라는 뜻은 아니다. 단어에서는 주변 공백, 문단에서는 빈 줄, quote에서는 escape와 앞뒤 공백 정책이 들어간다. linewise·characterwise·blockwise 범위도 다르다.

Monaco의 `smartSelect`와 `selectToBracket`가 있으므로 모든 범위 파서를 새로 만들 이유는 없다. 권장 순서는 다음과 같다.

1. 언어 provider의 selection ranges와 bracket 정보를 활용한다.
2. provider가 없을 때 사용할 제한된 word/quote/paragraph fallback을 정의한다.
3. Markdown 전용 객체는 기존 문서 구조와 source-position을 사용한다. heading section, fenced code, list item, link label/destination, table cell이 유용하다.
4. 범위를 결정한 뒤 select/delete/change/copy/format 명령을 적용한다. 같은 범위 계산을 명령마다 복제하지 않는다.

Markdown 객체는 Vim core에 그대로 존재하는 기능이라는 뜻이 아니라, Vim의 조합 방식을 Setdown 문서 구조에 맞춰 확장한 제안이다. 예를 들어 “이 링크의 목적지만 교체”는 `[]()`의 문자 개수만 세기보다 기존 Markdown 링크 처리와 연결해야 한다.

좌표는 특히 주의해야 한다. Vim의 column·virtual column과 Monaco의 UTF-16 column은 그대로 호환되지 않는다. 탭, wide character, combining mark, emoji가 포함된 범위에서 byte offset을 제품 좌표로 복사하면 잘못된 글자를 지운다.

**수용 기준**: 빈/중첩/깨진 괄호, escape quote, 한글과 surrogate pair, 조합 문자, 코드 fence 속 가짜 heading, 여러 커서의 중첩 범위, readonly model, 취소 시 원래 selection 복원.

### 5.5 마지막 편집 반복과 매크로는 구분해서 도입한다

Vim의 실제 `.` 구현은 `getchar.c`의 redo buffer와 `start_redo()` 등 입력 재생 체계에 연결된다. Vim 자체가 이미 의미 기반 command AST를 저장한다고 설명하면 잘못이다. Visual 반복도 원래 선택의 의미를 새로 추론하는 것이 아니라 크기 규칙이 있다.

Setdown에서는 DOM keydown을 녹화해 재생하는 방식보다 다음처럼 확정된 편집을 기록하는 편이 기존 구조에 맞다.

```ts
type RepeatRecipe = {
  commandId: string;
  target: { kind: 'word' | 'quoted-content' | 'paragraph' | 'search-match' };
  args: unknown; // 실제 구현에서는 command별 검증된 타입
  repeatCount: number;
};
```

이 역시 제안이다. 처음에는 단어 교체·행 결합·대소문자 변환·번호 증감 정도만 지원하고, 명령이 성공한 뒤 recipe를 교체한다. 실패·취소한 명령은 마지막 성공 편집을 덮지 않는다. 명령이 반복을 지원하지 않으면 UI에서 그 사실을 설명한다.

매크로는 여러 recipe와 이동을 묶는 상위 기능으로 둔다. 파일 저장, 외부 process, LSP의 비동기 응답, focus 전환까지 무조건 녹화하면 결과를 예측하기 어렵다. 처음에는 현재 문서의 확정적 편집만 기록하는 것이 검증 가능한 범위다. LSP 명령을 나중에 넣더라도 요청 ID가 아닌 새 요청·새 revision 검증으로 실행해야 한다.

**수용 기준**: 명령별 원자적 Undo, 사용자가 중단 가능, 중간 실패 위치 보고, 문서가 바뀐 동안 늦은 재생 적용 금지, readonly에서 전체 편집 거부, 조합 중간 텍스트가 recipe에 들어가지 않음.

### 5.6 설정의 적용뿐 아니라 해제와 출처가 기능이다

Python ftplugin은 `include`, `includeexpr`, `suffixesadd`, indentation, function/class motion, `keywordprg` 등을 설정한다. 동시에 `b:undo_ftplugin`에 local option reset과 buffer mapping 제거를 기록한다. Markdown ftplugin도 같은 수명 규칙을 쓴다.

재사용하는 Monaco editor에 Python → Markdown → 다른 Python 파일을 연결할 때, 이전 파일의 옵션·decorations·bindings가 남으면 “특정 탭에서만 이상하다”는 문제가 생긴다. Setdown의 model lease와 language session epoch는 좋은 기반이다. 추가하는 설정도 **resource 기준 적용 결과와 해제 token**을 가져야 한다.

Vim의 `:verbose set`/`:verbose map`에서 가져올 또 하나의 기능은 최종값의 출처다. `option.c`는 option의 script context를 통해 마지막 설정 출처를 표시한다. 제품에서는 아래 정보를 사용자가 읽을 수 있게 내놓는 것이 중요하다.

| 표시할 정보 | 예시 | 의미 |
| --- | --- | --- |
| 적용값 | indent width = 4 | 지금 이 파일의 결과 |
| 출처 | 프로젝트 `.editorconfig`, Python profile | 어디에서 왔는지 |
| 가려진 값 | 앱 기본 2, 프로젝트 override 4 | 왜 다른 설정이 먹지 않았는지 |
| 범위 | 현재 파일 / 프로젝트 / 전체 | 바꾸면 어디까지 영향이 있는지 |
| 반영 상태 | 적용됨 / 새 language session 시작 중 / 지원하지 않음 | 저장만 되었고 실제 적용되지 않은 상태를 구분 |

현재 일반 언어 연결에는 이미 프로젝트별·전역 설정과 더 구체적인 scope 우선 규칙이 있다. 이를 없는 기능처럼 다시 설계해서는 안 된다. 새 일반 편집 설정은 기존 scope와 충돌하지 않도록 연결하고, editor 옵션의 provenance만 보강하는 것부터 시작할 수 있다.

EditorConfig는 Vim의 **선택 패키지**다. 그 구현이 `charset=latin1/utf-16`이나 `end_of_line=cr`을 다룬다고 해서 Setdown도 바로 지원한다고 표시할 수 없다. Setdown의 [text-codec](../apps/desktop/src/core/document/text-codec.ts)는 plain-text 경로에서 UTF-8/UTF-8 BOM, LF/CRLF를 지원하고 invalid UTF-8, UTF-16/32, mixed/bare CR 등을 거부한다. 지원하지 않는 설정은 명시적으로 보고해야 한다.

### 5.7 공유 문서와 독립된 view는 다른 수명이다

Vim buffer는 텍스트·수정 이력, window는 커서·스크롤·많은 표시 상태를 가진다. “파일은 하나인데 위쪽과 아래쪽을 각각 보고 편집한다”는 동작이 자연스러운 이유다.

Setdown은 이미 `DocumentModelOwner`를 두고 ordinary/Git 편집 surface가 같은 live model을 빌리도록 설계했다. surface가 바뀌면 `pushStackElement()`로 Undo 경계를 분리한다. 이는 재사용할 가치가 큰 현재 구현이다.

그러나 editor group의 탭 소유권은 하나의 tab ID를 한 그룹에 배치하는 구조이며, “탭 이동” 자체가 “같은 문서의 두 view 생성”은 아니다. clone view를 추가한다면 `documentId`와 `viewId`를 구분하고, 문서 저장 상태는 공유하면서 selection/fold/scroll은 view별로 유지해야 한다. 현재 Monaco model map이 tab ID를 키로 쓰는 지점도 함께 검토해야 한다.

**수용 기준**: 한쪽 편집이 다른 쪽에 반영, 각각의 커서 보존, 한쪽 닫아도 다른 모델 유지, 두 view에서 Undo 경계 일관성, Save As/rename 시 모든 view retarget, 그룹 이동 중 한글 composition 유지.

### 5.8 Undo·복구·세션 복원은 서로 대체하지 못한다

| 기능 | 복원 대상 | Vim 참고 | Setdown에서의 판단 |
| --- | --- | --- | --- |
| Undo/redo | 현재 문서의 편집 | `undo.c` | 기존 Monaco 모델 유지 |
| Undo branches | Undo 뒤 갈라진 다른 편집 경로 | `undotree`, `g-/g+` | 별도 이력 엔진 검토가 필요한 P2 |
| Persistent undo | 다시 열었을 때의 편집 이력 | `undofile` | 현재 Undo stack을 내부 API로 dump하는 접근은 피함 |
| Recovery | 비정상 종료 때 미저장 내용 | swap/recover | draft 파일의 존재와 복구 UX·보장 범위를 따로 검증 |
| Session | 그룹·탭·열린 문서·작업 배치 | `mksession` | 선언형 manifest로 설계 |
| View | cursor/fold/scroll | `mkview` | 기존 viewstate의 저장 수명 확대 |
| Local history | 과거 내용 snapshot | backup·save checkpoint에서 참고 | 분기 Undo보다 작은 첫 단계가 될 수 있음 |

Vim persistent undo는 파일 내용 hash가 맞지 않으면 이력을 그대로 적용하지 않는다. 이 디테일은 중요하다. 경로만 같다고 오래된 Undo를 새 내용에 붙이면 데이터 손상이 생길 수 있다. Setdown의 session·checkpoint도 디스크 버전·문서 identity·형식 버전을 확인해야 한다.

또한 Vim session 파일은 실행 가능한 Vim script다. Setdown의 작업 공간 복원을 위해 이를 실행하는 호환 계층까지 가져올 필요는 없다. 파일·그룹·view 상태만 담는 데이터 형식이면 충분하다.

## 6. 출발점인 notebook import 밑줄에 적용하면

### 6.1 Vim에서 해결 가능한 부분과 별개인 부분

이전 조사에서 `import vlmflash`의 진단 차이는 [노트북 import 분석 보고서](2026_10_23_notebook_import_resolution.md)로 재현했다. VS Code 설정에는 프로젝트의 `vlm-flash/src`가 분석 경로로 있었고, Setdown의 해당 notebook 분석 경로에는 동일한 설정이 반영되지 않았다. `basedpyright.analysis.extraPaths` 또는 프로젝트 `pyrightconfig.json` 적용 조건에서는 진단과 hover가 바뀌었다.

다음 세 경로를 한 설정으로 보아서는 안 된다.

| 경로 | 무엇을 결정하나 | Vim에서 대응하는 부분 | Setdown 해결 방향 |
| --- | --- | --- | --- |
| 파일 탐색 경로 | `gf`로 어떤 파일을 열지 | `path`, `suffixesadd`, `includeexpr` | 상대 파일·모듈 후보 열기 |
| 정적 분석 경로 | import resolve, hover, definition | 사용한 외부 분석기와 그 설정 | 선택한 language server의 실제 설정·root·interpreter 확인 |
| 실행 경로 | kernel/process에서 import 성공 여부 | Python process의 환경 | notebook kernel interpreter·cwd·실행 상태 확인 |

Python ftplugin의 `.py` suffix와 `includeexpr`는 첫 번째 문제를 돕는다. `python3complete.vim`도 LSP와 같은 엔진이 아니며 compiled Python 지원 조건과 별도 동작을 가진다. 검토한 파일은 local import 허용에 대한 명시적인 opt-in을 두고 있다. 이 경로를 Setdown에 복사해서 analysis warning을 고치는 방식은 적합하지 않다.

### 6.2 가장 유용한 제품 기능: “이 진단이 나온 환경 보기”

오류 hover 또는 Language Support의 작은 링크로 다음 정보를 보여주면 원래 문제를 훨씬 빠르게 해결할 수 있다.

```text
진단: reportMissingImports
문서: 02_03_selector_sweep.ipynb / 해당 코드 셀
분석기: basedpyright
분석 root: …/vlm-in-flash/final
분석용 Python: …/miniconda3/bin/python3
추가 분석 경로: …
설정 출처: 앱 기본 / 프로젝트 설정 / pyrightconfig.json …
설정 반영: 현재 session에 적용됨 또는 재시작 중
```

이는 예시 화면 데이터다. 서버가 내부적으로 읽은 설정의 출처를 API로 돌려주지 않는 경우, 앱이 보낸 설정과 서버가 실제 읽었다고 확인된 설정을 구분해서 표시해야 한다. `.vscode/settings.json`을 파일에서 발견했다는 이유만으로 “적용됨”이라고 해서는 안 된다. notebook kernel의 환경은 분석용 Python과 별도 줄에 표시한다.

첫 수정은 휴리스틱으로 `sys.path.insert()` 코드를 실행하거나, 프로젝트 전체를 무조건 탐색하거나, warning을 끄는 것이 아니다. **분석 설정의 출처·적용 상태를 확인 가능하게 만들고, 프로젝트 분석 설정을 연결하는 것**이다. Vim에서 배울 부분은 여기서도 local option과 provenance다.

## 7. 도입 구조와 코드 연결점

다음 새 모듈 이름은 제안이다. 이미 존재하는 파일과 혼동하지 않도록 현재 연결점을 함께 적었다.

| 제안 모듈·책임 | 연결할 현재 코드 | 피해야 할 구현 |
| --- | --- | --- |
| `ResultHistory`: 결과 집합·선택·갱신 | project search controller, language results, diagnostic store | 모든 provider를 하나의 새 검색 엔진으로 재작성 |
| `NavigationHistory`: 의도 있는 위치 이동 | tab navigation controller, Monaco adapter, language navigation | 기존 URL history에 줄 번호만 끼워 넣기 |
| `ChangeLocations`: 편집 그룹별 수정점 | live model change·Undo 경계 | 모든 키 입력·자동 scroll을 위치 이력에 기록 |
| `TextTargetResolver`: 범위 계산 | Monaco selection providers, Markdown editor actions | regex 하나로 모든 언어·Markdown을 파싱 |
| `EditorCommandRegistry`: 명령 설명·조건·실행·반복 여부 | application menu, Monaco actions, workspace command dispatch | Monaco의 `editor.action.*`와 앱 명령을 이름만 합쳐 무조건 실행 |
| `RepeatService`: 성공한 확정 편집 반복 | command registry, composition guard | DOM 이벤트 재생으로 IME·자동완성 상태 재현 |
| `CopyStore`: 선택한 조각·타입·pin | copy/cut/paste 처리, Monaco decorations | 모든 시스템 클립보드 변화를 상시 기록 |
| `EffectiveEditorSettings`: 값·scope·출처 | 언어 설정 scope, model options, document profile | 새 탭의 설정을 재사용 view의 이전 값에 덧씌우기만 함 |
| `WorkspaceSnapshot`: 복원 데이터 | editor groups, document manager, workspace sessions | 원본 문서 저장과 UI 세션 저장을 하나의 파일로 결합 |

공통으로 필요한 것은 작은 `CommandContext`다. 최소한 resource, model revision, group/view ID, notebook cell ID 여부, readonly, composition 상태, 실행 origin을 갖는다. 실제 타입은 기존 protocol과 model identity를 재사용한다. 별도 shadow text buffer를 만들지 않는다.

명령 registry는 **기능의 소유권을 빼앗는 중앙 엔진**이 아니라 사용 조건·도움말·반복 정책을 드러내는 얇은 경계여야 한다. 정렬은 Monaco, 진단은 language host, 저장은 document manager가 계속 맡는다.

## 8. Vim 모드를 별도로 판단해야 하는 이유

125개 항목 중 상당수는 Vim 키 바인딩 없이도 유용하다. 사용자가 원한 작은 기능들을 도입하는 데 modal editing 전체가 선행 조건은 아니다. 그래도 Vim 모드를 추가할 경우에는 다음을 별도 범위로 잡아야 한다.

### 8.1 Escape 소유권

현재 [Monaco adapter](../apps/desktop/src/renderer/adapters/monaco-editor.ts)의 Escape는 Markdown source에서 reader로 이동하는 동작과 연결되며 suggestion/find/rename/composition 조건을 검사한다.

Vim Insert mode의 Escape를 같은 이벤트로 reader 전환까지 처리하면 사용자는 코드를 편집하다 화면이 바뀌는 문제를 겪는다. 제안하는 우선순위는 **현재 입력 UI가 소비 → 조합 확정 처리 → Vim Insert/Visual 해제 → 그 밖의 명시적 source/reader 전환**이다. 정확한 키 정책은 product command metadata로 정하고, 하나의 키가 두 계층에서 연속 실행되지 않도록 해야 한다.

### 8.2 한글 입력과 비동기 명령

[composition-guard](../apps/desktop/src/renderer/editor/composition-guard.ts)는 DOM event의 `isComposing`만 보지 않는다. renderer 안의 조합 상태, keyCode 229, epoch, 마지막 입력이 반영된 뒤의 지연 해제를 다룬다. 새 Vim adapter가 자체 key listener에서 먼저 `preventDefault()`를 하면 이 보호를 우회할 수 있다.

최소 검증 시나리오는 한글 조합 중 Escape, 조합 확정 Enter, 자동완성 popup, rename input, 검색창, split 이동, 늦게 도착한 LSP jump, 연속 두 음절 입력, undo와 재생이다. 키 재생 테스트만으로 통과를 선언할 수 없다.

### 8.3 노트북과 다른 surface

notebook의 cell command mode, cell editor 내부 Vim Normal mode, 앱 전체 명령은 서로 다른 상태다. `j/k`, `dd`, Escape가 셀 이동·셀 삭제·문자 편집 중 어디로 가는지 먼저 정해야 한다. 기본은 focused cell editor 내부에서만 Vim 명령을 소비하고, 셀·파일 구조 변경은 별도 명시적 명령으로 둔다.

웹 문서·터미널·PDF·이미지·HWP·native reader에는 같은 키 엔진을 무조건 적용하지 않는다. surface별 가능한 명령과 focus 소유자가 다르다.

## 9. 권장 실행 순서

비용은 상대적인 의존성 기준이다. 일수 추정은 실제 구현 범위를 확정하기 전에는 의미가 없다.

| 단계 | 구체 산출물 | 완료 조건 | 의존·비용 |
| --- | --- | --- | --- |
| 0. 현재 명령 정리 | 정렬·join·case·fold·선택 명령 목록과 메뉴/팔레트 노출, disable 이유 | 기존 Monaco action을 중복 구현하지 않고 실행·Undo·readonly 확인 | 작음. key/focus 충돌 검증 필요 |
| 1. 환경 설명 | 적용값·scope·출처, notebook 분석 환경 표시 | import 문제에서 왜 다른지 사용자에게 설명 가능 | 중간. 서버 내부값은 확인 수준 표시 |
| 2. 결과 이력 | 검색 snapshot·이전/다음 목록·pin·stale 표시 | A→B→A와 비동기 취소, 위치 보정 통과 | 중간. 공통 위치 참조 필요 |
| 3. 위치 이력 | jump back/forward, last edit, navigation origin | 파일 내부·파일 간 왕복, IME·notebook 좌표 보존 | 중간. 2와 위치 모델 공유 |
| 4. 복사 저장소 | 최근 복사·이름 보관·선택 paste·짧은 highlight | 삭제 후 복사 보존, multi-cursor·Undo 검증 | 작음~중간. 지속 저장은 제외하고 시작 |
| 5. 구조 편집 | quote/word/paragraph target, Markdown 절·링크 대상 | Unicode·fence·중첩·잘못된 문법 테스트 | 중간~큼. 기존 provider 활용 |
| 6. 편집 반복 | 제한된 repeatable commands와 마지막 편집 반복 | 실패·취소·composition·Undo 계약 통과 | 중간. 0·5의 metadata 필요 |
| 7. 작업 공간 지속 | view/session·복구 snapshot | 비정상 종료·외부 변경·dirty 복구 시나리오 | 큼. 파일 무결성 설계 필요 |
| 8. 선택 확장 | 매크로·배치 편집·Vim mode·분기/영구 Undo | 각 기능별 수명·취소·복구 계약 | 큼. 각각 별도 결정 |

### 먼저 만들 만한 12개 사용자 명령

이름은 UI 제안이며 실제 등록된 명령명이 아니다.

| 명령 | 연결되는 분석 항목 | 사용 예 |
| --- | --- | --- |
| 이전 결과 목록 / 다음 결과 목록 | F02 | 다른 검색 후 원래 검색으로 돌아가기 |
| 현재 결과 목록 고정 | F03 | 리팩터링 대상 목록 유지 |
| 이전 탐색 위치 / 다음 탐색 위치 | G01/G06 | 정의를 읽고 호출 지점으로 복귀 |
| 마지막 수정 위치로 이동 | G02 | 긴 문서에서 방금 편집한 곳 찾기 |
| 현재 파일의 적용 설정 보기 | J05 | 들여쓰기·분석 경로 문제 확인 |
| 현재 키의 명령 보기 | M05 | Escape나 Ctrl 조합 충돌 확인 |
| 복사 저장소에서 붙여넣기 | D01/D07 | 여러 문단을 골라 재사용 |
| 복사 조각 이름 붙여 보관 | D01 | 자주 쓰는 실험 설명 유지 |
| 문자열 내용 선택 | A06 | 따옴표를 건드리지 않고 값 교체 |
| 문단 / 현재 절 선택 | A09/I08 | 문서 구조 단위 이동·편집 |
| 마지막 편집 반복 | C01 | 같은 변환을 다음 위치에 적용 |
| 현재 위치를 화면 중앙에 | L04 | 검색·정의 이동 후 주변 문맥 확인 |

## 10. 검증 결과와 앞으로의 수용 테스트

### 10.1 이번에 실행한 검증

재현 파일: [probe.vim](vim-feature-audit-2026-10-23/probe.vim), [run.py](vim-feature-audit-2026-10-23/run.py), [results.json](vim-feature-audit-2026-10-23/results.json).

```sh
python3 reports/vim-feature-audit-2026-10-23/run.py
```

사용자 vimrc·viminfo·플러그인을 로드하지 않고, 임시 디렉터리에서 `vim -Nu NONE -U NONE -i NONE --noplugin -n -es`로 실행한다. 원본 작업 파일이나 사용자 desktop을 열지 않는다. 생성한 테스트 문서·Undo 파일은 임시 디렉터리 종료 때 정리한다.

**15개 시나리오, 34개 assertion, 실패 0개.**

| 시나리오 | 확인한 동작 |
| --- | --- |
| TextObjects | 한글·emoji quote 내부, 중첩 괄호 범위 |
| DotRepeat | 다른 단어 위치에서 같은 change 반복 |
| Registers | yank 0 보존, linewise type, named append, 다른 register 유지 |
| MacroReplay | register에 준비한 입력의 count 재생. 실제 `q` 기록 입력은 별도 미검증 |
| Marks | 앞에 행 삽입 후 mark가 원래 내용을 따라감 |
| JumpHistory | 같은 파일 안의 과거·미래 점프 |
| Quickfix | 서로 다른 list ID, 이전 목록 복원, context 유지, changedtick 증가 |
| LocationList | split 시 복사, 이후 창별 변경 독립 |
| SharedBuffer | 텍스트 공유, 창별 커서 독립 |
| LocalOptions | buffer별 들여쓰기 설정 독립 |
| PathResolution | `path` + `.py` suffix에 따른 `gf` 파일 열기 |
| GlobalEdit | 조건에 해당하는 행만 변경, 전체 작업 한 번 Undo |
| UndoBranches | Undo 후 새 편집을 해도 이전 가지 재방문 |
| PersistentUndo | buffer 파기·재열기 후 Undo 파일을 읽어 원래 내용 복원 |
| PythonFtplugin | checkout runtime의 `.py` suffix·함수 이동 매핑 적용·해제 |

초기 harness에서 `<C-I>`를 단독 `:normal!` 인수로 넣자 Tab이 Ex의 앞 공백으로 파싱되어 `E471`이 발생했다. count `1`을 앞에 두어 같은 키 동작이 파서에서 보존되도록 수정했다. 기대 동작이나 assertion을 줄이지 않고 다시 실행해 통과했다.

이 결과는 terminal 기반 Vim의 선택된 동작에 대한 증거다. Setdown의 기능 완성, GUI parity, pinned Vim의 전체 회귀 테스트, 외부 LSP 플러그인의 동작을 검증한 것은 아니다. 보고서 작성만으로 app build·preview benchmark를 성공했다고 표시하지 않는다.

### 10.2 구현할 때 반드시 확인할 계약

| 영역 | 필수 시나리오 | 통과 의미 |
| --- | --- | --- |
| 선택·변환 | 한글, emoji, combining mark, 탭, CRLF, multiline, 빈 범위 | 잘못된 UTF-16 범위 편집이 없음 |
| 반복·배치 | 실패·중단·revision 변경·readonly·중첩 범위 | 부분 결과가 설명되고 늦은 편집을 적용하지 않음 |
| Undo | command 한 번 취소, view 변경, 여러 파일 | per-file Undo 계약을 전역 atomic Undo로 오해하지 않음 |
| 결과 이력 | query 교체·취소·truncation·삭제 대상·프로젝트 변경 | 예전 응답이 현재 결과를 덮지 않음 |
| 이동 이력 | 같은 파일, 다른 파일, rename, dirty file, 삭제 cell | 정확한 대상 또는 명시적 stale 처리 |
| 설정 | 프로젝트 경계, language 변경, view 재사용, unsupported encoding | 값·출처·해제가 일치 |
| 입력 | IME 조합/확정/Escape, suggestion, rename, 검색, notebook cell | 키 한 번이 두 명령을 실행하거나 입력을 잃지 않음 |
| 지속성 | 정상 재시작, crash, 디스크 외부 수정, 손상된 manifest | 원본을 덮지 않고 복구 선택 가능 |
| 성능 | 큰 모델·큰 결과 목록·여러 view·취소 | 입력 경로에 전체 파일/프로젝트 순회가 추가되지 않음 |

GUI/Electron 검증은 저장소 지침대로 격리된 Xvfb와 runtime/D-Bus 환경에서 실행해야 한다. preview preparation/presentation, source↔reader, source-position lookup, themes/CSS, Electron/Crossnote 의존성 경로를 건드리면 [preview performance contract](../docs/preview-performance-contract.md)에 따라 `npm run test:preview-contract`와 해당 성능 변경의 baseline/candidate benchmark를 수행한다. first/second/warm, Markdown/Git, edit/preparation 조건을 유지한다. 이 보고서는 해당 코드를 변경하지 않았다.

## 11. 이식하지 않거나 후순위로 둔 영역

| 영역 | 판단 근거 |
| --- | --- |
| C 편집 엔진·memline·terminal 화면 재구현 | Setdown의 Monaco model과 Electron rendering이 이미 핵심 기반이다. 동작을 가져오는 것과 엔진 교체는 규모가 다르다. |
| Vimscript/Vim9 전체 호환 runtime | 옵션·명령·autocmd 생태계까지 요구하는 큰 별도 제품 기능이다. 작은 편의 기능의 선행 조건이 아니다. |
| 정규식 문법 완전 호환 | 사용자 문법·error·replacement semantics까지 유지해야 한다. 기존 JS/Monaco 검색을 그대로 Vim regex라고 부르면 안 된다. |
| swap/undo binary 형식 호환 | 동작 목표는 참고하되 제품 문서 수명·UTF-16 model에 맞는 데이터가 필요하다. |
| 외부 셸 임의 실행·modeline 실행 | 이 보고서에서 제안한 편집·설정 기능에 필수적이지 않다. 명시적 task/filter가 필요할 때 별도 계약으로 다룬다. |
| ctags/cscope 인덱서 전체 추가 | 기존 LSP가 제공하는 symbol/reference 기능과 중복이 크다. 서버 없는 대형 프로젝트에서 수요를 확인한 뒤 fallback으로 검토한다. |
| Vim popup·GUI toolkit·printing·색 테마 그대로 복제 | Electron/Monaco의 대응 기능을 이용한다. 설정 출처, 짧은 feedback, 상태 설명을 우선 가져온다. |
| netrw·termdebug·원격 파일 전송 | Explorer·터미널·디버거/원격 작업의 별도 로드맵과 함께 결정한다. |
| 모든 언어의 ftplugin·syntax·indent 파일 복사 | 현재 language profile과 언어별 provider가 우선이다. 필요한 작은 규칙을 골라 적용·해제·테스트를 함께 이식한다. |
| 암호화·오른쪽에서 왼쪽 쓰기·특수 플랫폼 동작 | 중요한 기능이지만 이번 import/편집 편의 문제와 직접 연결되는 도입 우선순위는 낮다. 세부 동작 검증 범위에서 제외했다. |

Vim은 [공식 소개](https://www.vim.org/about.php)에서 별도 라이선스를 가진 charityware로 설명한다. 실제 소스·문서·runtime 파일을 제품에 복사하는 단계에서는 해당 파일의 고지와 [license 원문](../vendor/vim/runtime/doc/uganda.txt)을 확인하고, 저장소의 [외부 코드 정책](../docs/architecture/external-code.md)에 원본·pin·소비 경로·변경·고지를 기록해야 한다. 이번 결과물은 기능 분석과 별도 재현 script이며 Vim C 코드의 제품 편입이 아니다.

## 12. 후속 구현자가 먼저 읽을 소스

| 질문 | 핵심 소스 | upstream 테스트 참고 |
| --- | --- | --- |
| 범위가 정확히 어디인가 | `src/textobject.c`, `src/normal.c`, `src/ops.c` | [test_textobjects](../vendor/vim/src/testdir/test_textobjects.vim) |
| 반복이 무엇을 재생하는가 | `src/getchar.c:start_redo`, `src/register.c:do_record/do_execreg` | [test_registers](../vendor/vim/src/testdir/test_registers.vim) 및 repeat 관련 테스트 |
| 이전 위치가 어떻게 움직이는가 | `src/mark.c`, `src/undo.c` | [test_marks](../vendor/vim/src/testdir/test_marks.vim), [test_jumplist](../vendor/vim/src/testdir/test_jumplist.vim), [test_changelist](../vendor/vim/src/testdir/test_changelist.vim) |
| 결과 목록의 수명은 무엇인가 | `src/quickfix.c:qf_new_list/qf_jump/qf_mark_adjust` | [test_quickfix](../vendor/vim/src/testdir/test_quickfix.vim) |
| 분기·영구 Undo는 무엇이 다른가 | `src/undo.c:u_undo/undo_time/u_write_undo/u_read_undo` | [test_undo](../vendor/vim/src/testdir/test_undo.vim), [test_ex_undo](../vendor/vim/src/testdir/test_ex_undo.vim) |
| 파일명이 모듈명처럼 보일 때 무엇을 하는가 | `src/findfile.c`, `runtime/ftplugin/python.vim` | 본 보고서 `PathResolution`·`PythonFtplugin` probe |
| 언어가 바뀌면 무엇을 지우는가 | Python/Markdown의 `b:undo_ftplugin` | 본 보고서 `PythonFtplugin` probe |
| 정렬·숫자 증감의 예외는 무엇인가 | `src/ex_cmds.c`, `src/ops.c` | [test_sort](../vendor/vim/src/testdir/test_sort.vim), [test_increment](../vendor/vim/src/testdir/test_increment.vim) |
| 세션과 view는 무엇을 저장하는가 | `runtime/doc/usr_21.txt`, `src/session.c` | [test_mksession](../vendor/vim/src/testdir/test_mksession.vim) |
| 작은 선택 패키지는 수명을 어떻게 다루는가 | `hlyank`, `editorconfig`, `comment`, `cfilter` | 각 패키지 도움말·구현; 이번에는 전체 패키지 테스트 미실행 |

upstream 테스트는 후속 구현의 예외 사례를 찾기 위한 근거이며 이번 조사에서 그 전체를 실행하지 않았다. 특히 `version9.txt`의 향후 9.3 작업 중 섹션을 읽을 때에는 릴리스 이름만으로 기능을 추정하지 말고 현재 pin의 구현·도움말을 확인해야 한다.

Setdown에 가장 직접적인 이득은 **사용자가 하던 일을 기억하고, 돌아갈 곳을 제공하고, 현재 상태의 이유를 설명하는 편집기**가 되는 데 있다. 위 순서는 기존 Monaco·언어 지원·문서 소유권을 살리면서 그 동작을 추가하기 위한 순서다.
