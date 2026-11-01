import watcher, { type AsyncSubscription, type SubscribeCallback, type Options } from '@parcel/watcher';

// Parcel serializes registration and teardown behind one native backend lock.
// Submitting several crawls concurrently can therefore occupy every libuv I/O
// worker with lock waiters, starving even fs.stat during a folder switch.
let pending: Promise<void> = Promise.resolve();
function schedule<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(() => {}, () => {});
  return result;
}

/** One native lifecycle operation at a time; ordinary file I/O stays available. */
export function subscribeToFiles(
  root: string, callback: SubscribeCallback, options: Options,
  current: () => boolean = () => true,
): Promise<AsyncSubscription> {
  return schedule(async () => {
    if (!current()) return { unsubscribe: async () => {} };
    const subscription = await watcher.subscribe(root, callback, options);
    let closing: Promise<void> | undefined;
    return { unsubscribe: () => closing ??= schedule(() => subscription.unsubscribe()) };
  });
}
