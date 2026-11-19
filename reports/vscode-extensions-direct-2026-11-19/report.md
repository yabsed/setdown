# VS Code 확장을 그대로 돌릴 수 없는가

작성일: 2026-11-19 · 조사 보고서 · Setdown `d75384a` · VS Code 소스 `vendor/vscode` 1.142.0 · 새로 추가한 확장 저장소 13개(부록 A) · Open VSX 조회 2026-11-19

**소스를 읽고 쓴 보고서다. 확장을 실제로 실행해 보지는 않았다.** 실행 실험은 준비했으나 돌리지 못했다(7절). "확인"은 해당 커밋의 소스에서 본 것이고, "추정"은 따로 표시한다. 언어별 근거는 [languages/](languages/)의 일곱 파일에 줄 번호와 함께 있다. 이 본문은 그 파일들을 묶어 질문에 답한다.

질문은 이것이다. "VS Code 확장을 그대로 적용하면 되지 않는가. 전문가들이 만든 로직이니 완벽할 텐데."

## 결론

**돌릴 수는 있다. 그러나 "확장만" 가져올 수는 없고, 가져온다고 해서 지금 아픈 곳이 대부분 낫는 것도 아니다.**

1. **확장은 VS Code에 대고 쓴 프로그램이다.** 확장이 부르는 통로는 87종, 메서드로 약 520개다(2절). 확장을 돌리려면 그 반대편, 곧 VS Code의 문서·설정·창·명령 서비스를 함께 들여야 한다. 10월 24일 보고서가 이미 같은 결론을 냈다. 확장 호스트만 떼어 오면 "작은 워크벤치 재구현"이 된다([이전 보고서 5.1절](../vscode-replacement-2026-10-24/report.md)).
2. **전문가가 만든 로직의 대부분은 확장 안에 없다.** 언어 서버와 따로 떨어진 부품에 있고, Setdown은 그 서버를 이미 돌린다. 조사한 확장 17개의 클라이언트 코드 약 22만 줄 가운데, 분석이 사람의 프로젝트에서 맞게 되느냐를 가르는 부분은 언어마다 수십에서 수백 줄의 규칙이다(3절). 나머지는 화면, 디버거, 테스트, 터미널이다.
3. **가장 좋은 둘은 쓸 수 없다.** Pylance와 Microsoft C/C++ 확장은 라이선스가 Microsoft 제품 밖의 사용을 막는다. 나머지 확장은 Open VSX에서 구할 수 있지만 몇 개는 조건이 붙는다(4절).
4. **돌리면 나빠지는 곳도 있다.** Microsoft 컨테이너 확장의 Compose 서버는 Setdown이 고른 서버보다 Setdown 자체 측정에서 덜 답했다. Microsoft Python 확장은 Setdown의 기본 도구인 Pyright를 아예 띄우지 않는다.

권고는 세 가지다(6절).

- **지금 구조에 확장 호스트를 끼워 넣지 않는다.** 언어 분석만 놓고 보면 얻는 것이 비용에 못 미친다.
- **확장을 실행 대상이 아니라 명세로 쓴다.** 언어별로 확인한 "빠진 것" 목록(5절)을 옮긴다. 대부분은 이미 손에 있는 부품을 잇는 일이다. 서브모듈로 고정해 두었으므로, 확장이 규칙을 바꾸면 차이를 볼 수 있다.
- **"VS Code를 대체한다"가 목표라면 그것은 언어 지원이 아니라 기반의 문제다.** 디버거, 테스트, 노트북, 원격, 남이 만든 확장까지 원한다면 답은 10월 보고서 그대로 Code - OSS 기반이다. 그 결정은 아직 내려지지 않았고, 이 보고서로 대신할 수 없다.

## 1. 질문을 나누기: "로직"은 세 곳에 있다

확장 하나가 하는 일은 세 층이다.

| 층 | 무엇인가 | 가져오는 방법 |
| --- | --- | --- |
| 언어 서버와 독립 부품 | 분석 자체. Pyright, gopls, clangd, jdt.ls, tsserver, 스키마 서비스, Python 환경 탐색기 PET | LSP나 명령줄로 그냥 쓴다. Setdown이 이미 하는 일이다 |
| 클라이언트의 규칙 | 어떤 도구를, 어떤 런타임과 환경으로, 어떤 옵션을 넣어 띄우는가. 표준 밖 요청 몇 개 | 화면과 무관하다. 읽고 옮길 수 있다 |
| 클라이언트의 화면 | 상태 표시줄, 선택 창, 설정 화면, 디버거, 테스트 탐색기, 터미널 | VS Code 워크벤치가 있어야 뜻이 있다 |

"확장을 그대로 돌린다"는 것은 셋째 층까지 통째로 받겠다는 뜻이다. 그런데 사용자가 겪은 문제(Java 25 프로젝트의 거짓 오류, Kotlin의 JDK 17 문제)는 둘째 층에 있다. 둘째 층만 필요하다면 셋째 층의 비용을 낼 이유가 없다. 이 보고서의 판단은 이 구분에 서 있다.

