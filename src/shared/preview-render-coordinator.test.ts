import { describe, expect, it, vi } from 'vitest';
import { PreviewRenderCoordinator } from './preview-render-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('PreviewRenderCoordinator', () => {
  it('이미 준비된 revision을 다시 렌더링하지 않는다', async () => {
    const execute = vi.fn(async () => true);
    const coordinator = new PreviewRenderCoordinator(execute);

    expect(await coordinator.ensure(3)).toBe(true);
    expect(await coordinator.ensure(3)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('같은 revision의 진행 중 작업을 공유한다', async () => {
    const gate = deferred<boolean>();
    const execute = vi.fn(() => gate.promise);
    const coordinator = new PreviewRenderCoordinator(execute);

    const first = coordinator.ensure(7);
    const second = coordinator.ensure(7);
    expect(execute).toHaveBeenCalledTimes(1);

    gate.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('공유한 작업이 실패해도 같은 revision을 중복 실행하지 않는다', async () => {
    const gate = deferred<boolean>();
    const execute = vi.fn(() => gate.promise);
    const coordinator = new PreviewRenderCoordinator(execute);

    const first = coordinator.ensure(8);
    const second = coordinator.ensure(8);
    gate.resolve(false);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('진행 중 들어온 중간 revision을 버리고 최신 요청만 실행한다', async () => {
    const firstGate = deferred<boolean>();
    const calls: number[] = [];
    const execute = vi.fn(async (revision: number) => {
      calls.push(revision);
      if (revision === 1) return firstGate.promise;
      return true;
    });
    const coordinator = new PreviewRenderCoordinator(execute);

    const first = coordinator.ensure(1);
    const second = coordinator.ensure(2);
    const latest = coordinator.ensure(3);
    firstGate.resolve(true);

    await Promise.all([first, second, latest]);
    expect(calls).toEqual([1, 3]);
    expect(coordinator.readyRevision).toBe(3);
  });

  it('reset 뒤에는 같은 revision도 다시 준비한다', async () => {
    const execute = vi.fn(async () => true);
    const coordinator = new PreviewRenderCoordinator(execute);

    await coordinator.ensure(4);
    coordinator.reset();
    await coordinator.ensure(4);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('진행 중 reset된 뒤 같은 번호의 새 revision을 다시 준비한다', async () => {
    const oldGate = deferred<boolean>();
    let call = 0;
    const execute = vi.fn(async () => {
      call += 1;
      if (call === 1) return oldGate.promise;
      return true;
    });
    const coordinator = new PreviewRenderCoordinator(execute);

    const oldDocument = coordinator.ensure(0);
    coordinator.reset();
    const newDocument = coordinator.ensure(0);
    oldGate.resolve(false);

    await oldDocument;
    await expect(newDocument).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
