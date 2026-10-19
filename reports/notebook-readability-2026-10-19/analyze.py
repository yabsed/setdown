"""Reproduce contrast and geometry summaries from repository tokens and GUI evidence."""
import json
import pathlib
import re

directory = pathlib.Path(__file__).resolve().parent
root = directory.parent.parent

def luminance(color):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    channels = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
    return sum(value * weight for value, weight in zip(channels, [.2126, .7152, .0722]))

def contrast(first, second):
    low, high = sorted([luminance(first), luminance(second)])
    return round((high + .05) / (low + .05), 3)

catalog = (root / 'apps/desktop/src/core/theme/theme-catalog.ts').read_text()
rows = []
for block in catalog.split("    id: '")[1:]:
    def color(key):
        return re.search(rf"\b{key}: '(#[0-9a-f]+)'", block)[1]
    background, comment, foreground = color('editorBackground'), color('comment'), color('foreground')
    rows.append(dict(theme=block.split("'")[0], background=background, comment=comment,
                     commentContrast=contrast(comment, background), foreground=foreground,
                     foregroundContrast=contrast(foreground, background),
                     toolbarText=color('mutedText'), toolbarBackground=color('surface'),
                     toolbarTextContrast=contrast(color('mutedText'), color('surface'))))
(directory / 'contrast.json').write_text(json.dumps(rows, indent=2) + '\n')
evidence = json.loads((directory / 'evidence.json').read_text())
summary = []
for capture in evidence['captures']:
    result = next(cell for cell in capture['cells'] if cell['id'] == 'results')
    controls = sum(result[key]['height'] for key in ['toolbar', 'outputToolbar', 'outputActions', 'outputFormat'])
    summary.append(dict(name=capture['name'], paragraphWidth=capture['paragraph']['rect']['width'],
                        paragraphLines=[{key: line[key] for key in ['characters', 'hangul']} for line in capture['paragraph']['lines']],
                        toolbarHeight=capture['toolbar']['rect']['height'],
                        resultsHeight=result['rect']['height'], resultsInputHeight=result['body']['height'],
                        resultControlRowsHeight=controls, resultControlRowsPercent=round(controls / result['rect']['height'] * 100, 1)))
(directory / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(dict(contrast=rows, geometry=summary), indent=2))
