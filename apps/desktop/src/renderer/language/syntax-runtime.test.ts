import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import { installSyntaxHighlighting, monacoLexicalLanguages } from './syntax-runtime';
import { syntaxThemeRules } from './syntax-themes';

test('catalog grammars replace Monaco fallback tokenizers after they settle; Markdown and Python stay engine-free', async () => {
  const activations = new Map<string, () => void>(), providers = new Map<string, M.languages.TokensProvider>();
  let settle!: () => void;
  const builtin = new Promise<string>(resolve => { settle = () => resolve(''); });
  const api = {
    editor: { colorize: vi.fn(() => builtin) },
    languages: {
      getLanguages: () => ['shell', 'yaml', ...monacoLexicalLanguages].map(id => ({ id })),
      register: vi.fn(), setLanguageConfiguration: vi.fn(),
      onLanguage: vi.fn((id: string, activate: () => void) => { activations.set(id, activate); return { dispose() {} }; }),
      setTokensProvider: vi.fn((id: string, provider: M.languages.TokensProvider) => { providers.set(id, provider); return { dispose() {} }; }),
    },
  };
  installSyntaxHighlighting(api as unknown as typeof M);
  // Monaco owns the registration and editing configuration of its languages.
  const registered = api.languages.register.mock.calls.map(([language]) => language.id);
  for (const id of ['shell', 'yaml', 'python', 'markdown']) expect(registered).not.toContain(id);
  expect(registered).toContain('svelte');
  for (const id of monacoLexicalLanguages) expect(activations.has(id), id).toBe(false);
  expect(activations.has('shell')).toBe(true); expect(activations.has('yaml')).toBe(true);
  expect(activations.has('svelte')).toBe(true);

  activations.get('shell')!();
  expect(api.editor.colorize).toHaveBeenCalledWith('', 'shell', {});
  // The grammar may be ready first. It still waits for Monaco's lazy factory,
  // whose later registration would otherwise replace it.
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(providers.has('shell')).toBe(false);
  settle();
  await expect.poll(() => providers.has('shell')).toBe(true);

  const provider = providers.get('shell')!, rules = syntaxThemeRules('setdown-github-light');
  const color = (line: string, word: string) => {
    const result = provider.tokenize(line, provider.getInitialState()), offset = line.indexOf(word);
    const token = result.tokens.filter(token => token.startIndex <= offset).at(-1)!;
    return rules.filter(rule => rule.token === token.scopes).at(-1)?.foreground;
  };
  const command = '  aws sts get-caller-identity "$account" # note';
  expect(new Set(['aws', 'sts', 'account', 'note'].map(word => color(command, word))).size).toBe(4);
  expect(color(command, 'note')).toBe('6e7781');
  // A foreign embedding state restarts the grammar instead of throwing.
  const foreign = { clone() { return this; }, equals: () => false } as M.languages.IState;
  expect(provider.tokenize('# note', foreign).tokens.at(-1)!.scopes).toContain('comment');

  // A grammar-only language has no Monaco tokenizer to wait for.
  activations.get('svelte')!();
  await expect.poll(() => providers.has('svelte')).toBe(true);
  expect(api.editor.colorize).toHaveBeenCalledTimes(1);
});
