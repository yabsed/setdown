import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, createReadStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installerNames, latestArtifact, previewStillCurrent, releaseMetadata } from './policy.mjs';

const env = process.env;
const { GH_REPO: repo, GITHUB_SHA: commit, GITHUB_RUN_ID: runId, RELEASE_CHANNEL: channel } = env;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(commit ?? '')) throw Error('Invalid release source.');
const manifest = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const { version, tag, prerelease } = releaseMetadata({ channel, version: manifest.version,
  lockVersion: lock.packages['apps/desktop'].version, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, runId });
if (channel === 'artifact' || version !== env.RELEASE_VERSION || tag !== env.RELEASE_TAG
  || String(prerelease) !== env.RELEASE_PRERELEASE) throw Error('Release metadata does not match the checked source.');

const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
function api(endpoint, optional = false) {
  try { return JSON.parse(gh(['api', `repos/${repo}/${endpoint}`])); }
  catch (error) {
    if (optional && /HTTP 404/.test(String(error.stderr))) return null;
    throw error;
  }
}
function summary(message) {
  console.log(message);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

// Re-running an old main workflow must not publish obsolete application code.
// A later docs-only push is allowed: it does not schedule a replacement build.
if (channel === 'preview' && !previewStillCurrent(api(`compare/${commit}...main`))) {
  summary('Development release skipped: main has newer application changes.');
  process.exit(0);
}
const tagCommit = api(`commits/${encodeURIComponent(tag)}`, true);
if ((channel === 'tag' && !tagCommit) || (tagCommit && tagCommit.sha !== commit)) {
  throw Error(`Tag ${tag} does not point to the tested commit ${commit}.`);
}
const existing = api(`releases/tags/${encodeURIComponent(tag)}`, true);
if (existing && existing.target_commitish !== commit) throw Error('Existing release belongs to a different source; refusing to replace it.');
if (existing && !existing.draft) {
  summary(`Already published; preserved without modification: ${existing.html_url}`);
  process.exit(0);
}

const staging = path.resolve('release-assets');
mkdirSync(staging, { recursive: true });
const artifacts = readdirSync('release-artifacts', { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => path.join('release-artifacts', entry.name));
const files = [];
for (const platform of ['win', 'linux']) {
  const directory = latestArtifact(artifacts, platform);
  const info = JSON.parse(readFileSync(path.join(directory, `build-info-${platform}.json`), 'utf8'));
  if (info.commit !== commit || info.version !== version || info.runId !== runId || info.platform !== platform) {
    throw Error(`${platform} installers do not belong to this tested commit/version/run.`);
  }
  for (const name of installerNames(version, platform)) {
    const source = path.join(directory, name);
    const stat = statSync(source);
    if (!stat.isFile() || stat.size === 0) throw Error(`Missing or empty installer: ${source}`);
    copyFileSync(source, path.join(staging, name));
    files.push(name);
  }
}
const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
writeFileSync(path.join(staging, 'build-info.json'), `${JSON.stringify({ version, channel, commit, repository: repo, runId, runUrl }, null, 2)}\n`);
files.push('build-info.json');
const hashes = new Map();
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(staging, name))) hash.update(chunk);
  hashes.set(name, hash.digest('hex'));
}
writeFileSync(path.join(staging, 'SHA256SUMS'), [...hashes].map(([name, hash]) => `${hash}  ${name}\n`).join(''));
files.push('SHA256SUMS');
const notesFile = path.join(staging, 'release-notes.md');
writeFileSync(notesFile, [
  channel === 'preview' ? 'Development build from main. This is a pre-release.' : `Setdown ${version}.`,
  '', `Source: [${commit.slice(0, 12)}](https://github.com/${repo}/commit/${commit})`,
  `Validation and packaging: [workflow run](${runUrl})`, '',
  'Windows x64: `.exe`. Linux x64: `.AppImage`, `.deb`, or `.rpm`.',
  'Windows installers are unsigned. Check `SHA256SUMS` to verify your download.',
  '',
].join('\n'));

// Stage all files on a draft before publication, including on repositories
// with immutable releases. A failed upload leaves a resumable, unpublished draft.
if (!existing) {
  const flags = prerelease ? ['--prerelease'] : [];
  if (channel === 'tag') flags.push('--verify-tag');
  gh(['release', 'create', tag, '--draft', '--target', commit, '--latest=false',
    '--title', `Setdown ${version}`, '--notes-file', notesFile, ...flags]);
}
gh(['release', 'upload', tag, ...files.map(name => path.join(staging, name)), '--clobber']);
const staged = api(`releases/tags/${encodeURIComponent(tag)}`);
if (!staged.draft) throw Error('Release was published before upload verification.');
if (staged.assets.length !== files.length) throw Error('Draft contains unexpected or missing assets.');
for (const name of files) {
  const asset = staged.assets.find(asset => asset.name === name);
  if (!asset || asset.size !== statSync(path.join(staging, name)).size) throw Error(`Incomplete release asset: ${name}`);
  if (asset.digest && hashes.has(name) && asset.digest !== `sha256:${hashes.get(name)}`) throw Error(`Release asset checksum mismatch: ${name}`);
}
if (channel === 'preview' && !previewStillCurrent(api(`compare/${commit}...main`))) {
  summary(`Newer application changes arrived during upload; ${tag} remains an unpublished draft.`);
  process.exit(0);
}
// GitHub's legacy selection chooses the latest stable version by release date
// and semantic version; development builds never replace the stable Latest link.
gh(['api', '--method', 'PATCH', `repos/${repo}/releases/${staged.id}`,
  '-F', 'draft=false', '-F', `prerelease=${prerelease}`, '-f', `make_latest=${prerelease ? 'false' : 'legacy'}`]);
summary(`Published [Setdown ${version}](https://github.com/${repo}/releases/tag/${tag}) from \`${commit}\`.`);
