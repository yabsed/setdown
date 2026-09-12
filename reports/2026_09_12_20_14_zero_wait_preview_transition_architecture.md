# 기다리지 않는 Preview: iframe의 장점은 남기고 전환 지연을 없앤 방법

2026년 9월 12일 20:14 KST

## 결론

이번 성능 개선의 비결은 Crossnote나 KaTeX를 더 빨리 계산하게 만든 것이 아니다.
사용자가 누른 버튼의 완료 조건에서 그 계산을 빼낸 것이다.

이전 구현은 `Esc`를 누르면 최신 HTML 생성, iframe navigation, bridge 준비, 의미론적
위치 복원을 차례로 기다린 뒤 Viewer를 보여 줬다. 하나하나는 필요한 일이지만, 모두가
화면 전환의 선행 조건일 필요는 없었다. 특히 iframe 구조로 옮긴 뒤에도 과거 native
view의 거래 방식을 답습하면서, 합성은 좋아졌지만 전환은 느려졌다.

새 구조의 원칙은 간단하다.

> 화면 전환은 동기적인 상태 변경이다. 렌더링과 위치 보정은 그 전환을 따라오는
> 비동기 작업이지, 전환을 허가하는 문지기가 아니다.

따라서 iframe은 버리지 않았다. iframe이 제공한 자연스러운 resize와 DOM 합성은
그대로 남겼다. 대신 이미 완성된 Preview를 계속 보존하고, 새 Preview는 보이지 않는
두 번째 iframe에서 준비하며, 완성된 순간에만 교체한다. 다른 창으로 탭을 옮길 때는
기존 화면의 정지 이미지를 먼저 넘겨 새 iframe의 준비 시간을 가린다.

정답은 `WebContentsView`와 iframe 중 하나를 고르는 일이 아니었다. **iframe의
navigation 수명주기와 사용자가 보는 surface의 수명주기를 분리하는 것**이었다.

## 무엇이 느렸는가

문제 커밋 `5b2eda13ec49ba5f612ad73975793b1f662a3311`은 Preview를
`WebContentsView`에서 iframe으로 옮겼다. 이 결정은 창 resize와 목차 폭 변경 때
흰 틈을 없애는 데 옳았다. Preview가 제품 DOM과 같은 layout pass에 들어왔기
때문이다.

그러나 전환 경로는 다음과 같은 직렬 transaction이 됐다.

```text
Esc
 └─ 현재 Editor anchor 계산
     └─ Crossnote HTML 생성
         └─ iframe URL navigation
             └─ bridge ready 대기
                 └─ source anchor 위치 이동
                     └─ MutationObserver 또는 180ms settle
                         └─ Viewer 노출
```

이 경로에서는 Crossnote가 80ms 걸리면 전환도 최소 80ms 걸린다. iframe의 document
parse와 layout이 120ms 걸리면 전환도 그만큼 늘어난다. 위치 안정화를 위한 180ms
타이머는 성공한 렌더 뒤에도 그대로 사용자 지연이 됐다.

이는 렌더러 성능의 문제가 아니라 의존성 그래프의 문제다. 필요한 작업을 최적화해
각각 절반으로 줄여도 직렬 경로의 합은 여전히 눈에 띈다. 반면 Viewer 노출을 그
그래프의 앞쪽으로 옮기면, 같은 계산 비용을 지불하면서도 입력에 대한 첫 반응은 한
frame 안에 끝낼 수 있다.

## 새 불변식

구현은 다음 다섯 가지 규칙을 지킨다.

1. `Esc`의 첫 frame은 네트워크형 IPC, Crossnote 렌더, iframe load, bridge 응답을
   기다리지 않는다.
2. 마지막으로 정상 완성된 Preview는 새 revision이 완성될 때까지 제거하지 않는다.
3. 새 iframe은 숨은 상태에서 load와 의미론적 위치 복원을 모두 끝낸 뒤 승격한다.
4. Editor와 Viewer는 문서가 열린 동안 같은 grid cell에 계속 존재한다.
5. 창 간 탭 이동의 소유권 이전과 포커스 변경은 임의 시간값이 아니라 완료 사건으로
   연결한다.

