/** Bounded immutable-baseline cache. Potential external dependencies bypass it. */
export class ReviewBaselineCache<T> {
  private readonly entries = new Map<string, { text: string; context: string; value: T; bytes: number }>();
  private bytes = 0;
  constructor(private readonly limit = 16 * 1024 * 1024, private readonly maxEntries = 8) {}

  static eligible(text: string): boolean {
    // @import, media, raw HTML, front matter and code-chunk attributes may depend
    // on files/configuration outside the input string. Be conservative.
    return !/[!<@]|^\s*---|^\s*`{3,}[^\n]*\{/m.test(text);
  }

  get(id: string, text: string, context: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.text !== text || entry.context !== context || !ReviewBaselineCache.eligible(text)) return;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.value;
  }

  set(id: string, text: string, context: string, value: T, bytes: number): void {
    this.delete(id);
    if (!ReviewBaselineCache.eligible(text) || bytes > this.limit) return;
    this.entries.set(id, { text, context, value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.limit || this.entries.size > this.maxEntries) {
      this.delete(this.entries.keys().next().value!);
    }
  }

  delete(id: string): void {
    this.bytes -= this.entries.get(id)?.bytes ?? 0;
    this.entries.delete(id);
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
