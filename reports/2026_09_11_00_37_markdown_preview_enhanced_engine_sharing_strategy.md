# 껍데기는 새로, 엔진은 그대로

## Markdown Preview Enhanced와 렌더링 결과를 공유하는 뷰어 설계 보고서

2026년 9월 11일 00:37 KST | 조사 기준일: 2026년 9월 11일

마크다운 뷰어를 새로 만드는 일은 보기보다 단순해 보인다. `markdown-it`에 Mermaid와 KaTeX를 붙이면 며칠 안에 그럴듯한 화면이 나온다. 문제는 그다음이다. 표의 병합 규칙, 수식 구분자, 문서 포함, 위키 링크, 코드 청크, 다이어그램, 프런트매터와 내보내기가 조금씩 어긋난다. 두 제품은 같은 마크다운을 읽지만 같은 문서를 보여주지 않게 된다.

이 프로젝트가 피해야 할 함정도 그것이다. **Markdown Preview Enhanced(MPE)와 같은 결과가 목표라면 기능을 재현할 것이 아니라, MPE가 실제로 쓰는 `crossnote` 패키지를 직접 의존해야 한다.** 데스크톱 셸은 Electron으로 만들고, Crossnote는 메인 프로세스의 렌더링 서비스로 격리하며, 화면은 제한된 IPC만 통하는 렌더러로 두는 것이 가장 짧고 오래가는 길이다.

이 결론에는 단서가 하나 있다. “같은 엔진”은 같은 패키지 이름만 뜻하지 않는다. **같은 Crossnote 버전, 같은 설정, 같은 테마 자산, 같은 외부 도구**까지 맞아야 비로소 같은 결과가 된다.

## MPE의 심장은 이미 분리돼 있다

