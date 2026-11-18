# 언어 지원 안내를 짧게 만드는 설계 논리

작성일: 2026-11-18 · 연구 보고서 · 기준 `29d880f010e00e442effe9e1d63c85bdf747b332` · 1~8절은 코드를 고치기 전의 연구다. 같은 날 이 내용을 구현했고, 결과와 달라진 점은 9절에 적었다. 사용자 설정(`~/.config/Setdown`)은 수정하지 않았다.

## 결론

**지금 화면은 "언어 도구가 어떤 상태인가"를 보여 준다. 대상 사용자에게 필요한 것은 "왜 안 되고, 무엇을 누르면 되는가" 한 줄이다.**

현재는 실패 원인이 무엇이든 `stopped`라는 문구와 `Restart` 버튼 하나로 표시한다. 제안은 실패 원인을 여덟 가지로 나누고, 원인마다 문장 하나와 버튼 하나를 미리 정해 두는 것이다. 그 밖의 정보는 전부 `More…` 한 곳 아래로 내린다.

Java 사례가 이 문제를 그대로 보여 준다. 화면을 본 사용자는 "LSP가 없으니 직접 설치해야 한다"고 판단했다. 실제로는 Java 도구(jdtls)가 이미 설치돼 있고, 그것을 실행할 Java 25도 이 컴퓨터에 있다. 막힌 이유는 설정 두 가지였고, 지금 막고 있는 쪽은 버튼 한 번으로 풀린다. 그 버튼은 `Restart java`가 아니며, 다른 화면의 접힌 영역 안에 있다.

## 1. Java에서 실제로 일어난 일

| 화면이 말한 것 | 실제 |
| --- | --- |
| `java stopped.` | 한 번도 시작된 적이 없다. `java`라는 이름의 도구에 실행 파일로 JVM 자체(`/usr/lib/jvm/java-17-temurin-jdk/bin/java`)가 지정돼 있다. 인자 없이 실행된 JVM은 사용법을 출력하고 종료 코드 1로 끝난다. |
| `Automatic recovery paused after repeated failures.` | 같은 실행을 세 번 했고 세 번 모두 같은 이유로 끝났다. |
| `Restart java` | 같은 실행을 네 번째로 한다. 결과는 같다. |
| 말하지 않음 | jdtls 1.49는 Setdown이 이미 내려받아 두었다. |
| 말하지 않음 | 이 jdtls는 Java 21 이상에서만 실행된다. 셸의 기본 Java는 17이고, Java 25가 `/usr/lib/jvm/java-25-openjdk`에 설치돼 있다. |

**지금 푸는 방법.** 왼쪽 Language Support → Installation management → java → Connection settings → `Reset executable selection`. 이후에는 두 번째 원인(Java 21 요구)으로 다시 멈출 수 있다. 직접 설치할 것은 없다.

**JVM이 지정된 경위.** Zed 확장 `java-eclipse-jdtls`는 서버 이름이 `java`다. Setdown은 이 이름을 실행 명령으로 취급하므로 PATH에서 JVM `java`를 찾아 실행 파일 후보로 제시한다. 앱에 포함된 Zed 프로필 365개 중 이 컴퓨터에서 같은 충돌이 나는 것은 `cmake`, `java`, `gem` 세 개다. 지정값은 후보 목록의 `Use this executable`이나 `Choose executable…`로만 저장되는데(`language-manager.ts:358,378`), 언제 눌렸는지는 기록이 없다.

**확인한 방법과 한계.**

- 지정값: `~/.config/Setdown/language-servers.json`의 `zed.java-eclipse-jdtls.java` 항목(`automaticExecutable: false`).
- 실행 경로: 실행 파일이 절대 경로로 지정되면 Zed 준비 경로를 건너뛰고 그 파일을 그대로 실행한다(`language-manager.ts:501-505`, `server-registry.ts:343-350`). 코드로 확인했고, 앱의 실행 로그는 메모리에만 있어 직접 보지 못했다.
- JVM의 종료: 같은 파일을 인자 없이 실행해 사용법 출력과 종료 코드 1을 확인했다.
- Java 21 요구: 설치된 jdtls 실행 스크립트를 `JAVA_HOME`이 Java 17인 상태로 실행해 `jdtls requires at least Java 21` 예외를 확인했다. Setdown이 jdtls에 어떤 `JAVA_HOME`을 넘기는지는 확인하지 않았다.

