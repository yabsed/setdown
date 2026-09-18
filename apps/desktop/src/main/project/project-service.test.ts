import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { WindowState } from '../windows/window-state';
import { isMarkdownDocument, parseGitStatus, ProjectService } from './project-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('project service', () => {
  test('classifies the document formats Setdown can open', () => {
    expect(isMarkdownDocument('notes.md')).toBe(true);
    expect(isMarkdownDocument('paper.QMD')).toBe(true);
    expect(isMarkdownDocument('image.png')).toBe(false);
  });

  test('turns porcelain status into compact source-control rows', () => {
    expect(parseGitStatus(' M notes.md\nA  staged.md\n?? new file.md\n')).toEqual([
      { path: 'notes.md', filePath: '', status: 'M', staged: false },
      { path: 'staged.md', filePath: '', status: 'A', staged: true },
      { path: 'new file.md', filePath: '', status: '??', staged: false },
    ]);
  });

  test('loads folders lazily and searches Markdown documents only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-project-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'chapter'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'notes.md'), '# Needle\n', 'utf8');
    await writeFile(path.join(root, 'image.png'), 'needle', 'utf8');
    await writeFile(path.join(root, 'chapter', 'more.md'), 'A needle then needle here.\n', 'utf8');
    await writeFile(path.join(root, 'node_modules', 'hidden.md'), 'needle', 'utf8');
    const state = { projectRoot: root } as WindowState;
    const service = new ProjectService();

    const reloaded = { projectRoot: null } as WindowState;
    expect(await service.restore(reloaded, root)).toEqual({ path: root, name: path.basename(root) });
    expect(reloaded.projectRoot).toBe(root);

    expect(await service.readDirectory(state, root)).toEqual([
      { path: path.join(root, 'chapter'), name: 'chapter', kind: 'directory' },
      { path: path.join(root, 'node_modules'), name: 'node_modules', kind: 'directory' },
      { path: path.join(root, 'image.png'), name: 'image.png', kind: 'file' },
      { path: path.join(root, 'notes.md'), name: 'notes.md', kind: 'document' },
    ]);
    const results = await service.search(state, 'needle');
    expect(results.map(({ relativePath, line, column, lineOccurrence, ordinal }) => ({
      relativePath, line, column, lineOccurrence, ordinal,
    }))).toEqual([
      { relativePath: path.join('chapter', 'more.md'), line: 1, column: 3,
        lineOccurrence: 0, ordinal: 0 },
      { relativePath: path.join('chapter', 'more.md'), line: 1, column: 15,
        lineOccurrence: 1, ordinal: 1 },
      { relativePath: 'notes.md', line: 1, column: 3, lineOccurrence: 0, ordinal: 0 },
    ]);
    expect(results.every((result) => /needle/i.test(result.preview))).toBe(true);
  });
});
