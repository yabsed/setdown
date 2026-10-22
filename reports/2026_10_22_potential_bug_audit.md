# Setdown 잠재 버그 감사 보고서

작성일: 2026년 10월 22일 KST  
검토 기준: `c38b90de82d49766a42f9ac835666edf4784434e`의 작업 트리  
대상: Setdown 개발 및 유지보수 담당자

후속 조치: F01–F26의 수정 내용과 최종 검사 결과는 [수정 검증 보고서](../docs/validation/2026-10-22-bug-audit-fixes.md)에 기록한다. 아래 내용과 첨부 재현 자료는 수정 전 감사 기록이다.

**재현 근거가 있는 결함 26건을 확인했다. 우선 수정 대상은 Git에서 선택하지 않은 파일의 변경을 버리는 문제, 저장 중 외부 변경을 놓치는 문제, 동시 저장 충돌, 심볼릭 링크 교체, 초안 저장 시 본문 변조다.** 기존 단위 테스트 919개는 모두 통과하지만, 이번에 추가한 경계 조건 26개에서는 기대 동작을 충족하지 못했다.

이번 결과는 코드 스타일이나 막연한 위험 목록이 아니다. 각 항목에 발생 조건, 실제 관찰 결과, 코드 위치, 수정 방향을 연결했다. 다만 모든 항목을 앱 화면 전체에서 재현한 것은 아니다. 파일과 Git 서비스는 임시 파일 및 저장소에서 실행했고, 경쟁 조건은 시계·이벤트·비동기 완료 시점을 통제했다. 검색 두 항목은 실제 Electron/Chromium에서도 추가 확인했다.

## 우선순위와 전체 목록

P1은 의도하지 않은 파일 변경이나 데이터 손실 가능성 때문에 우선 수정할 항목이다. P2는 정상 기능이 깨지거나 복구를 요구하는 항목, P3는 상대적으로 영향이 작은 표시·내보내기 문제다. 발생 빈도를 측정한 등급은 아니다.

| 등급 | 건수 | 항목 |
| --- | ---: | --- |
| P1 | 6 | F03, F05, F06, F10, F12, F16 |
| P2 | 18 | F01, F02, F04, F07, F08, F09, F11, F13, F14, F15, F17, F18, F19, F20, F21, F22, F23, F26 |
| P3 | 2 | F24, F25 |

| ID | 등급 | 결함 | 대표 영향 |
| --- | --- | --- | --- |
| F01 | P2 | 한 창의 파일 감시 해제가 다른 창의 감시도 제거 | 외부 변경 알림 누락 |
| F02 | P2 | 파일 삭제 이벤트를 외부 변경에서 제외 | 삭제된 문서를 정상 문서처럼 계속 표시 |
| F03 | P1 | 같은 밀리초에 저장하면 임시 파일명이 충돌 | 저장 실패 또는 저장 내용 혼선 |
| F04 | P2 | 저장 후 기존 파일의 권한이 umask에 따라 축소 | 공유 파일 쓰기 권한 소실 |
| F05 | P1 | Save As가 심볼릭 링크 자체를 일반 파일로 교체 | 링크와 대상 파일의 관계 파괴 |
| F06 | P1 | 초안 자산 경로를 본문 전체에서 문자열 치환 | 코드 예제·외부 URL까지 변경 |
| F07 | P2 | URL 인코딩된 초안 자산 경로를 옮기지 못함 | 첫 저장 후 이미지 참조 단절 |
| F08 | P2 | `--` 또는 `++`로 시작하는 본문 변경을 Git 헤더로 오인 | 변경 구간 누락·줄 위치 오류 |
| F09 | P2 | 스테이징된 rename의 이전 파일명을 버림 | 원본이 빈 문서로 표시 |
| F10 | P1 | Git 파일명을 pathspec 패턴으로 해석 | 선택하지 않은 파일까지 Stage·Discard |
| F11 | P2 | Git 저장소가 아니라는 결과를 영구 캐시 | 외부 `git init` 이후에도 저장소 미인식 |
| F12 | P1 | Git에서 심볼릭 링크 대신 대상 파일을 조작 | 다른 파일의 변경을 Stage·Discard |
| F13 | P2 | Unicode 소문자 변환 후 원문 오프셋을 그대로 사용 | 검색 누락·잘못된 위치 이동 |
| F14 | P2 | 읽기 전용 폴더를 복사하면 commit·정리 과정이 실패 | 복사 실패·숨겨진 임시 폴더 잔존 |
| F15 | P2 | Markdown 셀을 코드 셀로 바꿀 때 attachments 유지 | nbformat 검증에 실패하는 노트북 저장 |
| F16 | P1 | Markdown 내용과 디스크 버전이 다른 시점에 수집 | 외부 변경을 자동 저장으로 덮어쓰기 |
| F17 | P2 | 첫 저장 도중 편집하면 초안 자산 경로 변경이 사라짐 | 최신 버퍼가 없어진 옛 경로를 참조 |
| F18 | P2 | 생성하는 로컬 링크에 URL 예약 문자를 그대로 사용 | `#` 등이 있는 파일명 링크 파손 |
| F19 | P2 | 새 HWPX 파일을 빈 텍스트로 생성 | 생성 직후 열기 실패 |
| F20 | P2 | 선택하지 않은 자동완성 명령을 해제하지 않음 | 언어 결과 메모리 한도 소진 |
| F21 | P2 | HWP가 일반 파일인지 확인하기 전에 blocking open | FIFO 열기 요청이 끝나지 않음 |
| F22 | P2 | 자동 저장을 꺼도 대기 중인 저장을 실행 | 비활성화 후 다른 탭도 디스크에 기록 |
| F23 | P2 | 4 MB를 넘는 Markdown Git 원본을 빈 내용으로 처리 | 원본 비교 결과 왜곡 |
| F24 | P3 | 웹 Reader 내보내기가 제목 자체의 id를 누락 | 문서 내부 링크 단절 |
| F25 | P3 | 화면에서 숨긴 HTML 텍스트도 검색 결과에 포함 | 보이지 않는 검색 결과·개수 불일치 |
| F26 | P2 | 링크를 URL로 파싱하기 전에 전체 디코딩 | 정상 인코딩된 파일 링크·쿼리 변조 |

