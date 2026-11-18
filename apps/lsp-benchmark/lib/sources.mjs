// Brings each project to its fixed commit under work/sources and runs its setup once.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { work } from './paths.mjs';

export const sources = path.join(work, 'sources');

function run(command, args, cwd, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(Error(`${log}: ${command} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}

/** The folder of a project, fetched and set up. `setup: false` only fetches. */
export async function prepare(name, project, { setup = true, note = () => {} } = {}) {
  const root = path.join(sources, name), marker = path.join(root, '.git', 'setdown-benchmark');
  const wanted = { commit: project.commit, setup: createHash('sha256').update(JSON.stringify(project.setup ?? [])).digest('hex') };
  const done = await readFile(marker, 'utf8').then(JSON.parse, () => ({}));
  if (done.commit !== wanted.commit) {
    note(`fetching ${project.repo} at ${project.commit.slice(0, 10)}`);
    await mkdir(root, { recursive: true });
    await run('git', ['init', '--quiet'], root, name);
    // One commit, not the history: the benchmark reads the files of that moment.
    await run('git', ['fetch', '--quiet', '--depth', '1', `https://github.com/${project.repo}.git`, project.commit], root, name);
    await run('git', ['checkout', '--quiet', '--force', 'FETCH_HEAD'], root, name);
    done.commit = wanted.commit; done.setup = undefined;
    await writeFile(marker, JSON.stringify(done));
  }
  if (setup && done.setup !== wanted.setup) {
    for (const line of project.setup ?? []) { note(`${name}: ${line}`); await run('sh', ['-c', line], root, name); }
    done.setup = wanted.setup;
    await writeFile(marker, JSON.stringify(done));
  }
  return root;
}