같은 로직을 서버로 포장해 내놓은 선례도 있다. VS Code의 TypeScript 확장은 LSP를 쓰지 않아 다른 편집기가 못 쓴다. 그래서 `typescript-language-server`는 "그 확장의 코드 위에 얇은 LSP 층을 얹는다"고 스스로 설명하고(`node_modules/typescript-language-server/README.md:37`), Zed 기본값인 `vtsls`도 같은 확장을 감싼 서버다(`apps/desktop/src/main/language/catalog/mason.json:10238`). 전문가의 로직을 얻는 길이 확장 실행 하나만은 아니다.

## 2. 확장을 돌리는 데 드는 것

### 2.1 받아 줘야 하는 면적

`vendor/vscode` 1.142.0에서 센 값이다.

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 확장 → 화면 쪽 통로(`MainThread…Shape`) | 87종, 메서드 약 520개 | [extHost.protocol.ts](../../vendor/vscode/src/vs/workbench/api/common/extHost.protocol.ts) (4,231줄) |
| 화면 → 확장 쪽 통로(`ExtHost…Shape`) | 82종 | 같은 파일 |
| 공개 API 선언 | 21,241줄 | [vscode.d.ts](../../vendor/vscode/src/vscode-dts/vscode.d.ts) |
| 제안 API 선언 파일 | 180개 | `vendor/vscode/src/vscode-dts/vscode.proposed.*.d.ts` |

언어 확장도 이 면적을 넓게 쓴다. `vscode-languageclient`는 언어 기능을 `vscode.languages.register…Provider`로 붙이므로, 확장을 돌리면 Setdown의 자체 LSP 세션은 쓰이지 않고 VS Code의 문서 모델이 문서의 주인이 된다. 언어별 사용량은 각 파일의 2절에 있다. 예를 들어 Java 확장은 `window` 159회, `commands` 141회, `workspace` 116회이고 66개 파일 중 51개가 `vscode`를 가져온다([languages/kotlin-java.md](languages/kotlin-java.md)). Go 확장은 `window` 279회, 그중 147회가 알림 호출이다([languages/rust-go.md](languages/rust-go.md)).

### 2.2 확장마다 요구하는 것

같은 규칙(테스트 폴더 제외, `.ts`·`.tsx`)으로 센 값이다. 각 언어 파일은 저마다의 기준으로 다시 세어 조금 다르다.

| 언어 | 확장 | 버전 | 요구 VS Code | 클라이언트 줄 수 | 명령 | 설정 | 제안 API |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Python | `vscode-python` | 2026.13.0 | ^1.95.0 | 59,405 | 23 | 41 | 9 |
| Python 환경 | `vscode-python-environments` | 1.45.0 | ^1.110.0-20260204 | 50,437 | 35 | 12 | 3 |
| Python(Pyright) | `pyright/packages/vscode-pyright` | 1.1.414 | ^1.101.0 | 510 | 7 | 19 | 0 |
| TS/JS | `vscode/extensions/typescript-language-features` | 내장 | 내장 전용 | 18,712 | 15 | 226 | 5 |
| Svelte | `svelte-language-tools/packages/svelte-vscode` | 0.5.0 | ^1.82.0 | 3,543 | 16 | 55 | 0 |
| JSON | `vscode/extensions/json-language-features` | 내장 | 내장 전용 | 2,087 | 2 | 9 | 1 |
| CSS | `vscode/extensions/css-language-features` | 내장 | 내장 전용 | 777 | 0 | 98 | 0 |
| HTML | `vscode/extensions/html-language-features` | 내장 | 내장 전용 | 946 | 0 | 24 | 1 |
| YAML | `vscode-yaml` | 2.1.0 | ^1.91.0 | 1,843 | 0 | 30 | 0 |
| C/C++ | `vscode-clangd` | 0.6.0 | ^1.91.0 | 1,832 | 17 | 17 | 0 |
| C/C++ | `vscode-cpptools` | 1.35.6 | ^1.82.0 | 33,150 | 46 | 167 | 2 |
| Rust | `rust-analyzer/editors/code` | 0.5.0-dev | ^1.144.0 | 7,246 | 47 | 219 | 0 |
| Go | `vscode-go/extension` | 0.60.0-dev | ^1.125.0 | 22,524 | 67 | 67 | 0 |
| PHP | `vscode-intelephense` | 1.18.5 | ^1.91.0 | 576 | 3 | 75 | 0 |
| Kotlin | `kotlin-lsp` | 0.0.86 배포 | ^1.105.1 | 8,897 | 7 | 33 | 0 |
| Java | `vscode-java` | 1.59.0 | ^1.77.0 | 11,554 | 31 | 136 | 0 |
| Docker | `docker-vscode-extension` | 0.18.0 | ^1.92.0 | 1,422 | 2 | 10 | 0 |

이 표에서 읽을 것은 세 가지다.

- **버전을 계속 따라가야 한다.** rust-analyzer의 확장은 VS Code 1.144 이상을 요구한다. 우리가 가진 VS Code 소스가 1.142이고, Theia가 지원한다고 적은 API는 1.139다(`vendor/theia/dev-packages/application-package/src/api.ts:21`, 2026-10-23 체크아웃). 호스트가 한 달만 늦어도 최신 확장을 못 올린다.
- **제안 API는 내장 확장이 아니면 막힌다.** VS Code는 `product.json`의 허용 목록, 개발 모드, 실행 인자 중 하나가 없으면 선언을 지워 버린다(`vendor/vscode/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:104-114`). Microsoft Python 확장 둘과 C/C++ 확장이 여기에 걸린다. 자기 제품의 허용 목록에 넣을 수는 있다.
- **내장 확장 넷은 따로 배포되지 않는다.** TS/JS, JSON, CSS, HTML은 VS Code 빌드의 일부로만 컴파일된다. 쓰려면 VS Code 트리의 특정 커밋에서 직접 빌드해야 한다.

