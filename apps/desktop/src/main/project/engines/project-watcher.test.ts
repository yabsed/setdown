import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ProjectFilesChanged } from '../../../protocol/desktop-api';
import type { WindowState } from '../../windows/window-state';
import { ProjectWatcher } from './project-watcher';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('project watcher engine', () => {
  test('turns native recursive events into one renderer notification channel', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-watch-'));
    temporaryDirectories.push(root);
    let changed!: (event: ProjectFilesChanged) => void;
    const received = new Promise<ProjectFilesChanged>((resolve) => { changed = resolve; });
    const window = {
      isDestroyed: () => false,
      once: () => undefined,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, event: ProjectFilesChanged) => {
          if (channel === 'project:files-changed') changed(event);
        },
      },
    };
    const watcher = new ProjectWatcher();
    await watcher.watch({ webContentsId: 7, window } as unknown as WindowState, root);
    const filePath = path.join(root, 'notes.md');
    await writeFile(filePath, '# Notes\n', 'utf8');

    let timeout: NodeJS.Timeout | undefined;
    try {
      const event = await Promise.race([
        received,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('watch timeout')), 3_000);
        }),
      ]);
      expect(event.root).toBe(root);
    } finally {
      clearTimeout(timeout);
      await watcher.dispose();
    }
  });
});
