const fs = require('node:fs');
const path = require('node:path');
const here = __dirname;
const read = name => fs.readFileSync(path.join(here, name), 'utf8');
const json = name => JSON.parse(read(name));
const benchmark = json('preview-benchmark/comparison.json');
const notebook = json('../input-notebook-diagnosis-2026-11-06/notebook-comparison.json');
const packaged = json('packaged-input-result.json');
const installation = json('installation.json');
const checks = [
  { name: '전체 단위 검사', file: 'unit.log', pattern: /Tests\s+1239 passed/, count: 1239 },
  { name: 'Preview 계약 단위 검사', file: 'contract.log', pattern: /Tests\s+857 passed/, count: 857, subsetOfUnit: true },
  { name: '실제 Electron 계약 검사', file: 'contract.log', pattern: /305 passed/, count: 305 },
  { name: '도구·CI 검사', file: 'tooling.log', pattern: /# pass 65[\s\S]*# pass 14/, count: 79 },
  { name: '격리된 XWayland 검사', file: 'xwayland.log', pattern: /\d+ passed/ },
  { name: '패키지 기본 검사', file: 'package-smoke.log', pattern: /Packaged linux 2\.5\.2: launched, rendered Markdown, opened editor, received Python diagnostics\./ },
];
for (const check of checks) {
  const log = read(check.file);
  if (!check.pattern.test(log)) throw Error(`Missing passing result: ${check.file} / ${check.name}`);
  if (!check.count) check.count = Number(log.match(/(\d+) passed/)?.[1]) || undefined;
}
if (!benchmark.passed || benchmark.comparisons.length !== 48 || benchmark.runs !== 5 || benchmark.regressions.length)
  throw Error('The complete unchanged preview benchmark must pass.');
if (!packaged.passed || !installation.verified) throw Error('Packaged fixes and installation must be verified.');
const comparisons = benchmark.comparisons.map(row => {
  const [surface, idle, edits, cycle, metric] = row.key.split('/');
  const configuredPreparationMs = cycle === 'first' ? Number(idle.split('=')[1]) : 0;
  return { ...row, surface, idleBeforeFirstMs: Number(idle.split('=')[1]), edits: edits === 'edits=true', cycle, metric,
    ...(metric === 'captureMs' ? { configuredPreparationMs,
      baselineIncludingConfiguredPreparationMs: row.baselineMs + configuredPreparationMs,
      candidateIncludingConfiguredPreparationMs: row.candidateMs + configuredPreparationMs } : {}) };
});
const report = {
  completedAt: new Date().toISOString(), baseline: benchmark.baseline.commit,
  checks: checks.map(({ pattern, ...check }) => ({ ...check, passed: true })),
  build: { sourceMaps: false, baselineAndCandidateIdenticalSetting: true },
  benchmark: { passed: true, launches: 80, repetitions: 5, comparisons: 48, thresholds: benchmark.thresholds,
    measurement: benchmark.measurement, rows: comparisons },
  notebooks: notebook, packaged, installation,
  originalDocumentsModified: false, notebookCellsExecuted: false,
  limitations: [
    'Physical touchpad gestures were not generated. A real XI2 helper connected on the isolated X server; decoded gesture messages exercised shell/native Chromium routing and zoom reversal.',
    'Notebook measurements use temporary copies outside the original project and one observation per file/state. They are layout correctness observations, not a project/LSP or image-decoding latency benchmark.',
    'The configured 3000ms idle occurs only before the first Escape cycle. Adding it to captureMs is not an application-startup/end-to-end measurement.',
    'The installed application was updated without opening windows on the user desktop.',
  ],
};
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pair = (before, after) => `${before} → <b>${after}</b>`;
const table = comparisons.filter(row => row.metric === 'captureMs').map(row => {
  const reverse = comparisons.find(other => other.key === row.key.replace('captureMs', 'doubleClickToEditorMs'));
  return `<tr><td>${row.surface === 'document' ? '일반 Markdown' : 'Git 검토'}</td><td>${row.edits ? '편집 있음' : '편집 없음'}</td><td>${row.idleBeforeFirstMs}</td><td>${({first:'첫 번째',second:'두 번째',warm:'3–5회 중앙값'})[row.cycle]}</td><td>${pair(row.baselineMs,row.candidateMs)}</td><td>${pair(row.baselineIncludingConfiguredPreparationMs,row.candidateIncludingConfiguredPreparationMs)}</td><td>${pair(reverse.baselineMs,reverse.candidateMs)}</td></tr>`;
}).join('');
const notebookRows = notebook.results.map(row => `<tr><td>${escape(row.file)}</td><td>${row.warmMonaco ? '기존 앱에서 열기' : '앱 시작 포함'}</td><td>${pair(row.baselineReadyMs,row.candidateReadyMs)}</td><td>${row.images.map(image => `${escape(image.cell)}: ${image.baselineExtraScrollSteps} → ${image.candidateExtraScrollSteps}회`).join('<br>') || '이미지 없음'}</td></tr>`).join('');
fs.writeFileSync(path.join(here, 'report.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Setdown 입력·렌더링 수정 검증</title>
<style>body{font:15px/1.65 system-ui,sans-serif;max-width:1180px;margin:36px auto;padding:0 24px;color:#24292f;background:#fff}h1{font-size:27px}h2{margin-top:36px;font-size:21px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}th,td{padding:8px 10px;border:1px solid #d0d7de;text-align:left}th{background:#f6f8fa}a{color:#0969da}code{background:#f6f8fa;padding:2px 5px}img{max-width:46%;border:1px solid #d0d7de}li{margin:6px 0}.scroll{overflow:auto}.pass{color:#116329;font-weight:700}</style>
<h1>Setdown 입력·렌더링 수정 검증</h1><p class="pass">검증 완료 · ${escape(report.completedAt)}</p>
<p>기준 커밋 <code>${escape(benchmark.baseline.commit)}</code>의 독립 설치와 수정 빌드를 같은 가상 화면에서 비교했습니다. 사용자 문서 원본과 앱 프로필은 수정하지 않았고, 노트북 셀을 실행하지 않았습니다.</p>
<h2>수정한 동작</h2><ul>
<li>핀치 확대: X11/XWayland의 XI2 두 손가락 제스처를 해당 창·탭의 확대 입력으로 연결했습니다. 앱 전체 확대는 유지되며 확대 후 축소가 원래 배율로 돌아옵니다.</li>
<li>스크롤·탭 클릭: Explorer 드래그 취소·거절 후 남던 입력 차단 상태를 해제합니다. 노트북의 세로 스크롤은 작은 가로 흔들림에 차단되지 않습니다.</li>
<li>노트북: 코드 줄 수와 저장된 출력 크기를 먼저 반영하고, 앞 셀의 측정이 끝날 때 보던 셀의 위치를 유지합니다.</li>
<li>한국어 강조: <code>**'정책'**이</code>, <code>**(정책)**은</code>, <code>**90%**가</code>를 렌더러에서 처리합니다. 코드·이스케이프·중첩 구문과 원문 위치는 보존합니다.</li>
<li>우클릭 메뉴: 웹·읽기·PDF 메뉴를 13px 글자와 26px 행의 테마 메뉴로 통일했습니다. 중첩·체크 메뉴, 키보드 이동, 이미지 복사, Escape 직후 입력과 포커스 복귀를 검사했습니다.</li>
<li>추가로 발견한 Git 편집 문제: 늦은 검토 갱신이 입력 중인 커서를 줄 맨 앞으로 이동시키던 초기 배치 중복 실행을 막았습니다.</li></ul>
<p><a href="context-github-dark.png"><img src="context-github-dark.png" alt="어두운 테마 우클릭 메뉴"></a> <a href="context-github-light.png"><img src="context-github-light.png" alt="밝은 테마 우클릭 메뉴"></a></p>
<h2>검사 결과</h2><ul>${checks.map(check => `<li><a href="${check.file}">${escape(check.name)}</a>: 통과${check.count ? ` ${check.count}개` : ''}${check.subsetOfUnit ? ' (전체 단위 검사에 포함)' : ''}</li>`).join('')}<li><a href="packaged-input-result.json">패키지의 핀치 도우미·강조·우클릭 메뉴·종료 후 도우미 정리</a>: 통과</li><li><a href="installation.json">기존 설치 갱신 및 파일 해시 확인</a>: 완료</li></ul>
<p>실제 Electron/Chromium을 Xvfb 또는 격리된 headless Mutter/XWayland에서 실행했습니다. 사용자 데스크톱 창을 띄우지 않았습니다. 빌드·타입 검사를 포함하며, GUI 재시도나 허용치 완화를 사용하지 않았습니다.</p>
<h2>전체 검사에서 발견한 추가 문제</h2><p>이전 실행의 실패도 보존했습니다. <a href="contract-before-caret-fix.log">커서 재배치 실패</a>는 실제 위치 변경 추적으로 확인해 수정했습니다. 다음 실행은 <a href="contract-before-teardown-fix.log">305개 중 304개 통과, 테스트 정리 종료에서 1개 시간 초과</a>였습니다. 마지막 창 파괴와 Playwright 종료가 충돌하지 않도록 테스트 정리 순서를 보완한 뒤 전체 검사를 다시 실행했습니다. 사용자 닫기·종료 동작에 대한 검사는 유지했습니다.</p>
<h2>노트북 복사본 관찰</h2><p>이미지로 한 번 이동한 뒤 500ms 시점에 코드·이미지가 화면에 남는지 확인했습니다. 이전에는 추가 스크롤이 필요했던 이미지들이 수정 후 추가 입력 없이 디코딩되어 표시됐습니다. 아래 시간은 파일·상태별 1회 관찰이며 성능 합격 기준이 아닙니다. 원래 프로젝트의 언어 서버 작업은 측정하지 않았습니다.</p>
<div class="scroll"><table><thead><tr><th>파일</th><th>조건</th><th>준비 시간 ms (이전 → 수정)</th><th>이미지까지 추가 스크롤</th></tr></thead><tbody>${notebookRows}</tbody></table></div>
<p><a href="../input-notebook-diagnosis-2026-11-06/notebook-comparison.json">노트북 원시 비교 결과</a></p>
<h2>Preview 성능 비교</h2><p>5회씩 교대 비교, 총 80회 앱 실행, 48개 비교 항목 통과. 기준은 증가가 <b>25%와 50ms를 모두 초과</b>하면 실패이며 변경하지 않았습니다. 각 앱에서 5사이클을 실행하고 첫 번째·두 번째·3–5회 중앙값을 각각 비교했습니다. 양쪽 모두 소스맵을 생략한 같은 빌드 설정을 사용했습니다.</p>
<p>모든 값은 ms, <b>이전 → 수정</b>입니다. Esc 시간은 최신 내용의 비어 있지 않은 캡처까지의 시간이며 polling·IPC·readback을 포함합니다. 실제 모니터 표시 시각은 아닙니다. 3000ms 준비 대기는 <b>첫 사이클 직전에 한 번</b>만 주어집니다. ‘준비 대기 포함’ 열도 첫 사이클에만 이를 더하며, 앱 시작부터의 총 시간은 아닙니다.</p>
<div class="scroll"><table><thead><tr><th>화면</th><th>편집</th><th>첫 회 전 준비 대기</th><th>사이클</th><th>Esc 캡처</th><th>Esc + 설정된 준비 대기</th><th>더블클릭 → 편집</th></tr></thead><tbody>${table}</tbody></table></div>
<p><a href="preview-benchmark/comparison.json">48개 비교와 실행별 원시 값</a> · <a href="results.json">전체 결과 JSON</a></p>
<h2>검증 범위</h2><p>가상 화면에서 물리 터치패드 자체의 제스처는 생성하지 못합니다. 실제 XI2 연결·구독과 디코딩된 메시지 이후의 Chromium 입력·배율 경로를 검사했습니다. 실제 손가락 동작의 최종 체감은 이 자동 검사에 포함되지 않습니다.</p></html>\n`);
console.log('Wrote verified results.json and report.html.');
