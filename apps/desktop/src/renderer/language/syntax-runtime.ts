import type * as M from 'monaco-editor';
import { languageDefinitions } from '../../core/document/language-catalog';
import { grammarLoaders } from './grammar-loaders';

// The catalog owns associations and dialects. Each grammar stays a lazy local asset.

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
    // Existing Monaco tokenizers and workers keep their identity and theme rules.
    if (state.native.has(language.id)) continue;
    api.languages.register({ id: language.id, extensions: [...language.extensions, ...(language.caseSensitiveExtensions ?? [])],
      filenames: language.filenames, aliases: [language.label, language.id] });
    api.languages.setLanguageConfiguration(language.id, {
      comments: { lineComment: language.lineComment,
        blockComment: language.blockComment?.length === 2 ? language.blockComment as [string, string] : undefined },
    });
    const grammar = language.grammar as keyof typeof grammarLoaders | undefined;
    if (!grammar || !grammarLoaders[grammar]) continue;
    api.languages.onLanguage(language.id, () => {
      loading ??= import('./textmate-runtime').then(async ({ createTextMateRuntime }) => {
        backend = await createTextMateRuntime(api); backend.setTheme(theme); return backend;
      }).catch(error => { loading = undefined; throw error; });
      void loading.then(runtime => runtime.register(language.id, grammarLoaders[grammar], grammar))
        .catch(error => console.warn(`Could not load ${language.id} syntax highlighting:`, error));
    });
  }
}
