# PPTX·XLSX 편집 엔진 실측 자료 (2026-11-28)

보고서: [../2026_11_28_04_13_pptx_xlsx_editing_plan.md](../2026_11_28_04_13_pptx_xlsx_editing_plan.md)

## spike/

저장소 밖 작업 폴더에서 쓴 실험 코드다. `npm install --ignore-scripts` 뒤 `npx vite build`로 두 페이지를 만들고,
Setdown의 `apps/desktop/scripts/with-isolated-display.sh`를 거쳐 `SETDOWN_REPO=<저장소>`와 함께 실행한다.
Electron과 Playwright는 Setdown에 설치된 것을 쓴다.

| 파일 | 하는 일 |
| --- | --- |
| `src/pptx.ts`, `src/xlsx.ts` | 엔진만 붙인 페이지. `window.spike`로 열기·저장·상태를 내준다 |
| `drive.mjs` | `file://` 페이지를 여는 Electron 창을 Playwright로 몬다 |
| `corpus.mjs` | 문서마다 열기 → 그대로 저장 → 저장본 다시 열기. 한 줄에 한 문서 |
| `roundtrip.py` | 원본과 저장본을 부품 단위로 비교하고, 원본에 든 기능을 센다 |
| `render-pptx.mjs`, `render-xlsx.mjs` | 슬라이드·첫 화면을 그림으로 저장. 호스트 글꼴을 넘길 수 있다 |
| `similarity.py`, `montage.py` | LibreOffice 그림과의 유사도, 나란히 놓은 그림 |
| `edit-pptx.mjs`, `edit-xlsx.mjs` | 실제 마우스·키보드로 고치고 실행 취소·저장·다시 열기 |
| `ime.mjs`, `native.py` | ibus-hangul을 숨은 화면에 띄우고 XTest로 한글을 친다 |
| `memory.mjs`, `poc.mjs` | 수집 후 메모리, 한 문서에 페이지가 살아남는지 |

## results/

| 파일 | 내용 |
| --- | --- |
| `pptx-corpus.jsonl`, `xlsx-corpus.jsonl` | 문서별 열기·저장·다시 열기 결과. **`heapMiB`는 수집 전 값이라 뒤로 갈수록 커진다. 메모리 판단에 쓰지 말 것**(보고서의 메모리 수치는 `memory.mjs`로 따로 쟀다) |
| `pptx-roundtrip.json`, `xlsx-roundtrip.json` | 문서별 부품 비교와 기능 집계 |
| `similarity.json` | 슬라이드별 유사도(`editor`, `viewer`) |
| `pptx-editor-render.json`, `pptx-viewer-render.json` | 렌더링 실행 기록 |
| `render-list.txt`, `xlsx-sample.txt` | 화면 비교에 쓴 문서 목록 |
| `korean-sources.txt` | 한글 문서의 저장소·커밋·경로 |

문서 묶음: Apache POI `f63b77bb7497d950073969f9d418f2270dd87edd`의 `test-data/slideshow`, `test-data/spreadsheet`.

## images/

| 파일 | 내용 |
| --- | --- |
| `charts.png` | 차트 슬라이드 넷. 왼쪽부터 LibreOffice, 현재 뷰어, pptx-editor core |
| `gaps.png` | 점수 차가 큰 슬라이드와 SmartArt. 같은 순서 |
| `korean.png` | 한글 덱 넷. 왼쪽부터 LibreOffice, 기본 글꼴, 나눔고딕 공급 |
| `ttc.png` | 왼쪽은 나눔고딕 공급, 오른쪽은 모음 파일의 2·3번 면을 넘겨 거부된 경우(기본 글꼴로 떨어짐) |
| `xlsx-korean.png` | 한글 통합 문서 둘. 각각 위는 기본 글꼴, 아래는 나눔고딕 공급 |
| `xlsx-stale-sum.png` | 위부터 원본, `A2`를 40으로 고친 뒤, 저장본을 다시 연 화면. `A4`가 계속 3이다 |

사용자의 덱으로 만든 그림은 여기에 넣지 않았다(`target/validation/office-editors-spike-2026-11-28/`, git 제외).
