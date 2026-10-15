import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { planChecks } from './policy.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = event.pull_request?.base?.sha ?? event.before;
let files = [];
if (/^[0-9a-f]{40}$/.test(base ?? '') && !/^0+$/.test(base)) {
  try {
    // Disabling rename detection preserves both paths when code moves to docs.
    files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD', '--'], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch {
    console.log('Base commit unavailable; running all desktop checks.');
  }
}
const plan = planChecks({ event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, files });
for (const [key, value] of Object.entries(plan)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `Desktop checks: **${plan.desktop ? 'required' : 'documentation-only skip'}**. Delivery: **${plan.channel}**.\n`);
