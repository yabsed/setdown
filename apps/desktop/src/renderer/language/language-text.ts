// A tool's text for reading opens as a document beside the code (`LanguageApi.answer`); what stays
// over the editor is only a question to the person.

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
