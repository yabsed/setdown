import { expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installIpc } from '../../main/ipc/install-ipc';
import { resourceUrl } from '../../main/preview/resource-url';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, shell: {}, app: { on: vi.fn() } }));
vi.mock('../../main/notebook/notebook-ipc', () => ({ installNotebookIpc: () => {} }));
vi.mock('../../main/documents/image-edit-ipc', () => ({ installImageEditIpc: () => {} }));

test('F26 the open-link IPC must not decode URL delimiters before parsing', async () => {
  const handlers = new Map<string, Function>();
  const documents = { open: vi.fn(async () => ({})) }, browsers = { openLink: vi.fn(async () => {}) };
  installIpc({ channels: { handle: (id: string, callback: Function) => handlers.set(id, callback), on: () => {} },
    documents, browsers, previews: { registerIpc: () => {}, setReadingMenu: () => {} },
    transfers: { registerIpc: () => {} }, projects: {}, renderer: {}, themes: {}, autoSave: {} } as any);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-audit-links-'));
  try {
    const file = path.join(root, 'note#part.md'); await fs.writeFile(file, 'text');
    const owner = { webContentsId: 42, currentDocument: null, rendererTabs: [], window: { webContents: { send: vi.fn() } } };
    await handlers.get('document:open-link')!(owner, resourceUrl(file));
    const url = 'https://example.test/search?q=a%26b';
    await handlers.get('document:open-link')!(owner, url);
    expect({ openedFile: (documents.open.mock.calls[0] as unknown[] | undefined)?.[1], openedURL: (browsers.openLink.mock.calls[0] as unknown[] | undefined)?.[1] })
      .toEqual({ openedFile: file, openedURL: url });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
