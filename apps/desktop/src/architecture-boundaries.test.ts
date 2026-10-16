import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { boundaryViolations, importGraph, inspectSource, resolveSource, sourceFiles } from '../test/support/architecture/import-graph';

const root = process.cwd();
describe('architecture boundaries', () => {
  test('resolved imports respect process, composition and feature boundaries', () => {
    expect(boundaryViolations(importGraph(root))).toEqual([]);
  });

  test('only the desktop adapter accesses the renderer bridge', () => {
    const source = path.join(root, 'src');
    expect(sourceFiles(path.join(source, 'renderer'))
      .filter(file => inspectSource(file, readFileSync(file, 'utf8')).desktopGlobal)
      .map(file => path.relative(source, file))).toEqual([path.join('renderer', 'adapters', 'electron-desktop.ts')]);
  });

  test('Svelte, dynamic imports and type-only imports are parsed without comment false positives', () => {
    expect(inspectSource('Feature.svelte', `<script lang="ts">
      // import hidden from '../main/hidden'; window.marktex;
      import type { Example } from '../protocol/example';
      export { type Example as Alias } from '../protocol/example';
      const load = () => import('../main/service');
      type Other = import('../core/example').Other;
      window['marktex'];
    </script><p>window.marktex</p>`)).toEqual({ desktopGlobal: true, imports: [
      { specifier: '../protocol/example', typeOnly: true },
      { specifier: '../protocol/example', typeOnly: true },
      { specifier: '../main/service', typeOnly: false },
      { specifier: '../core/example', typeOnly: true },
    ] });
  });

  test('aliases resolve before enforcing the same boundary as relative imports', () => {
    const file = path.join(root, 'src/renderer/main.ts');
    expect(resolveSource('@main/main', file, { baseUrl: root, paths: { '@main/*': ['src/main/*'] } }))
      .toBe(path.join(root, 'src/main/main.ts'));
    expect(boundaryViolations([{ from: 'renderer/main.ts', to: 'main/main.ts', specifier: '@main/main', typeOnly: false }]))
      .toEqual(['renderer/main.ts -> main/main.ts']);
  });

  test('type-only process violations and private feature imports remain visible', () => {
    expect(boundaryViolations([
      { from: 'core/example.ts', to: 'protocol/language.ts', specifier: '../protocol/language', typeOnly: true },
      { from: 'renderer/image/example.ts', specifier: 'node:fs', typeOnly: false },
      { from: 'renderer/workspace/example.ts', to: 'renderer/notebook/notebook-store.ts', specifier: '../notebook/notebook-store', typeOnly: false },
    ])).toHaveLength(3);
  });
});
