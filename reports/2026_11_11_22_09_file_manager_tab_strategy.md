# 파일 관리자를 다섯 번째 탭으로

## 폴더 하나를 고르려고 Setdown을 떠나는 일은 이제 끝낼 수 있다. 엔진은 대부분 이미 있다. 빠진 것은 화면 하나와 관문 하나다

작성일: 2026년 11월 11일 · 기준 커밋 `46a9698` · 제품 코드는 바꾸지 않았다. 참고용 서브모듈 다섯 개를 추가하고 Dolphin을 얕은 서브모듈로 설정했다.

Setdown은 Markdown 뷰어, 브라우저, 텍스트 편집기, 터미널을 차례로 대체했다. 그런데도 사용자는 하루에 몇 번씩 GNOME Files를 만난다. 폴더를 열 때, 다른 이름으로 저장할 때, 웹에서 파일을 내려받을 때, 언어 서버 실행 파일을 고를 때다. 우연이 아니다. GNOME 47부터는 시스템의 파일 선택 창 자체가 GNOME Files(Nautilus)다. Setdown이 Electron의 `dialog.showOpenDialog`를 부르면 Chromium은 xdg-desktop-portal에 요청을 보내고, GNOME의 portal은 그 요청을 Nautilus에 넘긴다. Setdown의 main 프로세스에는 이런 호출이 20곳 있다.

해법은 두 겹이다. 먼저 파일 관리자를 문서·웹·터미널 옆의 탭 종류로 만든다. 그다음 같은 탭을 **고르기 모드**로 열어 20곳의 대화상자를 대신한다. 사용자의 불편을 직접 없애는 것은 두 번째이고, 첫 번째는 그 바탕이다. 둘을 따로 만들 이유는 없다. 서로 관계없는 두 파일 관리자, GNOME의 Nautilus와 System76의 COSMIC Files가 같은 결론에 이르렀다. 파일 선택 창은 별도 프로그램이 아니라 **평소의 탭에 모드 값 하나를 더한 것**이다.

직접 짤 코드는 생각보다 적다. 이 프로젝트의 원칙은 남이 이미 푼 문제를 다시 풀지 않는 것이고, 이번에는 그 원칙을 지키기 쉽다.

- **이미 Setdown 안에 있는 것.** 복사·잘라내기·붙여넣기, 이름 충돌, 실행 취소, 휴지통, 다른 파일 관리자와 주고받는 클립보드는 사이드바 탐색기에 있다. 탭 이동, 뒤로·앞으로, 분할, 창 사이 이동, 탭별 줌도 있다.
- **이미 남이 써 둔 것.** 고르기 규칙은 Nautilus의 portal 코드에 있다. 경로를 타이핑하는 규칙은 VS Code의 SimpleFileDialog에 테스트와 함께 있고, 라이선스는 MIT다. 장소 목록·휴지통·썸네일·“다른 앱으로 열기”는 freedesktop 표준 파일과 `gio` 명령이 이미 처리한다.

새로 만들 것은 **폴더를 보여주는 화면 하나**와 **대화상자 호출이 모두 지나가는 관문 하나**다.

| 단계 | 사용자가 얻는 것 | 주로 가져오는 곳 |
| --- | --- | --- |
| 1 파일 관리자 탭 | 새 탭 버튼 옆의 폴더 탭. 주소창에 폴더 경로를 입력하면 그 폴더가 열림 | 기존 Explorer 엔진, `TabNavigation`, `virtua` |
| 2 고르기 모드 | Open Folder·Save As·내보내기·다운로드에서 GNOME Files가 사라짐 | Nautilus 모드 규칙, VS Code SimpleFileDialog, Zed 경로 프롬프트 |
| 3 장소와 표준 | 북마크·사용자 폴더·드라이브·휴지통·썸네일·연결 프로그램 | GTK 북마크 파일, `findmnt`, `gio`, 썸네일 표준 |
| 4 (선택) 시스템 전체 | 다른 앱의 파일 선택 창과 “폴더에서 보기”도 Setdown이 처리 | portal backend 규격, `FileManager1`, `inode/directory` |

## 1 GNOME Files는 어떤 경로로 뜨는가

폴더 메뉴의 `Open Folder…`를 누르면 main 프로세스는 Electron의 대화상자를 바로 부른다. 다른 19곳도 같다.

```ts
// apps/desktop/src/main/project/project-service.ts:61-66
async choose(state: WindowState): Promise<ProjectFolder | null> {
  const request = this.beginFolderRequest(state);
  const selected = await dialog.showOpenDialog(state.window, { title: 'Open Folder', properties: ['openDirectory'] });
  if (selected.canceled || !selected.filePaths[0] || this.folderRequests.get(state) !== request) return null;
  return this.openFolder(state, selected.filePaths[0], request);
}
```

Electron 44는 Linux에서 Chromium의 대화상자 코드를 그대로 쓴다. Chromium 152는 xdg-desktop-portal의 FileChooser를 먼저 시도한다. portal 버전이 3보다 낮을 때만 GTK 대화상자로 물러난다. 이 기계의 portal 버전은 4다. `/usr/share/xdg-desktop-portal/gnome-portals.conf`는 요청을 GNOME backend로 보내고, xdg-desktop-portal-gnome은 47 버전부터 FileChooser 호출을 `org.gnome.Nautilus`에 넘긴다. Nautilus 쪽에서는 portal 메서드 이름과 옵션이 곧 창의 모드가 된다.

```c
/* vendor/nautilus/src/nautilus-portal.c:444-457 */
NautilusMode mode = NAUTILUS_MODE_BROWSE;
if (strcmp (method_name, "OpenFile") == 0)
{
    (void) g_variant_lookup (arg_options, "multiple", "b", &open_multiple);
    (void) g_variant_lookup (arg_options, "directory", "b", &open_directory);
    mode = (open_directory ? (open_multiple ? NAUTILUS_MODE_OPEN_FOLDERS
                                            : NAUTILUS_MODE_OPEN_FOLDER)
                           : (open_multiple ? NAUTILUS_MODE_OPEN_FILES
                                            : NAUTILUS_MODE_OPEN_FILE));
}
else if (strcmp (method_name, "SaveFile") == 0)
    mode = NAUTILUS_MODE_SAVE_FILE;
```

호출하는 곳은 기능마다 흩어져 있고, 공통 관문이 없다.

