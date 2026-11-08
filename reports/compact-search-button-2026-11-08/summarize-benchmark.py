"""Render every required comparison from the unchanged preview benchmark JSON."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
report = json.loads((root / "benchmark/comparison.json").read_text())
rows = report.get("comparisons", [])
if len(rows) != 48 or "finishedAt" not in report or report.get("error"):
    raise SystemExit("The benchmark has not completed all 48 comparisons.")
indexed = {row["key"]: row for row in rows}
assert len(indexed) == 48
lines = [
    "# 미리보기 성능 비교",
    "",
    f"baseline `{report['baseline']['commit'][:7]}` → 수정 빌드. "
    f"각 버전 {report['runs']}회 × 8개 시나리오 × 5회 전환. 단위는 ms이며 모든 칸은 baseline → 수정본이다.",
    "",
    "첫 번째·두 번째는 독립 실행 간 중앙값이다. Warm은 각 실행의 3–5회 중앙값을 먼저 구한 뒤 실행 간 중앙값을 구한다. "
    "준비 대기는 source에서 입력하기 전 기다리는 시간이며, 0과 3000 ms를 따로 비교한다.",
    "",
    "Escape 측정에는 최신 내용 확인·IPC·native capture 읽기가 포함된다. 모니터의 실제 표시 시각을 뜻하지 않는다. "
    "수정 시나리오는 최신 편집 내용이 보이는 캡처만 유효하다.",
    "",
]
for metric, title in [("captureMs", "Escape → 최신 화면 캡처"),
                      ("doubleClickToEditorMs", "더블클릭 → 편집 가능")]:
    lines += [f"## {title}", "", "| 문서 | 준비 대기 | 수정 | 첫 번째 | 두 번째 | Warm |",
              "| --- | ---: | --- | ---: | ---: | ---: |"]
    for kind, label in [("document", "Markdown"), ("review", "Git review")]:
        for idle in (0, 3000):
            for edits in (False, True):
                values = []
                for cycle in ("first", "second", "warm"):
                    key = f"{kind}/idle={idle}/edits={str(edits).lower()}/{cycle}/{metric}"
                    row = indexed[key]
                    values.append(f"{row['baselineMs']:.1f} → {row['candidateMs']:.1f}" + (" **실패**" if row['regression'] else ""))
                lines.append(f"| {label} | {idle} ms | {'있음' if edits else '없음'} | " + " | ".join(values) + " |")
    lines += [""]
lines += [
    f"판정: {len(rows) - len(report['regressions'])}/48 통과. 기존 허용치인 "
    f"{report['thresholds']['relative'] * 100:g}%와 {report['thresholds']['absoluteMs']:g} ms를 모두 넘는 악화만 실패로 판정한다. 허용치는 변경하지 않았다.",
    "",
    "[원시 비교·각 실행의 표본·빌드/의존성/하네스 해시](benchmark/comparison.json). "
    "양쪽 모두 `SETDOWN_BUILD_SOURCEMAP=0`으로 미리 빌드했고, 같은 Xvfb에서 AB/BA 순서를 교대로 실행했다. "
    "실행 중 빌드나 하네스를 바꾸지 않았다. 이 결과는 전환 지연 비교이며 메모리 절감률 측정은 아니다.",
    "",
]
(root / "benchmark-summary.md").write_text("\n".join(lines))
