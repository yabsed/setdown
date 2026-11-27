# Rows of [LibreOffice | current viewer | bare engine] for chosen slides, labelled.
import os, sys
from PIL import Image, ImageDraw
out, target = sys.argv[1], sys.argv[2]
rows = []
for spec in sys.argv[3:]:
    deck, number = spec.rsplit(':', 1); number = int(number)
    lo = next(p for p in (os.path.join(out, 'lo/png', deck, f'lo-{number}.png'), os.path.join(out, 'lo/png', deck, f'lo-{number:02d}.png')) if os.path.exists(p))
    editor = next(p for p in (os.path.join(out, 'render-poi', deck, f'editor-{number:02d}.png'), os.path.join(out, 'render-own', deck, f'editor-{number:02d}.png')) if os.path.exists(p))
    viewer = os.path.join(out, 'render-viewer', deck, f'viewer-{number:02d}.png')
    reference = Image.open(lo); height = round(420 * reference.height / reference.width)
    row = Image.new('RGB', (420 * 3 + 8, height + 16), '#666')
    for column, path in enumerate((lo, viewer, editor)):
        image = Image.open(path).convert('RGBA'); flat = Image.new('RGBA', image.size, 'white'); flat.alpha_composite(image)
        row.paste(flat.convert('RGB').resize((420, height), Image.LANCZOS), (column * 424, 16))
    ImageDraw.Draw(row).text((4, 2), f'{deck[:40]} #{number}:  LibreOffice  |  current viewer  |  pptx-editor core', fill='white')
    rows.append(row)
sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows)), 'white')
y = 0
for row in rows: sheet.paste(row, (0, y)); y += row.height
sheet.save(target)
print(target, sheet.size)
