import path from 'node:path';
import { shell } from 'electron';
import type {
  GitChange,
  GitDiff,
  GitDiffHunk,
  GitRemoteAction,
  GitSnapshot,
} from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import { GitCli } from './engines/git-cli';
import { ProjectPaths } from './project-paths';
import { readGitDocument, readWorkingDocument } from './git-text';

const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const EMPTY: GitSnapshot = {
  repository: false,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  changes: [],
};

type ParsedStatus = Omit<GitSnapshot, 'repository'>;

/** Turns unified patch runs into exact changed line ranges, excluding context lines. */
export function parseGitDiffHunks(patch: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let active: GitDiffHunk | null = null;
  const flush = () => {
    if (active && (active.oldLines > 0 || active.newLines > 0)) hunks.push(active);
    active = null;
  };
  for (const line of patch.split(/\r?\n/)) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      flush();
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (!oldLine && !newLine) continue;
    if (line.startsWith('-') && !line.startsWith('---')) {
      active ??= { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0 };
      active.oldLines += 1;
      oldLine += 1;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      active ??= { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0 };
      active.newLines += 1;
      newLine += 1;
    } else if (line.startsWith(' ')) {
      flush();
      oldLine += 1;
      newLine += 1;
    }
  }
  flush();
  return hunks;
}

/** Parses Git's stable porcelain-v2 NUL protocol; filenames are never guessed or unquoted. */
export function parseGitStatus(output: string): ParsedStatus {
  const parsed: ParsedStatus = { branch: 'HEAD', upstream: '', ahead: 0, behind: 0, changes: [] };
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith('# branch.head ')) parsed.branch = record.slice(14) || 'HEAD';
    else if (record.startsWith('# branch.upstream ')) parsed.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      parsed.ahead = Number(match?.[1] ?? 0);
      parsed.behind = Number(match?.[2] ?? 0);
    } else if (record.startsWith('? ')) {
      parsed.changes.push(change('??', record.slice(2)));
    } else {
      const ordinary = /^1 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const renamed = /^2 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const unmerged = /^u (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const match = ordinary ?? renamed ?? unmerged;
      if (match) parsed.changes.push(change(match[1], match[2]));
      if (renamed) index += 1;
    }
  }
  return parsed;
}

function change(rawCode: string, changePath: string): GitChange {
  const code = rawCode.replaceAll('.', ' ');
  const indexStatus = code[0] ?? ' ';
  const workingTreeStatus = code[1] ?? ' ';
  const untracked = code === '??';
  const conflict = CONFLICTS.has(code);
  return {
    path: changePath,
    filePath: '',
    status: conflict ? '!' : untracked ? 'U'
      : workingTreeStatus !== ' ' ? workingTreeStatus : indexStatus.trim() || '?',
    indexStatus,
    workingTreeStatus,
    staged: !untracked && indexStatus !== ' ' && indexStatus !== '?',
    unstaged: untracked || workingTreeStatus !== ' ',
    conflict,
  };
}

export class GitService {
  private readonly repositories = new Map<string, Promise<GitCli | null>>();

  constructor(
    private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath),
  ) {}

  async status(state: WindowState): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    const repository = await this.repository(root);
    if (!repository) return { ...EMPTY, changes: [] };
    // Read without rewriting .git/index and retriggering the project watcher.
    const parsed = parseGitStatus(await repository.run([
      '--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--ahead-behind',
      '--untracked-files=all', '--', '.',
    ]));
    return {
      repository: true,
      ...parsed,
      changes: parsed.changes.map((change) => {
        const filePath = path.join(repository.repositoryRoot, change.path);
        return { ...change, path: path.relative(root, filePath), filePath };
      }),
    };
  }

  async initialize(state: WindowState): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    await GitCli.run(root, ['init']);
    this.repositories.delete(root);
    return this.status(state);
  }

  async diff(state: WindowState, candidate: string, staged: boolean): Promise<GitDiff> {
    const root = this.paths.root(state);
    const repository = await this.repository(root);
    if (!repository) throw new Error('The open folder is not a Git repository.');
    const filePath = this.paths.inside(state, candidate);
    const relative = this.paths.relative(state, filePath);
    const repositoryRelative = path.relative(repository.repositoryRoot, filePath).split(path.sep).join('/');
    const change = (await this.status(state)).changes.find((item) => item.filePath === filePath);
    let patch: string;
    if (!staged && change?.indexStatus === '?' && change.workingTreeStatus === '?') {
      const text = await readWorkingDocument(filePath);
      if (text === null) patch = 'Binary or unreadable file.';
      else {
        const lines = text.split(/\r\n|\r|\n/);
        patch = `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
      }
    } else {
      patch = await this.run(root, ['diff', '--no-ext-diff', '--no-color',
        ...(staged ? ['--cached'] : []), '--', relative]);
    }
    const originalText = staged
      ? await readGitDocument(repository, `HEAD:${repositoryRelative}`, filePath)
      : change?.indexStatus === '?' ? '' : await readGitDocument(repository, `:${repositoryRelative}`, filePath);
    const modifiedText = staged
      ? await readGitDocument(repository, `:${repositoryRelative}`, filePath)
      : await readWorkingDocument(filePath);
    return {
      path: relative,
      filePath,
      staged: Boolean(staged),
      patch,
      originalText,
      modifiedText,
      originalLabel: staged ? 'HEAD' : change?.indexStatus === '?' ? 'EMPTY' : 'INDEX',
      modifiedLabel: staged ? 'INDEX' : 'WORKTREE',
      hunks: parseGitDiffHunks(patch),
    };
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
    if (tracked.length) await this.run(this.paths.root(state), ['restore', '--worktree', '--', ...tracked]);
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

  private repository(root: string): Promise<GitCli | null> {
    const cached = this.repositories.get(root);
    if (cached) return cached;
    const repository = GitCli.connect(root);
    this.repositories.set(root, repository);
    return repository;
  }

  private async run(root: string, args: string[], timeout?: number): Promise<string> {
    const repository = await this.repository(root);
    if (!repository) throw new Error('The open folder is not a Git repository.');
    return repository.run(args, timeout);
  }
}
