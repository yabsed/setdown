<p align="center">
  <img src="apps/desktop/public/setdown-mark.svg" width="104" height="104" alt="Setdown logo">
</p>

<h1 align="center">Setdown</h1>

<p align="center">
  <strong>Write plain. Read beautifully.</strong><br>
  읽을 때는 완성된 문서로, 고칠 때는 익숙한 Markdown으로.
</p>

<p align="center">
  <img src="live_demo.gif" width="900" alt="Setdown Viewer에서 원하는 문단을 더블 클릭해 편집하고 다시 Viewer로 돌아오는 모습">
</p>

Setdown은 로컬 Markdown 파일을 위한 데스크톱 문서 앱입니다. 평소에는 수식, 표,
이미지가 조판된 문서를 읽고, 수정할 곳을 발견하면 그 자리에서 원문을 엽니다.
Viewer와 Editor는 별도의 작업 공간이 아니라 같은 문서를 바라보는 두 가지 화면입니다.

<table>
  <tr>
    <td width="50%" align="center"><strong>Viewer · Paper</strong></td>
    <td width="50%" align="center"><strong>Editor · One Dark</strong></td>
  </tr>
  <tr>
    <td><img src="docs/assets/setdown-tabs.png" alt="Paper 테마로 수식 문서를 렌더링하고 여러 Markdown 문서를 탭으로 연 Setdown Viewer"></td>
    <td><img src="docs/assets/setdown-editor.png" alt="One Dark 테마에서 같은 Markdown 문서의 원문을 편집하는 Setdown Editor"></td>
  </tr>
</table>

## 핵심 경험

### 읽던 곳에서 바로 편집

Viewer의 문단, 수식, 그림 또는 여백을 더블 클릭하면 대응하는 원문 위치에서 Editor가
열립니다. `Esc`를 누르면 편집하던 화면 높이에 맞춰 Viewer로 돌아갑니다. 전환의 기준은
커서 한 점이 아니라 사용자가 보고 있던 화면입니다.

```text
문서 5페이지 → 편집 → 문서 5페이지
```

### 기다리지 않는 문서 탭

각 탭은 Viewer의 렌더링 DOM과 스크롤, Editor의 모델과 커서, 현재 모드와 저장 상태를
독립적으로 유지합니다. 다른 탭에 다녀와도 이미 조판한 문서를 다시 렌더링하지 않으며,
탭을 창 밖으로 끌어 새 창으로 분리하거나 다른 Setdown 창으로 옮길 수 있습니다.

```text
국어책 5페이지 → 수학책 4페이지 → 국어책 5페이지
```

편집 중에는 다음 Preview를 백그라운드에서 준비하고, 최신 결과가 완성될 때까지 현재
Viewer를 유지합니다. 수식이 많은 문서에서도 흰 화면이나 미완성 Preview가 먼저
나타나지 않습니다.

### 읽기에 필요한 도구

- 실제 렌더링 결과의 제목에서 만든 문서별 목차
- `Ctrl/Cmd+F`로 여는 Preview 검색과 이전·다음 결과 이동
- PDF 내보내기
- GitHub Light, Paper, Medium, Solarized Light, GitHub Dark, Night, One Dark,
  Solarized Dark 테마
- 파일의 외부 변경 감지

테마는 Viewer, 앱 UI, Monaco Editor에 함께 적용되며 열린 모든 창에서 동일하게
유지됩니다. 테마를 바꿔도 Markdown을 다시 렌더링하거나 Preview URL을 다시 열지
않으므로, 검색 결과와 읽던 위치도 그대로 남습니다. 선택한 테마는 앱을 다시 실행해도
복원됩니다.

### 번거로운 Markdown 구조만 도와주는 Editor

Setdown은 원문을 감추는 서식 도구 대신, 손으로 만들기 번거로운 구조만 생성합니다.
결과는 언제나 Monaco에서 직접 읽고 고칠 수 있는 평범한 Markdown이며 한 번의 undo로
되돌릴 수 있습니다.

