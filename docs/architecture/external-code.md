# 외부 코드와 빌드 입력

`vendor/`의 존재와 실행 의존성은 구분한다. npm으로 실행하는 라이브러리의 버전은
`package-lock.json`, git 소스의 버전은 상위 저장소의 gitlink가 기준이다.
아래 목록은 구조 정리 시점의 코드 사용 경로이며 새 라이브러리 추천 목록이 아니다.

| 소스 | 제품에서의 사용 | 변경 시 확인할 곳 |
| --- | --- | --- |
| `vendor/ublock-origin` | 고정한 소스와 uAssets로 번들 확장을 생성 | `scripts/browser/build-ublock.mjs`, `setdown-build.json`, browser/ublock E2E |
| uAssets | recipe에 고정한 main/prod 커밋, `node_modules/.cache/setdown-browser`에 다운로드 | 두 asset pin과 recipe fingerprint, 필터링·재시작 검증 |
| `vendor/readability` | Readability.js와 LICENSE.md를 dist-electron으로 복사 | `scripts/build-browser.mjs`, browser/reader E2E |
| npm `fabric@7.4.0` (MIT) | `src/image-runtime/fabric-adapter.ts`에서만 사용. Svelte 편집 화면은 지연 로드, 전체 크기 내보내기는 별도 숨김 렌더러에서 실행 | 패키지 `LICENSE`, `image-export-runtime/`, `media/image-editor.spec.ts`. 원본 소스 패치 없음. canvas와 bitmap 해제는 어댑터·각 화면이 소유 |
| npm `@file-viewer/web`·`renderer-word`·`renderer-spreadsheet`·`renderer-presentation`·`renderer-hangul` `3.3.3` (Apache-2.0, flyfish-dev/file-viewer) | Word·Excel·PowerPoint·한글(HWP/HWPX) 읽기 전용 탭. `renderer/office/office-runtime.ts`에서만 import하고 형식군별로 지연 로드한다. 파싱 Worker(xlsx·pptx·ppt·hwp)는 자산으로 배포하고 URL을 명시해 넘긴다. xlsx·hwp는 Vite `?url`이고, pptx·ppt는 EMF 변환기를 고친 사본의 주소를 주는 `virtual:office-metafile-worker/*`(`vite.config.ts`의 `metafileOutlines`)이다. 뷰어 생성·해제는 `OfficeSurface.svelte`가 소유한다. 읽기 화면의 내려받기·인쇄·HTML 내보내기는 끈다. PDF 저장은 숨은 창에서 같은 모듈이 뷰어의 인쇄용 출력(`printRenderedHtml`)을 만들고, 시트는 `worker/sheetjs` 파서와 패키지 내부 차트 렌더러(`dist/spreadsheet/chartRenderer.js`, Vite 별칭 `@file-viewer-spreadsheet-chart`)를 쓴다. 내부 경로와 `office-paper.ts`가 기대는 클래스 이름은 버전을 올릴 때 다시 확인한다 | 패키지 `LICENSE`와 `dist-electron/OFFICE-VIEWER-NOTICES.txt`(`scripts/office-viewer-notices.mjs`가 실행 의존성 전체에서 생성), `media/office-reader.spec.ts`, `media/office-pdf-export.spec.ts`, `office-file.test.ts`. 빌드할 때 한 가지를 고친다: EMF 그림을 SVG로 바꾸는 변환기(`@file-viewer/pptx` Worker, `@file-viewer/ppt` Worker와 `dist/core/vector.js`, `@file-viewer/doc` `dist/msdoc/vector.js`)가 경로 안의 윤곽선을 GDI와 같게 만들도록 `scripts/office-metafile-patch.mjs`가 바로잡는다(`node_modules` 파일은 그대로 둔다). 고칠 곳이 정확히 한 번씩 나오지 않으면 빌드와 `metafile-outlines.test.ts`가 실패하므로, 버전을 올릴 때 upstream 변환기를 다시 읽고 패치를 맞추거나 지운다(`3.3.7`까지 upstream은 고치지 않았다). 서브모듈 `vendor/file-viewer`와 같은 릴리스로 고정한다. 주 스레드 DOMPurify는 워크스페이스 override(`3.4.15`)를 따르며 upstream 고정값은 `3.4.17`이다 |
| npm `@docx-editor.dev/core`·`fonts`·`fonts-cjk` `2.41.1` (Apache-2.0, 글꼴은 OFL-1.1·GUST·CC-BY-4.0; eigenpal/docx-editor) | Word(`.docx`) 읽기·편집 탭. main이 내용을 검사해 실제 Word 패키지로 판정한 파일(`officeEditor: 'word'`)만 대상이며, 이름만 `.docx`인 파일은 읽기 전용 Office 뷰어에 남는다. `renderer/docx/docx-runtime.ts`에서만 import하고 첫 Word 문서에서 지연 로드한다. 편집 세션은 `docx-sessions.ts`(작업공간 소유), 화면은 `DocxSurface.svelte`, 저장은 `main/documents/office-edit-ipc.ts`·`office-package.ts`가 소유한다(프레젠테이션 편집기와 공유). HarfBuzz WASM과 대체 글꼴·CJK 글꼴은 Vite가 자체 자산으로 배포하며 외부 요청이 없다. 엔진은 받은 글꼴 바이트로만 배치·그리기를 하므로, 이 PC에 설치된 글꼴은 main이 색인해(`main/documents/system-fonts.ts`, `core/fonts/font-file.ts`) `docx-edit:fonts`로 넘기고 `renderer/office-edit/font-supply.ts`가 엔진 글꼴 공급원으로 바꾼다. 설치되지 않은 한국어 글꼴군은 같은 계열의 설치 글꼴로 대신 그리되 줄 높이는 원래 글꼴군의 것을 유지한다(`core/fonts/korean-fonts.ts`). 문서의 글꼴 이름은 고쳐 쓰지 않는다. dev 서버에서는 세 패키지를 `optimizeDeps.exclude`로 사전 번들에서 뺀다(`new URL(..., import.meta.url)` 자산 경로 유지). **Pro 패키지(`pro`·`editor-api`·`docx-to-pdf`·`telemetry`)는 배포 금지 라이선스이므로 설치·번들하지 않는다** | 패키지 `LICENSE`·`licenses/`와 `dist-electron/OFFICE-VIEWER-NOTICES.txt`(Word 편집기 절), `scripts/office-viewer-notices.test.mjs`(버전 고정·Pro 미설치·라이선스 집합), `media/docx-editor.spec.ts`, `office-package.test.ts`, `docx-sessions.test.ts`, `font-file.test.ts`, `system-fonts.test.ts`, `office-edit/font-supply.test.ts`. 원본 패치 없음. 엔진은 모듈 수준 상태를 가지므로 `core`·`fonts`·`fonts-cjk`·`i18n`을 같은 릴리스로 정확히 고정한다. 참조용 checkout `vendor/docx-editor`와 같은 릴리스 |
| npm `@pptx-editor.dev/core` `0.8.0` (Apache-2.0; eigenpal/pptx-editor. 의존: `@docx-editor.dev/fonts`, `@pptx-editor.dev/i18n`, `bidi-js`, `emf-converter`, `fast-xml-parser`, `fflate`) | 프레젠테이션(`.pptx`) 읽기·편집 탭. main이 내용을 검사해 실제 프레젠테이션 패키지로 판정한 파일(`officeEditor: 'presentation'`)만 대상이며, 이름만 `.pptx`인 파일과 `pptm`·`potx`·`ppsx`·`ppt` 등은 읽기 전용 Office 뷰어에 남는다. `renderer/pptx/pptx-runtime.ts`에서만 import하고 첫 프레젠테이션에서 지연 로드한다. 편집 세션은 `pptx-sessions.ts`, 화면은 `PptxSurface.svelte`, 저장·글꼴 색인은 Word 편집기와 같은 main 모듈을 쓴다. 엔진은 단일 글꼴 파일만 받으므로 글꼴 모음(TTC)의 한 글꼴은 `core/fonts/font-collection.ts`가 단일 파일로 꺼내 넘긴다. dev 서버에서는 `optimizeDeps.exclude`로 사전 번들에서 뺀다 | 패키지 `LICENSE`와 `dist-electron/OFFICE-VIEWER-NOTICES.txt`(프레젠테이션 편집기 절), `scripts/office-viewer-notices.test.mjs`, `media/pptx-editor.spec.ts`, `pptx-sessions.test.ts`, `font-collection.test.ts`. 원본 패치 없음. 버전 정확 고정 |
| npm `katex` `0.16.47` (MIT; Crossnote가 쓰는 것과 같은 설치본) | 웹 리더의 수식. 페이지가 그린 수식을 TeX로 옮겨(`core/browser/reader-math.ts`) 리더 화면(`renderer/browser/reader-math.ts`, 수식이 있는 글에서만 지연 로드, WOFF2 글꼴만 배포)과 리더 PDF 내보내기(main, `dist-electron/reader-math.css`에 글꼴 내장)에서 다시 그린다. 신뢰할 수 없는 TeX이므로 `trust: false` | 패키지 `LICENSE` → `dist-electron/KATEX-LICENSE.txt`, `scripts/build-browser.mjs`, `scripts/browser/reader-math-css.test.mjs`, `reader-math.test.ts`, `browser/reader.spec.ts`. 원본 패치 없음 |
| npm `virtua@0.54.2` (MIT) | 폴더 탭의 목록·격자 가상화. `renderer/folder/FolderSurface.svelte`에서만 사용 | 패키지 `LICENSE`, `workspace/folder-tab.spec.ts`. 원본 패치 없음 |
| GNOME Files·VS Code에서 옮긴 선택 창 규칙 | `core/files/picker-rules.ts`(받아들임 규칙·이름 검증: Nautilus GPL-3.0-or-later, 확장자 보정: VS Code MIT), `core/files/folder-presentation.ts`의 이름 비교(VS Code MIT) | 파일 머리말의 출처, `picker-rules.test.ts`, `folder-presentation.test.ts` |
| 시스템 도구 `gio`, `lsblk`, `udisksctl`, `unzip`/`zip`/`tar`/`7z`, `/usr/bin/python3`+PyGObject | 폴더 탭의 연결 프로그램·휴지통 비우기·볼륨 마운트·압축, `org.freedesktop.FileManager1` 도우미(`main/files/file-manager-dbus.py`). 번들하지 않으며 없으면 해당 기능만 실패 | `main/files/desktop-integration.ts`, `file-manager-launch.ts`, `file-manager.test.ts` |
| npm `sharp@0.35.4` (Apache-2.0) | main에서 이미지 형식·애니메이션·픽셀 한도를 확인하고 방향을 보정한 작은 미리보기 생성 | 패키지 `LICENSE`, `main/documents/image-edit-ipc.ts`, EXIF·형식 E2E. 기존 전이 의존성을 명시적 의존성으로 선언 |
| Min에서 가져온 places 구현 | `src/browser-runtime/min-places.js`; Min 라이선스 복사, 로컬 fallback 포함 | `src/browser-runtime/MIN-LICENSE.txt`, places·history E2E |
| npm `electron-chrome-extensions` | main 확장 host와 가공한 preload | `scripts/browser/extension-preload.mjs`, 해당 Node 테스트, browser 확장 E2E |
| npm Crossnote·Monaco·PDF.js·xterm·web-git-graph 등 | `apps/desktop/package.json`에 선언한 실제 실행 의존성 | lockfile, 각 기능 어댑터, 관련 계약 및 패키징 |
| 생성된 언어 catalog/profile 자료 | `src/main/language/catalog/`, `scripts/language-profiles/` | 갱신 script, upstream 라이선스·NOTICE, profile 검사 |

