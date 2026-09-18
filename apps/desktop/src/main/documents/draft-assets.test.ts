import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discardDraftBundle,
  isDraftDocumentPath,
  rewriteDraftAssetReferences,
  saveDraftBundle,
} from './draft-assets';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-draft-'));
  temporaryDirectories.push(root);
  const drafts = path.join(root, 'drafts');
  const sourceRoot = path.join(drafts, 'draft-id');
  const source = path.join(sourceRoot, 'Untitled.md');
  const assets = path.join(sourceRoot, 'Untitled.assets');
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(assets, 'image.png'), new Uint8Array([1, 2, 3]));
  return { root, drafts, sourceRoot, source };
}

describe('draft asset bundles', () => {
  it('moves assets beside the selected Markdown path and rewrites links', async () => {
    const { root, drafts, sourceRoot, source } = await fixture();
    const destination = path.join(root, 'notes', 'Algebra.md');
    const result = await saveDraftBundle(
      drafts,
      source,
      destination,
      '![plot](<Untitled.assets/image.png>)',
    );

    expect(result.text).toBe('![plot](<Algebra.assets/image.png>)');
    expect(await fs.readFile(destination, 'utf8')).toBe(result.text);
    expect(new Uint8Array(await fs.readFile(
      path.join(root, 'notes', 'Algebra.assets', 'image.png'),
    ))).toEqual(new Uint8Array([1, 2, 3]));
    await expect(fs.access(sourceRoot)).rejects.toThrow();
  });

  it('uses a collision-free asset directory without touching existing assets', async () => {
    const { root, drafts, source } = await fixture();
    const destination = path.join(root, 'Algebra.md');
    await fs.mkdir(path.join(root, 'Algebra.assets'));
    await fs.writeFile(path.join(root, 'Algebra.assets', 'keep.txt'), 'keep');

    const result = await saveDraftBundle(
      drafts,
      source,
      destination,
      '![plot](Untitled.assets/image.png)',
    );

    expect(result.text).toContain('Algebra.assets-2/image.png');
    expect(await fs.readFile(path.join(root, 'Algebra.assets', 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('only discards paths contained by the draft root', async () => {
    const { root, drafts, sourceRoot, source } = await fixture();
    expect(isDraftDocumentPath(drafts, source)).toBe(true);
    expect(await discardDraftBundle(drafts, source)).toBe(true);
    await expect(fs.access(sourceRoot)).rejects.toThrow();
    expect(await discardDraftBundle(drafts, path.join(root, 'outside.md'))).toBe(false);
  });

  it('rewrites only when directory names differ', () => {
    expect(rewriteDraftAssetReferences('a.assets/x.png', 'a.assets', 'b.assets'))
      .toBe('b.assets/x.png');
  });
});