MPE의 저장소와 렌더러 저장소는 역할이 깔끔하게 갈린다. VS Code 확장은 명령, 에디터 상태, 웹뷰와 메시지 연결을 맡는다. 변환과 렌더링은 Crossnote가 맡는다. Crossnote 스스로도 자신을 “MPE for VS Code를 구동하는 라이브러리”라고 소개하며 `Notebook.init()`과 `getNoteMarkdownEngine()`을 공식 사용법으로 제시한다. 과거 자료의 `@shd101wyy/mume`는 현행 이름이 아니다. Crossnote README는 이 프로젝트가 예전에 mume로 불렸다고 명시한다. [Crossnote 공식 README](https://github.com/shd101wyy/crossnote/blob/develop/README.md)

현재 개발 브랜치에서 이 관계는 추측이 아니라 의존성으로 확인된다. MPE `package.json`은 `crossnote: 0.9.35`를 직접 선언하고, 확장 코드도 `crossnote`에서 유틸리티를 import한다. 다만 조사 시점 npm의 최신 공개판은 `0.9.31`이다. 즉 개발 브랜치의 번호를 무작정 설치 명령에 옮기면 안 된다. 첫 릴리스는 npm 공개판 `0.9.31`에 고정하고, 목표 MPE 릴리스가 쓰는 Crossnote 버전을 호환성 기준표에 기록하는 편이 안전하다. 개발판과의 완전 일치가 꼭 필요하다면 `0.9.35`가 npm에 발행된 뒤 올리거나, 검증된 커밋을 자체 빌드해야 한다. [MPE 개발 브랜치 package.json](https://github.com/shd101wyy/vscode-markdown-preview-enhanced/blob/develop/package.json) · [npm의 Crossnote](https://www.npmjs.com/package/crossnote)

Crossnote 안에서도 “파서 하나”가 전부가 아니다. 처리 흐름은 대략 다음과 같다.

```text
Markdown
  → 문서 포함·프런트매터·소스 라인 변환
  → markdown-it / Pandoc / markdown_yo 중 선택
  → Cheerio 후처리
  → 수식·다이어그램·코드 청크 보강
  → HTML 정화
  → 테마·프리뷰 스크립트가 든 HTML 셸
```

소스 구조도 이를 뒷받침한다. `src/markdown-engine`은 핵심 파이프라인, `src/custom-markdown-it-features`는 문법 확장, `src/render-enhancers`는 렌더 후 변환, `src/renderers`는 다이어그램, `src/webview`는 React 프리뷰 UI, `src/converters`는 PDF·ebook 등의 내보내기를 담당한다. 따라서 `markdown-it`만 직접 가져오는 방식은 MPE와 **같은 하위 파서**를 쓸 수는 있어도 **같은 엔진**을 쓰는 방식은 아니다. [Crossnote 아키텍처 설명](https://github.com/shd101wyy/crossnote/blob/develop/AGENTS.md)

## 선택지는 셋, 승자는 하나다

| 방식 | 초기 속도 | MPE 일치도 | 유지비 | 판정 |
|---|---:|---:|---:|---|
| `markdown-it`과 플러그인을 직접 조립 | 빠름 | 낮음 | 매우 높음 | 기각 |
| MPE VS Code 확장을 포크 | 보통 | 매우 높음 | 높음 | VS Code 전용 제품일 때만 |
| `crossnote`를 라이브러리로 사용 | 빠름 | 높음 | 낮음 | **권고** |

확장 포크는 처음에는 완벽해 보인다. 그러나 새 뷰어가 VS Code 밖에서 돌아가야 한다면 명령 등록, `WebviewPanel`, URI 변환과 설정 동기화 같은 호스트 코드를 계속 걷어내야 한다. 반대로 Crossnote의 공개 API는 이미 Notebook과 MarkdownEngine이라는 경계를 제공하고 HTML·PDF·Pandoc·ebook 내보내기까지 품고 있다. [Crossnote API: Notebook](https://shd101wyy.github.io/crossnote/classes/Notebook.html) · [Crossnote API: MarkdownEngine](https://shd101wyy.github.io/crossnote/classes/MarkdownEngine.html)

웹 앱만으로 시작하는 선택도 매력적이지만 목표 기능과 맞지 않는다. 브라우저에서는 로컬 파일, Pandoc, Chrome/Puppeteer, Java 기반 PlantUML과 코드 청크 실행이 제한된다. MPE도 VS Code Web에서는 내보내기와 코드 청크 같은 일부 기능을 제한한다고 밝힌 바 있다. 반면 Electron은 Crossnote의 Node API와 로컬 도구를 자연스럽게 수용한다. 설치 파일이 커지는 비용은 있지만, 엔진 호환성을 사는 비용으로는 싸다. [MPE 변경 이력](https://github.com/shd101wyy/vscode-markdown-preview-enhanced/blob/develop/CHANGELOG.md)

## 권고 구조: Crossnote를 UI 뒤에 숨겨라

앱은 세 층이면 충분하다.

```text
┌──────────────── Renderer ────────────────┐
│ 파일 목록 · 검색 · 탭 · 프리뷰 컨테이너 │
│ Node 접근 없음, 제한된 preload API만 사용│
└──────────────────┬───────────────────────┘
                   │ typed IPC
┌──────────────────▼───────────────────────┐
│ Main: PreviewService                    │
│ Notebook 1개/워크스페이스, Engine 1개/문서│
│ 파일 감시 · 렌더 · 캐시 · 내보내기       │
└──────────────────┬───────────────────────┘
                   │ direct library call
┌──────────────────▼───────────────────────┐
│ crossnote (버전 고정)                    │
│ parse → enhance → sanitize → template    │
└──────────────────────────────────────────┘
```

핵심 객체의 수명은 UI 컴포넌트보다 길어야 한다. 폴더를 열 때 `Notebook`을 한 번 만들고, 탭을 열 때 문서별 `MarkdownEngine`을 얻는다. 키 입력마다 객체를 다시 만들면 인덱스와 다이어그램 캐시를 버리게 된다. 파일 변경은 200~300ms 디바운스하고 각 요청에 증가하는 revision을 붙여, 늦게 끝난 이전 렌더가 최신 화면을 덮지 못하게 한다. Crossnote에는 캐시 비우기와 증분 노트 새로고침 API도 있으므로 파일 감시기와 연결할 수 있다.

최소 코어는 아래처럼 작다. 이 코드는 UI 예제가 아니라, 제품 전체가 의존해야 할 경계를 보여준다.

```ts
// main/preview-service.ts
import { Notebook } from 'crossnote';

export class PreviewService {
  private notebook?: Notebook;

  async openWorkspace(root: string, trusted: boolean) {
    this.notebook = await Notebook.init({
      notebookPath: root,
      // 신뢰 전에는 .crossnote와 루트 밖 경로를 숨기는 FileSystemApi
      fs: createPolicyFs(root, trusted),
      config: {
        markdownParser: 'markdown-it',
        previewTheme: 'github-light.css',
        codeBlockTheme: 'auto.css',
        mathRenderingOption: 'KaTeX',
        enableScriptExecution: false,
        parserConfig: {},
        includeInHeader: '',
        globalCss: '',
        plantumlServer: '',
        krokiServer: '',
        webSequenceDiagramsServer: '',
      },
    });
  }

  async render(relativePath: string, source: string) {
    if (!this.notebook) throw new Error('workspace is not open');

    const engine = this.notebook.getNoteMarkdownEngine(relativePath);
    return engine.generateHTMLTemplateForPreview({
      inputString: source,
      config: { isVSCode: false, scrollSync: true },
      vscodePreviewPanel: null,
      contentSecurityPolicy: buildPreviewCsp(),
    });
  }
}
```

여기서 중요한 것은 `parseMD()`의 결과 HTML만 빼내 직접 조립하지 않았다는 점이다. 그것은 가벼운 읽기 전용 MVP에는 쓸 수 있지만 Mermaid, WaveDrom, 프리젠테이션, 테마와 프리뷰 상호작용에 필요한 자산을 다시 연결하게 만든다. 완성품은 Crossnote의 `generateHTMLTemplateForPreview()`를 먼저 쓰고, 제품 UI는 그 바깥을 감싸는 편이 호환성이 높다. MPE 역시 프리뷰를 만들 때 이 메서드에 원문, 스크롤 동기화 설정과 CSP를 넘긴다. [MPE의 실제 프리뷰 호출부](https://github.com/shd101wyy/vscode-markdown-preview-enhanced/blob/develop/src/preview-provider.ts)

다만 위 코드는 착수용 골격이다. `createPolicyFs()`는 신뢰 전에는 `.crossnote`를 존재하지 않는 것처럼 보이게 하고 심볼릭 링크까지 정규화해 루트 밖 읽기를 거절하는 어댑터로 구현해야 한다. `buildPreviewCsp()`와 로컬 자산 URL 정책도 앱 프로토콜(`app://`)에 맞춰 구현해야 한다. 빈 서버 URL의 동작은 고정한 Crossnote 버전에서 회귀 테스트하고, 네트워크 차단은 설정값뿐 아니라 Electron의 요청 필터에서도 집행해야 한다.

<details>
<summary>권장 디렉터리 트리와 덜 중요한 연결 코드</summary>

```text
better-markdown-viewer/
├── src/
│   ├── main/
│   │   ├── preview-service.ts   # Crossnote를 아는 유일한 계층
│   │   ├── workspace-store.ts   # Notebook 수명과 파일 감시
│   │   ├── export-service.ts    # HTML/PDF/Pandoc 기능 게이트
│   │   └── ipc.ts               # 입력 검증과 request/revision 관리
│   ├── preload/
│   │   └── index.ts             # render/open/export만 노출
│   ├── renderer/
│   │   ├── app.tsx
│   │   ├── preview-frame.tsx
│   │   └── navigation.ts
│   └── shared/
│       ├── contracts.ts
│       └── settings.ts
├── fixtures/
│   └── mpe-parity.md
├── test/
│   ├── parity.test.ts
│   └── security.test.ts
├── THIRD_PARTY_NOTICES.md
└── package.json
```

```ts
// preload/index.ts — 임의 파일 시스템 API를 내보내지 않는다.
contextBridge.exposeInMainWorld('previewApi', {
  render: (request: RenderRequest) => ipcRenderer.invoke('preview:render', request),
  openLink: (url: string) => ipcRenderer.invoke('preview:open-link', url),
  export: (request: ExportRequest) => ipcRenderer.invoke('preview:export', request),
});
```

</details>

## 호환성은 테스트로 정의해야 한다

“MPE와 같다”는 문장은 릴리스 기준이 되지 못한다. 같은 fixture를 두 엔진에서 렌더해 비교하는 계약이 필요하다. 첫 fixture에는 평범한 문법보다 차이가 나기 쉬운 것을 넣어야 한다. `$…$`와 `$$…$$`, Mermaid와 PlantUML, 각주, admonition/callout, 확장 표, 위키 링크와 문서 포함, 프런트매터, 로컬 이미지, 코드 청크, 슬라이드, 원시 HTML이 그 목록이다.

테스트는 세 단계로 나눈다.

1. **구조 비교**: 시간값과 임의 ID를 정규화한 뒤 HTML DOM을 비교한다.
2. **시각 비교**: Playwright로 동일한 Chromium·폰트·뷰포트에서 스크린샷을 찍고 허용 오차를 둔다.
3. **행동 비교**: 소스→프리뷰와 프리뷰→소스 이동, 내부 링크, 확대, TOC, 내보내기를 검사한다.

Crossnote 버전 갱신은 자동 병합하지 않는다. 별도 PR에서 이 계약 테스트를 모두 통과시킨 뒤 올린다. 패키지 버전은 `^0.9.31`이 아니라 정확한 `0.9.31`로 고정하고 lockfile을 커밋한다. 0.x 버전에서는 작은 번호 변화에도 공개 API와 출력이 달라질 수 있기 때문이다. 더구나 Crossnote는 현재 README에서 스스로 WIP라고 표시한다.

성능 목표도 렌더러 벤치마크 숫자 하나로 정하면 안 된다. Crossnote는 `markdown-it`, 시스템 Pandoc, 실험적 `markdown_yo`를 선택할 수 있다. 공식 문서의 자체 측정에서는 입력 크기에 따라 우위가 바뀐다. 첫 버전은 MPE의 기본값인 `markdown-it`으로 결과 일치를 우선하고, `markdown_yo`는 별도 “빠른 실험 모드”로만 다루는 편이 맞다. [Crossnote 파서 설정](https://shd101wyy.github.io/crossnote/interfaces/NotebookConfig.html)

## 가장 위험한 기능은 가장 화려한 기능이다

마크다운은 텍스트지만 MPE급 마크다운은 작은 프로그램에 가깝다. 원시 HTML을 품고, 다른 파일을 포함하며, 외부 렌더러를 부르고, 원하면 코드도 실행한다. 그러므로 보안은 정화 함수 하나가 아니라 권한 설계여야 한다.

기본 정책은 다음과 같아야 한다.

- `enableScriptExecution`, 프리뷰 스크립트와 코드 청크는 기본적으로 끈다. 신뢰한 폴더에서 사용자가 매번 명시적으로 켜게 한다.
- Electron은 `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`로 두고 렌더러에 경로나 셸 명령을 직접 넘기지 않는다.
- 생성 HTML은 별도 sandbox 프레임 또는 격리된 view에 넣고, CSP로 `script-src`, `connect-src`, `img-src`를 좁힌다.
- 외부 링크는 `http:`와 `https:`만 검증해 시스템 브라우저로 열며 `file:`, `javascript:`, 사용자 정의 프로토콜은 거부한다.
- Pandoc, D2, PlantUML과 코드 청크 실행은 별도 기능 권한으로 분리하고 인수 배열을 사용한다. 문자열 셸 실행은 피한다.
- `.crossnote/config.js`, `parser.js`, `head.html`은 신뢰 전에는 읽지 않는다. 공식 문서상 `Notebook.init()`이 이 로컬 설정을 자동 생성·로드하므로, 제품은 “폴더 신뢰” 흐름 또는 앱이 관리하는 격리 설정 디렉터리를 마련해야 한다. [Crossnote 로컬 설정 설명](https://www.npmjs.com/package/crossnote)
- 네트워크는 기본 차단한다. Kroki, WebSequenceDiagrams, 원격 PlantUML과 CDN은 사용자가 공급자를 선택할 때만 해당 호스트를 허용하고, 문서 내용이 전송될 수 있음을 표시한다.

Crossnote 최신 계열은 서버 측 Cheerio 정화와 클라이언트 측 DOMPurify 방어를 추가했다. 이는 큰 장점이지만 앱 자체의 격리를 대신하지는 않는다. 최근 변경 이력에는 악성 `.crossnote/head.html`의 스크립트 주입을 막은 보안 수정도 있다. 이 이력은 “최신 보안 패치를 따라가되, 버전 갱신은 호환성 테스트로 통제하라”는 두 요구가 동시에 옳음을 보여준다. [Crossnote 보안 변경 이력](https://github.com/shd101wyy/crossnote/releases)

## 라이선스 비용은 작지만 0은 아니다

MPE와 Crossnote는 NCSA 라이선스다. 사용·수정·배포·재라이선스·판매가 허용되는 permissive 라이선스라 상용 뷰어에도 적합하다. 다만 소스 배포에는 저작권 고지와 조건·면책을 남겨야 하고, 바이너리 배포에는 이를 문서나 동봉 자료로 재현해야 한다. 원 저작자나 기여자의 이름을 제품 보증에 쓸 수도 없다. 따라서 저장소에는 Crossnote의 원문 라이선스를 보존하고, 설치물에는 `THIRD_PARTY_NOTICES.md`를 포함해야 한다. Crossnote의 많은 전이 의존성도 출시 전에 SBOM과 라이선스 스캔으로 별도 확인한다. [OSI의 NCSA 라이선스 원문](https://opensource.org/license/ncsa)

UI와 브랜드를 그대로 베끼는 일은 별개의 문제다. 엔진을 의존하는 데 필요한 것은 라이선스 준수이지 “Markdown Preview Enhanced”라는 이름과 아이콘을 제품 정체성으로 쓰는 권한은 아니다. 제품명, 아이콘과 화면 구조는 독자적으로 설계하고 “Crossnote 기반”이라는 사실만 정확히 고지하는 편이 좋다.

## 4주짜리 현실적 순서

첫 주에는 화려한 편집기를 만들지 않는다. Electron 셸, 폴더 열기, Crossnote `0.9.31` 고정, 단일 문서 프리뷰와 로컬 이미지까지 연결한다. 동시에 MPE에서 동일 fixture를 HTML로 내보내 기준 산출물을 만든다.

둘째 주에는 소스 라인 기반 스크롤 동기화, 파일 감시, revision 취소, 테마 전환과 탭 수명을 완성한다. Crossnote가 출력하는 `data-source-line`을 사용하면 별도의 마크다운 AST를 만들 필요가 없다.

셋째 주에는 Mermaid·수식·PlantUML의 로컬 경로와 HTML/PDF 내보내기를 붙인다. 외부 서비스는 아직 켜지 않는다. OS별 폰트와 실행 파일 부재를 오류 상태로 다룬다.

넷째 주에는 보안 fixture, 시각 회귀, 패키징과 라이선스 고지를 끝낸다. 코드 청크와 임의 parser hook은 첫 릴리스 범위에서 빼는 것이 좋다. 이 둘은 기능 하나를 더하는 것이 아니라 신뢰 모델 전체를 바꾸기 때문이다.

출시 판단 기준은 간단하다. 기준 문서에서 MPE와 구조·화면이 같고, 네트워크를 끊어도 핵심 프리뷰가 동작하며, 악성 HTML과 경로 이탈 fixture가 격리되고, Crossnote 버전이 lockfile에 고정되어 있으면 된다.

## 결론

이 뷰어의 경쟁력은 새 파서를 만드는 데서 나오지 않는다. 이미 성숙한 파서를 얼마나 얇고 안전하게 제품 안에 넣느냐에서 나온다. Crossnote는 우연히 MPE와 비슷한 라이브러리가 아니라 MPE의 공용 렌더링 코어다. 그러므로 가장 좋은 설계는 Electron 위에 독자적인 탐색·읽기 경험을 만들되, 문서의 의미를 결정하는 일은 Crossnote 한 곳에 맡기는 것이다.

첫 번째 구현 결정은 세 줄로 요약된다.

1. `crossnote@0.9.31`을 정확히 고정한다.
2. 메인 프로세스의 `PreviewService`만 Crossnote를 호출한다.
3. MPE와 공유하는 parity fixture가 통과할 때만 엔진 버전을 올린다.

그렇게 하면 새 뷰어는 MPE를 흉내 내지 않는다. 같은 심장을 쓰면서, 더 나은 몸을 갖게 된다. ■

## 참고 자료

- [Markdown Preview Enhanced 공식 저장소](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
- [Crossnote 공식 저장소와 사용 예제](https://github.com/shd101wyy/crossnote)
- [Crossnote API 문서](https://shd101wyy.github.io/crossnote/)
- [Crossnote npm 패키지](https://www.npmjs.com/package/crossnote)
- [University of Illinois/NCSA Open Source License](https://opensource.org/license/ncsa)
