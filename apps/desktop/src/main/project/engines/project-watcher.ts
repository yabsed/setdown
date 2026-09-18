import watcher, { type AsyncSubscription } from '@parcel/watcher';
import type { WindowState } from '../../windows/window-state';

const IGNORE = [
  '**/.git/objects/**', '**/.git/logs/**', '**/.git/hooks/**',
  '**/.hg/**', '**/.svn/**', '**/node_modules/**',
];

export interface ProjectWatcherPort {
  watch(state: WindowState, root: string): Promise<void>;
  dispose(): Promise<void>;
}

/** One native recursive subscription per window, independent of the rendered tree. */
export class ProjectWatcher implements ProjectWatcherPort {
  private readonly subscriptions = new Map<number, AsyncSubscription>();
  private readonly generations = new Map<number, number>();
  private readonly closed = new Set<number>();

  async watch(state: WindowState, root: string): Promise<void> {
    const id = state.webContentsId;
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    await this.unsubscribe(id);
    if (state.window.isDestroyed()) return;
    const subscription = await watcher.subscribe(root, (error) => {
      if (error) {
        console.error('Project watcher failed:', error);
        return;
      }
      if (this.generations.get(id) !== generation || state.window.isDestroyed()
        || state.window.webContents.isDestroyed()) return;
      state.window.webContents.send('project:files-changed', { root });
    }, { ignore: IGNORE });
    if (this.generations.get(id) !== generation || state.window.isDestroyed()) {
      await subscription.unsubscribe();
      return;
    }
    this.subscriptions.set(id, subscription);
    if (!this.closed.has(id)) {
      this.closed.add(id);
      state.window.once('closed', () => void this.unsubscribe(id));
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.subscriptions.keys()].map((id) => this.unsubscribe(id)));
  }

  private async unsubscribe(id: number): Promise<void> {
    const subscription = this.subscriptions.get(id);
    this.subscriptions.delete(id);
    if (subscription) await subscription.unsubscribe().catch(() => undefined);
  }
}
