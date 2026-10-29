# Setdown 작업 흐름 완성도 감사 보고서

현재 디자인을 유지하면서 완성도를 높이려면 **문서 상태, 파일 작업, Git 상태, 종료 수명주기를 일관되게 연결하는 일**이 우선이다. 개별 기능은 상당 부분 구현되어 있지만, 탭 전환·외부 수정·취소·부분 실패처럼 기능이 만나는 지점에서 사용자가 예상하지 못하는 결과가 나온다.

가장 먼저 처리할 문제는 **종료 취소 전에 터미널과 감시가 해제되는 경로**, **확인 없는 Git 변경 폐기**, **화면에 보이지 않는 staged 파일까지 포함하는 커밋 범위**다. 새로고침과 Finder 드롭도 필요하지만, 이 세 가지는 작업 보존과 결과의 예측 가능성에 직접 영향을 준다.

이 보고서는 구현 제안과 감사 결과다. 애플리케이션 코드, 테스트 코드, 디자인, 의존성, 서브모듈은 변경하지 않았다. LSP 기능 개선은 범위에서 제외했다.

## 1 조사 기준과 확인 수준

- 기준일: 2026년 10월 29일, 사용자 시간대 Asia/Seoul.
- 기준 커밋: `e17d0000c0a3e36f2b5dfb04413048de33ef2650`.
- 조사 범위: 파일 재로딩과 감시, Explorer·OS 파일 교환, Git 상태·diff·변경 작업, 저장·자동 저장, 종료·복구, 검색, 노트북 세션, 미디어 문서의 저장·복구 경계, 탭과 공유 문서의 수명주기.
- **코드 확인**: 실제 호출 경로에서 해당 동작을 확인했다. GUI 재현을 했다는 의미는 아니다.
- **경계 재현**: 임시 파일·임시 Git 저장소에서 해당 API 또는 Git 명령의 결과를 확인했다. 앱 전체의 종단 테스트와 구분한다.
- **검증 필요**: 경쟁 상태나 플랫폼 조건을 제어한 실행으로 영향 범위를 확정해야 한다.
- **기능 한계**: 현재 계약이나 구현이 의도적으로 지원하지 않는 범위다. 기존 버그와 구분하되, 요청한 완성도에 필요한 개선 대상으로 다룬다.

관련 기존 테스트 113개를 실행해 112개가 통과했다. 1개는 HWP FIFO 테스트 준비 단계의 `spawnSync mkfifo EPERM`으로 실패했다. 전체 통과로 처리하지 않았다. GUI 테스트와 성능 벤치마크는 이번 감사에서 실행하지 않았으며, 아래 결함이 모두 GUI에서 재현됐다고 주장하지 않는다. 운영체제 수준의 확인 실험은 6개다. 실행 명령과 결과는 [검증 기록](validation/workspace-completeness-2026-10-29/README.md)에 있다.

유한한 코드 감사로 모든 코너 케이스의 부재를 보증할 수는 없다. 아래에는 발견한 문제를 구체적으로 기록하고, 아직 확정하지 못한 부분은 별도 검증 대상으로 남겼다.

## 2 우선순위

P0는 작업 보존·변경 범위의 신뢰 문제, P1은 일상 작업을 깨뜨리는 문제, P2는 동작의 일관성과 복구 편의 문제다. P0도 이미 사용자의 데이터 손실을 관찰했다는 뜻은 아니다.

| 우선순위 | ID | 발견 사항 | 확인 수준 |
| --- | --- | --- | --- |
| P0 | X01 | 종료를 취소할 수 있는 시점에 터미널과 파일 감시를 정리한다 | 코드 확인 |
| P0 | G01 | Git Discard가 확인 없이 디스크와 열린 버퍼를 되돌린다 | 코드 확인 |
| P0 | G02 | 하위 폴더의 Git 목록과 실제 커밋 범위가 다르다 | 코드 확인·경계 재현 |
| P1 | R01 | 로컬 문서 새로고침이 없고 메뉴 Reload는 셸을 재시작한다 | 코드 확인 |
| P1 | R02 | 파일 감시가 창당 한 문서와 750ms 검사에 묶여 있다 | 코드 확인 |
| P1 | R03 | 한 창의 감시 해제가 같은 파일을 보는 다른 창에도 영향을 준다 | 코드 확인·경계 재현 |
| P1 | R04 | 외부 변경 재로딩의 중복·역순 완료를 막는 장치가 부족하다 | 검증 필요 |
| P1 | F01 | 외부 파일 드롭을 전역 처리기가 먼저 가로챈다 | 코드 확인 |
| P1 | F02 | 외부 파일 가져오기와 OS 파일 클립보드 경로가 없다 | 코드 확인·기능 한계 |
| P1 | G03 | Git Refresh가 열린 diff의 기준 내용을 갱신하지 않는다 | 코드 확인 |
| P1 | G04 | rename 항목 Unstage 후 이전 파일의 삭제가 staged로 남는다 | 코드 확인·경계 재현 |
| P1 | G05 | 충돌 파일을 일반 INDEX diff로 읽어 기준이 빈 내용이 된다 | 코드 확인·경계 재현 |
| P1 | G06 | Git 메타데이터 감시 범위가 실제 저장소 구조를 따르지 않는다 | 코드 확인, UI 영향 검증 필요 |
| P1 | X02 | 빠르게 탭을 바꾸면 자동 저장 예약이 취소된다 | 코드·기존 테스트 확인 |
| P1 | X03 | 자동 저장 실패가 사용자에게 충분히 전달되지 않는다 | 코드 확인 |
| P1 | X04 | 검색 제한·건너뛴 파일이 결과의 불완전성으로 표시되지 않는다 | 코드 확인 |
| P1 | X06 | 노트북 재로딩과 경로 변경이 커널 종료에 연결된다 | 코드 확인 |
| P1 | X07 | 복구가 텍스트·주기적 스냅샷 중심으로 제한된다 | 코드 확인·기능 한계 |
| P2 | R05 | 동일 크기·동일 mtime의 내용 변경을 구분하지 못한다 | 조건부 경계 재현 |
| P2 | F03 | 드롭과 붙여넣기의 충돌·대상 선택 정책이 다르다 | 코드 확인 |
| P2 | F04 | 파일 작업 실행 취소·진행률·취소·다른 볼륨 이동이 부족하다 | 코드 확인·기능 한계 |
| P2 | X05 | 빈 폴더 검색이 정상적인 결과 없음 대신 오류가 된다 | 코드 확인·경계 재현 |

