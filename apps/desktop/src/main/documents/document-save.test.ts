import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { DocumentManager } from './document-manager';
import type { WindowState } from '../windows/window-state';

test('autosave never recreates a deleted or moved backing file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-missing-save-'));
  try {
    const file = path.join(root, 'note.txt'); await fs.writeFile(file, 'disk');
    const manager = new DocumentManager(() => {});
    const document = await manager.read(file);
    await fs.unlink(file);
    expect(await manager.saveSnapshot({} as WindowState, document, 'new unsaved edits', 1, true)).toEqual({ canceled: true });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

for (const outcome of ['saved', 'replaced', 'deleted', 'failed'] as const)
  test(`own atomic save does not flash an external-change notice (${outcome})`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-own-save-'));
    const manager = new DocumentManager(() => {});
    const owner = () => ({ rendererTabs: [], window: { webContents: { send: vi.fn() } } }) as unknown as WindowState;
    const a = owner(), b = owner();
    try {
      const file = path.join(root, 'note.md'); await fs.writeFile(file, 'before');
      const document = await manager.read(file);
      a.currentDocument = document; b.currentDocument = document;
      manager.watch(a); manager.watch(b);
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (String(args[0]).endsWith('.tmp')) {
          const stat = handle.stat.bind(handle);
          vi.spyOn(handle, 'stat').mockImplementation(async () => {
            // The inode was committed, but atomicWrite has not returned its version.
            a.checkDocumentVersions?.(); b.checkDocumentVersions?.();
            const written = await stat();
            if (outcome === 'replaced' || outcome === 'failed') {
              const external = path.join(root, 'external.tmp');
              await fs.writeFile(external, 'external replacement'); await fs.rename(external, file);
            } else if (outcome === 'deleted') await fs.unlink(file);
            a.checkDocumentVersions?.();
            if (outcome === 'failed') throw Error('save completion failed');
            return written;
          });
        }
        return handle;
      });
      const saving = manager.saveSnapshot(a, document, 'own edits', 1, true);
      if (outcome === 'failed') await expect(saving).rejects.toThrow('save completion failed');
      else expect(await saving).toMatchObject({ canceled: false, document: { savedText: 'own edits' } });
      a.checkDocumentVersions?.(); b.checkDocumentVersions?.();
      const ownEvents = vi.mocked(a.window.webContents.send).mock.calls;
      if (outcome === 'saved') expect(ownEvents).toEqual([]);
      else {
        expect(ownEvents).toHaveLength(1);
        expect(ownEvents[0]).toEqual(['document:external-change', expect.objectContaining({ path: file, unavailable: outcome === 'deleted' })]);
        if (outcome !== 'deleted') expect(ownEvents[0][1].diskVersion).toEqual((await manager.read(file)).diskVersion);
      }
      expect(b.window.webContents.send).toHaveBeenCalledWith('document:external-change', expect.objectContaining({ path: file, unavailable: false }));
    } finally {
      vi.restoreAllMocks(); manager.stopWatching(a); manager.stopWatching(b);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
