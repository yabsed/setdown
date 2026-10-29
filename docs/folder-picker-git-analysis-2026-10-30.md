# 폴더 선택 시 영상 정지와 Git 오류 및 VS Code 숫자 호환성 분석

2026년 10월 30일. 대상은 Setdown 작업 디렉터리의 현재 코드와 사용자가 제시한 세 증상이다. 기준 HEAD는 `3b0b7372d73be86fb61260b3594650c915681c9a`이며, 기존 작업 중인 변경이 있는 상태에서 조사했다. 제품 코드·기존 테스트·Git 설정·서브모듈은 수정하지 않았다.

**폴더 메뉴는 웹 화면을 정지 이미지로 대체하고 실제 브라우저 뷰를 숨긴다. Git 오류는 자동 탐색에 들어온 테스트용 저장소의 심볼릭 링크 때문에 발생한다. Git 숫자는 기본 덧셈은 이미 VS Code와 비슷하지만, 집계 대상과 분류·설정까지 같지는 않다.** 두 번째 문제와 세 번째 문제는 저장소 탐색 및 집계 구조를 공유한다.

| 요청 | 판단 | 확인 수준 |
| --- | --- | --- |
| 디렉터리 선택 버튼을 누르면 YouTube가 멈춤 | 메뉴를 여는 것만으로 웹 뷰를 캡처·숨김·분리하여 영상 프레임 표시가 멈춤 | 코드 추적 및 격리된 실제 Electron에서 로컬 영상으로 재현 |
| 이 저장소를 열면 Git 오류 | `test-results/workbench-baseline`의 잘못된 서브모듈 경로가 전체 집계를 실패시킴 | 실제 저장소 명령과 현재 `GitService.status()`로 같은 오류 재현 |
| Git 숫자를 VS Code와 완전히 동일하게 | 숫자 함수 외에 저장소 선택, 상태 분류, 설정, 갱신 및 실패 처리를 함께 맞춰야 함 | 설치된 VS Code 1.143.0의 동일 커밋 소스와 비교 |

## 1 폴더 선택 메뉴가 영상 화면을 멈추는 원인

