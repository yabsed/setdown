# 노트북 vlmflash import 밑줄 원인과 해결 방안

작성일: 2026년 10월 23일 · Setdown 소스 기준: `62e2c88` · 노트북 분석 서버: basedpyright `1.40.2`

`02_03_selector_sweep.ipynb`의 `import vlmflash` 밑줄은 **Setdown의 Python 분석기에 프로젝트의 import 검색 경로가 전달되지 않아 생기는 경고**로 재현됐다. 프로젝트의 VS Code 설정에는 `vlm-flash/src`가 등록되어 있지만, Setdown의 노트북 분석 연결은 이 설정을 읽어 전달하지 않는다. 같은 Python 환경에서도 검색 경로를 전달하면 경고가 사라지고, 사용자가 올린 VS Code 화면과 같은 모듈 설명이 반환된다.

당장 적용할 수 있는 해결책은 `final/pyrightconfig.json`에 검색 경로를 명시하는 것이다. 앱 차원의 해결책은 프로젝트 설정을 읽고, 노트북에서 사용하는 **`basedpyright.analysis.extraPaths`로 변환해 전달하는 것**이다. 이 문서는 원인과 수정안을 정리하며, 실제 프로젝트 설정이나 앱 구현을 변경하지 않았다.

## 문제가 발생하는 코드와 프로젝트 구조

대상은 [02_03_selector_sweep.ipynb](/home/yabsed/Documents/fall26/work/mathmatics/graduate-paper/vlm-in-flash/final/results/02/02_03_selector_sweep.ipynb)다. 앞선 코드 셀과 밑줄이 표시된 셀을 이어 보면 다음과 같다.

```python
UPSTREAM = Path("../../vlm-flash")

sys.path.insert(0, str((UPSTREAM / "src").resolve()))
import vlmflash
```

관련 파일은 다음 위치에 있다.

```text
vlm-in-flash/
├── .vscode/settings.json
└── final/
    ├── .git/
    ├── .vscode/settings.json
    ├── results/02/02_03_selector_sweep.ipynb
    └── vlm-flash/
        ├── pyproject.toml
        └── src/vlmflash/__init__.py
```

노트북 디렉터리를 기준으로 `../../vlm-flash/src`를 해석하면 실제로 존재하는 `final/vlm-flash/src`가 된다. 그 아래의 [vlmflash 모듈](/home/yabsed/Documents/fall26/work/mathmatics/graduate-paper/vlm-in-flash/final/vlm-flash/src/vlmflash/__init__.py)에 VS Code 스크린샷의 설명문이 들어 있다.

`sys.path.insert(...)`는 **셀을 실행하는 Python 프로세스**의 검색 경로를 바꾼다. 언어 서버는 노트북을 실행하지 않고 소스를 분석한다. 이번 재현에서도 이 문장이 포함된 전체 코드 셀을 전달했지만, 별도 분석 설정이 없으면 모듈을 찾지 못했다. 따라서 셀 실행용 경로와 분석용 경로를 함께 맞춰야 한다. Pyright의 import 탐색에는 프로젝트 루트, `extraPaths`, 선택된 Python 환경 등이 사용된다. [Pyright import 탐색 규칙](https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md)

## VS Code와 Setdown의 설정 차이

실제 [final의 VS Code 설정](/home/yabsed/Documents/fall26/work/mathmatics/graduate-paper/vlm-in-flash/final/.vscode/settings.json)은 다음과 같다.

```json
{
  "python.analysis.extraPaths": [
    "./vlm-flash/scripts",
    "./vlm-flash/src"
  ]
}
```

이 설정은 `final`을 워크스페이스로 열었을 때 `vlmflash`를 찾는 데 필요한 경로를 제공한다. 사용자의 VS Code 화면은 해당 모듈 설명이 실제로 해석되고 있음을 보여준다. VS Code의 활성 워크스페이스와 인터프리터를 직접 조회한 것은 아니므로, 그 화면이 반드시 이 설정 하나만으로 만들어졌다고 단정하지는 않는다.

