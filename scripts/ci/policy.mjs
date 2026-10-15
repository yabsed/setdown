import path from 'node:path';

// Exclude only known documentation locations. Markdown fixtures, CSS, lockfiles,
// workflow changes, submodule pointers and unknown paths all require app checks.
export function isDocumentation(file) {
  return /^(?:README(?:\.[^/]+)?\.md|README\.md|AGENTS\.md|CONTRIBUTING\.md|CHANGELOG\.md|LICENSE(?:\.md|\.txt)?|live_demo\.gif)$/.test(file)
    || /^(?:docs|reports)\//.test(file);
}

export function documentationOnly(files) {
  return files.length > 0 && files.every(isDocumentation);
}

export function planChecks({ event, ref, files }) {
  const force = event === 'workflow_dispatch' || ref.startsWith('refs/tags/');
  return {
    desktop: force || !documentationOnly(files),
    channel: event === 'workflow_dispatch' ? 'artifact'
      : event === 'push' && ref.startsWith('refs/tags/v') ? 'tag' : 'none',
  };
}

export function releaseMetadata({ channel, version, lockVersion, ref, event, runId }) {
  if (version !== lockVersion) throw Error('Desktop and lockfile versions must match.');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || match[4]?.split('.').some(part => /^0\d+$/.test(part))) {
    throw Error('Use a semantic desktop version without build metadata.');
  }
  if (channel === 'tag') {
    if (event !== 'push' || ref !== `refs/tags/v${version}`) {
      throw Error(`Release tag must be v${version}, matching the desktop version.`);
    }
    return { version, tag: `v${version}`, prerelease: !!match[4] };
  }
  if (channel !== 'preview' && channel !== 'artifact') throw Error('Invalid release channel.');
  if (channel === 'preview' && (event !== 'push' || ref !== 'refs/heads/main')) {
    throw Error('Development releases require a main push.');
  }
  if (channel === 'artifact' && event !== 'workflow_dispatch') throw Error('Artifacts require a manual run.');
  if (!/^[1-9]\d*$/.test(runId)) throw Error('A positive workflow run ID is required.');
  // A development build must sort after the current stable version but before
  // the next stable patch. An already-prerelease version keeps its target core.
  const patch = match[4] ? match[3] : String(BigInt(match[3]) + 1n);
  const generated = `${match[1]}.${match[2]}.${patch}-${channel === 'preview' ? 'dev' : 'test'}.${runId}`;
  return { version: generated, tag: `v${generated}`, prerelease: true };
}

export function installerNames(version, platform) {
  const suffixes = { win: ['x64.exe'], linux: ['x86_64.AppImage', 'amd64.deb', 'x86_64.rpm'] }[platform];
  if (!suffixes) throw Error(`Unsupported platform: ${platform}`);
  return suffixes.map(suffix => `Setdown-${version}-${platform}-${suffix}`);
}

export function latestArtifact(directories, platform) {
  const pattern = new RegExp(`^installers-${platform}-x64-([1-9]\\d*)$`);
  const candidates = directories.map(directory => ({ directory, attempt: Number(pattern.exec(path.basename(directory))?.[1] ?? 0) }))
    .filter(entry => entry.attempt > 0).sort((a, b) => b.attempt - a.attempt);
  if (!candidates.length) throw Error(`Missing ${platform} installer artifact.`);
  return candidates[0].directory;
}

export function previewStillCurrent(comparison) {
  if (comparison.status === 'identical') return true;
  // The compare API caps its file list at 300; never infer docs-only from a
  // potentially truncated list. Include the original name of renamed files.
  return comparison.status === 'ahead' && Array.isArray(comparison.files)
    && comparison.files.length > 0 && comparison.files.length < 300
    && comparison.files.every(file => isDocumentation(file.filename)
      && (!file.previous_filename || isDocumentation(file.previous_filename)));
}
