from pathlib import Path
import html, json, re

out = Path(__file__).resolve().parent
esc = html.escape

def load(name, default=None):
    file = out / name
    return json.loads(file.read_text()) if file.exists() else default

def linked_file(pattern, label):
    files = sorted(out.glob(pattern))
    return f'<a href="{esc(str(files[-1].relative_to(out)))}">{esc(label)}</a>' if files else esc(label)

contract = (out / 'preview-contract-final.log.txt').read_text() if (out / 'preview-contract-final.log.txt').exists() else ''
contract = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', contract)
passed = re.findall(r'\b(\d+) passed \(', contract)
failed = re.findall(r'\b(\d+) failed\b', contract)
contract_status = f'Electron {passed[-1]}개 통과' if passed and '[213/213]' in contract and not failed else '전체 통합 검증 진행 중' if not failed else f'전체 Electron: {passed[-1] if passed else 0}개 통과, {failed[-1]}개 실패 — 로그 참조'
bench = load('benchmark-final/comparison.json', {})
fonts = load('code-typography.json', {})
frames = list(out.glob('contract-final/**/presentation-frames.json')) or list(out.glob('revision-4/**/presentation-frames.json'))
frame_data = json.loads(frames[0].read_text()) if frames else {}
font_rows = ''.join(f'<tr><th>{esc(label)}</th><td>{esc(str(fonts.get("vscode", {}).get(key, "측정 중")))}</td><td>{esc(str(fonts.get("setdown", {}).get(key, "측정 중")))}</td></tr>' for key, label in [('family', 'CSS 글꼴'), ('size', '글자 크기'), ('lineHeight', '행간'), ('inset', '편집기 기준 왼쪽 글자 여백 (px)')])
bench_html = '<p>비교 측정 대기 중. 수치가 없는 상태는 통과를 뜻하지 않습니다.</p>'
if bench.get('comparisons'):
    rows = {r['key']: r for r in bench['comparisons']}
    def pair(kind, wait, edit, cycle, metric, inclusive=False):
        r = rows[f'{kind}/idle={wait}/edits={str(edit).lower()}/{cycle}/{metric}']
        add = wait if inclusive and cycle == 'first' and metric == 'captureMs' else 0
        return f'{r["baselineMs"] + add:.0f} → {r["candidateMs"] + add:.0f}'
    body = ''
    for kind, label in [('document', 'Markdown'), ('review', 'Git review')]:
        for wait in [0, 3000]:
            for edit in [False, True]:
                cells = ''.join(f'<td>{pair(kind,wait,edit,cycle,metric)}</td>' for metric in ['captureMs', 'doubleClickToEditorMs'] for cycle in ['first', 'second', 'warm'])
                body += f'<tr><th>{label}</th><td>{wait}</td><td>{"있음" if edit else "없음"}</td>{cells}</tr>'
    inclusive = ''.join(f'<tr><th>{label}</th><td>{"있음" if edit else "없음"}</td><td>{pair(kind,3000,edit,"first","captureMs",True)}</td></tr>' for kind,label in [('document','Markdown'),('review','Git review')] for edit in [False,True])
    bench_html = f'''<p><strong>{'PASS' if bench.get('passed') else 'FAIL'}</strong> — {len(bench.get('regressions', []))} regressions / {len(rows)} buckets. 각 버전 {bench['runs']}회, 8개 조건, 실행당 5회 전환. 임계값은 +25%와 +50ms를 동시에 초과할 때 실패하는 기존 기준 그대로입니다.</p>
    <p>단위 ms, 변경 전 → 변경 후 중앙값. 첫 번째·두 번째·warm(3–5회)은 분리했습니다. 아래 표는 준비 대기시간을 제외합니다.</p><div class="overflow"><table><thead><tr><th>화면</th><th>준비 대기</th><th>편집</th><th>Esc 첫째</th><th>Esc 둘째</th><th>Esc warm</th><th>더블클릭 첫째</th><th>더블클릭 둘째</th><th>더블클릭 warm</th></tr></thead><tbody>{body}</tbody></table></div>
    <p>3000ms 준비 대기를 포함한 첫 Esc는 아래와 같습니다. 0ms 조건은 위 표와 같고, 둘째·warm·더블클릭에는 준비 대기를 더하지 않습니다. 준비 작업의 CPU 시간이 아니라 지정한 대기시간을 더한 값입니다.</p><table><thead><tr><th>화면</th><th>편집</th><th>첫 Esc + 준비 대기</th></tr></thead><tbody>{inclusive}</tbody></table>
    <p>원시 측정·실행 순서·빌드 해시: <a href="benchmark-final/comparison.json">comparison.json</a>. Esc 수치는 최신 내용의 비어 있지 않은 네이티브 캡처가 돌아오는 시점이며 모니터 표시 지연은 아닙니다.</p>'''