- **표 삽입:** 열은 최대 12개, 데이터 행은 최대 30개까지 지정해 GFM pipe table 생성
- **TSV 가져오기:** 스프레드시트에서 복사한 셀을 표 편집기에 불러와 Markdown으로 변환
- **링크 삽입:** URL 또는 OS 파일 선택기로 고른 로컬 파일을 portable Markdown 링크로 생성
- **빠른 URL 붙여넣기:** 선택한 텍스트 위에 HTTP/HTTPS/mailto/tel URL을 붙여 바로 링크 생성

표의 pipe와 줄바꿈, 링크의 공백·괄호·제목 문자는 문맥에 맞게 escape됩니다. 로컬
파일은 현재 문서 기준 상대 경로를 사용하고, 아직 저장하지 않은 문서는 잘못된 임시
경로를 만들지 않도록 먼저 저장 위치를 정합니다.

### 이미지는 붙여넣기만 하면 끝

Editor에 이미지를 붙여넣으면 출처에 맞는 Markdown과 asset을 만듭니다.

- 웹 이미지: 원본 HTTP/HTTPS URL 삽입
- 파일 관리자에서 복사한 이미지: 원래 형식으로 `<문서 이름>.assets/`에 복사
- 스크린샷이나 픽셀 이미지: PNG asset으로 저장

저장하지 않은 새 문서의 이미지도 앱 내부 draft bundle에 보관됩니다. Save As가
성공하면 Markdown과 함께 최종 asset 폴더로 안전하게 이동합니다.

## 설치와 실행

### 저장소에서 실행

```sh
npm install
npm start
```

시작할 문서를 직접 넘길 수도 있습니다.

```sh
npm start -- ./document.md
```

### Linux/GNOME 사용자 설치

```sh
npm install
npm run install:linux
```

관리자 권한 없이 현재 사용자 영역에 설치합니다. 설치 후 GNOME 앱 화면에서
**Setdown**을 검색하거나 파일 관리자에서 Markdown 파일을 더블 클릭해 열 수 있습니다.
실행 파일은 `~/.local/share/setdown`에, Desktop entry는 사용자 애플리케이션 영역에
등록됩니다.

배포 파일만 만들려면 다음 명령을 사용합니다. AppImage와 deb는
`apps/desktop/release/`에 생성됩니다.

```sh
npm run package:linux
```

Windows NSIS 설치 파일은 Windows 환경에서 만들 수 있습니다.

```sh
npm run package:win
```

Windows 설치기는 사용자 단위로 설치되며 설치 경로를 선택할 수 있습니다. 바탕 화면과
시작 메뉴 바로가기, Markdown 계열 파일 연결도 함께 구성합니다.

### 저장소 구조

저장소는 배포 단위를 먼저 나누고, 각 앱 안에서는 실행 프로세스와 기능 책임으로
나눕니다. 모바일이나 서버가 추가되면 `apps/` 아래에 독립된 workspace로 들어갑니다.
둘 이상의 앱이 실제로 공유하는 코드만 그 시점에 `packages/`로 추출합니다.

```text
apps/
├── desktop/
│   ├── src/main/             Electron main process
│   ├── src/preload/          renderer IPC 경계
│   ├── src/preview-runtime/  격리된 Reader WebContents
│   ├── src/renderer/         Svelte UI와 workspace
│   └── src/shared/           데스크톱 프로세스 간 순수 로직과 계약
└── code-growth/              저장소 코드 성장 그래프 앱과 결과물
```

## 조작

