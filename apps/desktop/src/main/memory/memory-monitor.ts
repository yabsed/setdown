import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryPolicy, memoryBudget, type MemoryPressure } from '../../core/memory/memory-policy';
import type { MemoryContext, MemorySnapshot } from '../../protocol/memory';

export function meminfo(text: string, field: string): number | undefined {
  const value = text.match(new RegExp(`^${field}:\\s+(\\d+)`, 'm'))?.[1];
  return value === undefined ? undefined : Number(value) * 1024;
}
export function cgroupHeadroom(current: number, limit: string): number | undefined {
  const max = Number(limit.trim());
  return Number.isFinite(max) && max > 0 ? Math.max(0, max - current) : undefined;
}

/** One app-wide pressure source; never writes kernel settings or kills pages.
 * Resource owners decide what can be released without losing user state. */
export class MemoryMonitor {
  readonly contexts = new Map<number, MemoryContext>();
  private readonly policy = new MemoryPolicy();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<MemorySnapshot>;
  private dead = false;
  snapshot: MemorySnapshot = { pressure: 'normal', measuredAt: 0, total: os.totalmem(), available: os.freemem(),
    appBytes: 0, budget: memoryBudget(os.totalmem()), metric: 'working-set', processes: [], resources: {}, missing: 0 };
  constructor(private readonly reclaim: (pressure: MemoryPressure, contexts: Map<number, MemoryContext>) => Promise<void>,
    private readonly resources: () => Record<string, number>) {}
  context(owner: number, input: unknown): void {
    if (!input || typeof input !== 'object') return;
    const context = input as MemoryContext;
    if (![context.visible, context.protected].every(ids => Array.isArray(ids) && ids.length <= 10_000
      && ids.every(id => typeof id === 'string' && id.length <= 256))) return;
    this.contexts.set(owner, { visible: [...new Set(context.visible)], protected: [...new Set(context.protected)] });
  }
  start(): void {
    const tick = () => {
      if (this.dead) return;
      void this.sample().finally(() => {
        if (!this.dead) { this.timer = setTimeout(tick, this.snapshot.pressure === 'normal' ? 10_000 : 3000); this.timer.unref(); }
      });
    };
    // Startup rendering owns the input path. Monitoring does not delay it.
    this.timer = setTimeout(tick, 10_000); this.timer.unref();
  }
  stop(): void { this.dead = true; clearTimeout(this.timer); this.contexts.clear(); }
  async collect(): Promise<MemorySnapshot> {
    const metrics = app.getAppMetrics();
    let total = os.totalmem(), available = os.freemem(), stalled = 0;
    const names = new Map(metrics.map(m => [m.pid, m.name || m.type]));
    let processes: MemorySnapshot['processes'] = metrics.map(m => ({ pid: m.pid, bytes: m.memory.workingSetSize * 1024, name: names.get(m.pid)! }));
    let metric: MemorySnapshot['metric'] = 'working-set', missing = 0;
    if (process.platform === 'linux') {
      const info = await fs.readFile('/proc/meminfo', 'utf8');
      total = meminfo(info, 'MemTotal') ?? total; available = meminfo(info, 'MemAvailable') ?? available;
      const pressure = await fs.readFile('/proc/pressure/memory', 'utf8').catch(() => '');
      stalled = Number(pressure.match(/^full avg10=([\d.]+)/m)?.[1] ?? 0);
      // Include all child processes (also LSP/Python), not only Chromium metrics.
      const pids = new Set<number>([process.pid, ...names.keys()]);
      let pending = [...pids];
      while (pending.length && pids.size < 512) {
        const next: number[] = [];
        await Promise.all(pending.map(async pid => {
          const children = await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => '');
          for (const id of children.trim().split(/\s+/).map(Number)) if (id > 0 && !pids.has(id)) { pids.add(id); next.push(id); }
        }));
        pending = next;
      }
      const result = await Promise.all([...pids].map(async pid => {
        try {
          const bytes = meminfo(await fs.readFile(`/proc/${pid}/smaps_rollup`, 'utf8'), 'Pss');
          return bytes === undefined ? null : { pid, bytes, name: names.get(pid) ?? (pid === process.pid ? 'Browser' : 'Child process') };
        } catch { return null; }
      }));
      missing = result.filter(p => !p).length;
      if (result.some(Boolean)) { metric = 'pss'; processes = result.filter((p): p is NonNullable<typeof p> => !!p); }
      // Honor nested cgroup v2 limits, including constrained validation runners.
      const group = (await fs.readFile('/proc/self/cgroup', 'utf8')).match(/^0::(.+)$/m)?.[1];
      if (group?.startsWith('/') && !group.split('/').includes('..')) {
        let directory = path.join('/sys/fs/cgroup', group);
        while (directory.startsWith('/sys/fs/cgroup/') || directory === '/sys/fs/cgroup') {
          try {
            const [current, max] = await Promise.all([fs.readFile(path.join(directory, 'memory.current'), 'utf8'), fs.readFile(path.join(directory, 'memory.max'), 'utf8')]);
            const headroom = cgroupHeadroom(Number(current), max);
            if (headroom !== undefined) { total = Math.min(total, Number(max)); available = Math.min(available, headroom); }
          } catch { /* Not all platforms delegate a readable memory controller. */ }
          if (directory === '/sys/fs/cgroup') break;
          directory = path.dirname(directory);
        }
      }
    }
    const appBytes = processes.reduce((sum, p) => sum + p.bytes, 0);
    return { pressure: this.policy.update({ total, available, appBytes, stalled }, Date.now()), total, available, appBytes,
      budget: memoryBudget(total), measuredAt: Date.now(), metric, processes, missing, resources: this.resources() };
  }
  sample(): Promise<MemorySnapshot> {
    return this.running ??= (async () => {
      try {
        this.snapshot = await this.collect();
        if (!this.dead) await this.reclaim(this.snapshot.pressure, this.contexts);
        this.snapshot.resources = this.resources();
      } catch (error) { this.snapshot = { ...this.snapshot, error: String(error) }; }
      return this.snapshot;
    })().finally(() => { this.running = undefined; });
  }
  async trim(): Promise<MemorySnapshot> {
    await this.sample();
    if (!this.dead) await this.reclaim('critical', this.contexts);
    this.snapshot.resources = this.resources();
    return this.snapshot;
  }
}