## 저장과 파일 상태

### F01 창별 파일 감시가 서로 해제됨

**P2 · 실제 Node 파일 감시 객체로 확인.** [document-manager.ts](../apps/desktop/src/main/documents/document-manager.ts) 66–85행.

두 창이 같은 파일을 감시하는 상태에서 한 창이 탭을 전환하거나 감시를 다시 설정하면 `unwatchFile(path)`가 호출된다. 이 호출에는 해당 창의 listener가 없으므로 동일 경로의 모든 listener가 해제된다. 재현에서는 listener가 2개인 상태에서 한 창만 해제했는데 0개가 됐다.

다른 창의 `watchedPath`는 여전히 남아 있어 감시가 끊겼다는 사실도 상태에 반영되지 않는다. 외부 변경 배너가 누락될 수 있다. 저장 시 별도의 디스크 검사는 있으므로 이 문제만으로 무조건 덮어쓰기가 발생한다고 판단하지는 않는다. 창별 callback을 보관하고 `unwatchFile(path, callback)`으로 해제해야 한다.

### F02 외부 파일 삭제를 알리지 않음

**P2 · 삭제 후 Node의 missing-file stat 이벤트 형태를 주입해 확인.** [document-manager.ts](../apps/desktop/src/main/documents/document-manager.ts) 77–83행, 117–124행.

열린 파일을 외부에서 삭제하면 `watchFile`은 `nlink === 0`인 stat을 전달한다. 현재 알림 조건은 `current.nlink > 0`이어서 이 이벤트를 버린다. 재현에서 파일 삭제 후 알림 전송은 0회였다. 탭을 다시 활성화하는 경로도 `stat` 실패를 무시한다.

사용자는 파일이 사라졌다는 안내 없이 이전 내용을 계속 본다. 자동 저장은 충돌로 취소되지만 그 이유가 배너로 나타나지 않는다. 삭제·접근 불가를 별도 상태로 전달하고, 재생성·다른 이름으로 저장·버퍼 유지 동작을 제공해야 한다.

### F03 동시 저장이 같은 임시 파일을 공유함

**P1 · 실제 파일 I/O와 동일 밀리초로 고정한 시계로 확인.** [file-system.ts](../apps/desktop/src/main/documents/file-system.ts) 27–36행. [draft-assets.ts](../apps/desktop/src/main/documents/draft-assets.ts) 26–33행에도 같은 이름 생성 방식이 있다.

임시 파일명은 파일명·PID·`Date.now()`로만 구성되고, 파일 생성에 `wx`도 사용하지 않는다. 같은 프로세스에서 같은 파일을 같은 밀리초에 저장하면 두 요청이 같은 임시 파일에 쓴다. 재현에서는 두 저장 중 하나가 성공하고 다른 하나는 rename 대상이 없어 실패했다.

수동 저장의 renderer 큐는 창별이며, main의 `saveSnapshot`에는 경로별 저장 큐가 없다. 여러 창이나 독립된 저장 흐름이 이 경계에 도달할 수 있다. UUID 또는 독점 생성으로 임시 파일을 분리하고, 목적지별 저장 순서를 main에서 조정해야 한다. 임시 파일 충돌 해결과 외부 변경 검증은 각각 필요하다.