### 2.3 화면 말고도 따라오는 것

확장을 돌리면 그 확장이 켜질 때 하는 일도 함께 돈다. 각 언어 파일에서 확인한 것들이다.

- **원격 측정.** Java와 YAML 확장은 켜질 때 Red Hat 원격 측정 서비스를 시작하고, YAML은 그것을 기다린다. Docker DX는 기본값이 `all`이다. Kotlin 확장은 켜질 때 JetBrains 서버로 지역 검사를 보내고, 지역과 데이터 공유를 고르기 전에는 서버를 띄우지 않는다.
- **묻지 않고 하는 일.** Go 확장은 켜지면 `go env`를 기다리고, 빠진 도구를 설치하고, 확장 호스트 자신의 환경 변수를 고친다. Docker DX는 `docker` 명령을 실행하고 Docker Desktop 설치를 권한다.
- **권한.** VS Code 확장은 사용자 권한 그대로 도는 Node 프로그램이다. 가두는 장치가 없다. Zed 확장은 WASM 안에서 돈다. VS Code는 이 틈을 "작업 공간 신뢰"로 메우고 확장들은 그것에 기댄다. 호스트가 신뢰 판단을 넘기지 않으면 틈이 그대로 열린다. Svelte 서버는 `isTrusted`를 받지 못하면 신뢰한다고 보고 프로젝트의 `svelte.config.js`를 실행한다(`vendor/svelte-language-tools/packages/language-server/src/server.ts:158-160`). Setdown은 지금 이 값을 보내지 않는다. 확장과 무관하게 고칠 일이다.
- **메모리.** 이 컴퓨터에 켜져 있는 VS Code 1.146.0에서 확장 호스트 프로세스 하나가 상주 메모리 320 MB였다(한 시점의 값, 설치된 확장 전부 포함). 언어 서버는 그 밑에 각각 따로 뜬다. Setdown 쪽과 같은 조건으로 비교한 값은 없다.

## 3. 언어별로 본 것: 로직은 어디에 있고, 돌리면 무엇을 얻는가

| 언어 | 분석을 가르는 로직이 있는 곳 | 확장을 돌려야만 얻는 것 | 확장 없이 얻는 길 |
| --- | --- | --- | --- |
| Python | 분석은 Pyright(이미 사용). 환경 찾기는 Rust 부품 PET. 확장에는 선택 순위와 `.env` 전달 규칙 | 환경 만들기와 패키지 설치 화면, 디버거, 테스트 | PET는 Zed를 통해 호스트에 이미 링크되어 있다. Python을 Zed 엔진 경로로 옮기면 쓴다 |
| TS/JS | 확장 자체가 `tsserver` 클라이언트(LSP 아님) | 버전 선택 화면, 진행 표시 | 그 코드를 감싼 LSP 서버 둘이 있고 하나를 이미 쓴다 |
| Svelte | 서버(공개). 확장은 요청 6개와 옵션 | 컴포넌트 추출 같은 명령의 화면 | 요청과 옵션 10여 개를 보낸다 |
| JSON·CSS·HTML | 서버(이미 사용, 판이 뒤처짐). 확장은 스키마 내려받기의 문지기 | 스키마 상태 표시, 다른 확장이 낸 스키마 표 | 서버만 새로 빌드. 자동 닫기는 요청 하나와 100줄 |
| YAML | 거의 전부 서버(이미 사용) | 스키마 고르기 화면 | 얻을 것이 거의 없다 |
| C/C++ | clangd. 확장은 얇고 프로젝트 설정은 Setdown이 더 한다 | AST·메모리 보기 | clangd 전용 요청은 Zed가 일부 처리한다. Zed 엔진 경로로 옮기면 얻는다 |
| Rust | 서버. 확장은 전용 프로토콜 40개의 화면 | 그 화면 | 상태 표시는 Zed 엔진 경로에 이미 있다 |
| Go | **확장에 서버에 없는 로직이 있다** | Go 버전 선택기, 도구 설치 화면 | 규칙과 도구 표를 옮긴다(모듈로는 못 뗀다) |
| PHP | 비공개 서버(이미 사용). 확장은 575줄 | 라이선스 키 입력 화면 | 초기화 옵션 5개 |
| Docker | 서버(이미 사용) | 없다. Compose는 오히려 나빠진다 | 해당 없음 |
| Kotlin | 서버. 확장은 검증되는 내려받기, 초기화 옵션, 전용 요청 13개 | 가져오기 상태 화면, 디버거, 테스트 | 공개된 클라이언트 로직을 옮긴다 |
| Java | **확장에 서버에 없는 로직이 있다** | 가져오기 화면, 디버거 연동 | JRE 찾기 221줄, JDK 등록 40줄, 탐색 라이브러리 `jdk-utils` |

언어별로 판단에 쓴 사실만 적는다. 근거 줄은 해당 파일에 있다.

