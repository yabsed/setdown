/** Bounded recovery, keyed by owner + provider + workspace. Only reconnects
 * documents; never replays a rename, edit, save participant or server command. */
export class LanguageServiceSupervisor {
  private readonly failures = new Map<string, number[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  schedule(key: string, reconnect: () => void): { attempt: number; delay: number } | undefined {
    this.cancel(key);
    const failures = (this.failures.get(key) ?? []).filter(time => Date.now() - time < 60_000);
    if (failures.length >= 3) return undefined;
    failures.push(Date.now()); this.failures.set(key, failures);
    const delay = [1000, 3000, 5000][failures.length - 1];
    const timer = setTimeout(() => { this.timers.delete(key); reconnect(); }, delay);
    timer.unref?.(); this.timers.set(key, timer);
    return { attempt: failures.length, delay };
  }
  cancel(key: string) { const timer = this.timers.get(key); if (timer) clearTimeout(timer); this.timers.delete(key); }
  reset(key: string) { this.cancel(key); this.failures.delete(key); }
  dispose() { for (const key of this.timers.keys()) this.cancel(key); this.failures.clear(); }
}