### F04 저장하면 기존 파일 권한이 바뀜

**P2 · Linux, umask `022`에서 확인.** [file-system.ts](../apps/desktop/src/main/documents/file-system.ts) 28–36행.

기존 mode를 `writeFile`의 생성 옵션으로 넘겨도 프로세스 umask가 적용된다. 기존 권한이 `0666`인 파일을 저장한 결과 `0644`가 됐다. `0664`인 공유 파일도 같은 원리로 그룹 쓰기 권한을 잃는다.

최종 파일을 rename으로 교체하므로 기존 파일의 권한이 유지되지 않는다. 생성 후 기존 mode를 `chmod`로 복원해야 한다. 이미지·HWP 저장은 이미 이 절차를 수행하지만 텍스트와 초안의 중복 구현에는 빠져 있다.

### F05 Save As가 심볼릭 링크를 파괴함

**P1 · 저장 대화상자의 선택값만 대체하고 실제 파일 I/O로 확인.** [document-manager.ts](../apps/desktop/src/main/documents/document-manager.ts) 207–213행, [file-system.ts](../apps/desktop/src/main/documents/file-system.ts) 27–36행.

Save As에서 `link.md → target.md`를 선택하면 `canonicalPath`를 적용하기 전에 `atomicWrite(selected.filePath)`를 실행한다. rename은 링크를 따라 쓰지 않고 링크 디렉터리 항목 자체를 교체한다. 재현 결과 링크는 일반 파일로 바뀌고, `target.md`의 내용은 그대로였다.

일반 열기는 실제 경로로 정규화하는데 Save As만 다른 의미로 동작한다. 목적지를 실제 경로로 확정한 뒤 저장하거나, 링크를 교체하려는 명시적인 동작으로 구분해야 한다. 초안 첫 저장도 같은 목적지 처리 여부를 함께 검토해야 한다.

### F06 초안 저장이 코드와 외부 URL까지 바꿈

**P1 · 실제 경로 재작성 함수로 확인.** [draft-assets.ts](../apps/desktop/src/main/documents/draft-assets.ts) 36–42행, 79–83행.

자산이 있는 초안을 다른 이름으로 저장하면 `text.split(sourceDirectoryName + '/').join(...)`으로 본문 전체를 바꾼다. 이미지 목적지뿐 아니라 `` `Untitled.assets/a.png` ``라는 코드 예제와 `https://example.test/Untitled.assets/b.png`라는 외부 URL도 `report.assets`로 바뀌었다.

이는 사용자가 수정하지 않은 본문을 저장 단계에서 변경하는 문제다. 실제 로컬 자산을 가리키는 Markdown·HTML 목적지만 식별해 수정하고, 코드 블록·일반 텍스트·외부 URL은 그대로 유지해야 한다.

### F07 인코딩된 초안 이미지 경로가 저장 후 끊김

**P2 · 실제 자산 복사 및 초안 삭제로 확인.** [draft-assets.ts](../apps/desktop/src/main/documents/draft-assets.ts) 36–42행, 79–96행.

`Untitled 2.assets/image.png`를 가리키는 `![x](Untitled%202.assets/image.png)`를 `saved.md`로 저장했다. 실제 파일은 `saved.assets/image.png`로 옮겨졌지만 본문은 `Untitled%202.assets/image.png` 그대로였다. 저장 후 초안 디렉터리가 삭제되므로 링크가 유효하지 않게 된다.

F06의 전역 치환이 과도하게 바꾸는 문제와, 이 항목의 정상 경로를 놓치는 문제는 함께 수정해야 한다. 목적지를 파싱한 뒤 경로 비교에 필요한 부분을 디코딩하고, 새 경로를 올바르게 인코딩해 반환해야 한다.

### F16 읽은 Markdown 내용과 디스크 버전이 어긋남

**P1 · 실제 I/O 사이에 외부 쓰기 시점을 통제해 확인.** [document-manager.ts](../apps/desktop/src/main/documents/document-manager.ts) 38–43행, 173–178행.

Markdown은 `readFile`로 내용을 읽고 그 뒤 경로를 다시 `stat`한다. 그 사이 외부 프로그램이 파일을 저장하면 옛 내용에 새 `diskVersion`이 붙는다. 재현에서는 `old`를 읽은 직후 `new external content`를 기록했다. 이후 옛 버퍼의 자동 저장이 충돌 없이 성공해 외부 내용을 덮어썼다.

이 항목은 발생 빈도를 측정한 경쟁 조건이 아니라, 해당 순서가 발생했을 때 보호 장치가 실패함을 확인한 결과다. 일반 텍스트 로더처럼 같은 파일 핸들에서 읽기 전후 상태를 검증하고, 경로가 다른 inode로 교체된 경우도 구분해야 한다.

