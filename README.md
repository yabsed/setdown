<p align="center">
  <img src="public/setdown-mark.svg" width="104" height="104" alt="Setdown logo">
</p>

<h1 align="center">Setdown</h1>

<p align="center">
  <strong>Write plain. Read beautifully.</strong><br>
  Markdown을 문서답게 읽고, 필요한 순간에만 바로 고치는 데스크톱 앱
</p>

<table>
  <tr>
    <td width="50%" align="center"><strong>Viewer — 문서답게 읽기</strong></td>
    <td width="50%" align="center"><strong>Editor — 같은 자리에서 바로 고치기</strong></td>
  </tr>
  <tr>
    <td><img src="docs/assets/setdown-tabs.png" alt="수식 문서를 렌더링하고 여러 Markdown 문서를 탭으로 연 Setdown Viewer"></td>
    <td><img src="docs/assets/setdown-editor.png" alt="같은 수식 문서의 Markdown 원문을 편집하는 Setdown Editor"></td>
  </tr>
</table>

Setdown은 Markdown 편집기 위에 미리보기를 붙인 앱이 아닙니다. 평소에는 수식과
그림, 표가 조판된 문서를 읽고, 고칠 곳을 발견하면 그 자리에서 원문으로 들어갑니다.
읽기와 편집은 서로 다른 작업 공간이 아니라 같은 문서를 보는 두 개의 렌즈입니다.

