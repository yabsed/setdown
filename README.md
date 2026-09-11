# Setdown

> **Write plain. Read beautifully.**

한 번에 Markdown 파일 하나를 아름답게 읽고 가볍게 수정하는 데스크톱 앱입니다. Setdown은 복잡한 도구를 앞세우는 대신, 평문으로 쓰고 잘 조판된 문서로 읽는 흐름에 집중합니다. 렌더링은 Crossnote(Markdown Preview Enhanced의 core), 원문 편집은 Monaco Editor(VS Code의 editor)를 사용합니다.

## 사용법

```sh
npm install
npm start
```

파일 경로를 바로 넘길 수도 있습니다.

```sh
npm start -- ./document.md
```

### Linux/GNOME에 설치

다음 명령은 Setdown을 현재 사용자 영역에 설치하고 GNOME 앱 목록에 등록합니다.
또한 `.md` 파일의 기본 앱을 Setdown으로 지정합니다. 관리자 권한은 필요하지 않습니다.

```sh
npm run install:linux
```

설치 후 GNOME 앱 화면에서 **Setdown**을 검색하거나, 파일 관리자에서 Markdown
파일을 더블 클릭해 열 수 있습니다. 배포 파일만 만들려면 `npm run package:linux`를
사용합니다(`release/`에 AppImage와 deb가 생성됩니다).

- Viewer의 **어느 지점이든** 더블 클릭하면 Editor가 열립니다. 빈 파일, 수식, 그림,
  raw HTML, 문서 아래 여백도 예외가 아닙니다. 원문 위치를 정확히 알 수 없으면
  가장 설득력 있는 위치를 추정하며, 전환 자체가 취소되는 일은 없습니다.
- Editor에서 `Esc`를 누르면 저장하지 않고 최신 내용을 다시 렌더링해 Viewer로
  돌아갑니다. 이때 따라가는 것은 cursor가 아니라 **보고 있던 화면**입니다.
  커서가 10행에 있어도 300행을 읽고 있었다면 Viewer는 300행 근처를 보여 줍니다.
- 더블 클릭한 높이는 반대편 화면에서도 유지됩니다. 화면 70% 높이의 문단을 눌렀다면
  Editor에서도 그 행이 70% 높이에 놓입니다.
- `Ctrl/Cmd+N`은 새 문서, `Ctrl/Cmd+O`는 파일 열기, `Ctrl/Cmd+S`는 저장,
  `Ctrl/Cmd+E`는 두 화면 전환, `Ctrl/Cmd+Shift+P`는 PDF 내보내기입니다.
- Editor에서 스크린샷이나 클립보드 이미지를 붙여넣으면
  `<문서 이름>.assets/`에 PNG로 저장하고 현재 커서에 상대경로 이미지 문법을
  삽입합니다. 새 문서는 이미지 저장 전에 Markdown 파일의 저장 위치를 묻습니다.

## 개발과 검증

```sh
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Codex 실행 환경처럼 `ELECTRON_RUN_AS_NODE=1`이 설정된 셸에서는 Electron 명령 앞에서 해당 변수만 제거해야 합니다.

```sh
env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

Crossnote의 code chunk, 문서별 `.crossnote` script/config, HTML5 embed는 신뢰하지 않은 파일을 안전하게 여는 제품 성격에 맞춰 비활성화돼 있습니다. Viewer는 앱과 다른 내부 `marktex-preview:` origin에서 실행되며 로컬 자산은 현재 문서 폴더와 Crossnote 배포 자산으로 제한됩니다. 이 프로토콜 이름은 기존 문서 세션과의 호환성을 위해 유지되는 내부 식별자입니다.

## 화면을 기준으로 한 위치 변환

Viewer와 Editor는 서로 다른 두 문서가 아니라 같은 문서를 보는 두 렌즈입니다. 두
방향의 전환은 하나의 `ViewportAnchor`(원문 행·열, 화면 세로 비율, 근거,
confidence)로 통일돼 있습니다. 자세한 설계는
[리포트](reports/2026_09_11_01_56_screen_first_html_markdown_position_mapping.md)에
있습니다.

- [`src/shared/viewport-anchor.ts`](src/shared/viewport-anchor.ts) — 어떤 입력에도
  anchor를 내놓는 total function입니다. `null`을 반환하지 않으며, 결과 행은 언제나
  `[1, 문서 행 수]` 안입니다. `confidence`는 시험과 디버깅을 위한 값이지 전환을
  취소하는 스위치가 아닙니다.
- [`src/preview/bridge.ts`](src/preview/bridge.ts) — Viewer iframe 안에서 도는
  다리입니다. 클릭 지점에서 ① 자신·조상의 source range ② 좌표에 가장 가까운 후손
  ③ 앞뒤 anchor 보간 ④ 클릭 높이를 덮는 anchor ⑤ 전체 scroll 비율 ⑥ 빈 문서의 1행
  순서로 내려가되, 사다리 밖으로 떨어지지 않습니다. 렌더가 끝날 때마다 source
  atlas를 한 번만 만들고 resize·이미지 로드·다이어그램 렌더 때 무효화합니다.
  링크와 실행 control의 single click은 약 250ms 붙잡아 두어 두 번째 click이 항상
  Viewer에 닿게 합니다.
- [`src/main/source-anchors.ts`](src/main/source-anchors.ts) — 추정하기 전에 정보를
  잃지 않게 합니다. Crossnote의 `math_block` renderer는 `token.map`을 갖고도 KaTeX
  HTML만 돌려주므로 독립 수식이 원문 행을 잃습니다. 여기서 block 수식·인라인
  수식·raw HTML block이 각각 `data-source-lines`, `data-source-start`,
  `data-source-line`을 나르도록 markdown-it instance를 감쌉니다. 그대로 upstream
  Crossnote에 보낼 수 있는 모양입니다.

시험은 두 가지를 나눠서 봅니다. **liveness**는 Viewer의 어느 좌표를 눌러도
`data-surface="editor"`가 되는지 보고(mapping 근거가 fallback이어도 성공입니다),
**accuracy**는 수식·여백·링크 같은 fixture마다 기대한 행으로 가는지 봅니다.
전환 뒤의 anchor는 `.shell`의 `data-anchor-line`, `data-anchor-reason`,
`data-anchor-confidence`로 읽을 수 있습니다.

### 아직 남은 것

- raw HTML block 안의 수식은 block 범위까지만 정확합니다. 같은 block 안에 수식이
  여러 개일 때 `(blockId, occurrenceIndex)`로 구분하는 sidecar atlas는 없습니다.
- container(blockquote, 목록) 안 인라인 수식의 열은 marker를 되돌려 계산하므로,
  줄 앞부분이 원문과 다르게 변형되는 문법에서는 문단 행까지만 믿을 수 있습니다.