## 3 새로고침과 외부 파일 변경

### R01 로컬 문서와 웹 페이지의 새로고침 의미가 다르다

[LocationBar.svelte](../apps/desktop/src/renderer/workspace/location/LocationBar.svelte)는 웹 탭에만 Reload 버튼을 표시한다. 로컬 문서의 재로딩은 [DocumentActions.reloadExternalChange](../apps/desktop/src/renderer/workspace/document-actions.ts#L126)에 있지만 외부 변경 안내에서만 접근한다.

더 중요한 차이는 메뉴의 `Cmd/Ctrl+R`이다. [main.ts](../apps/desktop/src/main/main.ts#L175)는 웹 페이지를 처리하지 못하면 preview를 닫고 셸의 `webContents.reload()`를 호출한다. 이는 파일 내용을 다시 읽는 명령과 다르다. [terminal-ipc.ts](../apps/desktop/src/main/terminal/terminal-ipc.ts)는 셸의 주 프레임 탐색 시 터미널 세션도 닫는다. 따라서 로컬 파일 새로고침을 이 메뉴 동작에 연결하면 터미널 등 다른 작업에 영향을 준다.

원하는 동작은 **지정한 탭의 문서만 다시 읽는 것**이다. Markdown·일반 텍스트·PDF·이미지·동영상·노트북·HWP가 같은 진입점을 사용하되, 미저장 편집과 실행 세션은 각 문서 소유자가 판단해야 한다. Untitled에는 읽을 디스크 원본이 없으므로 적용하지 않는다. 분할 화면에서는 클릭한 주소 표시줄의 탭을 대상으로 해야 한다.

dirty 문서에서 일반 새로고침을 누르면 현재 내용 유지·디스크 내용으로 교체·비교를 결정할 수 있어야 한다. 실패하면 기존 내용과 위치를 유지하고 해당 파일의 오류를 보여줘야 한다. 이미 제공하는 외부 변경 안내의 명시적인 Reload와 일반 새로고침의 충돌 처리는 구별해야 한다.

### R02 변경 감지 지연은 주기와 감시 대상의 문제다

[DocumentManager.watch](../apps/desktop/src/main/documents/document-manager.ts#L74)는 `state.currentDocument` 하나를 `watchFile(..., { interval: 750 })`로 감시한다. 750ms는 설정된 검사 주기이며 실제 지연 측정값이나 최대 지연 보장이 아니다. 이후 IPC, 읽기, 모델 교체와 렌더링 시간도 추가된다.

프로젝트에는 이미 [Parcel 기반 감시](../apps/desktop/src/main/project/engines/project-watcher.ts)가 있지만, [workspace-controller.ts](../apps/desktop/src/renderer/app/workspace-controller.ts#L436)의 `projectFilesChanged`는 Explorer·검색·Git 갱신으로만 전달된다. 열린 문서 전체를 갱신하는 입력으로 연결되어 있지 않다. 탭 활성화 때 디스크 버전을 확인하는 보완 경로는 있으나, 비활성 탭·분할 화면·프로젝트 밖의 문서를 항상 감시하는 구조는 아니다.

개선 기준은 파일별 감시와 문서별 조정이다. 네이티브 변경 이벤트를 우선 활용하고, 원자적 저장으로 파일이 교체되는 경우와 감시 실패를 처리한다. 포커스 복귀·절전 복귀 때 재확인하고, 감시 불가 환경에서는 보조 검사로 전환한다. 깨끗한 문서는 포커스를 바꾸지 않고 갱신하고, dirty 문서는 내용을 보존한 채 충돌을 표시한다. 안내 상태도 전역 `view.notice` 하나가 아닌 문서에 속해야 한다.

참고할 구조는 VS Code의 [TextFileEditorModelManager](../vendor/vscode/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L122)다. 모든 열린 모델을 확인하고 dirty 모델은 건너뛰며, 파일별 재로딩 큐에서 실행 직전에 상태를 다시 검사한다. [NodeJSWatcherLib](../vendor/vscode/src/vs/platform/files/node/watcher/nodejs/nodejsWatcherLib.ts#L409)는 원자적 저장에 따른 감시 재설정도 다룬다. 단순히 현재 750ms를 작은 수로 바꾸는 것으로는 감시 누락과 경쟁 상태가 해결되지 않는다.

### R03 다른 창의 파일 감시까지 해제하는 경로가 남아 있다

[DocumentManager.stopWatching](../apps/desktop/src/main/documents/document-manager.ts#L67)은 자신의 listener를 지정해 해제한다. 그러나 [WindowManager의 closed 처리](../apps/desktop/src/main/windows/window-manager.ts#L106)와 [BrowserManager의 웹 탭 활성화](../apps/desktop/src/main/browser/browser-manager.ts#L648)는 listener 없이 `unwatchFile(path)`를 호출한다.

동일 경로에 listener 두 개를 설치한 Node 실험에서 이 호출 후 listener 수가 **2 → 0**이 됐다. 두 창에서 같은 파일을 보고 있을 때 한 창을 닫거나 웹 탭으로 바꾸는 행동이 다른 창의 감시까지 끊을 수 있다. [기존 F01 테스트](../apps/desktop/src/main/documents/bug-audit.integration.test.ts#L57)는 안전한 `stopWatching`만 검사하므로 이 우회 경로를 잡지 못한다.

감시 생성과 해제를 한 소유자에게 모으고 창 닫기·웹 전환·종료 취소까지 같은 수명주기로 검증해야 한다. 현재 [workspace 계약](contracts/workspace.md#text-saves-git-paths-and-external-changes)의 창별 listener 소유권과도 맞지 않는 경로다.

### R04 재로딩의 완료 순서와 사용자 편집을 함께 보호해야 한다

[외부 변경 처리](../apps/desktop/src/renderer/app/workspace-controller.ts#L436)는 이벤트마다 독립적인 `reloadDocument()`를 시작한다. 활성 탭과 편집 revision 검사는 있지만, 문서별 최신 요청 번호나 실행 중 1개·대기 1개로 합치는 큐는 없다. [DocumentManager.reload](../apps/desktop/src/main/documents/document-manager.ts#L305)는 읽기뿐 아니라 main의 현재 문서 교체도 수행한다.

연속 외부 저장 A·B의 응답 순서가 뒤집히거나 읽는 동안 탭이 바뀌면, renderer가 응답을 거부하더라도 main의 문서 상태까지 같은 기준으로 보호되는지 검증해야 한다. 수동 재로딩도 삭제·권한 오류를 처리하는 공통 오류 경로가 필요하다. 이 항목은 제어된 지연 주입과 실제 Electron 재현으로 확정할 경쟁 상태다.

파일별 요청 세대, 대상 문서 identity, 요청 당시 revision, 적용 직전 dirty 재검사를 함께 사용해야 한다. VS Code의 파일별 resolve 큐가 직접적인 참고 대상이다.

### R05 디스크 버전의 비교 범위가 좁다

[sameDiskVersion](../apps/desktop/src/main/documents/file-system.ts#L12)은 `mtimeMs`와 크기만 비교한다. 임시 파일에 `old` 대신 같은 길이의 `new`를 쓰고 원래 mtime을 복원하자 이 비교는 동일 버전으로 판단했다.

일반적인 VS Code 저장이 이 조건을 항상 만든다는 뜻은 아니다. 타임스탬프를 보존하는 복원 도구·동기화 작업 등의 경계 조건이다. inode·ctime 등 메타데이터와 내용 비교를 언제 사용할지 정해야 하며, 모든 이벤트에서 큰 파일 전체를 해시하는 방식은 피해야 한다. 저장 직전 검사도 원자적인 파일시스템 비교 후 교체 연산을 보장하지 않는다는 기존 계약은 유지해야 한다.

## 4 Explorer와 OS 파일 작업

### F01 외부 드롭이 Explorer에 도착하지 않는다

[folder-drop.ts](../apps/desktop/src/renderer/project/folder-drop.ts)는 `window`의 capture 단계에서 `Files` 드롭을 받아 `stopPropagation()`을 호출하고, `files.item(0)`만 사용한다. 연결된 콜백은 [openFolderPath](../apps/desktop/src/renderer/app/workspace-controller.ts#L370)다. 파일 여러 개를 떨어뜨려도 첫 항목을 폴더 열기 대상으로 보내는 구조다.

Explorer 자체의 [dragOver와 drop](../apps/desktop/src/renderer/project/explorer/ExplorerView.svelte#L319)은 앱 내부 MIME 형식만 처리한다. 네이티브 Markdown 화면의 [preview preload](../apps/desktop/src/preview-runtime/preload.ts)에도 첫 파일을 폴더 드롭으로 보내는 경로가 있으므로 셸 한 곳만 수정해서는 모든 표면이 일관되지 않는다.

드롭 위치에 따라 의미를 정해야 한다. Explorer 폴더에는 가져오기, 파일 행에는 그 부모 폴더로 가져오기, 편집 영역에는 파일 열기, 빈 작업 공간에 놓은 폴더에는 폴더 열기가 자연스럽다. 여러 항목, 접힌 폴더, 빈 트리 영역, 드래그 취소와 네이티브 미리보기 경계를 모두 포함해야 한다.

VS Code는 [Explorer의 drop](../vendor/vscode/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L1780)에서 외부 드롭과 내부 이동을 구분하고 파일 행을 부모 폴더로 해석한다. [ExternalFileImport](../vendor/vscode/src/vs/workbench/contrib/files/browser/fileImportExport.ts#L393)는 항목 해석, 접근 가능성, 충돌, 복사, 취소, 진행 표시를 별도 책임으로 처리한다.

### F02 외부 파일 입력을 처리할 백엔드 경로도 필요하다

[ExplorerService.transferEntries](../apps/desktop/src/main/project/explorer-service.ts#L135)는 모든 source를 `mutableEntry`로 검사한다. 이는 [ProjectPaths.entry](../apps/desktop/src/main/project/project-paths.ts#L16)를 통해 열린 프로젝트 내부로 제한한다. 따라서 드롭 이벤트를 전달하는 것만으로 외부 파일 가져오기가 동작하지 않는다.

[ExplorerClipboardStore](../apps/desktop/src/main/project/explorer-clipboard.ts)는 앱 내부 nonce를 사용하며, OS 파일 관리자에서 복사한 파일 목록을 가져오는 구현은 아니다. 이 한계는 기존 계약에도 명시되어 있다. 내부 드래그도 앱 전용 MIME 위주여서 파일 관리자와의 양방향 교환은 별도 작업이다.

사용자가 실제로 드롭한 네이티브 파일 경로를 main에서 검증하는 가져오기 경로를 추가하는 것이 맞다. 기존 내부 작업의 경로 보호를 전역으로 풀어서는 안 된다. 외부 가져오기의 기본은 원본을 보존하는 복사로 제안한다. VS Code의 외부 import도 복사다. 명시적 이동을 지원한다면 원본 제거 조건과 볼륨 경계를 별도로 정의해야 한다.

### F03 같은 파일 작업인데 진입점마다 예외 처리가 다르다

[ExplorerView](../apps/desktop/src/renderer/project/explorer/ExplorerView.svelte#L57)는 붙여넣기 충돌에 Keep Both·Skip Existing을 제공한다. [드롭](../apps/desktop/src/renderer/project/explorer/ExplorerView.svelte#L337)은 같은 충돌 선택으로 이어지지 않는다. 파일 행은 디렉터리가 아니면 drop을 처리하지 않으며, 복사 modifier도 플랫폼 구분 없이 Ctrl 또는 Alt로 처리한다.

같은 source·target·작업 종류라면 드롭, 붙여넣기, 메뉴가 동일한 계획과 결과를 사용해야 한다. 기존 파일을 덮어쓰지 않는 현재의 안전한 기본값은 유지하고, 충돌 해결 후 선택·포커스·펼침 상태도 통일한다. VS Code의 [플랫폼별 modifier 처리](../vendor/vscode/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L1642)와 Dolphin의 [드롭 대상 및 결과 처리](../vendor/dolphin/src/views/dolphinview.cpp#L1527)를 참고할 수 있다.

### F04 파일 작업의 실행 취소와 장시간 작업 처리가 부족하다

[ExplorerOperationResult](../apps/desktop/src/protocol/explorer.ts)는 `undoable: false`이고, [창의 키 처리](../apps/desktop/src/main/windows/window-manager.ts#L79)는 트리에서 Ctrl/Cmd+Z를 차단한다. [moveExclusive](../apps/desktop/src/main/project/file-transfer.ts)는 다른 볼륨의 EXDEV 이동을 의도적으로 거부한다. UI는 Working on files 상태를 표시하지만 항목별 진행률과 취소 프로토콜은 없다.

이것들은 명시된 기능 한계다. 다만 파일 관리자에 가까운 사용감을 목표로 하면 이름 변경·이동·복사 후 되돌리기와 실패 복구가 필요하다. 현재의 **선행 충돌 검사, 덮어쓰기 방지, 부분 성공 receipt, 성공한 항목만 Cut 소모**는 잘 구현된 기반이므로 유지해야 한다. 실행 취소 시에도 대상이 이후 외부에서 바뀌었는지 재검사해야 한다.

Dolphin의 [파일 작업과 FileUndoManager 연결](../vendor/dolphin/src/views/dolphinview.cpp#L995), VS Code import의 `applyBulkEdit`가 참고 대상이다. 이들의 UI를 복제할 필요는 없다.

## 5 Git 작업의 정확성과 일관성

### G01 변경 폐기가 저장되지 않은 작업까지 바로 바꾼다

[SourceControlView.requestDiscard](../apps/desktop/src/renderer/project/source-control/SourceControlView.svelte#L17)는 바로 action을 호출한다. 이어지는 `discardProjectGit → ProjectController.discardGit → GitService.discard`에 별도의 확인 흐름이 없다. [GitService.discard](../apps/desktop/src/main/project/git-service.ts#L209)는 tracked 파일에 `git restore --worktree`를 실행하고 untracked 파일을 Trash로 보낸다. 성공 후 [reloadDocumentPaths](../apps/desktop/src/renderer/workspace/tab-controller.ts#L104)가 기본 `preserveChanges=false`로 호출되어 열린 버퍼도 교체한다.

Explorer의 Trash에는 dirty 문서 준비·확인 흐름이 있는데 Git Discard는 이를 공유하지 않는다. 한 번의 잘못된 클릭이 디스크 편집과 아직 저장하지 않은 편집을 함께 폐기할 수 있다. 폐기 대상·복원 기준·dirty 버퍼를 명확하게 확인하고, 작업 중 새 편집과 자동 저장이 끼어드는 경우도 보호해야 한다. 취소는 디스크·버퍼·선택에 영향을 주면 안 된다.

VS Code의 [clean 명령](../vendor/vscode/extensions/git/src/commands.ts#L2193)은 tracked와 untracked를 구별하고 폐기 확인을 거친다. 이는 버튼 추가가 아니라 기존 버튼의 정확한 실행 조건 문제다.

### G02 보이는 변경 목록과 커밋 범위가 다르다

[status](../apps/desktop/src/main/project/git-service.ts#L121)는 열린 폴더를 cwd로 `status ... -- .`를 실행한다. [commit](../apps/desktop/src/main/project/git-service.ts#L224)은 `commit -m`을 실행하므로 저장소 전체의 staged 내용을 커밋한다.

임시 저장소에서 `opened/a.md`, `sibling/b.md`를 함께 stage한 뒤 `opened`를 cwd로 현재와 같은 명령을 실행했다. 목록에는 `opened/a.md`만 나왔지만 커밋에는 두 파일이 모두 포함됐다. 앱의 GUI 재현은 아니지만 Git 명령의 범위 불일치는 확인됐다.

가장 일관된 정책은 Explorer의 열린 폴더와 별개로 Git이 실제 저장소 루트를 기준으로 전체 staged 목록을 보여주는 것이다. 폴더 범위를 유지한다면 커밋 전 그 밖의 staged 변경을 반드시 드러내야 한다. 사용자가 보지 못한 변경을 조용히 포함해서는 안 된다.

### G03 상태 목록과 열린 diff가 서로 다른 시점을 가리킨다

[ProjectController.filesChanged](../apps/desktop/src/renderer/project/project-controller.ts#L140)는 변경을 모아 Explorer와 Git status를 갱신한다. [ReviewWorkspaceController.refresh](../apps/desktop/src/renderer/project/source-control/review-workspace.ts#L52)는 status만 갱신한다. 실제 review 재로딩은 앱 내부 stage·unstage·commit 등의 별도 경로에 연결되어 있다.

외부에서 `git add`·`reset`·`checkout`을 수행하면 목록은 바뀌어도 이미 열린 diff의 INDEX 또는 HEAD가 갱신되지 않을 수 있다. 기존 diff를 다시 선택해도 [SourceControlController](../apps/desktop/src/renderer/project/source-control/source-control-controller.ts#L218)는 `tab.diff`가 있으면 재로딩하지 않는다. 현재 Refresh 버튼도 이 차이를 해소하지 못한다.

HEAD·INDEX·WORKTREE의 변경 원인을 구분해 필요한 review만 무효화해야 한다. 고정 커밋의 history diff는 계속 같은 내용을 보여야 하고, dirty working buffer를 외부 내용으로 덮어써서는 안 된다. VS Code는 [Git 디렉터리 변경을 virtual document 변경에도 전달](../vendor/vscode/extensions/git/src/repository.ts#L928)한다.

### G04 rename을 하나의 논리적 변경으로 Unstage하지 않는다

status에는 이전 경로가 저장되어 있고 staged diff도 이를 활용한다. 그러나 [unstage](../apps/desktop/src/main/project/git-service.ts#L197)는 전달받은 현재 경로만 `git reset HEAD -- <path>`에 넣는다.

`old.md → new.md`를 stage하고 새 경로만 unstage한 경계 실험 결과는 `D old.md`가 staged, `new.md`가 untracked였다. 사용자는 rename 항목 하나를 해제했는데 이전 파일 삭제가 여전히 커밋 대상이다. 이전·새 경로를 포함해 논리적 변경을 처리해야 하며 staged rename 뒤 추가 수정, 경로 충돌, 일부 선택을 함께 검증해야 한다.

### G05 충돌을 일반적인 두 버전 diff로 처리한다

[GitService.diff](../apps/desktop/src/main/project/git-service.ts#L152)는 unstaged 원본을 `:<path>`에서 읽는다. 미해결 충돌은 stage 0 대신 base·ours·theirs의 stage 1·2·3을 갖는다. 실제 충돌을 만든 실험에서도 `:<path>` 조회는 exit 1이고 stage 1·2·3만 존재했다. [readGitDocument](../apps/desktop/src/main/project/git-text.ts#L9)는 존재하지 않는 객체를 빈 문자열로 반환한다.

따라서 충돌 그룹은 존재하지만 비교 기준은 일반 INDEX처럼 읽히며 빈 내용이 될 수 있다. 충돌 상태를 명시적으로 표현하고 base·ours·theirs·현재 작업 내용을 구별해야 한다. 반드시 새로운 큰 병합 UI를 만들어야 한다는 의미는 아니다. 현재 화면에서도 비교 기준과 해결되지 않은 상태를 정확하게 보여주고 Stage의 의미를 분명히 할 수 있다.

### G06 실제 Git 디렉터리와 열린 폴더의 감시 범위가 다르다

[ProjectWatcher](../apps/desktop/src/main/project/engines/project-watcher.ts)는 열린 폴더만 감시한다. 저장소 하위 폴더를 열면 상위 `.git/index`·HEAD·refs가 범위 밖이다. linked worktree와 submodule에서는 `.git`이 외부 디렉터리를 가리키는 파일일 수 있으므로 같은 문제가 생긴다. 내용이 바뀌지 않는 외부 stage·fetch 등은 작업 폴더 이벤트만으로 감지되지 않는다.

저장소 루트·실제 gitdir·common dir을 해석해 관련 메타데이터를 따로 감시해야 한다. [VS Code DotGitWatcher](../vendor/vscode/extensions/git/src/repository.ts#L462)는 별도 gitdir과 upstream ref 감시를 관리한다. 여러 저장소를 발견하고 어느 저장소에 작업할지도 명시해야 한다. 현재 단일 `project.folder`와 `GitSnapshot`만으로 저장소 선택 기능이 완성됐다고 볼 수 없다.

### Git에서 추가 검증할 위험

아래 항목은 앞의 확인된 문제와 분리한다.

- [unstage의 포괄적인 catch](../apps/desktop/src/main/project/git-service.ts#L197)는 reset의 모든 실패를 `rm --cached`로 재시도한다. 최초 커밋 전 상태를 명시적으로 구별해야 한다. 잠금·권한·깨진 저장소 오류는 그 자체로 전달해야 한다. [VS Code revert](../vendor/vscode/extensions/git/src/git.ts#L2357)는 명령 선택 전에 저장소 상태를 확인한다.
- [GitCli.connect](../apps/desktop/src/main/project/engines/git-cli.ts#L16)는 모든 실패를 저장소 없음으로 반환하고, 실행 오류는 문자열로 평탄화한다. Git 미설치·권한·timeout을 Initialize Repository 상태와 구별해야 한다.
- [mutate와 perform](../apps/desktop/src/renderer/project/source-control/source-control-controller.ts#L781)은 status read와 달리 결과 적용에 폴더 세대 검사가 없다. 작업 도중 폴더를 바꾸거나 닫았을 때 이전 결과가 새 상태에 적용되는지 지연을 주입해 확인해야 한다.
- busy 중 mutation은 큐에 넣지 않고 반환한다. 일부 행 버튼은 busy일 때도 누를 수 있다. 사용자의 클릭을 비활성화하거나 요청 결과를 알려야 하며, 서로 다른 창의 같은 저장소 작업도 조정해야 한다.
- [remote](../apps/desktop/src/main/project/git-service.ts#L231)의 Sync는 pull 후 push다. pull 성공·push 실패, upstream 없음, 인증 실패, hook 실패, timeout을 한 종류의 실패로 보이면 실제 저장소 상태를 오해하기 쉽다. 부분 성공 후에도 상태와 diff를 재조회하고 다음 행동을 안내해야 한다.

VS Code의 Git 자동 갱신에도 debounce와 idle·focus 대기가 있다. 따라서 모든 이벤트마다 즉시 전체 status를 실행하는 것이 모범 구현의 핵심은 아니다. **필요한 변경을 놓치지 않고, 작업이 끝난 상태를 정확히 보여주는 것**이 핵심이다.

## 6 네 가지 요청 밖에서 발견한 문제

### X01 종료를 취소해도 이미 정리된 작업은 돌아오지 않는다

[main.ts](../apps/desktop/src/main/main.ts#L172)는 `before-quit`에서 `terminals.dispose()`를 호출하고, [또 다른 before-quit 처리](../apps/desktop/src/main/main.ts#L207)에서 문서·프로젝트 감시를 해제한다. 이 시점 뒤에 [WindowManager.confirmClose](../apps/desktop/src/main/windows/window-manager.ts#L124)가 dirty 문서에 대한 닫기를 막고 사용자에게 묻는다. [TerminalManager.dispose](../apps/desktop/src/main/terminal/terminal-manager.ts#L149)는 PTY까지 종료한다.

즉 Quit을 누르고 Cancel을 선택해 창이 남아도 터미널과 감시는 먼저 사라질 수 있는 순서다. 현재 브라우저 수명주기 테스트는 종료 취소 후 웹 페이지의 오디오 유지까지 검사하지만 터미널·파일 감시까지 검사하지 않는다.

종료 요청, 저장·취소 결정, 실제 종료 확정을 분리해야 한다. 되돌릴 수 없는 정리는 확정 뒤에 수행해야 한다. VS Code의 [LifecycleMainService](../vendor/vscode/src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts#L108)는 veto 가능한 `onBeforeShutdown`과 veto가 끝난 `onWillShutdown`을 구분한다. 이 경계가 앱 전체에 공통으로 적용돼야 한다.

### X02 자동 저장이 탭 전환과 충돌한다

[AutoSaveController](../apps/desktop/src/renderer/workspace/auto-save.ts#L38)는 활성 문서만 예약하고 하나의 타이머를 사용한다. 저장 실행 때도 활성 여부를 재확인한다. [TabController.activate](../apps/desktop/src/renderer/workspace/tab-controller.ts#L356)는 나가는 탭의 예약을 취소한다.

자동 저장을 켜고 A를 수정한 뒤 1초 안에 B로 이동하면 A의 저장은 실행되지 않는다. 돌아와서 새로 수정하지 않으면 새 예약이 생기는지도 별도로 보장되지 않는다. [기존 테스트](../apps/desktop/src/renderer/workspace/auto-save.test.ts)는 오히려 background 문서가 저장되지 않는 현재 정책을 통과 조건으로 삼는다. 테스트 통과와 사용자 기대가 어긋나는 사례다.

VS Code는 [문서별 자동 저장 예약 Map](../vendor/vscode/src/vs/workbench/browser/parts/editor/editorAutoSave.ts#L27)을 사용한다. Setdown도 문서별 예약을 유지하고 포커스 이동과 저장 대상의 생존 여부를 분리해야 한다. 이 정책을 바꿀 때 기존 테스트를 조용히 약화하지 말고 새로운 관찰 가능한 보장으로 교체해야 한다.

### X03 자동 저장 실패와 충돌의 설명이 부족하다

[AutoSaveController.save](../apps/desktop/src/renderer/workspace/auto-save.ts#L81)는 예외를 console에만 기록한다. 충돌 때문에 `{ canceled: true }`가 돌아오면 조용히 dirty 상태를 유지한다. 하지만 비활성 문서의 감시가 충분하지 않으면 주석이 기대하는 외부 변경 banner 자체가 나타나지 않을 수 있다.

자동 저장을 켠 사용자는 dirty 표시만으로 권한 문제·디스크 부족·외부 충돌·일시 실패를 구별하기 어렵다. 문서별 저장 실패 상태와 재시도·다른 이름으로 저장·비교 경로를 제공해야 한다. 반복 오류마다 modal을 띄우는 방식은 피한다. VS Code의 [TextFileSaveErrorHandler](../vendor/vscode/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.ts#L104)는 파일별로 오류와 복구 행동을 연결한다. Theia의 [FileResource.doWrite](../vendor/theia/packages/filesystem/src/browser/file-resource.ts#L218)는 버전 충돌을 일반 쓰기 실패와 구별한다.

### X04 검색이 일부만 조사했어도 완전한 결과처럼 보인다

[SearchService](../apps/desktop/src/main/project/search-service.ts)는 최대 결과 300개, 파일 크기 2,000,000바이트, All text의 조사 파일 수 25,000개 제한을 둔다. 읽기·디코딩·렌더링 실패 중 일부는 건너뛰거나 빈 결과로 바뀐다. 반환값은 결과 배열뿐이다.

[SearchView](../apps/desktop/src/renderer/project/search/SearchView.svelte)는 이를 단순한 결과 수로 표시한다. [SearchController](../apps/desktop/src/renderer/project/search/search-controller.ts#L64)가 편집 도구 결과에 전달하는 잘림 기준은 1,000개라서 서비스의 300개 상한과도 맞지 않는다. 사용자는 결과가 더 있거나 일부 파일을 검사하지 못했다는 사실을 알 수 없다.

검색 완료 결과에 제한 도달·건너뛴 파일·오류를 포함해야 한다. VS Code는 [검색 완료 타입](../vendor/vscode/src/vs/workbench/services/search/common/search.ts#L259)에 `limitHit`와 `messages`를 갖고 [SearchView](../vendor/vscode/src/vs/workbench/contrib/search/browser/searchView.ts#L1897)가 이를 표시한다. 현재 UI에 짧은 상태 문구를 추가하는 수준으로도 의미가 크게 달라진다.

추가로 Markdown 전용 검색의 후보는 디스크 목록만 사용하지만 All text는 열린 문서 경로도 합친다. ignore된 열린 Markdown이나 디스크에서 사라진 dirty 문서를 검색에 포함할지는 일관된 정책과 테스트가 필요하다.

### X05 빈 폴더는 검색 오류가 아니라 정상적인 빈 결과다

[RipgrepFiles.list](../apps/desktop/src/main/project/engines/ripgrep-files.ts#L13)는 `execFile` 실패를 구분하지 않는다. 빈 임시 폴더에서 현재와 같은 `rg --files --null --hidden --no-config` 실행은 stdout이 비어 있고 exit 1이었다. 이 정상적인 빈 목록을 검색 실패로 올리는 경로다.

빈 결과를 나타내는 종료 코드와 도구 실행 실패를 구별해야 한다. [text-search 테스트](../apps/desktop/src/main/project/text-search.test.ts)는 파일 목록 엔진을 주입하므로 실제 ripgrep 경계를 검사하지 않는다.

### X06 노트북 문서 교체가 실행 세션 종료를 동반한다

[notebookContent.replace](../apps/desktop/src/renderer/notebook/document-content.ts#L15)는 NotebookEntry를 dispose한다. [NotebookEntry.dispose](../apps/desktop/src/renderer/notebook/notebook-store.ts#L47)는 실행 소유자를 dispose하고, [NotebookExecution.dispose와 setPath](../apps/desktop/src/renderer/notebook/notebook-execution.ts)는 kernel shutdown을 수행한다. 경로만 바뀌어도 `setPath`가 shutdown한다.

따라서 외부 변경에 대한 재로딩 또는 노트북 이름 변경은 Python 변수와 실행 상태를 잃는 작업과 연결된다. 현재 사용자가 직접 누르는 Reset kernel에는 변수를 버린다는 설명이 있지만, 일반 파일 작업에는 같은 의미가 드러나지 않는다.

문서 내용을 디스크에서 복원하는 일, 문서 경로를 변경하는 일, 커널을 종료하는 일을 구별해야 한다. JupyterLab의 [Context._revert](../vendor/jupyterlab/packages/docregistry/src/context.ts#L678)는 기존 문서 모델을 갱신하며, [경로 변경](../vendor/jupyterlab/packages/docregistry/src/context.ts#L552)은 session의 path·name을 바꾸는 경로를 둔다. 실행 중인 셀·pending 입력·출력 도착 중 재로딩을 포함해 목표 동작을 먼저 정해야 한다.

### X07 복구 보장의 범위와 실패 상태가 충분히 드러나지 않는다

[WorkspaceSnapshots](../apps/desktop/src/renderer/app/workspace-snapshots.ts#L25)는 5초 간격으로 복구를 기록하고, `!document.kind`인 내용만 캡처한다. 이미지 편집 recipe와 HWP 미저장 내용은 이 텍스트 복구 경로에 포함되지 않는다. `pagehide`에서는 타이머를 중지하며 마지막 상태를 반드시 기록하는 종료 장벽은 여기 없다. [SnapshotStore](../apps/desktop/src/main/editor/snapshot-store.ts)에는 32MiB·100개 제한이 있다.

이것이 기존 복구 기능이 없다는 뜻은 아니다. 텍스트 복구와 원자적 스냅샷 저장은 이미 존재한다. 다만 마지막 5초 내 편집, 복구 저장 실패, 대용량 내용, 이미지·HWP의 복구 가능성이 동일하게 보장되지 않는다. 오류는 도구 메시지에 기록되지만 사용자에게 복구 불가 상태가 충분히 전달되는지도 검증해야 한다.

문서 소유자별 복구 능력을 정의하고, 정상 종료·셸 Reload·비정상 종료를 구별해야 한다. 특히 셸 Reload가 문서 새로고침을 대신해서는 안 된다. VS Code의 [WorkingCopyBackupTracker](../vendor/vscode/src/vs/workbench/services/workingCopy/electron-browser/workingCopyBackupTracker.ts#L85)는 종료 전 저장·백업·실패·veto를 함께 다룬다. 새 프로세스는 빈 작업 공간에서 시작한다는 Setdown의 현재 정책은 유지하면서도 미저장 작업 복구는 개선할 수 있다.

## 7 서브모듈에서 가져올 설계와 유지할 기반

참고 대상은 현재 체크아웃된 아래 코드다. 최신 제품 전체의 동작이나 성능을 측정한 비교는 아니다.

| 서브모듈과 커밋 | 실제 참고한 영역 | Setdown에 적용할 원칙 |
| --- | --- | --- |
| VS Code `d3d31f62` | TextFileEditorModelManager, NodeJSWatcherLib | 모든 열린 문서의 감시, 파일별 재로딩 큐, dirty 보호, 원자적 저장 처리 |
| VS Code `d3d31f62` | Explorer FileDragAndDrop, ExternalFileImport | 위치와 출처별 드롭 의미, 충돌·진행·취소를 같은 파일 작업으로 처리 |
| VS Code `d3d31f62` | Git Repository, DotGitWatcher, clean·revert | 저장소·메타데이터 감시, diff 무효화, 폐기 확인, 오류별 처리 |
| VS Code `d3d31f62` | LifecycleMainService, EditorAutoSave, WorkingCopyBackupTracker | 종료 확정 전 작업 보존, 문서별 저장 예약, 복구 완료 확인 |
| VS Code `d3d31f62` | SearchView와 검색 완료 타입 | 결과가 일부인지 사용자가 판단할 수 있는 정보 |
| Theia `71ee592e` | FileResource | 파일 감시·쓰기 버전·쓰기 잠금·충돌을 리소스 책임으로 관리 |
| Dolphin `a1f3b2f6` | DolphinView, DragAndDropHelper | 파일 작업 결과·선택·실행 취소와 OS 동작의 연결 |
| JupyterLab `5d3ae702` | 문서 Context | 문서 재로딩·경로 변경과 실행 세션 수명주기의 분리 |

Setdown에도 유지해야 할 기반이 있다. 저장 경로별 직렬화와 최종 충돌 검사, 임시 파일을 통한 저장, 파일 복사 충돌 방지와 부분 성공 receipt, 일반 편집기와 Git working tree의 공유 문서, preview의 revision·focus·IME 보호, 탭 탐색의 요청 직렬화가 그 예다. 이 부분을 통째로 교체하면 기존 보장을 잃을 위험이 크다.

개선의 중심은 기존 `DocumentStore`·`DocumentSessions`·파일 작업 receipt를 확장하고, 여러 진입점이 같은 정책을 사용하도록 연결하는 것이다. 소스 코드를 복사하기보다 **소유권, 상태 전이, 실패 후 복구**를 가져와야 한다.

## 8 구현 전에 합의할 동작 기준

### 문서 상태

각 문서는 마지막으로 받아들인 디스크 버전, 현재 버퍼 revision, 외부에서 관찰한 새 버전, 저장·읽기 작업 상태를 구별한다. clean·dirty·외부 변경·파일 없음·읽기 실패를 단일 banner나 dirty boolean에 과도하게 합치지 않는다. 문서가 여러 탭·그룹에 보여도 내용과 충돌 상태는 같은 문서를 따른다.

자동 감시와 수동 새로고침은 같은 재로딩 조정기를 통과한다. 활성 탭이라는 이유만으로 다른 문서의 읽기 결과를 적용하지 않으며, 새 응답보다 오래된 응답은 폐기한다. 저장·Git 폐기·이름 변경은 기존 자동 저장 장벽과 충돌 정책을 공유한다.

### 파일 작업

내부 이동·복사·복제·외부 가져오기·붙여넣기는 공통으로 source와 destination을 확정하고, 전체 선택의 충돌을 검사하고, 실행 결과 receipt를 반영한다. 부분 실패는 완료·실패·미실행 항목을 구별한다. 취소나 실행 취소도 이미 일어난 디스크 변경을 거짓으로 없던 일처럼 표시하지 않는다.

### Git 상태

Explorer 루트와 Git 저장소 루트를 분리한다. Git 작업은 시작 시 저장소 identity와 대상 변경을 고정하고, 진행 상태·결과·오류를 해당 저장소에 적용한다. status와 HEAD·INDEX·WORKTREE 기반 diff가 같은 시점을 가리키도록 조정한다. 고정 커밋 비교와 실시간 working tree 비교의 무효화 정책은 다르게 둔다.

### 종료와 복구

종료 요청 중에는 사용자 작업을 유지한다. 저장이나 복구를 완료할 수 있는지 확인하고, 취소 시 원래 터미널·감시·문서·실행 세션을 계속 사용한다. 실제 종료가 확정된 뒤 자원을 해제한다. 정상 종료를 취소하는 것과 새 세션을 만들어 겉모습을 복원하는 것은 같은 보장이 아니다.

## 9 개선 순서와 완료 조건

| 순서 | 작업 묶음 | 완료 조건 |
| --- | --- | --- |
| 1 | 종료 취소, Git Discard, 커밋 범위 | 취소 전후 세션이 유지되고, 보지 못한 변경이나 새 편집이 조용히 폐기·커밋되지 않는다 |
| 2 | 문서 감시·재로딩·자동 저장 | 모든 열린 문서가 외부 변경을 추적하고, 탭 전환이 저장 예약을 없애지 않는다 |
| 3 | 외부 파일 드롭과 공통 파일 작업 | Finder 등에서 여러 파일·폴더를 의도한 위치에 가져오고 충돌·취소·부분 실패를 처리한다 |
| 4 | Git diff·rename·충돌·저장소 감시 | 외부 Git 작업 후 목록·diff·비교 기준·실제 저장소가 일치한다 |
| 5 | 검색·노트북·복구의 경계 | 일부 검색 결과를 완전한 결과처럼 보이지 않고, 문서 작업이 설명 없이 실행 상태를 지우지 않는다 |
| 6 | OS·다중 창·부하 조합 검증 | 아래 조합을 실제 실행하고 남은 실패와 지원 한계를 명시한다 |

각 묶음은 현재 디자인과 버튼 배치를 유지하는 것을 기본으로 한다. 사용자가 요청한 파일 새로고침과 작업 중 필요한 안내·충돌 선택 외에 상시 버튼을 늘리는 것을 목표로 삼지 않는다. 지원하지 않는 동작은 정상적으로 비활성화하거나 이유와 가능한 다음 행동을 알려야 한다.

## 10 검증 시나리오

| 영역 | 반드시 포함할 조합 | 성공 기준 |
| --- | --- | --- |
| 파일 새로고침 | 모든 지원 문서 종류, Untitled, clean·dirty, 분할 화면, 삭제·권한 오류 | 대상 문서만 갱신하고 다른 탭·커서·스크롤·실행 세션을 보존한다 |
| 외부 변경 | 직접 쓰기, 임시 파일 rename 저장, 빠른 연속 저장, 같은 크기 변경, 삭제 후 재생성 | 최신 내용만 적용하며 dirty 내용과 IME 입력을 보존한다 |
| 감시 수명주기 | 동일 파일 두 창, 한 창 닫기, 웹·터미널 전환, 프로젝트 밖 파일, 절전·포커스 복귀 | 한 소유자의 해제가 다른 문서·창을 끊지 않는다 |
| 자동 저장 | 1초 이내 탭 전환, 분할 편집, 저장 중 추가 입력, rename, 외부 충돌, 권한·용량 실패 | 각 dirty 문서를 올바른 경로에 저장하고 실패를 설명한다 |
| 외부 드롭 | Finder, Linux 파일 관리자, Windows Explorer에서 다중 파일·폴더, 유니코드 이름 | 의도한 대상에 모두 처리하고 원본을 조용히 없애지 않는다 |
| 파일 작업 | 같은 이름, 대소문자만 변경, 심볼릭 링크, 자신 아래 이동, 다른 볼륨, 중간 실패 | 기존 내용을 보존하고 정확한 결과·선택·실행 취소 상태를 제공한다 |
| Git 폐기 | tracked·untracked·dirty buffer·동시 자동 저장·작업 중 추가 입력 | 확인 범위 밖의 변경을 버리지 않고 취소가 부작용을 남기지 않는다 |
| Git 범위 | 저장소 하위 폴더, 형제 폴더 staged 변경, nested repo, submodule, linked worktree | 표시 범위와 실행 저장소·변경 범위가 일치한다 |
| Git 비교 | 외부 add·reset·checkout·commit, staged rename, 부분 stage 후 추가 수정, 충돌 7종 | HEAD·INDEX·WORKTREE와 충돌 비교 기준이 정확하다 |
| Git 실패 | index lock, Git 미설치, 권한, hook, 인증, upstream 없음, pull 성공 후 push 실패 | 실패 원인·부분 성공을 구별하고 현재 상태를 재조정한다 |
| 종료 취소 | dirty 문서와 실행 중 터미널·노트북·웹 페이지가 함께 있는 상태에서 Quit 후 Cancel | 같은 PTY·커널·웹 페이지·감시가 계속 작동한다 |
| 복구 | 마지막 수초 편집, 강제 종료, 셸 Reload, 대용량·이미지·HWP, 저장소 가득 참 | 복구 가능한 범위와 실패를 정확히 표시하고 원본을 덮어쓰지 않는다 |
| 검색 | 빈 폴더, 300개 초과, 읽기 실패, 큰 파일, ignore된 열린 파일, 검색 중 폴더 변경 | 빈 결과·부분 결과·오류·취소를 구별한다 |
| 노트북 | idle 변수 유지, 실행 중 재로딩, 입력 대기, 이름 변경, 외부 저장 | 문서 갱신과 커널 종료 정책이 일치하고 늦은 출력이 다른 문서에 섞이지 않는다 |

변경 감지의 초기 목표값으로는 **로컬 SSD의 작은 텍스트 파일에서 외부 저장부터 dirty 안내 또는 clean 모델 갱신까지 P95 500ms 이내**를 제안한다. 이는 현재 측정값이나 VS Code의 보장값이 아니다. 감지·읽기·모델 갱신·preview 표시 시간을 나누고, OS별 충분한 반복으로 측정해야 한다. 큰 문서는 감지 지연과 렌더링 시간을 별도로 보고한다.

GUI 테스트와 벤치마크는 [AGENTS.md](../AGENTS.md)에 따라 Xvfb, 분리된 runtime 디렉터리, Wayland socket 제거, 독립 D-Bus 세션에서 실행해야 한다. Finder의 실제 네이티브 드롭은 macOS 검증도 필요하며 Linux에서 합성한 DOM 드롭만으로 성공을 선언하면 안 된다.

preview 준비·표시·전환·소스 위치·테마·관련 의존성에 영향을 주는 구현에서는 [preview 성능 계약](preview-performance-contract.md)을 적용한다. `npm run test:preview-contract`를 수행하고, 성능 경로 변경 시 독립 설치 baseline과 `npm run bench:preview -- --baseline /absolute/path/to/installed-baseline`을 같은 가상 디스플레이에서 비교한다. ordinary Markdown·Git review, 편집 유무, 준비 시간 유무의 모든 시나리오에서 첫 번째·두 번째·warm cycle을 따로 보고해야 한다. 오래된 내용 캡처, 실패, 누락을 성공한 벤치마크로 취급하지 않는다.

## 11 추가 조사 대상으로 남긴 경계

다음은 이번 감사에서 실제 결함으로 확정하지 않은 조합이다. 제품 전체의 코너 케이스를 줄이려면 각 구현 묶음의 완료 검사에 포함해야 한다.

- Save As 대화상자가 열린 동안 탭·폴더·문서 경로가 바뀌는 경우와 같은 목적지에 대한 여러 창의 저장.
- 파일을 읽거나 외부 변경을 적용하는 동안 닫기·이동·공유 문서 참조 해제가 겹치는 경우.
- 삭제 또는 권한 상실을 clean background 문서, dirty background 문서, 일반 탭과 Git review가 각각 어떻게 보존하는지.
- HWP·이미지 저장 완료 뒤 늦은 상태 이벤트, 새 편집, Save As 경로 변경이 겹치는 경우.
- 창 간 탭 이동 중 노트북 실행, 이미지 편집, HWP 편집의 소유권과 실패 시 복구 범위.
- 대규모 Explorer의 렌더링·정렬·watcher 폭주, 원격·네트워크 파일시스템의 감시 실패와 복귀.
- macOS 대소문자 비구분 파일시스템, Unicode 정규화, Windows 예약 이름·잠금, 심볼릭 링크·대상 변경.
- 파일 작업 중 취소·디스크 부족·권한 변경과 실행 취소 시점의 외부 변경.
- 키보드와 포인터 진입점의 동일성, 한글 IME 조합 중 Escape·Enter·새로고침, 보조 기술에 전달되는 작업 실패 상태.

완료 판단은 버튼의 존재나 개별 함수 테스트 개수가 아니라, **일상적인 연속 작업에서 사용자가 의도한 대상과 결과가 유지되고 실패·취소 후에도 작업을 계속할 수 있는지**에 두어야 한다.
