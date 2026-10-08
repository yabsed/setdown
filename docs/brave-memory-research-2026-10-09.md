# Brave 메모리 관리와 Setdown 적용 설계

Setdown에는 Brave의 **자원 수명 관리 원칙을 강하게 적용할 수 있다.** 가장 큰 기회는 사용하지 않는 웹 화면과 재생성 가능한 문서 자원을 회수하는 데 있다. Chromium 엔진을 수정하기 전에 Setdown이 어떤 화면을 실제로 사용 중인지 정확히 전달하고, 탭의 정체성과 화면의 수명을 분리해야 한다.

우선순위는 **웹 페이지의 숨김 상태 전달 검증과 수정 → 캐시 용량 관리 → 안전한 웹 탭 회수 → 문서 미리보기의 선택적 회수**다. 편집 모델과 undo, 최근 사용한 미리보기의 빠른 전환은 보호해야 한다. 메모리를 줄이려고 매번 문서 렌더링과 페이지 로드를 반복하면 Setdown의 핵심 경험이 나빠진다.

분석 기준은 Setdown `49bf7578819e8a05369b7cb7eae01c73476aeb77`, Brave core `97d6dfdfeff3e6855d4f6868e616a61454635de8`이다. Brave의 package.json은 `1.99.26`과 Chromium `156.0.8078.25`를 지정한다. Setdown 실측 실행 환경은 Electron `38.8.6`, Chromium `140.0.7339.249`다. 따라서 아래 Chromium 156 정책은 참고 구현이며, Setdown에서 이미 실행되는 정책으로 해석하면 안 된다. 기능 기본값도 사용자 설정·플랫폼·실험 설정에 따라 실제 활성 상태와 다를 수 있다.

## Setdown에서 확인한 실행 결과

기존 production build를 별도 Xvfb와 임시 프로필로 실행했다. 로컬 HTTP 페이지마다 3,000개 문단과 실제로 값을 채운 8MiB Uint8Array를 만들었다. 사용자 프로필과 데스크톱은 사용하지 않았다. 앱의 `app.getAppMetrics()`에 포함된 PID별 `/proc/PID/smaps_rollup`을 읽었다. PSS는 공유 메모리를 공유 프로세스 수에 따라 나눠 계산한 값이다.

| 상태 | 앱 전체 PSS | 앱 전체 private 메모리 | 프로세스 수 |
| --- | ---: | ---: | ---: |
| 웹 탭을 열기 전 | 343.9MiB | 228.6MiB | 5 |
| 웹 탭 1개 | 596.2MiB | 440.8MiB | 8 |
| 웹 탭 8개 | 930.7MiB | 765.9MiB | 15 |
| 같은 상태에서 5초 더 대기 | 949.9MiB | 786.3MiB | 15 |
| 뒤의 웹 탭 7개를 닫고 3초 대기 | 689.0MiB | 535.3MiB | 8 |

이 실행에서는 같은 origin의 페이지도 서로 다른 renderer PID를 사용했다. 페이지를 닫으면 실제 자원을 회수할 수 있다는 근거다. 전체 PSS 감소는 약 260.9MiB였지만, 이는 **자동 회수 기능을 구현한 결과나 실제 웹사이트의 절감률이 아니다.** 각 조건 1회 진단이고, 초기화 중인 uBO 등 공용 프로세스의 메모리 변화도 포함한다. 강제 GC는 사용하지 않았다.

더 중요한 결과는 두 탭으로 별도 확인한 표시 상태다.

| 첫 번째 웹 탭 | 네이티브 `getVisible()` | 페이지 `document.visibilityState` | rAF 카운터 |
| --- | --- | --- | ---: |
| 두 번째 탭으로 이동한 뒤 | `false` | `visible` | 312 |
| 5초 후 | `false` | `visible` | 613 |

네이티브 뷰는 숨겨졌지만 페이지는 foreground 상태로 남아 초당 약 60회 rAF를 실행했다. `backgroundThrottling`도 `true`였다. 따라서 현재 코드의 `setVisible(false)`만으로 Chromium의 페이지 백그라운드 처리가 작동한다고 가정할 수 없다. 이 결과는 Linux/Xvfb/Electron 38의 해당 실행에 대한 것이며 다른 플랫폼 전체로 일반화하지 않는다.