이 규칙의 결과로 “최신 내용이 준비됨”과 “사용자 입력에 즉시 반응함”이 서로 다른
상태가 됐다. 잠깐 오래된 Preview가 보이는 것은 허용하지만, 빈 화면이 보이는 것은
허용하지 않는다. 새 내용은 준비가 끝나기 전에는 절대로 반쯤 나타나지 않는다.

## 첫 번째 비결: 두 surface를 계속 살려 둔다

과거에는 보이지 않는 surface를 `display:none`으로 껐다. 다시 켜는 순간 브라우저는
그 subtree의 layout과 paint를 되살려야 한다. 이제 Editor와 Viewer는 같은 grid
cell에 포개져 있고, 비활성 surface에는 `visibility:hidden`과 입력 차단만 적용한다.

```css
.shell[data-surface="editor"] .viewer-surface,
.shell[data-surface="viewer"] .editor-surface {
  visibility: hidden;
  pointer-events: none;
}

.shell[data-surface="editor"] .viewer-surface .preview-frame.is-active {
  visibility: hidden;
  pointer-events: none;
}
```

두 번째 규칙은 사소해 보이지만 중요하다. 활성 iframe은 자체적으로
`visibility:visible`을 선언하므로 부모의 숨김을 덮어쓸 수 있다. 이를 명시적으로
다시 막지 않으면 보이지 않는 Viewer가 Monaco의 마우스 입력을 가로챈다.

이 방식은 `display:none`과 달리 iframe의 layout context를 없애지 않는다. 따라서
창 크기나 목차 폭이 바뀌는 동안에도 Preview는 실제 최종 크기에 맞춰져 있다. 화면을
전환하는 순간 새로 측정할 것이 없다.

## 두 번째 비결: Esc와 위치 보정을 분리한다

`enterViewer()`는 anchor를 계산한 뒤 곧바로 surface를 바꾼다. 이미 준비된 Preview가
있다면 위치 명령을 먼저 보내지만, 응답을 기다리지는 않는다. 최신 revision 준비도
화면 전환 뒤에 이어지는 background 작업이다.

```ts
async function enterViewer() {
  const targetAnchor = editorViewportAnchor();
  const availableRevision = previewCoordinator.readyRevision;

  if (availableRevision !== null) {
    void requestPreviewPosition(
      targetAnchor,
      availableRevision,
      activeTabId ?? '',
      model.getLineCount(),
      false,
    );
  }

  setSurface('viewer');

  void ensurePreview(revision).then((ready) => {
    if (!ready) return;
    void requestPreviewPosition(targetAnchor, revision, activeTabId ?? '',
      model?.getLineCount() ?? 1, false);
  });
}
```

여기서 마지막 인자 `false`는 “위치를 대충 맞춰도 된다”는 뜻이 아니다. DOM 변이가
끝나는 것을 180ms 동안 관찰한 뒤 확인 응답을 보내는 안정화 절차를 전환의 critical
path에서 제외한다는 뜻이다. 이미 조판된 iframe에서는 위치를 적용하고 다음 animation
frame에 응답하면 충분하다.

더 나아가 Editor를 스크롤하는 동안 숨은 Preview도 다음 frame에 같은 의미론적
anchor로 이동한다. `Esc`를 누르는 시점에는 대부분의 위치 작업마저 이미 끝난 셈이다.
cursor 줄을 따르는 것이 아니라 화면의 황금분할 지점에 보이는 source line을 따르기
때문에 긴 수식이나 테마별 행간 차이에도 의미가 유지된다.

## 세 번째 비결: iframe을 그 자리에서 다시 읽히지 않는다

iframe의 `src`를 바꾸는 순간 기존 document는 사라진다. 새 HTML이 준비될 때까지
배경만 남는 것은 브라우저의 자연스러운 동작이다. 그러므로 활성 iframe을 직접
navigate하면서 흰 화면을 CSS로 감추려는 접근에는 한계가 있다.

