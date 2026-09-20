/** Bounded memoization of pure operations on exact strings, never lossy hashes.
 * Values must be treated as immutable. Limits include UTF-16 key/value estimates,
 * not a promise about the JavaScript engine's actual heap allocation.
 */
export class ExactPairCache<T> {
  private readonly left = new Map<string, Map<string, { left: string; right: string; value: T; bytes: number }>>();
  private readonly recent = new Map<{ left: string; right: string; value: T; bytes: number }, true>();
  private bytes = 0;
  constructor(private readonly maxEntries: number, private readonly maxBytes: number) {}

  getOrCreate(left: string, right: string, create: () => T, weight: (value: T) => number): T {
    const found = this.left.get(left)?.get(right);
    if (found) {
      this.recent.delete(found);
      this.recent.set(found, true);
      return found.value;
    }
    const value = create();
    const bytes = 2 * (left.length + right.length) + weight(value) + 128;
    if (this.maxEntries < 1 || !Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return value;
    const entry = { left, right, value, bytes };
    const group = this.left.get(left) ?? new Map();
    group.set(right, entry);
    this.left.set(left, group);
    this.recent.set(entry, true);
    this.bytes += bytes;
    while (this.recent.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.recent.keys().next().value!;
      this.recent.delete(oldest);
      const siblings = this.left.get(oldest.left)!;
      siblings.delete(oldest.right);
      if (!siblings.size) this.left.delete(oldest.left);
      this.bytes -= oldest.bytes;
    }
    return value;
  }

  clear(): void { this.left.clear(); this.recent.clear(); this.bytes = 0; }
}