### F17 저장 중 최신 편집을 보존하면서 자산 경로 변경을 잃음

**P2 · 자산 저장과 revision 보존 함수의 조합으로 확인.** [tab-controller.ts](../apps/desktop/src/renderer/workspace/tab-controller.ts) 471–483행, [document-save.ts](../apps/desktop/src/core/document/document-save.ts) 25–27행, [draft-assets.ts](../apps/desktop/src/main/documents/draft-assets.ts) 95행.

초안 revision 1의 이미지 경로가 저장 과정에서 `saved.assets`로 바뀌었더라도, 완료 전에 revision 2의 입력이 있으면 `retainUnsavedRevision`은 최신 본문을 통째로 유지한다. 최신 본문에는 여전히 `Untitled.assets`가 있고, 파일 경로는 `saved.md`로 바뀌며 초안 폴더는 이미 삭제됐다.

재현에서 추가 입력은 유지됐지만 이미지 목적지는 사라진 옛 폴더를 참조했다. 저장 결과에 자산 이동 매핑을 포함해 최신 버퍼에도 해당 경로 변경만 적용해야 한다. 사용자 편집을 덮어쓰거나 revision 검사를 없애는 방식으로 해결하면 안 된다.

### F22 자동 저장을 꺼도 대기 작업은 계속 저장됨

**P2 · 저장 포트와 완료 시점을 통제해 확인.** [auto-save.ts](../apps/desktop/src/renderer/workspace/auto-save.ts) 28–32행, 66–94행.

자동 저장을 켜면 모든 dirty 탭이 큐에 들어간다. 첫 번째 파일 저장이 진행 중일 때 자동 저장을 꺼도 `setEnabled(false)`는 타이머만 취소한다. 이미 큐에 들어간 `save()`는 `enabled`를 검사하지 않는다. 재현에서 A 저장 중 비활성화했지만 B 저장도 호출됐다.

진행 중인 I/O의 취소와 아직 시작하지 않은 저장의 취소를 구분해야 한다. 큐에 세대 번호를 부여하거나, 저장 시작 및 `beforeSave` 완료 뒤 현재 활성화 상태를 다시 확인해야 한다.

## Git과 탐색기

### F08 Git 본문을 파일 헤더로 오인함

**P2 · patch 파서로 확인.** [git-service.ts](../apps/desktop/src/main/project/git-service.ts) 28–61행.

`---`와 `+++`로 시작하는 줄을 항상 제외한다. 그러나 hunk 내부에서 원문 `--old`를 삭제하고 `++new`를 추가하면 patch 줄은 `---old`, `+++new`다. 이 정상 변경의 결과가 빈 hunk 목록이었다.

누락뿐 아니라 줄 카운터도 증가하지 않아 뒤쪽 변경 위치가 어긋날 수 있다. 파일 헤더와 hunk 본문 상태를 구분하고, hunk 안에서는 첫 글자의 `-`·`+`를 변경 표시로 처리해야 한다. Markdown 수평선, YAML 구분선, 증감 연산자도 경계 사례에 포함해야 한다.

### F09 스테이징된 파일 이름 변경의 원본이 비어 있음

**P2 · 실제 Git 저장소로 확인.** [git-service.ts](../apps/desktop/src/main/project/git-service.ts) 79–84행, 163–168행.

porcelain v2의 rename 레코드에서 원래 경로를 건너뛰고 버린다. 이후 staged 비교는 `HEAD:새경로`를 읽는다. 내용을 바꾸지 않고 `old.md`를 `new.md`로 `git mv`한 재현에서 `originalText`는 빈 문자열이었다.

원본 전체가 없었던 것처럼 비교가 왜곡된다. `GitChange`에 이전 경로를 보존하고 HEAD 조회에 사용해야 한다. Git history 서비스는 이미 `previousPath`를 다루므로 working-tree 서비스와의 일관성도 맞출 필요가 있다.

### F10 파일명 패턴 때문에 다른 파일까지 Discard함

**P1 · 실제 Git Stage와 Discard로 데이터 변경 확인.** [git-service.ts](../apps/desktop/src/main/project/git-service.ts) 182–185행, 201–212행, 235–241행.

`--`는 옵션 해석을 끝낼 뿐 Git pathspec 패턴을 끄지 않는다. `[ab].txt`, `a.txt`, `b.txt`가 있는 저장소에서 `[ab].txt` 하나를 선택했는데 세 파일 모두 스테이징됐다. 이어 세 파일을 다시 수정하고 같은 파일 하나만 Discard하자 선택하지 않은 `a.txt`의 `new unsaved work`도 이전 내용으로 돌아갔다.

