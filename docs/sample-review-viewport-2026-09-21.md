**Working Tree 수식 문서의 첫 Esc 표시 지연 개선**

`b79a775` 기준으로 수식이 많은 `apps/desktop/test/fixtures/sample.md`를 사용했다.
이전 [원인 조사](sample-review-cold-cycles-2026-09-21.md)에서 확인한 두 비용을
제품 코드에서 제거했다. 추가로 숨겨진 Git 페이지의 관측자 없는 읽기 위치 보고도 생략해,
화면 쪽에서 폐기할 좌표를 계산하기 위한 수식 트리 스캔을 줄였다. 활성 관측의 마지막
bookmark flush와 일반 문서의 위치 보고는 유지한다.

1. 숨겨진 비교 페이지의 Blink viewport가 0×0으로 남는 문제:
   Git 비교 A/B에 실제 native bounds와 같은 desktop viewport를 전달한다.
   최초 navigation 완료 후와 bounds 변경 시 적용하고, 표시할 때 유지한다.
   화면에 먼저 노출하거나 편집기의 포커스를 옮기지 않는다.
2. hidden prime과 show의 1px 크기 차이:
   CSS 좌표를 일찍 반올림하지 않고, zoom을 적용한 뒤 native 좌표로 한 번 변환한다.
   두 경로 모두 동일하게 창의 content 영역에 맞춰 크기를 제한한다.

구현은 Electron의 [enableDeviceEmulation](https://www.electronjs.org/docs/latest/api/web-contents#contentsenabledeviceemulationparameters)을
desktop viewport override로 사용한다. `deviceScaleFactor: 0`, `scale: 1`을 사용해
자연스러운 화면 배율과 페이지 zoom을 유지한다. 같은 크기는 다시 설정하지 않으며,
navigation은 이전 viewport cache를 무효화한다. 일반 문서에는 override를 적용하지 않는다.

화면에 표시하기 전에 실측한 A/B 내부 viewport는 모두 780×744이고,
native bounds도 780×744였다. 이전에는 native 780×745 / 내부 0×0이었다.
viewport만 맞추고 높이 차이를 남긴 중간 실험에서는 첫 표시 때 여전히 약 200ms의
전체 스타일 계산이 발생했다. 높이까지 일치시킨 뒤 이 작업도 사라졌다. 최종 trace에서 Esc 후 첫 100ms에는
비교 페이지의 전체 Layout이 없었고, UpdateLayoutTree 2회는 각각 elementCount 0이었다.
같은 구간 shell의 작은 스타일/레이아웃 갱신과 비교 페이지의 PrePaint는 별도다.

**전후 반복 측정**

각 3회 중앙값, trace를 끈 수정 직후 Esc의 캡처 완료 시간이다. source 복귀는 toolbar를 사용했다.

| 사이클 | 변경 전 | 변경 후 | 감소 |
| --- | ---: | ---: | ---: |
| 1 | 836ms | 241ms | 71.2% |
| 2 | 816ms | 187ms | 77.1% |
| 3 | 226ms | 182ms | 19.5% |
| 4 | 216ms | 172ms | 20.4% |
| 5 | 209ms | 171ms | 18.2% |

수정 없는 실제 더블클릭 대조군은 첫 캡처 중앙값 **49ms**, 이후 **18–32ms**였다.
이전 조사에서 같은 no-edit 조건의 첫 캡처는 695ms였다(약 93% 감소).
편집 포함 첫 두 번의 큰 추가 비용이 사라졌으며 최신 Markdown 렌더/비교/설치는 계속 기다린다.

**검증**

수식 geometry 검사는 최초 hidden A/B에 유효한 viewport가 있는지 확인하고,
실제 표시 후 override를 해제한 natural desktop rendering과 각 수식의 좌표,
타이포그래피, innerWidth/innerHeight, devicePixelRatio를 비교한다.
창 폭 1100/680, zoom 1/1.25에서 동등했다. 폭 720px breakpoint를 넘는 변화도 포함한다.
한글 조합 중 background navigation이 일어나도 blur가 없는 검사도 통과했다.

관련 단위 검사 7개 파일, 79개 통과. 관련 브라우저 검사 10개 통과.
성능 진단은 최종 편집 포함 3회, 수정 없는 실제 더블클릭 3회 모두 통과. TypeScript/Svelte 검사 및 production build 통과.

기존 `git-review-cold-escape.spec.ts`와 `git-review-reading-position.spec.ts`는 실패했다.
변경 전 HEAD의 main 두 파일을 esbuild onLoad로 대체한 대조 빌드에서도 각각
동일하게 hidden changed-element 개수 0, 기대 scrollY 0 대비 2385로 실패했다.
두 테스트가 이번 수정으로 통과했다고 보고하지 않는다.

**측정 방법**

매번 새 앱과 임시 Git/config 디렉터리를 사용한다. 비교 탭 진입 후 3초 기다리고,
문단을 입력하자마자 Esc를 누른다. A/B를 아직 한 번도 보여 주지 않은 상태에서
측정을 시작한다. 일반 시간 측정에는 hidden DOM geometry probe나 profiler를 사용하지 않는다.

기존 native 더블클릭 진단은 변경 전후 모두 source 복귀 입력이 간헐적으로 누락됐다.
따라서 전후 반복 성능 비교에서는 `SETDOWN_CYCLES_RETURN=button`으로 측정 완료 뒤의
source 복귀만 toolbar로 수행한다. Esc, 수정, A/B 선택, 최신 내용 설치 경로는 동일하다.
더블클릭 진단 자체는 기본 옵션으로 유지하며, 실패 실행을 중앙값에 섞지 않는다.

`show`는 native 표시 요청이고 `capture`는 polling/IPC/readback을 포함한 캡처 완료다.
둘 다 실제 모니터의 픽셀 제시 시각 또는 P95 보장이 아니다. 초기 Markdown 렌더와
행 비교 비용은 남아 있으며, 이 수정은 실제 viewport에서의 첫 준비 비용을 Esc
이전의 background 단계로 옮긴다. 탭을 연 즉시 누르는 Esc에는 준비 대기가 남을 수 있다.

초기 대기를 생략한 별도 1회 실행도 확인했다. 수정 없는 첫 Esc는 show 1073ms,
capture **1126ms**, 이후 실제 더블클릭 사이클의 capture는 28–32ms였다.
첫 Esc 이후 navigation 완료까지 300ms, 첫 prepare ACK까지 1011ms를 기다렸다.
따라서 위 3초 준비 후 결과를 파일 로딩 직후의 지연으로 해석하면 안 된다.
이 1회 결과는 전후 비교 중앙값과 별도로 원본에 저장했다.

재현:

```sh
npm run build
cd apps/desktop
SETDOWN_CYCLES_IDLE_MS=3000 SETDOWN_CYCLES_EDIT=1 SETDOWN_CYCLES_RETURN=button npx playwright test test/e2e/sample-review-cold-cycles.spec.ts --repeat-each=3
SETDOWN_CYCLES_IDLE_MS=3000 npx playwright test test/e2e/sample-review-cold-cycles.spec.ts --repeat-each=3
SETDOWN_CYCLES_IDLE_MS=3000 SETDOWN_TRACE_CYCLES=1 npx playwright test test/e2e/sample-review-cold-cycles.spec.ts
```

측정 원본: [sample-review-viewport-2026-09-21.json](sample-review-viewport-2026-09-21.json).
