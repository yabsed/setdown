# Git Graph 검증 — 2026-09-22

Changes 아래에 외부 Git Graph를 통합하고, 커밋의 변경 파일을 기존 읽기 전용
Monaco / Markdown review로 연결했다. `@web-git-graph/web`, `node`, `protocol`은
모두 1.0.7로 고정했다. upstream 그래프·Git 이력 알고리즘은 수정하거나 복사하지 않았다.
[구조와 버전별 연결 사항](git-history.md)을 참고한다.

## 기능 및 계약 검증

- `npm test`: 73개 파일, 단위 테스트 527개 통과.
- `npm run test:preview-contract`: 단위 테스트 130개, benchmark comparator 테스트
  3개, 빌드·타입 검사, 실제 Electron/Chromium 테스트 23개 통과.
- 새 Electron 테스트: 포인터·키보드 크기 조절, 접기, 커밋 파일 열기, 읽기 전용
  Monaco, Markdown review, Graph의 Escape 입력 분리, 외부 커밋 갱신,
  renderer reload 후 review·패널 크기 복원 확인.
- 실제 임시 Git 저장소 테스트: 최초 커밋, 이름 변경·삭제·바이너리, merge의 부모,
  다중 ref, 새 커밋 이후에도 유지되는 페이지 snapshot, 잘못된 경로·revision·요청 제한 확인.
- provider 요청 취소와 과거 review의 live buffer 격리 확인.

## 성능 비교 방법

- baseline: `dca0e210a71ebcba8a68cabb7adda8d574df343c`, 별도 worktree
  `/tmp/setdown-graph-base-dca0e210`에 의존성을 독립 설치.
- 같은 머신·디스플레이, 동일 fixture·측정 harness, 버전별 독립 Electron 실행.
- 8개 시나리오 × 두 버전 × 5회 반복 = 80개 새 앱 실행, 각 5사이클.
- 실행 순서는 AB / BA로 교대했다. 측정 도중 빌드나 harness를 바꾸지 않았다.
- 표의 단위는 ms이며 각 값은 **baseline → 현재 구현**이다.
- 첫 번째·두 번째는 각각의 사이클 중앙값, warm은 각 실행에서 3–5번째 중앙값을
  계산한 뒤 5회 반복의 중앙값이다. 준비 시간은 source에서 0ms 또는 3000ms이다.
- 기존 판정 기준 유지: 25%와 50ms를 **둘 다** 초과한 증가만 회귀로 판정한다.

결과: **48개 항목 모두 통과, 회귀 0개**. 모든 시나리오와 최신 편집 내용 캡처를
검증했다. 이 결과는 아래 전환 경로의 측정이며 대규모 저장소 Graph 스크롤 자체의
성능 보장을 뜻하지 않는다.

## Esc → 최신 내용 native capture

IPC·polling·capture readback을 포함하며 실제 모니터 표시 시각은 아니다.

| 경로 | 편집 | 준비 시간 | 첫 번째 | 두 번째 | Warm |
| --- | --- | --- | ---: | ---: | ---: |
| 일반 Markdown | 없음 | 0ms | 58 → 53 | 25 → 27 | 22 → 25 |
| 일반 Markdown | 없음 | 3000ms | 76 → 78 | 40 → 37 | 27 → 31 |
| 일반 Markdown | 있음 | 0ms | 430 → 484 | 101 → 93 | 92 → 95 |
| 일반 Markdown | 있음 | 3000ms | 154 → 136 | 111 → 87 | 102 → 100 |
| Git review | 없음 | 0ms | 1260 → 1179 | 28 → 29 | 27 → 28 |
| Git review | 없음 | 3000ms | 54 → 52 | 21 → 29 | 30 → 28 |
| Git review | 있음 | 0ms | 1351 → 1294 | 1792 → 1791 | 222 → 220 |
| Git review | 있음 | 3000ms | 248 → 238 | 205 → 228 | 179 → 184 |

## 더블클릭 → source editor

| 경로 | 편집 | 준비 시간 | 첫 번째 | 두 번째 | Warm |
| --- | --- | --- | ---: | ---: | ---: |
| 일반 Markdown | 없음 | 0ms | 35 → 40 | 53 → 56 | 23 → 23 |
| 일반 Markdown | 없음 | 3000ms | 30 → 31 | 23 → 25 | 23 → 24 |
| 일반 Markdown | 있음 | 0ms | 19 → 22 | 16 → 17 | 16 → 21 |
| 일반 Markdown | 있음 | 3000ms | 30 → 31 | 33 → 33 | 28 → 29 |
| Git review | 없음 | 0ms | 43 → 41 | 16 → 14 | 19 → 22 |
| Git review | 없음 | 3000ms | 43 → 44 | 13 → 15 | 19 → 21 |
| Git review | 있음 | 0ms | 43 → 45 | 26 → 26 | 24 → 24 |
| Git review | 있음 | 3000ms | 42 → 45 | 37 → 43 | 19 → 22 |

## 재현 명령과 원본

```sh
npm run test:preview-contract
npm run bench:preview -- --baseline /tmp/setdown-graph-base-dca0e210 --runs 5 \
  --output /tmp/setdown-graph-benchmark-dca0e210
```

위 output 디렉터리는 이미 사용했으므로 재실행할 때 새 경로를 지정해야 한다.
원본 JSON과 시나리오별 로그는 해당 디렉터리에 있다.

- [원본 비교 JSON](/tmp/setdown-graph-benchmark-dca0e210/comparison.json)
- [최종 preview 계약 로그](/tmp/setdown-graph-contract-final.log)
- [전체 단위 테스트 로그](/tmp/setdown-graph-all-unit-final.log)
