# LSP 비전 보고서의 재현 자료

[보고서로 이동](../2026_11_08_lsp_vision_helix_vscode.md).

이 디렉터리는 제품 수정이 아니라 2026-11-08 조사 자료다. 실제 언어 서버와 실제 Setdown Electron/Jupyter 실행을 사용했다. 입력과 출력, 성공한 실행과 초기 harness 실패를 구분해 보관한다. 소스 revision, 실행 환경, 파일별 SHA-256은 [manifest.json](manifest.json)에 기록했다.

## 읽을 자료

| 파일 | 의미 |
| --- | --- |
| [literal.ipynb](literal.ipynb) | 실제 GUI probe에 사용한 것과 같은 입력 notebook. 셀 출력은 넣지 않았으며 실제 실행 결과는 screenshot과 observations에 있다 |
| [python-lsp-results.json](python-lsp-results.json) | 실제 Pyright/basedpyright 9조건의 configuration, 초기 진단, 수정 후 진단, hover, server 메시지 |
| [probe-python-lsp.cjs](probe-python-lsp.cjs) | 위 결과를 만든 stdio probe. basedpyright 조건은 native notebook protocol |
| [notebook-probe.spec.ts](notebook-probe.spec.ts) | 실제 Electron에서 notebook marker, kernel 출력, Problems를 확인한 Playwright probe |
| [playwright.config.ts](playwright.config.ts) | worker 1, retry 0. 별도 연구 probe 설정 |
| [default observations](notebook-default-artifacts/notebook-probe-real-notebo-9fb4f-nd-kernel-execution-default/observations.json) | 기본 설정에서 빈 진단과 성공한 kernel 출력 |
| [basic observations](notebook-artifacts/notebook-probe-real-notebo-4f643--and-kernel-execution-basic/observations.json) | 정확한 Literal error range, 성공한 kernel 출력, Problems 0개 및 관찰한 language events |
| [기본값 실행 화면](notebook-default-artifacts/notebook-probe-real-notebo-9fb4f-nd-kernel-execution-default/after-execution.png) | 빨간 줄 없이 `turbo`, `fast` 출력 |
| [basic 실행 화면](notebook-artifacts/notebook-probe-real-notebo-4f643--and-kernel-execution-basic/after-execution.png) | `turbo` 인자의 빨간 줄과 정상 runtime 출력이 공존 |
| [Problems 화면](notebook-artifacts/notebook-probe-real-notebo-4f643--and-kernel-execution-basic/problems-omits-notebook.png) | notebook 확인 후 정상 일반 파일을 열고 그 파일의 진단 응답까지 기다린 결과 |

GUI probe는 `language:event` 송신을 관찰하기 위해 `webContents.send`를 감싸지만, 이벤트를 변경하거나 진단을 주입하지 않는다. default/basic 모두 임시 프로젝트와 별도 app config directory를 사용한다. basic 조건에서만 임시 `pyrightconfig.json`을 만든다. 사용자 프로젝트의 설정과 notebook은 바꾸지 않는다.

Problems 관찰은 notebook에서 일반 파일로 이동한 뒤 실행했다. 동시에 활성화된 notebook과 Problems의 화면 비교는 아니다. 노트북의 별도 marker 저장소와 비활성 시 dispose 구조는 소스 분석으로 추가 확인했다.

## 성공 로그와 실패 로그

| 로그 | 결과·해석 |
| --- | --- |
| [python-probe-unrestricted.log](python-probe-unrestricted.log) | 실제 서버 9조건 실행 완료, 모든 수정 후 진단 `[]` |
| [notebook-e2e.log](notebook-e2e.log) | 최초 default/basic 2개 모두 통과, 총 7.1초. 성능 benchmark 결과가 아니라 테스트 runner 총 시간 |
| [notebook-problems-confirmation.log](notebook-problems-confirmation.log) | 정상 일반 파일의 진단 도착을 기다리도록 관찰 조건을 강화한 basic 1개 통과, 4.8초 |
| [notebook-default-final.log](notebook-default-final.log) | 최종 default screenshot 보존용 별도 실행 1개 통과, 4.0초 |
| [build.log](build.log) | typecheck 0 errors/0 warnings, renderer build 성공. 마지막 Electron build의 `spawnSync git EPERM`으로 전체 명령은 실패 |
| [build-electron.log](build-electron.log) | 허용된 실행 환경에서 같은 Electron build 단계를 별도 실행하여 성공 |
| [probe-harness-initial-failure.log](probe-harness-initial-failure.log), [python-probe.log](python-probe.log) | sandbox에서 연구 probe의 언어 서버 subprocess가 초기화하지 못한 실행 |
| [probe-harness-notebook-shape-failure.log](probe-harness-notebook-shape-failure.log) | 연구 probe의 초기 `didChange` payload에서 `change` nesting을 누락한 오류. 제품 notebook host 오류가 아님. 최종 스크립트에서 수정 |
| [notebook-harness-module-failure.log](notebook-harness-module-failure.log) | Playwright가 ESM helper를 로드하지 못하여 테스트가 실행되기 전 실패. 연구 디렉터리의 `type: module` 설정으로 수정 |

Playwright는 output directory를 실행마다 정리한다. 그래서 강화한 basic의 artifact와 최종 default의 artifact를 다른 디렉터리에 보존했다. 통과하지 못한 product assertion을 retry로 숨긴 것이 아니다. Electron 로그의 portal/DRI/PipeWire 경고도 지우지 않았다.

## 다시 실행

repository dependency가 설치되어 있고 `python3`에서 `ipykernel`을 import할 수 있어야 한다. GUI는 사용자 desktop에 표시하지 않는다. 아래 wrapper는 Xvfb, Wayland socket 제거, runtime directory 및 D-Bus 격리를 담당한다.

저장소 root에서 build와 stdio probe:

```sh
npm run build
node reports/lsp-vision-2026-11-08/probe-python-lsp.cjs
```

stdio probe는 이 디렉터리의 `python-lsp-results.json`을 새 실행 결과로 갱신한다. 원래 증거를 보존하려면 실행 전에 해당 파일을 별도로 복사한다. 원본 manifest의 hash는 다시 실행한 결과와 당연히 달라진다.

`apps/desktop` 디렉터리에서 GUI probe:

```sh
bash scripts/with-isolated-display.sh ../../node_modules/.bin/playwright test \
  --config ../../reports/lsp-vision-2026-11-08/playwright.config.ts \
  --output /tmp/setdown-lsp-vision-recheck
```

이 명령은 원본 screenshots를 덮어쓰지 않는다. `python3` 경로는 실행할 환경에 따라 달라진다. notebook fixture는 임시 폴더에 만들고 종료 시 제거한다. 프로세스 실행이 제한된 환경에서는 허용된 실행 경로를 사용해야 하며, 격리 display wrapper를 생략해서 해결해서는 안 된다.

이번 작업에서는 full product suite, preview benchmark, VS Code/Pylance GUI, PET runtime integration을 실행하지 않았다. 보고서의 단계별 완료 조건은 앞으로의 구현 검증 요구사항이며 이번 실행 결과가 아니다.