elif bench.get('error'):
    bench_html = f'<p>측정 완료 전 실패: {esc(bench["error"])}. 통과로 취급하지 않습니다.</p>'

page = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setdown — VS Code 노트북 디자인 구현 검증</title>
<style>body{{margin:0;background:#f4f5f7;color:#202630;font:16px/1.65 system-ui,sans-serif}}main{{max-width:1180px;margin:auto;padding:48px 24px 100px}}h1{{font-size:36px;line-height:1.2}}h2{{margin-top:52px;font-size:25px}}h3{{font-size:18px}}.muted{{color:#5b6572}}a{{color:#145cb5}}figure{{margin:20px 0}}img{{display:block;width:100%;border:1px solid #d5dae0;border-radius:7px}}figcaption{{font-size:14px;color:#5b6572;padding-top:8px}}table{{border-collapse:collapse;background:white;font-size:14px;width:100%;margin:20px 0}}th,td{{border-bottom:1px solid #dce1e7;padding:10px;text-align:left;white-space:nowrap}}thead{{background:#e7edf4}}.overflow{{overflow:auto}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}.card{{background:white;border:1px solid #dce1e7;border-radius:8px;padding:20px}}code{{background:#e8edf2;padding:2px 5px;border-radius:4px}}@media(max-width:780px){{.grid{{grid-template-columns:1fr}}h1{{font-size:28px}}}}details{{margin:20px 0}}summary{{cursor:pointer;font-weight:600}}</style>
<main><p class="muted">구현 및 검증 · 2026-10-30 · 범위: Jupyter Notebook</p><h1>VS Code 기준의 노트북 편집·읽기 화면</h1>
<p>코드 셀, Markdown, 출력, 실행 상태, 도구 모음, 삽입·메뉴·키보드 동작을 함께 변경했습니다. <a href="../notebook-vscode-study-2026-10-30/index.html">선행 연구</a>에서 검증한 VS Code 1.143.0의 기본값을 기준으로 삼았습니다.</p>
<div class="grid"><div class="card"><strong>기능 검증</strong><p>노트북 Electron 15개 통과<br>단위 테스트 93개 파일 / 654개 통과<br>{esc(contract_status)}</p><a href="preview-contract-final.log.txt">전체 실행 로그</a></div><div class="card"><strong>전환 중 임시 화면 제거</strong><p>신규 열기 → 다른 노트북 → 편집 후 Esc → 기존 탭 복귀를 프레임 단위로 검사했습니다.</p><p>표시 프레임 {frame_data.get('visibleFrames', '—')}개 · 임시 원문/빈 코드 프레임 {len(frame_data.get('rawFrames', []))}개</p>{linked_file('contract-final/**/presentation-frames.json','프레임 기록')}</div></div>
<h2>노트북 전반</h2><ul><li>8px 왼쪽 여백 + 36px 실행 영역, 16px 오른쪽 여백. 코드 위 12px·아래 4px와 22px 상태줄.</li><li>실행 번호는 왼쪽, 언어·실행 상태는 셀 아래. 셀 테두리를 Monaco 위에 그려 위·옆 경계가 가려지던 문제를 해결했습니다.</li><li>Codicons 도구 모음과 셀·출력 팝오버, 셀 사이 삽입 버튼. 마우스 이동으로 셀 높이가 변하지 않습니다.</li><li>기본 코드·출력 줄바꿈, 줄 번호, 고정 제목은 꺼짐. 노트북 명령에서 각각 전환할 수 있습니다.</li><li>Markdown은 코드 크기의 1.2배와 전체 셀 폭을 사용하고, HTML 출력은 기본 UI 글꼴·크기를 사용합니다.</li><li>Shift+Enter는 기존 다음 셀의 선택 모드로 이동하고, 마지막에서는 같은 종류의 셀을 만듭니다. Alt+Enter는 코드 셀을 추가합니다.</li></ul>
<figure><a href="implemented-solarized-light.png"><img src="implemented-solarized-light.png" alt="구현된 노트북의 전체 셀과 출력 구성"></a><figcaption>Setdown 구현 · Solarized Light. 커널 실행 없이 저장된 출력으로 캡처했습니다.</figcaption></figure>
<details><summary>밝은 테마와 어두운 테마</summary><div class="grid"><figure><img src="implemented-github-light.png" alt="밝은 테마 구현"><figcaption>GitHub Light</figcaption></figure><figure><img src="implemented-one-dark.png" alt="어두운 테마 구현"><figcaption>One Dark</figcaption></figure></div></details>
<h2>Python 코드 영역</h2><p>글꼴과 행간은 실제 VS Code 실행 화면의 계산된 스타일과 대조했습니다. 배경과 문법 색상은 선택한 Setdown 테마에 따릅니다. 8개 테마에서 실제 코드 주석 대비 4.5:1 이상을 확인했으며, GitHub 밝은·어두운 테마는 대비가 낮아지지 않도록 원래 편집기 배경을 사용합니다. 기본 Monaco Python 편집기와 기존 LSP를 유지하며, Pylance나 VS Code의 모든 확장 기능을 복제한 것은 아닙니다.</p><table><thead><tr><th>항목</th><th>VS Code</th><th>Setdown</th></tr></thead><tbody>{font_rows}</tbody></table><p><a href="code-typography.json">측정 JSON</a> · <a href="reference-vscode.png">실제 VS Code 캡처</a></p>
<p>{linked_file('contract-final/**/notebook-contrast.json','8개 테마 실제 색 대비 측정')}</p>
<h2>노트북 전환의 깜박임</h2><p>제공된 01:06:02 녹화에서는 노트북을 바꿀 때 Markdown 원문이 먼저 표시된 뒤 제목·본문으로 바뀌었습니다. 초기 화면과 비활성 탭의 재진입은 뷰포트 관찰, 코드 편집기 배치, 최신 Markdown 렌더링이 완료된 뒤 공개합니다. 편집 후 Esc도 원문을 임시 미리보기로 내보내지 않습니다. 이미 수정된 일반 Markdown Esc 전환의 테스트도 계속 Xvfb에서 수행합니다.</p><p>90% 앱 배율에서 발견한 긴 셀 끝부분의 약 1픽셀 오차도 수정했습니다. 정수 단위인 Monaco 스크롤과 소수점이 있는 CSS 배치를 맞추며, 문서 높이와 외부 스크롤은 그대로 유지합니다. 90%·100%·130% 및 창 크기 변경의 기존 좌표 허용치를 완화하지 않았습니다.</p>
<h2>출력의 정상 줄바꿈</h2><p>긴 단어를 문자 단위로 쪼개던 prose 스타일을 HTML 출력에서 분리했습니다. pandas 출력의 표는 필요한 최소 너비를 확보하고 출력 안에서 가로로 스크롤합니다. 아래는 동일한 pandas 2.3.3 HTML의 실제 Chromium 측정입니다.</p><table><thead><tr><th>내용 폭</th><th>변경 전 표 높이</th><th>VS Code</th><th>구현 후</th></tr></thead><tbody><tr><th>420px</th><td>1580.47px</td><td>322px</td><td>322px</td></tr><tr><th>560px</th><td>740.47px</td><td>322px</td><td>322px</td></tr><tr><th>780px</th><td>404.47px</td><td>227px</td><td>227px</td></tr></tbody></table><p>{linked_file('contract-final/**/dataframe-geometry.json','출력 측정 원본')} · HTML 우선 MIME 선택, 이미지 보기·저장, 출력 복사, 포맷 전환도 검증했습니다.</p>
<h2>성능 비교</h2><p>변경 전 기준은 <code>3b0b7372d73be86fb61260b3594650c915681c9a</code>이며, 별도 checkout과 독립된 의존성을 사용합니다. 양쪽 빌드에 <code>SETDOWN_BUILD_SOURCEMAP=0</code>을 동일하게 적용했습니다. 모든 비교는 같은 격리 디스플레이에서 실행합니다.</p>{bench_html}
<h2>유지한 보장과 검증 범위</h2><p>저장된 JSON·메타데이터·첨부·출력의 원본 보존, 렌더링 HTML 정화, 한글 IME, Monaco 팝업의 Esc 우선권, 텍스트/셀 Undo, 검색 포커스, 드래그, 출력 높이 보존, Python 커널 실행을 확인했습니다. 저장된 HTML의 임의 CSS·스크립트를 허용하지 않았으며, 위젯·확장 렌더러·디버거까지 VS Code와 동일하다고 주장하지 않습니다.</p><p>초기 실패와 수정 후 기록은 <code>initial/</code>, <code>revision-2/</code>, <code>revision-3/</code>, <code>revision-4/</code>에 보존합니다. 재시도 설정이나 기존 허용치를 바꿔 통과시키지 않았습니다.</p><p>검증 이력: 첫 전체 실행은 213개가 통과했습니다. 대비 검사를 추가한 다음 전체 실행에서는 신규 측정 코드의 공백 처리 오류와 기존 Git 탭의 첫 프레임 검사 실패가 각각 발생했습니다. Monaco의 표시 공백을 정규화하여 측정 오류를 고쳤습니다. Git 검사는 변경 전 독립 빌드와 변경 후 별도 진단에서 모두 통과했으나 최초 실패 원인은 확정하지 못했습니다. 실패 기록을 보존하고 첫 프레임 상태를 JSON으로 남기도록 진단만 추가했습니다. Git 제품 동작과 기존 시간·내용 검증은 변경하지 않았습니다. 최종 전체 실행에서는 노트북 15개를 포함한 212개가 통과했고, 소스 관리의 긴 경로 검사에서 60초 시간 초과 1건이 발생했습니다. 너비 220px·400px 캡처는 완료됐으나 시간 초과한 정확한 호출은 로그에 남지 않았습니다. 해당 검사에 추적을 켠 별도 진단은 2.4초에 통과했으나 시간 초과 원인은 재현하지 못했습니다. 최초 실패는 그대로 보존하며 전체 검증을 통과로 취급하지 않습니다. <a href="scm-timeout-diagnostic.log.txt">소스 관리 추적 진단 로그</a> <a href="preview-contract-before-contrast.log.txt">첫 전체 실행</a> · <a href="preview-contract-after-contrast.log.txt">실패 실행</a> · <a href="baseline-git-diagnostic.log.txt">기준 버전 진단</a> · <a href="final-diagnostic.log.txt">변경 후 진단</a></p><p><a href="../../docs/contracts/notebook.md">갱신한 노트북 계약</a> · <a href="../../apps/desktop/test/e2e/notebook/notebook.spec.ts">실제 Electron 회귀 테스트</a> · <a href="capture.mjs">비교 캡처 스크립트</a></p>
</main></html>'''
(out / 'index.html').write_text(page)
