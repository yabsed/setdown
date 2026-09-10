# MarkTex

한 번에 Markdown 파일 하나를 아름답게 읽고 가볍게 수정하는 데스크톱 앱입니다. 렌더링은 Crossnote(Markdown Preview Enhanced의 core), 원문 편집은 Monaco Editor(VS Code의 editor)를 사용합니다.

## 사용법

```sh
npm install
npm start
```

파일 경로를 바로 넘길 수도 있습니다.

```sh
npm start -- ./document.md
```

- Viewer의 문단을 더블 클릭하면 대응하는 원문 행에서 Editor가 열립니다.
- Editor에서 `Esc`를 누르면 저장하지 않고 최신 내용을 다시 렌더링해 Viewer로 돌아갑니다.
- `Ctrl/Cmd+S`는 저장, `Ctrl/Cmd+O`는 파일 열기, `Ctrl/Cmd+E`는 두 화면 전환입니다.

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

Crossnote의 code chunk, 문서별 `.crossnote` script/config, HTML5 embed는 신뢰하지 않은 파일을 안전하게 여는 제품 성격에 맞춰 비활성화돼 있습니다. Viewer는 앱과 다른 `marktex-preview:` origin에서 실행되며 로컬 자산은 현재 문서 폴더와 Crossnote 배포 자산으로 제한됩니다.
