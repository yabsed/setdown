import { expect, test, vi } from 'vitest';
import { PreviewLayoutCoordinator } from './preview-layout-coordinator';
import type { DesktopPort } from '../ports/desktop-port';
const bounds = (x: number) => ({ x, y: 80, width: 400, height: 600 });
test('hiding or freezing one review preserves the ordinary reader and other review groups', () => {
  const show = vi.fn();
  const coordinator = new PreviewLayoutCoordinator(Object.freeze({ showPreview: show }) as unknown as DesktopPort);
  const documents = coordinator.port('documents'), left = coordinator.port('left'), right = coordinator.port('right');
  documents.showPreview('file', bounds(0)); left.showPreview('review-a', bounds(400)); right.showPreview('review-b', bounds(800));
  coordinator.focus('left');
  expect(show.mock.lastCall?.slice(0, 3)).toEqual(['review-a', bounds(400), [{ tabId: 'file', bounds: bounds(0) }, { tabId: 'review-b', bounds: bounds(800) }]]);
  left.showPreview(null, null);
  expect(show.mock.lastCall?.slice(0, 3)).toEqual([null, null, [{ tabId: 'file', bounds: bounds(0) }, { tabId: 'review-b', bounds: bounds(800) }]]);
  coordinator.remove('right');
  expect(show.mock.lastCall?.[2]).toEqual([{ tabId: 'file', bounds: bounds(0) }]);
  coordinator.focus('documents'); expect(show.mock.lastCall?.[0]).toBe('file');
});
test('merges live group geometry and removes stale guides when a contribution closes', () => {
  const show = vi.fn(); const coordinator = new PreviewLayoutCoordinator({ showPreview: show } as unknown as DesktopPort);
  for (const [owner, x] of [['documents', 0], ['review', 400]] as const) coordinator.port(owner).showPreview(owner, bounds(x), [], {
    viewport: { width: 800, height: 700 }, area: bounds(x), previews: [{ tabId: owner, bounds: bounds(x), group: bounds(x) }],
  });
  expect(show.mock.lastCall?.[3].area).toEqual({ x: 0, y: 80, width: 800, height: 600 });
  expect(show.mock.lastCall?.[3].previews).toHaveLength(2);
  coordinator.remove('review'); expect(show.mock.lastCall?.[3].previews).toHaveLength(1);
});
