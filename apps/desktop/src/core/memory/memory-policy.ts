export type MemoryPressure = 'normal' | 'moderate' | 'critical';
export const MiB = 1024 * 1024;
export type MemorySample = { total: number; available: number; appBytes: number; stalled?: number };
export function memoryBudget(total: number): number {
  return Math.min(3 * 1024 * MiB, Math.max(768 * MiB, total * 0.18));
}

/** Fast escalation, slow recovery. A budget covers the entire application. */
export class MemoryPolicy {
  pressure: MemoryPressure = 'normal';
  private healthySince: number | null = null;
  update(sample: MemorySample, now: number): MemoryPressure {
    const budget = memoryBudget(sample.total);
    const critical = sample.available < Math.max(256 * MiB, sample.total * 0.05)
      || sample.appBytes > budget * 1.35 || (sample.stalled ?? 0) >= 10;
    const moderate = sample.available < Math.max(512 * MiB, sample.total * 0.12)
      || sample.appBytes > budget || (sample.stalled ?? 0) >= 2;
    if (critical || moderate) {
      this.healthySince = null;
      if (critical || this.pressure === 'normal') this.pressure = critical ? 'critical' : 'moderate';
    } else if (sample.available > Math.max(768 * MiB, sample.total * 0.18) && sample.appBytes < budget * 0.8) {
      this.healthySince ??= now;
      if (now - this.healthySince >= 30_000) this.pressure = 'normal';
    } else this.healthySince = null;
    return this.pressure;
  }
}