상위 `vlm-in-flash/.vscode/settings.json`에도 별도 `extraPaths`가 있지만, 그 값은 `conclusion/upstream/...`를 가리킨다. 현재 노트북의 분석 루트는 가장 가까운 `.git` 경계인 `final`이다. 상위 프로젝트의 경로를 무조건 합치는 방식은 이 사례의 해결책으로 삼지 않는다.

Setdown의 관련 동작은 다음과 같다.

| 항목 | 확인한 동작 | 이번 문제에 미치는 영향 |
| --- | --- | --- |
| 분석 서버 | 노트북은 내장 basedpyright `1.40.2` 사용 | 일반 Python 파일용 Pyright 설정과 구분해야 함 |
| Python 선택 | 이 노트북에 저장된 경로는 `/home/yabsed/miniconda3/bin/python3` | 이 경로를 그대로 사용해도 경고를 재현함 |
| 분석 루트 | `final`, 선택 이유는 `Repository boundary (.git)` | `final/vlm-flash/src`를 별도 검색 경로로 전달해야 함 |
| 기본 분석 설정 | `autoSearchPaths: true`, `typeCheckingMode: off`, 기본 경고 네 가지 유지 | 이 중첩 소스 경로는 자동 탐색만으로 해결되지 않음 |
| 프로젝트 설정 전달 | 노트북 연결에 `.vscode/settings.json`을 읽어 합치는 경로가 없음 | VS Code에 등록된 `extraPaths`가 분석 서버에 도달하지 않음 |
| 밑줄 표시 | 서버 진단을 셀 모델의 Monaco marker로 변환 | 해결 지점은 분석 환경 설정 전달부 |

구현 근거: [노트북 언어 서버 연결](../apps/desktop/src/main/language/notebook-language-host.ts), [분석 기본값](../apps/desktop/src/main/language/python-analysis.ts), [프로젝트 루트 선택](../apps/desktop/src/main/language/language-root.ts), [Python 환경 선택과 저장](../apps/desktop/src/main/notebook/python-environments.ts), [셀 진단 표시](../apps/desktop/src/renderer/notebook/notebook-language.ts).

