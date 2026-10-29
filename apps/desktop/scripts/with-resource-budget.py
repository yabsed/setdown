"""Linux validation runner: isolate one job and preserve a 2 GiB host reserve.

Usage: python3 with-resource-budget.py setdown-JOB CWD MEMORY_MIB TIMEOUT_SECONDS COMMAND [ARG ...]
GUI commands must additionally use with-isolated-display.sh.
"""
import os, signal, subprocess, sys, time

if len(sys.argv) < 6:
    sys.exit(__doc__)
unit, directory, memory, timeout, *command = sys.argv[1:]
if not unit.startswith('setdown-') or not command:
    sys.exit('Use a setdown- prefixed job name and provide a command.')
unit = f'{unit}-{os.getpid()}'
memory = int(memory)
if memory <= 0 or int(timeout) <= 0:
    sys.exit('Memory and timeout must be positive.')
reserve = 2048
def available():
    with open('/proc/meminfo') as info:
        return next(int(line.split()[1]) // 1024 for line in info if line.startswith('MemAvailable:'))
if available() < memory + reserve:
    sys.exit(f'Not starting: need {memory + reserve} MiB available including the {reserve} MiB host reserve; have {available()} MiB.')
args = ['systemd-run', '--user', f'--unit={unit}', '--wait', '--pipe', '--collect',
        f'--working-directory={directory}', f'--setenv=PATH={os.environ["PATH"]}',
        f'--property=MemoryMax={memory}M', '--property=MemorySwapMax=0', '--property=LimitCORE=0',
        '--property=OOMPolicy=stop', '--property=KillMode=control-group', '--property=TimeoutStopSec=5s',
        f'--property=RuntimeMaxSec={timeout}', '--property=CPUQuota=150%', *command]
child = subprocess.Popen(args)
def interrupted(signum, _frame):
    raise SystemExit(128 + signum)
for signum in (signal.SIGTERM, signal.SIGHUP):
    signal.signal(signum, interrupted)
try:
    while child.poll() is None:
        if available() < reserve:
            print(f'Host reserve reached ({available()} MiB). Stopping only {unit}.', flush=True)
            subprocess.run(['systemctl', '--user', 'stop', unit], check=False)
            child.wait()
            sys.exit(75)
        time.sleep(1)
    sys.exit(child.returncode)
except BaseException:
    if child.poll() is None:
        subprocess.run(['systemctl', '--user', 'stop', unit], check=False)
        child.wait()
    raise
