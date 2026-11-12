import type * as M from 'monaco-editor';
import { languageDefinitions } from '../../core/document/language-catalog';
import { grammarLoaders } from './grammar-loaders';

// The catalog owns associations and dialects. Each grammar stays a lazy local asset.

/** Monaco keeps lexical ownership only where its language identity carries more
 * than a tokenizer: built-in workers and embedded-language modes, and the
 * Markdown/Python surfaces whose engine-free loading is contractual. Every other
 * built-in Monarch tokenizer is a coarse fallback (shell colors neither commands,
 * options nor expansions) and must not shadow the catalog's TextMate grammar. */
export const monacoLexicalLanguages: ReadonlySet<string> = new Set([
  'markdown', 'python', 'javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html']);

let theme = 'setdown-github-light';
let backend: import('./textmate-runtime').TextMateRuntime | undefined;
let loading: Promise<import('./textmate-runtime').TextMateRuntime> | undefined;
const installed = new WeakMap<typeof M,{native:Set<string>;ids:Set<string>}>();

export function setSyntaxTheme(name: string): void {
  theme = name; backend?.setTheme(name);
}

export function installSyntaxHighlighting(api: typeof M): void {
  let state=installed.get(api);
  if(!state){state={native:new Set(api.languages.getLanguages().map(language=>language.id)),ids:new Set()};installed.set(api,state);}
  for (const language of languageDefinitions) {
    if(state.ids.has(language.id))continue;state.ids.add(language.id);
    // Monaco's registration, editing configuration and workers keep their identity.
    const native = state.native.has(language.id);
    if (native && monacoLexicalLanguages.has(language.id)) continue;
    if (!native) {
      api.languages.register({ id: language.id, extensions: [...language.extensions, ...(language.caseSensitiveExtensions ?? [])],
        filenames: language.filenames, aliases: [language.label, language.id] });
      api.languages.setLanguageConfiguration(language.id, {
        comments: { lineComment: language.lineComment,
          blockComment: language.blockComment?.length === 2 ? language.blockComment as [string, string] : undefined },
      });
    }
    const grammar = language.grammar as keyof typeof grammarLoaders | undefined;
    if (!grammar || !grammarLoaders[grammar]) continue;
    api.languages.onLanguage(language.id, () => {
      loading ??= import('./textmate-runtime').then(async ({ createTextMateRuntime }) => {
        backend = await createTextMateRuntime(api); backend.setTheme(theme); return backend;
      }).catch(error => { loading = undefined; throw error; });
      // Monaco installs a built-in tokenizer through a lazy factory, and the last
      // registration wins. Colorizing awaits that factory, so the grammar always
      // registers second; a failed grammar load leaves Monaco's tokenizer in place.
      const settled = native ? Promise.resolve(api.editor.colorize('', language.id, {})).catch(() => {}) : Promise.resolve();
      void Promise.all([loading, settled]).then(([runtime]) => runtime.register(language.id, grammarLoaders[grammar], grammar))
        .catch(error => console.warn(`Could not load ${language.id} syntax highlighting:`, error));
    });
  }
}