## 2. 화면이 길면서 모호한 이유

1. **원인이 아니라 상태로 갈라진다.** 요약 문구는 `failed` 상태 하나에 `stopped`와 `Restart`를 붙인다(`document-presentation.ts:20-26`). 실행 파일이 틀린 경우, 런타임이 없는 경우, 실행 중 죽은 경우가 모두 같은 화면이 된다.
2. **원인은 이미 수집돼 있는데 세 단계 아래에 있다.** 실패 메시지에는 실패 단계, 종료 코드, 오류 출력 끝부분이 들어 있다(`server-session.ts:78,89`). 이 메시지는 Details… → Tools for this document → java 화면에서만 보인다(`DocumentAnalysisPanel.svelte:96`).
3. **고치는 버튼이 다른 화면에 있다.** `Reset executable selection`은 왼쪽 패널의 접힌 `Connection settings` 안에 있다(`LanguageSupport.svelte:254`). 문제를 알리는 팝업에서 그 버튼까지 가는 경로가 없다.
4. **첫 화면의 조작 여섯 개 중 문제를 푸는 것이 없다.** 닫기, `Restart java`, `Document language`, `Project`, `Problems`, `Details…`.
5. **같은 것을 가리키는 단어가 열 개가 넘는다.** Code support, Document analysis, Language support, Language settings, analysis tool, analysis provider, language server, connection, tool, service, checks. 도구 모음의 상태 문구만 14종이다.
6. **왼쪽 패널은 저장 위치별로 나뉘어 있다.** 세 카드의 뜻은 아래와 같고, 대상 사용자가 쓸 일이 있는 것은 세 번째뿐인데 거기에 Java를 고치는 버튼이 숨어 있다.

| 카드 | 뜻 | 대상 사용자에게 |
| --- | --- | --- |
| Language defaults | 언어마다 어떤 도구를 쓸지. 수백 개 언어가 나열되고 대부분 `Automatic`이다. | 건드릴 일 없음 |
| Custom connections | 직접 설치한 서버를 수동으로 등록 | 쓸 일 없음 |
| Installation management | Setdown이 받아 둔 도구 목록과 실행 파일 지정 | 문제가 생겼을 때만 필요 |

## 3. 설계 논리

1. **잘 될 때는 말하지 않는다.** 도구 모음에는 언어 이름만 둔다. 지금도 정상일 때 문구가 비어 있으므로 유지한다.
2. **Setdown이 대신 한 일은 한 번만 짧게 알린다.** 처음 내려받을 때 `Java · Setting up…`을 보여 주고 끝나면 지운다. 자동 설치가 놀라운 이유는 한 일을 알려 주지 않아서다.
3. **문제는 문장 하나와 버튼 하나로 말한다.** 문장은 사용자가 겪는 일을 쓰고, 버튼은 그 원인을 푸는 동작이다.
4. **버튼은 원인이 정한다.** `Restart`는 잘 되다가 멈춘 경우에만 쓴다. 시작조차 못 한 도구를 다시 시작하는 버튼은 내놓지 않는다.
5. **고칠 수 있는 자리에서 고친다.** 버튼은 문제를 알린 팝업 안에서 바로 동작한다. 다른 패널로 보내지 않는다.
6. **나머지는 `More…` 하나 아래에 둔다.** 프로젝트 경로, 프로젝트 기준 파일, 선택 출처, 서버 출력, 연결 설정은 지금의 Details 화면 그대로 남긴다. 지우는 정보는 없고 첫 화면에서만 빠진다.
7. **이름은 언어로 부른다.** 첫 문장에는 `Java support`라고 쓴다. 도구 이름(`java`, `intelephense`)은 `More…` 아래에서만 나온다. 지금의 `java stopped.`는 언어, JVM, 도구 중 무엇인지 알 수 없다.

## 4. 원인별 문장과 버튼

판별에 쓰는 사실은 모두 메인 프로세스가 이미 갖고 있다. 지금은 메시지 문자열에 섞여 넘어올 뿐 구분된 값으로 전달되지 않는다.