이 항목은 표시 오류가 아니라 실제 다른 파일의 수정 손실이다. 파일 선택을 Git에 전달하는 경계에서 `--literal-pathspecs` 또는 적절한 literal pathspec을 사용해야 한다. Stage·Unstage·Discard·Diff 모두에 같은 규칙을 적용해야 한다.

### F11 외부에서 만든 Git 저장소를 계속 인식하지 못함

**P2 · 실제 Git 저장소로 확인.** [git-service.ts](../apps/desktop/src/main/project/git-service.ts) 110행, 244–249행.

처음 `GitCli.connect(root)`가 `null`을 반환하면 그 Promise가 계속 캐시에 남는다. 폴더를 연 뒤 외부 터미널에서 `git init`하고 다시 status를 요청해도 `repository: false`였다. 앱 내부 initialize만 캐시를 지운다.

탐색기 refresh나 같은 폴더 재열기로도 동일 서비스의 캐시는 살아 있다. 저장소 부재 결과에 유효기간을 두거나 `.git` 생성·삭제 및 폴더 수명 변경에 맞춰 재탐색해야 한다.

### F12 Git이 링크 대신 대상 파일을 조작함

**P1 · 실제 Git Stage와 Discard로 데이터 변경 확인.** [git-service.ts](../apps/desktop/src/main/project/git-service.ts) 202–212행, 235–241행, [project-paths.ts](../apps/desktop/src/main/project/project-paths.ts) 11–17행.

Git 경로 검증이 `inside()`를 사용해 심볼릭 링크를 realpath로 바꾼다. Git은 링크 항목 자체를 추적하므로 이 변환은 의미가 다르다. 재현에서는 `link.txt`를 선택했는데 `other.txt`가 스테이징됐다. 이후 `link.txt` Discard가 대상 `other.txt`의 새 작업까지 되돌렸다.

루트 밖을 가리키는 링크는 선택 동작 자체가 거부될 수도 있다. 탐색기용 `ProjectPaths.entry()`처럼 조상만 정규화하고 마지막 링크 항목은 유지해야 한다. 경로 경계 검증을 없애는 것이 아니라 Git이 조작하는 대상의 정체성을 보존하는 수정이 필요하다.

### F14 읽기 전용 폴더 복사가 실패하고 임시 폴더도 남음

**P2 · Linux 실제 파일 권한으로 확인.** [file-transfer.ts](../apps/desktop/src/main/project/file-transfer.ts) 26–35행, 54–80행.

내용이 있는 `0555` 폴더를 복사하면 staging 단계에서 원본의 읽기 전용 mode를 먼저 적용한다. 이후 다른 부모로 옮기는 단계가 실패하고, `finally`의 재귀 삭제도 쓰기 권한이 없어 실패한다. 재현에서 `.setdown-copy-…/entry/note.txt` 삭제의 `EACCES`가 최종 오류로 나타났으며 정상 복사본을 얻지 못했다.

staging과 commit이 끝날 때까지 필요한 쓰기 권한을 유지한 후 목적지에서 최종 권한을 적용해야 한다. 실패 정리는 임시 트리를 삭제 가능한 권한으로 되돌려야 하며, 정리 오류가 최초 실패 원인을 덮지 않게 해야 한다. 테스트의 임시 파일은 별도로 권한을 복원해 정리했다.

### F19 HWPX 새 파일을 만들자마자 열 수 없음

**P2 · 실제 탐색기 생성 서비스와 문서 로더로 확인.** [explorer-service.ts](../apps/desktop/src/main/project/explorer-service.ts) 45–57행.

New File은 `.hwp`에는 blank 문서를, `.ipynb`에는 빈 notebook 구조를 쓰지만 `.hwpx`에는 빈 문자열을 쓴다. `new.hwpx`를 생성한 직후 `DocumentManager.read()`는 0바이트 파일을 거부했다.

지원하는 컨테이너 형식에는 유효한 빈 템플릿 또는 전용 생성 동작이 필요하다. 생성 지원이 아직 없다면 성공한 문서처럼 바로 열기 전에 명확하게 제한해야 한다. 기존 HWPX 열기 기능 자체가 실패한다는 의미는 아니다.

### F23 큰 Markdown Git 원본을 빈 문서로 처리함

**P2 · 4,100,000바이트 Markdown을 실제 Git에 커밋해 확인.** [git-text.ts](../apps/desktop/src/main/project/git-text.ts) 8–15행, [git-cli.ts](../apps/desktop/src/main/project/engines/git-cli.ts) 32–35행, 41–53행.

Markdown 원본은 4,000,000바이트 `maxBuffer`를 가진 문자열 실행 경로를 사용한다. 이를 초과한 `git show` 오류를 `catch { return ''; }`로 처리한다. 실제로 존재하고 내용이 있는 HEAD blob이 빈 문자열로 반환됐다.

