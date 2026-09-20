import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, vi } from 'vitest';
import { SearchService } from './search-service';
import { ProjectPaths } from './project-paths';
import type { WindowState } from '../windows/window-state';
import type { RipgrepFiles } from './engines/ripgrep-files';

// Traversal is injected; files and strict decoding remain real.
vi.mock('./engines/ripgrep-files', () => ({ RipgrepFiles: class {} }));
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-text-search-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
function state(root: string) { return { projectRoot: root, webContentsId: 1 } as WindowState; }
function listing(root: string) {
  return { markdown: async () => [path.join(root, 'note.md')],
    text: async () => ['note.md', 'code.cpp', 'invalid.custom'].map(name => path.join(root, name)) } as unknown as RipgrepFiles;
}

test('default search keeps Markdown traversal and rendered semantics', async () => {
  await fixture(async root => {
    await fs.writeFile(path.join(root, 'note.md'), '# needle');
    let rendered = 0;
    const service = new SearchService(new ProjectPaths(), async () => {
      rendered++;
      return [{ line: 1, column: 1, lineOccurrence: 0, ordinal: 0, preview: 'needle' }];
    }, listing(root));
    const result = await service.search(state(root), { query: 'needle', documents: [] });
    assert.equal(rendered, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].surface, 'viewer');
    assert.ok(result.every(match => match.path.endsWith('.md')));
  });
});

test('All Text Files uses live code buffers and never renders code through Crossnote', async () => {
  await fixture(async root => {
    await fs.writeFile(path.join(root, 'note.md'), '# no match');
    await fs.writeFile(path.join(root, 'code.cpp'), 'disk needle');
    await fs.writeFile(path.join(root, 'invalid.custom'), Buffer.from([0xff, 0x61]));
    const seen: string[] = [];
    const service = new SearchService(new ProjectPaths(), async file => { seen.push(file); return []; }, listing(root));
    const result = await service.search(state(root), { scope: 'text', query: 'needle',
      documents: [{ path: path.join(root, 'code.cpp'), surface: 'editor', text: '😀live needle\r\n' }] });
    assert.deepEqual(seen, [path.join(root, 'note.md')]);
    assert.equal(result.length, 1);
    assert.equal(result[0].surface, 'editor');
    assert.equal(result[0].column, 8);
    assert.equal(result[0].preview, '😀live needle');
  });
});

test('a newer empty search cancels a slow rendered search result', async () => {
  await fixture(async root => {
    await fs.writeFile(path.join(root, 'note.md'), '# needle');
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let complete!: (matches: Array<{ line: number; column: number; lineOccurrence: number; ordinal: number; preview: string }>) => void;
    const blocked = new Promise<Array<{ line: number; column: number; lineOccurrence: number; ordinal: number; preview: string }>>(resolve => { complete = resolve; });
    const service = new SearchService(new ProjectPaths(), () => { ready(); return blocked; }, listing(root));
    const target = state(root);
    const pending = service.search(target, { query: 'needle', documents: [] });
    await started;
    assert.deepEqual(await service.search(target, { query: '', documents: [] }), []);
    complete([{ line: 1, column: 1, lineOccurrence: 0, ordinal: 0, preview: 'needle' }]);
    assert.deepEqual(await pending, []);
  });
});

test('an empty live buffer overrides matching text on disk', async () => {
  await fixture(async root => {
    await fs.writeFile(path.join(root, 'code.cpp'), 'needle on disk');
    const service = new SearchService(new ProjectPaths(), async () => [], listing(root));
    const results = await service.search(state(root), { scope: 'text', query: 'needle',
      documents: [{ path: path.join(root, 'code.cpp'), surface: 'editor', text: '' }] });
    assert.deepEqual(results, []);
  });
});