| 원인 | 판별하는 사실 | 문장 | 버튼 |
| --- | --- | --- | --- |
| 처음 준비하는 중 | 준비 단계의 진행 메시지 | `Setting up Java support…` | 없음 |
| 내려받기 실패 | 준비 단계에서 오류 | `Couldn't download Java support.` | `Try again` |
| 자동 설치가 꺼져 있음 | `AutomaticDownloadsDisabled` | `Java support isn't installed. Downloads are off.` | `Install Java support` |
| 자동 설치 방법이 없음 | 설치기 없음, 실행 파일 못 찾음 | `Setdown can't install Java support by itself.` | `How to install ↗`, 보조로 `I already have it…` |
| 지정한 실행 파일이 시작되지 않음 | 사용자 지정 실행 파일이고 초기화 단계에서 종료 | `Java support can't start. It is set to run …/bin/java, which is not a language tool.` | `Use automatic setup` |
| 필요한 런타임이 없거나 낮음 | 오류 출력의 알려진 문구 | `Java support needs Java 21 or newer. This project uses Java 17.` | 맞는 런타임이 있으면 `Use Java 25`, 없으면 `How to install ↗` |
| 원인을 모르는 시작 실패 | 초기화 단계에서 세 번 종료 | `Java support can't start.` 아래에 오류 출력 마지막 한 줄 | `Show log`, 보조로 `Try again` |
| 잘 되다가 멈춤 | 준비 완료 뒤 세 번 종료 | `Java support stopped unexpectedly.` | `Restart` |

기존의 두 가지(도구 선택 필요, 프로젝트 환경 선택 필요)는 문구 형식만 이 표에 맞춘다. 자동 재연결 중에는 지금처럼 `Reconnecting…`만 보여 준다.

Java 사례는 다섯 번째 행에 해당하고, 그것을 풀면 여섯 번째 행이 된다. 두 경우 모두 사용자가 설치할 것은 없고 버튼 한 번으로 끝난다.

## 5. 적용 범위: 다른 언어에도 같은가

**같다. 여덟 가지 원인 중 일곱은 언어와 무관하고, 런타임 요구 하나만 도구별 지식이 필요하다.**

일반 파일의 언어 서버는 언어가 무엇이든 같은 세션 클래스로 실행된다(`language-manager.ts:594`). 판별에 쓰는 사실이 모두 그 공통 경로에서 나오므로 Rust, Go, PHP에도 같은 표가 그대로 맞는다.

| 구분 | 해당하는 원인 | 근거 |
| --- | --- | --- |
| 언어와 무관 | 준비 중, 내려받기 실패, 자동 설치 꺼짐, 설치 방법 없음, 지정한 실행 파일이 시작되지 않음, 원인 모를 시작 실패, 잘 되다가 멈춤 | 준비 단계의 결과, 실행 파일의 사용자 지정 여부, 준비 완료 전후 어느 쪽에서 종료했는지로 판별한다. |
| 도구별 지식 필요 | 런타임이 없거나 낮음 | 오류 문구가 도구마다 다르다. 알아보지 못한 도구는 "원인 모를 시작 실패"로 표시한다. |
| Java에만 해당 | 8절의 jdtls 실행용 Java 선택 | 실행용 런타임과 프로젝트 런타임이 갈리는 것은 jdtls의 사정이다. |

PATH 후보 충돌은 Java만의 문제가 아니다. 이 컴퓨터에서 `cmake`와 `gem`도 같은 충돌이 난다.

경로가 다른 것이 둘 있다.

- **노트북의 Python.** 같은 세션 클래스와 같은 재시도 규칙을 쓰지만(`notebook-language-host.ts:111`) 앱에 포함된 서버를 실행한다. 설치에 관한 행은 해당하지 않고, 시작 실패와 중단에 관한 행만 해당한다. 상태 문구를 별도 파일에서 만들기 때문에(`notebook-analysis-status.svelte.ts:12`) 같은 표를 그쪽에도 따로 적용해야 한다.
- **내장 검사기.** 렌더러 안에서 동작하고 설치할 것이 없다. 지금의 `Local checks limited` 흐름을 유지한다.

**한계.** 고장을 실제로 재현한 것은 Java뿐이고, 다른 언어는 코드를 읽고 내린 판단이다. 오류 출력 마지막 줄이 얼마나 쓸모 있는지는 도구마다 다를 것이며 확인하지 않았다. Python 가상환경이나 C/C++ 빌드 설정처럼 프로젝트 환경을 골라야 하는 경우는 기존의 별도 흐름을 쓰고, 이 보고서는 그 문구 형식만 맞춘다.

