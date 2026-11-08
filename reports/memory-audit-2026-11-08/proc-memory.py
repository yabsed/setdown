#!/usr/bin/env python3
"""Read-only Linux PSS snapshot. No URLs, command lines, or document contents saved."""
import json
import os
from pathlib import Path
import re
import sys
import time


def fields(file):
    result = {}
    for line in Path(file).read_text().splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            if value.split() and value.split()[0].isdigit():
                result[key] = int(value.split()[0])
    return result


def snapshot(root_pid=None):
    processes = {}
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            status = fields(directory / 'status')
            comm = (directory / 'comm').read_text().strip()
            command = (directory / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            kind = re.search(r'(?:^|\s)--type=([^\s]+)', command)
            subtype = re.search(r'(?:^|\s)--utility-sub-type=([^\s]+)', command)
            processes[int(directory.name)] = {'pid': int(directory.name), 'ppid': status['PPid'],
                'comm': comm, 'type': kind[1] if kind else 'main-or-child',
                'subtype': subtype[1] if subtype else None}
        except (OSError, KeyError):
            pass
    roots = [root_pid] if root_pid else [pid for pid, p in processes.items()
        if p['comm'] == 'setdown' and processes.get(p['ppid'], {}).get('comm') != 'setdown']
    selected = set(roots)
    while True:
        extra = {pid for pid, p in processes.items() if p['ppid'] in selected}
        if extra <= selected:
            break
        selected |= extra
    rows, unavailable = [], []
    for pid in sorted(selected):
        if pid not in processes:
            continue
        try:
            memory = fields(f'/proc/{pid}/smaps_rollup')
            rows.append({**processes[pid], 'pssKiB': memory.get('Pss', 0), 'rssKiB': memory.get('Rss', 0),
                'privateKiB': memory.get('Private_Clean', 0) + memory.get('Private_Dirty', 0),
                'swapPssKiB': memory.get('SwapPss', 0)})
        except OSError:
            unavailable.append(pid)
    memory = fields('/proc/meminfo')
    return {'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'rootPids': roots,
        'hostKiB': {key: memory[key] for key in ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']},
        'pressure': Path('/proc/pressure/memory').read_text().strip(),
        'totalPssKiB': sum(p['pssKiB'] for p in rows), 'totalSwapPssKiB': sum(p['swapPssKiB'] for p in rows),
        'processes': rows, 'unavailablePids': unavailable}


if __name__ == '__main__':
    print(json.dumps(snapshot(int(sys.argv[1]) if len(sys.argv) > 1 else None), indent=2))
