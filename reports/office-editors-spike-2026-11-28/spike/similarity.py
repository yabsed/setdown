# Scores each slide painted by the two renderers against LibreOffice's page: 1 - mean absolute difference of
# blurred grey images, so that a small shift of text costs little and a missing chart costs much.
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter
out = sys.argv[1]
def grey(path, size):
    image = Image.open(path).convert('RGBA')
    flat = Image.new('RGBA', image.size, (255, 255, 255, 255)); flat.alpha_composite(image)
    return np.asarray(flat.convert('L').resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(2)), dtype=np.float32) / 255
rows = []
for deck in sorted(os.listdir(os.path.join(out, 'lo/png'))):
    for page in sorted(os.listdir(os.path.join(out, 'lo/png', deck))):
        number = int(page.split('-')[-1].split('.')[0])
        reference = Image.open(os.path.join(out, 'lo/png', deck, page))
        size = (320, round(320 * reference.height / reference.width))
        ref = grey(os.path.join(out, 'lo/png', deck, page), size)
        row = {'deck': deck, 'slide': number}
        for label, folder in (('editor', 'render-poi'), ('editor', 'render-own'), ('viewer', 'render-viewer')):
            path = os.path.join(out, folder, deck, f'{label}-{number:02d}.png')
            if os.path.exists(path): row[label] = round(1 - float(np.abs(grey(path, size) - ref).mean()), 4)
        rows.append(row)
json.dump(rows, open(os.path.join(out, 'similarity.json'), 'w'), indent=1)
both = [r for r in rows if 'editor' in r and 'viewer' in r]
print('slides scored by both renderers:', len(both), 'of', len(rows))
print('mean similarity to LibreOffice: editor %.4f, viewer %.4f' % (np.mean([r['editor'] for r in both]), np.mean([r['viewer'] for r in both])))
print('median: editor %.4f, viewer %.4f' % (np.median([r['editor'] for r in both]), np.median([r['viewer'] for r in both])))
better = sum(1 for r in both if r['editor'] > r['viewer'] + .005); worse = sum(1 for r in both if r['viewer'] > r['editor'] + .005)
print('editor closer on', better, 'slides; viewer closer on', worse, '; within 0.005 on', len(both) - better - worse)
decks = {}
for r in both: decks.setdefault(r['deck'], []).append(r)
for deck, items in decks.items():
    print('  %-46s %2d slides  editor %.3f  viewer %.3f' % (deck[:46], len(items), np.mean([i['editor'] for i in items]), np.mean([i['viewer'] for i in items])))
print('largest gaps where the viewer is closer:', [(r['deck'][:24], r['slide'], r['editor'], r['viewer']) for r in sorted(both, key=lambda r: r['editor'] - r['viewer'])[:8]])
print('largest gaps where the editor is closer:', [(r['deck'][:24], r['slide'], r['editor'], r['viewer']) for r in sorted(both, key=lambda r: r['viewer'] - r['editor'])[:8]])
