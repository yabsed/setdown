import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type {
  GitChange,
  GitDiff,
  GitRemoteAction,
  GitSnapshot,
} from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import { ProjectPaths } from './project-paths';

const exec = promisify(execFile);
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const EMPTY: GitSnapshot = {
  repository: false,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  changes: [],
};

function decodePath(value: string): string {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

export function parseGitStatus(output: string): GitChange[] {
  return output.split(/\r?\n/).flatMap((line) => {
    if (line.length < 4 || line.startsWith('## ')) return [];
    const code = line.slice(0, 2);
    const indexStatus = code[0] ?? ' ';
    const workingTreeStatus = code[1] ?? ' ';
    const decoded = decodePath(line.slice(3));
    const changePath = decoded.split(' -> ').at(-1) ?? '';
    const untracked = code === '??';
    const conflict = CONFLICTS.has(code);
    return [{
      path: changePath,
      filePath: '',
      status: conflict ? '!' : untracked ? 'U'
        : workingTreeStatus !== ' ' ? workingTreeStatus : indexStatus.trim() || '?',
      indexStatus,
      workingTreeStatus,
      staged: !untracked && indexStatus !== ' ' && indexStatus !== '?',
      unstaged: untracked || workingTreeStatus !== ' ',
      conflict,
    }];
  });
}

export class GitService {
  constructor(
    private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath),
  ) {}

  async status(state: WindowState): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    if (!await this.isRepository(root)) return { ...EMPTY, changes: [] };
    const [branch, upstream, status] = await Promise.all([
      this.output(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => 'HEAD'),
      this.output(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
        .catch(() => ''),
      this.output(root, ['-c', 'core.quotepath=false', 'status', '--short', '--untracked-files=all', '--', '.']),
    ]);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = await this.output(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
        .catch(() => '0 0');
      const [local, remote] = counts.split(/\s+/).map(Number);
      ahead = Number.isFinite(local) ? local : 0;
      behind = Number.isFinite(remote) ? remote : 0;
    }
    return {
      repository: true,
      branch: branch || 'HEAD',
      upstream,
      ahead,
      behind,
      changes: parseGitStatus(status).map((change) => ({
        ...change,
        filePath: path.join(root, change.path),
      })),
    };
  }

  async initialize(state: WindowState): Promise<GitSnapshot> {
    await this.run(this.paths.root(state), ['init']);
    return this.status(state);
  }

  async diff(state: WindowState, candidate: string, staged: boolean): Promise<GitDiff> {
    const root = this.paths.root(state);
    const filePath = this.paths.inside(state, candidate);
    const relative = this.paths.relative(state, filePath);
    const change = (await this.status(state)).changes.find((item) => item.filePath === filePath);
    let patch: string;
    if (!staged && change?.indexStatus === '?' && change.workingTreeStatus === '?') {
      const contents = await fs.readFile(filePath).catch(() => null);
      if (!contents || contents.includes(0)) patch = 'Binary or unreadable file.';
      else {
        const lines = contents.toString('utf8').split(/\r\n|\r|\n/);
        patch = `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
      }
    } else {
      patch = await this.run(root, ['diff', '--no-ext-diff', '--no-color',
        ...(staged ? ['--cached'] : []), '--', relative]);
    }
    return { path: relative, filePath, staged: Boolean(staged), patch };
  }

  async stage(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    const selected = this.relativePaths(state, candidates);
    await this.run(root, selected.length ? ['add', '--', ...selected] : ['add', '-A', '--', '.']);
    return this.status(state);
  }

  async unstage(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    const selected = this.relativePaths(state, candidates);
    const scope = selected.length ? selected : ['.'];
    try {
      await this.run(root, ['reset', '-q', 'HEAD', '--', ...scope]);
    } catch {
      await this.run(root, ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...scope]);
    }
    return this.status(state);
  }

  async discard(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const selected = this.absolutePaths(state, candidates);
    const changes = await this.status(state);
    const byPath = new Map(changes.changes.map((change) => [change.filePath, change]));
    const tracked: string[] = [];
    for (const filePath of selected) {
      const change = byPath.get(filePath);
      if (!change?.unstaged) continue;
      if (change.indexStatus === '?' && change.workingTreeStatus === '?') await this.trash(filePath);
      else tracked.push(this.paths.relative(state, filePath));
    }
    if (tracked.length) {
      await this.run(this.paths.root(state), ['restore', '--worktree', '--', ...tracked]);
    }
    return this.status(state);
  }

  async commit(state: WindowState, rawMessage: string): Promise<GitSnapshot> {
    const message = String(rawMessage).trim();
    if (!message) throw new Error('Enter a commit message.');
    await this.run(this.paths.root(state), ['commit', '-m', message]);
    return this.status(state);
  }

  async remote(state: WindowState, action: GitRemoteAction): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    if (action === 'fetch') await this.run(root, ['fetch', '--all', '--prune'], 30_000);
    else if (action === 'pull') await this.run(root, ['pull', '--ff-only'], 30_000);
    else if (action === 'push') await this.run(root, ['push'], 30_000);
    else if (action === 'sync') {
      await this.run(root, ['pull', '--ff-only'], 30_000);
      await this.run(root, ['push'], 30_000);
    } else throw new Error('Unknown Git remote action.');
    return this.status(state);
  }

  private absolutePaths(state: WindowState, candidates: string[]): string[] {
    return [...new Set((Array.isArray(candidates) ? candidates : [])
      .map((candidate) => this.paths.inside(state, String(candidate))))];
  }

  private relativePaths(state: WindowState, candidates: string[]): string[] {
    return this.absolutePaths(state, candidates).map((candidate) => this.paths.relative(state, candidate));
  }

  private async isRepository(root: string): Promise<boolean> {
    return this.output(root, ['rev-parse', '--is-inside-work-tree'])
      .then((value) => value === 'true', () => false);
  }

  private async output(root: string, args: string[]): Promise<string> {
    return (await this.run(root, args)).trim();
  }

  private async run(root: string, args: string[], timeout = 10_000): Promise<string> {
    try {
      const { stdout } = await exec('git', args, {
        cwd: root,
        encoding: 'utf8',
        timeout,
        maxBuffer: 2_000_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return stdout;
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new Error(failure.stderr?.trim() || failure.message || 'Git command failed.');
    }
  }
}
