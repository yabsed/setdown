import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
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
