/** Bounded recovery, keyed by owner + provider + workspace. Only reconnects
 * documents; never replays a rename, edit, save participant or server command.
 *
 * Three reconnections in a row, then it stops until a person restarts the service. "In a row" is
 * counted from the reconnection, not from the clock alone: a tool that needs twenty seconds to
 * fail each time (it waits for an answer, or for a download) fails three times in more than a
 * minute, and was reconnected without end while the count looked back one minute only. A failure
 * belongs to the run while the reconnection before it could still be the one that failed. */
const patience = 180_000; // Longer than the longest wait for a tool to start (two minutes).
export class LanguageServiceSupervisor {
  private readonly runs = new Map<string, { failures: number; reconnected: number }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  schedule(key: string, reconnect: () => void): { attempt: number; delay: number } | undefined {
    this.cancel(key);
    const now = Date.now(), run = this.runs.get(key);
    const failures = run && now - run.reconnected < patience ? run.failures : 0;
    if (failures >= 3) return undefined;
    const delay = [1000, 3000, 5000][failures];
    this.runs.set(key, { failures: failures + 1, reconnected: now + delay });
    const timer = setTimeout(() => { this.timers.delete(key); reconnect(); }, delay);
    timer.unref?.(); this.timers.set(key, timer);
    return { attempt: failures + 1, delay };
  }
  cancel(key: string) { const timer = this.timers.get(key); if (timer) clearTimeout(timer); this.timers.delete(key); }
  reset(key: string) { this.cancel(key); this.runs.delete(key); }
  dispose() { for (const key of this.timers.keys()) this.cancel(key); this.runs.clear(); }
}
