import { diffReviewRows, readReviewRows, type ReviewRows, type ReviewRowsPatch }
  from '../../core/preview/review-row-patch';

import { ReviewMathCodec, type PackedReviewMath } from '../../core/preview/review-math-codec';

type Snapshot = { revision: number; rows: ReviewRows; bytes: number; compact: boolean };
export type ReviewRowUpdate = { html?: string; patch?: ReviewRowsPatch };

/** Worker-local bounded per-page snapshots. A missing/unacknowledged base means full reset. */
export class ReviewRowCache {
  private readonly pages = new Map<string, Snapshot>();
  private bytes = 0;
  private readonly math = new ReviewMathCodec();
  constructor(private readonly maxPages = 16, private readonly maxBytes = 64 * 1024 * 1024) {}

  prepareMath(original: string, modified: string): PackedReviewMath | null {
    return this.math.packMany([original, modified], true);
  }

  update(pageKey: string, baseRevision: number | null, revision: number, html: string, inputMath?: PackedReviewMath | null): ReviewRowUpdate {
    const previous = this.pages.get(pageKey);
    const packed = inputMath ? { ...inputMath, html } : this.math.pack(html);
    const rows = readReviewRows(packed?.html ?? html);
    let result: ReviewRowUpdate | null = null;
    if (previous && previous.revision === baseRevision && previous.compact === (packed !== null)) {
      const patch = diffReviewRows(previous.rows, rows, previous.revision, revision);
      if (packed) {
        // Only changed rows are expanded; retained snapshots never contain the
        // giant math DOM. The browser still receives ordinary sanitized HTML.
        for (const tree of [patch.unified, patch.split]) {
          for (const splice of tree.splices) splice.rows = splice.rows.map(packed.restore);
        }
      }
      // A large paste/restructure can be cheaper as a full hidden-page install.
      // Ordinary local edits transfer only changed rows plus compact source shifts.
      if (JSON.stringify(patch).length < (packed?.expandedLength(packed.html) ?? html.length)) result = { patch };
    }
    this.forget(pageKey);
    const bytes = 2 * (rows.split.reduce((sum, row) => sum + row.length, 0)
      + rows.unified.reduce((sum, row) => sum + row.length, 0) + pageKey.length);
    if (this.maxPages > 0 && bytes <= this.maxBytes) {
      this.pages.set(pageKey, { revision, rows, bytes, compact: packed !== null });
      this.bytes += bytes;
      while (this.pages.size > this.maxPages || this.bytes > this.maxBytes) {
        this.forget(this.pages.keys().next().value!);
      }
    }
    // The next request includes the page's acknowledged base revision. Advancing
    // this cache speculatively is safe: a lost/failed install cannot match that base.
    return result ?? { html: packed ? packed.restore(packed.html) : html };
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
