import type { MemoryPressure } from '../core/memory/memory-policy';
export type MemoryContext = { visible: string[]; protected: string[] };
export type MemorySnapshot = {
  pressure: MemoryPressure; measuredAt: number; total: number; available: number; appBytes: number; budget: number;
  metric: 'pss' | 'working-set'; processes: Array<{ pid: number; bytes: number; name: string }>;
  resources: Record<string, number>; missing: number; error?: string;
};
