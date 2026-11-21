import type * as M from 'monaco-editor';
export type LanguageResult = { label: string; detail: string; location?: import('../../core/editor/result-history').ResultLocation; open(): Promise<void>; children?: () => Promise<LanguageResult[]> };
export type LanguageResultsSource = { empty?: string | (() => string); subscribe?(listener: () => void): () => void; title: string; load(query: string, token: M.CancellationToken): Promise<LanguageResult[]>; searchable: boolean;
  /** What the search field says while it is empty, for a list that is not of workspace symbols. */
  placeholder?: string };
/** Where a result is, for a line that is too narrow for it: what may be cut (the folders), and
 * what must stay (the file and its line). A path is cut in the middle, never at the end: the end
 * is the part that tells one result from the next. */
export function resultPlace(detail: string): { before: string; kept: string } {
  const at = Math.max(detail.lastIndexOf('/'), detail.lastIndexOf('\\'));
  return at < 0 ? { before: '', kept: detail } : { before: detail.slice(0, at + 1), kept: detail.slice(at + 1) };
}
export async function showLanguageResults(host: HTMLElement, source: LanguageResultsSource, restore: () => void): Promise<M.IDisposable> {
  const [{ mount, unmount }, { default: Component }] = await Promise.all([import('svelte'), import('./LanguageResults.svelte')]);
  let closed = false;
  const close = () => { if (!closed) { closed = true; void unmount(component); restore(); } };
  const component = mount(Component, { target: host, props: { source, close } });
  return { dispose: close };
}
