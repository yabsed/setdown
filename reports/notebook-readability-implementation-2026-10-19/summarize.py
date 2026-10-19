"""Compare immutable research captures with the implementation's actual captures."""
import json
import pathlib
import re

directory = pathlib.Path(__file__).resolve().parent
root = directory.parent.parent
before = json.loads((directory.parent / 'notebook-readability-2026-10-19/evidence.json').read_text())
after = json.loads((directory / 'evidence.json').read_text())

def luminance(color):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    return sum((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) * weight
               for v, weight in zip(channels, [.2126, .7152, .0722]))

def contrast(first, second):
    low, high = sorted([luminance(first), luminance(second)])
    return round((high + .05) / (low + .05), 3)

themes = []
catalog = (root / 'apps/desktop/src/core/theme/theme-catalog.ts').read_text()
for block in catalog.split("    id: '")[1:]:
    def color(key):
        return re.search(rf"\b{key}: '(#[0-9a-f]+)'", block)[1]
    themes.append(dict(theme=block.split("'")[0], comment=color('comment'),
                       commentContrast=contrast(color('comment'), color('editorBackground'))))
rows = []
for capture in after['captures']:
    original = next(item for item in before['captures'] if item['name'] == capture['name'])
    old_cell = next(cell for cell in original['cells'] if cell['id'] == 'results')
    new_cell = next(cell for cell in capture['cells'] if cell['id'] == 'results')
    rows.append(dict(name=capture['name'],
        paragraphWidth=[original['paragraph']['rect']['width'], capture['paragraph']['rect']['width']],
        toolbarHeight=[original['toolbar']['rect']['height'], capture['toolbar']['rect']['height']],
        resultCellHeight=[old_cell['rect']['height'], new_cell['rect']['height']],
        resultControlFlowHeight=[sum(old_cell[key]['height'] for key in ['toolbar','outputToolbar','outputActions','outputFormat']), new_cell['outputActions']['height']],
        paragraphFonts=[font['familyName'] for font in capture['fonts']['paragraph']],
        unfocusedContentHighlights=len([line for line in capture['currentLines']
            if not line['focused'] and line['style']['backgroundColor'] != 'rgba(0, 0, 0, 0)'])))
(directory / 'summary.json').write_text(json.dumps(dict(captures=rows, themes=themes), ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(captures=rows, themes=themes), ensure_ascii=False, indent=2))
