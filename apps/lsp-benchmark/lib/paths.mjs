import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const desktop = path.join(path.dirname(app), 'desktop');
/** Downloads: the tools Setdown prepares (about 1 GB) and the projects with their libraries. */
export const work = path.resolve(process.env.LSP_BENCHMARK_WORK ?? path.join(app, 'work'));
export const results = path.join(app, 'results');
