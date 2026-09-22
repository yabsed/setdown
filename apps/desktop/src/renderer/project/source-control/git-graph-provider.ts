import type { GitGraphHistoryRequest, GitGraphProvider } from '@web-git-graph/web';
import type { GitGraphRevision } from '@web-git-graph/protocol';
import type { GitGraphMethods, GitGraphRequest } from '../../../protocol/git-history';
import type { DesktopPort } from '../../ports/desktop-port';

/** Mirrors upstream's VS Code provider using our window-scoped Electron port. */
export class ElectronGitGraphProvider implements GitGraphProvider {
  private readonly lifetime = new AbortController();
  constructor(private readonly desktop: DesktopPort, readonly root: string) {}
  dispose(): void { this.lifetime.abort(); }

  private call<M extends keyof GitGraphMethods>(method: M, params: GitGraphMethods[M]['params'], signal?: AbortSignal): Promise<GitGraphMethods[M]['result']> {
    const combined = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    if (combined.aborted) return Promise.reject(new DOMException('Graph closed.', 'AbortError'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.desktop.cancelGitGraph(id);
        reject(new DOMException('Graph request canceled.', 'AbortError'));
      };
      combined.addEventListener('abort', abort, { once: true });
      this.desktop.requestGitGraph({ id, root: this.root, method, params } as GitGraphRequest)
        .then((result) => { if (!combined.aborted) resolve(result as GitGraphMethods[M]['result']); }, reject)
        .finally(() => combined.removeEventListener('abort', abort));
    });
  }
  getCapabilities(signal?: AbortSignal) { return this.call('capabilities', {}, signal); }
  async getHistory(request: GitGraphHistoryRequest = {}) {
    const { signal, repositoryId: _repositoryId, ...query } = request;
    const page = await this.call('history', { ...query, limit: Math.min(query.limit ?? 100, 100), includeWorkingTree: false }, signal);
    if (!request.refs?.length) return page;
    // The web component caps badges before painting. Put selected refs first
    // so the Auto pair remains visible even at a tip with many other refs.
    const priority = new Map(request.refs.map((ref, index) => [ref, index]));
    return { ...page, refs: [...page.refs].sort((left, right) =>
      (priority.get(left.name) ?? (left.kind === 'current' ? -1 : Infinity)) -
      (priority.get(right.name) ?? (right.kind === 'current' ? -1 : Infinity))) };
  }
  getCommitDetails(_repository: string | undefined, revision: GitGraphRevision, signal?: AbortSignal) {
    return this.call('details', { revision }, signal);
  }
  compare(_repository: string | undefined, base: GitGraphRevision, head: GitGraphRevision, signal?: AbortSignal) {
    return this.call('compare', { base, head }, signal);
  }
  getFileDiff(_repository: string | undefined, base: GitGraphRevision, head: GitGraphRevision, path: string, _context?: number, signal?: AbortSignal) {
    return this.call('diff', { base, head, path }, signal);
  }
}
