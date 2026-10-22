# Vim 기능 분석 재현 자료

[전체 보고서](../2026_10_23_vim_detail_features_audit.md)의 핵심 동작을 확인하는 작은 headless probe다. upstream 전체 테스트나 Setdown GUI 테스트를 대체하지 않는다.

[feature-inventory.csv](feature-inventory.csv)는 보고서의 125개 항목을 그대로 옮긴 정렬·필터용 목록이다. UTF-8 BOM을 포함하며 ID, Vim 동작, 사용자 이득, 현재 상태, 우선순위, 도입 판단을 담는다.

```sh
python3 reports/vim-feature-audit-2026-10-23/run.py
```

- Python 표준 라이브러리와 `PATH`의 `vim`을 사용한다. `vendor/vim`을 빌드하지 않는다.
- vimrc·GUI vimrc·viminfo·플러그인 자동 로드를 끄고 Ex silent mode로 실행한다. desktop 창을 만들지 않는다.
- 임시 디렉터리에만 테스트 문서·Undo 파일을 만든다. 완료·실패 후 해당 디렉터리를 정리한다.
- Python ftplugin 사례만 checkout의 파일을 명시적으로 source한다. 설치된 runtime 전체를 checkout 버전으로 바꾸지는 않는다.
- `results.json`은 실행 Vim 버전, 분석 소스 commit, Setdown HEAD, 시나리오별 assertion 수·오류·예외를 기록한다. 재실행하면 이 결과 파일을 갱신한다.
- 외부 LSP, notebook kernel, 시스템 클립보드, 한글 IME, GUI rendering은 이 probe의 실행 범위에 없다.

2026-10-23 실행: Vim 9.2 patches 1–1129, 15개 시나리오·34개 assertion 통과. 분석한 checkout은 `v9.2.1225`이므로 버전 차이를 유지해 해석해야 한다. `MacroReplay`는 준비한 register의 재생을 확인하며 대화식 `q` 기록을 검증하지 않는다.

초기 `JumpHistory`의 단독 `<C-I>`가 Ex 인수의 앞쪽 Tab 공백으로 해석된 harness 오류는 `1<C-I>`로 수정했다. 기대값이나 검사를 제거하지 않았다.
