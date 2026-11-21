import type { CloseDecision } from '../../protocol/desktop-api';
import { view, type ClosePromptView } from './workspace-view.svelte';

type PendingPrompt = {
  view: ClosePromptView;
  promise: Promise<CloseDecision>;
  resolve(decision: CloseDecision): void;
};

/** 탭과 창 닫기가 함께 쓰는 단 하나의 비동기 확인 흐름. */
export class ClosePromptController {
  private current: PendingPrompt | null = null;
  private readonly queue: PendingPrompt[] = [];
  /** `layer` asks above a live web page, in a native layer of its own, so that the page goes on
   * playing. It resolves with null where no web page is showing; the shell's dialog asks then. */
  constructor(private readonly layer?: (request: ClosePromptView) => Promise<CloseDecision | null>) {}
  private show(pending: PendingPrompt): void {
    this.current = pending;
    if (!this.layer) { view.closePrompt = pending.view; return; }
    void this.layer(pending.view).catch(() => null).then(decision => {
      if (this.current !== pending) return;
      if (decision) this.resolve(decision); else view.closePrompt = pending.view;
    });
  }

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
    if (this.current) this.queue.push(pending); else this.show(pending);
    return promise;
  }

  resolve = (decision: CloseDecision): void => {
    const pending = this.current;
    if (!pending) return;
    pending.resolve(decision);
    view.closePrompt = null;
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (next) this.show(next);
  };
}