| 묶음 | 호출 위치 | 개수 |
| --- | --- | ---: |
| 프로젝트·문서 | Open Folder [project-service.ts:63](../apps/desktop/src/main/project/project-service.ts#L63), 문서 열기·링크 대상 [document-manager.ts:144, 351](../apps/desktop/src/main/documents/document-manager.ts#L144), 첫 저장·Save As [document-manager.ts:219, 297](../apps/desktop/src/main/documents/document-manager.ts#L219) | 5 |
| 내보내기 | PDF [pdf-exporter.ts:54](../apps/desktop/src/main/preview/pdf-exporter.ts#L54), 이미지 [image-edit-ipc.ts:77](../apps/desktop/src/main/documents/image-edit-ipc.ts#L77), 리더 [reader-exporter.ts:13](../apps/desktop/src/main/browser/reader-exporter.ts#L13), 노트북 세 곳 [notebook-tools.ts:52, 67, 127](../apps/desktop/src/main/notebook/notebook-tools.ts#L52) | 6 |
| 브라우저 | PDF·웹 페이지 저장, 북마크 가져오기, 확장 설치 [browser-manager.ts:919, 923, 945, 992](../apps/desktop/src/main/browser/browser-manager.ts#L919) | 4 |
| 언어·노트북 설정 | 실행 파일·연결 정의·분석 환경 [language-manager.ts:375, 391, 400, 714](../apps/desktop/src/main/language/language-manager.ts#L375), Python 선택 [notebook-ipc.ts:67](../apps/desktop/src/main/notebook/notebook-ipc.ts#L67) | 5 |

이 표에 드러나지 않는 경로가 셋 더 있다.

- **웹 다운로드.** [browser-manager.ts:143](../apps/desktop/src/main/browser/browser-manager.ts#L143)이 `setSaveDialogOptions`만 지정하고 저장 경로는 정하지 않는다. 그래서 다운로드마다 Electron이 시스템 저장 창을 띄운다.
- **웹 페이지의 `<input type=file>`.** Chromium의 `FileSelectHelper`를 거쳐 같은 portal에 도달한다. Electron에는 이 창을 가로채는 API가 없다(electron#3999).
- **“Reveal in File Manager”.** [install-ipc.ts:226](../apps/desktop/src/main/ipc/install-ipc.ts#L226)의 `shell.showItemInFolder`는 D-Bus의 `org.freedesktop.FileManager1.ShowItems`를 부른다. 그 이름의 주인은 Nautilus다.

우회로는 마땅치 않다. `--xdg-portal-required-version=99`를 주면 Nautilus 대신 Chromium의 GTK3 대화상자가 뜰 뿐이다. 그 대화상자에는 Enter나 더블클릭이 선택을 취소해 버리는 미해결 버그(electron#54670)가 있다. 사용자의 `portals.conf`를 바꾸면 모든 앱의 파일 선택 창이 함께 바뀐다. **Setdown이 통제할 수 있는 해법은 앱 안의 선택 창뿐이다.**

## 2 엔진은 이미 사이드바에 있다

10월 15일의 [탐색기 보고서](2026_10_15_22_10_explorer_capabilities_and_architecture.md)가 제안한 파일 작업은 대부분 구현됐다. [ExplorerService](../apps/desktop/src/main/project/explorer-service.ts)에 있는 기능은 다음과 같다.

- copy·move·duplicate·import 전송과 Keep Both·Skip 충돌 처리
- 창마다 50단계까지 기록하는 실행 취소
- 작업 취소와 진행률 통지
- 미저장 문서를 보호하는 휴지통 처리
- 언어 서버에 보내는 파일 이름 변경 통지

[explorer-clipboard.ts](../apps/desktop/src/main/project/explorer-clipboard.ts#L28)는 Nautilus와 Dolphin이 클립보드에 넣는 `x-special/gnome-copied-files`와 `text/uri-list`도 읽는다. 파일 관리자 탭은 이 엔진을 그대로 쓴다.

재사용을 막는 것은 단 하나다. 모든 경로가 **열린 프로젝트 폴더 안**에 있어야 한다.

```ts
// apps/desktop/src/main/project/project-paths.ts:6-15
export class ProjectPaths {
  root(state: WindowState): string {
    if (!state.projectRoot) throw new Error('No folder is open.');
    return state.projectRoot;
  }
  inside(state: WindowState, candidate: string): string {
    const root = this.root(state);
    const resolved = canonicalPath(String(candidate));
    if (!isInside(root, resolved)) throw new Error('The path is outside the open folder.');
    return resolved;
```

다행히 이 제약은 한 곳에 모여 있다. `ExplorerService`는 생성자에서 `ProjectPaths`를 받는다([explorer-service.ts:89](../apps/desktop/src/main/project/explorer-service.ts#L89)). 따라서 `ProjectPaths`의 공개 메서드 `root`, `inside`, `entry`, `child`를 인터페이스로 뽑는다. 거기에 “절대 경로이고 NUL 문자가 없으면 허용”하는 파일시스템용 구현을 하나 더 두면 복사·이동·실행 취소 코드는 한 줄도 바뀌지 않는다. 실행 취소 기록은 이미 창 단위([explorer-service.ts:18](../apps/desktop/src/main/project/explorer-service.ts#L18))다. 그래서 사이드바와 파일 관리자 탭이 하나의 Undo 스택을 공유한다. Nautilus도 앱 전체에 Undo 관리자를 하나만 둔다.

범위가 넓어지면 보안을 따져야 한다. 다행히 IPC는 이미 앱 창에서 온 호출만 받는다. [window-ipc.ts:4-17](../apps/desktop/src/main/ipc/window-ipc.ts#L4)은 보낸 쪽의 `webContents`가 등록된 창이 아니면 거부한다. 웹 탭과 확장은 별도 `WebContents`라서 새 채널에 닿지 못한다. 넓어지는 것은 앱 UI가 다룰 수 있는 경로이지, 웹 콘텐츠의 권한이 아니다. 프로젝트 밖 경로를 바꾸는 작업에서도 언어 서버 통지와 열린 문서 보호는 계속 거쳐야 한다.

`readDirectory`([explorer-service.ts:96-103](../apps/desktop/src/main/project/explorer-service.ts#L96))는 다시 써야 한다. 프로젝트 트리에 맞춰 심볼릭 링크와 `.git`을 숨기고, 이름과 종류만 돌려준다. 파일 관리자는 링크를 보여줘야 하고 크기·수정 시각 열이 필요하다.

규모를 가늠할 선례도 있다. 터미널은 원래 아래쪽 패널이었는데 10월 13일 커밋 `f9ac1e7` 하나로 탭이 됐다. 32개 파일, 674줄 추가, 448줄 삭제였다. 파일 관리자 탭도 비슷한 크기다. 다른 점은 터미널에 없던 엔진이 파일 관리자에는 이미 있다는 것이다.

## 3 폴더를 주소로 만든다

Setdown의 탭은 이미 **한 자리에서 여러 자원을 오가는** 구조다. 같은 탭에서 주소창에 파일 경로를 치면 문서가 되고, URL을 치면 웹 페이지가, `terminal://`을 치면 터미널이 된다. 뒤로·앞으로 기록도 이 종류들을 넘나든다.

```ts
// apps/desktop/src/core/workspace/tab-navigation.ts:3-6
export type WebHistory = { index: number; entries: { url: string; title: string; pageState?: string }[] };
export type TabVisit = { kind: 'file'; url: string; position?: ReadingPosition }
  | { kind: 'web'; url: string; history?: WebHistory }
  | { kind: 'terminal'; url: string };
```

지금 주소창에 폴더 경로를 넣으면 [tab-navigation-controller.ts:102](../apps/desktop/src/renderer/workspace/tab-navigation-controller.ts#L102)가 문서 읽기를 요청한다. 그러면 main의 `document:read-location`([install-ipc.ts:143-149](../apps/desktop/src/main/ipc/install-ipc.ts#L143))이 디렉터리를 문서로 읽으려다 실패한다. **가장 싼 진입로는 디렉터리를 올바른 주소로 인정하는 것이다.** main이 `stat` 결과가 디렉터리일 때 `{ kind: 'folder', path }`를 돌려주면, 다음 기능들은 새로 만들지 않아도 따라온다.

- 문서 → 폴더 → 다른 문서로 이어지는 뒤로·앞으로 기록
- 주소창 입력
- 탭 고정과 미리보기(기울임꼴) 탭 규칙
- 그룹 분할
- 창 사이 탭 끌기

새 탭 종류의 모양은 터미널 탭을 따른다. Nautilus는 뒤로 가기 기록마다 그때의 선택을 저장해 두었다가, 돌아오면 그 선택으로 스크롤한다. 이 기록은 `TabVisit`에 그대로 담을 수 있다.

```ts
// 제안: core/workspace/workspace-state.ts, core/workspace/tab-navigation.ts
export type FolderTab = { kind: 'folder'; id: string; surface: 'folder'; path: string;
  view: { layout: 'list' | 'grid'; sort: 'name' | 'type' | 'modified' | 'size'; descending: boolean; showHidden: boolean };
  picker?: { requestId: string };                 // 고르기 모드일 때만. 세션 복원 대상이 아니다.
  navigation?: TabNavigation };
export type WorkspaceTab = DocumentTab | BrowserTab | TerminalTab | DiffTab | FolderTab;
export type TabVisit = /* 기존 세 종류 */ | { kind: 'folder'; url: string; selection?: string[] };
```

고칠 곳은 터미널이 이미 길을 낸 자리다. 터미널 탭을 분기하는 코드를 세어 보면 아래와 같다. 폴더 탭도 같은 자리에 분기가 하나씩 생긴다.

| 파일 | 터미널 분기 수 | 폴더 탭에서 할 일 |
| --- | ---: | --- |
| [tab-controller.ts](../apps/desktop/src/renderer/workspace/tab-controller.ts#L205) | 11 | `openFolder(path, groupId)`, 요약·전송·닫기 |
| [tab-navigation-controller.ts](../apps/desktop/src/renderer/workspace/tab-navigation-controller.ts#L91) | 8 | 디렉터리 주소를 `FolderTab`으로 교체, 방문 기록 |
| [LocationBar.svelte](../apps/desktop/src/renderer/workspace/location/LocationBar.svelte#L21) | 4 | 주소 표시, 경로 자동 완성(5절) |
| [tab-transfer-manager.ts](../apps/desktop/src/main/tabs/tab-transfer-manager.ts) | 4 | 창 사이 전송. 상태가 경로와 보기 설정뿐이라 터미널보다 쉽다 |
| [workspace-state.ts](../apps/desktop/src/core/workspace/workspace-state.ts#L41) | 3 | 타입, `tabTitle`, `tabLocation` |
| [workspace-controller.ts](../apps/desktop/src/renderer/app/workspace-controller.ts#L102) | 2 | `newFolderTab` 동작과 메뉴 명령 |
| [App.svelte](../apps/desktop/src/renderer/App.svelte#L109) | 1 | 폴더 화면 레이어 |
| [desktop-api.ts](../apps/desktop/src/protocol/desktop-api.ts#L220) | 1 | `TransferableFolderTab` |

화면은 터미널처럼 DOM 레이어다. 웹 탭이나 Markdown 미리보기처럼 네이티브 `WebContentsView`를 쓰지 않으므로, bounds와 네이티브 줌 경로에 새로 들어가지 않는다. 탭을 바꿀 때 웹 뷰를 숨기는 처리는 그룹 레이아웃이 이미 한다.

<details>
<summary>터미널 화면이 붙는 방식 (폴더 화면도 같은 모양)</summary>

```text
apps/desktop/src/renderer/
├── App.svelte                     ← 그룹마다 화면 레이어를 배치
├── terminal/TerminalSurface.svelte
├── folder/FolderSurface.svelte    ← 새로 추가 (제안)
└── workspace/
    ├── tabs/TabChrome.svelte      ← 새 탭 버튼
    ├── tab-controller.ts
    └── tab-navigation-controller.ts
```

```svelte
<!-- apps/desktop/src/renderer/App.svelte:109-121 -->
{#each view.terminalSessions as session (session.id)}
  {@const tab = view.tabs.find(tab => tab.kind === 'terminal' && tab.sessionId === session.id)}
  {@const group = view.groups.find(group => group.activeId === tab?.id)}
  {@const active = !!group && !(group.id === view.focusedGroupId && project.gitDiffActive)}
  {@const box = boxes.find(box => box.id === group?.id) ?? focused}
  <div class="group-content terminal-content" class:inactive={!active} inert={!active}
    style={geometry(box)} data-terminal-tab={tab?.id} data-zoom-tab={tab?.id}>
    {#await import('./terminal/TerminalSurface.svelte') then module}
      <module.default api={terminalApi} id={session.id} tabId={tab?.id} {active} ... />
    {:catch error}<div role="alert">Could not load the terminal: {String(error)}</div>{/await}
  </div>
{/each}
```

</details>

세 가지는 처음부터 지켜야 한다.

- **줌.** [성능 계약](../docs/preview-performance-contract.md)은 모든 화면이 탭 ID의 줌 값 하나를 쓴다고 정한다. 폴더 화면도 그 값으로 행 높이와 아이콘 크기를 정해야 한다.
- **세션 복원.** 지금 [workspace-snapshot.ts:6](../apps/desktop/src/core/workspace/workspace-snapshot.ts#L6)은 문서와 Git 비교 탭만 저장한다. 폴더 탭은 경로와 보기 설정만 있으면 되므로 복원 비용이 가장 낮다. Dolphin의 규칙을 따라, 최종 위치로 탭을 먼저 만들고 그다음 선택과 스크롤을 적용한다(`dolphintabwidget.cpp:124-128`). 고르기 모드 탭은 저장하지 않는다. Nautilus도 선택 창은 복원하지 않는다.
- **새 탭 버튼.** [TabChrome.svelte:61-69](../apps/desktop/src/renderer/workspace/tabs/TabChrome.svelte#L61)의 Markdown·웹·터미널 버튼 옆에 넷째 버튼을 둔다. 메뉴의 `CmdOrCtrl+E`는 이미 쓰이고 있다. VS Code 사용자에게 익숙한 `CmdOrCtrl+Shift+E`는 비어 있다.

## 4 화면은 베끼고, 데이터는 가져다 쓴다

파일 관리자 화면의 규칙은 수십 년 동안 다듬어졌다. 그대로 옮겨 오는 편이 낫다. 화면 밑의 데이터는 대부분 표준 파일이나 시스템 명령으로 이미 나와 있으니, 다시 계산하지 않는다.

**목록.** 처음에는 이름·크기·수정 시각·종류 열이 있는 목록 보기 하나로 시작한다. 큰 폴더를 위한 가상화는 직접 만들지 않는다.

- **쓸 것:** [`virtua`](https://github.com/inokawa/virtua) 0.54.2(MIT). Svelte 5 runes로 쓰였고 격자 보기용 `VGrid`도 있다.
- **피할 것:** `@tanstack/svelte-virtual`은 아직 store 기반이다(TanStack/virtual#866). VS Code의 `ListView`는 연결된 트리 코드까지 7천 줄이 넘고 DI에 묶여 있다.

**읽어 오기.** 1만 개짜리 폴더도 화면이 멈추지 않아야 한다. 두 프로젝트의 수치를 그대로 쓴다.

- **나눠 읽기.** Nautilus는 디렉터리를 100개씩 나눠 읽는다(`nautilus-directory-async.c:28`).
- **화면 반영 간격.** 처음에는 100ms마다 반영하고, 변경이 계속 들어오면 간격을 2초까지 늘린다(`nautilus-files-view.c:70-79`).
- **비싼 정보는 보이는 곳만.** 종류·썸네일 같은 정보는 Dolphin처럼 처리한다.

```cpp
// vendor/dolphin/src/kitemviews/kfileitemmodelrolesupdater.cpp:53-61
const int MaxBlockTimeout = 200;
// If the number of items is smaller than ResolveAllItemsLimit,
// the roles of all items will be resolved.
const int ResolveAllItemsLimit = 500;
// Not only the visible area, but up to ReadAheadPages before and after
// this area will be resolved.
const int ReadAheadPages = 5;
```

**정렬과 선택.** 자연 정렬은 `Intl.Collator({ numeric: true })`로 하고, VS Code의 `compareFileNames`(`comparers.ts:40-51`, MIT)에서 `foo1`과 `foo01`을 구별하는 마지막 비교를 가져온다. 선택·기준점·파일명 타이핑 이동·필터·숨김 파일 토글은 사이드바의 [explorer-tree-state.svelte.ts](../apps/desktop/src/renderer/project/explorer/explorer-tree-state.svelte.ts)와 [explorer-presentation.ts](../apps/desktop/src/renderer/project/explorer/explorer-presentation.ts)를 탭 상태로 옮겨 쓴다.

**주소.** 탭의 주소창이 곧 위치 입력란이다. Nautilus에서 가져올 규칙은 세 가지다.

- **경로 표시줄.** `~/a/b`를 `/ › home › user › a › b`가 아니라 `Home › a › b`로 보여준다. 마운트된 드라이브는 볼륨 이름부터 시작한다(`nautilus-pathbar.c:1028-1085`).
- **단축키.** `Ctrl+L`이나 `/`, `~`를 누르면 입력란이 그 문자로 채워진 채 열린다(`nautilus-toolbar.c:256-259`).
- **자동 완성.** 글자를 **삽입할 때만** 남은 이름을 선택된 상태로 채워 넣고, 지울 때는 하지 않는다(`nautilus-location-entry.c:573-593`). Setdown에서는 한글 조합 중에는 완성하지 않는다는 조건을 더한다.

제안 목록 팝업은 이미 있다. 브라우저 방문 기록을 보여주는 네이티브 오버레이([location-overlay.ts](../apps/desktop/src/main/browser/location-overlay.ts))에 경로 행을 추가하면 된다.

**장소 사이드바.** 쓸 데이터가 모두 이미 디스크에 있다. 이 표의 파일과 명령은 이 기계에서 모두 확인했다.

| 장소 | 읽을 곳 | 방법 |
| --- | --- | --- |
| 북마크 (GTK 선택 창·Nautilus와 공유) | `~/.config/gtk-3.0/bookmarks`, 한 줄에 `URI 이름` | 텍스트 읽기·쓰기. Nautilus의 형식 처리 `nautilus-bookmark-list.c:461-473` |
| 사용자 폴더 | Electron `app.getPath('documents' …)`가 `user-dirs.dirs`를 따른다. `TEMPLATES` 등은 15줄 파서 | 내장 |
| 드라이브·마운트 | `findmnt --json --real -b`, 변경 감시는 `--poll`, 여유 공간은 `fs.statfs` | CLI. `drivelist`는 미리 빌드된 바이너리가 없는 네이티브 모듈이라 피한다 |
| 원격(sftp·smb) | gvfs가 FUSE로 연결한 `/run/user/$UID/gvfs/…` | 일반 파일 경로. 연결 목록은 `LC_ALL=C gio mount -l` |
| 휴지통 | 버리기는 지금처럼 `shell.trashItem`. 목록은 `gio list -a trash::orig-path,trash::deletion-date trash://`, 복원은 `gio trash --restore` | CLI. 대체 구현 참고는 yazi의 `.trashinfo` 코드 |
| 최근 파일 | `~/.local/share/recently-used.xbel` | XML 읽기. Setdown이 연 파일을 여기에 추가하면 다른 앱도 본다 |

**썸네일.** 이 표준을 구현한 npm 라이브러리는 없다. 처리는 이렇게 나눈다.

- **이미 만들어진 썸네일 읽기.** 디렉터리마다 `gio list -a thumbnail::path,thumbnail::is-valid`를 한 번 호출한다. 파일 이름을 직접 MD5로 계산하면 `;`와 `~`의 URI 인코딩이 GLib와 달라 틀린다.
- **새로 만들기.** 이미 의존성에 있는 `sharp`와 `pdfjs-dist`로 만들고, 표준 캐시 `~/.cache/thumbnails`에 쓴다. 그러면 Nautilus도 그 썸네일을 쓴다. COSMIC Files의 [thumbnail_cacher.rs](../vendor/cosmic-files/src/thumbnail_cacher.rs)가 실패 표시와 메타데이터 처리까지 갖춘 참고 구현이다.
- **안 되는 것.** Electron의 `nativeImage.createThumbnailFromPath`는 Linux를 지원하지 않는다.

**열기와 “다른 앱으로 열기”.** 활성화 순서는 Nautilus의 `get_activation_action`(`nautilus-mime-actions.c:713-760`)을 따른다. 폴더면 들어가고, 압축 파일이면 풀고, 그 밖에는 연결된 앱으로 연다. 맨 앞에 “Setdown이 여는 종류면 탭으로”를 하나 더한다. 연결 프로그램 목록은 `LC_ALL=C gio mime <type>`이 Nautilus와 똑같은 규칙으로 해석해 준다. 실행은 `gio launch`로 한다. 이 기계에서는 `gio` 출력이 한국어로 나오므로 `LC_ALL=C`가 필수다.

**검색.** Nautilus는 여러 검색원을 동시에 돌리고 URI로 중복을 지운다(`nautilus-search-engine.c:151-182`). 검색원은 인덱스 없이 훑는 것과 시스템 색인(localsearch)이다.

- **파일 이름.** Setdown에는 이미 ripgrep이 있다([ripgrep-files.ts](../apps/desktop/src/main/project/engines/ripgrep-files.ts)). `rg --files`가 파일 이름 목록을 흘려 주므로 훑는 쪽은 이것을 쓴다.
- **폴더 이름.** `rg`는 디렉터리를 나열하지 않는다. 그래서 파일 경로의 부모로 폴더를 얻고, 빈 폴더만 Nautilus의 너비 우선 탐색(`nautilus-file-utilities.c:1204-1270`)을 옮겨 와 채운다.
- **색인된 폴더.** `localsearch` 결과를 함께 합친다.

## 5 고르기 모드: 같은 탭에 모드 하나

Nautilus의 선택 창은 따로 만든 브라우저가 아니다. 평소 창과 같은 사이드바·도구 모음·슬롯을 쓰고, 슬롯을 만들 때 모드만 넘긴다.

```c
/* vendor/nautilus/src/nautilus-file-chooser.c:764-766 */
/* Setup slot. */
self->slot = nautilus_window_slot_new (self->mode);
g_signal_connect_swapped (self->slot, "notify::location", G_CALLBACK (on_location_changed), self);
```

COSMIC Files도 같다. 탭 모델이 `Mode { App, Desktop, Dialog(DialogKind) }`([tab.rs:492-496](../vendor/cosmic-files/src/tab.rs#L492))이고, 선택 창 종류는 `OpenFile`, `OpenFolder`, `OpenMultipleFiles`, `OpenMultipleFolders`, `SaveFile`이다([dialog.rs:58-64](../vendor/cosmic-files/src/dialog.rs#L58)). 모드는 공통 부품 안의 규칙만 바꾼다. 단일 선택 모드에서는 하나만 고를 수 있다(`nautilus-files-view.c:8752-8755`). 선택 창 안에서는 새 탭을 열 수 없고(`:1311-1320`), 밖으로 끌어내기와 대부분의 우클릭 동작도 꺼진다. 형식 필터는 파일만 거르고 **폴더는 절대 숨기지 않는다**. 최근·별표·휴지통 같은 가상 위치는 “이 폴더”로 고를 수 없다.

핵심은 “선택” 버튼이 무엇을 돌려주는가다.

```c
/* vendor/nautilus/src/nautilus-file-chooser.c:302-318 (action_accept, 열기 모드) */
NautilusFileList *selection = nautilus_window_slot_get_selection (self->slot);
if (mode_can_accept_files (self->mode, selection))
{
    g_autolist (GFile) file_locations = g_list_copy_deep (selection,
                                                          (GCopyFunc) get_file_chooser_activation_location,
                                                          NULL);
    emit_accepted (self, file_locations);
}
else
{
    GFile *location = nautilus_window_slot_get_location (self->slot);
    emit_accepted (self, &(GList){ .data = location });
}
```

선택이 모드에 맞으면 선택을 돌려주고, 맞지 않으면 **지금 들어와 있는 폴더**를 돌려준다. 폴더를 고를 때 아무것도 선택하지 않고 “선택”을 누르면 현재 폴더가 된다는 뜻이다. 이 한 줄 덕분에 폴더 고르기가 자연스러워진다. 무엇을 받아들일지는 `mode_can_accept_files`(`:86-143`)가 정한다. 파일 하나 모드는 폴더가 아닌 항목 하나, 폴더 하나 모드는 폴더 하나, 여러 개 모드는 모든 항목이 같은 종류여야 한다.

Setdown에서는 이것이 `picker` 필드가 있는 `FolderTab`이다. 이 탭은 요청한 창에 묶인다. 탭을 닫으면 취소이고, 끝나면 포커스가 요청한 곳으로 돌아간다. 세션 복원에서는 빠진다.

### 관문 하나로 20곳을 바꾼다

호출하는 쪽을 20번 고치지 않는다. Electron의 `dialog.showOpenDialog`·`showSaveDialog`와 **같은 시그니처, 같은 반환 타입**의 모듈을 하나 두고 import만 바꾼다. 옵션 계약도 새로 만들지 않는다. Electron 옵션이 portal 옵션과 거의 일대일로 대응하고, portal 옵션은 Nautilus 모드로 바로 바뀐다.

```ts
// 제안: apps/desktop/src/main/dialogs/path-picker.ts
// 호출하는 곳은 `import { dialog } from 'electron'`을 이 모듈로 바꾸는 것 말고는 그대로다.
export const dialog = {
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>,
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>,
};
```

| Electron 옵션 | portal 옵션 | 모드 |
| --- | --- | --- |
| `properties: ['openFile']` | OpenFile | 파일 하나 |
| `['openFile', 'multiSelections']` | `multiple: true` | 파일 여러 개 |
| `['openDirectory']` | `directory: true` | 폴더 하나 |
| `showSaveDialog` | SaveFile | 저장 |
| `defaultPath` | `current_folder` / `current_name` | 시작 위치와 이름 |
| `filters`, `buttonLabel`, `title` | `filters`, `accept_label`, `title` | 필터 목록, 버튼, 제목 |

main은 요청을 renderer에 보내고 결과를 기다린다. 결과가 오면 존재 여부와 종류를 **다시 검사한다**. Theia가 네이티브 선택 뒤에 읽기·쓰기 가능 여부를 재확인하는 것과 같은 이유다(`electron-file-dialog-service.ts:93-118`). `project-service.ts`의 `folderRequests` 같은 기존의 늦은 응답 차단은 그대로 둔다. 창이 없거나 renderer가 아직 준비되지 않았을 때, 또는 사용자가 설정으로 원할 때만 네이티브 창을 쓴다. Zed는 반대 방향으로 같은 일을 한다. portal이 실패하면 앱 안의 선택 창으로 물러난다(`workspace.rs:3471-3516`).

### 경로를 치는 사람을 위한 규칙

마우스로 폴더를 찾아가는 사람만 있는 것은 아니다. 경로를 아는 사람은 주소창에 치고 Enter를 누르고 싶어 한다. 이 규칙은 VS Code의 SimpleFileDialog(`simpleFileDialog.ts`, MIT, 1,221줄)에 정리돼 있고 테스트 12개가 붙어 있다.

- 끝에 `/`를 치면 그 폴더로 들어간다.
- 없는 경로에서는 “`~`로 홈에 가라”는 안내를 한 번만 보여준다. 같은 잘못된 경로를 계속 치는 동안 키 입력마다 `stat`하지 않도록 기억해 둔다.
- 폴더만 고르는 창에서 없는 경로를 입력하면 쓰기 가능한 상위 폴더가 있을 때만 새로 만들지 묻는다.
- 저장할 때는 확장자를 뺀 이름만 선택하고, 덮어쓰기 전에 확인한다.
- 목록 읽기는 매번 취소 가능하게 하고, 늦게 도착한 결과가 새 결과를 덮지 않게 한다.

다만 그대로 옮기면 안 되는 동작이 있다. VS Code는 강조된 행이 폴더면 Enter가 **항상 그 안으로 들어간다**.

```ts
// vendor/vscode/src/vs/workbench/services/dialogs/browser/simpleFileDialog.ts:594-599, 615-616
private async onDidAccept(): Promise<URI | undefined> {
  this.busy = true;
  if (!this.updatingPromise && this.filePickBox.activeItems.length === 1) {
    const item = this.filePickBox.selectedItems[0];
    if (item.isFolder) {
      /* … 폴더로 이동 … */
      this.filePickBox.busy = false;
      return;
```

폴더를 고르는 창에서 이 동작은 사용자를 헷갈리게 한다. Zed의 경로 프롬프트가 더 낫다. 목록 맨 위에 “이 폴더”를 뜻하는 `./` 행을 두고(`open_path_prompt.rs:429-457`), **Enter는 강조된 행을 고른다**. 폴더 안으로 들어가는 것은 Tab이다. Zed의 이 코드는 GPL-3.0-or-later이고 테스트(`open_path_prompt_tests.rs:14, 129`)가 있어 받아들임 기준으로 쓰기 좋다. Setdown이 더해야 할 것은 하나다. VS Code의 자동 완성에는 IME 조합 검사가 없다. 한글을 조합하는 동안에는 완성을 넣지 않게 해야 한다. 기존 [composition-guard.ts](../apps/desktop/src/renderer/editor/composition-guard.ts)를 쓴다.

<details>
<summary>VS Code의 폴더 전용 검증 규칙과 이식 범위</summary>

```text
vendor/vscode/src/vs/workbench/services/dialogs/
├── browser/simpleFileDialog.ts          ← validate(), canCreateFolder(), tryUpdateItems(), setAutoComplete()
├── browser/abstractFileDialogService.ts ← 기본 위치: 마지막 파일의 폴더 → 작업 폴더 → 홈
├── electron-browser/fileDialogService.ts← 네이티브/앱 내부 선택 (files.simpleDialog.enable)
└── test/browser/simpleFileDialog.test.ts← 새 폴더 생성, 읽기 전용 상위, 늦은 목록 취소
```

```ts
// simpleFileDialog.ts:947-979 (열기 쪽)
} else { // open
  if (!stat) {
    // For a folder-only picker, offer to create the folder if a writable ancestor exists.
    if (this.allowFolderSelection && !this.allowFileSelection
      && await this.canCreateFolder(uri, statDirname)) {
      const message = nls.localize('remoteFileDialog.validateCreateDirectoryOpen', 'The folder {0} does not exist. Would you like to create it?', resources.basename(uri));
      const shouldCreate = await this.yesNoPrompt(uri, message);
      if (!shouldCreate) { return false; }
      try { await this.fileService.createFolder(uri); return true; }
      catch (e) { this.filePickBox.validationMessage = nls.localize('remoteFileDialog.createFolderFailed', 'Could not create folder: {0}', e.message); return false; }
    }
    this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateNonexistentDir', 'Please enter a path that exists.');
    return false;
  } else if (stat.isDirectory && !this.allowFolderSelection) {
    this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateFileOnly', 'Please select a file.');
    return false;
  } else if (!stat.isDirectory && !this.allowFileSelection) {
    this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateFolderOnly', 'Please select a folder.');
    return false;
  }
}
```

이식할 수 있는 것은 `validate`, `canCreateFolder`, `addPostfix`, `filterFile`, `createItems`, `tryUpdateItems`, `setAutoComplete`, 그리고 취소 가능한 `updateItems`다. `URI`는 POSIX 경로 문자열로, `IFileService`는 `stat`·`list`·`mkdir` IPC 세 개로 바꾼다. QuickInput·원격 파일시스템·DI 부분은 버린다. 다중 선택은 이 파일에 없다. 그 규칙은 Nautilus의 `mode_can_accept_files`에서 가져온다.

</details>

### 바꾸는 순서

1. **폴더 메뉴의 `Open Folder…`.** 사용자가 가장 자주 부딪히는 곳이다. 최근 폴더 목록은 그대로 두고 “Browse…”만 고르기 탭으로 바꾼다. VS Code의 폴더 빠른 선택과 같은 구성이다.
2. **첫 저장과 Save As.** 문서를 다루는 앱에서 가장 흔한 저장 창이다.
3. **내보내기와 설정용 선택.** 나머지 13곳은 관문을 바꾼 뒤 import만 고치면 된다.
4. **“Reveal in File Manager”.** Nautilus를 부르지 않고, 그 파일이 선택된 폴더 탭을 연다. Nautilus의 `open_location_full`이 위치와 선택을 함께 받는 것과 같다.

정책 판단이 필요한 곳이 둘 있다.

- **다운로드.** Chrome의 기본 동작은 묻지 않고 다운로드 폴더에 저장하는 것이다. `will-download`가 반환되기 전에 경로를 정해야 하므로, 고유한 이름으로 바로 저장하고 “다른 이름으로 저장”은 끝난 뒤 옮기는 방식이 맞다. 확장 다운로드는 이미 이렇게 한다([extension-downloads.ts:58-60](../apps/desktop/src/main/browser/extensions/extension-downloads.ts#L58)).
- **웹 페이지의 파일 입력.** DevTools 프로토콜의 `Page.setInterceptFileChooserDialog`와 `DOM.setFileInputFiles`를 `webContents.debugger`로 쓰면 가로챌 수 있다. 다만 이 저장소에서 검증한 적이 없다. `showDirectoryPicker`는 이 방법으로도 막을 수 없다. 별도 단계로 두고 먼저 실험한다.

## 6 앱 밖까지: 선택 사항

앱 안의 선택 창이 안정되면 같은 탭을 다른 앱에도 내줄 수 있다. 길은 셋이고, 비용 순서대로 적는다.

| 방법 | 효과 | 비용과 위험 |
| --- | --- | --- |
| `setdown.desktop`의 `MimeType=`에 `inode/directory` 추가 | 다른 앱에서 “폴더 열기”를 하면 Setdown 폴더 탭이 열림. 지금 기본값은 `org.gnome.Nautilus.desktop` | 설정 한 줄. 사용자가 기본 앱으로 지정해야 함 |
| `org.freedesktop.FileManager1` 구현 | 브라우저 등의 “폴더에서 보기”(`ShowItems`)가 Setdown으로 옴 | D-Bus 이름 소유. Dolphin처럼 `QueueService`로 남의 이름을 뺏지 않음(`dbusinterface.cpp:17-27`) |
| portal FileChooser backend | 모든 앱의 파일 선택 창이 Setdown | 모든 앱이 Setdown에 의존. 아래 설명 |

마지막 길에는 코드 한 줄 없이 시험해 볼 방법이 있다. [xdg-desktop-portal-termfilechooser](../vendor/xdg-desktop-portal-termfilechooser)는 선택을 외부 프로그램에 맡기는 portal backend다. 래퍼 스크립트는 다중 선택 여부, 폴더 여부, 저장 여부, 제안 경로, 결과 파일을 인자로 받는다. 고른 경로를 결과 파일에 한 줄씩 쓰면 끝난다([yazi-wrapper.sh](../vendor/xdg-desktop-portal-termfilechooser/contrib/yazi-wrapper.sh)). `~/.config/xdg-desktop-portal/portals.conf`에 `org.freedesktop.impl.portal.FileChooser=termfilechooser` 한 줄을 넣으면 된다.

다만 배포할 수는 없다. 이 backend는 처리 함수 안에서 `waitpid`로 기다린다. 그래서 한 번에 한 앱의 선택 창만 열리고, 요청한 앱이 취소해도(`Request.Close`) 창을 닫지 못한다(이슈 #80). 필터·제목·부모 창 정보는 버리고, `SaveFiles`도 지원하지 않는다. Fedora 패키지도 없다.

배포용은 Setdown이 같은 계약을 직접 구현하는 것이다. 순수 JS D-Bus 라이브러리 `dbus-native` 0.16.3(MIT, 2026-10 배포)으로 `org.freedesktop.impl.portal.FileChooser`와 요청별 `Request` 객체를 내보낸다. 설치는 사용자 단위로 끝난다. xdg-desktop-portal 1.21부터 `~/.local/share/xdg-desktop-portal/portals/*.portal`을 읽고, Fedora 45에는 1.22.1이 있다. `portals.conf`에 `FileChooser=setdown;gnome`이라고 쓰면 Setdown이 없을 때 GNOME으로 물러난다. 두 가지 한계는 남는다. Electron 창은 다른 앱의 창(`parent_window`)에 붙일 수 없고, Setdown이 꺼져 있으면 D-Bus 활성화가 Electron을 새로 띄워야 한다. 앱 안의 선택 창이 충분히 안정되기 전에는 시작하지 않는다.

## 7 직접 만들지 않는 것들

| 필요 | 가져올 곳 | 방식 | 라이선스·비고 |
| --- | --- | --- | --- |
| 복사·이동·충돌·Undo·휴지통·클립보드 | Setdown `ExplorerService`, `file-transfer.ts`, `explorer-clipboard.ts` | 그대로 사용, 경로 범위만 교체 | 자체 코드 |
| 탭 수명·뒤로·앞으로·분할·창 이동·줌 | Setdown `TabNavigation`, 그룹, 전송 관리자 | 그대로 사용 | 자체 코드 |
| 큰 목록 가상화 | `virtua` 0.54.2 | npm | MIT |
| 고르기 모드 규칙 | Nautilus `nautilus-file-chooser.c`, `nautilus-portal.c` | TS로 이식 | GPL-3.0-or-later |
| 경로 입력·검증·자동 완성 | VS Code `simpleFileDialog.ts` | 코드 복사 후 수정 | MIT, 고지 유지 |
| “이 폴더” 행·Enter·Tab 규칙 | Zed `open_path_prompt.rs`와 테스트 | 동작 이식 | GPL-3.0-or-later |
| 경로 표시줄·주소 단축키·완성 시점 | Nautilus `nautilus-pathbar.c`, `nautilus-location-entry.c` | 동작 이식 | GPL-3.0-or-later |
| 나눠 읽기·보이는 곳만 계산 | Nautilus `nautilus-files-view.c`, Dolphin `kfileitemmodelrolesupdater.cpp` | 수치 이식 | GPL |
| 자연 정렬 | `Intl.Collator` + VS Code `compareFileNames` | 내장 + 복사 | MIT |
| 북마크·사용자 폴더·최근 파일 | GTK `bookmarks`, `user-dirs.dirs`, `recently-used.xbel` | 표준 파일 읽기 | freedesktop |
| 드라이브·여유 공간 | `findmnt --json`, `fs.statfs` | CLI + Node 내장 | util-linux |
| 휴지통 목록·복원 | `gio list trash://`, `gio trash --restore` | CLI | GLib ≥ 2.67.2 (Fedora 45: 2.90.1) |
| 썸네일 | 표준 캐시 + `gio list -a thumbnail::*`, `sharp`, `pdfjs-dist` | CLI + 기존 의존성 | COSMIC `thumbnail_cacher.rs` 참고 |
| 연결 프로그램 | `gio mime`, `gio launch`, `freedesktop-icons` | CLI + npm | MIT |
| MIME 판별 | `mime` (확장자) → `gio list -a standard::content-type` | npm + CLI | MIT |
| 압축 파일 | `yauzl`·`yazl`, 기존 `tar`, 시스템 `7z` | npm + CLI | MIT. `7zip-bin`은 2016년 p7zip이라 쓰지 않음 |
| 이름 검색 | 기존 `@vscode/ripgrep`, localsearch | 기존 의존성 + CLI | 빈 폴더만 Nautilus 탐색 이식 |
| 시스템 선택 창 (선택) | xdg-desktop-portal 규격, `dbus-native` | 규격 구현 | LGPL 규격, MIT 라이브러리 |

복사하면 안 되는 것도 있다. Eclipse Theia의 파일 대화상자는 쓸모 있는 참고지만 라이선스가 `EPL-2.0 OR GPL-2.0-only WITH Classpath-exception`이다. GPL-2.0-only는 Setdown의 GPL-3.0-only와 섞일 수 없고, EPL-2.0의 보조 라이선스 조항도 GPL-2.0만 지정한다. Theia에서는 뒤로·앞으로·위로·홈과 상위 폴더 드롭다운 같은 동작만 참고하고 코드는 가져오지 않는다.

Svelte용 완성품 파일 관리자도 쓰지 않는다. SVAR의 `@svar-ui/svelte-filemanager`는 MIT이고 Svelte 5용이지만, 자체 상태 저장소와 표·테마를 가져온다. 이미 있는 탐색기 엔진과 겹치고, 성능 계약을 우회하는 화면이 하나 더 생긴다.

## 8 추가한 서브모듈

모두 참고용이고 `shallow = true`로 등록했다. 빌드 입력이 아니다. `vendor/dolphin`에도 같은 설정을 넣었다.

| 경로 | 출처 | 라이선스 | 크기(작업 트리 / git) | 무엇을 보나 |
| --- | --- | --- | --- | --- |
| [vendor/cosmic-files](../vendor/cosmic-files) | github.com/pop-os/cosmic-files `2c20e74` | GPL-3.0-only | 2.7MB / 0.8MB | 파일 관리자와 시스템 선택 창을 한 코드로 만든 사례. `tab.rs`의 `Mode::Dialog`, `dialog.rs`, `thumbnail_cacher.rs`, `trash/`, `mime_app.rs` |
| [vendor/xdg-desktop-portal](../vendor/xdg-desktop-portal) | github.com/flatpak/xdg-desktop-portal `faab6c7` | LGPL-2.1-or-later | 4.3MB / 1.2MB | FileChooser·Request 인터페이스 원문, `portals.conf` 해석 규칙, 사용자 단위 backend 설치 |
| [vendor/xdg-desktop-portal-termfilechooser](../vendor/xdg-desktop-portal-termfilechooser) | github.com/hunkyburrito/… `ed89c16` | MIT | 0.2MB / 0.2MB | 가장 작은 완전한 backend와 래퍼 계약. 6절의 시험용 경로 |
| [vendor/yazi](../vendor/yazi) | github.com/sxyazi/yazi `805579e` | MIT | 7.7MB / 1.9MB | 휴지통 목록·복원(`yazi-fs/src/trash`), Linux 마운트 목록(`yazi-fs/src/mounts/linux.rs`), 작업 스케줄러 |
| [vendor/sigma-file-manager](../vendor/sigma-file-manager) | github.com/aleksey-hoffman/sigma-file-manager `4b15fcb` | GPL-3.0-or-later | 43MB / 34MB | 웹 기술로 만든 가장 완성도 높은 파일 관리자 화면. 가상 목록·격자, 주소창, 충돌·연결 프로그램 대화상자 |

Sigma는 Tauri 2와 Vue 3로 옮겨 갔고, Electron 판은 2024년에 멈춘 `v1` 브랜치에 있다. 크기가 가장 크지만 Setdown과 같은 웹 기술로 이 문제를 푼 유일한 활성 프로젝트라서 넣었다.

넣지 않은 것과 이유는 다음과 같다.

- **Spacedrive:** 자체 색인 위에 선 구조이고, React로 짰으며, 71MB다.
- **files-community/Files:** C#과 WinUI로 짠 Windows 전용이다. Windows 판을 맞출 때 다시 본다.
- **termfilechooser 원본:** 2021년에 멈췄고 위의 포크로 대체됐다.
- **Xplorer·TagSpaces:** AGPL이다.
- **SVAR:** 이유는 7절에 있다.

## 9 단계와 완료 기준

| 단계 | 완료로 보는 조건 | 검증 |
| --- | --- | --- |
| 1 폴더 탭 | 새 탭 버튼·단축키·주소창 입력으로 폴더 탭이 열린다. 1만 항목 폴더에서 입력 지연이 없다. 문서와 폴더를 오가는 뒤로·앞으로가 선택을 되살린다. 복사·잘라내기·붙여넣기·이름 변경·휴지통·Undo가 사이드바와 같은 결과를 낸다. 프로젝트 밖에서도 된다. 창 사이 이동과 재시작 후 복원이 된다 | 경로 범위 단위 테스트. 격리 디스플레이 E2E(탭 생성, 키보드, IME 조합 중 이름 입력, 큰 폴더). `npm run test:preview-contract` |
| 2 고르기 모드 | 20곳 모두 관문을 지난다. 폴더 메뉴·Save As에서 시스템 창이 뜨지 않는다. 취소·탭 닫기·창 닫기가 각각 취소로 끝난다. 돌려준 경로를 main이 다시 검사한다. 포커스가 요청한 곳으로 돌아간다 | 모드 규칙 단위 테스트. Nautilus의 받아들임 규칙, VS Code `simpleFileDialog.test.ts`, Zed `open_path_prompt_tests.rs`의 사례를 옮긴다. 늦은 응답 테스트. 격리 디스플레이 E2E |
| 3 장소와 표준 | 북마크를 바꾸면 Nautilus에도 보인다. 드라이브 연결과 해제가 몇 초 안에 반영된다. 휴지통 복원 충돌을 묻는다. 썸네일이 보이는 범위에서만 만들어진다 | 임시 `HOME`과 임시 마운트 fixture. `LC_ALL=C` 출력 파서 테스트 |
| 4 시스템 전체 | 다른 앱 두 개가 동시에 선택 창을 열 수 있다. 요청한 앱이 취소하면 탭이 닫힌다. Setdown이 없으면 GNOME 창으로 물러난다 | 격리 D-Bus 세션에서 portal 호출 |

1단계와 2단계는 탭 전환과 네이티브 뷰 숨김 경로를 건드린다. 그래서 [성능 계약](../docs/preview-performance-contract.md)이 정한 범위에 들어간다. 구현할 때는 `npm run test:preview-contract`와 `npm run bench:preview -- --baseline <설치된 기준>`을 같은 격리 디스플레이에서 돌린다. 일반 Markdown과 Git review의 첫 번째·두 번째·warm 사이클을 편집 유무, 준비 시간 포함 여부별로 따로 보고한다. GUI 테스트는 모두 `with-isolated-display.sh`로 실행하고, 사용자의 데스크톱에 창을 띄우지 않는다. 고르기 모드가 생기면 테스트하기도 쉬워진다. 지금은 OS 대화상자를 테스트 안에서 조작할 수 없지만, 앱 안의 선택 창은 실제 Electron에서 그대로 조작할 수 있다. VS Code가 smoke test에서 앱 내부 대화상자만 쓰는 이유와 같다(`fileDialogService.ts:67-77`).

## 10 하지 말아야 할 것

- **Nautilus를 탭 안에 넣으려 하지 않는다.** GTK4 위젯은 Electron 창에 들어가지 않는다. 다른 프로세스의 창을 끼워 넣던 XEmbed는 GTK4와 Wayland에서 사라졌다. Nautilus는 코드를 읽는 대상이다.
- **portal backend부터 만들지 않는다.** 그러면 모든 앱의 파일 선택이 아직 다듬어지지 않은 화면에 의존하게 된다. 앱 안의 고르기 모드가 먼저다.
- **목록 가상화, 휴지통 해석, MIME 데이터베이스, 형식별 썸네일 생성기를 새로 짜지 않는다.** 7절의 라이브러리와 명령이 이미 한다.
- **웹 콘텐츠에 파일시스템 채널을 열지 않는다.** 범위를 넓히는 것은 앱 창 IPC뿐이다.
- **네이티브 창으로 조용히 물러나지 않는다.** 앱 안의 선택 창이 실패하면 그 사실을 알리고, 네이티브 창은 설정이나 명시적인 대체 경로로만 쓴다. 그렇지 않으면 GNOME Files가 다시 나타나도 아무도 모른다.

<details>
<summary>코드 지도: 이 보고서가 가리키는 파일</summary>

```text
apps/desktop/src/
├── core/workspace/
│   ├── workspace-state.ts          ← WorkspaceTab 합집합, tabTitle·tabLocation (L33-44)
│   ├── tab-navigation.ts           ← TabVisit, recordVisit (L3-20)
│   └── workspace-snapshot.ts       ← 복원 대상 종류 (L6)
├── main/
│   ├── ipc/install-ipc.ts          ← document:read-location (L143), explorer:reveal (L226)
│   ├── ipc/window-ipc.ts           ← 앱 창 IPC만 받는 경계 (L4-17)
│   ├── project/
│   │   ├── project-service.ts      ← Open Folder 대화상자 (L61-66)
│   │   ├── project-paths.ts        ← 프로젝트 경계 (L6-15)
│   │   ├── explorer-service.ts     ← 파일 작업, Undo, readDirectory (L15-103)
│   │   ├── file-transfer.ts        ← 독점 생성 복사, 덮어쓰지 않는 이동
│   │   ├── explorer-clipboard.ts   ← gnome-copied-files·uri-list 읽기 (L28-40)
│   │   └── engines/ripgrep-files.ts← rg --files
│   ├── browser/browser-manager.ts  ← 다운로드 저장 창 (L143), 그 밖의 대화상자 (L919-992)
│   └── browser/location-overlay.ts ← 주소 제안 팝업
└── renderer/
    ├── App.svelte                  ← 화면 레이어 (L109-121)
    ├── workspace/tab-controller.ts ← openTerminal (L205)
    ├── workspace/tab-navigation-controller.ts ← 주소 해석 (L102)
    ├── workspace/tabs/TabChrome.svelte        ← 새 탭 버튼 (L61-69)
    └── project/explorer/           ← 선택·필터·정렬 상태

vendor/
├── nautilus/src/
│   ├── nautilus-portal.c           ← portal 메서드 → 모드 (L444-471)
│   ├── nautilus-file-chooser.c     ← 받아들임 규칙 (L86-143, L187-203, L278-319), 슬롯 생성 (L764)
│   ├── nautilus-files-view.c       ← 모드별 단일 선택·새 탭 금지 (L8752, L1311)
│   ├── nautilus-pathbar.c, nautilus-location-entry.c, nautilus-toolbar.c
│   ├── nautilus-bookmark-list.c    ← GTK 북마크 형식 (L461-473)
│   └── nautilus-search-engine*.c
├── dolphin/src/kitemviews/kfileitemmodelrolesupdater.cpp ← 보이는 범위 ±5쪽
├── cosmic-files/src/{tab.rs,dialog.rs,thumbnail_cacher.rs,mime_app.rs,trash/}
├── vscode/src/vs/workbench/services/dialogs/{browser,electron-browser,test}/
├── zed/crates/open_path_prompt/src/{open_path_prompt.rs,open_path_prompt_tests.rs}
├── theia/packages/filesystem/src/browser/file-dialog/  ← 동작 참고만, 코드 복사 금지
├── xdg-desktop-portal/data/org.freedesktop.impl.portal.FileChooser.xml
├── xdg-desktop-portal-termfilechooser/{contrib/,src/filechooser/filechooser.c}
├── yazi/yazi-fs/src/{trash/,mounts/linux.rs}
└── sigma-file-manager/src/modules/navigator/components/file-browser/
```

</details>

<details>
<summary>조사 기준과 확인하지 못한 것</summary>

참고 저장소의 기준 커밋은 Nautilus `20fc816`, Dolphin `a1f3b2f`, VS Code `d3d31f6`, Theia `71ee592`, Zed `b5cd310`이다. 새 서브모듈의 커밋은 8절에 적었다. npm 버전은 2026년 11월 11일 `npm view`로 확인했다. Electron과 Chromium의 대화상자 경로는 Electron `44-x-y` 브랜치와 Chromium `152.0.7977.149` 태그의 소스로 확인했다. portal 설정과 `gio`·`findmnt`의 존재, `inode/directory`의 기본 앱은 이 기계에서 읽기 전용 명령으로 확인했다.

다음은 소스를 읽어 추론했을 뿐 실행해 보지 않았다.

- `webContents.debugger`로 웹 페이지의 파일 입력을 가로채는 방법
- termfilechooser 래퍼로 실행 중인 Setdown에 요청을 넘기는 흐름
- Wayland에서 다른 앱으로 파일을 끌어 놓는 동작
- D-Bus 활성화로 Setdown을 띄울 때의 포커스

이번 작업에서는 제품 코드를 바꾸지 않았고 테스트나 벤치마크도 실행하지 않았다.

</details>
