import type { GitGraphPage } from '@web-git-graph/protocol';
import type { GitGraphProvider, WebGitGraphElement } from '@web-git-graph/web';
import { sameRefs } from './git-graph-presentation';

/** Compare visible history, not the backend's newly allocated paging cursor. */
export function sameHistory(current: GitGraphPage, first: GitGraphPage): boolean {
  return current.head === first.head && current.repositoryId === first.repositoryId
    && current.repositoryName === first.repositoryName
    && (current.commits.length > first.commits.length ? first.hasMore
      : current.commits.length === first.commits.length && current.hasMore === first.hasMore)
    && JSON.stringify(current.commits.slice(0, first.commits.length)) === JSON.stringify(first.commits)
    && JSON.stringify(current.refs) === JSON.stringify(first.refs);
}

/**
 * 1.0.7's refresh rebuilds rows even for an identical page. Check offscreen
 * first, retaining DOM, focus, comparisons and loaded pages for no-op updates.
 * Actual history changes still use upstream's public, view-preserving refresh.
 */
export class GitGraphRefresh {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly lifetime = new AbortController();
  private reading = false;
  private pending = false;
  private applying = false;

  constructor(
    private readonly graph: WebGitGraphElement,
    private readonly provider: Pick<GitGraphProvider, 'getHistory'>,
    private readonly reportError: (error: unknown) => void,
  ) {
    graph.addEventListener('gitgraph-refresh', this.onRefresh);
  }

  private readonly onRefresh = (event: Event) => {
    if (this.applying) return;
    event.preventDefault();
    this.request();
  };

  request(): void {
    if (this.lifetime.signal.aborted) return;
    this.pending = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 300);
  }

  dispose(): void {
    this.lifetime.abort();
    clearTimeout(this.timer);
    this.graph.removeEventListener('gitgraph-refresh', this.onRefresh);
  }

  private async check(): Promise<void> {
    if (this.lifetime.signal.aborted || this.reading || !this.pending) return;
    // Never abort an upstream filter change or a load-more request.
    if (this.graph.getAttribute('aria-busy') === 'true') { this.request(); return; }
    this.pending = false;
    this.reading = true;
    const current = this.graph.data, refs = [...this.graph.refs];
    try {
      let first = await this.provider.getHistory({ refs, signal: this.lifetime.signal });
      // Renew the cursor at the loaded depth, including additional pages. A
      // retained backend snapshot otherwise expires while the graph is idle.
      while (!this.lifetime.signal.aborted && this.graph.data === current
        && sameRefs(refs, this.graph.refs) && first.hasMore
        && first.commits.length < current.commits.length && sameHistory(current, first)) {
        const next = await this.provider.getHistory({ refs, cursor: first.cursor, signal: this.lifetime.signal });
        const seen = new Set(first.commits.map(commit => commit.oid));
        first = { ...next, commits: [...first.commits, ...next.commits.filter(commit => !seen.has(commit.oid))] };
      }
      if (this.lifetime.signal.aborted) return;
      if (this.graph.data !== current || !sameRefs(refs, this.graph.refs)
        || this.graph.getAttribute('aria-busy') === 'true') {
        this.request();
        return;
      }
      if (!sameHistory(current, first)) {
        this.applying = true;
        try { this.graph.refresh(); } finally { this.applying = false; }
      } else {
        // data is the public page object. Updating only its transport cursor
        // avoids setData(), which resets selection and scroll even on a no-op.
        current.cursor = first.cursor;
      }
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.reportError(error);
    } finally {
      this.reading = false;
      if (this.pending && !this.lifetime.signal.aborted) this.request();
    }
  }
}
