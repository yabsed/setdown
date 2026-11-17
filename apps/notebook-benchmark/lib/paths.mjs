import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repository = path.resolve(app, '../..');
export const desktop = path.join(repository, 'apps/desktop');
/** Downloads, the environment and raw results: large, rebuildable, never committed. */
export const work = path.resolve(process.env.NOTEBOOK_BENCHMARK_WORK ?? path.join(app, 'work'));
export const corpus = path.join(work, 'corpus');