새 구현은 탭마다 활성 iframe과 준비 중 iframe을 구분한다.

```ts
type PreviewFrame = {
  element: HTMLIFrameElement;
  loadingElement: HTMLIFrameElement | null;
  loadingOrigin: string | null;
  ready: boolean;
  // ...
};
```

새 revision의 transaction은 다음 순서다.

```text
현재 iframe r10 ───────────────────────────────┐
                                               │ 계속 표시
숨은 iframe r12: navigate → bridge ready       │
                    → anchor 복원              │
                    → 준비 완료                │
                                               ▼
                                  한 번의 DOM 교체로 r12 승격
```

핵심 commit 부분은 작다.

```ts
const wasActive = frame.element.classList.contains('is-active');
loadingElement.classList.toggle('is-active', wasActive);
loadingElement.setAttribute('aria-hidden', String(!wasActive));
loadingElement.inert = !wasActive;

frame.element.remove();
frame.element = loadingElement;
frame.loadingElement = null;
frame.url = url;
frame.ready = true;
```

중요한 점은 `previewUrl`, `previewRevision`, `ready`도 이 commit 전에는 갱신하지
않는다는 것이다. navigation을 시작했다는 사실과 사용자에게 보여 줄 준비가 됐다는
사실을 혼동하지 않는다. 새 작업이 실패하거나 더 최신 revision에 추월당하면 숨은
iframe만 버리고 기존 정상 Preview는 남긴다.

이것은 영상 플레이어의 double buffering과 같은 발상이다. 계산 자체를 없애지는
않지만, 불완전한 frame을 사용자에게 노출하지 않는다.

## 네 번째 비결: 다른 창에는 먼저 연속성을 넘긴다

DOM iframe은 다른 `BrowserWindow`로 reparent할 수 없다. 따라서 창 간 탭 이동에서
새 iframe navigation 자체를 완전히 없애는 것은 불가능하다. 중요한 것은 이 제약을
부정하는 대신, navigation과 시각적 인계를 분리하는 것이다.

드래그를 시작하면 main process가 현재 Preview 영역을 `capturePage()`로 캡처한다.
대상 창은 탭 상태와 이 이미지를 먼저 설치하고, 원래 사용하던
`marktex-preview:` URL을 숨은 iframe에서 다시 연다.

```text
원본 Preview 캡처
        │
        └─ 대상 창에 탭 + snapshot 즉시 설치
                           ├─ transfer commit → 원본 탭 소유권 해제
                           │
                           └─ 같은 Preview URL을 background load
                                               │
                                               └─ ready 후 snapshot 제거
```

따라서 새 창이 잠깐 비어 있거나 문서 첫 줄을 보여 주지 않는다. 캡처는 렌더 결과를
대체하는 cache가 아니라, 두 compositor 사이의 짧은 handoff frame이다.

과거의 고정된 250ms detach grace도 제거했다. 시간은 소유권을 증명하지 못한다.
느린 장치에서는 짧고 빠른 장치에서는 낭비다. 이제 대상 창이 transfer를 완료하면
원본 창이 실제 탭 제거를 끝내고 `tabs:release-source`를 보낸다. 그 사건을 받은 뒤에만
main process가 대상 창에 focus를 준다. 이로써 지연을 줄이면서도 포커스가 다시 원본
창으로 튀는 경쟁을 없앴다.

## 무엇을 하지 않았는가

이번 변경은 다음과 같은 화려한 최적화를 의도적으로 하지 않았다.

- Crossnote parser를 증분 parser로 다시 작성하지 않았다.
- KaTeX 조판을 별도 cache로 복제하지 않았다.
- iframe을 제거하거나 native view로 회귀하지 않았다.
- 흰 화면을 비슷한 배경색으로 덮어 문제를 숨기지 않았다.
- 짧은 타이머를 넣어 경쟁이 덜 보이게 만들지 않았다.

이 선택들은 계산 시간을 줄일 수 있지만 복잡성과 정확성 비용이 크다. 현재 병목은
계산량보다 계산을 기다리도록 만든 제어 흐름이었다. 먼저 critical path를 짧게 하는
편이 효과가 크고 시스템의 경계도 더 명확하다.

