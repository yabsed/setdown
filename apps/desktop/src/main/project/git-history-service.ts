import path from 'node:path';
import { LocalGitBackend } from '@web-git-graph/node';
import type { GitGraphRevision } from '@web-git-graph/protocol';
import type { GitDiff } from '../../protocol/desktop-api';
import type { GitGraphRequest, GitHistorySelection } from '../../protocol/git-history';
import { decodeTextBytes, MAX_TEXT_FILE_BYTES } from '../../core/document/text-codec';
import { isTextCandidate } from '../../core/document/document-profile';
import { textDiffHunks } from '../../core/diff/text-diff';
import type { WindowState } from '../windows/window-state';
import { GitCli } from './engines/git-cli';

const oid = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function revision(value: GitGraphRevision): void {
  if (!value || !['commit', 'stash'].includes(value.kind) || !('oid' in value) || !oid(value.oid)) {
    throw new Error('A full commit ID is required.');
  }
}
function relativePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')
    || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
    || value.split('/').some((part) => part === '..' || part === '.')) throw new Error('Invalid repository path.');
}
type Session = {
  root: string; backend: Promise<{ backend: LocalGitBackend; git: GitCli }>;
  requests: Map<string, AbortController>;
};

/** Owns window/repository lifetime and IPC validation, not Git history algorithms. */
export class GitHistoryService {
  private readonly sessions = new WeakMap<WindowState, Session>();

  cancel(state: WindowState, id: unknown): void {
    if (typeof id === 'string') this.sessions.get(state)?.requests.get(id)?.abort();
  }

  private session(state: WindowState, root: string): Session {
    if (!root || root !== state.projectRoot) throw new Error('The open repository changed.');
    const old = this.sessions.get(state);
    if (old?.root === root) return old;
    if (old) for (const controller of old.requests.values()) controller.abort();
    const session: Session = { root, requests: new Map(), backend: GitCli.connect(root).then((git) => {
      if (!git) throw new Error('The folder is not a Git repository.');
      return { git, backend: new LocalGitBackend({ repositories: { current: git.repositoryRoot },
        allowedRoots: [git.repositoryRoot], maxPageSize: 100, maxConcurrency: 3,
        maxDiffBytes: MAX_TEXT_FILE_BYTES, timeoutMs: 10_000 }) };
    }) };
    this.sessions.set(state, session);
    if (!old) state.window.once('closed', () => {
      for (const controller of this.sessions.get(state)?.requests.values() ?? []) controller.abort();
      this.sessions.delete(state);
    });
    return session;
  }

  async request(state: WindowState, request: GitGraphRequest) {
    if (!request || typeof request.id !== 'string' || request.id.length > 100 || !request.params
      || typeof request.params !== 'object') throw new Error('Invalid graph request.');
    const session = this.session(state, request.root);
    if (session.requests.has(request.id) || session.requests.size >= 16) throw new Error('Too many graph requests.');
    const controller = new AbortController();
    session.requests.set(request.id, controller);
    try {
      const { backend } = await session.backend;
      controller.signal.throwIfAborted();
      if (state.projectRoot !== request.root) throw new Error('The open repository changed.');
      switch (request.method) {
        case 'capabilities': return { ...await backend.getCapabilities(), workingTree: false };
        case 'history': {
          const q = request.params;
          if ((q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100))
            || (q.cursor !== undefined && (typeof q.cursor !== 'string' || q.cursor.length > 2048))
            || (q.ref !== undefined && typeof q.ref !== 'string')
            || (q.refs !== undefined && (!Array.isArray(q.refs) || q.refs.length > 100
              || q.refs.some((ref) => typeof ref !== 'string' || ref.length > 1024)))) throw new Error('Invalid history query.');
          return await backend.getHistory('current', { ...q, includeWorkingTree: false }, controller.signal);
        }
        case 'details': revision(request.params.revision);
          return await backend.getCommitDetails('current', request.params.revision, controller.signal);
        case 'compare': revision(request.params.base); revision(request.params.head);
          return await backend.compare('current', request.params.base, request.params.head, controller.signal);
        case 'diff': revision(request.params.base); revision(request.params.head); relativePath(request.params.path);
          return await backend.getFileDiff('current', request.params.base, request.params.head, request.params.path, 3, controller.signal);
        default: throw new Error('Unknown graph operation.');
      }
    } finally { session.requests.delete(request.id); }
  }

  async diff(state: WindowState, selection: GitHistorySelection): Promise<GitDiff> {
    if (!selection || !oid(selection.head) || (selection.base !== undefined && !oid(selection.base))) {
      throw new Error('Invalid commit comparison.');
    }
    relativePath(selection.path);
    const { backend, git } = await this.session(state, selection.root).backend;
    const head = { kind: 'commit' as const, oid: selection.head };
    const details = await backend.getCommitDetails('current', head);
    const baseOid = selection.base ?? details.commit.parents[0];
    const changes = selection.base
      ? (await backend.compare('current', { kind: 'commit', oid: selection.base }, head)).changes : details.changes;
    const change = changes.find((item) => item.path === selection.path);
    if (!change) throw new Error('The file is not part of this comparison.');
    relativePath(change.previousPath ?? change.path);
    const filePath = path.join(git.repositoryRoot, change.path);
    const read = async (commit: string | undefined, file: string, missing: boolean): Promise<string | null> => {
      if (!commit || missing) return '';
      if (change.binary || !isTextCandidate(file)) return null;
      // Keep Setdown's bounded, strict byte decoding instead of silently showing
      // an upstream truncated/UTF-8-replaced string as the complete document.
      return decodeTextBytes(await git.runBytes(['show', `${commit}:${file}`])).text;
    };
    const [originalText, modifiedText] = await Promise.all([
      read(baseOid, change.previousPath ?? change.path, change.kind === 'add'),
      read(selection.head, change.path, change.kind === 'delete'),
    ]);
    if (state.projectRoot !== selection.root) throw new Error('The open repository changed.');
    return { path: change.path, filePath, staged: false, history: selection, patch: '',
      originalText, modifiedText, originalLabel: baseOid?.slice(0, 8) ?? 'EMPTY', modifiedLabel: selection.head.slice(0, 8),
      hunks: originalText !== null && modifiedText !== null ? textDiffHunks(originalText, modifiedText) : [] };
  }
}
