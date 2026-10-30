import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from '@shikijs/core';
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma';
import { shikiToMonaco } from '@shikijs/monaco';
import type * as M from 'monaco-editor';
import { syntaxScope, syntaxThemes } from './syntax-themes';

type RuleStack = ReturnType<ReturnType<HighlighterCore['getLanguage']>['tokenizeLine2']>['ruleStack'];
type AdapterState = M.languages.IState & { readonly ruleStack: RuleStack };

/** The pinned upstream adapter compares wrapper identity. Monaco needs value
 * equality so an edit stops retokenizing once the unchanged grammar state returns. */
class SyntaxState implements M.languages.IState {
  constructor(readonly value: AdapterState) {}
  clone() { return this; } // TextMate stacks are immutable.
  equals(other: M.languages.IState) { return other instanceof SyntaxState && this.value.ruleStack.equals(other.value.ruleStack); }
}

export class TextMateRuntime {
  private theme = syntaxThemes[0].name!;
  private readonly providers = new Map<string, { provider: M.languages.TokensProvider; dispose: M.IDisposable; setTheme(name: string): void }>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly api: typeof M, private readonly highlighter: HighlighterCore) {}

  setTheme(name: string): void {
    if (name === this.theme) return;
    this.theme = name;
    for (const [id, entry] of this.providers) {
      entry.setTheme(name);
      // Re-register tokenization, not the model: cached scopes may have been
      // matched by color under the previous theme. Undo/selection remain intact.
      entry.dispose.dispose();
      entry.dispose = this.api.languages.setTokensProvider(id, entry.provider);
    }
  }

  register(id: string, load: () => Promise<LanguageRegistration[]>): Promise<void> {
    if (this.providers.has(id)) return Promise.resolve();
    const current = this.pending.get(id); if (current) return current;
    const promise = (async () => {
      await this.highlighter.loadLanguage(...await load());
      let raw: M.languages.TokensProvider | undefined;
      // Shiki's convenience adapter replaces editor.create/setTheme and every
      // loaded language. Give it a private facade: only the requested provider
      // crosses into Monaco; existing themes, workers and providers stay owned
      // by Setdown. Its theme selection still uses the official adapter.
      const facade = {
        editor: { defineTheme() {}, setTheme(_name: string) {}, create() {} },
        languages: { getLanguages: () => [{ id }], setTokensProvider: (_id: string, provider: M.languages.TokensProvider) => { raw = provider; } },
      };
      shikiToMonaco(this.highlighter, facade as unknown as Parameters<typeof shikiToMonaco>[1], { tokenizeMaxLineLength: 20_000 });
      facade.editor.setTheme(this.theme);
      if (!raw) throw Error(`No TextMate tokenizer registered for ${id}.`);
      const source = raw;
      const provider: M.languages.TokensProvider = {
        getInitialState: () => new SyntaxState(source.getInitialState() as AdapterState),
        tokenize: (line, state) => {
          const result = source.tokenize(line, (state as SyntaxState).value);
          return { endState: new SyntaxState(result.endState as AdapterState),
            tokens: result.tokens.map(token => ({ ...token, scopes: syntaxScope(token.scopes) })) };
        },
      };
      const dispose = this.api.languages.setTokensProvider(id, provider);
      this.providers.set(id, { provider, dispose, setTheme: name => facade.editor.setTheme(name) });
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, promise); return promise;
  }
}

export async function createTextMateRuntime(api: typeof M): Promise<TextMateRuntime> {
  const highlighter = await createHighlighterCore({ themes: syntaxThemes, langs: [],
    engine: createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')) });
  return new TextMateRuntime(api, highlighter);
}
