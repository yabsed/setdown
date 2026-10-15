import type * as M from 'monaco-editor';
export type LanguageResult = { label: string; detail: string; open(): Promise<void>; children?: () => Promise<LanguageResult[]> };
export type LanguageResultsSource = { title: string; load(query: string, token: M.CancellationToken): Promise<LanguageResult[]>; searchable: boolean };
export class LanguageCancellation implements M.CancellationToken {
  isCancellationRequested = false;
  private listeners = new Set<() => void>();
  onCancellationRequested = (listener: () => void): M.IDisposable => { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; };
  cancel(): void { if (this.isCancellationRequested) return; this.isCancellationRequested = true; for (const listener of this.listeners) listener(); this.listeners.clear(); }
}
export async function showLanguageResults(host: HTMLElement, source: LanguageResultsSource, restore: () => void): Promise<M.IDisposable> {
  const [{ mount, unmount }, { default: Component }] = await Promise.all([import('svelte'), import('./LanguageResults.svelte')]);
  let closed = false;
  const close = () => { if (!closed) { closed = true; void unmount(component); restore(); } };
  const component = mount(Component, { target: host, props: { source, close } });
  return { dispose: close };
}