**Python** ([languages/python.md](languages/python.md)). Microsoft Python 확장은 Pyright를 띄우지 않는다. 띄울 수 있는 것은 Pylance, Jedi, 없음 셋이다. Pylance는 쓸 수 없으므로 이 확장을 돌리면 분석은 Jedi가 된다. 확장 클라이언트에서 언어 서버 코드는 4.8%이고 환경 코드가 31%다. 그 환경 탐색도 확장이 직접 하지 않고 Rust 실행 파일 PET에 묻는다. Zed가 같은 PET를 링크하므로 Setdown의 Rust 호스트에도 들어 있다(`tooling/language-host/Cargo.lock:6186`). 그런데 Python은 아직 자체 경로에 있고, 손으로 짠 탐색기는 `.venv`, conda, PATH, Jupyter 커널만 본다(`apps/desktop/src/main/notebook/python-environments.ts:40-72`). pyenv, Poetry, Pipenv, Hatch, Pixi는 보지 못한다.

**TypeScript와 Svelte** ([languages/typescript-svelte.md](languages/typescript-svelte.md)). TypeScript 확장은 돌리기 가장 어렵고(LSP가 아니고, 내장 전용이고, 제안 API 5개), 돌릴 이유는 가장 작다(같은 코드를 감싼 서버가 둘). Svelte 확장에서 가져올 것은 실행이 아니라 목록이다. 표준 밖 요청 6개와 초기화 옵션 10개 묶음인데 Setdown은 하나도 보내지 않는다.

**JSON·CSS·HTML·YAML** ([languages/json-css-html-yaml.md](languages/json-css-html-yaml.md)). 네 확장 모두 서버가 확장 안에 들어 있어 도구 확보도 런타임 선택도 없다. JSON에서 "어느 파일에 어느 스키마"는 대부분 다른 내장 확장 10개가 낸 64개 항목에서 온다. JSON 확장만 돌려서는 그 표가 오지 않는다. VS Code에서는 클라이언트가 스키마를 받아 오며 신뢰 도메인과 작업 공간 신뢰를 검사하고 디스크에 캐시한다. Zed와 Setdown에서는 서버가 직접 받고 검사도 캐시도 없다. YAML 확장의 기능이라고 여겨지는 것(SchemaStore, Kubernetes 감지, 주석으로 스키마 지정)은 서버에 있어 Setdown이 이미 쓴다.

**C/C++** ([languages/c-cpp.md](languages/c-cpp.md)). clangd 확장에는 컴파일러나 `compile_commands.json`을 찾는 로직이 없다. Setdown은 그 파일을 여러 폴더에서 찾고 CMake와 Meson 구성까지 한다. 빠진 것은 clangd 전용 요청(비활성 영역, 소스·헤더 전환 등)인데, Zed는 일부를 다루지만 C/C++가 아직 Zed 엔진 경로에 없어 Setdown에서는 0개다. Microsoft C/C++ 확장은 엔진이 비공개 실행 파일이고 전용 메서드 78개로 말하며 라이선스로 막혀 있다. 컴파일러 탐지는 그 비공개 엔진 안에 있어 클라이언트를 읽어도 얻지 못한다.

**Rust와 Go** ([languages/rust-go.md](languages/rust-go.md)). Rust 확장에는 내려받기가 없고 프로젝트 발견과 상태 문구는 서버가 한다. 도구 확보는 Setdown이 쓰는 Zed 어댑터가 더 한다. Go는 다르다. 확장이 도구 13개의 표, Go 버전별 gopls 버전 고정, 설치용 환경 정리, `GOBIN`·GOPATH·GOROOT·PATH 순서의 찾기를 갖고 있다. Zed의 Go 어댑터는 PATH에서만 찾고 항상 `gopls@latest`를 설치한다(`vendor/zed/crates/languages/src/go.rs:118, 168`). 이 차이는 Setdown이 물려받은 실제 빈틈이다. 다만 그 규칙은 설정 읽기, 환경 변수 변경, 알림 호출과 한 함수에 섞여 있어 모듈로 가져올 수 없고 옮겨 적어야 한다.

**PHP와 Docker** ([languages/php-docker.md](languages/php-docker.md)). Intelephense의 분석은 전부 비공개 서버에 있고 Setdown이 이미 그 서버를 돌린다. Microsoft 컨테이너 확장의 Compose 서버는 스키마 검사를 하지 않는다고 소스에 적혀 있고, Setdown 측정에서 실수 표시와 자동완성을 놓쳤다(`apps/lsp-benchmark/results/light.md:13`). 지금 쓰는 `yaml-language-server`는 모두 맞혔다(`apps/lsp-benchmark/results/compose-yaml-language-server.md:7`). 이 확장은 한 함수가 모든 것을 등록하므로 언어 부분만 켤 수도 없다.

**Kotlin과 Java** ([languages/kotlin-java.md](languages/kotlin-java.md)). Kotlin 확장의 클라이언트는 JDK를 고르지 않는다. 환경 변수를 그대로 넘긴다. **확장을 돌려도 JDK 17 거짓 오류는 그대로다.** Java는 반대다. 내장 JRE, 설치된 JDK 탐색과 등록, Gradle과 JDK가 맞지 않을 때의 해결 제안이 모두 클라이언트에 있다. Setdown에도 같은 일을 하는 코드가 있으나 실행 파일 이름이 `jdtls`일 때만 돌고(`apps/desktop/src/main/language/tool-runtime.ts:56`), Zed 확장 경로에서는 그 앞 단계에서 실패한다. 실패 문구도 인식하지 못한다. Zed 확장은 "require at least Java version 25"라고 쓰는데 Setdown의 정규식은 "requires"를 찾는다(`apps/desktop/src/main/language/language-issue.ts:19`).