스크린샷의 최근 폴더 드롭다운은 운영체제의 폴더 선택 대화상자와 다른 경로다. [FolderPicker.svelte](../apps/desktop/src/renderer/project/FolderPicker.svelte#L13)의 버튼을 눌러 `open=true`가 되면 `<NativeOverlay />`를 생성한다. `Open Folder…` 항목을 선택한 뒤에야 [ProjectService.choose](../apps/desktop/src/main/project/project-service.ts#L61)의 `dialog.showOpenDialog()`를 호출한다. 따라서 이번 현상은 폴더를 고르거나 OS 대화상자를 띄우기 전부터 발생할 수 있다.

실행 경로는 다음과 같다.

1. [FolderPicker.svelte](../apps/desktop/src/renderer/project/FolderPicker.svelte#L50)가 `NativeOverlay`를 생성한다.
2. [NativeOverlay.svelte](../apps/desktop/src/renderer/shell/NativeOverlay.svelte)가 전역 `setdown:native-overlay-visibility` 이벤트를 보낸다.
3. [browser-runtime.ts의 cover](../apps/desktop/src/renderer/browser/browser-runtime.ts#L31)가 표시 중인 웹 탭들을 캡처한다. 캡처 이미지를 그룹 배경으로 넣고 `data-browser-frozen`을 설정한다.
4. `frozen=true`가 되면 브라우저 레이아웃을 빈 배열로 전달한다.
5. [BrowserManager.layout](../apps/desktop/src/main/browser/browser-manager.ts#L513)이 해당 창의 웹 뷰를 `setVisible(false)`로 숨기고 `removeChildView()`로 분리한다.
6. 메뉴를 닫으면 뷰를 다시 붙이고 정지 이미지를 제거한다.

폴더 메뉴는 사이드바 안에 있는데도 이 전역 경로는 표시 중인 웹 그룹 전체에 영향을 준다. 분할 화면의 다른 웹 탭까지 같은 영향을 받을 수 있는 구조다. `pause()`를 직접 호출하는 경로는 여기에는 없다.

### 실제 Electron 측정

기존 빌드와 Electron 44.7.2를 `with-isolated-display.sh`로 실행했다. Xvfb, 별도 런타임 디렉터리, 별도 D-Bus 세션을 사용했고 데스크톱의 Wayland 연결을 상속하지 않았다. 로컬 페이지에서 canvas 스트림을 재생하는 `<video>`를 만들고 실제 폴더 버튼을 눌렀다. 아래 가시성 측정은 기존 lifecycle 테스트와 같은 방식으로 Playwright의 원래 CDP 세션에서 강제 포커스 에뮬레이션을 해제한 결과다.

| 시점 | 표시 프레임 누계 | 재생 시간 | `paused` | 실제 문서 가시성 | 네이티브 뷰 연결 | 정지 배경 |
| --- | ---: | ---: | --- | --- | --- | --- |
| 메뉴 열기 전 | 8 | 0.349초 | false | visible | 연결 | 없음 |
| 메뉴 열린 후 안정화 | 9 | 0.604초 | false | hidden | 분리 | 있음 |
| 추가 1.5초 뒤 | 9 | 1.603초 | false | hidden | 분리 | 있음 |
| 메뉴 닫고 1초 뒤 | 29 | 3.449초 | false | visible | 연결 | 없음 |

**영상 프레임이 정지하는 결함은 재현됐다.** WebContents ID는 계속 4로 유지되어 페이지를 파괴하거나 다시 로드한 현상도 아니다. 다만 로컬 영상에서는 `paused=false`였고 재생 시간은 증가했다. 실제 YouTube의 일시정지 상태, 소리 중단 여부, 로그인·광고 상태에 따른 반응까지 확인한 것은 아니다. YouTube가 받는 hidden 전환과 화면 교체는 확인된 원인이며, 플레이어 자체의 추가 반응은 별도 재현 대상으로 남는다. [측정 JSON](../reports/folder-picker-git-analysis-2026-10-30/browser-result.json), [실행 로그](../reports/folder-picker-git-analysis-2026-10-30/browser-run.log), [메뉴 화면](../reports/folder-picker-git-analysis-2026-10-30/folder-menu.png).

### 수정 방향과 빠진 회귀 검증

폴더 메뉴를 여는 동작에서 브라우저를 덮는 전역 이벤트를 보내지 않도록 하는 것이 우선 검토 대상이다. 메뉴가 항상 사이드바 안에 머문다면 웹 뷰를 숨길 필요가 없다. 작은 창·줌·분할 화면에서 웹 영역과 겹칠 수 있다면 [MenuOverlay](../apps/desktop/src/main/menu/menu-overlay.ts)의 별도 네이티브 메뉴 레이어 같은 방식을 적용해야 한다. 이 클래스는 현재 File·View·Edit·Window 메뉴만 허용하므로 폴더 메뉴가 그대로 사용할 수 있는 API는 아니다.

`backgroundThrottling=false`만 적용해도 정지 이미지로 대체하는 문제는 남는다. 메뉴를 닫을 때 강제로 `play()`를 호출하는 방식은 사용자가 원래 정지해 둔 영상을 재생시킬 수 있다. 뷰를 계속 표시하면서 메뉴를 올바르게 그리는 쪽이 맞다.

현재 [browser/layout.spec.ts](../apps/desktop/test/e2e/browser/layout.spec.ts#L134)는 상단 애플리케이션 메뉴에서 영상 프레임을 검사한다. [folder-history.spec.ts](../apps/desktop/test/e2e/workspace/folder-history.spec.ts)는 최근 폴더·None·Escape 등을 검사하지만 폴더 메뉴가 열린 동안의 영상 프레임을 검사하지 않는다. 다음 검증을 연결해야 한다.

- 폴더 메뉴를 열어 둔 동안 프레임 누계와 재생 시간이 진행하고 웹 뷰가 연결·표시 상태를 유지한다.
- 메뉴 닫기·Escape·같은 폴더 재선택·다른 폴더 선택에서 재생 상태와 WebContents ID를 보존한다.
- 웹 화면이 둘인 분할 구성에서도 두 페이지를 보존한다. 원래 일시정지된 영상은 계속 일시정지 상태여야 한다.
- 메뉴 키보드 탐색, Escape 소유권, 포커스·IME, 앱 줌과 좁은 사이드바를 함께 확인한다. OS 폴더 대화상자의 열기·취소는 별도 시나리오로 확인한다.

## 2 메인 저장소를 열었을 때 Git 오류가 발생하는 원인

오류의 상대 경로만 보면 메인 저장소의 `vendor/aura-browser`가 문제처럼 보인다. 실제 조사 결과는 다음과 같다.

| 대상 | 파일시스템 상태 | 해당 저장소에서 현재 status 명령 실행 |
| --- | --- | --- |
| 메인 저장소의 `vendor/aura-browser` | 실제 디렉터리, 인덱스 모드 `160000` | 성공 |
| `test-results/workbench-baseline/vendor/aura-browser` | 메인 저장소의 디렉터리를 가리키는 심볼릭 링크, 인덱스 모드 `160000` | 스크린샷과 동일한 오류 |

문제 경로의 완전한 위치는 다음과 같다.

```text
/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/
  test-results/workbench-baseline/vendor/aura-browser
    -> /home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/vendor/aura-browser
```

Git 2.56.0은 이 기준용 저장소에서 서브모듈로 기록된 경로가 심볼릭 링크인 상태를 거부했다. 아래 읽기 명령으로 같은 메시지가 나온다.

```sh
git -C test-results/workbench-baseline --literal-pathspecs --no-optional-locks \
  status --porcelain=v2 -z --branch --ahead-behind --untracked-files=all -- .
# error: expected submodule path 'vendor/aura-browser' not to be a symbolic link
```

### 한 하위 저장소의 실패가 전체 화면을 막는 이유

[discoverRepositories](../apps/desktop/src/main/project/engines/git-repositories.ts)는 열린 폴더 아래를 깊이 제한 없이 너비 우선으로 훑으며, 최대 2,000개 디렉터리를 방문한다. `.git`, `node_modules`, `.cache` 등 일부 이름만 제외한다. `test-results`는 제외하지 않고 `.gitignore`도 탐색 필터로 사용하지 않는다. 실제로 [.gitignore](../.gitignore#L6)에 있는 `test-results/`도 탐색에 들어갔다. Git의 변경 파일 제외와 앱의 저장소 자동 발견은 서로 다른 처리다.

현재 작업 디렉터리에서 **44개 저장소가 발견됐고 `limited=true`였다.** 여기에 `test-results/workbench-baseline`, 다른 테스트 기준용 복사본, vendor 서브모듈 등이 포함됐다. 이는 탐색이 끝나 모든 저장소를 발견했다는 결과가 아니라 2,000개 디렉터리 한도에서 중단됐다는 결과다. [탐색 및 저장소별 status 결과](../reports/folder-picker-git-analysis-2026-10-30/git-discovery.json).

[GitService.status](../apps/desktop/src/main/project/git-service.ts#L129)는 선택한 저장소를 먼저 읽은 뒤 나머지 저장소도 네 개씩 `Promise.all`로 읽어 배지 합계를 만든다. 이때 저장소별 실패 처리가 없다. `workbench-baseline`에서 한 번 거부되면 이미 성공한 메인 저장소 결과도 반환하지 못한다.

현재 소스를 임시 위치에 번들링해 실제 서비스를 호출한 결과, 선택 저장소만 읽는 `status(state, false)`는 성공했고 그 시점에는 변경 리소스 90개였다. 기본 전체 집계인 `status(state)`는 동일한 서브모듈 오류로 실패했다. 90은 해당 시점의 값이며 VS Code 화면에서 측정한 숫자는 아니다. 작업 중 파일 상태에 따라 변한다. [서비스 실행 결과](../reports/folder-picker-git-analysis-2026-10-30/git-service-result.json).

[SourceControlController](../apps/desktop/src/renderer/project/source-control/source-control-controller.ts#L118)는 실패 메시지를 `gitError`와 공통 `error`에 함께 넣는다. 최초 로딩에서는 [SourceControlView](../apps/desktop/src/renderer/project/source-control/SourceControlView.svelte#L59)에 상태 조회 실패가 나오고, [ProjectSidebar](../apps/desktop/src/renderer/project/ProjectSidebar.svelte) 아래에도 오류가 표시된다. 스크린샷의 중복 오류 표시는 이 경로와 일치한다. 이전 스냅샷이 있었다면 오류와 함께 이전 숫자가 남을 수도 있다.

### 수정 방향

먼저 자동 탐색의 범위와 제외 설정을 정의해야 한다. 이 저장소에 대해서는 테스트 산출물 아래 기준용 복사본이 자동 집계에 들어오지 않게 하는 것이 맞다. 다만 `test-results`라는 이름만 하드코딩해 제외하면 다른 경로에 같은 문제가 생길 수 있고 VS Code 호환성도 완성되지 않는다. 다음 절의 탐색 정책을 함께 맞춰야 한다.

그다음 저장소별 결과를 성공·실패로 나누어 정상 저장소의 목록을 유지해야 한다. 오류에는 **실패한 저장소 루트와 실행 명령**을 포함해야 한다. 부분 합계를 표시한다면 불완전한 합계라는 상태를 함께 전달해야 하며, 실패한 저장소를 조용히 0으로 처리해서는 안 된다. 선택된 저장소 자체가 실패한 경우와 다른 저장소가 실패한 경우의 표시도 구분해야 한다.

`--ignore-submodules=all`을 전체 status에 추가하면 오류를 가릴 수 있지만 실제 서브모듈 변경을 숨기고 VS Code의 기본값과도 달라진다. 메인 저장소의 정상 서브모듈을 재설치하거나 삭제할 이유도 확인되지 않았다. 기준용 복사본을 정리하는 일과 앱이 부분 실패를 견디게 하는 일은 별개다. 이번 조사에서는 어느 경로도 변경하지 않았다.

## 3 Git 숫자를 VS Code와 같게 만드는 범위

비교 대상 숫자는 스크린샷의 **Source Control 활동 아이콘 배지**다. 커밋 ahead·behind, 변경 줄 수, 고유 파일 수와 구별한다.

설치된 VS Code는 **1.143.0**, 커밋은 `2d0b7506a36c1d6db9a466440131a8e01eab2289`다. 해당 커밋의 Microsoft 공식 소스를 온라인으로 확인했다. 로컬 `vendor/vscode`의 커밋은 `d3d31f6…`으로 다르므로 그것만으로 설치 버전과의 동등성을 단정하지 않았다. [설치 버전 및 기본 설정 기록](../reports/folder-picker-git-analysis-2026-10-30/vscode-reference.json).

### 저장소 안의 숫자와 활동 아이콘의 숫자는 별도 단계다

VS Code의 [Repository.setCountBadge](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/extensions/git/src/repository.ts#L3263)는 기본적으로 다음을 더한다.

```text
저장소 배지 = 충돌 그룹 항목 수 + staged 그룹 항목 수 + working tree 그룹 항목 수
```

| 상태 | 기본 설정에서 기여하는 수 |
| --- | ---: |
| tracked 파일 하나를 수정 | 1 |
| 파일 하나를 stage | 1 |
| 같은 파일을 stage한 뒤 다시 수정 | 2 |
| 충돌 파일 하나 | 1 |
| untracked 일반 파일 하나 | 1 |
| staged rename 하나 | 1 |
| 변경 없음 | 0, 숫자 배지를 숨김 |

현재 [gitChangeGroups](../apps/desktop/src/core/project/git-change-groups.ts#L9)는 이러한 일반 사례를 이미 구현한다. 파일 경로를 중복 제거해 세는 방식으로 바꾸면 부분 stage 파일에서 오히려 VS Code와 달라진다.

하지만 VS Code에는 설정 분기가 있다. `git.countBadge=off`는 0, `tracked`는 untracked·ignored 리소스를 제외한다. `git.untrackedChanges=separate`라면 별도 그룹으로 분류하고 `countBadge=all`일 때 그 수를 더한다. `hidden`이면 untracked 항목을 표시·집계하지 않는다. 현재 Setdown에는 이 설정 분기와 별도 untracked 그룹이 없다.

활동 아이콘의 최종 숫자는 [SCMActiveRepositoryController](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/src/vs/workbench/contrib/scm/browser/activity.ts#L60)가 계산한다.

| `scm.countBadge` | VS Code 1.143.0 |
| --- | --- |
| `all` | SCM에서 표시 대상으로 관리하는 저장소들의 `provider.count` 합계 |
| `focused` | 활성 저장소의 숫자 |
| `off` | 숫자 표시 없음 |

provider가 숫자를 제공하지 않으면 해당 provider의 리소스 개수를 사용한다. 핵심은 `all`이 디스크에서 발견한 모든 저장소를 무조건 더하는 뜻이 아니라는 점이다. 현재 Setdown은 `discovery.roots` 전체를 더하고 저장소 선택은 배지 범위를 바꾸지 않는다. 기본 사용 사례 일부는 같지만, VS Code의 표시 저장소 선택 및 `focused/off`와는 다른 모델이다.

### 저장소 탐색과 상태 읽기 차이

| 항목 | 현재 Setdown | VS Code 1.143.0 기본값 또는 구현 |
| --- | --- | --- |
| 하위 폴더 탐색 | 깊이 제한 없이 2,000개 디렉터리 한도 | `repositoryScanMaxDepth=1`, 설정 가능 |
| 탐색 제외 | 고정 이름 목록 | `repositoryScanIgnoredFolders`, `ignoredRepositories` 등 정책 |
| 서브모듈 자동 발견 | 디렉터리 순회로 발견 | `detectSubmodules=true`, `detectSubmodulesLimit=10` |
| worktree 자동 발견 | 순회 경로 안의 `.git`을 발견 | 별도 `detectWorktrees=false` 기본값 |
| 부모 저장소 | 발견하면 루트로 연결 | `openRepositoryInParentFolders=prompt` 등 정책 |
| untracked 표시 | 항상 `--untracked-files=all` | mixed·separate·hidden에 따라 처리 |
| 서브모듈 변경 무시 | 명시적인 앱 설정 분기 없음 | `ignoreSubmodules=false`, 설정에 따라 명령 변경 |
| 상태 결과 한도 | stdout 4MB, 기본 명령 제한시간 10초 | 기본 `statusLimit=10000`, 초과 상태를 별도 처리 |
| rename 유사도 | 앱의 별도 임계값 분기 없음 | `similarityThreshold`, 기본 50 |
| 최종 집계 대상 | 발견한 저장소 전체 | SCM 표시 대상 또는 활성 저장소 |

근거는 [모델의 초기 탐색](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/extensions/git/src/model.ts#L355), [Git 명령 구현](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/extensions/git/src/git.ts), 설치 패키지의 설정 기본값이다. VS Code도 모든 `.gitignore` 대상 아래 저장소를 무조건 제외하는 규칙은 아니다. 이번 기준용 저장소는 깊이 2에 있어 기본 하위 탐색과 차이가 발생하지만, 명시적 열기·열린 편집기·설정·저장된 SCM 상태에 따라 발견 집합은 달라질 수 있다.

### 기본 설정에서도 다른 구체적인 분류 사례

실제 Git 임시 저장소와 현재 Setdown 파서를 사용해 다음 차이를 확인했다. VS Code 열은 설치 버전과 같은 커밋의 파서·그룹 생성 분기에서 도출한 값이며 VS Code GUI 실측값은 아니다.

| 사례 | 현재 Setdown | VS Code 1.143.0 소스 |
| --- | ---: | ---: |
| 부모 status에 `?? nested/`로 나오는 새 중첩 Git 저장소 항목 | 부모 배지에 1 추가 | 부모 파서에서 제외하여 0 |
| 일반 파일을 심볼릭 링크로 바꾼 뒤 stage한 `T ` 항목 | staged로 분류하여 1 | index 그룹의 `x` 분기에 `T`가 없어 0 |

첫 사례에서 자식 저장소의 내부 변경은 자식 provider가 별도로 셀 수 있다. 부모의 `nested/` 항목까지 추가하는지의 차이다. VS Code [GitStatusParser](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/extensions/git/src/git.ts#L837)는 `/`로 끝나는 항목을 제외하고, 현재 [parseGitStatus](../apps/desktop/src/main/project/git-service.ts#L76)는 `? ` 레코드를 그대로 추가한다. [중첩 저장소 실험](../reports/folder-picker-git-analysis-2026-10-30/nested-result.json).

두 번째는 흔한 수정 파일의 문제가 아니라 엄밀한 동일성의 경계 사례다. VS Code는 working tree의 `y=T`는 처리하지만 해당 커밋의 staged `x=T`는 처리하지 않는다. 현재 Setdown의 모든 비공백 index 상태를 staged로 보는 규칙과 다르다. 따라서 “VS Code와 완전히 동일”를 요구하면 이런 버전별 동작도 비교 대상이 된다. [공식 그룹 생성 코드](https://github.com/microsoft/vscode/blob/2d0b7506a36c1d6db9a466440131a8e01eab2289/extensions/git/src/repository.ts#L3238), [타입 변경 실험](../reports/folder-picker-git-analysis-2026-10-30/git-service-result.json).

### 구현 시 필요한 경계

숫자만 별도로 보정하기보다, 동일한 상태 모델에서 목록과 숫자가 나오게 해야 한다.

1. **호환 기준 고정:** VS Code 1.143.0과 설정 기본값을 기준으로 삼고, 사용자·작업공간 설정을 지원할 범위를 명시한다. 버전이 바뀌면 비교 데이터를 갱신한다.
2. **저장소 모델 분리:** 발견한 저장소, 열린 저장소, SCM 표시 대상, 활성 저장소를 구분한다. 서브모듈·worktree·부모 저장소 탐색 정책도 이 단계에 둔다.
3. **리소스 분류 통일:** Git 결과를 index·working tree·merge·untracked로 변환하고, 동일 결과를 목록과 저장소별 숫자에 사용한다. 현재 porcelain v2를 유지해도 되지만 VS Code의 관찰 가능한 분류 결과와 같아야 한다.
4. **설정에 따른 집계:** 저장소별 `git.countBadge/untrackedChanges`와 활동 아이콘의 `scm.countBadge`를 별도로 적용한다.
5. **저장소별 실패와 갱신:** 정상 결과를 보존하면서 실패·오래된 결과·부분 집계 상태를 표현한다. 외부 저장·stage·commit·저장소 추가 및 제거 후 목록과 배지가 같은 스냅샷을 사용하게 한다.

이번 분석만으로 사용자의 현재 VS Code 화면 숫자가 정확히 얼마인지 정하지 않는다. 완전 일치 검증은 **같은 파일 상태, 같은 Git 실행 파일과 설정, 같은 VS Code 버전, 같은 SCM 표시 저장소 집합**에서 두 앱의 결과를 비교해야 한다.

## 4 수정 순서와 완료 판단 기준

| 순서 | 작업 | 주 담당 코드 | 완료 판단 |
| --- | --- | --- | --- |
| 1 | 폴더 메뉴가 라이브 웹 뷰를 숨기는 경로 해소 | `FolderPicker`, 필요하면 메뉴 레이어 및 `browser-runtime` | 메뉴가 열린 동안 실제 영상 프레임 진행, 뷰 연결 유지, Escape·포커스·IME 보존 |
| 2 | Git 탐색 정책 및 저장소별 실패 처리 | `git-repositories.ts`, `git-service.ts`, Git 상태 프로토콜·UI | 문제 기준용 저장소가 자동 집계를 망가뜨리지 않음. 정상 메인 저장소 목록 유지. 실패 저장소 경로 표시 |
| 3 | VS Code 설정·분류·표시 저장소 집계와 동등화 | `git-change-groups.ts`, `ProjectSidebar`, 저장소 상태 모델 | 동일 fixture와 동일 설정에서 저장소별 그룹 및 최종 배지가 기준 버전과 일치 |

Git 비교 시 일반 수정, staged, 부분 staged, 충돌 7종, rename, untracked, ignored, 중첩 저장소, 서브모듈, worktree, 타입 변경, 상태 한도 초과를 포함해야 한다. `git.countBadge`의 3값, `git.untrackedChanges`의 3값, `scm.countBadge`의 3값에 대한 분기도 확인해야 한다. 저장소 선택·그룹 접기·SCM 표시 대상 변경을 각각 구분하고, 다른 저장소 하나가 실패하는 경우도 넣어야 한다.

기존 [workspace 계약](contracts/workspace.md#text-saves-git-paths-and-external-changes)은 발견 저장소 전체의 합계를 VS Code 기본 동작으로 설명한다. 완전 호환으로 전환할 때는 표시 저장소 범위와 설정 의미를 정확하게 다시 쓰고 대응 테스트를 함께 갱신해야 한다. 폴더 메뉴에 대해서도 라이브 미디어 보존 조건을 추가해야 한다.

향후 네이티브 표시·bounds·줌·preview 경로를 변경한다면 [preview 성능 계약](preview-performance-contract.md)에 따라 `npm run test:preview-contract`와 동일한 격리 디스플레이에서 baseline/candidate 벤치마크를 수행해야 한다. 일반 Markdown과 Git review의 첫 번째·두 번째·warm 사이클, 편집 유무, 준비 시간 포함·제외를 분리해야 한다. 이번에는 제품 변경이 없어 성능 개선이나 전체 회귀 테스트 통과를 주장하지 않는다.

## 5 증거와 검증 범위

[증거 디렉터리](../reports/folder-picker-git-analysis-2026-10-30/)에는 실제 Git 발견·실행 결과, 설치된 VS Code 설정 기본값, Electron 측정 JSON·로그·스크린샷을 저장했다. Git 조사 명령은 실제 작업 디렉터리에서 읽기 전용으로 실행했고, 타입 변경 및 중첩 저장소 실험의 쓰기는 `/tmp`의 새 fixture 안에서만 수행했다. 진단 스크립트도 `/tmp`에서 작성했다.

GUI 진단의 초기 준비 단계에는 샌드박스의 D-Bus 소켓 제한, 탐색 완료 대기 누락, 접힌 Explorer 상태 때문에 측정에 도달하지 못한 실행이 있었다. 격리 실행 권한과 준비 단계를 보완한 뒤 측정했으며 이를 제품 테스트 통과로 집계하지 않았다. [준비 단계 실패 로그](../reports/folder-picker-git-analysis-2026-10-30/browser-setup-failure.log)를 보존했다. 최초 계측에서는 Playwright 포커스 에뮬레이션이 문서 가시성을 `visible`로 강제했으므로 [그 결과](../reports/folder-picker-git-analysis-2026-10-30/browser-focus-emulated-result.json)와 실제 가시성 측정을 구분했다.

확정된 범위는 폴더 메뉴의 영상 프레임 정지, 현재 서비스에서의 동일 Git 오류, VS Code 소스와의 집계 차이다. 실제 YouTube 계정에서의 재생·오디오 반응과 VS Code GUI 간 전체 비교 검증은 남아 있다.
