"""Install the already-tested package without opening or closing desktop windows."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

report = Path(__file__).resolve().parent
root = report.parents[1]
source = root / 'apps/desktop/release/linux-unpacked'
destination = Path.home() / '.local/share/setdown'
assert json.loads((report / 'preview-benchmark/comparison.json').read_text())['passed']
assert json.loads((report / 'packaged-input-result.json').read_text())['passed']
assert '305 passed' in (report / 'contract.log').read_text()
assert '10 passed' in (report / 'xwayland.log').read_text()
assert 'received Python diagnostics.' in (report / 'package-smoke.log').read_text()
assert destination.is_dir() and (source / 'setdown').is_file()


def idle():
    active = []
    for process in Path('/proc').glob('[0-9]*'):
        try:
            executable = os.readlink(process / 'exe')
            if executable.startswith(str(destination) + '/'):
                active.append(process.name)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    if active:
        raise RuntimeError(f'Installed app is running (PIDs {active}); no windows were closed or installation replaced.')


def manifest(directory):
    result = {}
    for file in sorted(directory.rglob('*')):
        relative = file.relative_to(directory).as_posix()
        if file.is_symlink():
            result[relative] = {'link': os.readlink(file)}
        elif file.is_file():
            with file.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            result[relative] = {'sha256': digest, 'mode': file.stat().st_mode & 0o777}
    return result


idle()
expected = manifest(source)
staging = Path(tempfile.mkdtemp(prefix='.setdown-verified-', dir=destination.parent))
backup = destination.with_name('setdown-backup-' + datetime.now().strftime('%Y%m%dT%H%M%S'))
assert not backup.exists()
try:
    subprocess.run(['cp', '-a', '--reflink=auto', str(source) + '/.', str(staging)], check=True)
    if manifest(staging) != expected:
        raise RuntimeError('Staged package differs from the verified package.')
    idle()
    destination.rename(backup)
    try:
        staging.rename(destination)
    except BaseException:
        backup.rename(destination)
        raise
finally:
    if staging.exists():
        shutil.rmtree(staging)

installed = manifest(destination)
if installed != expected:
    raise RuntimeError('Installed package differs from the verified package; backup is retained.')
receipt = {
    'verified': True,
    'installedAt': datetime.now(timezone.utc).isoformat(),
    'source': str(source), 'destination': str(destination), 'backup': str(backup),
    'filesVerified': len(expected),
    'treeSha256': hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest(),
    'appAsarSha256': expected['resources/app.asar']['sha256'],
    'executableSha256': expected['setdown']['sha256'],
    'existingApplicationWasRunning': False, 'desktopWindowsOpened': False,
    'userProfileAndFileAssociationsChanged': False,
}
(report / 'installation.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
