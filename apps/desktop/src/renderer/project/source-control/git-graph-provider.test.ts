import { expect, test, vi } from 'vitest';
import type { DesktopPort } from '../../ports/desktop-port';
import { ElectronGitGraphProvider } from './git-graph-provider';

test('disposing a graph cancels in-flight requests and discards late replies', async () => {
  let finish!: (value: unknown) => void;
  const requestGitGraph = vi.fn((_request: { id: string }) => new Promise((resolve) => { finish = resolve; }));
  const cancelGitGraph = vi.fn();
  const provider = new ElectronGitGraphProvider({ requestGitGraph, cancelGitGraph } as unknown as DesktopPort, '/project');
  const pending = provider.getHistory();
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  provider.dispose();
  await rejection;
  expect(cancelGitGraph).toHaveBeenCalledWith(requestGitGraph.mock.calls[0][0].id);
  finish({ commits: [{ oid: 'stale' }] });
  await expect(provider.getHistory()).rejects.toMatchObject({ name: 'AbortError' });
  expect(requestGitGraph).toHaveBeenCalledTimes(1);
});