정리하면, 확장을 통째로 돌려야만 얻는 것은 화면과 디버거·테스트다. 분석이 맞게 되느냐를 가르는 것은 서버, 분리된 부품, 또는 읽고 옮길 수 있는 규칙이다. "수백 줄"이라는 크기는 소스를 읽고 낸 추정이며 옮겨 본 것은 아니다.

## 4. 구할 수 있는가: 약관과 배포

Microsoft의 FAQ는 Code - OSS 포크를 포함한 다른 제품이 Visual Studio Marketplace에 접근할 수 없고, Microsoft가 만든 확장은 Visual Studio 제품군 밖에서 쓰도록 허가하지 않는다고 적는다([FAQ](https://code.visualstudio.com/docs/supporting/faq)). 따라서 공급원은 Open VSX나 각 프로젝트의 배포본이다. 2026-11-19에 조회한 결과다.

| 확장 | Open VSX | 올린 주체 | 비고 |
| --- | --- | --- | --- |
| `redhat.java` | 1.59 계열, 플랫폼별 | Red Hat | JRE 25 내장 확인(받은 꾸러미에 `jre/25.0.5-linux-x86_64`) |
| `ms-python.python` | 2026.4.0 (2026-03) | Open VSX 커뮤니티 | 소스는 2026.13.0. 8개월 뒤처짐 |
| `ms-python.vscode-python-envs` | 1.44.0 | Open VSX 커뮤니티 | |
| `ms-python.vscode-pylance` | **없음** | | Microsoft 제품 전용 |
| `ms-pyright.pyright` | 1.1.402 (2025-06) | Open VSX 커뮤니티 | 소스는 1.1.414 |
| `detachhead.basedpyright` | 1.40.2 | 제작자 | |
| `svelte.svelte-vscode` | 110.3.2 | 제작자 | |
| `llvm-vs-code-extensions.vscode-clangd` | 0.6.0 | 제작자 | |
| `ms-vscode.cpptools` | **없음** | | Microsoft 제품 전용 |
| `rust-lang.rust-analyzer` | 0.4.3125, 플랫폼별 | 제작자 | |
| `golang.Go` | 0.58.0 | Open VSX 커뮤니티 | |
| `bmewburn.vscode-intelephense-client` | 1.18.5 | 제작자 | 서버는 별도 약관 |
| `JetBrains.kotlin-server` | 0.0.86, 플랫폼별 | JetBrains | JetBrains Free Plugin License |
| `redhat.vscode-yaml` | 2.1 계열 | Red Hat | |
| `ms-azuretools.vscode-containers` | 2.4.5 | Open VSX 커뮤니티 | |
| `docker.docker` | 0.18.0, 플랫폼별 | Docker | |

막는 조항은 넷이다. 아래는 조항을 옮긴 것이고 법적 판단은 하지 않았다.

- **Pylance.** "Pylance is licensed for use in Microsoft products and services only, so can only be used on official Microsoft builds of Visual Studio Code and GitHub Codespaces." (`vendor/pylance-release/FAQ.md:17`)
- **Microsoft C/C++.** "You may install and use any number of copies of the software only with Microsoft Visual Studio, Visual Studio for Mac, Visual Studio Code, Azure DevOps, Team Foundation Server, and successor Microsoft products and services" (`vendor/vscode-cpptools/RuntimeLicenses/cpptools-LICENSE.txt:19-22`). 2025년 4월의 1.24.5부터는 실행 파일이 환경을 검사해 VSCodium과 Cursor에서 동작을 거부한다고 보도됐다([The Register](https://www.theregister.com/2025/04/24/microsoft_vs_code_subtracts_cc_extension/)).
- **Kotlin 확장 꾸러미.** 저장소의 소스는 Apache 2.0이지만 배포되는 VSIX는 JetBrains Free Plugin License다. 3.4항이 수정, 제3자 제공, 유사·경쟁 제품을 만들려는 접근을 금한다(`vendor/kotlin-lsp/kotlin-vscode/LICENSE.txt:82-101`). VSIX를 Setdown에 넣어 배포하는 길은 이 조항과 부딪친다. 지금처럼 독립 서버를 사용자의 기기에서 받아 쓰는 것과는 다른 문제다.
- **Intelephense 서버.** "By installing this software you agree…", 복제·배포 금지, 서버가 보낸 알림을 숨기지 말 것(`vendor/vscode-intelephense/LICENSE.txt:33-34, 72-74`).

Intelephense에서 **확장과 무관하게 지금 고칠 것** 두 가지가 나왔다. Setdown 카탈로그는 이 서버를 MIT로 적고 있다(`apps/desktop/src/main/language/catalog/mason.json:3707-3709`). 그리고 Setdown의 자체 클라이언트는 서버의 `window/showMessage`를 기록만 한다(`apps/desktop/src/main/language/server-session.ts:120-121`). 이것이 "알림을 숨긴다"에 해당하는지는 판단하지 않았다.

## 5. 확장을 명세로 쓸 때 가져올 것

언어별 파일의 4절("Zed와 Setdown은 지금 어떻게 하는가")에서 나온 것을, 분석이 맞게 되느냐에 영향이 큰 순서로 적는다. 모두 양쪽 소스에서 확인한 차이다. 구현 제안이며 아직 만든 것은 없다.

| # | 언어 | 지금 빠진 것 | 근거가 되는 확장 소스 | Setdown에서 잇는 곳 |
| --- | --- | --- | --- | --- |
| 1 | Java | 설치된 JDK 가운데 25 이상을 찾아 도구에 넘기기, 프로젝트용 JDK 목록 넘기기 | `vendor/vscode-java/src/requirements.ts`, `src/utils.ts:286-324`, npm `jdk-utils` | `tool-runtime.ts`가 Zed 확장 경로에서도 돌게 하고 Zed 설정 `java_home`으로 전달 |
| 2 | Java | 실패 문구 인식 | Zed Java 확장의 문구 | `language-issue.ts:19`의 정규식 |
| 3 | Python | pyenv, Poetry, Pipenv, Hatch, Pixi 환경 찾기 | 두 Python 확장이 쓰는 PET | Python을 Zed 엔진 경로로 옮긴다(노트북 경로는 그대로) |
| 4 | Go | `GOBIN`·GOPATH의 gopls 찾기, Go 버전에 맞는 gopls 버전, 설치용 환경 정리 | `vendor/vscode-go/extension/src/goInstallTools.ts`, `goToolsInformation.ts`, `goEnv.ts` | Zed 설정의 `binary` 지정 또는 호스트 쪽 준비 단계 |
| 5 | Svelte | `isTrusted`와 설정 묶음 전달, 열린 `.ts` 변경 알림, 설정 파일 변경 시 재시작 | `vendor/svelte-language-tools/packages/svelte-vscode/src/extension.ts` | 초기화 옵션과 알림 한 종류 |
| 6 | Kotlin | 초기화 옵션(Zed 확장은 하나도 보내지 않는다), 내려받기 검증 | `vendor/kotlin-lsp/vscode-extension-core/src/lspClient.ts` | Zed 설정의 `initialization_options` |
| 7 | JSON | 스키마 내려받기에 신뢰 검사와 캐시가 없다. 어떤 스키마가 쓰였는지 보여 줄 곳이 없다 | `vendor/vscode/extensions/json-language-features/client/src/jsonClient.ts` | `json/languageStatus` 요청과 언어 상태 화면 |
| 8 | HTML | 닫는 태그와 따옴표 자동 넣기 | `vendor/vscode/extensions/html-language-features/client/src/autoInsertion.ts` | `html/autoInsert` 요청 하나 |
| 9 | C/C++·Rust | clangd 전용 요청, rust-analyzer 상태 | Zed가 이미 다루는 부분 | 두 도구를 Zed 엔진 경로로 옮긴다(Rust는 잠금 파일 경합이 남아 있다) |
| 10 | TS/JS | tsserver 플러그인 전달, 힙 한도, 타입 자동 내려받기 여부 | 래퍼의 `_typescript.configurePlugin` | 서버 설정. `vtsls`와의 비교 측정이 먼저다 |
| 11 | PHP | 카탈로그의 라이선스 표기, 서버 알림 표시 | `vendor/vscode-intelephense/LICENSE.txt` | 카탈로그와 `server-session.ts` |

Kotlin의 JDK 문제는 이 표에 없다. 확장에 그 로직이 없기 때문이다. 앞서 조사한 대로 kotlin-lsp는 `JAVA_HOME`이 없으면 내장 런타임을 쓴다고 릴리스 노트에 적혀 있고, Setdown이 셸의 `JAVA_HOME=17`을 넘기는 것이 원인일 수 있다. 실행해 확인하지 않았다.

**옮긴 규칙은 낡는다는 반론**이 있다. 확장을 돌리면 제작자가 규칙을 고칠 때 따라오지만, 옮겨 적은 것은 그렇지 않다. 이것이 확장 실행의 가장 실질적인 이점이다. 서브모듈이 그 비용을 줄인다. 위 표의 "근거가 되는 확장 소스"가 감시할 파일 목록이다. 서브모듈을 올릴 때 그 파일들의 차이만 보면 무엇이 바뀌었는지 안다.

```bash
git -C vendor/vscode-java fetch --depth 1 origin main
git -C vendor/vscode-java diff HEAD FETCH_HEAD -- src/requirements.ts src/jdkUtils.ts src/utils.ts
```

## 6. 권고와 결정할 것

### 6.1 언어 지원에 대해서는: 끼워 넣지 않는다

확장을 돌리는 길은 네 가지이고, 앞의 셋은 10월 보고서 6절이 비교했다.

| 길 | 확장이 그대로 도는가 | Setdown이 내는 값 |
| --- | --- | --- |
| Code - OSS를 기반으로 삼기 | 그렇다. Microsoft 전용 확장만 빼고 | Reader, 브라우저, 탭을 워크벤치 위로 옮긴다. 매달 상류를 따라간다 |
| 지금 Setdown 안에 VS Code 서비스 층 들이기(`monaco-vscode-api`) | Node 확장은 커밋이 맞는 VS Code 서버가 따로 있어야 한다 | 독립 Monaco를 버리고 문서의 주인이 VS Code 서비스가 된다 |
| Theia | 지원 API 판까지 | 다른 구현이라 동작 차이를 따로 확인한다. 최신 확장은 판이 모자랄 수 있다 |
| 보이지 않는 VS Code를 옆에 띄우고 다리 확장으로 묻기 | 그렇다 | 문서의 주인이 둘이 되고, 확장이 띄운 창이 보이지 않고, 앱 하나가 더 메모리에 뜬다 |

둘째 길에 대해 새로 확인한 것이 있다. `monaco-vscode-api`의 README가 말하는 확장 호스트는 iframe 안의 웹 워커이고, Node가 필요한 확장은 VS Code 서버를 따로 받아 "클라이언트와 서버의 커밋과 제품 품질이 같아야" 붙는다([안내 문서](https://github.com/CodinGame/monaco-vscode-api/wiki/How-to-install-and-use-VSCode-server-with-monaco%E2%80%90vscode%E2%80%90api)). 이번에 본 확장 가운데 Java, Go, Rust, clangd, Kotlin, Svelte, Intelephense는 Node 진입점만 있고, 언어 서버를 프로세스로 띄우는 일은 모두 Node 호스트가 있어야 한다.

언어 분석만 놓고 보면 어느 길도 권하지 않는다. 3절에서 본 대로 얻는 것은 화면이고, 분석을 가르는 로직은 더 싼 길로 얻을 수 있다. 내는 값은 문서 소유권이다. Setdown의 저장, 실행 취소, 미리보기는 "문서의 주인은 Setdown"이라는 전제 위에 만들어져 있다.

넷째 길은 제품 구조로는 쓰지 않되 **측정 도구로는 가치가 있다.** 실제 VS Code에 실제 확장을 넣고 같은 파일, 같은 위치에서 답을 받으면, `apps/lsp-benchmark`의 각 사례에 "VS Code라면 무엇을 답하는가"라는 기준 열이 생긴다. "전문가의 로직만큼 되는가"를 주장이 아니라 수치로 볼 수 있다. 7절의 실험이 그 첫 단계다.

### 6.2 제품 목표에 대해서는: 아직 내려지지 않은 결정이 있다

10월 24일 보고서의 요구사항은 "Python, Jupyter, TypeScript, Svelte, C++, Remote SSH, Codex 같은 VS Code 확장을 사용하면서 Setdown으로 VS Code를 대체한다"였다. 권고는 Code - OSS 기반의 수직 시제품을 먼저 검증하라는 것이었다. 저장소에 그 시제품의 흔적은 없고, 11월에는 Zed 엔진 경로가 진행됐다. 두 길은 같은 곳으로 가지 않는다.

- **Zed 엔진 경로**는 "코드 분석을 믿을 수 있는 Setdown"으로 간다. 도달점은 Zed 수준에 5절의 보강을 더한 것이다. 디버거, 테스트 탐색기, 남이 만든 확장은 오지 않는다.
- **Code - OSS 경로**는 "VS Code를 대체하는 Setdown"으로 간다. 확장이 말 그대로 그대로 돈다. 대신 지금의 셸을 옮기고 포크를 유지한다.

이번 조사가 이 선택에 더하는 것은 하나다. **언어 분석의 품질만이 이유라면 Code - OSS로 갈 필요가 없다.** 갈 이유는 디버거, 테스트, 노트북, 원격, 그리고 다른 사람들이 자기 확장을 깔 수 있다는 점이다. 여러 사람이 쓸 제품이라면 그 사람들이 무엇을 기대하는지가 이 선택을 정한다. 이것은 조사로 정할 수 없고 정해 주어야 한다.

### 6.3 지금 할 수 있는 일

제품 목표와 무관하게 값이 있는 순서다.

1. 5절의 1, 2번(Java). 사용자가 실제로 겪은 문제이고 필요한 코드가 이미 있다.
2. 5절의 5번 중 `isTrusted`, 11번의 라이선스 표기. 작고, 보안과 약관에 닿는다.
3. 5절의 3번(Python을 Zed 엔진 경로로). 이미 링크된 부품을 쓰는 일이다.
4. 7절의 실험. 한 번 돌리면 6.1과 6.2의 판단에 쓸 실측값이 생긴다.

## 7. 확인하지 않은 것

- **확장을 실행하지 않았다.** 이 보고서의 모든 동작 서술은 소스에서 읽은 것이다.
- **실행 실험은 준비만 했다.** 내용은 이렇다. 별도 프로필의 VS Code에 Open VSX의 `redhat.java`를 넣고, 사용자의 Java 25 프로젝트 사본을 열고, 다리 확장으로 진단·호버·자동완성·저장하지 않은 편집의 진단을 받아 적는다. 환경에는 `JAVA_HOME=17`을 그대로 둔다. 동시에 확장과 화면 사이의 통신을 전부 기록해(`--logExtensionHostCommunication`) 확장 하나가 실제로 부르는 통로를 세고, 메모리를 잰다. 격리된 화면에서 돌리도록 만들었으나 실행 단계가 이 세션의 권한 검사에서 거부되어 돌리지 않았다. 준비물은 [experiment/](experiment/)에 있고, 프로필과 확장 꾸러미는 `~/.cache/setdown-vscode-experiment`(약 330 MB)에 있다.
- 따라서 다음 값이 없다: 확장 하나가 쓰는 통로의 실제 수, Java 확장과 서버의 메모리, 그 프로젝트에서 거짓 오류가 0이 되는지.
- 서버 쪽 동작. eclipse.jdt.ls, kotlin-lsp, gopls, `yaml-language-server`, 언어 서비스 라이브러리의 소스는 `vendor/`에 없다. 서버가 한다고 적은 것 가운데 일부는 문서와 클라이언트 코드에서 미루어 본 것이다.
- `typescript-language-server`와 `vtsls`가 원래 확장의 로직을 어디까지 담았는지. 설치본의 README와 LICENSE만 읽었다.
- 약관의 법적 해석, Marketplace 약관 원문, PET와 `jdk-utils`의 라이선스 원문(`jdk-utils`는 `package.json`에 MIT로 표시).
- 5절의 크기 추정("수백 줄")과 3절의 "옮길 수 있다"는 판단. 옮겨 본 것이 아니다.
- Open VSX에 있는 판이 Setdown 같은 호스트에서 실제로 켜지는지.

## 부록 A. 기준 소스

이번에 `vendor/`에 얕은 서브모듈로 추가한 저장소다. 스테이징만 했고 커밋하지 않았다.

| 경로 | 커밋 | 원본 |
| --- | --- | --- |
| `vendor/vscode-python` | `9c08cef0f5` | microsoft/vscode-python |
| `vendor/vscode-python-environments` | `54a6e7807c` | microsoft/vscode-python-environments |
| `vendor/svelte-language-tools` | `1c895e980e` | sveltejs/language-tools |
| `vendor/vscode-clangd` | `4a6fe6386d` | clangd/vscode-clangd |
| `vendor/vscode-cpptools` | `f1c3b981ef` | microsoft/vscode-cpptools |
| `vendor/rust-analyzer` | `db89bd286f` | rust-lang/rust-analyzer |
| `vendor/vscode-go` | `3ab28d0022` | golang/vscode-go |
| `vendor/vscode-intelephense` | `8935a6dba1` | bmewburn/vscode-intelephense |
| `vendor/kotlin-lsp` | `a41759204f` | Kotlin/kotlin-lsp |
| `vendor/vscode-yaml` | `8582b6d7bd` | redhat-developer/vscode-yaml |
| `vendor/vscode-containers` | `b1eab4114e` | microsoft/vscode-containers |
| `vendor/docker-vscode-extension` | `26e0ea23f8` | docker/vscode-extension |
| `vendor/vscode-java` | `d25cdc3187` | redhat-developer/vscode-java |

Java는 `supported-languages.ts`의 목록에 없지만 이번 질문이 Java와 Kotlin의 JDK 문제에서 나왔으므로 넣었다. TS/JS, JSON, CSS, HTML, PHP 기본 확장은 이미 있던 `vendor/vscode`(`d3d31f62268`, 1.142.0) 안에 있다. Pyright와 basedpyright의 클라이언트도 이미 있던 `vendor/pyright`, `vendor/basedpyright`에 있다.

## 부록 B. 언어별 파일

| 파일 | 다루는 확장 | 인용 검사 |
| --- | --- | --- |
| [languages/python.md](languages/python.md) | Python, Python Environments, Pyright·basedpyright 클라이언트, Pylance | 177건 확인 |
| [languages/typescript-svelte.md](languages/typescript-svelte.md) | TypeScript 내장 확장, Svelte | 161건 확인 |
| [languages/json-css-html-yaml.md](languages/json-css-html-yaml.md) | JSON·CSS·HTML 내장 확장, Red Hat YAML | 19건 확인, 나머지는 확장 폴더 기준 상대 경로 |
| [languages/c-cpp.md](languages/c-cpp.md) | clangd, Microsoft C/C++ | 162건 확인 |
| [languages/rust-go.md](languages/rust-go.md) | rust-analyzer, Go | 208건 확인 |
| [languages/kotlin-java.md](languages/kotlin-java.md) | Kotlin by JetBrains, Red Hat Java | 73건 확인, 나머지는 약어 경로 |
| [languages/php-docker.md](languages/php-docker.md) | Intelephense, PHP 내장 확장, Container Tools, Docker DX | 188건 확인 |

"확인"은 인용한 파일이 있고 그 줄 번호가 파일 길이 안에 있는지를 기계로 본 것이다. 없는 파일이나 범위를 벗어난 줄은 0건이었다. 인용한 줄이 본문의 주장을 실제로 뒷받침하는지는 이 보고서가 기대는 여덟 곳만 직접 읽어 확인했다(Java 실행 파일 이름 조건, 실패 문구 정규식, PET 링크, Svelte `isTrusted`, 제안 API 차단, C/C++와 Kotlin 약관, Zed Go 어댑터).

## 부록 C. 수치를 다시 얻는 법

```bash
# 통로 수
grep -c "^export interface MainThread.*Shape" vendor/vscode/src/vs/workbench/api/common/extHost.protocol.ts
grep -c "^export interface ExtHost.*Shape" vendor/vscode/src/vs/workbench/api/common/extHost.protocol.ts
# Theia가 지원한다고 적은 API 판
grep -n "DEFAULT_SUPPORTED_API_VERSION" vendor/theia/dev-packages/application-package/src/api.ts
# Open VSX에 있는지
curl -s https://open-vsx.org/api/redhat/java | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('version'), d.get('license'))"
```
