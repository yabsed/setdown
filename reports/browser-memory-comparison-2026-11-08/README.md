# Chrome·Firefox 비교: 완료 범위와 한계

2026-11-08. 사용자는 Setdown의 개선 후 메모리가 Chrome·Firefox에 비해 얼마나 높은지 물었다. 동일한 웹 전용 조건의 비교를 준비했으나 시스템 여유 부족으로 중단됐고, 사용자의 요청에 따라 추가 측정 없이 확인된 수치만 정리한다.

**이 자료는 세 앱의 동일 조건 비교를 완료한 벤치마크가 아니다.** Chrome만 전체 시나리오를 완료했다. Firefox는 35초 유휴까지 측정했으며 Setdown의 웹 전용 측정은 시작하지 않았다.

## 확인된 값

단위는 앱 프로세스 트리 PSS의 MiB다. 읽지 못한 PID는 두 브라우저의 기록된 모든 샘플에서 0개다.

| 앱 | 작업 | 5창을 모두 연 뒤 | 35초 유휴 | 75초 유휴 |
| --- | --- | ---: | ---: | ---: |
| Chrome 157.0.8103.38 | 웹 10탭 | 약 685 | 약 620 | 약 567 |
| Firefox 159.0.1 | 같은 웹 10탭 | 약 804 | 약 841 | 측정 전 중단 |
| 개선 후 Setdown, **이전 실험 참고** | **웹 5탭 + Markdown 5탭** | 약 1,777 | 약 1,438 | 약 1,214 |

Chrome·Firefox는 같은 스크립트·로컬 콘텐츠·가상 화면으로 실행했다. 사이트 격리 차이를 관측할 수 있도록 loopback IP 5개를 사용하고 각 사이트의 두 페이지를 한 창에 열었다. 페이지마다 500개 문단과 실제 할당한 8 MiB 배열이 있다. 5개 실제 창, 총 10탭, 유휴 35초·75초, 모든 탭 재열기를 검사한다. 강제 GC는 없다.

새 프로필의 추가 사용자 확장은 없다. Puppeteer가 설정하는 자동화 인자와 Firefox 기본 자동화 설정은 적용된다. 사용자 프로필·실제 방문 사이트·일반 데스크톱의 측정이 아니며, 대표적인 실사용 평균을 주장하지 않는다. Chrome의 실행 인자는 [원자료](chrome.json)에 보존했다. 각 제품을 한 번씩 순차 실행했으므로 순서·초기화·GC 시점의 영향도 있다.

이전 Setdown 수치는 [메모리 관리 검증 보고서](../memory-management-2026-11-08/README.md)의 다른 작업이다. 창과 탭 수는 같지만 Markdown 편집 모델·조판 기능·기본 uBlock Origin을 포함하므로, 위 수치를 나누어 공정한 브라우저 간 배수나 효율로 확정할 수 없다. 웹 전용 Setdown 값은 아직 없다. Firefox의 75초 값을 35초 값으로 대신하지 않는다.

## 실행·중단 기록

Xvfb와 사설 D-Bus/runtime 디렉터리, 임시 프로필을 사용했다. 검증 전용 cgroup은 `MemoryMax=3G`, `MemoryHigh=2800M`, `MemorySwapMax=0`이며, 시스템 `MemAvailable` 2 GiB 미만에서는 검증 scope만 종료한다. 사용자 브라우저를 종료하거나 프로필을 변경하지 않았다.

- 최초 실행은 Setdown 휴면 탭 이름에 추가되는 아이콘·닫기 표식을 고려한 선택자 검증을 보완하기 위해 중단했다. `initial-harness-interrupted/`의 기록은 최종 수치에 포함하지 않는다.
- 수정한 동일 스크립트의 Chrome 실행은 10개 탭 재열기까지 완료했다.
- Firefox 실행 중 시스템 여유가 약 **1,995 MiB**로 내려가 감시기가 비교 전용 scope를 종료했다. [감시 기록](resource-watch.json). 종료 코드 143을 제품 테스트 성공이나 브라우저 OOM으로 해석하지 않는다.
- 사용자가 **“지금 확인된 수치만 설명해줘”**를 선택해 추가 측정을 중단했다.

[실행 스크립트](run.sh), [측정 코드](measure.mjs), [로그](run.log), [Chrome 전체 결과](chrome.json), [Firefox 부분 결과](firefox.json).

유휴 탭 회수 기능과 설정은 결과에 영향을 줄 수 있다. 이번 실행에서 제품별 절전 기능의 동등한 강도를 별도로 맞추지는 않았다. 기능 설명은 [Chrome Memory Saver 공식 문서](https://support.google.com/chrome/answer/12929150?hl=en), [Firefox Tab Unloading 공식 문서](https://support.mozilla.org/en-US/kb/unload-inactive-tabs-save-system-memory-firefox)를 참고한다.