같은 함수의 일반 텍스트 경로는 더 큰 bounded byte read를 사용하므로 포맷별 의미도 다르다. 존재하지 않는 버전, 읽기 실패, 크기 초과를 구분하고 빈 문자열은 실제 빈 내용 또는 명시적으로 없는 버전에만 사용해야 한다. 타임아웃 등의 다른 오류도 같은 catch에 흡수된다.

## 검색과 링크

### F13 Unicode 대소문자 변환이 검색 위치를 깨뜨림

**P2 · 순수 함수와 실제 Electron 44.7.2에서 확인.** [visible-search.ts](../apps/desktop/src/main/project/visible-search.ts) 69–88행, [rendered-search.ts](../apps/desktop/src/core/reading/rendered-search.ts) 18–29행.

`İ`는 기본 소문자 변환에서 `i`와 결합점 두 코드 단위가 된다. 변환한 문자열의 인덱스를 원문의 인덱스로 사용하면 그 뒤의 좌표가 밀린다. 두 문단 `İ`, `x`에서 `x` 검색 결과는 실제 2행 1열 대신 1행 2열이었다. Chromium에서 `<p>İx</p>`의 `x`를 검색했을 때는 Range가 만들어지지 않아 결과가 0개였다.

소문자화 전후의 오프셋 매핑을 유지하거나, 원문 인덱스를 반환하는 대소문자 무시 검색을 사용해야 한다. surrogate pair만 시험하는 것으로는 이 문제를 발견하지 못한다.

### F18 새로 만드는 로컬 링크가 URL 예약 문자를 보존하지 못함

**P2 · 실제 pasted asset 생성과 URL 해석으로 확인.** [pasted-image.ts](../apps/desktop/src/main/documents/pasted-image.ts) 18–19행, 47–53행, [markdown-link.ts](../apps/desktop/src/main/documents/markdown-link.ts) 3–7행.

`notes#1.md`에 이미지를 붙이면 `notes#1.assets/…`라는 목적지를 만든다. URL에서 `#1.assets/…`는 fragment가 되므로 파일 경로는 `notes`에서 끊긴다. 로컬 파일 선택으로 `reference#2.pdf`를 링크하는 경우도 같다. angle bracket은 공백·괄호 문제를 줄일 뿐 URL 예약 문자의 의미를 바꾸지 않는다.

파일 경로의 각 segment를 URL 목적지에 맞게 인코딩해야 한다. 공백·한글·`#`·`?`·`%`·꺾쇠·역슬래시를 포함하는 이름을 묶어 검증해야 한다. 이미 올바르게 인코딩한 링크도 F26의 수신 경로 때문에 별도로 깨질 수 있다.

이 항목은 생성된 Markdown 목적지와 표준 URL 해석 단계에서 확인했다. 앱 미리보기 전체 파이프라인에서 이미지 로드 실패까지 확인한 결과는 아니다.

### F24 Reader 내보내기가 제목에 붙은 id를 버림

**P3 · 실제 HTML→Markdown 변환기로 확인.** [reader-export.ts](../apps/desktop/src/core/browser/reader-export.ts) 28–35행.

`<h2 id="section-123">Heading</h2>`와 그곳을 가리키는 링크를 내보내면 `[Jump](#section-123)`는 남지만 해당 anchor는 사라진다. 특수 규칙은 제목의 자손 `[id]`만 찾고 제목 자신의 `id`는 처리하지 않는다.

제목 자체와 자손의 anchor를 모두 보존하되 중복 id를 만들지 않아야 한다. 현재 테스트는 `<h2><a id="…"></a>…</h2>` 형태만 확인한다.

### F25 숨긴 텍스트가 검색 결과에 포함됨

**P3 · HTML 검색 함수와 실제 Chromium의 computed style로 확인.** [visible-search.ts](../apps/desktop/src/main/project/visible-search.ts) 17–25행, [rendered-search.ts](../apps/desktop/src/core/reading/rendered-search.ts) 8–13행.

프로젝트 검색의 inline-style 제외 정규식은 `display: none !important`를 제외하지 못한다. 실제 화면 검색 함수는 style을 전혀 확인하지 않고 태그와 `[hidden]` 등만 검사한다. Chromium에서 `display`가 `none`임을 확인한 `secret`이 검색 Range에 포함됐다.

사용자는 보이지 않는 결과 개수나 이동 지점을 받는다. 정적 HTML 검색과 실제 DOM 검색이 공유할 가시성 규칙을 정하고, 최소한 `!important` 선언을 포함한 inline 숨김 처리를 일치시켜야 한다. DOM의 style 검사를 추가할 때에는 검색 성능도 함께 검증해야 한다.

