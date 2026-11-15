import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launcherArchives } from './policy.mjs';
import { launcherRelease, stageLauncher } from './stage-npm-launcher.mjs';

const version = '1.2.3';
const archives = launcherArchives(version);
const sumsFor = hashes => Object.entries(hashes).map(([file, hash]) => `${hash}  ${file}\n`).join('');

test('release information pins every launcher archive to the checksum the release published', () => {
  const sums = sumsFor({ [archives['linux-x64']]: 'a'.repeat(64), [archives['win32-x64']]: 'b'.repeat(64), 'build-info.json': 'c'.repeat(64) });
  assert.deepEqual(launcherRelease({ version, repository: 'example/setdown', sums }), {
    version, baseUrl: 'https://github.com/example/setdown/releases/download/v1.2.3/',
    assets: {
      'linux-x64': { file: 'Setdown-1.2.3-linux-x64.tar.gz', sha256: 'a'.repeat(64) },
      'win32-x64': { file: 'Setdown-1.2.3-win-x64.zip', sha256: 'b'.repeat(64) },
    },
  });
  // A release made before the archives existed must not produce a launcher.
  assert.throws(() => launcherRelease({ version, repository: 'example/setdown', sums: sumsFor({ [archives['linux-x64']]: 'a'.repeat(64) }) }), /no checksum/);
  assert.throws(() => launcherRelease({ version, repository: 'example/setdown', sums: 'not a checksum line\n' }), /Invalid SHA256SUMS/);
  assert.throws(() => launcherRelease({ version: undefined, repository: 'example/setdown', sums }), /version/);
  assert.throws(() => launcherRelease({ version, repository: 'https://example.invalid/x', sums }), /owner\/repository/);
});

// Run the staged package as npm would install it, against a local server and
// a stand-in app. Only the download location is replaced; the checksum is real.
function fixture(t, { corrupt = false, megabytes = 0, http10 = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-npm-launcher-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = `Setdown-${version}-linux-x64`;
  mkdirSync(path.join(root, 'build', folder), { recursive: true });
  writeFileSync(path.join(root, 'build', folder, 'setdown'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$SETDOWN_TEST_ARGS"\nexit 7\n');
  chmodSync(path.join(root, 'build', folder, 'setdown'), 0o755);
  if (megabytes) writeFileSync(path.join(root, 'build', folder, 'resources.bin'), randomBytes(megabytes * 1048576));
  const archive = path.join(root, archives['linux-x64']);
  execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'build'), folder]);
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const output = path.join(root, 'package');
  stageLauncher({ output, version, repository: 'example/setdown',
    sums: sumsFor({ [archives['linux-x64']]: corrupt ? 'd'.repeat(64) : hash, [archives['win32-x64']]: 'b'.repeat(64) }) });
  let requests = 0;
  // The HTTP/1.0 variant answers like `python -m http.server`: one response,
  // then the connection closes while the client may still be writing to disk.
  const server = http10 ? net.createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', () => {
      requests += 1;
      const body = readFileSync(archive);
      socket.write(`HTTP/1.0 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`);
      socket.end(body);
    });
  }) : http.createServer((request, response) => {
    requests += 1;
    if (request.url !== `/${archives['linux-x64']}`) { response.writeHead(404).end(); return; }
    response.writeHead(200).end(readFileSync(archive));
  });
  t.after(() => server.close());
  const cache = path.join(root, 'cache');
  const run = async (...args) => {
    if (!server.listening) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const child = spawn(process.execPath, [path.join(output, 'bin/setdown.mjs'), ...args], { stdio: ['ignore', 'ignore', 'pipe'], env: {
      ...process.env, XDG_CACHE_HOME: cache, SETDOWN_TEST_ARGS: path.join(root, 'args'),
      SETDOWN_DOWNLOAD_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const status = await new Promise(resolve => child.once('close', resolve));
    return { status, stderr };
  };
  return { root, output, run, versions: path.join(cache, 'setdown-npm'), requests: () => requests };
}

test('the staged package downloads once, starts the app with its arguments, and replaces older versions', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  const manifest = JSON.parse(readFileSync(path.join(f.output, 'package.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal('private' in manifest, false);
  for (const file of ['bin/setdown.mjs', 'lib/launcher.mjs', 'release.json', 'README.md', 'LICENSE']) assert.equal(existsSync(path.join(f.output, file)), true, file);
  // An earlier version is removed; anything else in the directory is not ours.
  for (const directory of ['1.0.0', '0.9.0', 'notes']) mkdirSync(path.join(f.versions, directory), { recursive: true });
  writeFileSync(path.join(f.versions, '1.0.0/setdown'), 'earlier version');
  writeFileSync(path.join(f.versions, 'notes/setdown'), 'unrelated');

  const first = await f.run('one', 'two words');
  assert.equal(first.status, 7, first.stderr);
  assert.equal(readFileSync(path.join(f.root, 'args'), 'utf8'), 'one\ntwo words\n');
  assert.deepEqual(readdirSync(f.versions).sort(), ['0.9.0', version, 'notes']);
  assert.equal(f.requests(), 1);

  const second = await f.run('again');
  assert.equal(second.status, 7, second.stderr);
  assert.equal(readFileSync(path.join(f.root, 'args'), 'utf8'), 'again\n');
  assert.equal(f.requests(), 1, 'an installed version is not downloaded again');
});

test('a download that does not match the recorded checksum is never installed or started', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t, { corrupt: true });
  const result = await f.run('one');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Checksum mismatch/);
  assert.equal(existsSync(path.join(f.root, 'args')), false);
  assert.deepEqual(readdirSync(f.versions), []);
});

test('a large archive from an HTTP/1.0 mirror is installed instead of crashing the download', { skip: process.platform !== 'linux' }, async t => {
  // 64 MB outruns the disk on loopback, which is what made fetch() abort.
  const f = fixture(t, { megabytes: 64, http10: true });
  const result = await f.run('one');
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(readdirSync(f.versions), [version]);
});
