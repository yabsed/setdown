import type * as M from 'monaco-editor';

export class LanguageCancellation implements M.CancellationToken {
  isCancellationRequested = false;
  private listeners = new Set<() => void>();
  onCancellationRequested = (listener: () => void): M.IDisposable => { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; };
  cancel(): void { if (this.isCancellationRequested) return; this.isCancellationRequested = true; for (const listener of this.listeners) listener(); this.listeners.clear(); }
}
