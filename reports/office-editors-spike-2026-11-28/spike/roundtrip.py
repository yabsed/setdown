# Compares each original package with what the engine saved from it without an edit, and counts what the originals contain.
import collections, io, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET
originals, saved_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
kind = sys.argv[4]
def canonical(data):
    try: return ET.canonicalize(xml_data=data.decode('utf-8', 'replace'), strip_text=True)
    except Exception as error: return 'unparsable: ' + str(error)[:60]
is_xml = lambda name: name.endswith(('.xml', '.rels', '.vml'))
FEATURES = {
 'pptx': {'chart': r'^ppt/charts/chart', 'diagram (SmartArt)': r'^ppt/diagrams/', 'embedded object': r'^ppt/embeddings/', 'EMF or WMF picture': r'\.(emf|wmf)$', 'video or audio': r'\.(mp4|m4v|mov|wmv|avi|mp3|wav|m4a)$',
          'embedded font': r'^ppt/fonts/', 'notes': r'^ppt/notesSlides/', 'comments': r'^ppt/comments/', 'legacy drawing (VML)': r'vmlDrawing'},
 'xlsx': {'chart': r'^xl/charts/chart', 'pivot table': r'^xl/pivotTables/', 'table': r'^xl/tables/', 'drawing': r'^xl/drawings/drawing', 'picture': r'^xl/media/', 'comments': r'^xl/comments', 'macro': r'vbaProject\.bin$',
          'external link': r'^xl/externalLinks/', 'calc chain': r'^xl/calcChain\.xml$'},
}[kind]
INSIDE = {'pptx': {'Hangul text': re.compile('[가-힣]'), 'table': re.compile(r'<a:tbl[ >]'), 'equation': re.compile(r'<m:oMath'), 'animation': re.compile(r'<p:timing'), 'transition': re.compile(r'<p:transition')},
          'xlsx': {'Hangul text': re.compile('[가-힣]'), 'formula': re.compile(r'<f[ >/]'), 'array formula': re.compile(r'<f [^>]*t="array"'), 'shared formula': re.compile(r'<f [^>]*t="shared"'),
                   'conditional formatting': re.compile(r'<conditionalFormatting'), 'data validation': re.compile(r'<dataValidation[ >]'), 'merged cells': re.compile(r'<mergeCell '), 'frozen pane': re.compile(r'<pane [^>]*state="frozen'),
                   'filter': re.compile(r'<autoFilter'), 'hyperlink': re.compile(r'<hyperlink ')}}[kind]
content_prefix = {'pptx': ('ppt/slides/slide',), 'xlsx': ('xl/worksheets/sheet', 'xl/sharedStrings')}[kind]
census, rows = collections.Counter(), []
for name in sorted(os.listdir(saved_dir)):
    try: before, after = zipfile.ZipFile(os.path.join(originals, name)), zipfile.ZipFile(os.path.join(saved_dir, name))
    except Exception as error: rows.append({'file': name, 'error': str(error)[:80]}); continue
    a, b = {i.filename: i for i in before.infolist() if not i.is_dir()}, {i.filename: i for i in after.infolist() if not i.is_dir()}
    row = {'file': name, 'parts': len(a), 'dropped': sorted(set(a) - set(b)), 'added': sorted(set(b) - set(a)), 'binaryChanged': [], 'xmlChanged': [], 'unparsable': []}
    found = set()
    for part in a:
        for label, pattern in FEATURES.items():
            if re.search(pattern, part, re.I): found.add(label)
        if part.startswith(content_prefix) and is_xml(part):
            try: text = before.read(part).decode('utf-8', 'replace')
            except Exception: continue
            for label, pattern in INSIDE.items():
                if pattern.search(text): found.add(label)
    for label in found: census[label] += 1
    row['features'] = sorted(found)
    for part in sorted(set(a) & set(b)):
        try: x = before.read(part)
        except Exception: row.setdefault('originalUnreadable', []).append(part); continue
        y = after.read(part)
        if x == y: continue
        if is_xml(part):
            cx, cy = canonical(x), canonical(y)
            if cy.startswith('unparsable'): row['unparsable'].append(part)
            elif cx != cy: row['xmlChanged'].append(part)
        else: row['binaryChanged'].append(part)
    for part in b:
        if is_xml(part) and part not in a and canonical(after.read(part)).startswith('unparsable'): row['unparsable'].append(part)
    rows.append(row)
json.dump({'census': census, 'rows': rows}, open(out, 'w'), indent=1, ensure_ascii=False)
ok = [r for r in rows if 'error' not in r]
print('compared', len(ok), 'of', len(rows))
print('census of originals:', ', '.join(f'{k} {v}' for k, v in census.most_common()))
print('no part dropped or added:', sum(1 for r in ok if not r['dropped'] and not r['added']), '| binary parts all identical:', sum(1 for r in ok if not r['binaryChanged']), '| saved XML all well-formed:', sum(1 for r in ok if not r['unparsable']))
print('no XML part differs after normalizing whitespace:', sum(1 for r in ok if not r['xmlChanged']))
kinds = collections.Counter()
for r in ok:
    for part in r['xmlChanged']: kinds[re.sub(r'\d+', 'N', part)] += 1
print('XML parts that differ, by kind:', kinds.most_common(12))
drop = collections.Counter()
for r in ok:
    for part in r['dropped']: drop[re.sub(r'\d+', 'N', part)] += 1
print('dropped parts by kind:', drop.most_common(10), '| added:', collections.Counter(re.sub(r'\d+', 'N', p) for r in ok for p in r['added']).most_common(6))
print('binary changed:', [(r['file'], r['binaryChanged'][:3]) for r in ok if r['binaryChanged']][:6])
