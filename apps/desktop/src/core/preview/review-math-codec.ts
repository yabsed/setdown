import { mathIslands, replaceMathIslands } from './math-islands';

const ATTRIBUTE = 'data-setdown-opaque-math';
const TOKEN = /<span data-setdown-opaque-math="(m\d+)"><\/span>/g;

/** Exact-output interning, NOT a LaTeX cache. No hashes/collisions or macro assumptions.
 * Eviction never recycles IDs: an old page can miss, but cannot falsely match.
 * Tokens are worker-private and MUST be expanded before crossing into the DOM.
 */
export class ReviewMathCodec {
  private readonly entries = new Map<string, { id: string; bytes: number }>();
  private sequence = 0;
  private bytes = 0;
  constructor(private readonly maxBytes = 8 * 1024 * 1024, private readonly maxEntries = 1024) {}
  get retainedBytes(): number { return this.bytes; }
  get entryCount(): number { return this.entries.size; }

  pack(html: string): { html: string; restore(value: string): string } | null {
    // Authored lookalike tokens must never be interpreted as internal handles.
    if (html.includes(ATTRIBUTE)) return null;
    const islands = mathIslands(html);
    if (islands === null) return null;
    const exact = new Map<string, string>();
    const payloads = new Map<string, string>();
    const compact = replaceMathIslands(html, islands, (island) => {
      let id = exact.get(island.html);
      if (!id) {
        id = this.intern(island.html);
        exact.set(island.html, id); payloads.set(id, island.html);
      }
      return `<span ${ATTRIBUTE}="${id}"></span>`;
    });
    return { html: compact, restore(value) {
      return value.replace(TOKEN, (_token, id: string) => {
        const payload = payloads.get(id);
        if (payload === undefined) throw new Error('Unknown opaque review math.');
        return payload;
      });
    } };
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
      while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
      }
    }
    return id;
  }
}