`vendor/min`은 places 구현의 참조 원본이며 빌드에서 라이선스 후보로 사용한다.
나머지 직접 빌드 입력인 uBlock/Readability와 이를 구분한다. 다음 checkout은 현재
desktop 빌드 스크립트에서 소스 입력으로 직접 사용하지 않는 참조 저장소다.

```text
aura-browser, brave-core, bypass-paywalls-chrome-clean,
commit-graph, commonmark-spec, cosmic-files, crossnote, docx-editor, dolphin, fabric.js,
file-viewer, filerobot-image-editor, gitgraph.js,
jupyterlab, jupyterlab-desktop, kimi-code, linear-algebra, monaco-editor,
monaco-languageclient, nautilus, nbformat, ptyxis, pulsar, react-git-log,
sigma-file-manager, sublime-lsp, svelte-chop-chop, theia, vscode, vscode-jupyter,
vscode-languageserver-node, vscode-markdown-preview-enhanced, web-git-graph,
xdg-desktop-portal, xdg-desktop-portal-termfilechooser, yazi
```

파일 관리자 참고 저장소(nautilus, dolphin, cosmic-files, sigma-file-manager,
xdg-desktop-portal, xdg-desktop-portal-termfilechooser, yazi)는 얕은 서브모듈
(`shallow = true`)이다. 무엇을 보는지는
[파일 관리자 탭 보고서](../../reports/2026_11_11_22_09_file_manager_tab_strategy.md) 8절에 있다.