렌더링에는 [Crossnote](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)의
엔진을, 원문 편집에는 VS Code와 같은 [Monaco Editor](https://microsoft.github.io/monaco-editor/)를
사용합니다.

## Setdown다운 점

### 읽던 곳에서 바로 편집

Viewer의 문단, 수식, 그림 또는 여백을 더블 클릭하면 해당 원문 위치에서 Editor가
열립니다. Editor에서 `Esc`를 누르면 편집하던 화면 높이에 맞춰 Viewer로 돌아갑니다.
커서가 아니라 **사용자가 보고 있던 화면**이 전환의 기준입니다.

```text
국어책 5페이지 → 편집 → 국어책 5페이지
```

### 문서마다 살아 있는 탭

여러 Markdown 파일을 브라우저처럼 탭으로 열 수 있습니다. 각 탭은 다음 상태를
독립적으로 보존합니다.

- Viewer의 실제 렌더링 DOM과 스크롤 위치
- Editor의 문서 모델, 커서와 스크롤 위치
- Viewer/Editor 모드
- 저장 여부와 렌더링 revision

이미 조판한 탭은 HTML을 다시 읽거나 수식을 다시 렌더링하지 않습니다. 숨겨 둔
렌더링 DOM을 그대로 보여 주므로 문서를 왕복해도 읽던 페이지가 유지됩니다.

```text
국어책 5페이지 → 수학책 4페이지 → 국어책 5페이지
```

### 수식이 많은 문서도 마지막 결과를 유지

편집 중 새 preview를 백그라운드에서 준비합니다. 최신 revision의 조판이 끝날 때까지
현재 Viewer를 버리지 않으므로, 큰 수식 문서에서 흰 화면이나 미완성 결과가 먼저
나타나지 않습니다.

### 이미지 붙여넣기

이미지의 출처에 따라 가장 이식성 있는 Markdown을 만듭니다.

- HTTP/HTTPS 이미지: 원본 URL을 직접 삽입하고 로컬에 복사하지 않음
- 파일 관리자에서 복사한 이미지: 원래 형식으로 `<문서 이름>.assets/`에 복사
- 스크린샷처럼 픽셀만 있는 이미지: PNG asset으로 저장

아직 저장하지 않은 새 문서도 이미지를 붙여넣고 Viewer에서 볼 수 있습니다. 이미지는
앱 내부의 문서별 draft bundle에 보관되며, Save As가 성공하면 Markdown과 함께
최종 `<문서 이름>.assets/`로 안전하게 이전됩니다. 사용자가 경로를 정하기 전에는
`~/Documents`를 임의로 변경하지 않습니다.

### 데스크톱 문서 앱

- 빈 문서 생성과 Save As
- PDF 내보내기
- 외부 파일 변경 감지
- 미저장 탭의 `취소 · 저장 안 함 · 저장` 종료 흐름
- GNOME 앱 목록과 파일 관리자 통합
- `.md`, `.markdown`, `.mdx`, `.qmd`, `.rmd` 등 Markdown 계열 연결

## 설치

### Linux/GNOME 사용자 설치

```sh
npm install
npm run install:linux
```

관리자 권한 없이 현재 사용자 영역에 설치됩니다. 설치 후 GNOME 앱 화면에서
**Setdown**을 검색하거나 파일 관리자에서 Markdown 파일을 더블 클릭해 열 수 있습니다.
실행 파일은 `~/.local/share/setdown`에 설치되고 `setdown.desktop`이 등록됩니다.

배포 파일만 만들려면 다음 명령을 사용합니다. AppImage와 deb는 `release/`에 생성됩니다.

```sh
npm run package:linux
```

### 저장소에서 실행

```sh
npm install
npm start
```

시작할 문서를 직접 넘길 수도 있습니다.

```sh
npm start -- ./document.md
```

## 조작

| 동작 | 마우스 / 키보드 |
| --- | --- |
| Viewer에서 편집 | 원하는 지점을 더블 클릭 |
| Editor에서 Viewer로 | `Esc` |
| Viewer/Editor 전환 | `Ctrl/Cmd+E` 또는 탭 바 오른쪽 아이콘 |
| 새 문서 | `Ctrl/Cmd+N` |
| 파일 열기 | `Ctrl/Cmd+O` |
| 저장 | `Ctrl/Cmd+S` |
| 다른 이름으로 저장 | `Ctrl/Cmd+Shift+S` |
| PDF 내보내기 | `Ctrl/Cmd+Shift+P` |
| 탭 닫기 | `Ctrl/Cmd+W` |
| 다음/이전 탭 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |

## 내부 설계

### 하나의 화면 좌표

Viewer와 Editor 사이의 이동은 `ViewportAnchor`로 통일됩니다. 원문 행·열뿐 아니라
그 지점이 화면의 어느 높이에 있었는지와 mapping 근거까지 함께 전달합니다.

- [`src/shared/viewport-anchor.ts`](src/shared/viewport-anchor.ts): 항상 유효한 위치를
  반환하는 좌표 계산
- [`src/preview/bridge.ts`](src/preview/bridge.ts): 렌더링 DOM과 원문 위치 사이의 연결
- [`src/main/source-anchors.ts`](src/main/source-anchors.ts): 수식과 raw HTML이 원문
  위치 정보를 잃지 않도록 source metadata 주입

### revision 기반 preview

렌더 결과는 revision 번호를 가지며, 현재 문서와 일치하는 최신 결과만 화면에 적용됩니다.
탭 전환으로 늦은 렌더 작업이 돌아오더라도 다른 문서에 잘못 적용될 수 없습니다.

### 새 문서 draft bundle

저장 전 문서는 `<userData>/drafts/<UUID>/` 아래에서 Markdown 기준 경로와 asset을
함께 관리합니다. Save As는 asset을 목적지와 같은 파일 시스템의 임시 디렉터리에
복사한 뒤 rename하고, Markdown 링크를 갱신해 atomic write합니다. 모든 단계가
성공한 뒤에만 draft를 삭제합니다.

자세한 내용은 [Draft Asset Bundle 전략 보고서](reports/2026_09_11_18_00_untitled_draft_asset_bundle_strategy.md)에
정리되어 있습니다.

### 안전한 Viewer

Viewer는 앱 UI와 분리된 `marktex-preview:` origin에서 실행됩니다. 로컬 resource는
현재 문서 디렉터리와 필요한 Crossnote 자산으로 제한됩니다. 신뢰하지 않은 문서를
열 수 있도록 code chunk, 문서별 `.crossnote` script/config, HTML5 embed 실행은
비활성화되어 있습니다.

## 개발과 검증

```sh
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`ELECTRON_RUN_AS_NODE=1`이 설정된 환경에서는 Electron 실행 때 해당 변수만 제거합니다.

```sh
env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

테스트는 문서 revision, preview 경쟁 상태, Viewer↔Editor 좌표 mapping, 수식 source
anchor, 이미지 저장, draft asset transaction을 각각 검증합니다.

## 설계 문서

- [화면 우선 HTML↔Markdown 위치 mapping](reports/2026_09_11_01_56_screen_first_html_markdown_position_mapping.md)
- [revision-aware preview 사전 렌더링](reports/2026_09_11_15_50_revision_aware_preview_prerender_strategy.md)
- [수식 렌더 중 마지막 preview 유지](reports/2026_09_11_02_28_keep_last_preview_during_math_rendering.md)
- [새 문서 Draft Asset Bundle](reports/2026_09_11_18_00_untitled_draft_asset_bundle_strategy.md)

## 현재 알려진 한계

- 하나의 raw HTML block 안에 수식이 여러 개 있으면 block 내부의 정확한 열보다
  해당 block의 원문 행 범위를 우선합니다.
- 비정상 종료 시 draft bundle은 보존되지만 다음 실행에서 복구할 draft를 선택하는
  전용 화면은 아직 없습니다.
