import { expect, test, vi } from 'vitest';
import watcher, { type AsyncSubscription } from '@parcel/watcher';
import { subscribeToFiles } from './native-watcher';

test('slow native registration cannot fill the I/O pool with waiting registrations and obsolete roots are skipped', async () => {
  let finish!: (subscription: AsyncSubscription) => void;
  const unsubscribe = vi.fn(async () => {});
  const subscribe = vi.spyOn(watcher, 'subscribe').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ unsubscribe });
  let current = true;
  try {
    const first = subscribeToFiles('/large', () => {}, {});
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    const obsolete = subscribeToFiles('/previous', () => {}, {}, () => current);
    const next = subscribeToFiles('/current', () => {}, {});
    const metadata = subscribeToFiles('/current/.git', () => {}, {});
    current = false;
    await Promise.resolve(); await Promise.resolve();
    expect(subscribe).toHaveBeenCalledOnce();
    finish({ unsubscribe });
    const subscriptions = await Promise.all([first, obsolete, next, metadata]);
    expect(subscribe.mock.calls.map(call => call[0])).toEqual(['/large', '/current', '/current/.git']);
    await Promise.all(subscriptions.map(subscription => subscription.unsubscribe()));
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  } finally { finish?.({ unsubscribe }); subscribe.mockRestore(); }
});

test('native teardown is serialized with registration and a failure does not block the next root', async () => {
  let finish!: () => void;
  const unsubscribe = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const subscribe = vi.spyOn(watcher, 'subscribe').mockResolvedValueOnce({ unsubscribe })
    .mockRejectedValueOnce(new Error('Unavailable root')).mockResolvedValue({ unsubscribe: async () => {} });
  try {
    const first = await subscribeToFiles('/first', () => {}, {});
    const closing = first.unsubscribe();
    expect(first.unsubscribe()).toBe(closing);
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
    const failed = expect(subscribeToFiles('/missing', () => {}, {})).rejects.toThrow('Unavailable root');
    const next = subscribeToFiles('/next', () => {}, {});
    await Promise.resolve(); await Promise.resolve();
    expect(subscribe).toHaveBeenCalledOnce();
    finish(); await closing; await failed; await (await next).unsubscribe();
    expect(subscribe).toHaveBeenCalledTimes(3);
  } finally { finish?.(); subscribe.mockRestore(); }
});