이들 이름과 npm 패키지 이름이 같아도 checkout을 통째로 제품에 포함한다는 뜻은
아니다. `.gitmodules`와 실제 import/build 경로를 함께 확인한다.

## 새 외부 구현을 넣을 때

실제 소비 기능, npm/git/복사본 중 설치 방식, 고정 버전 또는 커밋, upstream 라이선스
위치, 로컬 패치, 생성 산출물, 대응 테스트를 함께 기록한다. 기능의 내부 타입이
워크스페이스 공통 모델로 번지지 않게 연결부에 둔다. 편집·재생 엔진은 실행 환경과
생성·해제 주체도 명시한다.

확장 preload 패치는 예상 원본 문자열이 정확히 한 번 나타나는지 검사한다. 버전이
바뀌어 이 검사가 실패하면 패치를 검토한다. 검사를 제거하거나 자동으로 원본을
통과시키지 않는다. 빌드 entry는 recipe를 조립하고, 패치 동작은 작은 Node 테스트와
실제 확장 E2E로 검증한다.

참조 저장소 전체를 재귀 초기화할 필요는 없다. 현재 빌드는 필요한 uBlock과
Readability가 없을 때 해당 서브모듈을 초기화한다. IDE 검색·watcher에서는 외부
checkout과 산출물을 제외하되 파일 탐색기에서 숨기거나 Git 이력을 삭제하지 않는다.
