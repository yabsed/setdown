import type * as M from 'monaco-editor';

/** Text a tool made for reading: an expanded macro, a syntax tree, compiled code. VS Code opens
 * such text as a read-only document beside the editor; here it is a read-only panel over it.
 * `image`: an SVG the tool drew, shown as a picture instead of its source. */
export type LanguageTextSource = { title: string; text: string; languageId?: string; image?: boolean };
export async function showLanguageText(api: typeof M, host: HTMLElement, source: LanguageTextSource, restore: () => void): Promise<M.IDisposable> {
  const [{ mount, unmount }, { default: Component }] = await Promise.all([import('svelte'), import('./LanguageText.svelte')]);
  // Colouring is the editor's own, for the languages it has a grammar for; long text stays plain.
  const known = !!source.languageId && api.languages.getLanguages().some(language => language.id === source.languageId);
  const html = !source.image && known && source.text.length <= 200_000
    ? await api.editor.colorize(source.text, source.languageId!, { tabSize: 4 }).catch(() => undefined) : undefined;
  let closed = false;
  const close = () => { if (!closed) { closed = true; void unmount(component); restore(); } };
  const component = mount(Component, { target: host, props: { source, html, close } });
  return { dispose: close };
}

/** One line the person types: the query of a structural search, the name of a new component.
 * `validate` returns what is wrong with the text so far, or nothing. Resolves with the text on
 * Enter and with nothing when the person leaves. */
export type LanguageInputSource = { title: string; prompt?: string; value?: string; placeholder?: string; validate?(value: string): Promise<string | undefined> };
export async function askLanguageInput(host: HTMLElement, source: LanguageInputSource, restore: () => void): Promise<string | undefined> {
  const [{ mount, unmount }, { default: Component }] = await Promise.all([import('svelte'), import('./LanguageInput.svelte')]);
  return new Promise(resolve => {
    let closed = false;
    const finish = (value?: string) => { if (!closed) { closed = true; void unmount(component); restore(); resolve(value); } };
    const component = mount(Component, { target: host, props: { source, finish } });
  });
}