여기에 설정 이름 차이가 하나 더 있다. basedpyright는 `python.pythonPath` 등 일부 항목을 제외하면 `python.*` 분석 설정을 사용하지 않는다. VS Code의 `python.analysis.extraPaths`를 읽는 것에 더해 **`basedpyright.analysis.extraPaths`로 대응시켜야 한다.** [basedpyright 1.40.2 언어 서버 설정](https://docs.basedpyright.com/v1.40.2/configuration/language-server-settings/)

## 같은 노트북으로 확인한 재현 결과

원본 노트북의 전체 Python 코드 셀, 저장된 Python 경로, 앱의 `ServerSession`·노트북 capabilities·분석 기본값을 사용했다. `notebookDocument/didOpen`으로 셀을 동기화했으며, 셀 실행이나 커널 시작은 하지 않았다. GUI가 없는 언어 서버 재현이므로 현재 열린 창의 marker를 직접 수집한 결과와는 구분한다.

현재 설정에서 해당 import에 반환된 진단은 다음과 같다.

```text
source: basedpyright
code: reportMissingImports
severity: 2 (Warning)
message: Import "vlmflash" could not be resolved
range: 셀의 2행, vlmflash 식별자
```

| 조건 | vlmflash 경고 | 모듈 설명 hover | 정의 위치 이동 | 실제로 없는 모듈 경고 |
| --- | --- | --- | --- | --- |
| 현재 Setdown 설정 | 발생 | 없음 | 결과 없음 | 유지 |
| `python.analysis.extraPaths`만 추가 | 발생 | 없음 | 결과 없음 | 유지 |
| `basedpyright.analysis.extraPaths` 추가 | 없음 | VS Code 화면과 같은 설명 | `vlmflash/__init__.py` | 유지 |
| 아래의 `pyrightconfig.json` 적용 | 없음 | 같은 설명 | `vlmflash/__init__.py` | 유지 |

프로젝트 설정 사례는 `/tmp`에 같은 디렉터리 구조와 원본 소스를 가리키는 링크를 만들어 검사했다. 원본 프로젝트에는 설정을 쓰지 않았다. 모든 조건에서 의도적으로 존재하지 않는 모듈을 메모리상의 추가 셀에 넣어, import 검사가 계속 작동하는지도 확인했다. 원본 노트북의 SHA-256은 검사 전후 동일하다.

재현 자료: [검증 스크립트](notebook-import-resolution-2026-10-23/probe.cjs), [진단과 hover 및 서버 로그](notebook-import-resolution-2026-10-23/results.json).

저장소 루트에서 다음 명령으로 재현할 수 있다. Node 하위 프로세스 실행이 필요하며, GUI/Electron은 시작하지 않는다.

```sh
node reports/notebook-import-resolution-2026-10-23/probe.cjs \
  /home/yabsed/Documents/fall26/work/mathmatics/graduate-paper/vlm-in-flash/final/results/02/02_03_selector_sweep.ipynb \
  /home/yabsed/miniconda3/bin/python3
```

## 현재 앱에서 적용할 수 있는 해결책

`/home/yabsed/Documents/fall26/work/mathmatics/graduate-paper/vlm-in-flash/final/pyrightconfig.json`에 다음 설정을 둔다. 검색 경로와 함께 현재 Setdown의 가벼운 진단 정책을 유지하도록 작성한 예시이며, 위 재현에서 검증한 내용이다.

```json
{
  "extraPaths": ["./vlm-flash/src"],
  "typeCheckingMode": "off",
  "reportMissingImports": "warning",
  "reportMissingModuleSource": "warning",
  "reportInvalidTypeForm": "warning",
  "reportUndefinedVariable": "warning"
}
```

상대 경로는 이 설정 파일이 있는 `final` 기준이다. `final/vlm-flash/pyproject.toml`은 노트북 디렉터리의 상위 설정 파일이 아니므로, 거기에만 설정을 추가하는 방법과 혼동하지 않아야 한다. 기존 `pyrightconfig.json`이 생겼다면 기존 설정에 필요한 경로를 합친다. 프로젝트 설정은 언어 서버의 일부 설정보다 우선하므로, 이미 사용 중인 검사 정책을 덮어쓰지 않도록 한다. [basedpyright 프로젝트 설정과 우선순위](https://docs.basedpyright.com/latest/configuration/config-files/)

설정 후 Language Support의 언어 서버 재시작 기능으로 다시 분석하고, `import vlmflash`의 경고 소멸과 hover·정의 이동을 확인한다. 이 설정은 정적 분석용이므로 커널 실행 시의 `sys.path`를 변경하지 않는다.

패키지를 선택한 Python 환경에 설치하는 것도 별도의 해결 방향이지만, 이번 문제에는 분석 경로만 지정해도 충분하다. 특히 이 프로젝트의 패키지 의존성에는 Torch 등이 포함되므로, 밑줄 제거를 위해 환경 전체의 설치 상태를 바꾸는 작업은 우선하지 않는다.

다음 조치만으로는 이번 원인이 해결되지 않는다.

- 현재 설정 그대로 언어 서버만 재시작하기: 필요한 검색 경로가 계속 빠져 있다.
- 일반 Python 파일용 Pyright 설정만 수정하기: 노트북은 별도 `NotebookLanguageHost` 연결을 사용한다.
- `reportMissingImports` 끄기: 모듈 설명과 정의 탐색이 복원되지 않고, 실제 누락 import도 놓친다.

## Setdown에서 구현할 수정안

### 프로젝트의 분석 경로를 노트북 연결에 전달

`NotebookLanguageHost.open()`이 분석 설정을 만들기 전에 프로젝트별 Python 설정을 해석하도록 한다. 새 `python-project-settings.ts` 같은 모듈에서 설정 출처와 정규화된 경로를 반환하고, 일반 Python 문서와 노트북이 같은 프로젝트 해석 규칙을 사용하게 하는 구성이 적절하다.

처음 구현할 범위는 `extraPaths` 호환으로 제한한다. 프로젝트 루트의 `.vscode/settings.json`을 JSONC로 읽어 `python.analysis.extraPaths`를 인식하고, 상대 경로를 해당 워크스페이스 기준 절대 경로로 정규화한다. `${workspaceFolder}`는 그 설정이 속한 워크스페이스를 기준으로 해석한다. 현재 사례에서는 `final`이며, `.git` 경계 밖 상위 설정을 자동으로 섞지 않는다.

basedpyright 전용 `extraPaths`도 설정되어 있으면 그것을 우선하고, 없을 때 VS Code의 Python 설정을 호환 입력으로 사용한다. 경로 순서는 보존한다. `pyrightconfig.json`이나 `pyproject.toml`의 분석 설정이 있는 경우에는 서버의 프로젝트 설정 우선순위를 유지하며, 특히 `executionEnvironments`별 경로를 클라이언트가 하나로 합치지 않는다.

최종적으로 노트북 서버에 전달할 설정의 핵심은 다음과 같다.

```ts
{
  python: { pythonPath: environment.python },
  basedpyright: {
    analysis: {
      ...notebookPythonAnalysis,
      extraPaths: resolvedExtraPaths,
    },
  },
}
```

이 코드의 `resolvedExtraPaths`는 위 규칙으로 계산하는 제안 값이다. 일반 Pyright 서버에는 해당 서버가 사용하는 `python.analysis.extraPaths`로 전달한다. 서버마다 지원하는 설정 이름을 연결부에서 명시적으로 구분한다.

### 설정 변경과 표시를 같은 세션에 연결

설정 파일이 바뀌면 클라이언트가 읽은 `extraPaths`도 다시 계산해야 한다. 현재 파일 감시가 서버에 JSON 파일 변경을 알리는 것만으로는, 클라이언트가 제공해야 하는 VS Code 설정 값이 갱신되지 않는다. 변경된 구성은 `workspace/didChangeConfiguration` 또는 필요한 경우 세션 재연결로 반영한다.

언어 지원 상세에는 Python 실행 파일, 분석 루트, 적용한 검색 경로와 설정 출처를 보여준다. 탭·프로젝트·Python 환경이 바뀌면 해당 소유자의 분석 구성과 진단만 갱신하고, 기존 셀 버전·세션 검증은 유지한다. 이 문제를 해결하기 위해 노트북 셀을 자동 실행하거나 `sys.path.insert` 식을 평가할 필요는 없다.

### 구현 완료를 판단할 검사

| 검사 | 통과 조건 |
| --- | --- |
| VS Code 설정 호환 | 중첩 `vlm-flash/src`를 찾고 경고 소멸, hover·정의 이동 성공 |
| 설정 이름 변환 | `python.analysis.extraPaths` 호환 입력이 basedpyright 설정으로 전달됨 |
| 프로젝트 설정 우선순위 | 명시적 config와 `executionEnvironments`의 의미를 보존 |
| 경로와 범위 | JSONC, 상대 경로, `${workspaceFolder}`, 중첩 Git 경계, 다른 탭의 설정 분리를 검증 |
| 설정 변경 | 경로 추가 시 해결되고 제거 시 경고가 다시 나타나며 이전 결과가 남지 않음 |
| 실제 오류 보존 | 없는 모듈과 정의되지 않은 변수의 경고가 계속 표시됨 |
| 노트북 상호작용 | 원본 셀·출력·Undo 보존, 커널 자동 실행 없음, 한국어 IME·포커스 유지 |

이번 문서의 네 가지 검증은 실제 언어 서버 수준의 원인 확인이다. 앱 수정 후에는 설정 해석 단위 검사와 실제 Electron 노트북 검사를 추가해야 한다. GUI 검사는 [저장소 지침](../AGENTS.md)에 따라 격리된 Xvfb·런타임 디렉터리·D-Bus 세션에서 실행한다. [노트북 계약](../docs/contracts/notebook.md)을 유지하고, 구현이 [preview 성능 계약](../docs/preview-performance-contract.md)의 대상 경로에 들어가면 `npm run test:preview-contract`와 해당 성능 경로 변경에 필요한 baseline 비교도 수행한다.
