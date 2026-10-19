"""Generate report figures from measured contrast tokens and an explicitly proposed layout."""
import html
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
rows = json.loads((directory / 'contrast.json').read_text())

def text(x, y, value, size=16, fill='#182536', weight='normal'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}">{html.escape(value)}</text>'

def rect(x, y, width, height, fill, stroke='none', radius=0):
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>'

def save(name, width, height, title, description, parts):
    document = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">
<title id="title">{html.escape(title)}</title><desc id="description">{html.escape(description)}</desc>
<g font-family="NanumGothic, Noto Sans CJK KR, sans-serif">{''.join(parts)}</g></svg>'''
    (directory / name).write_text(document)

parts = [rect(0, 0, 1000, 490, '#ffffff'), text(28, 36, '현재 테마의 코드 주석 대비', 24, weight='bold'),
         text(28, 65, '각 주석 토큰과 불투명 편집기 배경의 sRGB 대비 · 앱 전체의 접근성 판정은 아님', 15, '#526172')]
left, scale = 205, 115
for index, row in enumerate(sorted(rows, key=lambda item: item['commentContrast'])):
    y = 99 + index * 39
    ratio = row['commentContrast']
    parts += [text(28, y + 20, row['theme']), rect(left, y, ratio * scale, 28, '#186857' if ratio >= 4.5 else '#b75a28', radius=3),
              text(left + ratio * scale + 12, y + 20, f'{ratio:.2f}:1', 16)]
threshold = left + 4.5 * scale
parts += [f'<path d="M {threshold} 88 V 421" stroke="#344455" stroke-width="2" stroke-dasharray="5 4"/>',
          text(threshold + 8, 438, '4.5:1 일반 텍스트 기준', 14),
          text(28, 473, '출처: theme-catalog.ts · 계산: analyze.py · 원자료: contrast.json', 14, '#526172')]
save('comment-contrast.svg', 1000, 490, '8개 테마의 코드 주석 대비',
     '8개 테마 중 6개의 주석 토큰이 일반 텍스트의 4.5 대 1 기준보다 낮다. One Dark 2.32 대 1, GitHub Dark 4.77 대 1.', parts)

parts = [rect(0, 0, 1200, 680, '#ffffff'), text(30, 38, '셀의 경계와 읽을 내용의 관계를 다르게 표현한다', 25, weight='bold'),
         text(30, 66, '구조 비교를 위한 개념도 · 실제 개선 화면이나 사용성 검증 결과가 아님', 15, '#526172'),
         text(30, 111, '현재: 셀마다 같은 상자와 조작 줄', 19, weight='bold'),
         text(640, 111, '제안: 설명 → 코드 → 결과의 연결', 19, weight='bold')]
for x, y, width, height in [(30, 135, 530, 150), (30, 306, 530, 311)]:
    parts += [rect(x, y, width, height, '#f5f6f8', '#a4aeb9', 5), rect(x + 1, y + 1, width - 2, 34, '#e3e7ed')]
parts += [text(47, 159, '⠿   Md   Markdown   Edit', 15, '#4c5968'),
          text(52, 207, '설명 제목', 22, weight='bold'),
          text(52, 243, '본문도 코드와 같은 글꼴·같은 카드', 16),
          text(47, 330, '⠿   [33]   Code   Run', 15, '#4c5968'),
          text(52, 377, 'evaluation_table = ...', 17), text(52, 407, 'evaluation_table.round(3)', 17)]
for y, height, label in [(431, 26, 'Output   Collapse'), (458, 24, 'Copy output'), (485, 26, 'Rich output ▾')]:
    parts += [rect(31, y, 528, height, '#e3e7ed'), text(47, y + 18, label, 14, '#4c5968')]
parts += [text(53, 552, 'Model', 15, weight='bold'), text(350, 552, 'Test RMSE', 15, weight='bold'),
          text(53, 581, 'Two-line', 15), text(383, 581, '2.117', 15),
          text(676, 166, '설명 제목', 24, weight='bold'),
          text(676, 203, '문서 본문은 읽기 좋은 폭으로 흐르고,', 17),
          text(676, 232, '코드·표는 필요한 너비를 사용한다.', 17),
          rect(674, 272, 496, 130, '#f1f4f7', '#ccd4dd', 5),
          text(645, 301, '▷', 21, '#344455'), text(637, 390, '[33]', 13, '#526172'),
          text(694, 310, 'evaluation_table = ...', 17), text(694, 341, 'evaluation_table.round(3)', 17),
          text(694, 384, '실행 상태 · 필요할 때 확인하는 조작', 13, '#526172'),
          rect(685, 420, 470, 32, '#e3e7ed'), text(699, 442, 'Model', 15, weight='bold'), text(1020, 442, 'Test RMSE', 15, weight='bold'),
          text(699, 477, 'Two-line', 15), text(1060, 477, '2.117', 15),
          text(699, 511, 'Affine', 15), text(1060, 511, '3.880', 15),
          text(676, 581, '다음 해석으로 이어진다', 21, weight='bold'),
          text(30, 654, '핵심 상태는 계속 보인다. 편집·선택·실행 상태의 표현과 키보드 조작은 유지한다.', 16, '#526172')]
save('reading-structure.svg', 1200, 680, '현재 셀 카드 구조와 제안하는 읽기 구조',
     '현재는 Markdown과 코드가 같은 상자에 들어 있고 코드와 결과 사이에 조작 줄들이 있다. 제안에서는 문서 본문, 코드, 표가 역할에 따라 구분되고 코드와 결과가 가까이 연결된다.', parts)
