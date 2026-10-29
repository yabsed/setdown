from pathlib import Path
import json, html

HERE = Path(__file__).resolve().parent
SHA = '2d0b7506a36c1d6db9a466440131a8e01eab2289'
BASE = f'https://github.com/microsoft/vscode/blob/{SHA}/'
NB = 'src/vs/workbench/contrib/notebook/'
def source(path, label, line=None):
    return f'<a href="{BASE}{path}{f"#L{line}" if line else ""}">{label}</a>'
def local(path, label):
    return f'<a href="../../{path}">{label}</a>'
def table(headers, rows):
    return '<div class="table-scroll"><table><thead><tr>'+''.join(f'<th>{x}</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join(f'<td>{x}</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'
def section(id, title, body):
    return f'<section id="{id}"><h2>{title}</h2>{body}</section>'
opts = source(NB+'browser/notebookOptions.ts','VS Code: NotebookOptions',195)
config = source(NB+'browser/notebook.contribution.ts','VS Code: notebook 설정',977)
renderer = source('extensions/notebook-renderers/src/index.ts','VS Code: 내장 출력 렌더러',420)
webview = source(NB+'browser/view/renderers/backLayerWebView.ts','VS Code: 출력 webview CSS',350)
md = source('extensions/markdown-language-features/notebook/index.ts','VS Code: notebook Markdown 렌더러',140)
cell = local('apps/desktop/src/renderer/notebook/NotebookCell.svelte','Setdown: NotebookCell.svelte')
surface = local('apps/desktop/src/renderer/notebook/NotebookSurface.svelte','Setdown: NotebookSurface.svelte')
outputs = local('apps/desktop/src/renderer/notebook/NotebookOutputs.svelte','Setdown: NotebookOutputs.svelte')
content = local('apps/desktop/src/renderer/notebook/notebook-content.ts','Setdown: notebook-content.ts')
typo = local('apps/desktop/src/renderer/notebook/notebook-typography.css','Setdown: notebook-typography.css')
contract = local('docs/contracts/notebook.md','Setdown notebook 계약')
sections = []

sections.append(section('decision','1. 권장 방향',f'''
<p class="lead">Setdown의 Jupyter Notebook을 VS Code에 가깝게 만들려면 <strong>셀의 구조·상태·조작 규칙을 먼저 통일하고, 코드·Markdown·출력을 서로 다른 표현 계층으로 다뤄야 한다.</strong> 표 줄바꿈은 이 분리가 충분하지 않아서 생긴 한 사례다.</p>
<p>우선순위는 <strong>① 노트북의 공간 배치와 글꼴 체계 → ② 셀 상태와 도구 모음 → ③ Markdown·코드·출력별 표현 → ④ 키보드·스크롤·접근성의 일관성</strong>이다. 특정 표의 너비만 늘리거나 모든 요소에 같은 글꼴·줄바꿈 규칙을 적용하면 전체 인상은 계속 다르게 남는다.</p>
<p>목표는 VS Code의 노트북 사용자가 셀을 읽고, 선택하고, 편집하고, 실행하는 과정에서 익숙한 위치와 반응을 만나는 것이다. 별도 제품인 Setdown의 이름이나 프로그램 전체 UI를 바꾸는 제안은 이 보고서 범위에 포함하지 않는다. 아래 제안은 구현 전 연구이며 <strong>앱 소스는 변경하지 않았다.</strong></p>
<div class="note">기존 Setdown 구현을 정답으로 전제하지 않았다. 현재 코드에서 확인한 동작과 제약을 기록하고, VS Code에 맞춰 바꿀 부분과 데이터·편집 안정성을 위해 유지할 보장을 구분했다.</div>
'''))

sections.append(section('method','2. 조사 기준과 확인 범위',f'''
{table(['구분','기준'],[
('기준 제품','설치된 VS Code <b>1.143.0</b>, commit <code>'+SHA+'</code>. 최신 main의 동작을 섞지 않고 이 버전의 소스와 실제 앱을 대조했다.'),
('Setdown 기준','조사 시작 시 commit <code>9cb327c7749a969eb47a81597a8542c78b95ab3d</code>. 기존 desktop 빌드로 실행했고, production 소스를 수정하거나 새로 빌드하지 않았다.'),
('실행 환경','Linux, 실제 Electron/Chromium, Xvfb + 별도 runtime directory + 별도 D-Bus + 임시 프로필. 사용자 데스크톱에 테스트 창을 띄우지 않았다.'),
('비교 자료','직접 만든 저장 출력 fixture. pandas 2.3.3의 실제 HTML 표현을 사용했다. 원본 사용자 노트북은 아니며, 스크린샷의 이름·일부 수치를 재구성했다.'),
('전체 노트북 화면','동일한 Solarized Light 테마 이름, 100% 배율, 기본 14px 코드 크기를 기준으로 Markdown·코드·stream·DataFrame을 함께 촬영. 창 높이는 VS Code 800px, Setdown 1050px이므로 한 화면에 들어간 셀 수로 밀도를 비교하지 않는다. 테마 이름이 같아도 색상 토큰은 동일하지 않다.'),
('정량 비교','표를 담는 실제 content box를 420 / 560 / 780 CSS px로 맞췄다. computed style, table bounds, 문자별 Range의 줄 위치를 기록했다. 창 전체 너비를 표 너비로 오인하지 않았다.'),
('실행하지 않은 검증','커널 실행·디버거·원격 서버·위젯·장시간 대형 노트북 성능·스크린리더 실사용은 이번 실측 대상이 아니다. 관련 항목은 소스/공식 문서 분석과 후속 검증 제안으로 표시한다.')])}
<p>실제 VS Code 측정은 별도 확장 디렉터리의 내장 ipynb serializer와 내장 renderer를 사용했다. 재현용 fixture만 있는 임시 프로필에서 rich output을 관찰하기 위해 workspace trust 기능을 껐다. 이는 Setdown의 보안 정책을 바꾸자는 제안이 아니다. 일반 사용자의 Jupyter/Python 확장과 커널은 추가 명령·상태·렌더러를 제공할 수 있다.</p>
<p>근거 표기: <b>실측</b>은 저장된 JSON·스크린샷, <b>소스 확인</b>은 구현/설정 정의, <b>제안</b>은 앞으로 적용할 설계다. 표 실측 결과를 노트북 전체 기능의 검증으로 확대하지 않았다.</p>
'''))

sections.append(section('overview','3. 실제 노트북 화면에서 드러나는 차이',f'''
<figure><a href="vscode-overview.png"><img src="vscode-overview.png" alt="VS Code에서 동일한 Markdown, 코드, stream 및 표를 표시한 노트북" loading="lazy"></a><figcaption>VS Code 1.143.0 · Solarized Light · 실제 실행 화면. 위쪽 도구 모음, 왼쪽 실행/선택 영역, 코드 셀 아래 출력의 계층을 확인할 수 있다.</figcaption></figure>
<figure><a href="setdown-overview.png"><img src="setdown-overview.png" alt="Setdown에서 동일한 저장 출력 노트북을 표시한 화면" loading="lazy"></a><figcaption>Setdown 현재 빌드 · Solarized Light. 프로그램 바깥 UI는 연구 대상에서 제외하며, 노트북 내부만 비교한다. 이미지 클릭으로 원본 크기 확인.</figcaption></figure>
<p><b>관찰:</b> Setdown은 위쪽에 Outline·Variables·Commands·셀 개수·Undo/Redo·커널 상태를 함께 나열한다. VS Code는 노트북 단위 실행/삽입/메뉴와 오른쪽 커널 선택의 구분이 더 뚜렷하다. Setdown의 셀 도구 모음은 셀 종류 선택과 여러 문자 버튼이 한 줄에 모여 있고, 출력마다 아래쪽 작업 행이 별도로 공간을 차지한다. {surface}, {cell}, {outputs}.</p>
<p><b>관찰:</b> Setdown의 Markdown 제목은 더 작고 굵으며, 본문 줄 간격과 목록 간격은 넓다. 코드 글꼴은 D2Coding, HTML 출력은 system-ui로 이미 분리되어 있지만, 출력 표가 Markdown의 글자 크기와 줄바꿈을 함께 상속한다. 코드의 긴 줄은 Setdown에서 자동으로 접히도록 설정되어 있고, 이번 VS Code 기본 프로필에서는 가로 스크롤한다. {typo}, {cell}, {md}.</p>
<p><b>판단:</b> 색상만 맞추는 작업보다 <strong>도구의 위치와 개수, 셀 사이 공간, 제목과 본문의 비율, 입력과 출력의 경계</strong>를 먼저 맞추는 편이 전체 노트북의 유사성을 크게 높인다. VS Code도 코드 셀과 도구 모음에 둥근 모서리를 사용하므로, “VS Code처럼 만들기 = 모든 모서리를 각지게 만들기”로 단순화하면 안 된다.</p>
'''))

gap_rows = [
('노트북 상단 도구 모음','삽입·전체 실행·추가 명령, 우측 커널 선택','Undo/Redo·Outline·Variables·Commands·셀 개수·실행·커널 상태가 함께 배치','주요 명령과 커널 영역을 고정하고 보조 명령은 메뉴로 모으기','P1'),
('셀 왼쪽 영역','실행·선택 표시·실행 번호가 역할별로 배치','실행 문자, 별도 drag handle, 선택 버튼 역할의 실행 번호','실행 번호/선택/드래그의 시각·포인터 영역을 분리하고 VS Code 위치에 맞추기','P1'),
('셀 도구 모음','간결한 아이콘/메뉴, 표시 조건 설정 가능','셀 종류 select + 다수 문자 버튼 + Clear output','자주 쓰는 동작만 아이콘으로, 나머지는 셀 메뉴로 이동','P1'),
('셀 사이 삽입','노트북 툴바와 셀 사이 삽입 affordance','상단 삽입 및 셀 도구 모음의 +','셀 경계에서 위/아래 삽입 위치를 명확히 보여주기','P1'),
('선택·편집 상태','선택 표시와 편집기 포커스 경계를 구분','왼쪽 선택선과 편집 포커스 outline은 이미 있음','현재 기반을 유지하며 비활성 선택/다중 선택/출력 포커스까지 상태별 토큰 정리','P1'),
('코드 편집','Monaco + notebook 설정 + 언어별 editor 설정','Monaco, wordWrap:on 고정, 줄 번호 기본 표시','노트북 코드의 wrap/줄 번호/글꼴 설정을 기준 프로필과 맞추기','P2'),
('Markdown','전용 renderer와 CSS, 본문/제목 계층','Crossnote + 자체 typography, 본문 40em 제한','제목 크기·굵기·목록 간격·본문 폭·inline code를 별도로 맞추기','P2'),
('HTML 출력','HTML 자체 레이아웃 + 출력 영역 스크롤','Markdown 클래스 재사용, authored CSS 제거','출력 전용 CSS 경계와 MIME별 기본 표현 마련','P2'),
('일반 텍스트/오류','텍스트 전용 font/wrap/line limit, ANSI 처리','pre-wrap/anywhere, ANSI 제거, traceback 링크 제공','표와 독립적인 텍스트 wrap·색·overflow 정책으로 정리','P2'),
('실행 상태','상태 아이콘·실행 시간·언어 등의 셀 status 영역','Completed/Running 등의 문장 행, 전역 kernel 상태','고정된 status 슬롯과 단계별 아이콘/문구, 같은 의미의 상태는 같은 위치','P1'),
('출력 도구','출력별 메뉴·복사·표현 선택','출력 아래 30px 이상 footer, hover 때 표시','출력 가까이 메뉴를 두고 항상 예약되는 footer 공간 줄이기','P1'),
('Find/Outline/Variables','문서 찾기, Outline, 별도 변수 보기','본문 위 search/outline 행, 아래 변수 영역','노트북 본문 높이를 예측 가능하게 하고 독립적인 열기/닫기/포커스 제공','P3'),
('키보드·접근성','셀 command/edit 모드, 컨텍스트별 명령','주요 단축키와 IME 보호가 이미 있음','단축키 이름뿐 아니라 이동 후 포커스와 입력 소유권까지 비교','P2'),
('대형 출력·스크롤','출력 크기 통지, 가상화, 위치 안정화','viewport Monaco·측정된 output placeholder','기존 보장을 유지하며 스타일 변경 뒤 높이·앵커 재검증','모든 단계'),
('위젯·SVG·원격·디버거','확장/커널/렌더러가 기능 제공','정적 출력 중심, 외부 JupyterLab 진입 제공','현재 지원 범위를 명확히 표시하고 별도 기능 단계로 관리','P3+')]
sections.append(section('matrix','4. 노트북 전반의 차이와 우선순위',f'''
{table(['영역','VS Code 기준','Setdown 현재','권장 변경','순서'],gap_rows)}
<p>이 표는 화면/소스 대조에 따른 설계 우선순위이며 구현 완료 목록이 아니다. P1은 구조와 시각 상태, P2는 콘텐츠별 표현과 조작, P3는 보조 경험을 뜻한다. 주요 근거: {config}, {opts}, {surface}, {cell}, {outputs}, {content}.</p>
'''))

sections.append(section('anatomy','5. 셀의 구조와 공간 배치',f'''
<div class="diagram" aria-label="권장 노트북 구조">
 <div class="diagram-top">노트북 명령: + Code · + Markdown · Run All · … <span>커널 선택</span></div>
 <div class="insert">셀 사이 삽입 위치</div>
 <div class="diagram-cell"><aside>선택선<br>실행<br>[20]</aside><div><div class="diagram-tools">편집 / 분할 / … / 삭제</div><div class="diagram-code">코드 편집기 — 입력 포커스 경계</div><div class="diagram-status">실행 상태 · 경과 시간 <span>Python</span></div><div class="diagram-output">출력 — MIME별 renderer, 필요한 축만 스크롤</div></div></div>
 <div class="insert">셀 사이 삽입 위치</div>
 <div class="diagram-md">Markdown — 문서 본문으로 표시, 편집 시 코드 편집기로 전환</div>
</div>
<p class="caption">역할을 설명하는 설계도. VS Code 화면을 픽셀 단위로 복제한 목업은 아니다.</p>
{table(['공간 항목','VS Code 소스의 기본값','Setdown 현재 소스','적용 시 판단'],[
('코드 셀 왼쪽 기준','compact: left margin 8px + run gutter 36px','셀 padding-left 54px + 바깥 scroll padding','단일 값만 줄이지 말고 선택선·실행 버튼·번호·코드 시작점의 합산 위치를 비교'),
('셀 위/아래 여백','cellTopMargin 6px / cellBottomMargin 6px; 삽입 도구·status 공간은 별도','셀 margin-bottom 28px; Markdown 별도 padding','6+6과 28을 그대로 치환하면 틀림. 상태별 실제 총 높이를 측정'),
('편집기 내부','top 12px, bottom 4px 또는 status 없음 12px','top 16px, bottom 12px; 최소 높이 65px','빈 셀·한 줄·여러 줄·실행 완료 셀을 따로 맞추기'),
('출력 외곽 padding','기본 8px, renderer wrapper/경계는 별도','12px 12px 0','코드 글자 시작점과 출력 시작점의 정렬을 함께 확인'),
('셀 status 영역','기본 22px; showCellStatusBar 설정의 영향','실행 상태가 있을 때 문장 행 추가','상태 변화로 본문이 흔들리지 않는 슬롯/예약 높이 설계'),
('출력 작업 공간','출력 메뉴/렌더러 작업 영역','최소 30px footer가 opacity:0이어도 높이 유지','표·로그·이미지마다 별도 footer가 쌓이는 밀도 차이를 줄이기')])}
<p>숫자는 렌더링 결과의 전체 높이가 아니라 해당 모듈의 상수다. 정확한 목표는 동일 폭·배율·폰트·셀 상태에서 얻은 bounding box다. 근거: {opts}, {cell}, {outputs}.</p>
<p><b>제안:</b> 노트북 전용 layout tokens를 만들고 gutter, input padding, status height, output padding, cell gap을 한곳에서 관리한다. 상단 명령은 한 줄을 유지하며 좁은 pane에서 우선순위가 낮은 명령을 … 메뉴로 넘긴다. 셀 도구 모음의 가로 스크롤을 기본적인 접근 방식으로 삼지 않는다.</p>
'''))

sections.append(section('typography','6. 글꼴·Markdown·코드·색상 체계',f'''
<p>VS Code의 노트북은 코드용 글꼴, 본문/HTML용 글꼴, UI 크기를 구분한다. Setdown도 일부 분리되어 있으므로 기존 구분을 정리하면 된다. 특히 <strong>Markdown의 본문 CSS를 HTML 출력에 재사용하는 연결</strong>은 끊는 것이 좋다. 이것이 표, 긴 식별자, 이미지와 일반 prose를 같은 규칙으로 처리하게 만드는 지점이다. {renderer}, {md}, {typo}.</p>
{table(['항목','VS Code 기준','Setdown 현재','권장 방향'],[
('코드','editor 계열 설정 및 notebook customization','D2Coding / textZoomOptions','기준 프로필의 code font·size·lineHeight와 일치시키되 한글 fallback을 확인'),
('Markdown 본문','markup.fontSize=0이면 editor 크기의 1.2배','14px 기반 × 1.142857 = 16px; line-height 1.7','14px 기준 VS Code 16.8px와 비교. 줄 간격/목록 여백도 함께 맞추기'),
('Markdown H1','전용 CSS 2.3em, normal weight','1.8em, 650 weight','기본 크기 기준 38.64px 대 28.8px. 제목 크기를 키우고 굵기를 낮추는 방향이 더 가까움'),
('Markdown H2/H3','2em / 최종 유효 규칙 1.5em; normal weight','1.5em / 1.25em; 650 weight','실제 cascade의 최종값으로 맞추기. 소스에 중복 H3 규칙이 있어 첫 선언만 복사하면 틀림'),
('본문 폭','확인한 기본 Markdown renderer에 Setdown식 40em 제한 없음','p·목록·제목 등에 max-width:40em','VS Code 유사성 기준에서는 노트북 기본 폭 제한을 재검토; 일반 Markdown 리더와 분리'),
('HTML 출력','실측 system-ui, 14px, line-height normal','실측 system-ui, 16px; 표 line-height 24px','출력 fontSize를 Markdown 배율에서 분리'),
('inline code·링크·목록','Markdown renderer의 전용 규칙','자체 .9em code, 링크 상시 underline, 목록/문단 여백','태그별 비교 fixture로 크기·강조·간격·hover를 함께 맞추기')])}
<p>H1/H2/H3 수치는 기본 14px 코드 크기와 해당 기본 CSS의 계산값이다. 확장·사용자 CSS·다른 글꼴에서 실제 높이는 달라질 수 있다. {md}, {webview}, {typo}.</p>
<p><b>색상 제안:</b> 노트북 canvas, 셀 editor background, 선택선, 비활성 선택, hover, output background, 실행 성공/오류/실행 중을 별도 의미 토큰으로 둔다. 현재 공통 <code>--app-*</code> 색을 여러 상태에 재사용하는 방식만으로는 VS Code의 상태 구분을 그대로 표현하기 어렵다. 같은 Solarized Light 이름으로도 코드 셀 배경과 본문 배경의 대비가 다르다. 실제 VS Code의 <code>notebook.*</code> 및 실행 상태 색을 기준으로 매핑하되, 앱 전체 테마를 바꾸지 않고 노트북 범위에서 먼저 맞춘다. <a href="https://code.visualstudio.com/api/references/theme-color#notebook-colors">VS Code Notebook 색상 토큰</a>.</p>
<p><b>아이콘 제안:</b> ▷, ↶, ⧉ 같은 폰트 문자 대신 VS Code notebook icon ID의 의미와 기본 Codicon을 사용하거나 대응 SVG를 둔다. run, stop, trash, pencil, check, arrow, clear, clock, sync의 선 굵기·크기를 통일한다. 폰트에 따라 모양과 기준선이 달라지는 문제가 줄어든다. {source(NB+'browser/notebookIcons.ts','VS Code notebookIcons.ts',10)}. 자산을 가져올 때 해당 MIT 라이선스/저작권 고지를 함께 보존한다.</p>
'''))

sections.append(section('states','7. 선택·편집·실행 상태를 화면 규칙으로 정의하기',f'''
{table(['상태','맞춰야 할 표현','동작 기준'],[
('선택 안 됨','낮은 강조, 불필요한 작업 버튼 감춤','출력 텍스트를 드래그해 복사해도 실행/셀 이동으로 오해하지 않기'),
('Command mode','왼쪽 선택선, 셀 단위 명령 대상 명확화','Enter로 편집, 위/아래 이동, 범위/다중 선택'),
('Edit mode','선택선 + 편집기 포커스 경계','텍스트 단축키·Undo·자동완성·IME가 셀 구조 명령보다 우선'),
('Hover','해당 셀에서 가능한 작업만 표시','도구 모음 출현으로 셀 높이가 바뀌지 않기'),
('Queued / Running','대기/진행 아이콘과 실행 번호의 일관된 위치','중단 가능 여부와 실제 실행 상태 연결; 선택 상태와 별개의 표시'),
('Success / Error / Canceled','작고 안정된 status 슬롯, 오류는 색 외에도 아이콘/문구','오류 결과와 traceback은 출력 영역에서 읽고 이동할 수 있어야 함'),
('이전 소스의 결과','현재 코드와 출력의 관계를 짧게 표시','경고가 모든 dependency의 최신성 검증을 뜻하지 않도록 하기'),
('Collapsed input / output','서로 독립된 접기 affordance와 요약','복원 후 같은 셀/모델/출력·스크롤 상태 유지')])}
<p>Setdown에는 왼쪽 선택선, 편집 시 outline, 실행 상태와 소스 변경 경고, 입력/출력 접기가 이미 있다. 따라서 상태 관리 전체를 새로 만들기보다 <strong>같은 상태를 같은 위치·아이콘·높이로 표현하도록</strong> 정리하는 것이 합리적이다. 현재 <code>.cell-state</code>는 실행 상태가 생길 때 문장 행을 추가하고, 출력 작업은 별도 footer에 놓인다. 이 두 곳을 VS Code의 셀 status / 출력 메뉴 관계에 맞추는 효과가 크다. {cell}, {opts}.</p>
<p>기준 버전의 <code>notebook.cellToolbarVisibility</code> 기본은 <code>click</code>이며 <code>hover</code>도 가능하다. Setdown은 hover·focus-within·selected에서 모두 도구 모음을 보여준다. 따라서 “VS Code는 언제나 hover에서만 표시한다”는 전제로 바꾸면 안 된다. 먼저 기준 프로필을 선택하고 키보드로도 같은 명령을 열 수 있어야 한다. {config}.</p>
'''))

sections.append(section('outputs','8. 출력 전체의 설계: 표·로그·오류·그림·위젯',f'''
{table(['출력 종류','VS Code에서 조사한 기준','Setdown 현재','권장 방침'],[
('text/plain / stream','전용 monospace CSS, wordWrap 설정, ANSI renderer, text line limit','pre-wrap + anywhere; ANSI 제거; CR/backspace는 문자 덮어쓰기 처리','텍스트 줄바꿈을 별도 설정으로. ANSI 색과 링크를 지원하려면 안전한 토큰 렌더링으로 구현'),
('오류/traceback','오류 renderer, 파일/셀 링크, minimal error 설정','텍스트 + 별도 traceback 버튼, ANSI 제거','오류 제목/본문/프레임의 계층을 맞추고 셀 이동 시 포커스·소스 버전 관계 유지'),
('text/html / DataFrame','저장 HTML과 CSS를 출력 webview에서 렌더링','HTML 정화, authored style 제거, 앱 CSS 적용','표뿐 아니라 HTML 출력 전체의 기본 스타일을 독립적으로 마련'),
('Markdown / 수식','Markdown renderer, 확장/Math 기능의 영향','Crossnote fragment 정화; MathML 유지','문서 셀과 Markdown 출력의 공통점은 공유하되 HTML 표와 CSS를 혼합하지 않기'),
('Raster 이미지','이미지 renderer, 출력 작업 및 크기 처리','최대 너비 제한, 전체 크기 보기·저장 제공','확대/원본/저장과 여백·정렬을 맞추고 원본 데이터는 보존'),
('SVG / JavaScript / widget','trust와 renderer/extension에 따라 지원','SVG/active content 제거, unsupported bundle 원본 보존','현재 출력 정책을 유지하며 기능 차이를 표시. 별도 격리 설계 없이 HTML 정화를 완화하지 않기'),
('JSON / 대체 표현','MIME 우선순위 + 사용 가능한 renderer + 선택 상태','정해진 staticOutput 우선순위 및 format select','렌더링 가능한 후보와 선택 상태를 명확히 하고 출력 메뉴에서 표현 변경'),
('긴 출력','textLineLimit 등 MIME별 제한과 표시 방식','100 output 항목; text 200,000, HTML 1,048,576 문자열 길이 제한; raster base64 문자열 8,388,608 길이 제한','절단/미지원/원본 보존을 사용자에게 명시. 문자열 길이 제한은 원본 파일의 byte 크기 제한과 다름. VS Code의 30줄 값을 모든 HTML에 적용하지 않기')])}
<p>근거: {renderer}, {content}, {outputs}, {source(NB+'common/notebookCommon.ts','VS Code MIME 기본 순서',50)}. VS Code는 기본 순서상 HTML이 PNG보다 앞에 있지만, Setdown은 지원 raster를 HTML보다 먼저 선택한다. 동일한 bundle에 두 표현이 있으면 스타일을 맞춰도 처음 보이는 결과가 달라질 수 있다. renderer 가용성과 사용자 선택까지 고려해야 하므로 우선순위 배열 한 줄만 복사하는 것으로 완전한 호환이 되지는 않는다.</p>
<p><b>중요한 구분:</b> <code>editor.wordWrap</code>는 코드 입력, <code>notebook.output.wordWrap</code>는 내장 텍스트/stream/오류 표현, HTML 표의 줄바꿈은 HTML/CSS가 결정한다. 출력의 <em>세로</em> scrolling 설정과 표의 <em>가로</em> overflow도 별개다. {renderer}, {webview}.</p>
'''))

sections.append(section('interaction','9. 키보드·탐색·커널 선택의 정합성',f'''
<p>비슷한 화면은 같은 입력 뒤에 같은 대상이 선택되고 같은 포커스가 남을 때 완성된다. Setdown은 주요 셀 단축키를 이미 제공하지만, 세부 상태 전환은 대조가 필요하다. 단축키 문서의 요약보다 기준 버전의 실제 command 구현을 우선했다.</p>
{table(['입력/행동','VS Code 기준 및 확인할 차이','Setdown 검토/권장'],[
('Enter / Esc','Command↔Edit 상태 전환. 자동완성/팝업과 IME 컨텍스트 우선','기존 popup·IME 보호 유지. Markdown 입력 후 Esc에서 최신 결과·화면 위치를 유지'),
('Shift+Enter','executeAndSelectBelow: 다음 셀이 있으면 container focus; 끝에서는 셀 생성. Markdown 끝에서는 Markdown 셀을 생성하는 경로','현재 runNext는 다음 셀을 editor로 reveal하고, 끝이면 code 생성. 종류·포커스 차이를 맞추는 후보'),
('Alt+Enter','executeAndInsertBelow: 아래 code cell 생성 및 editor focus 경로','현재 삽입 후 showCell. 명칭만 같다고 동등하다고 판단하지 말고 실행/선택 순서를 확인'),
('Ctrl+Enter','현재 실행 대상과 selection 문맥이 중요','편집기에서는 현재 셀, command 모드에서는 selected cells 실행. 다중 선택과 focus 대조 필요'),
('A/B, M/Y, L/Shift+L','삽입 위치·종류 전환·줄 번호 전환','이미 관련 명령 제공. 입력 중에는 문자로 들어가고 command 모드에서만 구조 명령이 되어야 함'),
('방향키·범위 선택·드래그','선택 이동, 연속/비연속 선택, 삽입 위치 미리보기','별도 gutter drag 및 구조 Undo 유지. VS Code식 시각적 대상 표시 강화'),
('Find','소스·출력·rendered Markdown 범위와 결과 이동','현재 범위 선택/replace 제공. 찾기 UI가 본문 높이를 계속 바꾸는 영향과 focus 유지 검증'),
('Outline / Sticky','Markdown 구조 탐색; sticky 설정은 별도','현재 outline이 본문 위 펼쳐지고 scrolled()가 마지막 제목 하나를 sticky 표시. VS Code 기본 sticky=false와 차이'),
('Kernel picker','우측 커널 선택, 실행 상태/지원 언어 문맥','현재 Python executable 선택과 stopped 상태. 경로는 … 처리와 전체 tooltip 유지, local/remote 차이 명확화'),
('Variables / Data viewer','커널 변수 보기와 상세 데이터 보기는 출력 HTML 표와 다른 기능','NotebookVariables가 별도 존재. 출력 표의 스타일 수정으로 변수 보기까지 자동 해결된다고 보지 않기')])}
<p>실행 후 포커스/셀 종류 판단 근거: {source(NB+'browser/controller/executeActions.ts','VS Code executeActions.ts',503)}, {surface}. 변수/커널/Outline의 사용자 흐름은 <a href="https://code.visualstudio.com/docs/datascience/jupyter-notebooks">공식 Jupyter Notebook 문서</a>와 대조했다. 이번 조사에서는 커널을 실제 실행하지 않았으므로 실행 시간·중단·재시작의 동등성을 검증했다고 주장하지 않는다.</p>
<p><b>접근성 제안:</b> 실행 상태를 색만으로 전달하지 않고 이름과 status를 제공한다. 모든 셀 작업은 키보드에서 열리고, 도구 모음이 숨겨져 있어도 선택/편집의 현재 위치가 보이도록 한다. Tab으로 버튼을 이동할 때 셀 실행이나 코드 입력으로 잘못 전환되지 않아야 한다. 이미 있는 real IME/포커스 회귀 검증을 유지한다. {contract}.</p>
'''))

settings = [
('notebook.compactView','true','왼쪽 gutter와 cell margins'),
('notebook.cellToolbarLocation','default: right','셀 작업 위치'),
('notebook.cellToolbarVisibility','click','hover/click의 도구 노출 조건'),
('notebook.cellFocusIndicator','gutter','선택/포커스 표시 위치'),
('notebook.insertToolbarLocation','both','상단 및 셀 사이 삽입'),
('notebook.showCellStatusBar','visible','셀 status 영역'),
('notebook.lineNumbers','off','코드 줄 번호; Setdown은 기본 on에 해당'),
('notebook.markup.fontSize','0 → editor.fontSize × 1.2','Markdown 글자 크기'),
('notebook.markdown.lineHeight','0 → normal','Markdown 줄 높이'),
('notebook.output.fontSize','0 → editor.fontSize','출력 기본 글자 크기'),
('notebook.output.fontFamily','빈 값 → editor.fontFamily','내장 텍스트 출력에 사용; HTML 표를 monospace로 만드는 설정은 아님'),
('notebook.output.lineHeight','0 → editor 기준','텍스트 renderer 줄 높이'),
('notebook.output.wordWrap','false','내장 text/stream/error 줄바꿈'),
('notebook.output.scrolling','stable: false, non-stable: true','긴 텍스트의 초기 세로 스크롤 표현'),
('notebook.output.textLineLimit','30','텍스트 출력 줄 제한/scroll height'),
('notebook.output.minimalErrorRendering','false','간결한 오류 표현 선택'),
('notebook.stickyScroll.enabled','false','기준 버전의 sticky heading 기본값')]
sections.append(section('profile','10. “VS Code처럼”의 기준 프로필을 고정하기',f'''
<p>VS Code의 노트북 디자인은 고정된 이미지 한 장이 아니다. 버전, 테마, 코드 폰트, 배율, pane 폭, 확장, 아래 설정에 따라 달라진다. 구현 전에 <strong>기준 버전 + 설정 snapshot + fixture</strong>를 보관해야 한다. 사용자 스크린샷의 모든 설정을 추정해 정답으로 고정하지 않는다.</p>
{table(['설정','기준 소스 기본값','영향'],settings)}
<p>기본값 근거: {config}, {opts}, {source(NB+'browser/view/cellParts/cellEditorOptions.ts','VS Code lineNumbers 설정',182)}. 사용자 설정에 따라 바뀔 수 있다. 코드 입력의 wordWrap는 editor 설정과 notebook의 editor customization을 함께 확인해야 한다.</p>
<p><b>권장:</b> “VS Code Notebook 기준”을 Setdown의 노트북 기본 스타일로 정하고, 글꼴/배율/줄 번호/텍스트 출력 wrap처럼 의미 있는 선택만 노출한다. 본문과 모든 출력의 세부 CSS 값을 각각 사용자에게 설정하게 하는 방식은 피한다.</p>
'''))

sections.append(section('architecture','11. 가져올 수 있는 것과 재설계가 필요한 것',f'''
<div class="architecture"><div><b>VS Code</b><p>ipynb serializer → notebook model<br>Monaco 셀 편집기 + 가상화된 셀 목록<br>공유 output webview → MIME renderer<br>ResizeObserver → 높이 통지/배치 반영</p></div><div><b>Setdown</b><p>NotebookDocument → controller/store<br>viewport 크기의 Monaco + 논리 높이 예약<br>같은 shell DOM의 Svelte 출력<br>HTML 정화 + Crossnote fragment + output placeholder</p></div></div>
<p>VS Code 출력은 노트북 UI와 분리된 공유 iframe/webview에 배치된다. Markdown renderer는 자신의 shadow root에 스타일을 복제한다. 이번에 측정한 기본 HTML renderer는 그 Markdown shadow root를 쓰지 않고 HTML과 원래 style을 출력 DOM에 넣었다. 따라서 <strong>“VS Code는 모든 셀을 각기 iframe에 넣는다” 또는 “모든 출력이 Shadow DOM이다”는 설명은 정확하지 않다.</strong> <a href="https://code.visualstudio.com/api/extension-guides/notebook#notebook-renderer">Notebook Renderer API</a>, {md}, {renderer}.</p>
{table(['이식 대상','방법','이유'],[
('글꼴 비율·padding·정렬·색상 토큰·아이콘 의미','상수/스타일과 실제 computed 결과를 대조해 notebook 범위에 적용','렌더링 서비스 전체를 들이지 않아도 시각적 정합성을 높일 수 있음'),
('툴바 항목·그룹·표시 조건','Setdown의 현재 command/controller와 연결하는 adapter','VS Code의 서비스·context key·command registry와 직접 결합하지 않기'),
('키보드 상태 전이','기준 command 결과를 명세로 삼아 대응','이름/키 조합이 같아도 다음 cell kind와 focus가 다를 수 있음'),
('원본 HTML/CSS/JavaScript 실행','그대로 복사하지 않고 별도 trust/격리 설계가 필요','VS Code는 trust 경계와 webview를 전제로 하고 Setdown은 정화된 정적 출력 계약을 가짐'),
('가상화·높이 통지·스크롤 보정','기존 Setdown 소유권/측정 모델에 맞춰 유지·검증','workbench 클래스를 복붙하면 focus/model/scroll 소유권이 충돌할 수 있음')])}
<p>첫 구현 단계는 Svelte/Monaco 구조를 유지한 채 노트북 전용 디자인 규칙을 이식하는 것이다. VS Code 전체 workbench를 가져오는 작업은 필요하지 않다. 인터랙티브 renderer 지원이 별도 요구가 될 때 webview 구조를 검토한다. {contract}.</p>
<p>VS Code 개발 문서는 viewport 위의 셀 높이가 바뀌어도 보고 있는 요소의 시각적 위치를 유지하는 것을 중요한 목표로 둔다. 스타일 변경으로 출력 높이가 줄어드는 이번 작업에서도 이 기준이 필요하다. Setdown의 기존 output placeholder와 retained model/Undo/IME 보장을 유지하고, Esc 후 지연된 재배치까지 관찰해야 한다. <a href="https://github.com/microsoft/vscode/wiki/Notebook-documentation#optimizations">VS Code notebook architecture/scroll optimizations</a>, {source(NB+'browser/view/renderers/webviewPreloads.ts','VS Code 크기 측정/통지',461)}, {contract}.</p>
'''))

sections.append(section('roadmap','12. 구현 순서와 완료 기준',f'''
{table(['단계','작업','주요 파일','완료 기준'],[
('0 · 기준 고정','VS Code 버전·설정·fixtures·동일 pane 폭/배율 캡처 저장','이번 보고서 자료 + notebook 전용 비교 harness','idle/selected/editing/hover/running/error/collapsed 상태의 기준 정의'),
('1 · 셀 구조와 작업','상단 툴바, 셀 gutter, status slot, 셀/출력 메뉴, 삽입 affordance 정리','NotebookSurface.svelte / NotebookCell.svelte / NotebookOutputs.svelte','버튼 출현/상태 변화로 불필요한 본문 이동 없음; 좁은 pane에서도 주요 명령 접근'),
('2 · 콘텐츠별 스타일','코드·Markdown·HTML·plain/error typography 분리; 제목/목록/표/이미지 규칙 적용','notebook-typography.css / NotebookCell.svelte / NotebookOutputs.svelte','동일 설정/폭에서 제목·코드·출력 기준선과 밀도가 기준에 수렴; 표 중간 글자 분할 제거'),
('3 · 조작 정합성','Shift/Alt+Enter 결과, 선택/편집/출력 focus, Find, kernel picker와 변수 보기 정리','NotebookSurface.svelte / notebook-controller.ts / NotebookVariables.svelte','기준 command 결과와 셀 종류/포커스/Undo 관계가 일치'),
('4 · 회귀 검증','원본 JSON 보존·IME·실행 상태·긴 셀·가상화·Esc·확대/축소·다크/라이트 확인','기존 notebook tests와 preview contract','기존 보장과 성능 허용치 유지; 실패나 누락은 완료로 처리하지 않음')])}
<p><b>권장 첫 변경 묶음:</b> 노트북 전용 typography/layout tokens, 셀 도구 모음 간소화, status/output actions 배치, Markdown/HTML 스타일 분리까지를 하나의 시각적 기준으로 설계한다. 그 다음 적용은 작은 변경으로 나누어 검증한다. 표만 먼저 고친 뒤 각 화면을 독립적으로 꾸미는 방식은 피한다.</p>
<p><b>시각적 승인 기준 제안:</b> 기준 100% 배율에서 같은 역할의 시작점·높이·padding 차이를 1 CSS px 이내로 목표화하되, 이 수치는 새 비교 기준의 제안이다. 기존 성능·동작 허용치를 변경하는 뜻이 아니다. OS font rasterization 차이는 별도로 기록하고, 의미 있는 줄바꿈/잘림/상태 차이는 폰트 차이라고 넘기지 않는다.</p>
<p>실제 production CSS나 notebook presentation을 변경할 때는 {local('docs/preview-performance-contract.md','preview performance contract')}를 읽고 <code>npm run test:preview-contract</code>와 해당 경로의 baseline/candidate benchmark를 실행한다. 일반 Markdown/Git review의 first·second·warm, 편집 유무, preparation 유무를 각각 보고해야 한다. 이번 보고서는 코드 변경이 없으므로 이 회귀 suite/benchmark를 새로 수행한 결과를 주장하지 않는다.</p>
'''))

accept = [
('내용 조합','빈/한 줄/긴 코드, H1–H6, 목록, 한글/영문 혼합, inline/fenced code, 수식, 이미지, HTML/Markdown 표, MultiIndex, 긴 식별자'),
('셀 상태','unselected, command, edit, hover, multi-select, queued/running/success/error/canceled, stale output, input/output collapsed'),
('크기/테마','pane 420/560/780px 및 넓은 창; 90/100/130% 배율; 동일 Solarized Light 및 대응 dark, 높은 대비'),
('조작','Enter/Esc, Shift/Alt/Ctrl+Enter, 자동완성 팝업, 한글 IME, find input, copy selection, cell copy/cut/paste, drag, structural/text Undo'),
('스크롤','위쪽 셀 높이 변경, 늦은 Markdown/image 로드, 출력 갱신, offscreen 회수/복원, resize/zoom, 코드 편집→Esc 뒤 지연된 위치 변화'),
('데이터/실행','저장 전후 출력·metadata·attachments 원본 보존; 출력 제거/표현 전환; 실행 중 focus 이동; 명시적 Run 전에 커널이 시작되지 않음'),
('접근성','키보드로 모든 셀/출력 작업 접근, 가시적 focus, 상태의 accessible name, 색 외의 오류 단서, 출력 텍스트 선택 유지')]
sections.append(section('acceptance','13. 후속 비교에서 빠지면 안 되는 시나리오',table(['축','확인 대상'],accept)+f'''
<p>이 목록은 후속 구현의 검증 계획이다. 지금 모두 통과했다는 뜻이 아니다. GUI는 모든 경우 <code>apps/desktop/scripts/with-isolated-display.sh</code>를 통해 실행한다. 이전 Esc 조사를 위한 일회성 실제 데스크톱 허용은 계속 적용되는 허용으로 취급하지 않는다. 실패를 숨기기 위한 retry·assertion 완화·시나리오 제거는 하지 않는다. {local('AGENTS.md','저장소 GUI 실행 지침')}.</p>
'''))

sd=json.loads((HERE/'setdown-measurements.json').read_text())
vs=json.loads((HERE/'vscode-measurements.json').read_text())
metric_rows=[]
for width in (420,560,780):
    for label,values,variant in [('Setdown 현재',sd,'current'),('VS Code 실제',vs,'current'),('Setdown 실험: wrap만 normal',sd,'normal-wrap')]:
        m=next(x for x in values if x.get('width')==width and x['variant']==variant)
        metric_rows.append((str(width),label,f"{m['table']['width']:.1f}",f"{m['table']['height']:.1f}",'<br>'.join(html.escape(s) for s in m['rows'][1]['cells'][0]['lines'])))
sections.append(section('table-study','부록 A. 표 줄바꿈은 전체 문제의 한 사례',f'''
<p><b>원인 확인:</b> Setdown의 <code>.notebook-prose</code>가 <code>overflow-wrap:anywhere</code>를 HTML 표에도 전달하고, 숫자 td는 <code>white-space:nowrap</code>로 보호한다. auto table layout이 좁은 폭에서 숫자 칸을 유지하면서 나머지 행 이름/제목을 글자 중간에서 잘게 분할할 수 있다. <code>overflow-x:auto</code>가 이미 있어도 내용이 더 작게 접힐 수 있으면 가로 스크롤보다 압축이 먼저 일어난다. {typo}, {outputs}.</p>
<p><code>anywhere</code>가 추가하는 줄바꿈 기회는 min-content 크기 계산에도 반영된다. <code>break-word</code>와도 같은 의미가 아니다. 이 차이가 표의 열 너비 분배에 영향을 준다는 설명은 CSS 규격과 실제 문자별 줄 위치 측정에 부합한다. <a href="https://www.w3.org/TR/css-text-3/#overflow-wrap-property">W3C CSS Text: overflow-wrap</a>.</p>
{table(['내용 폭 px','조건','표 너비 px','표 높이 px','첫 행 이름 실제 줄'],metric_rows)}
<p>동일 표 HTML, 내용 폭, 기본 코드 크기로 측정했다. Setdown 현재 HTML 출력은 16px, VS Code는 14px이므로 현재 제품 차이를 포함한 비교다. “wrap만 normal” 실험은 Setdown의 나머지 font/padding을 유지하여 원인 하나의 영향을 분리했다. 표가 내용 폭보다 커진 경우는 출력 영역에서 가로로 이동할 수 있는 상태다.</p>
<div class="figures"><figure><a href="setdown-560.png"><img src="setdown-560.png" alt="폭 560px에서 행 이름이 중간에서 분할되는 Setdown 표" loading="lazy"></a><figcaption>Setdown 현재 · 560px content box</figcaption></figure><figure><a href="vscode-560.png"><img src="vscode-560.png" alt="폭 560px에서 자연스러운 단어 경계로 줄바꿈되는 VS Code 표" loading="lazy"></a><figcaption>VS Code 실제 · 560px content box. 이 부록 캡처는 Dark Modern이며 전체 노트북 비교와 테마가 다르다.</figcaption></figure></div>
<p>VS Code 표 CSS는 border reset, cell padding 4px 8px, right alignment, header/stripe 배경, normal tbody th weight를 제공한다. 저장된 pandas CSS는 단일 행 index th의 vertical alignment 등을 더한다. Setdown은 원본 style을 제거하고 자체 padding .4em .85em, tbody th weight 500, top alignment를 적용한다. <code>border="1"</code>은 남아 현재 table의 외곽 1px 테두리가 실측되었다. {webview}, {content}, {typo}.</p>
<p>실험용 DOM에서 VS Code의 표 기본 규칙과 pandas의 알려진 alignment를 적용하면 420/560/780px의 표 너비·높이가 이번 실제 VS Code 값과 일치했다. 이는 <b>이 fixture의 표 geometry</b>에 대한 결과이며, 임의 HTML/Pandas Styler/전체 노트북의 완전한 호환을 뜻하지 않는다. 앱 파일에는 이 실험 CSS를 적용하지 않았다.</p>
<p><b>권장 결과:</b> 자연스러운 단어 경계 줄바꿈을 허용하고, 필요한 최소 폭을 넘는 표는 출력 안에서 가로 스크롤한다. 모든 셀을 nowrap으로 바꾸거나 열에 무조건 …를 넣으면 VS Code와 다른 데이터 표시가 된다. 코드/표의 값 자체는 잘라서 대체하지 않는다. 긴 경로·명령 라벨의 … 처리와 데이터 표의 표현은 다른 규칙이다.</p>
'''))

sections.append(section('evidence','부록 B. 재현 자료와 소스 안내',f'''
<p>실측 자료: <a href="setdown-measurements.json">Setdown computed styles / geometry / 실제 줄</a>, <a href="vscode-measurements.json">VS Code computed styles / geometry / 실제 줄</a>. 캡처/측정에 사용한 <a href="fixture.ipynb">표 fixture</a>, <a href="overview.ipynb">전체 노트북 fixture</a>, <a href="fixture-output.html">원본 pandas HTML</a>, <a href="fixture-metadata.json">fixture 설명</a>을 함께 보관했다.</p>
<p>재현 스크립트: <a href="probe-setdown.mjs">Setdown probe</a>, <a href="probe-vscode.mjs">VS Code probe</a>, <a href="measure.mjs">측정 함수</a>. 두 probe는 격리 display marker 없이는 실행을 거부한다. VS Code는 임시 프로필과 복사한 fixture만 열고, Setdown은 임시 설정 경로로 실행한다. 커널 실행 버튼은 누르지 않는다.</p>
<pre>bash apps/desktop/scripts/with-isolated-display.sh node reports/notebook-vscode-study-2026-10-30/probe-setdown.mjs
bash apps/desktop/scripts/with-isolated-display.sh node reports/notebook-vscode-study-2026-10-30/probe-vscode.mjs
# 전체 노트북 화면은 각 명령 끝에 --overview 추가</pre>
<p>조사 과정에서 VS Code의 Electron inspector 연결이 완료되지 않았고, 최초 빈 확장 프로필은 ipynb를 JSON으로 열었다. 이후 Chromium CDP와 명시적 notebook editor association으로 전환해 실제 출력 DOM을 확보했다. Electron에서 지원하지 않는 window bounds CDP 명령도 제외했다. 초기 로딩/빈 화면은 비교 결과로 사용하지 않았으며, 성공한 최종 캡처와 측정만 위 분석에 사용했다. 이것은 애플리케이션 회귀 테스트를 retry하여 통과시킨 결과가 아닌, 진단 도구 구성 과정이다.</p>
<p>공식 문서와 소스는 2026-10-30에 확인했다. 소스 링크는 설치 버전 commit에 고정했다. 로컬 vendor checkout은 별도 commit <code>d3d31f62268b169a2dfab62ffb2d7d38158a5b7c</code>이며 탐색 보조로 사용했다. 보고서의 실제 실행 기준 버전과 구분한다.</p>
<p>VS Code HTML renderer와 Markdown renderer, notebook settings/geometry/commands가 각각 다른 모듈에 있다는 점이 핵심 소스 지도다. 출처는 각 분석 문단에 직접 연결했다. Setdown에서 구현 시 중심 파일은 {surface}, {cell}, {outputs}, {content}, {typo}, {local('apps/desktop/src/renderer/notebook/NotebookVariables.svelte','NotebookVariables.svelte')}이다.</p>
'''))

toc=[('decision','권장 방향'),('method','조사 기준'),('overview','실제 화면'),('matrix','영역별 비교'),('anatomy','셀 구조'),('typography','타이포·테마'),('states','셀 상태'),('outputs','출력 전반'),('interaction','조작·탐색'),('profile','기준 설정'),('architecture','구현 경계'),('roadmap','구현 순서'),('acceptance','완료 기준'),('table-study','표 사례'),('evidence','근거 자료')]
css='''
:root{font-family:system-ui,-apple-system,"Noto Sans CJK KR",sans-serif;color:#243043;background:#f5f6f8;line-height:1.8;font-size:15px}*{box-sizing:border-box}body{margin:0}header{background:#16263a;color:#fff;padding:48px max(28px,calc((100vw - 1100px)/2));}header p{color:#c8d6e5;margin:8px 0}h1{font-size:32px;line-height:1.4;margin:10px 0 18px;letter-spacing:-.035em}header .eyebrow{font-size:13px;letter-spacing:.08em}main{max-width:1160px;margin:auto;padding:24px 30px 70px}nav{display:flex;flex-wrap:wrap;gap:6px 18px;padding:20px 0 28px}nav a{font-size:13px}section{background:#fff;border:1px solid #dfe4eb;border-radius:8px;padding:26px 30px;margin:0 0 24px;scroll-margin-top:20px}h2{font-size:23px;line-height:1.5;letter-spacing:-.025em;margin:0 0 18px;color:#122a43}p{margin:13px 0}a{color:#1263a0;text-underline-offset:3px}strong,b{font-weight:680}code{background:#edf1f5;padding:2px 5px;border-radius:3px;font-size:.9em;overflow-wrap:anywhere}pre{background:#edf1f5;border-radius:5px;padding:15px;overflow:auto;font-size:12px;line-height:1.7}.lead{font-size:19px;line-height:1.85}.note{border-left:3px solid #3580b9;background:#f0f6fb;padding:14px 18px;margin:20px 0}.table-scroll{overflow-x:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.75}th,td{padding:11px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e7ed;word-break:normal;overflow-wrap:normal}th{background:#edf2f7;color:#24394e;font-weight:650}tbody tr:nth-child(even){background:#fafbfd}th:first-child,td:first-child{min-width:110px}figure{margin:22px 0}figure img{display:block;max-width:100%;height:auto;border:1px solid #cdd6df;border-radius:5px}figcaption,.caption{font-size:12px;line-height:1.7;color:#65758a;margin:8px 0}.figures{display:grid;grid-template-columns:1fr 1fr;gap:20px}.figures figure{margin:12px 0}.diagram{border:1px solid #b8c7d5;border-radius:6px;overflow:hidden;font-size:13px;background:#fcfdff}.diagram-top{padding:12px;background:#e8eff6}.diagram span{float:right}.insert{text-align:center;color:#6c7f93;border-block:1px dashed #d2dde7;padding:5px}.diagram-cell{display:grid;grid-template-columns:65px 1fr;padding:14px 18px}.diagram-cell aside{border-left:3px solid #3580b9;padding:10px;line-height:2.2;color:#687e92}.diagram-tools{text-align:right;color:#4e6e89;font-size:12px}.diagram-code{padding:20px;background:#f0f2f5;border:1px solid #cad4df;border-radius:4px}.diagram-status{padding:4px 8px;font-size:12px;color:#63788a}.diagram-output{padding:18px 8px}.diagram-md{padding:25px 84px}.architecture{display:grid;grid-template-columns:1fr 1fr;gap:16px}.architecture>div{border:1px solid #d2dce6;padding:18px;background:#f8fafc}.architecture p{font-size:13px}.foot{font-size:12px;color:#66758a;text-align:center} @media(max-width:760px){header{padding:30px 20px}h1{font-size:25px}main{padding:16px 12px}section{padding:20px 16px}h2{font-size:21px}.figures,.architecture{grid-template-columns:1fr}table{min-width:650px}.lead{font-size:17px}}@media print{header{background:white;color:#16263a;padding:0 0 18px}header p{color:#405770}nav{display:none}body{background:white}main{max-width:none;padding:0}section{break-inside:auto;border:0;padding:18px 0;margin:0}h2{break-after:avoid}tr,figure,.note{break-inside:avoid}a{color:inherit}table{font-size:10px}th,td{padding:6px}.table-scroll{overflow:visible}pre{white-space:pre-wrap}.figures{display:block}}
'''
doc='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setdown Jupyter Notebook — VS Code 디자인 정합성 연구</title><style>'+css+'</style></head><body><header><div class="eyebrow">RESEARCH REPORT · 2026-10-30</div><h1>Setdown Jupyter Notebook<br>VS Code 디자인 정합성 연구</h1><p>셀 구조 · 툴바 · 코드와 Markdown · 출력 · 실행 상태 · 포커스와 스크롤</p><p>범위: Jupyter Notebook 전반. 프로그램 전체 UI 개편은 제외.</p></header><main><nav aria-label="보고서 목차">'+''.join(f'<a href="#{id}">{label}</a>' for id,label in toc)+'</nav>'+''.join(sections)+'<p class="foot">연구 및 제안 문서 · production 코드 변경 없음 · 모든 GUI 조사는 격리된 가상 화면에서 수행</p></main></body></html>'
(HERE/'index.html').write_text(doc,encoding='utf-8')
print(f'Wrote {HERE / "index.html"}: {len(doc):,} characters, {len(sections)} sections')
