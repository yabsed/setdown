import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { ServerDiscovery } from './server-discovery';

/** Explicit Configure action only. Fixed argv, bounded output/time, no shell.
 * Building/indexing is independent of displaying and saving the source buffer. */
export class AnalysisPreparation {
  private readonly jobs = new Map<string, { owner: number; cancel(): void }>();
  async run(owner: number, root: string, kind: 'cmake' | 'meson', discovery: ServerDiscovery): Promise<{ database: string; output: string }> {
    const key = root;
    if (this.jobs.has(key)) throw Error('This project is already being configured.');
    let cancelled = false, terminate: (() => void) | undefined;
    this.jobs.set(key, { owner, cancel: () => { cancelled = true; terminate?.(); } });
    try {
      const found = await discovery.find(kind, { resolveEnvironment: true });
      if (!found.selected) throw Error(`${kind} was not found. Install it or choose an existing build folder.`);
      const directory = path.join(app.getPath('userData'), 'setdown-analysis', createHash('sha256').update(root).digest('hex').slice(0, 24), kind);
      await mkdir(path.dirname(directory), { recursive: true });
      if (cancelled) throw Error('Project configuration cancelled.');
      const args = kind === 'cmake' ? ['-S', root, '-B', directory, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'] : ['setup', '--reconfigure', directory, root];
      const { NODE_OPTIONS: _node, NODE_PATH: _path, ELECTRON_RUN_AS_NODE: _electron, ...env } = found.environment.env;
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(found.selected!.path, args, { cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', timedOut = false;
        const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } };
        terminate = kill;
        const timer = setTimeout(() => { timedOut = true; kill(); }, 120_000); timer.unref();
        const append = (data: Buffer) => { output = (output + String(data)).slice(-64 * 1024); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); if (cancelled || timedOut || code !== 0) reject(Error(`${cancelled ? 'Project configuration cancelled' : timedOut ? 'Project configuration timed out' : `Configuration failed (${code})`}.\n${output}`)); else resolve(output); });
      });
      return { database: path.join(directory, 'compile_commands.json'), output };
    } finally { this.jobs.delete(key); }
  }
  cancel(owner: number, root?: string) { for (const [key, job] of this.jobs) if (job.owner === owner && (!root || key === root)) job.cancel(); }
  dispose() { for (const job of this.jobs.values()) job.cancel(); }
}
