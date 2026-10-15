import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installerNames } from './policy.mjs';

const { RELEASE_VERSION: version, RELEASE_PLATFORM: platform, GITHUB_SHA: commit, GITHUB_RUN_ID: runId } = process.env;
const directory = process.argv[2] ?? 'apps/desktop/release';
for (const file of installerNames(version, platform)) {
  const stat = statSync(path.join(directory, file));
  if (!stat.isFile() || stat.size === 0) throw Error(`Missing or empty installer: ${file}`);
}
writeFileSync(path.join(directory, `build-info-${platform}.json`), `${JSON.stringify({ version, platform, commit, runId }, null, 2)}\n`);
