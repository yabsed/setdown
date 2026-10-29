import watcher, { type AsyncSubscription } from '@parcel/watcher';
import type { WindowState } from '../../windows/window-state';
import type { GitCli } from './git-cli';
import path from 'node:path';
import { isInside } from '../../documents/file-system';

/** The index and refs may live outside both the Explorer root and the worktree. */
export class GitMetadataWatcher {
  private readonly owners = new Map<number, { root: string; repository: string; stop(): void }>();
  async watch(state: WindowState, repository: GitCli, others: readonly GitCli[] = []): Promise<void> {
    if (!state.window?.on || !state.window?.once || !state.projectRoot) return;
    const root = state.projectRoot, owner = state.webContentsId;
    const repositories = [repository, ...others];
    const repositoryKey = JSON.stringify(repositories.map(candidate => candidate.repositoryRoot).sort());
    if (this.owners.get(owner)?.root === root && this.owners.get(owner)?.repository === repositoryKey) return;
    this.owners.get(owner)?.stop();
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const subscriptions: AsyncSubscription[] = [];
    const publish = () => {
      if (stopped || state.projectRoot !== root || state.window.isDestroyed()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!stopped && state.projectRoot === root && !state.window.isDestroyed())
          state.window.webContents.send('project:files-changed', { root, paths: [] });
      }, 100);
    };
    const entry = { root, repository: repositoryKey, stop: () => {
      stopped = true; clearTimeout(timer); clearInterval(fallback);
      state.window.removeListener('focus', publish);
      state.window.removeListener('closed', entry.stop);
      for (const subscription of subscriptions) void subscription.unsubscribe();
      if (this.owners.get(owner) === entry) this.owners.delete(owner);
    } };
    // A bounded fallback covers native watcher failures and network filesystems.
    const fallback = setInterval(publish, 15_000); fallback.unref();
    this.owners.set(owner, entry);
    state.window.once('closed', entry.stop); state.window.on('focus', publish);
    try {
      const directories = new Set<string>();
      for (const candidate of repositories) {
        for (const directory of (await candidate.run(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']))
          .trim().split('\n')) directories.add(path.resolve(candidate.repositoryRoot, directory));
        if (!isInside(root, candidate.repositoryRoot)) directories.add(candidate.repositoryRoot);
      }
      for (const directory of directories) {
        const subscription = await watcher.subscribe(directory, (error, events) => {
          if (error || events.some(event => !event.path.endsWith('.lock'))) publish();
        }, { ignore: ['**/objects/**', '**/logs/**', '**/hooks/**', '**/node_modules/**'] });
        if (stopped) await subscription.unsubscribe(); else subscriptions.push(subscription);
      }
    } catch { publish(); }
  }
  unwatch(owner: number): void { this.owners.get(owner)?.stop(); }
  dispose(): void { for (const entry of this.owners.values()) entry.stop(); }
}