### F26 올바른 링크도 전체 디코딩 때문에 바뀜

**P2 · 실제 등록된 open-link IPC handler를 호출해 확인.** [install-ipc.ts](../apps/desktop/src/main/ipc/install-ipc.ts) 237–255행, [resource-url.ts](../apps/desktop/src/main/preview/resource-url.ts) 9–17행.

수신한 URL 전체에 `decodeURIComponent`를 적용하고 나서 `new URL`로 파싱한다. 정상적인 `note%23part.md`는 `note#part.md`로 먼저 바뀌어 경로가 잘린다. 실제로 존재하는 파일인데 열기 호출이 발생하지 않았다. `https://example.test/search?q=a%26b`도 `...?q=a&b`로 변해 쿼리 의미가 달라졌다.

URL은 인코딩된 상태로 먼저 파싱해야 한다. 파일 경로는 `fileURLToPath` 등 해당 계층에서 한 번만 디코딩해야 한다. F18은 링크 생성 단계의 문제이고 F26은 소비 단계의 문제여서 어느 한쪽만 고치면 다른 문제가 남는다.

## 노트북과 언어 기능

### F15 셀 종류 변환 후 잘못된 notebook을 저장함

**P2 · 실제 직렬화 결과를 nbformat 5.11.0으로 검증.** [notebook-document.ts](../apps/desktop/src/core/notebook/notebook-document.ts) 167–171행, 281–313행.

이미지 attachments가 있는 Markdown 셀을 code로 변환하면 `cell_type`, `outputs`, `execution_count`는 바뀌지만 기존 `attachments`도 보존된다. nbformat은 code cell에서 이 속성을 허용하지 않는다. 앱이 실제 생성한 [변환 결과](bug-audit-2026-10-22/converted-code-cell.ipynb)는 `Additional properties are not allowed ('attachments' was unexpected)`로 검증에 실패했다.

원본 속성 보존과 유효한 대상 셀 형식을 함께 만족시켜야 한다. attachments는 Undo용 내부 상태에 남기더라도 code cell JSON에는 내보내지 않아야 한다. code→markdown→code 및 Undo/Redo와 함께 검증해야 한다.

### F20 해제되지 않은 언어 명령이 결과 한도를 소진함

**P2 · 실제 ServerItems와 축소한 메모리 한도로 확인.** [server-items.ts](../apps/desktop/src/main/language/server-items.ts) 14행, 25–30행, 69–76행, [language-manager.ts](../apps/desktop/src/main/language/language-manager.ts) 168–174행.

자동완성 항목을 선택하지 않고 목록을 닫아도 `release()`는 문자열 `command`가 있는 객체를 삭제하지 않는다. 문서가 바뀔 때 호출하는 `forget(id, false)` 역시 그 명령을 유지한다. 선택 후 실행되는 명령을 보호하려는 처리는 있지만, 선택하지 않은 명령을 최종 정리하는 경로가 없다.

4 KiB 한도에서 자동완성→목록 해제→버전 변경을 반복하자 오래된 명령만으로 예산이 소진되어 다음 응답이 거부됐다. 운영 한도는 32 MiB이며 실제 소진 시간은 서버가 반환하는 명령의 수와 크기에 따라 달라진다. 실제 서버를 장시간 실행한 결과로 주장하지 않는다. 선택된 명령의 짧은 실행 수명과 폐기된 목록의 수명을 분리해 정리해야 한다.

### F21 HWP 이름의 FIFO를 열면 응답이 끝나지 않음

**P2 · 실제 named pipe로 확인.** [hwp-file.ts](../apps/desktop/src/main/documents/hwp-file.ts) 15–19행.

`fs.open(file, 'r')`가 완료된 뒤에야 일반 파일 여부를 검사한다. writer가 없는 `pipe.hwp`는 open 자체가 대기하므로 뒤의 `stat.isFile()`에 도달하지 않는다. 재현에서 100 ms가 지나도 완료되지 않았고, 테스트가 writer를 연결해 준 뒤에야 실패 응답이 나왔다.

이는 main JavaScript 전체가 동기적으로 멈춘다는 뜻은 아니지만, 해당 문서 열기 요청과 libuv 작업이 계속 대기한다. 이미지·PDF·일반 텍스트 로더처럼 nonblocking open과 일반 파일 검증을 적용해야 한다. 여러 요청이 누적되면 파일 I/O 작업에도 영향을 줄 수 있다.

## 검증 산출물과 재실행