## 6. 화면별 적용

**도구 모음.** 상태 문구를 14종에서 다섯 가지로 줄인다: 없음, `Setting up…`, `Reconnecting…`, `Needs setup`, `Not working`. (구현에서는 일곱 가지가 됐다. 9절 참고.)

**팝업 첫 화면.** 지금은 제목, 알림 두 줄, 버튼, 행 두 개, 선택 출처, 버튼 두 개다. 제안은 아래와 같다.

```text
Java                                           ×
Java support can't start.
It is set to run /usr/lib/jvm/…/bin/java,
which is not a language tool.
[ Use automatic setup ]              Show log
──────────────────────────────────────────────
Language   Java ›                       More…
```

정상일 때는 두 줄이다.

```text
Java                                           ×
✓ Working
──────────────────────────────────────────────
Language   Java ›                       More…
```

`Project` 행, `Analysis selection: this project · java`, `Problems` 버튼은 `More…` 아래로 옮긴다. `Project` 행은 환경 선택이 필요한 원인일 때만 첫 화면에 올라온다. `Editing remains available`은 뺀다. 편집이 되는 것은 사용자가 이미 보고 있다.

**왼쪽 패널.** 저장 위치별 카드 대신 사용자의 질문 순서로 놓는다. 행의 제목은 도구 이름이 아니라 언어다.

```text
LANGUAGE SUPPORT
[✓] Set up language tools automatically

Needs attention
  Java            Can't start · Fix ›
Ready
  Bash · CSS · Docker · JSON · PHP · Python · Svelte · YAML · Zig

Search all languages…
Advanced ›
```

`Fix ›`는 팝업과 같은 문장과 버튼을 보여 준다. 지금의 세 카드(Language defaults, Custom connections, Installation management)는 `Advanced` 아래로 그대로 옮긴다. 언어 목록은 도구가 있거나 사용한 적이 있는 언어만 보여 주고 나머지는 검색으로 찾는다.

## 7. 구현으로 옮길 때 필요한 것

- **상태 이벤트에 원인 값 추가.** 지금 `status` 이벤트는 상태, 메시지, 재시도 정보만 갖는다(`protocol/language.ts`). 메인 프로세스가 이미 아는 사실은 실패 단계와 종료 코드와 오류 출력(`server-session.ts`), 실행 파일의 사용자 지정 여부(`server-registry.ts:337`), 관리 설치의 존재(`language-provisioner.ts`의 `installation`), 내려받기 금지 오류다.
- **런타임 요구는 도구별 지식이 필요하다.** 처음에는 jdtls처럼 문구가 분명한 몇 개만 알아보고, 나머지는 "원인을 모르는 시작 실패"로 오류 출력 마지막 줄을 그대로 보여 준다.
- **바뀌는 범위.** `presentSupport`와 팝업의 요약 화면, 왼쪽 패널의 첫 화면, 노트북의 상태 문구(`notebook-analysis-status.svelte.ts`)다. Details 이하 화면과 설정 저장 방식은 그대로다.
- **함께 고칠 문서와 테스트.** `docs/language-support.md`의 Current file support 절과 `document-analysis-ui.spec.ts`.

## 8. 결정이 필요한 것

| 질문 | 권장 | 이유 |
| --- | --- | --- |
| Zed 서버 이름과 같은 PATH 프로그램을 실행 파일 후보로 계속 제시할지 | 제시하지 않는다. 문구 개편보다 먼저 고친다. | `java`, `cmake`, `gem`은 언어 도구가 아니다. 안내를 고쳐도 이 후보가 남으면 같은 고장이 다시 생긴다. |
| 지정한 실행 파일이 시작되지 않을 때 자동 설정으로 조용히 되돌릴지 | 되돌리지 않고 버튼으로 제안한다. | 사용자가 직접 고른 값을 말없이 바꾸면 의도한 선택도 사라진다. |
| 쓸 수 있는 도구가 여럿일 때 물어볼지 | 묻지 않고 추천 도구로 시작한다. | 대상 사용자는 도구 이름으로 고를 근거가 없다. 지금은 `selection-needed`로 멈춘다(`language-manager.ts:509,537`). 기존 설계의 판단을 뒤집는 결정이다. |
| jdtls를 실행할 Java를 프로젝트의 Java와 따로 고를지 | 따로 고른다. 설치된 것 중 21 이상을 쓴다. | 프로젝트가 Java 17이어도 도구는 Java 25로 실행할 수 있다. 이 컴퓨터가 정확히 그 경우다. |

