import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, work } from './paths.mjs';

const execute = promisify(execFile);
const venv = path.join(work, 'venv');
const venvPython = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** The interpreter whose libraries the notebooks are analysed against. */
export function interpreter(explicit) {
  if (explicit) return path.resolve(explicit);
  if (existsSync(venvPython)) return venvPython;
  throw Error('No analysis environment. Run `npm run bench:notebooks -- environment`, or pass --python <interpreter>.');
}

/** The interpreter's version and `sys.path`, as PythonEnvironments.searchPaths reads them. */
export async function searchPaths(python) {
  const script = 'import json, os, sys; print(json.dumps({"version": "%d.%d" % sys.version_info[:2], "paths": [p for p in sys.path if p and os.path.isdir(p)]}))';
  return JSON.parse((await execute(python, ['-c', script], { cwd: os.tmpdir(), timeout: 30_000 })).stdout);
}

/** Which distributions provide the imported modules, and which modules are absent. Results
 * of two runs are comparable only when this record is the same. */
export async function fingerprint(python, modules) {
  const script = `
import importlib.metadata as metadata, importlib.util as util, json, sys
provided = metadata.packages_distributions()
result = {"python": "%d.%d.%d" % sys.version_info[:3], "installed": {}, "missing": []}
for name in json.load(sys.stdin):
    if name in sys.stdlib_module_names: continue
    for distribution in provided.get(name, []): result["installed"][distribution.lower().replace("_", "-")] = metadata.version(distribution)
    if name in provided: continue
    try: found = util.find_spec(name) is not None
    except Exception: found = False
    if not found: result["missing"].append(name)
result["installed"] = dict(sorted(result["installed"].items())); result["missing"].sort()
print(json.dumps(result))`;
  const child = execute(python, ['-I', '-c', script], { cwd: os.tmpdir(), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  child.child.stdin.end(JSON.stringify([...modules].sort()));
  return JSON.parse((await child).stdout);
}

const stream = (command, args, options) => new Promise((resolve, reject) => {
  spawn(command, args, { stdio: 'inherit', ...options }).on('error', reject)
    .on('exit', code => code ? reject(Error(`${command} ${args.join(' ')} exited with ${code}`)) : resolve());
});

/** A virtual environment with the pinned libraries of requirements.txt. */
export async function createEnvironment(base = 'python3') {
  const temporary = path.join(work, 'tmp');
  await mkdir(temporary, { recursive: true });
  if (!existsSync(venvPython)) await stream(base, ['-m', 'venv', venv]);
  // Large wheels are unpacked on disk: the system temporary folder may be memory.
  await stream(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', path.join(app, 'requirements.txt')],
    { env: { ...process.env, TMPDIR: temporary } });
  return venvPython;
}
