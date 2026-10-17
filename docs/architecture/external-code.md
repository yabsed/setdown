# 외부 코드와 빌드 입력

`vendor/`의 존재와 실행 의존성은 구분한다. npm으로 실행하는 라이브러리의 버전은
`package-lock.json`, git 소스의 버전은 상위 저장소의 gitlink가 기준이다.
아래 목록은 구조 정리 시점의 코드 사용 경로이며 새 라이브러리 추천 목록이 아니다.

| 소스 | 제품에서의 사용 | 변경 시 확인할 곳 |
| --- | --- | --- |
| `vendor/ublock-origin` | 고정한 소스와 uAssets로 번들 확장을 생성 | `scripts/browser/build-ublock.mjs`, `setdown-build.json`, browser/ublock E2E |
| uAssets | recipe에 고정한 main/prod 커밋, `node_modules/.cache/setdown-browser`에 다운로드 | 두 asset pin과 recipe fingerprint, 필터링·재시작 검증 |
| `vendor/readability` | Readability.js와 LICENSE.md를 dist-electron으로 복사 | `scripts/build-browser.mjs`, browser/reader E2E |
| Min에서 가져온 places 구현 | `src/browser-runtime/min-places.js`; Min 라이선스 복사, 로컬 fallback 포함 | `src/browser-runtime/MIN-LICENSE.txt`, places·history E2E |
| npm `electron-chrome-extensions` | main 확장 host와 가공한 preload | `scripts/browser/extension-preload.mjs`, 해당 Node 테스트, browser 확장 E2E |
| npm Crossnote·Monaco·PDF.js·xterm·web-git-graph 등 | `apps/desktop/package.json`에 선언한 실제 실행 의존성 | lockfile, 각 기능 어댑터, 관련 계약 및 패키징 |
| 생성된 언어 catalog/profile 자료 | `src/main/language/catalog/`, `scripts/language-profiles/` | 갱신 script, upstream 라이선스·NOTICE, profile 검사 |

`vendor/min`은 places 구현의 참조 원본이며 빌드에서 라이선스 후보로 사용한다.
나머지 직접 빌드 입력인 uBlock/Readability와 이를 구분한다. 다음 checkout은 현재
desktop 빌드 스크립트에서 소스 입력으로 직접 사용하지 않는 참조 저장소다.

```text
aura-browser, brave-core, bypass-paywalls-chrome-clean,
commit-graph, commonmark-spec, crossnote, dolphin, fabric.js,
filerobot-image-editor, gitgraph.js,
jupyterlab, jupyterlab-desktop, linear-algebra, monaco-editor,
monaco-languageclient, nbformat, ptyxis, pulsar, react-git-log,
sublime-lsp, svelte-chop-chop, vscode, vscode-jupyter, vscode-languageserver-node,
vscode-markdown-preview-enhanced, web-git-graph
```

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