## 9. 구현 결과 (2026-11-18)

**1~8절의 내용을 구현했고, 8절의 네 결정은 모두 권장안대로 넣었다. 사용자의 Java 고장은 복사한 설정에서 버튼 한 번으로 풀리는 것을 실제 앱으로 확인했다.**

### 만든 것

- **원인 값.** 세션이 끝나면 메인 프로세스가 원인을 일곱 종류 중 하나로 정해 상태 이벤트에 실어 보낸다(`protocol/language.ts`의 `LanguageIssue`, `main/language/language-issue.ts`). 판별 근거는 `initialize`에 답했는지, 종료 코드, 오류 출력, 실행 파일을 사용자가 지정했는지다.
- **문장과 버튼.** `renderer/language/document-presentation.ts`의 `presentIssue`가 4절의 표다. 팝업과 왼쪽 패널이 같은 함수를 쓴다.
- **다시 시도하지 않는 원인.** 지정한 프로그램이 언어 도구가 아닌 경우와 런타임이 없거나 낮은 경우는 몇 번을 실행해도 같으므로 자동 재시도를 하지 않는다. 나머지는 지금처럼 세 번 다시 연결한다.
- **팝업.** 제목은 언어 이름이다. 문제가 있으면 문장, 버튼, 보조 동작 하나를 보여 주고, 정상이면 `✓ Working`만 보여 준다. 나머지는 `More…` 아래에 있다.
- **왼쪽 패널.** 자동 설치 스위치, `Needs attention`, `Ready`, `All languages…`, `Advanced` 순서다. 기존 세 카드는 `Advanced` 안으로 옮겼다.
- **8절의 결정.** Zed 서버 이름은 PATH에서 찾지 않는다. 지정한 실행 파일이 시작되지 않으면 버튼으로 자동 설정을 제안한다. 쓸 수 있는 도구가 여럿이면 언어가 정한 순서의 첫 도구로 시작한다. jdtls는 설치된 JDK 중 요구 버전 이상인 가장 낮은 것으로 실행하고, 프로젝트에는 원래 JDK를 기본 런타임으로 넘긴다(`main/language/tool-runtime.ts`).

### 보고서와 달라진 점

| 보고서 | 구현 | 이유 |
| --- | --- | --- |
| 상태 문구 다섯 가지 | 일곱 가지. `Limited`와 `Needs answer`가 더 있다. | 도구 하나만 멈추고 다른 도구는 동작하는 경우와, 도구가 질문을 보낸 경우는 `Not working`도 `Needs setup`도 아니다. |
| `… which is not a language tool.` | `… which did not start as a language tool.` | 앱이 아는 것은 그 프로그램이 응답 없이 끝났다는 사실까지다. |
| `Setdown can't install Java support by itself.` | `Java support isn't installed.` 아래에 `Setdown can't install it by itself.` | 다른 원인과 첫 문장 형식을 맞췄다. 이 경우 도구 모음은 조용하고, 문장은 팝업을 열었을 때만 보인다. |
| 런타임이 맞는 것이 있으면 `Use Java 25` 버튼 | 버튼 없이 자동으로 그 JDK를 쓴다. 맞는 것이 없을 때만 `How to install ↗`. | 8절의 네 번째 결정을 넣으면 사용자가 누를 것이 남지 않는다. |
| 원인을 모르는 시작 실패 | 세 번 다시 시도한 뒤 문장을 보여 준다. | 일시적인 실패일 수 있다. |
| `Ready`는 도구별 행 | 언어 이름 목록. 누르면 그 언어의 화면이 열린다. | Python을 맡는 도구가 둘이면 같은 이름의 행이 둘 생긴다. |
| 환경 선택이 항상 먼저 | 도구가 아예 시작하지 못하는 원인은 환경 선택보다 먼저 보여 준다. | 빌드 설정을 골라도 잘못 고른 프로그램은 시작하지 않는다. 실제 앱에서 C++ 파일로 확인하다가 발견했다. |
| 노트북은 상태 문구만 | 다시 연결을 멈춘 뒤에는 노트북 팝업도 원인 문장을 보여 준다. | 같은 세션을 쓰므로 같은 원인 값을 받는다. |