## 성능과 정확성의 대가

공짜인 구조는 아니다. double buffering 중에는 한 탭이 iframe 두 개를 잠시 보유한다.
창 이동 snapshot도 짧게 메모리를 사용한다. 수식이 큰 문서 여러 개가 동시에 갱신되면
peak memory가 증가할 수 있다.

그러나 이는 지속 비용이 아니다. 준비 iframe은 commit 또는 실패 직후 제거되고,
snapshot은 실제 iframe의 위치 복원이 끝난 다음 animation frame에 제거된다. 반대로
사용자가 얻는 이익은 매 전환마다 발생한다. Markdown Preview처럼 읽기와 편집을 자주
오가는 제품에서는 이 교환이 타당하다.

또 하나의 선택은 최신 revision이 아직 준비되지 않았을 때 마지막 정상 revision을
잠깐 보여 주는 것이다. 제품은 이를 빈 화면보다 낫다고 본다. 준비 중임은 별도 상태로
표현할 수 있지만, 기존 내용을 파괴해서는 안 된다.

## 검증

성능 개선은 체감만으로 판정하지 않았다. E2E에 전환 시작부터 첫 animation frame까지의
시간을 기록하고 50ms 미만이라는 상한을 두었다. 이 측정은 Crossnote 렌더 완료 시간이
아니라 사용자의 `Esc`에 셸이 반응하는 시간을 본다. 바로 그것이 이번 변경의 목표다.

최종 결과는 다음과 같다.

- `npm run typecheck`: 통과
- Vitest: 11 files, 63 tests 통과
- Electron Playwright E2E: 4 tests 통과
- Editor → Viewer 첫 frame: 50ms 미만 조건 통과
- 창 간 탭 이동: snapshot 사용, 동일 Preview URL 재사용, 의미론적 anchor 복원 확인
- 탭 이동 뒤 원본·대상 창의 탭 소유권과 focus 확인
- 테마 변경, 목차, 검색, 창 resize 회귀 없음

## 앞으로 지켜야 할 경계

향후 기능을 추가할 때 다음 질문 하나로 전환 지연 회귀를 상당 부분 막을 수 있다.

> 이 `await`는 결과의 정확성을 위해 필요한가, 아니면 사용자가 화면을 보는 것을
> 허가하기 위해 필요한가?

전자인 작업은 background transaction에 둘 수 있다. 후자인 작업만 surface 전환 앞에
있어야 한다. 현재 구조에서 surface 전환 앞에 허용되는 것은 로컬 anchor 계산과 DOM
상태 변경뿐이다.

테마, 검색, 목차, 수식 편집이 더 복잡해져도 이 경계를 유지해야 한다. Preview 결과는
revision 단위로 완성한 뒤 원자적으로 교체하고, resize는 DOM layout에 맡기며, 창 간
이동은 정지 화면으로 시각적 연속성을 보장한다. 계산이 빨라지면 좋다. 그러나 제품의
즉시성은 계산 속도에 의존해서는 안 된다.

<details>
<summary>관련 파일 지도</summary>

```text
src/
├── main/main.ts
│   ├── Preview 화면 capture
│   └── 탭 transfer 소유권·focus protocol
├── preload/index.ts
│   └── transfer 완료/원본 해제 IPC 경계
├── preview/bridge.ts
│   └── non-settling 의미론적 위치 명령
├── renderer/
│   ├── main.ts
│   │   ├── persistent surface
│   │   ├── double-buffer iframe
│   │   ├── 즉시 Esc 전환
│   │   └── snapshot handoff
│   └── style.css
│       └── visibility와 pointer ownership
└── shared/contracts.ts
    └── Preview snapshot 및 transfer 계약

test/e2e/
├── preview-reading-tools.spec.ts
│   └── 50ms 첫 frame과 Preview 연속성 검증
└── tab-detach.spec.ts
    └── 창 이동 snapshot·URL·anchor·focus 검증
```

</details>
