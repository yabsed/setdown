import type * as M from 'monaco-editor';
export type LanguageResult = { label: string; detail: string; location?: import('../../core/editor/result-history').ResultLocation; open(): Promise<void>; children?: () => Promise<LanguageResult[]> };
export type LanguageResultsSource = { empty?: string; subscribe?(listener: () => void): () => void; title: string; load(query: string, token: M.CancellationToken): Promise<LanguageResult[]>; searchable: boolean };
export async function showLanguageResults(host: HTMLElement, source: LanguageResultsSource, restore: () => void): Promise<M.IDisposable> {
  const [{ mount, unmount }, { default: Component }] = await Promise.all([import('svelte'), import('./LanguageResults.svelte')]);
  let closed = false;
  const close = () => { if (!closed) { closed = true; void unmount(component); restore(); } };
  const component = mount(Component, { target: host, props: { source, close } });
  return { dispose: close };
}
