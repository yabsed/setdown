**일반 Markdown 탭의 Esc / 더블클릭 지연 측정**

Git 비교 지연 개선이 포함된 `57729a8`을 새로 빌드하고,
`apps/desktop/test/fixtures/sample.md`를 Git 저장소 밖의 일반 문서로 열었다.
수식 전체가 설치되면 `.katex`는 766개다. 제품 코드는 변경하지 않았다.

일반 탭은 수정 없이 전환할 때 빠르지만, **첫 수정 후 최신 내용이 표시되는 데는
아직 큰 지연이 있다.** 읽기 화면에서 로딩을 진행시킨 뒤 편집하면 첫 지연이 줄어든다.

각 조건마다 새 앱/임시 파일/설정으로 성공 실행 3회, 실행당 5사이클이다.
아래는 Esc keydown부터 캡처 완료까지의 중앙값(ms)이다. 수정 조건에서는 새 문단이
DOM에 설치됐는지 확인하고 캡처한다. 각 사이클에서 캡처는 한 번만 한다.

| 첫 편집 전후의 대기 | 수정 | 첫 Esc | 두 번째 | 세 번째 | 네 번째 | 다섯 번째 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 추가 대기 없음 | 수정 없음 | 60 | 34 | 30 | 26 | 24 |
| 추가 대기 없음 | 매번 문단 추가 | **1129** | 264 | 247 | 245 | 230 |
| 편집 화면에서 3초 | 수정 없음 | 58 | 31 | 27 | 24 | 23 |
| 편집 화면에서 3초 | 매번 문단 추가 | **1034** | 251 | 251 | 289 | 247 |
| 읽기 화면에서 3초 | 수정 없음 | 38 | 31 | 24 | 27 | 29 |
| 읽기 화면에서 3초 | 매번 문단 추가 | **297** | 245 | 259 | 254 | 247 |

추가 대기 없는 첫 수정의 실제 범위는 540–1144ms였다. 편집 화면 3초 조건은
1003–1055ms, 읽기 화면 3초 조건은 291–456ms였다. 표본이 작으므로 P95나 상한은 아니다.

**빠른 표시 요청과 실제 갱신 완료의 차이**

native show 요청은 각 사이클 중앙값 2–6ms로 빠르다. 그러나
[enterViewer](../apps/desktop/src/renderer/application/surface-controller.ts)는
먼저 viewer로 전환하고 `preview.ensure(revision)`을 비동기로 실행한다.
따라서 요청 시간만으로 최신 문서의 표시 지연을 판단할 수 없다.
초기 탐색 측정에서도 편집 후 첫 캡처 다음 DOM 조회에 새 문단이 없는 실행을 확인했다.

대기 없이 편집에 들어간 수정 없는 실행은 첫 캡처 뒤 수식이 60–99개였고,
반복 전환 중 416–479개, 708–760개를 거쳐 766개가 됐다.
편집 화면에서 3초 기다려도 첫 캡처 뒤에는 60개였다.
읽기 화면에서 3초 기다린 대조군은 첫 캡처부터 766개였다.
즉 수정 없는 첫 화면 캡처가 빠르다는 것은 본문 전체의 준비 완료를 뜻하지 않는다.

[content-controller](../apps/desktop/src/preview-runtime/content-controller.ts)는
나머지 본문을 animation frame 단위로 나누어 설치한다.
[positionPreview](../apps/desktop/src/preview-runtime/command-router.ts)는
요청한 소스 위치가 아직 설치되지 않았으면 `hydrateAll()`을 호출한다.
이번 편집은 `Control+End` 뒤 새 문단을 추가하는 동작이다.
측정 결과와 이 경로를 함께 보면, 숨긴 상태에서 남은 본문 설치/레이아웃 비용이
첫 문서 끝 위치 전환에 몰리는 것이 큰 지연의 유력한 원인이다.
이 실험은 CPU profile로 각 함수의 비용을 분리한 결과는 아니다.

**더블클릭으로 편집 복귀**

추가 대기·수정 없는 실행은 사이클별 중앙값 **210 / 359 / 29 / 31 / 31ms**였다.
편집 화면에서 3초 대기한 조건도 **213 / 370 / 30 / 31 / 29ms**로 비슷했다.
읽기 화면에서 3초 대기한 조건은 **45 / 29 / 28 / 29 / 31ms**였다.
첫 두 번의 더블클릭 지연도 남은 본문 설치가 진행되는 구간과 겹쳤다.

측정 시작은 CDP 두 번째 mousePressed 전송 직전, 종료는 편집기의 editable 상태와
editor surface의 visibility 확인 직후다. 첫 클릭과 두 번째 클릭 사이의 사람의
입력 간격은 포함하지 않으며 IPC와 Playwright 확인 비용은 포함한다.
Esc 캡처 후 수식 개수 확인 및 두 animation frame 대기를 거쳐 더블클릭을 보냈다.

**재현과 검증**

```sh
npm run build --workspace @setdown/desktop
cd apps/desktop
npx playwright test test/e2e/sample-document-cycles.spec.ts --repeat-each=3
SETDOWN_DOCUMENT_READER_IDLE_MS=3000 npx playwright test test/e2e/sample-document-cycles.spec.ts --grep 'idle=0 ' --repeat-each=3
```

본 측정에서 18회가 다섯 사이클을 완료했다. 추가로 읽기 화면 3초/수정 없음 조건
1회는 첫 Esc 뒤 native view가 30초 안에 보이지 않아 실패했다. 실패 실행은 중앙값에서
제외했고 원본에 별도 보존했다. 해당 조건을 한 번 더 실행했을 때는 완료했다.
타임아웃 원인은 이번 측정만으로 특정하지 못했다.

측정 코드 작성 중 마지막 자식이 새 문단이라고 가정한 freshness 검사가 실패했다.
본문 전체에서 문단을 확인하도록 수정한 뒤 본 측정을 다시 실행했다.
초기 두 번 캡처하던 탐색 실행과 이 중단 실행은 위 통계에 포함하지 않았다.

빌드와 TypeScript/Svelte 검사는 통과했다. 측정은 Linux/Electron 38.8.6,
일반 문서 viewport 1080×744에서 실행했다. 이전 Git 비교 측정의 780×744와는
폭과 화면 구조가 다르므로 두 표를 완전히 동일한 조건의 성능 비교로 읽으면 안 된다.
캡처 시간에는 polling/IPC/readback이 포함되고 실제 모니터의 픽셀 제시 시각은 아니다.
편집기는 첫 측정 전에 이미 로드돼 있으므로 최초 Monaco 로딩 시간도 포함하지 않는다.

원본 및 범위: [sample-document-latency-2026-09-21.json](sample-document-latency-2026-09-21.json).
진단 코드: [sample-document-cycles.spec.ts](../apps/desktop/test/e2e/sample-document-cycles.spec.ts).
