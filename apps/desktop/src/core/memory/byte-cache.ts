/** Recomputable values only. An oversized value is returned by its caller but
 * never admitted to this cache. Estimates exclude engine/object overhead. */
export class ByteCache<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  bytes = 0;
  constructor(readonly capacity: number, readonly maxEntries = 128) {}
  get size() { return this.entries.size; }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, bytes: number): void {
    this.delete(key);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.capacity || this.maxEntries <= 0) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    this.trim(this.capacity, this.maxEntries);
  }
  delete(key: K): void {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  trim(bytes = 0, entries = this.maxEntries): void {
    while (this.entries.size && (this.bytes > bytes || this.entries.size > entries)) this.delete(this.entries.keys().next().value!);
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
