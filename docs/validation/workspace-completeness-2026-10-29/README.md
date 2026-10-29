# 작업 흐름 완성도 감사 검증 기록

2026년 10월 29일 [감사 보고서](../../workspace-completeness-audit-2026-10-29.md)의 근거다. 기준 커밋은 `e17d0000c0a3e36f2b5dfb04413048de33ef2650`이다. 제품 코드와 테스트는 수정하지 않았고, 기존 테스트 실행과 임시 파일·임시 Git 저장소를 사용한 경계 실험만 수행했다.

## 기존 테스트 결과

| 실행 | 테스트 파일 | 테스트 수 | 결과 | 로그 |
| --- | --- | --- | --- | --- |
| 파일·Git·감시·Explorer | 8 | 72 | 71 통과, 1 실패 | [core-unit.log](core-unit.log) |
| 자동 저장·터미널·노트북·검색·문서·탐색·스냅샷 | 7 | 41 | 41 통과 | [additional-unit.log](additional-unit.log) |
| 합계 | 15 | 113 | 112 통과, 1 실패 | 위 두 로그 |

실패는 `src/main/documents/bug-audit.integration.test.ts`의 `F21 a non-regular HWP file must fail before waiting for a FIFO writer`다. 테스트 준비 단계의 `execFileSync('mkfifo', ...)`에서 `spawnSync mkfifo EPERM`이 발생했다. 따라서 HWP 구현의 assertion까지 도달하지 못했고, 이 테스트의 보장은 이번 실행으로 검증되지 않았다. 테스트를 삭제하거나 건너뛰거나 assertion을 수정하지 않았으며, 통과할 때까지 재실행하지 않았다.

저장소 루트에서 실행한 명령은 다음과 같다.

```sh
npm test --workspace @setdown/desktop -- \
  src/main/project/git-service.test.ts \
  src/main/project/file-transfer.test.ts \
  src/main/project/explorer-service.test.ts \
  src/main/project/engines/project-watcher.test.ts \
  src/main/documents/bug-audit.integration.test.ts \
  src/renderer/project/source-control/git-status-refresh.test.ts \
  src/renderer/project/source-control/git-review-freshness.test.ts \
  src/renderer/project/explorer/explorer-controller.test.ts
```

```sh
npm test --workspace @setdown/desktop -- \
  src/main/terminal/terminal-manager.test.ts \
  src/renderer/notebook/notebook-execution.test.ts \
  src/renderer/workspace/auto-save.test.ts \
  src/renderer/workspace/document-sessions.test.ts \
  src/main/project/text-search.test.ts \
  src/main/editor/editor-tools.test.ts \
  src/core/workspace/tab-navigation.test.ts
```

로그의 실행 시각은 실행 환경이 출력한 원문이다. GUI 창은 실행하지 않았다. 빌드·전체 테스트·preview 계약·성능 비교·Finder의 실제 드롭은 이 실행 결과에 포함되지 않는다.

## 경계 실험 결과

원시 결과는 [boundary-probes.json](boundary-probes.json)에 있다. Node와 Git의 동작을 확인한 실험이며 Setdown GUI 종단 테스트가 아니다. 파일과 저장소는 `/tmp` 아래에서 만들고 실험 후 정리했다. 실제 프로젝트에 stage·commit·reset·merge를 수행하지 않았다.

| 실험 | 절차 | 관찰 결과 | 보고서 연결 |
| --- | --- | --- | --- |
| 감시 소유권 | 한 파일에 `watchFile` listener 두 개를 설치하고 listener 인자 없이 `unwatchFile(path)` 실행 | listener 수 2에서 0으로 감소 | R03 |
| 디스크 버전 비교 | `old`를 `new`로 바꾸고 같은 mtime을 재설정 | 내용은 다르지만 크기와 mtime이 같음 | R05 |
| 하위 폴더 커밋 범위 | 두 형제 폴더의 파일을 함께 stage하고 한 하위 폴더에서 status와 commit 실행 | status에는 한 파일, commit에는 두 파일 | G02 |
| rename Unstage | `git mv old.md new.md` 뒤 `git reset -q HEAD -- new.md` 실행 | old.md 삭제가 staged, new.md는 untracked | G04 |
| 충돌 index | 두 브랜치에서 같은 줄을 다르게 수정해 merge conflict 생성 | stage 1·2·3은 존재하고 `:old.md` 조회는 exit 1 | G05 |
| 빈 디렉터리 검색 | 포함된 ripgrep 바이너리로 빈 폴더에서 파일 목록 조회 | stdout은 비어 있고 exit 1 | X05 |

커밋 범위 실험에서 사용한 핵심 명령은 서비스의 경로 범위와 같다.

```sh
git --literal-pathspecs --no-optional-locks status \
  --porcelain=v2 -z --branch --ahead-behind --untracked-files=all -- .
git --literal-pathspecs commit -m 'audit commit'
```

두 명령의 cwd는 저장소의 `opened` 하위 폴더다. 다른 `sibling` 폴더에도 이미 staged 변경이 있다. 최종 커밋 파일은 저장소 루트에서 `git diff-tree --no-commit-id --name-only -r HEAD`로 확인했다.

충돌 실험은 `git ls-files -u`와 `git rev-parse --verify --quiet :old.md`를 비교했다. 빈 폴더 실험은 `@vscode/ripgrep`이 제공하는 바이너리로 `--files --null --hidden --no-config`를 실행했다.

첫 경계 실험 시도에서는 동기 subprocess 실행의 `spawnSync git EPERM`이 발생했다. 이후 일반 비동기 `execFile`을 사용해 Git 실험을 수행했다. 이 변경은 제품·테스트 코드 수정이나 테스트 실패의 재시도가 아니다.

## 테스트가 아직 보장하지 않는 부분

- 창별 watcher 테스트는 `DocumentManager.stopWatching`을 통과하지만, 창 닫기와 웹 활성화의 직접 `unwatchFile(path)` 호출까지 검사하지 않는다.
- Git status refresh 테스트의 성공은 외부 Git 작업 이후 이미 열린 diff까지 최신이라는 보장이 아니다.
- Git review freshness 테스트는 preview revision의 최신성을 검사한다. 저장소의 INDEX·HEAD 변경이 review로 전달되는지와는 다른 경계다.
- 자동 저장 테스트는 비활성 문서를 저장하지 않는 현재 정책을 의도적으로 통과시킨다. 사용자 기대에 맞게 정책을 바꾸면 계약과 테스트도 함께 바꿔야 한다.
- 검색 테스트는 파일 목록 엔진을 주입하므로 빈 폴더에서 실제 ripgrep의 exit 1 처리를 검증하지 않는다.
- 현재 종료 취소 E2E는 웹 페이지 보존을 검사하지만 터미널·문서 감시·프로젝트 감시·노트북 커널의 동시 보존을 입증하지 않는다. 이번 감사에서 그 E2E를 재실행하지도 않았다.

## 구현 후 검증 원칙

새로운 테스트는 보고서의 실제 사용자 시나리오를 검사해야 한다. 구현 문자열을 그대로 비교하거나 실패를 재시도로 가리지 않는다. preview 관련 변경은 [성능 계약](../../preview-performance-contract.md)에 따른 전체 focused gate와 필요한 baseline 비교를 통과해야 한다. GUI 실행은 격리된 가상 디스플레이에서만 수행한다.
