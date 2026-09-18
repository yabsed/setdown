import type { CloseDecision } from '../../protocol/desktop-api';
import { view, type ClosePromptView } from '../view-state.svelte';

type PendingPrompt = {
  view: ClosePromptView;
  promise: Promise<CloseDecision>;
  resolve(decision: CloseDecision): void;
};

/** 탭과 창 닫기가 함께 쓰는 단 하나의 비동기 확인 흐름. */
export class ClosePromptController {
  private current: PendingPrompt | null = null;
  private readonly queue: PendingPrompt[] = [];

  request(scope: ClosePromptView['scope'], names: string[]): Promise<CloseDecision> {
    let settle!: (decision: CloseDecision) => void;
    const promise = new Promise<CloseDecision>((resolve) => settle = resolve);
    const pending: PendingPrompt = {
      promise,
      resolve: settle,
      view: {
        scope,
        names: Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))),
      },
    };
    if (this.current) this.queue.push(pending);
    else {
      this.current = pending;
      view.closePrompt = pending.view;
    }
    return promise;
  }

  resolve = (decision: CloseDecision): void => {
    const pending = this.current;
    if (!pending) return;
    pending.resolve(decision);
    this.current = this.queue.shift() ?? null;
    view.closePrompt = this.current?.view ?? null;
  };
}
