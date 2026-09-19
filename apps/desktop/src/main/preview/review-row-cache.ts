import { diffReviewRows, readReviewRows, type ReviewRows, type ReviewRowsPatch }
  from '../../core/preview/review-row-patch';

type Snapshot = { revision: number; rows: ReviewRows; bytes: number };
export type ReviewRowUpdate = { html?: string; patch?: ReviewRowsPatch };

/** Worker-local bounded per-page snapshots. A missing/unacknowledged base means full reset. */
export class ReviewRowCache {
  private readonly pages = new Map<string, Snapshot>();
  private bytes = 0;
  constructor(private readonly maxPages = 16, private readonly maxBytes = 64 * 1024 * 1024) {}

  update(pageKey: string, baseRevision: number | null, revision: number, html: string): ReviewRowUpdate {
    const previous = this.pages.get(pageKey);
    const rows = readReviewRows(html);
    let result: ReviewRowUpdate = { html };
    if (previous && previous.revision === baseRevision) {
      const patch = diffReviewRows(previous.rows, rows, previous.revision, revision);
      // A large paste/restructure can be cheaper as a full hidden-page install.
      // Ordinary local edits transfer only changed rows plus compact source shifts.
      if (JSON.stringify(patch).length < html.length) result = { patch };
    }
    this.forget(pageKey);
    const bytes = 2 * (rows.split.reduce((sum, row) => sum + row.length, 0)
      + rows.unified.reduce((sum, row) => sum + row.length, 0) + pageKey.length);
    if (this.maxPages > 0 && bytes <= this.maxBytes) {
      this.pages.set(pageKey, { revision, rows, bytes });
      this.bytes += bytes;
      while (this.pages.size > this.maxPages || this.bytes > this.maxBytes) {
        this.forget(this.pages.keys().next().value!);
      }
    }
    // The next request includes the page's acknowledged base revision. Advancing
    // this cache speculatively is safe: a lost/failed install cannot match that base.
    return result;
  }

  /** Both resident pages can start with the same immutable baseline, without re-rendering it. */
  seed(sourceKey: string, targetKey: string, revision: number): void {
    const source = this.pages.get(sourceKey);
    if (!source || source.revision !== revision || this.pages.has(targetKey) || this.maxPages <= 1) return;
    this.pages.set(targetKey, source);
    this.bytes += source.bytes; // Conservative accounting even though row strings are shared.
    while (this.pages.size > this.maxPages || this.bytes > this.maxBytes) {
      this.forget(this.pages.keys().next().value!);
    }
  }

  forget(pageKey: string): void {
    const previous = this.pages.get(pageKey);
    if (previous) { this.bytes -= previous.bytes; this.pages.delete(pageKey); }
  }
}
