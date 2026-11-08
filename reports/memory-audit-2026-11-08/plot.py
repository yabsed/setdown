"""Render the completed single-window diagnostic, without extrapolating to five windows."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
data = json.loads((root / 'markdown-tabs.json').read_text())
assert data['complete'] and len(data['samples']) == 8
samples = data['samples'][1:]
labels = ['1 tab', '2 tabs', '3 tabs', '4 tabs', '5 tabs', 'Close to 1\n+5 seconds', 'Close to 1\n+30 seconds']
preview, other = [], []
for sample in samples:
    pids = {entry['pid'] for entry in sample['contents'] if entry['role'] == 'preview'}
    value = sum(p['pssKiB'] for p in sample['processes'] if p['pid'] in pids) / 1024
    preview.append(value)
    other.append(sample['totalPssKiB'] / 1024 - value)
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
fig, ax = plt.subplots(figsize=(10, 5))
ax.bar(labels, other, color='#b4c7d9', label='Other Setdown processes')
ax.bar(labels, preview, bottom=other, color='#27678b', label='Markdown previews including spare')
for i, (p, o) in enumerate(zip(preview, other)):
    ax.text(i, p + o + 9, f'{p + o:.0f}', ha='center')
ax.set_ylim(0, 790)
ax.set_ylabel('Process-tree PSS (MiB)')
ax.set_title('Setdown: five Markdown tabs in ONE window', loc='left', weight='bold')
ax.legend(frameon=False, loc='upper left', ncols=2, fontsize=9)
ax.axvline(4.5, color='#777777', linestyle=':', linewidth=1)
ax.set_axisbelow(True)
ax.grid(axis='y', color='#eeeeee')
fig.text(.07, .015, 'One diagnostic run; Electron 44.7.2 / Xvfb. Host under pressure. Not an optimization A/B benchmark.', fontsize=9, color='#555555')
fig.tight_layout(rect=(0, .05, 1, 1))
fig.savefig(root / 'markdown-retention.png', dpi=160)
fig.savefig(root / 'markdown-retention.svg')