| 동작 | 마우스 / 키보드 |
| --- | --- |
| Viewer에서 해당 위치 편집 | 원하는 지점을 더블 클릭 |
| Editor에서 Viewer로 돌아가기 | `Esc` |
| Viewer / Editor 전환 | `Ctrl/Cmd+E` 또는 탭 바 오른쪽 아이콘 |
| 렌더링된 문서에서 찾기 | `Ctrl/Cmd+F` |
| 새 창 | `Ctrl/Cmd+Shift+N` |
| 새 문서 | `Ctrl/Cmd+N` |
| 파일 열기 | `Ctrl/Cmd+O` |
| 저장 / 다른 이름으로 저장 | `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` |
| 링크 삽입 | `Ctrl/Cmd+K` |
| 탭 닫기 | `Ctrl/Cmd+W` |
| 다음 / 이전 탭 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 탭 순서 변경·창 분리 | 탭을 드래그 |
| 실제 크기 / 확대 / 축소 | `Ctrl/Cmd+0` / `Ctrl/Cmd++` / `Ctrl/Cmd+-` |

표 삽입, PDF 내보내기, 테마 변경과 창 관리는 앱 메뉴에서도 사용할 수 있습니다.
운영체제의 별도 메뉴 바 대신 창 안의 `File · View · Insert · Edit · Window` 메뉴를
항상 보여 주므로 전체 화면에서도 명령과 단축키를 확인할 수 있습니다.

## 어떻게 동작하나요?

### Crossnote + Monaco

