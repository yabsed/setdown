import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { documentationOnly, installerNames, latestArtifact, planChecks, previewStillCurrent, releaseMetadata } from './policy.mjs';
import { sandboxPath } from './electron-sandbox.mjs';

test('only known documentation paths may skip desktop checks', () => {
  assert.equal(documentationOnly(['README.md', 'docs/assets/demo.gif', 'reports/result.md']), true);
  for (const file of ['apps/desktop/test/fixtures/sample.md', 'apps/desktop/src/theme.css', 'package-lock.json',
    '.github/workflows/ci.yml', 'scripts/ci/policy.mjs', 'vendor/crossnote', 'unknown.txt']) {
    assert.equal(documentationOnly(['README.md', file]), false, file);
  }
  assert.equal(documentationOnly([]), false, 'unknown or empty diff runs checks');
});

test('tags and manual builds always validate; PRs cannot publish', () => {
  const files = ['README.md'];
  assert.deepEqual(planChecks({ event: 'push', ref: 'refs/heads/main', files }), { desktop: false, channel: 'preview' });
  assert.deepEqual(planChecks({ event: 'push', ref: 'refs/tags/v1.0.0', files }), { desktop: true, channel: 'tag' });
  assert.deepEqual(planChecks({ event: 'workflow_dispatch', ref: 'refs/heads/main', files }), { desktop: true, channel: 'artifact' });
  assert.deepEqual(planChecks({ event: 'pull_request', ref: 'refs/pull/1/merge', files: ['package.json'] }), { desktop: true, channel: 'none' });
});

const input = { channel: 'preview', version: '1.0.0', lockVersion: '1.0.0', ref: 'refs/heads/main', event: 'push', runId: '1234' };
test('development versions are unique per run, repeatable on retry, and target the next patch', () => {
  assert.deepEqual(releaseMetadata(input), { version: '1.0.1-dev.1234', tag: 'v1.0.1-dev.1234', prerelease: true });
  assert.deepEqual(releaseMetadata(input), releaseMetadata(input));
  assert.notEqual(releaseMetadata(input).version, releaseMetadata({ ...input, runId: '1235' }).version);
  assert.equal(releaseMetadata({ ...input, version: '2.0.0-beta.1', lockVersion: '2.0.0-beta.1' }).version, '2.0.0-dev.1234');
});

test('release metadata rejects tag mismatch, lock drift and unauthorized channel/event combinations', () => {
  const tagged = { ...input, channel: 'tag', ref: 'refs/tags/v1.0.0' };
  assert.deepEqual(releaseMetadata(tagged), { version: '1.0.0', tag: 'v1.0.0', prerelease: false });
  const beta = { ...tagged, version: '1.1.0-beta.1', lockVersion: '1.1.0-beta.1', ref: 'refs/tags/v1.1.0-beta.1' };
  assert.equal(releaseMetadata(beta).prerelease, true);
  for (const bad of [{ ...tagged, ref: 'refs/tags/v2.0.0' }, { ...input, lockVersion: '0.9.0' },
    { ...input, event: 'pull_request' }, { ...input, event: 'workflow_dispatch' }, { ...input, ref: 'refs/heads/feature' },
    { ...input, channel: 'artifact' }, { ...input, runId: '../invalid' }, { ...input, channel: 'unknown' },
    { ...input, version: '1.0.0-beta.01', lockVersion: '1.0.0-beta.01' }]) {
    assert.throws(() => releaseMetadata(bad));
  }
  assert.equal(releaseMetadata({ ...input, channel: 'artifact', event: 'workflow_dispatch' }).version, '1.0.1-test.1234');
});

test('failed-job reruns select the newest successful artifact separately for each platform', () => {
  const directories = ['installers-win-x64-1', 'installers-linux-x64-1', 'installers-linux-x64-2', 'package-failure-win-3'];
  assert.equal(latestArtifact(directories, 'win'), 'installers-win-x64-1');
  assert.equal(latestArtifact(directories, 'linux'), 'installers-linux-x64-2');
  assert.throws(() => latestArtifact(['package-failure-win-1'], 'win'));
  assert.equal(installerNames('1.0.1-dev.1', 'linux').length, 3);
  assert.throws(() => installerNames('1.0.0', 'unknown'));
});

test('obsolete main reruns cannot publish; later documentation alone is allowed', () => {
  assert.equal(previewStillCurrent({ status: 'identical' }), true);
  assert.equal(previewStillCurrent({ status: 'ahead', files: [{ filename: 'README.md' }] }), true);
  assert.equal(previewStillCurrent({ status: 'ahead', files: [{ filename: 'apps/desktop/src/app.ts' }] }), false);
  assert.equal(previewStillCurrent({ status: 'ahead', files: [{ filename: 'docs/moved.ts', previous_filename: 'apps/desktop/src/app.ts' }] }), false);
  assert.equal(previewStillCurrent({ status: 'diverged', files: [{ filename: 'README.md' }] }), false);
  assert.equal(previewStillCurrent({ status: 'ahead', files: Array(300).fill({ filename: 'docs/page.md' }) }), false);
  assert.equal(previewStillCurrent({ status: 'ahead', files: [] }), false);
});

test('sandbox resolution follows each checkout independently, including nested Electron', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-sandbox-path-'));
  try {
    for (const layout of ['hoisted', 'nested']) {
      const checkout = path.join(root, layout);
      const desktop = path.join(checkout, 'apps/desktop');
      mkdirSync(desktop, { recursive: true });
      writeFileSync(path.join(desktop, 'package.json'), '{}');
      const electron = path.join(layout === 'hoisted' ? checkout : desktop, 'node_modules/electron');
      mkdirSync(path.join(electron, 'dist'), { recursive: true });
      writeFileSync(path.join(electron, 'package.json'), '{"name":"electron"}');
      writeFileSync(path.join(electron, 'dist/chrome-sandbox'), 'fixture');
      assert.equal(sandboxPath(checkout), path.join(electron, 'dist/chrome-sandbox'));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real git diff preserves deleted code when it is renamed into documentation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-ci-diff-'));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'ci-test@example.invalid']);
    git(['config', 'user.name', 'CI policy test']);
    mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
    writeFileSync(path.join(root, 'apps/desktop/file.md'), '# fixture');
    git(['add', '.']); git(['commit', '-qm', 'base']);
    mkdirSync(path.join(root, 'docs'));
    git(['mv', 'apps/desktop/file.md', 'docs/file.md']);
    git(['commit', '-qm', 'move']);
    const files = git(['diff', '--no-renames', '--name-only', '-z', 'HEAD^', 'HEAD', '--']).split('\0').filter(Boolean);
    assert.equal(documentationOnly(files), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
