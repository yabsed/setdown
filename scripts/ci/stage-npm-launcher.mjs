import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launcherArchives } from './policy.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

/** The launcher trusts only these checksums, so take them from the release's
 * own SHA256SUMS and refuse a release that lacks an archive. */
export function launcherRelease({ version, repository, sums }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw Error('A release version is required.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw Error('A GitHub owner/repository is required.');
  const hashes = new Map(sums.split('\n').filter(Boolean).map(line => {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw Error(`Invalid SHA256SUMS line: ${line}`);
    return [match[2], match[1]];
  }));
  const assets = {};
  for (const [platform, file] of Object.entries(launcherArchives(version))) {
    if (!hashes.has(file)) throw Error(`Release ${version} has no checksum for ${file}.`);
    assets[platform] = { file, sha256: hashes.get(file) };
  }
  return { version, baseUrl: `https://github.com/${repository}/releases/download/v${version}/`, assets };
}

/** Write a publishable copy. The checked-in package stays private and
 * unversioned, so it cannot be published without a release behind it. */
export function stageLauncher({ output, version, repository, sums, source = path.join(repositoryRoot, 'tooling/npm-launcher') }) {
  const { private: _private, ...manifest } = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  // Downloads come from the repository the package itself names, unless CI says otherwise.
  repository ||= /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(manifest.repository.url)?.[1];
  const release = launcherRelease({ version, repository, sums });
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length) throw Error(`Staging directory is not empty: ${output}`);
  writeFileSync(path.join(output, 'package.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  writeFileSync(path.join(output, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  for (const entry of ['bin', 'lib', 'README.md']) cpSync(path.join(source, entry), path.join(output, entry), { recursive: true });
  cpSync(path.join(repositoryRoot, 'LICENSE'), path.join(output, 'LICENSE'));
  return release;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sumsFile, output] = process.argv.slice(2);
  if (!sumsFile || !output) throw Error('Usage: RELEASE_VERSION=<version> node stage-npm-launcher.mjs <SHA256SUMS> <empty output directory>');
  const release = stageLauncher({ output: path.resolve(output), version: process.env.RELEASE_VERSION,
    repository: process.env.GH_REPO || process.env.GITHUB_REPOSITORY, sums: readFileSync(sumsFile, 'utf8') });
  console.log(`Staged the npm launcher for Setdown ${release.version} in ${output}`);
}
