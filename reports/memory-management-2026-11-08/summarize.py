"""Render only complete paired measurements; never average away latency buckets."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
comparison = json.loads((root / 'preview-benchmark/comparison.json').read_text())
assert len(comparison['comparisons']) == 48
assert all(len(comparison['measurements'][v]) == 3 for v in ('baseline', 'candidate'))
rows = {row['key']: row for row in comparison['comparisons']}
lines = ['# 전환 지연 비교', '', '단위 ms. 각 셀은 기준 → 변경. 버전별 3회 중앙값이며 warm은 각 앱의 3–5번째 주기 중앙값을 다시 집계했다.', '']
for metric, title in [('captureMs', 'Esc → 최신 내용의 native capture'), ('doubleClickToEditorMs', '더블클릭 → 편집 화면')]:
    lines += [f'## {title}', '', '| 문서 | 편집 | 준비 시간 | 첫째 | 둘째 | warm |', '| --- | --- | ---: | ---: | ---: | ---: |']
    for kind, label in [('document', 'Markdown'), ('review', 'Git')]:
        for idle in (0, 3000):
            for edited in (False, True):
                values = []
                for cycle in ('first', 'second', 'warm'):
                    row = rows[f'{kind}/idle={idle}/edits={str(edited).lower()}/{cycle}/{metric}']
                    values.append(f"{row['baselineMs']:.1f} → {row['candidateMs']:.1f}" + (' **실패**' if row['regression'] else ''))
                lines.append(f"| {label} | {'있음' if edited else '없음'} | {idle} | " + ' | '.join(values) + ' |')
    lines.append('')
(root / 'latency-tables.md').write_text('\n'.join(lines) + '\n')

before = json.loads((root / 'mixed-baseline.json').read_text())
after = json.loads((root / 'mixed-candidate.json').read_text())
assert before['complete'] and after['complete']
assert before['fixture'] == after['fixture'] and before['harnessHash'] == after['harnessHash']
assert not before['crashes'] and not after['crashes']
baseline = {sample['label']: sample for sample in before['samples']}
candidate = {sample['label']: sample for sample in after['samples']}
assert baseline.keys() == candidate.keys()
result = []
lines = ['# 5창 혼합 부하 메모리 비교', '', 'Linux 앱 프로세스 트리 PSS, 단위 MiB. 각 버전 한 번의 연속 시나리오이며 보편적인 절감률이 아니다.', '',
         '| 상태 | 기준 | 변경 | 감소 | 기준/변경 WebContents |', '| --- | ---: | ---: | ---: | ---: |']
for label, a in baseline.items():
    b = candidate[label]
    old, new = a['totalPssKiB'] / 1024, b['totalPssKiB'] / 1024
    delta = old - new
    row = {'label': label, 'baselineMiB': old, 'candidateMiB': new, 'reducedMiB': delta, 'reducedPercent': delta / old * 100}
    result.append(row)
    lines.append(f"| {label} | {old:.1f} | {new:.1f} | {delta:.1f} ({delta / old * 100:.1f}%) | {len(a['contents'])}/{len(b['contents'])} |")
(root / 'mixed-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
(root / 'mixed-table.md').write_text('\n'.join(lines) + '\n')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
labels = ['Empty', '1 window', '2 windows', '3 windows', '4 windows', '5 windows', 'Idle 35s', 'Idle 75s', 'Reopened']
assert len(result) == len(labels)
fig, ax = plt.subplots(figsize=(10, 4.5), constrained_layout=True)
ax.plot(labels, [row['baselineMiB'] for row in result], marker='o', label='Baseline 4fc1637')
ax.plot(labels, [row['candidateMiB'] for row in result], marker='o', label='Memory management')
ax.set(ylabel='Application process-tree PSS (MiB)', title='Five windows: 5 Markdown + 5 web tabs; 3 GiB test cgroup')
ax.set_ylim(bottom=0)
ax.grid(axis='y', alpha=.25)
ax.legend()
ax.tick_params(axis='x', rotation=25)
fig.savefig(root / 'mixed-memory.png', dpi=160)
plt.close(fig)
