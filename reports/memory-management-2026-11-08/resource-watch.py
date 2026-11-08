"""Stop only this validation scope if host headroom becomes unsafe."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

parent = int(sys.argv[1])
output = Path(sys.argv[2])
scope = os.environ.get('SETDOWN_VALIDATION_SCOPE', 'setdown-memory-validation.scope')
assert scope.startswith('setdown-memory-') and scope.endswith('.scope') and '/' not in scope
record = {'minimumAvailableMiB': None, 'thresholdMiB': 2048, 'stopped': False}
while True:
    try:
        os.kill(parent, 0)
    except ProcessLookupError:
        break
    values = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines() if ':' in line)
    available = int(values['MemAvailable'].split()[0]) / 1024
    record['minimumAvailableMiB'] = min(record['minimumAvailableMiB'] or available, available)
    record['lastSample'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    record['stopped'] = available < record['thresholdMiB']
    output.write_text(json.dumps(record, indent=2) + '\n')
    if record['stopped']:
        subprocess.run(['systemctl', '--user', 'kill', '--signal=SIGTERM', scope], check=False)
        break
    time.sleep(2)
