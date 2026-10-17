"""Index the authoritative observations without hiding earlier failed probes."""
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
sources = {
    'evidence.json': None,
    'evidence-ts-gitgraph-configured.json': None,
    'evidence-python-standalone-rename-ui_python-project-rename-ui_python-superproject-rename-ui_css-min_rust-brave_notebook-nbformat.json': {'css-min', 'rust-brave', 'notebook-nbformat'},
    'evidence-python-standalone-rename-ui_python-project-rename-ui_python-superproject-rename-ui.json': None,
    'evidence-python-completion-ui_ts-gitgraph-completion-ui_css-min-configured.json': {'ts-gitgraph-completion-ui', 'css-min-configured'},
    'evidence-python-completion-ui_css-min-invalid_css-min-configured-invalid.json': {'python-completion-ui'},
    'evidence-css-min-invalid_css-min-configured-invalid.json': None,
}
cases = []
for source, selected in sources.items():
    for case in json.loads((directory / source).read_text())['cases']:
        if selected is not None and case['name'] not in selected:
            continue
        requests = case['requests']
        rename = requests.get('rename', {}).get('response') or {}
        cases.append({
            'name': case['name'], 'source': source, 'file': case['file'],
            'sourceSha256': case['sourceSha256'], 'sourceUnchanged': case['sourceUnchanged'],
            'connectionError': case.get('connection', {}).get('error'),
            'unavailable': case.get('connection', {}).get('response', {}).get('unavailable'),
            'scenarioError': case.get('error'),
            'sessions': [
                {'server': server['id'], 'root': session['root'], 'state': session['state']}
                for server in case.get('sessions', []) for session in server['sessions']
            ],
            'requests': {
                label: {'method': value['method'], 'ms': value['ms'], 'error': value.get('error')}
                for label, value in requests.items()
            },
            'completionCount': case.get('completionCount'),
            'inlayCount': len(requests['inlayHints'].get('response') or []) if 'inlayHints' in requests else None,
            'renameFiles': list((rename.get('changes') or {}).keys()) + [
                edit.get('textDocument', {}).get('uri') for edit in rename.get('documentChanges', [])
            ],
            'renameTabs': case.get('renameTabs'), 'uiCompletion': case.get('uiCompletion'),
            'pullDiagnostics': requests.get('pullDiagnostics', {}).get('response'),
        })
corpus = json.loads((directory / 'corpus.json').read_text())
summary = {
    'revision': 'a00d7aef1c6c5868777fc5b04fb97ef225ce69a4',
    'note': 'Observation inventory, not a pass-rate or benchmark. Earlier harness failures remain in original logs.',
    'submodulesInventoried': len(corpus),
    'trackedFilesInventoried': sum(item['trackedFiles'] for item in corpus),
    'scenarios': len(cases), 'uniqueFiles': len({case['file'] for case in cases}),
    'submodulesAttempted': sorted({case['file'].split('/')[1] for case in cases}),
    'allSampleFilesUnchanged': all(case['sourceUnchanged'] for case in cases),
    'cases': cases,
}
(directory / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key != 'cases'}, ensure_ascii=False, indent=2))
