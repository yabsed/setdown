#!/usr/bin/env python3
"""Run isolated, headless Vim probes; no desktop, user vimrc, or project edits."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
binary = shutil.which('vim')
if not binary:
    raise SystemExit('A Vim executable is required; this does not build vendor/vim.')
with tempfile.TemporaryDirectory(prefix='setdown-vim-audit-') as temporary:
    output = Path(temporary) / 'raw.json'
    env = dict(os.environ, VIM_AUDIT_ROOT=str(ROOT), VIM_AUDIT_TMP=temporary,
               VIM_AUDIT_OUT=str(output))
    result = subprocess.run(
        [binary, '-Nu', 'NONE', '-U', 'NONE', '-i', 'NONE', '--noplugin',
         '-n', '-es', '-S', str(HERE / 'probe.vim')],
        cwd=temporary, env=env, capture_output=True, text=True, timeout=30)
    if not output.exists():
        raise SystemExit(f'No probe output (exit {result.returncode}): {result.stderr}')
    evidence = json.loads(output.read_text())
    evidence.update({
        'binary': binary,
        'audited_vim_commit': subprocess.check_output(
            ['git', '-C', str(ROOT / 'vendor/vim'), 'rev-parse', 'HEAD'], text=True).strip(),
        'setdown_head': subprocess.check_output(
            ['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'scope': 'Installed Vim behavior probes plus pinned Python ftplugin; not a build of the audited Vim commit or a Setdown GUI test.',
        'process_exit_code': result.returncode,
        'stderr': result.stderr,
    })
    (HERE / 'results.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({key: evidence[key] for key in
          ['case_count', 'assertion_count', 'failed_cases', 'process_exit_code']}, indent=2))
    for case in evidence['cases']:
        if not case['passed']:
            print(json.dumps(case, indent=2, ensure_ascii=False))
    raise SystemExit(result.returncode or bool(evidence['failed_cases']))
