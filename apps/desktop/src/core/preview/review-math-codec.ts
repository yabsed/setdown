import { mathIslands, replaceMathIslands } from './math-islands';

const ATTRIBUTE = 'data-setdown-opaque-math';
const PREFIX = 128;
const TOKEN = /<span class="katex" data-setdown-opaque-math="(m\d+)">[^<]*<\/span>/g;
export type PackedReviewMath = {
  documents: string[];
  restore(value: string): string;
  expandedLength(value: string): number;
};

/** Exact-output interning, NOT a LaTeX cache. No hashes/collisions or macro assumptions.
 * Eviction never recycles IDs: an old page can miss, but cannot falsely match.
 * Tokens are worker-private and MUST be expanded before crossing into the DOM.
 */
export class ReviewMathCodec {
  private readonly entries = new Map<string, { id: string; bytes: number }>();
  private readonly prefixes = new Map<string, Set<string>>();
  private sequence = 0;
  private bytes = 0;
  constructor(private readonly maxBytes = 8 * 1024 * 1024, private readonly maxEntries = 1024) {}
  get retainedBytes(): number { return this.bytes; }
  get entryCount(): number { return this.entries.size; }

  pack(html: string) {
    const packed = this.packMany([html]);
    return packed ? { ...packed, html: packed.documents[0] } : null;
  }

  packMany(inputs: string[], preserveText = false): PackedReviewMath | null {
    // Authored lookalike tokens must never be interpreted as internal handles.
    if (inputs.some((html) => html.includes(ATTRIBUTE))) return null;
    const exact = new Map<string, string>();
    const payloads = new Map<string, string>();
    const projections = new Map<string, string>();
    const documents: string[] = [];
    for (const html of inputs) {
      const found = mathIslands(html, (offset) => {
        const bucket = this.prefixes.get(html.slice(offset, offset + PREFIX));
        // An adversarial common prefix must not turn scanning into quadratic work.
        if (!bucket || bucket.size > 16) return undefined;
        for (const value of bucket) if (html.startsWith(value, offset)) return value;
        return undefined;
      });
      if (found === null) return null;
      // Match the existing inline highlighter's double-quoted class detection.
      // Authored single-quoted/uppercase variants retain their legacy path.
      const islands = preserveText ? found.filter((island) =>
        /\bclass="[^"]*\b(?:katex|MathJax)\b/.test(island.html.slice(0, island.html.indexOf('>') + 1))) : found;
      for (const island of islands) {
        if (exact.has(island.html)) continue;
        const id = this.intern(island.html);
        // Alignment uses this exact tag-stripped text, including entities. Keep
        // its token sequence, but never expose those tokens to inline emphasis.
        const projection = preserveText ? island.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '';
        if (projection.includes('<')) return null;
        exact.set(island.html, id); payloads.set(id, island.html); projections.set(id, projection);
      }
      documents.push(replaceMathIslands(html, islands, (island) => {
        const id = exact.get(island.html)!;
        return `<span class="katex" ${ATTRIBUTE}="${id}">${projections.get(id)}</span>`;
      }));
    }
    const payload = (id: string) => {
      const value = payloads.get(id);
      if (value === undefined) throw new Error('Unknown opaque review math.');
      return value;
    };
    return { documents,
      restore: (value) => value.replace(TOKEN, (_token, id: string) => payload(id)),
      expandedLength(value) {
        let length = value.length;
        for (const match of value.matchAll(TOKEN)) length += payload(match[1]).length - match[0].length;
        return length;
      },
    };
  }

  private intern(html: string): string {
    const existing = this.entries.get(html);
    if (existing) {
      this.entries.delete(html); this.entries.set(html, existing); return existing.id;
    }
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Review math identity exhausted.');
    const id = `m${++this.sequence}`;
    const bytes = 2 * (html.length + id.length);
    if (bytes <= this.maxBytes && this.maxEntries > 0) {
      this.entries.set(html, { id, bytes }); this.bytes += bytes;
      if (html.length >= PREFIX) {
        const key = html.slice(0, PREFIX); const bucket = this.prefixes.get(key) ?? new Set<string>();
        bucket.add(html); this.prefixes.set(key, bucket);
      }
      while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
        const key = oldest.slice(0, PREFIX); const bucket = this.prefixes.get(key);
        bucket?.delete(oldest); if (bucket?.size === 0) this.prefixes.delete(key);
      }
    }
    return id;
  }
}
