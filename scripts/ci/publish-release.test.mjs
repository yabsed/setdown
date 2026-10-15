import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installerNames } from './policy.mjs';

const publisher = fileURLToPath(new URL('./publish-release.mjs', import.meta.url));
const commit = 'a'.repeat(40);
const version = '1.0.1-dev.1234';
// Exercise the real publishing program against a local CLI double. No token or
// network is available to these tests; all "releases" live in a temporary file.
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync('github.json', 'utf8'));
state.calls.push(args);
const save = () => fs.writeFileSync('github.json', JSON.stringify(state));
const value = flag => args[args.indexOf(flag) + 1];
const response = body => { save(); console.log(JSON.stringify(body)); };
const missing = () => { save(); console.error('gh: Not Found (HTTP 404)'); process.exit(1); };
if (args[0] === 'api') {
  const endpoint = args.find(arg => arg.startsWith('repos/'));
  if (endpoint.includes('/compare/')) response(state.comparison);
  else if (endpoint.includes('/commits/')) state.tagCommit ? response({sha: state.tagCommit}) : missing();
  else if (args.includes('PATCH')) {
    state.release.draft = false;
    state.published = true;
    response(state.release);
  } else if (endpoint.includes('/releases/tags/')) state.release ? response(state.release) : missing();
  else throw Error('Unexpected API call: ' + args.join(' '));
} else if (args[0] === 'release' && args[1] === 'create') {
  if (!args.includes('--draft')) throw Error('Must create a draft');
  state.release = {id: 1, draft: true, target_commitish: value('--target'), assets: [], html_url: 'https://example.invalid/release'};
  response(state.release);
} else if (args[0] === 'release' && args[1] === 'upload') {
  if (!state.release.draft) throw Error('Cannot upload to a published release');
  if (state.failUpload) { save(); console.error('simulated upload interruption'); process.exit(1); }
  state.release.assets = args.slice(3).filter(arg => arg !== '--clobber').map(file => ({
    name: path.basename(file), size: fs.statSync(file).size,
    digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }));
  if (state.badDigest) state.release.assets[0].digest = 'sha256:corrupt';
  if (state.advanceDuringUpload) state.comparison = {status: 'ahead', files: [{filename: 'package-lock.json'}]};
  response(state.release);
} else throw Error('Unexpected command: ' + args.join(' '));
`;

function fixture(t, options = {}, releaseVersion = version) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-publish-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'bin'));
  writeFileSync(path.join(root, 'bin/gh'), fakeGh);
  chmodSync(path.join(root, 'bin/gh'), 0o755);
  mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
  writeFileSync(path.join(root, 'apps/desktop/package.json'), JSON.stringify({ version: '1.0.0' }));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'apps/desktop': { version: '1.0.0' } } }));
  for (const platform of ['win', 'linux']) {
    const directory = path.join(root, `release-artifacts/installers-${platform}-x64-${platform === 'win' ? 1 : 2}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `build-info-${platform}.json`), JSON.stringify({ version: releaseVersion, commit, runId: '1234', platform }));
    for (const name of installerNames(releaseVersion, platform)) writeFileSync(path.join(directory, name), `${platform} installer fixture`);
  }
  writeFileSync(path.join(root, 'github.json'), JSON.stringify({ calls: [], comparison: { status: 'identical' }, ...options }));
  const read = () => JSON.parse(readFileSync(path.join(root, 'github.json'), 'utf8'));
  const run = (overrides = {}) => spawnSync(process.execPath, [publisher], { cwd: root, encoding: 'utf8', env: {
    ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, GH_TOKEN: '', GITHUB_TOKEN: '',
    GH_REPO: 'example/setdown', GITHUB_SHA: commit, GITHUB_RUN_ID: '1234', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'), RELEASE_CHANNEL: 'preview', RELEASE_VERSION: releaseVersion,
    RELEASE_TAG: `v${releaseVersion}`, RELEASE_PRERELEASE: 'true', ...overrides,
  } });
  return { root, read, run };
}

test('publication verifies both platform artifacts, stages six files, then publishes once', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const state = f.read();
  assert.equal(state.published, true);
  assert.equal(state.release.assets.length, 6);
  assert.deepEqual(state.release.assets.map(asset => asset.name).sort(),
    [...installerNames(version, 'win'), ...installerNames(version, 'linux'), 'build-info.json', 'SHA256SUMS'].sort());
  assert.equal(state.calls.at(-1).includes('make_latest=false'), true);
  const info = JSON.parse(readFileSync(path.join(f.root, 'release-assets/build-info.json'), 'utf8'));
  assert.equal(info.commit, commit);
  assert.equal(readFileSync(path.join(f.root, 'release-assets/SHA256SUMS'), 'utf8').trim().split('\n').length, 5);
});

test('stable publication requires the matching tag and participates in Latest selection', t => {
  const f = fixture(t, { tagCommit: commit }, '1.0.0');
  const result = f.run({ RELEASE_CHANNEL: 'tag', GITHUB_REF: 'refs/tags/v1.0.0', RELEASE_PRERELEASE: 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read().published, true);
  assert.equal(f.read().calls.at(-1).includes('make_latest=legacy'), true);
  assert.equal(f.read().calls.find(call => call[1] === 'create').includes('--verify-tag'), true);
});

test('manual artifact runs cannot invoke publication', t => {
  const f = fixture(t);
  assert.notEqual(f.run({ RELEASE_CHANNEL: 'artifact', GITHUB_EVENT_NAME: 'workflow_dispatch' }).status, 0);
  assert.deepEqual(f.read().calls, []);
});

test('a mismatched platform provenance aborts before any release mutation', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'release-artifacts/installers-win-x64-1/build-info-win.json'), JSON.stringify({ version, commit: 'b'.repeat(40), runId: '1234', platform: 'win' }));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().calls.some(call => call[0] === 'release'), false);
});

test('missing Linux installers abort before a release is created', t => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'release-artifacts/installers-linux-x64-2', installerNames(version, 'linux')[1]));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().release, undefined);
});

test('an interrupted upload leaves a draft that a failed-job rerun can complete', t => {
  const f = fixture(t, { failUpload: true });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().release.draft, true);
  assert.equal(f.read().published, undefined);
  const state = f.read();
  state.failUpload = false;
  writeFileSync(path.join(f.root, 'github.json'), JSON.stringify(state));
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.read().published, true);
  assert.equal(f.read().calls.filter(call => call[0] === 'release' && call[1] === 'create').length, 1);
});

test('published releases are never overwritten on rerun', t => {
  const f = fixture(t, { release: { draft: false, target_commitish: commit, html_url: 'https://example.invalid/release' } });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read().calls.some(call => call[0] === 'release' || call.includes('PATCH')), false);
});

test('a tag that moved away from the validated source cannot be published', t => {
  const f = fixture(t, { tagCommit: 'b'.repeat(40) });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().release, undefined);
});

test('remote checksum mismatch prevents publication', t => {
  const f = fixture(t, { badDigest: true });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().release.draft, true);
  assert.equal(f.read().published, undefined);
});

test('obsolete main builds skip publication, including advances during upload', t => {
  const old = fixture(t, { comparison: { status: 'ahead', files: [{ filename: 'package.json' }] } });
  assert.equal(old.run().status, 0);
  assert.equal(old.read().release, undefined);
  const concurrent = fixture(t, { advanceDuringUpload: true });
  const result = concurrent.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(concurrent.read().release.draft, true);
  assert.equal(concurrent.read().published, undefined);
});
