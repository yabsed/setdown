import { GitPreferences } from './git-preferences';
import { gitSettings, type GitSettings } from '../../core/project/git-settings';
import { discoverRepositories } from './engines/git-repositories';
import { gitChangeGroups } from '../../core/project/git-change-groups';
import { isInside } from '../documents/file-system';
import { GitMetadataWatcher } from './engines/git-metadata-watcher';
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
  pendingChanges: 0,
};

type ParsedStatus = Omit<GitSnapshot, 'repository'>;

/** Turns unified patch runs into exact changed line ranges, excluding context lines. */
export function parseGitDiffHunks(patch: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let active: GitDiffHunk | null = null;
  let inHunk = false;
  const flush = () => {
    if (active && (active.oldLines > 0 || active.newLines > 0)) hunks.push(active);
    active = null;
  };
  for (const line of patch.split(/\r?\n/)) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      flush();
      inHunk = true;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (line.startsWith('diff --git ')) { flush(); inHunk = false; }
    if (!inHunk) continue;
    if (line.startsWith('-')) {
      active ??= { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0 };
      active.oldLines += 1;
      oldLine += 1;
    } else if (line.startsWith('+')) {
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
      if (record.endsWith('/')) continue;
      parsed.changes.push(change('??', record.slice(2)));
    } else {
      const ordinary = /^1 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const renamed = /^2 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const unmerged = /^u (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(record);
      const match = ordinary ?? renamed ?? unmerged;
      if (match) parsed.changes.push({ ...change(match[1], match[2]),
        ...(renamed ? { previousPath: records[index + 1] } : {}) });
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
    staged: !untracked && 'MADRC'.includes(indexStatus),
    unstaged: untracked || workingTreeStatus !== ' ',
    conflict,
  };
}

export class GitService {
  private readonly discoveries = new Map<string, { time: number; task: ReturnType<typeof discoverRepositories> }>();
  readonly watcher = new GitMetadataWatcher();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly preferences: GitPreferences;
  private readonly repositories = new Map<string, Promise<GitCli | null>>();

  constructor(
    private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath),
    preferencesFile?: () => string | null,
  ) { this.preferences = new GitPreferences(preferencesFile); }

  async status(state: WindowState, observe = true): Promise<GitSnapshot> {
    const explorerRoot = this.paths.root(state);
    const preferences = await this.preferences.get(explorerRoot), settings = preferences.settings;
    const discovery = await this.discover(explorerRoot, settings);
    if (preferences.parent === discovery.parent && discovery.parent) discovery.roots = [discovery.parent, ...discovery.roots];
    if (state.projectRoot !== explorerRoot) return { ...EMPTY, changes: [] };
    state.gitRepositories = discovery.roots;
    const visibleRoots = discovery.roots.filter(root => !preferences.hidden.includes(root));
    const selected = state.gitRoot && visibleRoots.includes(state.gitRoot) ? state.gitRoot : visibleRoots[0];
    state.gitRoot = selected ?? null;
    const errors = [...discovery.errors], repositories: GitCli[] = [];
    const results = new Map<string, ParsedStatus>();
    // A failed repository never discards successful snapshots or their counts.
    // Read the list and badge from the same bounded batch, including after edits.
    for (let offset = 0; offset < visibleRoots.length; offset += 4) {
      await Promise.all(visibleRoots.slice(offset, offset + 4).map(async root => {
        try {
          const repository = await this.repository(root);
          if (!repository) throw Error('Repository is no longer available.');
          repositories.push(repository);
          results.set(root, await this.readStatus(repository, settings));
        } catch (error) { errors.push({ root, command: 'git status --porcelain=v2 -z --branch --ahead-behind', message: String(error) }); }
      }));
    }
    if (state.projectRoot !== explorerRoot) return { ...EMPTY, changes: [] };
    if (observe) {
      if (repositories.length) void this.watcher.watch(state, repositories[0], repositories.slice(1));
      else this.watcher.unwatch(state.webContentsId);
    }
    const counted = settings.scmCountBadge === 'focused' ? (selected ? [selected] : []) : visibleRoots;
    const pendingChanges = settings.scmCountBadge === 'off' ? 0 : counted.reduce((sum, root) => sum + gitChangeGroups(results.get(root)?.changes, settings).badge, 0);
    const parsed = selected ? results.get(selected) : undefined;
    return {
      ...EMPTY, ...parsed, repository: discovery.roots.length > 0, root: selected,
      roots: discovery.roots, visibleRoots, settings, parentRepository: discovery.parent,
      discoveryLimited: discovery.limited, errors, selectedError: !!selected && !parsed,
      countIncomplete: settings.scmCountBadge !== 'off' && settings.countBadge !== 'off'
        && ((settings.scmCountBadge === 'all' && discovery.errors.length > 0)
          || errors.some(error => counted.includes(error.root)) || counted.some(root => results.get(root)?.statusLimited)),
      pendingChanges,
      changes: (parsed?.changes ?? []).map(change => ({ ...change, filePath: path.join(selected!, change.path) })),
    };
  }

  private async readStatus(repository: GitCli, settings: GitSettings): Promise<ParsedStatus> {
    const parsed = parseGitStatus(await repository.run([
      '--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--ahead-behind',
      `--untracked-files=${settings.untrackedChanges === 'hidden' ? 'no' : 'all'}`,
      `--find-renames=${settings.similarityThreshold}%`,
      ...(settings.ignoreSubmodules ? ['--ignore-submodules=all'] : []), '--', '.',
    ]));
    const limit = settings.statusLimit;
    if (parsed.changes.length > limit) { parsed.statusLimited = true; parsed.changes = parsed.changes.slice(0, limit); }
    return parsed;
  }

  async configure(state: WindowState, update: { settings?: Partial<GitSettings>; visibleRoots?: string[] }): Promise<GitSnapshot> {
    const root = this.paths.root(state), preferences = await this.preferences.get(root);
    const settings = gitSettings({ ...preferences.settings, ...update.settings });
    if (update.settings) {
      const changed = Object.fromEntries(Object.keys(update.settings).filter(key => key in settings)
        .map(key => [key, settings[key as keyof GitSettings]]));
      await this.preferences.set(root, { settings: { ...preferences.overrides, ...changed } });
    }
    if (update.visibleRoots) {
      const discovery = await this.discover(root, settings);
      await this.preferences.set(root, { hidden: discovery.roots.filter(candidate => !update.visibleRoots!.includes(candidate)) });
    }
    this.discoveries.clear();
    return this.status(state);
  }

  async initialize(state: WindowState): Promise<GitSnapshot> {
    const root = this.paths.root(state);
    await GitCli.run(root, ['init']);
    this.repositories.delete(root); this.discoveries.clear();
    return this.status(state);
  }

  async diff(state: WindowState, candidate: string, staged: boolean): Promise<GitDiff> {
    const preferences = await this.preferences.get(this.paths.root(state));
    const discovery = await this.discover(this.paths.root(state), preferences.settings);
    const roots = [...discovery.roots, ...(preferences.parent === discovery.parent && discovery.parent ? [discovery.parent] : [])];
    if (!path.isAbsolute(candidate) || !roots.some(root => isInside(root, candidate))) throw Error('The path is outside the open repositories.');
    // Deleted files can have deleted parents too. Resolve against discovered
    // repositories instead of using a possibly nonexistent directory as cwd.
    const root = roots.filter(root => isInside(root, candidate)).sort((a, b) => b.length - a.length)[0];
    const repository = await this.repository(root);
    if (!repository || !roots.includes(root)) throw new Error('The file is not in an open Git repository.');
    const filePath = this.paths.entry({ ...state, projectRoot: root }, candidate);
    const relative = path.relative(root, filePath);
    const repositoryRelative = path.relative(repository.repositoryRoot, filePath).split(path.sep).join('/');
    const change = (await this.status({ ...state, gitRoot: root }, false)).changes.find((item) => item.filePath === filePath);
    if (change?.conflict) staged = false;
    const originalPath = change?.previousPath === undefined ? repositoryRelative
      : path.relative(repository.repositoryRoot, path.resolve(root, change.previousPath)).split(path.sep).join('/');
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
        ...(staged ? ['--cached'] : []), '--', relative,
        ...(staged && change?.previousPath ? [change.previousPath] : [])]);
    }
    const originalText = staged
      ? await readGitDocument(repository, `HEAD:${originalPath}`, filePath)
      : change?.indexStatus === '?' ? '' : await readGitDocument(repository, `${change?.conflict ? ':2:' : ':'}${repositoryRelative}`, filePath);
    const modifiedText = staged
      ? await readGitDocument(repository, `:${repositoryRelative}`, filePath)
      : await readWorkingDocument(filePath);
    return {
      path: relative,
      filePath,
      staged: Boolean(staged),
      patch,
      ...(change?.conflict ? { conflict: {
        base: await readGitDocument(repository, `:1:${repositoryRelative}`, filePath),
        ours: originalText,
        theirs: await readGitDocument(repository, `:3:${repositoryRelative}`, filePath),
      } } : {}),
      originalText,
      modifiedText,
      originalLabel: change?.conflict ? 'OURS (unresolved conflict)' : staged ? 'HEAD' : change?.indexStatus === '?' ? 'EMPTY' : 'INDEX',
      modifiedLabel: staged ? 'INDEX' : 'WORKTREE',
      hunks: parseGitDiffHunks(patch),
    };
  }

  stage(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    return this.mutate(state, captured => this.stageOperation(captured, candidates));
  }

  private async stageOperation(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const root = (await this.requireRepository(state)).repositoryRoot;
    const selected = this.relativePaths({ ...state, projectRoot: root }, candidates);
    await this.run(root, selected.length ? ['add', '--', ...selected] : ['add', '-A', '--', '.']);
    return this.status(state, false);
  }

  unstage(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    return this.mutate(state, captured => this.unstageOperation(captured, candidates));
  }

  private async unstageOperation(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const root = (await this.requireRepository(state)).repositoryRoot;
    const selected = this.relativePaths({ ...state, projectRoot: root }, candidates);
    const changes = (await this.status(state)).changes;
    for (const change of changes) {
      if (change.previousPath && selected.includes(change.path)) selected.push(change.previousPath);
    }
    const scope = selected.length ? [...new Set(selected)] : ['.'];
    const repository = await this.requireRepository(state);
    if (await repository.objectExists('HEAD'))
      await repository.run(['reset', '-q', 'HEAD', '--', ...scope]);
    else await repository.run(['rm', '-r', '--cached', '--ignore-unmatch', '--', ...scope]);
    return this.status(state, false);
  }

  discard(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    return this.mutate(state, captured => this.discardOperation(captured, candidates));
  }

  private async discardOperation(state: WindowState, candidates: string[]): Promise<GitSnapshot> {
    const root = (await this.requireRepository(state)).repositoryRoot;
    const selected = this.absolutePaths({ ...state, projectRoot: root }, candidates);
    const changes = await this.status(state);
    const byPath = new Map(changes.changes.map((change) => [change.filePath, change]));
    const tracked: string[] = [];
    for (const filePath of selected) {
      const change = byPath.get(filePath);
      if (!change?.unstaged) continue;
      if (change.indexStatus === '?' && change.workingTreeStatus === '?') await this.trash(filePath);
      else tracked.push(path.relative(root, filePath));
    }
    if (tracked.length) await this.run(root, ['restore', '--worktree', '--', ...tracked]);
    return this.status(state, false);
  }

  commit(state: WindowState, rawMessage: string): Promise<GitSnapshot> {
    return this.mutate(state, captured => this.commitOperation(captured, rawMessage));
  }

  private async commitOperation(state: WindowState, rawMessage: string): Promise<GitSnapshot> {
    const message = String(rawMessage).trim();
    if (!message) throw new Error('Enter a commit message.');
    await this.run(state.gitRoot ?? this.paths.root(state), ['commit', '-m', message]);
    return this.status(state, false);
  }

  remote(state: WindowState, action: GitRemoteAction): Promise<GitSnapshot> {
    return this.mutate(state, captured => this.remoteOperation(captured, action));
  }

  private async remoteOperation(state: WindowState, action: GitRemoteAction): Promise<GitSnapshot> {
    const root = state.gitRoot ?? this.paths.root(state);
    if (action === 'fetch') await this.run(root, ['fetch', '--all', '--prune'], 30_000);
    else if (action === 'pull') await this.run(root, ['pull', '--ff-only'], 30_000);
    else if (action === 'push') await this.run(root, ['push'], 30_000);
    else if (action === 'sync') {
      await this.run(root, ['pull', '--ff-only'], 30_000);
      try { await this.run(root, ['push'], 30_000); }
      catch (error) { throw new Error(`Pull completed, but push failed. Local commits are preserved. ${String(error)}`); }
    } else throw new Error('Unknown Git remote action.');
    return this.status(state, false);
  }

  async select(state: WindowState, root: string): Promise<GitSnapshot> {
    const open = this.paths.root(state), preferences = await this.preferences.get(open);
    this.discoveries.clear();
    const discovery = await this.discover(open, preferences.settings);
    if (state.projectRoot !== open || (!discovery.roots.includes(root) && discovery.parent !== root)) throw Error('Choose a repository in the open folder.');
    await this.preferences.set(open, { hidden: preferences.hidden.filter(candidate => candidate !== root),
      ...(root === discovery.parent ? { parent: root } : {}) });
    this.watcher.unwatch(state.webContentsId); state.gitRoot = root;
    return this.status(state);
  }
  private discover(root: string, settings: GitSettings): ReturnType<typeof discoverRepositories> {
    const key = JSON.stringify([root, settings]);
    let entry = this.discoveries.get(key);
    if (!entry || Date.now() - entry.time > 60_000) {
      entry = { time: Date.now(), task: discoverRepositories(root, settings) }; this.discoveries.set(key, entry);
      const task = entry.task;
      void task.then(discovery => {
        if (!discovery.roots.length && this.discoveries.get(key)?.task === task) this.discoveries.delete(key);
      }, () => { if (this.discoveries.get(key)?.task === task) this.discoveries.delete(key); });
    }
    return entry.task.then(discovery => ({ ...discovery, roots: [...discovery.roots] }));
  }

  private async mutate(state: WindowState, action: (state: WindowState) => Promise<GitSnapshot>): Promise<GitSnapshot> {
    const captured = { ...state };
    const root = (await this.requireRepository(captured)).repositoryRoot;
    const task = (this.mutations.get(root) ?? Promise.resolve()).catch(() => {}).then(() => action(captured));
    this.mutations.set(root, task);
    try { return await task; } finally { if (this.mutations.get(root) === task) this.mutations.delete(root); }
  }

  private async requireRepository(state: WindowState): Promise<GitCli> {
    const repository = await this.repository(state.gitRoot ?? this.paths.root(state));
    if (!repository) throw new Error('The open folder is not a Git repository.');
    const open = this.paths.root(state), preferences = await this.preferences.get(open);
    if (repository.repositoryRoot !== open && isInside(repository.repositoryRoot, open) && preferences.parent !== repository.repositoryRoot
      && preferences.settings.openRepositoryInParentFolders !== 'always') throw Error('Open the parent repository before changing it.');
    return repository;
  }

  private absolutePaths(state: WindowState, candidates: string[]): string[] {
    return [...new Set((Array.isArray(candidates) ? candidates : [])
      .map((candidate) => this.paths.entry(state, String(candidate))))];
  }

  private relativePaths(state: WindowState, candidates: string[]): string[] {
    return this.absolutePaths(state, candidates).map((candidate) => path.relative(this.paths.root(state), candidate));
  }

  private repository(root: string): Promise<GitCli | null> {
    const cached = this.repositories.get(root);
    if (cached) return cached;
    const repository = GitCli.connect(root).then(value => {
      if (!value && this.repositories.get(root) === repository) this.repositories.delete(root);
      return value;
    }).catch(error => { this.repositories.delete(root); throw error; });
    this.repositories.set(root, repository);
    return repository;
  }

  private async run(root: string, args: string[], timeout?: number): Promise<string> {
    const repository = await this.repository(root);
    if (!repository) throw new Error('The open folder is not a Git repository.');
    return repository.run(args, timeout);
  }
}