문서 렌더링에는
[Crossnote](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)의 엔진을,
원문 편집에는 VS Code와 같은
[Monaco Editor](https://microsoft.github.io/monaco-editor/)를 사용합니다.

### 화면 좌표를 보존하는 전환

`ViewportAnchor`는 원문 행·열과 함께 해당 지점이 화면의 어느 높이에 있었는지,
어떤 근거로 연결되었는지를 전달합니다.

Editor 안에 커서가 보이면 wrap된 시각 행까지 계산해 그 위치를 우선합니다. 커서가
화면 밖에 있으면 보이는 원문 행 전체를 하나의 띠로 모으고, 렌더링된 block 높이로
가중한 무게중심을 사용합니다. 긴 문단과 수식 때문에 Viewer의 줄 높이가 달라도 화면
전체의 오차가 한쪽으로 몰리지 않습니다.

- [`apps/desktop/src/shared/viewport-anchor.ts`](apps/desktop/src/shared/viewport-anchor.ts): 항상 유효한 화면 좌표 계산
- [`apps/desktop/src/preview-runtime/bridge.ts`](apps/desktop/src/preview-runtime/bridge.ts): 렌더링 DOM과 원문 위치 연결
- [`apps/desktop/src/main/preview/source-anchors.ts`](apps/desktop/src/main/preview/source-anchors.ts): 수식과 raw HTML에 source metadata 주입

### Revision 기반 Preview

모든 렌더 결과는 revision 번호를 가집니다. 현재 문서와 일치하는 최신 결과만 화면에
적용되므로, 탭 전환 중 늦게 끝난 작업이 다른 문서에 잘못 표시되지 않습니다.
살아 있는 Preview는 문서별 `WebContentsView`로 유지되어 탭을 옮길 때도 다시 로드하지
않습니다.

탭을 같은 크기의 창으로 옮길 때는 기존 pixel scroll을 건드리지 않습니다. 창 너비가
달라 본문 줄바꿈이 바뀌는 경우에는 source anchor와 viewport 내 상대 높이를 이용해
같은 내용을 다시 찾습니다. 드래그 중에는 문서 경로나 URL 대신 앱 내부에서만 유효한
transfer ID를 사용합니다.

### UI를 멈추지 않는 렌더 파이프라인

Markdown-it과 KaTeX 조판은 Electron main process 밖의 전용 utility process에서
실행됩니다. 큰 수식 문서를 렌더링하는 동안에도 창, 탭, 입력과 IPC가 응답할 수 있습니다.

- 문서 폴더·테마별 Crossnote Notebook과 KaTeX 결과 재사용
- 수식 마크업을 Crossnote 후처리 뒤로 미뤄 불필요한 대형 DOM parsing 축소
- 문서를 source block으로 나눠 변경된 구간만 Preview DOM에 patch
- 다음 문서에 쓸 Preview `WebContentsView`를 미리 부팅해 첫 navigation 비용 제거
- Editor와 마지막으로 완성된 Viewer를 함께 유지하고 새 revision은 뒤에서 준비

따라서 `Esc`와 탭 전환은 새 조판의 완료를 기다리지 않습니다. 새 결과가 준비되기
전까지는 마지막으로 완성된 문서를 보여 주고, 완성된 revision만 한 번에 적용합니다.

### 로컬 문서를 위한 안전 경계

Viewer는 앱 UI와 분리된 `marktex-preview:` origin에서 실행됩니다. 로컬 resource 접근은
현재 문서 디렉터리와 필요한 Crossnote 자산으로 제한합니다. 신뢰하지 않은 문서를 열 수
있도록 code chunk, 문서별 `.crossnote` script/config, HTML5 embed 실행은 비활성화되어
있습니다.

저장 전 문서는 `<userData>/drafts/<UUID>/` 아래의 독립된 bundle로 관리합니다. Save As는
asset 복사와 Markdown 링크 갱신이 모두 성공한 뒤에만 draft를 삭제합니다.

## 개발과 검증

### 저장소의 성장

아래 그래프는 각 커밋의 실제 시각과 그 시점의 앱 소스·테스트·빌드 코드 줄 수를 함께
보여 줍니다.

<p align="center">
  <img src="apps/code-growth/output/repository-code-growth.png" width="960" alt="Setdown 저장소의 커밋별 코드 성장 그래프">
</p>

그래프를 다시 만들려면 다음 명령을 실행합니다.

```sh
npm run plot:code-growth
```

```sh
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`ELECTRON_RUN_AS_NODE=1`이 설정된 환경에서는 Electron 실행 시 해당 변수만 제거합니다.

```sh
env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

테스트는 문서 revision, Preview 경쟁 상태, Viewer↔Editor 좌표 mapping, 탭 분리,
테마 전파, 목차·검색, 이미지 저장과 draft asset transaction을 검증합니다.

저장소에는 구현 비교와 규격 확인을 위한 upstream source가 submodule로 포함되어
있습니다. 일반 빌드는 npm dependency를 사용하며, reference source까지 받으려면 다음을
실행합니다.

```sh
git submodule update --init --recursive
```

- `vendor/vscode`: Monaco와 VS Code 동작 참고
- `vendor/vscode-markdown-preview-enhanced`: Markdown Preview Enhanced 통합 참고
- `vendor/commonmark-spec`: 링크 직렬화와 CommonMark 규격 확인

## 설계 기록

- [화면 우선 HTML↔Markdown 위치 mapping](reports/2026_09_11_01_56_screen_first_html_markdown_position_mapping.md)
- [수식 렌더 중 마지막 Preview 유지](reports/2026_09_11_02_28_keep_last_preview_during_math_rendering.md)
- [Revision-aware Preview 사전 렌더링](reports/2026_09_11_15_50_revision_aware_preview_prerender_strategy.md)
- [새 문서 Draft Asset Bundle](reports/2026_09_11_18_00_untitled_draft_asset_bundle_strategy.md)
- [탭 분리와 WebContents 소유권 이전](reports/2026_09_12_15_51_tab_detach_webcontents_reparenting_architecture.md)
- [표 편집기와 링크 삽입](reports/2026_09_12_16_20_table_and_link_insertion.md)
- [Preview 목차·검색·테마 계획](reports/2026_09_12_16_30_preview_toc_search_theme_plan.md)
- [Preview 도구와 테마 상태 분리](reports/2026_09_12_17_27_preview_controls_and_theme_state_architecture.md)
- [Preview iframe 합성 실험](reports/2026_09_12_18_20_preview_iframe_compositing_architecture.md)
- [통합 제품 테마](reports/2026_09_12_18_38_unified_product_theme_architecture.md)
- [즉시 보이는 Preview 전환](reports/2026_09_12_20_14_zero_wait_preview_transition_architecture.md)
