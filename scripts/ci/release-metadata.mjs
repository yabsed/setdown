import { appendFileSync, readFileSync } from 'node:fs';
import { releaseMetadata } from './policy.mjs';

const manifest = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const metadata = releaseMetadata({ channel: process.env.RELEASE_CHANNEL,
  version: manifest.version, lockVersion: lock.packages['apps/desktop'].version,
  event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, runId: process.env.GITHUB_RUN_ID });
for (const [key, value] of Object.entries(metadata)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Package version: **${metadata.version}**\n\nSource: \`${process.env.GITHUB_SHA}\`\n`);
