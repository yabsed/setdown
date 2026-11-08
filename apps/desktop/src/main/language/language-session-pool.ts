type ManagedServer = { stop(): Promise<void> };
type Slot<T> = { key: string; server: T; resources: Set<string>; timer?: ReturnType<typeof setTimeout>; retired: boolean };
/** Same analysis context shares one process, but duplicate URI owners cannot
 * send competing didOpen/didClose streams to that process. Idle reuse is bounded. */
export class LanguageSessionPool<T extends ManagedServer> {
  private slots = new Set<Slot<T>>();
  private draining = new Set<Promise<void>>();
  constructor(private idleMs = 30_000, private idleLimit = 4) {}
  get running() { return !!(this.slots.size || this.draining.size); }
  acquire(key: string, uri: string, create: () => T): { server: T; release(): void } {
    let slot = [...this.slots].find(slot => !slot.retired && slot.key === key && !slot.resources.has(uri));
    if (!slot) { slot = { key, server: create(), resources: new Set(), retired: false }; this.slots.add(slot); }
    clearTimeout(slot.timer); slot.timer = undefined; slot.resources.add(uri);
    const owned = slot; let live = true;
    return { server: slot.server, release: () => {
      if (!live) return; live = false; owned.resources.delete(uri);
      if (!owned.resources.size) {
        if (owned.retired) this.stop(owned);
        else {
          owned.timer = setTimeout(() => this.stop(owned), this.idleMs); owned.timer.unref?.();
          const idle = [...this.slots].filter(slot => slot.timer);
          for (const old of idle.slice(0, Math.max(0, idle.length - this.idleLimit))) this.stop(old);
        }
      }
    } };
  }
  invalidate(server: T): void {
    for (const slot of this.slots) if (slot.server === server) {
      slot.retired = true; if (!slot.resources.size) this.stop(slot);
    }
  }
  private stop(slot: Slot<T>): void {
    if (!this.slots.delete(slot)) return;
    slot.retired = true; clearTimeout(slot.timer);
    const pending = slot.server.stop(); this.draining.add(pending);
    void pending.then(() => this.draining.delete(pending), () => this.draining.delete(pending));
  }
  async dispose(prefix?: string): Promise<void> {
    for (const slot of this.slots) if (!prefix || slot.key.startsWith(prefix)) this.stop(slot);
    await Promise.all([...this.draining]);
  }
}