[BrowserManager.layout](../apps/desktop/src/main/browser/browser-manager.ts)은 네이티브 표시만 바꾼다. Electron 38의 [View::SetVisible](https://github.com/electron/electron/blob/v38.8.6/shell/browser/api/electron_api_view.cc)은 Views 계층에 표시 상태를 전달하고, [WebContentsView 구현](https://github.com/electron/electron/blob/v38.8.6/shell/browser/api/electron_api_web_contents_view.cc)은 별도의 소유 창 연결을 관리한다. 수정 시 이 경로에서 Blink의 visibility까지 전달되는지 확인해야 한다. DOM 속성을 덮어쓰거나 가짜 visibilitychange를 보내는 방법은 엔진 스케줄러를 바꾸지 않는다.

첫 웹 탭을 연 뒤에는 페이지뿐 아니라 uBO background page와 Places도 생긴다. 이 실행에서 uBO에 대응하는 renderer의 PSS는 초기 약 200MiB에서 마지막 약 274MiB까지 변했다. 웹 페이지 1개 비용과 브라우저 공용 초기화 비용을 나누어 측정해야 한다는 뜻이다. 이 짧은 구간의 증가만으로 uBO 누수라고 판단할 수 없다. 웹 탭을 열기 전에도 preview utility process가 약 97.5MiB를 사용했다. 웹 전용 사용자의 기본 비용을 줄일 후보지만, 미리보기 첫 전환 속도와 함께 검증해야 한다.

원시 측정값, 프로세스별 분류, 실행 버전과 빌드 해시는 [진단 JSON](brave-memory-research-2026-10-09.json)에 있다.

## Brave와 Chromium에서 가져올 원칙

### 탭 기록과 살아 있는 페이지를 분리한다

Brave의 [discard 테스트](../vendor/brave-core/browser/ui/tabs/test/brave_tab_features_discard_browsertest.cc)는 기존 WebContents가 파괴되는 것을 기다린 후, 같은 TabInterface에서 새로운 WebContents를 얻어 다시 로드한다. 유지되는 것은 논리적 탭이며, 웹 페이지의 JS heap 전체가 아니다.

이 교체는 주변 기능에도 영향을 준다. [Speedreader controller](../vendor/brave-core/browser/ui/views/page_action/speedreader_page_action_controller.cc)는 `RegisterWillDiscardContents`에서 기존 observer를 끊고 새 WebContents에 붙인다. 그 콜백 시점에는 `tab->GetContents()`가 아직 이전 객체를 가리키므로 인자로 받은 새 객체를 사용한다. [ContainersWebContentsUserData](../vendor/brave-core/components/containers/content/browser/containers_web_contents_user_data.cc)는 교체 시 storage partition의 container 정보를 복사한다.

Setdown도 같은 탭 ID, 파일↔웹 이동 기록, session, 창 소유권을 유지하면서 웹 화면만 회수해야 한다. 현재 [destroyed 처리](../apps/desktop/src/main/browser/browser-manager.ts)는 `views`와 저장 탭을 삭제하고 renderer에 `close` 이벤트를 보낸다. 이를 그대로 사용하면 메모리 회수가 사용자 탭 닫기로 바뀐다. 특히 이전 화면의 늦은 destroyed 이벤트가 같은 ID로 생성한 새 화면을 삭제하지 않도록 세대 번호와 객체 동일성 확인이 필요하다.

### 회수 가능 여부와 회수 시점을 따로 판단한다

Chromium의 [DiscardEligibilityPolicy](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/chrome/browser/performance_manager/policies/discard_eligibility_policy.cc)는 활성·최근 표시, 현재·최근 오디오, PiP, PDF, 입력·편집, 캡처, 장치 연결, 고정 탭, DevTools와 예외 사이트 등을 확인한다. 알림 허용과 백그라운드 title/favicon 변경은 proactive 회수에 추가로 관여한다. 판정도 eligible/protected/disallowed로 나누며, 외부 강제 회수와 메모리 증가에 따른 회수는 일반 proactive 경로와 다르다.

따라서 “Brave는 입력한 페이지를 어떤 상황에서도 버리지 않는다”는 해석도 틀리다. 긴급 상황과 플랫폼에 따라 보호를 다루는 경로가 다르다. Setdown은 편집 도구이므로 초기 정책에서 보호 조건을 더 엄격하게 적용하는 편이 타당하다. 시스템 압박이 심해져도 저장하지 않은 편집 상태를 자동으로 희생시키는 정책은 기본값으로 두지 않는다.

[MemorySaverModePolicy](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/chrome/browser/performance_manager/policies/memory_saver_mode_policy.cc)는 표시되면 타이머를 취소하고, 숨겨지면 설정에 따라 타이머를 시작한다. 이 버전의 시간은 conservative 6시간, medium 4시간, aggressive 2시간이다. 재방문 횟수가 모드별 한도를 넘은 탭은 타이머 시작 대상에서 빠진다. 컴퓨터가 절전 상태였던 시간도 그대로 비활성 사용 시간으로 계산하지 않는다.

Setdown에 가져올 핵심은 숫자보다 **최근 사용, 자주 돌아오는 정도, 복원 비용, 안전 조건을 함께 보라**는 점이다. 특히 문서와 참고 사이트를 수십 초마다 오가는 사용 패턴에서는 단순 LRU 하나만으로 회수하면 반복 재로딩이 발생한다.

### 필요한 만큼 회수하고 관측 비용도 관리한다

[PageDiscardingHelper](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/chrome/browser/performance_manager/policies/page_discarding_helper.cc)는 적격 후보를 모아 중요도에 따라 처리한다. 회수 목표량을 받은 경우에만 후보 메모리를 추정하고 목표에 도달하면 멈춘다. 프로세스가 여러 프레임을 공유할 수 있어서 process memory를 그대로 탭마다 더하지 않는다. 해당 구현의 메모리 분배도 프레임별 추정치이며 정확한 탭 독점 사용량은 아니다.

[UrgentPageDiscardingPolicy](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/chrome/browser/performance_manager/policies/urgent_page_discarding_policy.cc)에서 ChromeOS는 목표량에 따른 다중 회수를 사용할 수 있고, 다른 플랫폼 경로는 한 페이지를 회수한다. Setdown Linux에 ChromeOS 동작이 그대로 존재한다고 가정해서는 안 된다.

Brave 자체의 [PerformanceManager override](../vendor/brave-core/chromium_src/chrome/browser/performance_manager/chrome_browser_main_extra_parts_performance_manager.cc)는 upstream 구현을 포함하면서 PageResourceMonitor와 MetricsProviderDesktop 초기화를 대체한다. 주석의 목적은 사용하지 않는 UMA/UKM 수집의 CPU 비용 제거다. Memory Saver 전체를 제거하는 코드가 아니다. Setdown에서도 메모리 관측을 위해 매초 모든 탭에 JS를 실행하거나 캡처를 만들면 관측 자체가 부하가 된다. 저빈도 프로세스 측정과 자원 생성·해제 이벤트를 조합해야 한다.

### Freeze와 discard는 다른 도구다

숨김은 표현 상태이고, background throttling은 작업 실행을 줄이는 정책이다. Freeze는 많은 페이지 작업을 멈추지만 DOM과 JS 상태를 계속 보유한다. Discard는 페이지를 해제하고 필요할 때 다시 로드하므로 더 큰 회수 여지가 있지만 웹 앱의 메모리 상태를 잃는다.

Chromium의 [FreezingPolicy](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/components/performance_manager/freezing/freezing_policy.cc)는 browsing instance를 공유하는 페이지들의 연결 집합을 계산한다. 하나씩 임의로 멈추면 서로 의존하는 페이지나 락을 가진 작업에 문제가 생길 수 있기 때문이다. 가시성·오디오·Web Locks·IndexedDB의 blocking lock·장치 연결 등도 관여한다. 동결 후에도 private footprint가 증가하는 browsing instance를 관측해서 discard하는 경로가 있다.

[해당 버전의 기능 기본값](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.25/components/performance_manager/features.cc)에서 동결 후 메모리 증가 회수는 켜져 있고 임계치는 100MiB다. 반면 `InfiniteTabsFreezing`과 `InfiniteTabsFreezingOnMemoryPressure`는 꺼져 있다. 후자의 직접 메모리 압박 검사 구현은 Windows 조건부다. 이런 실험 코드를 발견했다고 Linux Brave와 Electron에서 모두 작동하는 기능으로 소개하면 안 된다.

Setdown의 Electron API에는 Chrome의 TabInterface/PerformanceManager 기반 탭 discard 정책을 직접 호출하는 공개 인터페이스가 없다. Chromium feature flag만 추가해서 이 애플리케이션 계층이 생기지는 않는다. CDP를 통한 동결 실험은 가능하더라도 연결 페이지, 장치, 앱 수명과 복구를 검증해야 하므로 첫 구현의 기반으로 삼기에는 부담이 크다.

### 재생성 가능한 데이터는 선택적으로 버린다

Brave의 Rust adblock [RegexManager](../vendor/brave-core/third_party/rust/chromium_crates_io/vendor/adblock-v0_13/src/regex_manager.rs)는 정규식을 필요할 때 컴파일하고, 오래 사용하지 않은 컴파일 결과를 비운다. 기본 cleanup 간격은 30초, 미사용 기준은 180초다. 독립 타이머가 항상 도는 것은 아니며 [Blocker가 manager를 빌릴 때](../vendor/brave-core/third_party/rust/chromium_crates_io/vendor/adblock-v0_13/src/blocker.rs) 시간을 갱신하고 정리를 검사한다. 다시 필요하면 규칙으로부터 재컴파일한다. Brave C++의 override feature는 기본 비활성이므로 override에 적힌 `cleanup_interval_sec = 0`을 기본 동작으로 읽으면 안 된다.

[Engine](../vendor/brave-core/third_party/rust/chromium_crates_io/vendor/adblock-v0_13/src/engine.rs)은 필터 데이터를 FlatBuffers 형식으로 구성하고 network/cosmetic 쪽에서 같은 context를 참조한다. 이 버전의 [VerifiedFlatbufferMemory](../vendor/brave-core/third_party/rust/chromium_crates_io/vendor/adblock-v0_13/src/flatbuffers/unsafe_tools.rs)는 정렬된 Vec로 복사하므로 디스크 mmap이나 완전한 zero-copy로 설명할 수 없다. Setdown에 중요한 교훈은 원본·파생 결과의 소유권, 불필요한 복제, 재구성 비용을 함께 관리하는 것이다.

또한 [RewardsDatabase](../vendor/brave-core/components/brave_rewards/core/engine/rewards_database.cc)와 [Ads Database](../vendor/brave-core/components/brave_ads/core/internal/database/database.cc)는 메모리 압박 콜백에서 SQLite `TrimMemory()`를 호출한다. 영구 데이터 자체를 삭제하지 않고 재생성 가능한 메모리를 줄이는 방식이다. Setdown의 IndexedDB에 이 메서드를 그대로 쓸 수는 없지만 JS 검색 캐시와 서비스 수명에는 같은 원칙을 적용할 수 있다.

광고·추적 요청을 막으면 해당 스크립트·이미지·iframe이 차지할 자원을 예방할 수 있다. Setdown은 이미 uBO를 사용한다. Brave Shields를 함께 붙이는 것으로 추가 절감이 보장되지는 않는다. uBO 교체는 필터 정확성, cosmetic filtering, scriptlet, 예외 설정과 업데이트까지 포함하는 별도 호환성 작업이며, 이 조사만으로 정당화되지 않는다.

## Setdown 자원별 적용 범위

| 자원 | 현재 수명 또는 제한 | 적용 방향 | 적용 강도 |
| --- | --- | --- | --- |
| 웹 WebContentsView | 방문한 탭은 숨겨도 살아 있음 | 표시 상태 전달 수정, 적격 탭의 화면만 회수 | 높음 |
| 재시작 복원 탭 | `dormant` 메타데이터로 보관 | 런타임 회수 상태와 공통화 | 높음 |
| preview HTML 저장소 | 삽입 시 약 64개로 제한, 바이트 제한 없음 | 실제 소비자와 탐색 중 참조를 보호하며 byte budget 적용 | 높음 |
| 검색 visible index | 최대 128개, 전체 text도 보유 | byte budget과 문서별 폐기, 큰 항목의 캐시 제외 | 높음 |
| Crossnote Notebook | 폴더·테마별 Map, 새 Markdown 열기 등에서 전체 reset | 참조·용량 기반의 선택적 관리 | 중간 |
| Git baseline과 row cache | 16MiB/8항목, 64MiB/16페이지 | 기존 제한 유지, 압박 시 단계적 축소 | 중간 |
| 미리보기 spare | 창마다 준비된 native view | 압박 시 제거하고 즉시 재생성하지 않도록 제어 | 중간 |
| Markdown·Git native preview | 빠른 전환을 위해 resident 유지 | 최근·활성·준비 중 화면 보호, 오래된 화면만 별도 정책 | 조건부 |
| PDF·이미지 surface | 기본 capacity 3, 보이는 group 보호 | 디코딩 비용을 반영한 byte budget 보완 | 중간 |
| Monaco 문서 모델 | 탭·review 소유권으로 유지 | undo와 수정 내용을 보존하는 현재 수명 유지 | 회수 보수적 |
| Places | 전용 renderer와 전체 검색 캐시 | 검색 규모에 따른 캐시 축소, idle 서비스 종료 평가 | 중간 |
| uBO background page | 브라우저 공용 서비스 | 초기화 완료 후 별도 측정·프로파일링 | 보수적 |

[PreviewManager](../apps/desktop/src/main/preview/preview-manager.ts)의 HTML Map은 먼저 64개 제한을 적용하고 warmup HTML을 추가할 수 있으므로 순간 최대 65개가 될 수 있다. 중요한 문제는 한 개의 HTML이 매우 클 수 있다는 점이다. 생성된 URL이 protocol 요청으로 소비되기 전에 항목을 지우면 빈 화면이 될 수 있어 단순히 삽입 즉시 LRU를 적용해서는 안 된다. 로딩 중 lease와 완료/실패 시 해제, 재로드에 필요한 원본 재생성 경로를 함께 설계해야 한다.

[render-worker](../apps/desktop/src/main/preview/render-worker.ts)의 Notebook Map에는 자체 LRU나 크기 한도가 없다. 다만 [DocumentManager](../apps/desktop/src/main/documents/document-manager.ts)의 새 문서·Markdown 열기에서 `forgetNotebooks()`로 비우므로 앱 실행 내내 단조 증가한다고 단정할 수 없다. 한 reset 구간 안의 여러 폴더·테마·검색 작업, 각 Notebook 내부 KaTeX 결과가 관측 대상이다. 자주 쓰는 Notebook까지 매번 비우는 문제와 오래된 것을 너무 오래 두는 문제를 함께 다뤄야 한다.

[ReviewRowCache](../apps/desktop/src/main/preview/review-row-cache.ts)는 문자열 크기를 근사한 byte budget과 revision 검증을 이미 갖췄다. cache miss면 전체 결과로 복구하므로 재생성 가능한 캐시 설계의 좋은 출발점이다. 이 64MiB는 DOM·IPC 복제·V8 overhead까지 포함한 프로세스 한도가 아니다. [baseline cache](../apps/desktop/src/main/preview/review-baseline-cache.ts)도 같은 구분이 필요하다.

[MediaCache](../apps/desktop/src/renderer/workspace/media-cache.ts)는 기본 3개를 유지하지만 보이는 split group은 전부 보호해 3개를 넘을 수 있다. 이미지 하나의 디코딩된 RGBA 메모리는 대략 가로×세로×4바이트다. 파일 크기만으로 비용을 판단하지 말고 PDF canvas, devicePixelRatio, zoom, 이미지 디코딩 크기를 반영해야 한다. 전체 창을 닫는 방식으로 shell renderer의 media만 회수하려 해서는 안 된다.

[Monaco adapter](../apps/desktop/src/renderer/adapters/monaco-editor.ts)는 문서 모델의 owner와 review lease를 나눈다. 화면이 안 보인다고 모델을 dispose하면 저장된 문서도 undo를 잃는다. 원본 텍스트·수정본·undo는 사용자가 만든 상태이고, HTML·검색 인덱스·사용하지 않는 canvas는 다시 만들 수 있는 결과다. 같은 LRU에 넣으면 안 된다.

[Places](../apps/desktop/src/browser-runtime/places.ts)는 IndexedDB 전체를 JS 배열로 읽고 42일 retention을 적용하되 북마크는 보존한다. 검색 결과 수가 적어도 전체 캐시가 작은 것은 아니다. [전용 view](../apps/desktop/src/main/browser/browser-places.ts)는 `backgroundThrottling: false`이며 메인 창에 붙이지 않는다. 이 옵션 하나를 이번 웹 탭 visibility 문제의 원인으로 단정할 근거는 없다. 서비스 종료를 도입한다면 대기 중 IPC와 DB 쓰기를 끝내고, 재연결 시 중복 방문 기록이 생기지 않게 해야 한다.

## 제안하는 탭 수명 구조

논리적 탭과 런타임 화면을 분리한다. 아래 이름은 제안이며 아직 구현된 API가 아니다.

```text
LogicalTab
  id, ownerWindow, resourceKind
  resourceNavigation, nativeWebHistory, url, title
  sessionIdentity, siteZoom, lastUsed, revisitCount
  protectionReasons, generation

RuntimeSurface
  logicalTabId, generation
  absent | loading | visible | hidden | evicting | dormant
  webContents?, detachHandlers?, pendingRequests?
```

`dormant`는 탭이 닫혔다는 뜻이 아니다. 탭과 이동 기록은 존재하고 웹 화면만 없다. 다시 선택하면 같은 논리적 탭에 새 화면을 붙인다. Freeze를 안정적으로 지원하게 된다면 별도 runtime 상태로 추가한다.

회수는 다음 순서의 하나의 전이로 수행한다.

1. 모든 창·split group의 표시 상태와 보호 이유를 확인한다. 후보로 고른 뒤 실제 해제 직전에도 다시 검사한다.
2. native navigation entries와 index, session identity, website zoom, 가능한 읽기 위치를 저장한다. 파일↔웹 `TabNavigation`은 그대로 유지한다.
3. 세대를 갱신하고 pending navigation/capture/find/extension 작업을 취소하거나 이전 세대 응답을 무시하도록 한다. 탭 이동 작업 중에는 회수하지 않는다.
4. extension host 등록·zoom tracking·listeners를 정리하고 native surface를 분리·종료한다. 메타데이터 삭제나 UI close 이벤트를 보내지 않는다.
5. 메모리와 프로세스 종료를 다시 관측한다. 목표에 도달하면 다음 후보를 회수하지 않는다.
6. 재활성화 시 같은 session에 새 화면을 만들고 uBO 준비 완료 후 탐색 기록을 복원한다. 새 페이지 준비 전 placeholder를 표시하고, 현재 세대·소유권·표시 권한을 확인한 뒤 화면을 붙인다.

Brave처럼 확장 기능의 observer도 새 WebContents에 다시 연결해야 한다. Setdown의 extension `removeTab` 콜백은 실제 탭 닫기로 이어질 수 있으므로, transfer와 마찬가지로 **회수 전용 reason**이 필요하다. 복원은 사용자가 새로운 링크로 이동한 사건과 구별해 파일↔웹 기록에 방문 항목을 추가하거나 forward stack을 지우지 않게 한다. 웹 history 라이브러리에 reload를 새 방문으로 셀지도 정책을 명확히 해야 한다.

현재 [WebHistory](../apps/desktop/src/core/workspace/tab-navigation.ts)의 `pageState`와 Electron `navigationHistory.restore()`는 좋은 기반이다. 하지만 페이지의 JS heap, 모든 폼·SPA 상태, WebRTC 연결, 임의의 sessionStorage 상태를 완전히 직렬화하는 API는 아니다. URL과 history 저장만으로 “완전한 상태 보존”을 약속할 수 없다. 파일↔웹 전환과 앱 재시작 복원도 별개의 지속성 범위로 다뤄야 한다. 현재 browser-tabs.json에는 URL과 제목 중심의 메타데이터를 저장한다.

## 회수 보호 조건과 압박 정책

초기 자동 회수는 복원 가능한 읽기용 HTTP(S) 페이지에 한정하는 것이 적절하다. 다음 상태는 보호 이유를 남겨 후보에서 제외한다.

- 모든 창의 선택된 탭과 모든 split group의 표시 탭. 창이 최소화됐다는 이유만으로 선택된 탭을 버리지 않는다.
- 최근 사용·빈번한 재방문·복원 직후인 탭. 사용자 지정 유지 사이트도 제외한다.
- 폼·contenteditable 입력, IME 조합, 저장 여부를 확신할 수 없는 웹 앱. `beforeunload` 부재는 안전하다는 증거가 아니다.
- 오디오·PiP·캡처·통화·장치 사용, 관련 팝업과 opener 의존 관계, DevTools.
- 진행 중 navigation, 탭의 창 이동, 상태 스냅샷, 복원, 다운로드·업로드 등 완료 여부를 판별하지 못한 작업.
- 확장 페이지, uBO background page, 내부 서비스, PDF 등 별도 상태 보존이 필요한 자원.

Electron이 Chromium의 모든 보호 신호를 공개하지 않으므로 “관측하지 못함”을 “사용하지 않음”으로 처리하면 안 된다. preload 입력 감시는 여러 frame의 사용자 입력을 보수적으로 sticky하게 기록할 수 있지만 앱의 미저장 상태를 완벽히 판별하지는 못한다. 교차 origin iframe, 프로그램으로 변한 상태, 통신 작업도 고려해야 한다. 관측 범위가 부족한 페이지는 자동 회수에서 제외하거나 사용자가 명시적으로 절전 대상에 넣게 한다.

현재 [BrowserDownloads](../apps/desktop/src/main/browser/browser-downloads.ts)는 DownloadItem을 관리하지만 시작한 논리적 탭 ID를 보관하지 않는다. “다운로드 중인 탭 제외”를 구현하려면 연결 정보를 추가해야 한다. 다운로드 bytes는 이미 Chromium이 처리하므로 UI의 진행률 객체를 줄이는 것보다 의미 있는 문제가 다른 곳에 있다. 시작 페이지와 독립적으로 진행되는 다운로드라도 페이지 회수 후 연속성과 UI 제어가 유지되는지 확인해야 한다.

정책은 두 단계의 budget과 hysteresis를 갖추는 편이 좋다. 앱 PSS가 soft budget을 넘거나 시스템의 실제 사용 가능 메모리가 지속적으로 낮을 때 회수를 시작하고, 더 낮은 목표점까지 회수한 뒤 멈춘다. Linux의 `MemAvailable`과 필요하면 cgroup 제한을 함께 봐야 하며, `MemFree`만으로 파일 캐시를 메모리 부족으로 오인하지 않는다. 초기 숫자는 측정으로 결정하고 임의의 “탭 5개”를 모든 기기의 정답으로 두지 않는다.

회수 순서는 큰데 사용하지 않는 재생성 가능 캐시, 준비용 spare, 안전한 오래된 웹 화면 순서로 둔다. 현재 계약이 보호하는 미리보기와 편집 모델은 별도다. 이미 회수한 spare를 `ensureSpare()`가 즉시 다시 만들거나 캐시가 다음 background 작업에서 곧바로 채워지는 반동을 막기 위해, 압박 상태를 생성 경로에도 전달한다. 복원 직후에는 유예 시간을 두고 한 번에 하나씩 복원해 메모리 부족→회수→재로딩이 반복되는 것을 막는다.

메모리 측정은 프로세스 PID를 중복 계산하지 않는다. 같은 프로세스를 공유하는 탭을 없애도 프로세스가 종료되지 않을 수 있고, 한 탭의 여러 frame이 여러 프로세스를 사용할 수도 있다. 따라서 정책의 tab 추정량과 실제 app PSS를 분리해서 기록한다. 전체 JS heap만 재면 GPU·canvas·네이티브 메모리를 놓친다.

## 미리보기 전환 속도를 지키는 적용 순서

1. **관측과 웹 visibility 경로를 먼저 정리한다.** native hidden/Blink hidden/rAF·timer·CPU·focus를 동시에 확인한다. detach 방식이나 Electron 개선 버전 검토는 실제 숨김·재표시·popup·IME 테스트로 결정한다. hidden 웹 페이지에는 불필요한 실행을 줄이되, hidden preview의 필요한 preparation은 계속 완료되어야 한다.
2. **재생성 가능한 캐시를 byte budget으로 관리한다.** HTML protocol token의 로딩 lease, 검색 인덱스, Notebook별 사용량, 이미지·PDF 비용을 기록한다. 기존 Git cache의 revision 검증을 보존하고 현재 작업·최근 전환에 필요한 항목을 보호한다.
3. **논리적 탭과 WebContents 수명을 분리한다.** 먼저 수동 회수와 복원으로 세대·history·session·확장 등록을 검증한 뒤, 충분히 관측 가능한 읽기용 탭에 자동 정책을 적용한다. 사용자에게 탭이 절전 상태임을 표시한다.
4. **공용 서비스의 기본 비용을 줄인다.** 웹 전용 사용에서 preview worker의 eager warmup, 큰 Places 캐시, uBO 초기화 후 정상상태를 분리 측정한다. worker 종료는 pending 작업과 준비된 revision이 없을 때만 검토한다.
5. **오래된 문서 preview 회수는 계약과 함께 설계한다.** 최근 Markdown source↔reader 및 Git review 전환의 native identity와 빠른 복귀를 보호한다. 압박 시 오래된 preview를 버리는 새로운 동작은 현재 warm 보장과 관계를 명시하고 계약·테스트를 함께 바꾼다.

[preview performance contract](preview-performance-contract.md)는 warm 전환에서 native view identity, 정확한 revision, focus/IME와 준비 완료를 보장한다. spare나 review의 a/b 화면, utility worker를 무조건 없애는 방식은 이 보장과 충돌할 수 있다. PDF·이미지는 이미 eviction 후 cold 복귀를 허용하는 별도 계약이 있으므로 그 범위 안에서 더 쉽게 조정할 수 있다.

## 검증 조건

표시 문제는 foreground 페이지의 rAF가 정상적으로 진행되는 동안 background 페이지가 실제 hidden으로 전이되는지 검증한다. 모든 timer가 완전히 멈춘다는 잘못된 assertion은 두지 않는다. 숨김·재표시 때 focus/IME, 페이지 입력과 zoom, 여러 창·split group을 함께 확인한다.

회수 기능의 correctness 시나리오는 웹 back/forward와 POST history, 파일→웹→파일 journal, SPA 이동, 폼·iframe 입력 보호, popup/opener, 오디오·다운로드, 창 이동 중 race, 이전 세대 이벤트, extension 등록과 uBO의 첫 요청 차단, 네트워크 오류·오프라인 복원까지 포함해야 한다. 회수 후 reload는 서버에 재요청하므로 POST나 복원 실패를 일반 GET 문서처럼 취급하지 않는다.

메모리 실험은 shell-only, 브라우저 공용 서비스 warm 상태, 로컬 웹 1/5/20탭, 실제 읽기 페이지와 웹 앱, 여러 폴더의 Markdown, Git review, 큰 PDF·이미지, 혼합 split 작업을 나누어 측정한다. 열기→전환→닫기를 반복했을 때 정상상태가 안정되는지도 본다. 총 PSS/private/swap, 프로세스 수, cache bytes, 회수 이유·수, 복원 지연, back/forward 성공과 입력 보존을 함께 기록한다. 실제 사이트 비교는 동일 fixture·콘텐츠·광고차단 상태를 맞추지 않으면 Brave와의 공정한 메모리 비교가 아니다.

preview 경로 변경 시 Xvfb에서 `npm run test:preview-contract`와 독립적으로 설치한 baseline을 사용하는 `npm run bench:preview -- --baseline /absolute/path/to/installed-baseline`을 실행한다. Markdown/Git, edit/no-edit, preparation 0/3000ms의 first/second/warm 결과를 분리한다. 메모리 절감 수치가 있어도 최신 내용·focus·시각 정확성·기존 전환 보장을 깨면 성공으로 보지 않는다.

`forcefullyCrashRenderer()`는 여러 WebContents가 공유할 수 있는 renderer를 종료하므로 탭 회수 API로 쓰지 않는다. Electron의 [webContents 문서](https://github.com/electron/electron/blob/v38.8.6/docs/api/web-contents.md)가 이 영향을 명시한다. 주기적 `webFrame.clearCache()`도 기본 해법으로 두지 않는다. [webFrame 문서](https://github.com/electron/electron/blob/v38.8.6/docs/api/web-frame.md)는 불필요한 cache refill로 느려질 수 있다고 설명한다. `single-process`나 site isolation 해제, 모든 탭 GC, 임의의 renderer process limit으로 상태 관리 문제를 우회하지 않는다.

이 설계로 강하게 가져올 수 있는 것은 **명시적인 소유권, 선택적인 자원 회수, 복원 가능한 캐시의 제한, 사용자의 현재 작업을 보호하는 정책**이다. 브라우저 엔진 개발 없이도 적용 범위가 넓다. Chromium 전체 freezing graph나 Shields 교체는 이득을 별도로 입증해야 하는 후순위다.
