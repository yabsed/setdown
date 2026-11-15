import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findExecutable, installRoot, selectAsset } from '../lib/launcher.mjs';

test('downloaded versions live in the per-user cache, apart from a system installation', () => {
  assert.equal(installRoot('linux', {}, '/home/user'), '/home/user/.cache/setdown-npm');
  assert.equal(installRoot('linux', { XDG_CACHE_HOME: '/var/cache/user' }, '/home/user'), '/var/cache/user/setdown-npm');
  assert.equal(installRoot('linux', { XDG_CACHE_HOME: 'relative' }, '/home/user'), '/home/user/.cache/setdown-npm');
  assert.equal(installRoot('win32', { LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local' }, 'C:\\Users\\user'), 'C:\\Users\\user\\AppData\\Local\\setdown-npm');
  assert.equal(installRoot('win32', {}, 'C:\\Users\\user'), 'C:\\Users\\user\\AppData\\Local\\setdown-npm');
});

const release = { version: '1.2.3', baseUrl: 'https://github.com/example/setdown/releases/download/v1.2.3/',
  assets: { 'linux-x64': { file: 'Setdown-1.2.3-linux-x64.tar.gz', sha256: 'a'.repeat(64) } } };

test('a mirror changes where the archive comes from, never which checksum it must match', () => {
  assert.deepEqual(selectAsset(release, 'linux', 'x64'), { file: 'Setdown-1.2.3-linux-x64.tar.gz', sha256: 'a'.repeat(64),
    url: 'https://github.com/example/setdown/releases/download/v1.2.3/Setdown-1.2.3-linux-x64.tar.gz' });
  const mirrored = selectAsset(release, 'linux', 'x64', { SETDOWN_DOWNLOAD_BASE_URL: 'https://mirror.example/setdown' });
  assert.equal(mirrored.url, 'https://mirror.example/setdown/Setdown-1.2.3-linux-x64.tar.gz');
  assert.equal(mirrored.sha256, 'a'.repeat(64));
  assert.throws(() => selectAsset(release, 'darwin', 'arm64'), /no build for darwin-arm64 \(available: linux-x64\)/);
});

test('the app is found at an archive root or inside its single folder, and nowhere else', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-launcher-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const make = (...parts) => { const file = path.join(root, ...parts); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, ''); return file; };
  assert.equal(findExecutable(path.join(root, 'flat'), 'Setdown.exe'), null, 'missing directory');
  const flat = make('flat', 'Setdown.exe');
  assert.equal(findExecutable(path.join(root, 'flat'), 'Setdown.exe'), flat);
  const nested = make('nested', 'Setdown-1.2.3-linux-x64', 'setdown');
  assert.equal(findExecutable(path.join(root, 'nested'), 'setdown'), nested);
  make('ambiguous', 'one', 'setdown'); make('ambiguous', 'two', 'setdown');
  assert.equal(findExecutable(path.join(root, 'ambiguous'), 'setdown'), null);
  mkdirSync(path.join(root, 'folder', 'setdown'), { recursive: true });
  assert.equal(findExecutable(path.join(root, 'folder'), 'setdown'), null, 'a directory is not the executable');
});
