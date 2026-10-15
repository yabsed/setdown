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
const failure = status => {
  save();
  console.error(status === 'network' ? 'dial tcp: connection reset by peer' : 'gh: Request failed (HTTP ' + status + ')');
  process.exit(1);
};
const missing = () => failure(404);
if (args[0] === 'api') {
  const endpoint = args.find(arg => arg.startsWith('repos/'));
  const resource = endpoint.slice('repos/example/setdown/'.length);
  if (state.apiErrors?.[resource]) failure(state.apiErrors[resource]);
  if (endpoint.includes('/compare/')) {
    if (state.moveTagDuringFinalCompare && state.calls.filter(call => call.some(arg => arg.includes('/compare/'))).length > 1)
      state.tagCommit = state.moveTagDuringFinalCompare;
    response(state.comparison);
  }
  else if (endpoint.includes('/git/ref/tags/')) {
    if (state.tagReference) response(state.tagReference);
    else if (state.tagObject || state.tagCommit) response({
      ref: 'refs/tags/' + decodeURIComponent(resource.slice('git/ref/tags/'.length)),
      object: state.tagObject ?? {type: 'commit', sha: state.tagCommit},
    });
    else missing();
  }
  else if (endpoint.includes('/git/tags/')) {
    const object = state.tagObjects?.[resource.slice('git/tags/'.length)];
    object ? response({object}) : missing();
  }
  else if (endpoint.includes('/commits/')) {
    // Match the real API failure that the previous CLI double hid as a 404.
    if (state.tagCommit) response({sha: state.tagCommit});
    else { save(); console.error('gh: No commit found for SHA (HTTP 422)'); process.exit(1); }
  }
  else if (args.includes('PATCH')) {
    if (state.failPublish) failure(503);
    state.release.draft = false;
    state.published = true;
    if (!state.tagCommit && !state.tagObject) state.tagCommit = state.release.target_commitish;
    response(state.release);
  } else if (endpoint.includes('/releases/tags/')) state.release ? response(state.release) : missing();
  else throw Error('Unexpected API call: ' + args.join(' '));
} else if (args[0] === 'release' && args[1] === 'create') {
  if (!args.includes('--draft')) throw Error('Must create a draft');
  state.release = {id: 1, tag_name: args[2], draft: true, target_commitish: value('--target'), assets: [], html_url: 'https://example.invalid/release'};
  response(state.release);
} else if (args[0] === 'release' && args[1] === 'upload') {
  if (!state.release.draft) throw Error('Cannot upload to a published release');
  state.release.assets = args.slice(3).filter(arg => arg !== '--clobber').map(file => ({
    name: path.basename(file), size: fs.statSync(file).size,
    digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }));
  if (state.failUpload) {
    state.release.assets = state.release.assets.slice(0, 2);
    save(); console.error('simulated upload interruption'); process.exit(1);
  }
  if (state.badDigest) state.release.assets[0].digest = 'sha256:corrupt';
  if (state.advanceDuringUpload) state.comparison = {status: 'ahead', files: [{filename: 'package-lock.json'}]};
  if (state.moveTagDuringUpload) state.tagCommit = state.moveTagDuringUpload;
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
  const run = (overrides = {}) => spawnSync(process.execPath, [publisher], { cwd: root, encoding: 'utf8', timeout: 15_000, env: {
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
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.read().calls.filter(call => call.includes('PATCH')).length, 1);
  assert.equal(f.read().calls.filter(call => call[0] === 'release' && call[1] === 'create').length, 1);
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
  assert.equal(f.read().release.assets.length, 2);
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
  const f = fixture(t, { tagCommit: commit, release: {
    id: 1, tag_name: `v${version}`, draft: false, target_commitish: 'main', html_url: 'https://example.invalid/release',
  } });
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

test('stable publication refuses an absent tag before creating a release', t => {
  const f = fixture(t, {}, '1.0.0');
  const result = f.run({ RELEASE_CHANNEL: 'tag', GITHUB_REF: 'refs/tags/v1.0.0', RELEASE_PRERELEASE: 'false' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required release tag .* does not exist/);
  assert.equal(f.read().calls.some(call => call[0] === 'release' || call.includes('PATCH')), false);
});

test('nested annotated tags are resolved to the tested commit', t => {
  const outer = 'c'.repeat(40), inner = 'd'.repeat(40);
  const f = fixture(t, { tagObject: { type: 'tag', sha: outer }, tagObjects: {
    [outer]: { type: 'tag', sha: inner }, [inner]: { type: 'commit', sha: commit },
  } }, '1.0.0');
  const result = f.run({ RELEASE_CHANNEL: 'tag', GITHUB_REF: 'refs/tags/v1.0.0', RELEASE_PRERELEASE: 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read().published, true);
});

test('invalid, cyclic and missing annotated tag objects never become absent preview tags', async t => {
  const sha = 'c'.repeat(40);
  const scenarios = {
    wrongCommit: { tagObject: { type: 'tag', sha }, tagObjects: { [sha]: { type: 'commit', sha: 'b'.repeat(40) } } },
    nonCommit: { tagObject: { type: 'tree', sha } },
    cycle: { tagObject: { type: 'tag', sha }, tagObjects: { [sha]: { type: 'tag', sha } } },
    missingObject: { tagObject: { type: 'tag', sha } },
    wrongReference: { tagReference: { ref: `refs/tags/v${version}-other`, object: { type: 'commit', sha: commit } } },
  };
  for (const [name, options] of Object.entries(scenarios)) await t.test(name, t => {
    const f = fixture(t, options);
    assert.notEqual(f.run().status, 0);
    assert.equal(f.read().calls.some(call => call[0] === 'release' || call.includes('PATCH')), false);
  });
});

test('lookup authorization, validation, rate-limit, server and network failures stop publication', async t => {
  for (const resource of [`git/ref/tags/v${version}`, `releases/tags/v${version}`]) {
    for (const status of [401, 403, 422, 429, 503, 'network']) await t.test(`${resource}: ${status}`, t => {
      const f = fixture(t, { apiErrors: { [resource]: status } });
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, status === 'network' ? /connection reset/ : new RegExp(`HTTP ${status}`));
      assert.equal(f.read().calls.some(call => call[0] === 'release' || call.includes('PATCH')), false);
    });
  }
});

test('unbound drafts, wrong release identities and published releases without tags cannot be resumed', async t => {
  const release = { id: 1, tag_name: `v${version}`, draft: true, target_commitish: commit, assets: [] };
  const scenarios = {
    differentSource: { release: { ...release, target_commitish: 'b'.repeat(40) } },
    wrongIdentity: { tagCommit: commit, release: { ...release, tag_name: 'v9.0.0' } },
    publishedWithoutTag: { release: { ...release, draft: false } },
  };
  for (const [name, options] of Object.entries(scenarios)) await t.test(name, t => {
    const f = fixture(t, options);
    assert.notEqual(f.run().status, 0);
    assert.equal(f.read().calls.some(call => call[0] === 'release' || call.includes('PATCH')), false);
  });
});

test('a failed publication leaves verified assets in a resumable draft', t => {
  const f = fixture(t, { failPublish: true });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().release.draft, true);
  assert.equal(f.read().release.assets.length, 6);
  const state = f.read();
  state.failPublish = false;
  writeFileSync(path.join(f.root, 'github.json'), JSON.stringify(state));
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.read().published, true);
  assert.equal(f.read().calls.filter(call => call[0] === 'release' && call[1] === 'create').length, 1);
});

test('a tag moved during upload or the final freshness check prevents publication', async t => {
  for (const setting of ['moveTagDuringUpload', 'moveTagDuringFinalCompare']) await t.test(setting, t => {
    const f = fixture(t, { tagCommit: commit, [setting]: 'b'.repeat(40) });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not point to the tested commit/);
    assert.equal(f.read().release.draft, true);
    assert.equal(f.read().published, undefined);
    assert.equal(f.read().calls.some(call => call.includes('PATCH')), false);
  });
});
