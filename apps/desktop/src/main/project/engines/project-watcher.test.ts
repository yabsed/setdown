import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nativeWatcher from '@parcel/watcher';
import type { ProjectFilesChanged } from '../../../protocol/desktop-api';
import type { WindowState } from '../../windows/window-state';
import { GitService } from '../git-service';
import { ProjectPaths } from '../project-paths';
import { GitCli } from './git-cli';
import { ProjectWatcher } from './project-watcher';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('project watcher engine', () => {
  test('closing a folder invalidates a pending subscription and ignores its late events', async () => {
    let finish!: (subscription: { unsubscribe(): Promise<void> }) => void;
    const pending = new Promise<{ unsubscribe(): Promise<void> }>(resolve => { finish = resolve; });
    const subscribe = vi.spyOn(nativeWatcher, 'subscribe').mockReturnValue(pending);
    const unsubscribe = vi.fn(async () => {}), send = vi.fn();
    const window = { isDestroyed: () => false, once: vi.fn(), webContents: { isDestroyed: () => false, send } };
    const watcher = new ProjectWatcher();
    try {
      const opening = watcher.watch({ webContentsId: 9, window } as unknown as WindowState, '/root');
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
      await watcher.unwatch(9);
      finish({ unsubscribe });
      await opening;
      subscribe.mock.calls[0][1](null, [{ path: '/root/late.txt', type: 'create' }]);
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
    } finally { subscribe.mockRestore(); await watcher.dispose(); }
  });
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

  test('does not emit a project change when Git status only reads the index', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-watch-git-status-'));
    temporaryDirectories.push(root);
    const filePath = path.join(root, 'notes.md');
    await GitCli.run(root, ['init']);
    await GitCli.run(root, ['config', 'user.email', 'setdown@example.test']);
    await GitCli.run(root, ['config', 'user.name', 'Setdown Test']);
    await writeFile(filePath, '# Original\n', 'utf8');
    await GitCli.run(root, ['add', 'notes.md']);
    await GitCli.run(root, ['commit', '-m', 'base']);
    await writeFile(filePath, '# Changed\n', 'utf8');

    let notifications = 0;
    const window = {
      isDestroyed: () => false,
      once: () => undefined,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string) => {
          if (channel === 'project:files-changed') notifications += 1;
        },
      },
    };
    const watcher = new ProjectWatcher();
    await watcher.watch({ webContentsId: 8, window } as unknown as WindowState, root);
    try {
      const service = new GitService(new ProjectPaths());
      await service.status({ projectRoot: root } as WindowState);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(notifications).toBe(0);
    } finally {
      await watcher.dispose();
    }
  });
});