| 검증 | 결과 | 근거 |
| --- | --- | --- |
| 기존 `npm test` | 136개 파일, 919개 테스트 통과 | [기존 suite 로그](bug-audit-2026-10-22/unit-tests-unsandboxed.log) |
| 감사 재현 | 정상 동작을 요구하는 26개 테스트에서 결함 재현 | [재현 코드](bug-audit-2026-10-22/reproductions.test.ts), [URL IPC 재현](bug-audit-2026-10-22/links.test.ts), [최종 로그](bug-audit-2026-10-22/reproductions-final.log) |
| 실제 Electron 검색 | F13에서 결과 누락, F25에서 숨긴 텍스트 검색 | [구조화 결과](bug-audit-2026-10-22/chromium-results.json), [실행 로그](bug-audit-2026-10-22/chromium-verified.log) |
| notebook 규격 검증 | 실제 변환 결과의 code-cell attachments 거부 | [검증 스크립트](bug-audit-2026-10-22/validate-notebook.py), [로그](bug-audit-2026-10-22/notebook-validation.log) |

감사 테스트는 정상 동작을 assertion으로 작성했기 때문에 **현재 코드에서 실패하는 것이 결함 재현 결과**다. `test.fails`, skip, retry로 성공 처리하지 않았다. 정상 suite와 독립된 설정을 사용하며, 운영 코드와 기존 테스트·성능 계약은 변경하지 않았다.

저장소 루트에서 다음과 같이 실행할 수 있다.

```sh
npm test
node node_modules/vitest/vitest.mjs run --config reports/bug-audit-2026-10-22/vitest.config.ts
bash apps/desktop/scripts/with-isolated-display.sh node reports/bug-audit-2026-10-22/chromium-probe.mjs
python3 reports/bug-audit-2026-10-22/validate-notebook.py
```

감사 재현은 Linux, 일반 사용자 권한, umask `022`에서 실행했다. F04·F14·F21은 운영체제와 권한 조건에 의존한다. Python 검증에는 해당 환경의 `nbformat`이 필요하다. Chromium 검증은 제품의 실제 `rendered-search.ts`를 별도 Electron 페이지에 올린 컴포넌트 실행이며 전체 앱 E2E를 대신하지 않는다. Xvfb, 독립 runtime 디렉터리, 별도 D-Bus 및 프로필을 사용했다.

첫 단위 테스트 실행의 Node 하위 프로세스 생성은 샌드박스에서 `EPERM`으로 차단됐다. 제약 밖에서 동일 suite를 실행해 919개 통과를 확인했으므로 초기 10개 실패는 제품 결함 수에 포함하지 않았다. 감사 실행기의 mock·모듈 경로 오류도 수정한 뒤 결함 자체의 assertion으로 재확인했다.

검토는 주로 자체 코드의 저장·파일·Git·검색·링크·노트북·언어 기능 경계를 대상으로 했다. vendor 전체, 모든 GUI 시나리오, Windows/macOS 동작을 전수 검증한 결과는 아니다. 운영 preview 경로를 변경하지 않았으므로 이번 보고서 작성에서는 preview 전체 계약과 성능 benchmark를 실행하지 않았다. 해당 영역을 수정하는 후속 작업에는 `AGENTS.md`의 필수 검증이 그대로 적용된다.

## 권장 수정 순서와 테스트 보강

1. **Git 선택 범위부터 보호한다.** F10·F12를 수정하고 선택하지 않은 파일의 내용과 index가 불변임을 실제 Git으로 검사한다. Discard 오류는 복구가 가장 어렵다.
2. **텍스트 저장을 하나의 경로별 처리로 정리한다.** F03·F04·F05·F16을 함께 다루되, 고유 임시 파일·목적지 정체성·권한·외부 변경 검증을 각각 시험한다. 이미지·HWP 저장의 기존 검증도 유지한다.
3. **초안 자산 이동을 최신 버퍼와 함께 처리한다.** F06·F07·F17·F18·F26을 수정하고 코드 예제, 인코딩된 목적지, 저장 중 입력을 같은 시나리오에서 검사한다.
4. **문서 수명과 큐의 취소를 명시한다.** F01·F02·F20·F22에 대해 다중 창 감시, 삭제 상태, 폐기된 결과, 기능 비활성화 이후 동작을 검증한다.
5. **형식과 렌더링 경계 사례를 기존 suite에 편입한다.** F08·F09·F11·F13·F14·F15·F19·F21·F23·F24·F25를 각 소유 모듈의 테스트로 옮기고, 검색은 실제 Chromium 검증을 유지한다.

기존 테스트가 놓친 공통 조건은 특수 파일명, 링크의 정체성, 복수 소유자, 작업 중 상태 변경, 길이가 변하는 Unicode 변환, 외부 형식 검증이다. 기능별 정상 흐름에 이 조건들을 교차 적용하는 것이 비슷한 결함의 재발을 줄이는 데 도움이 된다.
