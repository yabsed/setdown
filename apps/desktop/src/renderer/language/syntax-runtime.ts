import type * as M from 'monaco-editor';

// Add grammar data here, not language-specific branches in editor surfaces.
// Dependencies of an embedded language come from the upstream grammar bundle.
export const syntaxLanguages = [{
  id: 'svelte', extensions: ['.svelte'], aliases: ['Svelte', 'svelte'],
  load: () => import('@shikijs/langs/svelte').then(module => module.default),
}];

let theme = 'setdown-github-light';
let backend: import('./textmate-runtime').TextMateRuntime | undefined;
let loading: Promise<import('./textmate-runtime').TextMateRuntime> | undefined;
const installed = new WeakSet<typeof M>();

export function setSyntaxTheme(name: string): void {
  theme = name; backend?.setTheme(name);
}

export function installSyntaxHighlighting(api: typeof M): void {
  if (installed.has(api)) return;
  installed.add(api);
  for (const language of syntaxLanguages) {
    api.languages.register({ id: language.id, extensions: language.extensions, aliases: language.aliases });
    api.languages.onLanguage(language.id, () => {
      loading ??= import('./textmate-runtime').then(async ({ createTextMateRuntime }) => {
        backend = await createTextMateRuntime(api); backend.setTheme(theme); return backend;
      }).catch(error => { loading = undefined; throw error; });
      void loading.then(runtime => runtime.register(language.id, language.load))
        .catch(error => console.warn(`Could not load ${language.id} syntax highlighting:`, error));
    });
  }
}
