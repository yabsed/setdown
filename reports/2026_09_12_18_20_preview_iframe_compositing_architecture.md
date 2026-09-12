# Preview 흰 틈 제거: DOM iframe 합성 구조

2026년 9월 12일 18:20 KST

> 이 문서는 `2026_09_12_17_27_preview_controls_and_theme_state_architecture.md`의
> `WebContentsView` bounds 보정안을 대체한다.

## 결론

흰 틈의 원인은 색상이 아니라 서로 다른 레이아웃 시스템이었다. 제품 셸과 목차는
renderer DOM에서 flex/grid로 배치됐지만 Preview는 main process의
`WebContentsView`였다. 창 또는 목차 폭이 바뀔 때 다음 경로가 필요했다.

```text
DOM layout → rect 측정 → renderer/main IPC → WebContentsView.setBounds()
```

창의 native surface와 DOM, Preview surface가 같은 합성 frame에 확정된다는 보장이
없으므로 IPC를 빠르게 하거나 배경색을 맞춰도 틈 자체는 남는다.

최종 구현은 문서별 Crossnote Preview를 renderer의 sandbox iframe으로 옮겼다.
iframe은 `.preview-frames`의 실제 DOM 자식이며 `position:absolute; inset:0`으로
부모와 같은 layout pass에서 크기가 정해진다. 목차 on/off와 창 resize에는 rect
측정, `ResizeObserver`, IPC, `setBounds()`가 전혀 없다.

이 구조는 vendor로 확인한 VS Code Markdown Preview Enhanced의 실제 경계와도
맞는다. MPE는 VS Code webview panel을 만들고, VS Code의 webview 구현은 내부에
100% 크기의 sandbox iframe을 둔다. Setdown도 Crossnote 렌더 엔진은 유지하면서
호스트 합성 방식만 이 경계로 맞췄다.

## 제거한 구조

- main process의 탭별 `WebContentsView` registry
- `preview:create/load/show/command/destroy/message` IPC
- Preview 전용 preload bundle
- renderer의 bounds 측정과 resize observer
- 탭 이동 시 native view reparent transaction
- 창 resize 때 오른쪽·아래 edge를 먼저 늘리는 배경 보정

main process에는 로컬 문서 렌더와 `marktex-preview:`/`marktex-resource:` protocol,
allowlist 기반 테마 자산 제공만 남겼다.

## iframe 수명주기

각 탭은 iframe 하나를 가진다. 비활성 iframe은 `display:none`으로 정지시키지 않고
같은 영역에 겹친 채 `visibility:hidden`, `pointer-events:none`, `inert`로 입력만
차단한다. 따라서 비활성 문서도 layout과 테마 변경을 미리 처리한다.

iframe `load`는 제품 bridge의 준비 완료를 뜻하지 않는다. bridge가
`marktex:ready`를 parent에 보내야 load transaction이 완료된다. 그전 명령은 탭별
queue에 보관한다. 이 계약으로 탭 분리 직후 의미론적 위치 복원이 navigation과
경합하지 않는다.

테마는 일회성 broadcast가 아니라 전역 reader state다. 현재 테마 자산을 renderer가
보관하고 모든 iframe의 `ready` 때 다시 동기화한다. 초기 HTML에도 theme id를 넣어
background tab의 초기 상태와 명령 상태가 어긋나지 않게 했다. 테마 stylesheet가
조판을 바꿀 때는 기존 pixel Y 대신 source line과 viewport 비율을 복원한다.

Preview 안에서 시작한 `Ctrl/Cmd+F`는 bridge가 parent에 요청하고, parent가 검색 UI를
연 뒤 input에 focus한다. 별도의 native focus 이관 IPC는 필요 없다.

## 검증

- `npm run build`: 통과
- Vitest: 10 files, 61 tests 통과
- Electron E2E: 4 tests 통과
  - 목차 토글과 창 resize 뒤 iframe과 host 크기가 1px 이내로 일치
  - Preview 내부 `Ctrl+F`가 제품 검색 input에 focus
  - 활성·비활성 두 문서가 navigation 없이 Night 테마로 준비됨
  - 테마 변경 뒤 source anchor의 의미론적 위치 유지
  - 탭 분리 뒤 새 iframe이 같은 source anchor를 복원

## 후속 수정: 테마 authority와 검색 overlay

창별 `localStorage`에 theme id를 저장하면 메뉴를 소유하는 main process와 각 창이
서로 다른 값을 참조한다. 포커스 창에만 테마 명령을 보내던 동작까지 겹쳐, 메뉴의
checked 상태·처음 렌더한 HTML·기존 창·새 창 사이에 공통 기준이 없었다.

테마 authority를 main process의 `globalPreviewTheme` 하나로 통합했다. 값은
`userData/reader-settings.json`에 저장하며 앱 준비 단계에서 메뉴와 창을 만들기 전에
읽는다. 메뉴 선택은 모든 열린 창에 broadcast되고, 새 창과 재실행된 앱은 Preview를
렌더하기 전에 `preview:get-theme`로 같은 값을 받는다. 창별 `localStorage`에는 이제
목차 열림 상태만 저장한다.

검색 UI는 `.viewer-surface`의 grid row에서 제거했다. 우측 상단에 absolute overlay로
배치해 열고 닫아도 `.reader-body`와 iframe의 크기가 바뀌지 않는다. 따라서 검색을
시작한다는 이유로 Preview가 재배치되거나 의미론적 viewport anchor가 흔들리지 않는다.
통합 테스트는 검색 전후 Preview bounds가 완전히 같은지, 열린 두 창과 앱 재실행 후
Preview 및 메뉴가 모두 Night를 가리키는지 검증한다.
