import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Linux integration gate: real pinned Zed adapters, no downloads or Electron.
assert.equal(process.platform, 'linux');
const binary = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../../../apps/desktop/dist-electron/language-host/setdown-language-host', import.meta.url)));
const root = await mkdtemp(path.join(os.tmpdir(), 'setdown zed resolution '));
const tools = path.join(root, 'tools'), first = path.join(root, 'first'), second = path.join(root, 'second');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function executable(file, script) { await writeFile(file, '#!/bin/sh\n' + script, { mode: 0o755 }); }
function request(values, extraEnv = {}) {
  const run = spawnSync(binary, [path.join(root, 'data')], {
    input: values.map((value, index) => JSON.stringify({ id: index + 1, ...value })).join('\n') + '\n',
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, HOME: root, SHELL: '/bin/bash', PATH: tools,
      SETDOWN_LANGUAGE_HOST_OFFLINE: '1', ...extraEnv },
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  return run.stdout.split('\n').filter(line => line.startsWith('SETDOWN-LANGUAGE/1 '))
    .map(line => JSON.parse(line.slice(19))).filter(value => !value.event);
}
try {
  for (const folder of [tools, first, second, path.join(second, 'tools')]) await mkdir(folder);
  const attempts = path.join(root, 'attempts');
  await executable(path.join(tools, 'rustup'), 'printf "%s/tools/rust-analyzer\\n" "$PWD"\n');
  await executable(path.join(tools, 'rust-analyzer'), `printf 'broken:%s\\n' "$1" >> ${quote(attempts)}\nexit 1\n`);
  const working = path.join(second, 'tools/rust-analyzer');
  await writeFile(path.join(second, 'rust-toolchain.toml'), '[toolchain]\nchannel = "stable"\n');
  await executable(working, `printf 'working:%s\\n' "$1" >> ${quote(attempts)}\nexit 0\n`);
  const prepare = project => ({ op: 'prepare', server: 'rust-analyzer', language: 'Rust', root: project,
    env: { PATH: tools, HOME: root }, settings: {}, allowBinaryDownload: false });
  const replies = request([prepare(first), prepare(second), prepare(first)]);
  assert.equal(replies.length, 3);
  assert.match(replies[0].error, /downloading language servers disabled/);
  assert.equal(replies[1].error, undefined, replies[1].error);
  assert.equal(replies[1].result.executable, working);
  assert.match(replies[2].error, /downloading language servers disabled/);
  const probes = await readFile(attempts, 'utf8');
  assert.match(probes, /broken:--help/); assert.match(probes, /working:--help/);
  // Exercise upstream shell capture and its --printenv callback, including spaces.
  const environments = request([first, second].map(project => ({ op: 'environment', root: project,
    env: { SHELL: '/bin/bash' }, inheritEnvironment: false })), { PATH: '/usr/bin:/bin' });
  assert.equal(environments[0].result.PWD, first); assert.equal(environments[1].result.PWD, second);
  assert.equal(environments[0].result.SETDOWN_LANGUAGE_HOST_OFFLINE, undefined);
  console.log('PASS: real Zed rejects broken shims, probes toolchain executables, isolates projects, honors disabled downloads, and captures project shells.');
} finally { await rm(root, { recursive: true, force: true }); }
