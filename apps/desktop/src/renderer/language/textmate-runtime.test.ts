import { beforeAll, expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import { createTextMateRuntime, type TextMateRuntime } from './textmate-runtime';
import { syntaxScope, syntaxThemeRules, syntaxThemes } from './syntax-themes';

const providers = new Map<string, M.languages.TokensProvider>();
const api = { editor: { create: vi.fn(), setTheme: vi.fn(), defineTheme: vi.fn() }, languages: {
  setTokensProvider: vi.fn((id: string, provider: M.languages.TokensProvider) => { providers.set(id, provider); return { dispose: vi.fn() }; }),
} };
let runtime: TextMateRuntime;
beforeAll(async () => {
  runtime = await createTextMateRuntime(api as unknown as typeof M);
  await runtime.register('svelte', () => import('@shikijs/langs/svelte').then(module => module.default));
});
function tokenize(lines: string[], theme = 'setdown-github-light') {
  runtime.setTheme(theme);
  const provider = providers.get('svelte')!, rules = syntaxThemeRules(theme);
  let state = provider.getInitialState();
  return lines.map(line => {
    const result = provider.tokenize(line, state); state = result.endState;
    return { state, tokens: result.tokens, color: (word: string) => {
      const offset = line.indexOf(word); expect(offset).toBeGreaterThanOrEqual(0);
      const token = result.tokens.filter(token => token.startIndex <= offset).at(-1)!;
      return rules.filter(rule => rule.token === token.scopes).at(-1)?.foreground;
    } };
  });
}

test('upstream grammar colors TypeScript, Svelte blocks, attributes, expressions and CSS without an LSP', () => {
  const lines = tokenize(['<script lang="ts">', 'import type { Color } from "./types";', 'let count = $state(2);', '// a comment',
    '</script>', '{#if count > 0}', '<button class="count" onclick={() => count++}>{count}</button>', '{/if}',
    '<style>', 'button { color: red; margin: 2px; }', '</style>']);
  expect(lines[0].color('script')).toBe('8250df');
  expect(lines[1].color('import')).toBe('cf222e'); expect(lines[1].color('./types')).toBe('0a3069');
  expect(lines[2].color('let')).toBe('cf222e'); expect(lines[2].color('2')).toBe('0550ae');
  expect(lines[3].color('a comment')).toBe('6e7781'); expect(lines[5].color('if')).toBe('cf222e');
  expect(lines[6].color('button')).toBe('8250df'); expect(lines[6].color('class')).toBe('116329');
  expect(lines[9].color('color')).not.toBe('24292f'); expect(lines[9].color('2')).toBe('0550ae');
});

test('theme changes use current TextMate rules without replacing existing Monaco or semantic providers', () => {
  const create = api.editor.create, setTheme = api.editor.setTheme;
  for (const theme of syntaxThemes) {
    const [, code] = tokenize(['<script lang="ts">', 'const message = "hello";'], theme.name!);
    expect(code.color('const')).toBeTruthy(); expect(code.color('hello')).toBeTruthy();
    expect(code.color('const')).not.toBe(code.color('hello'));
    expect(code.tokens.every(token => token.scopes.startsWith(syntaxScope('')))).toBe(true);
  }
  expect(api.editor.create).toBe(create); expect(api.editor.setTheme).toBe(setTheme);
  expect(api.editor.defineTheme).not.toHaveBeenCalled();
  expect(new Set(api.languages.setTokensProvider.mock.calls.map(([id]) => id))).toEqual(new Set(['svelte']));
  const light = tokenize(['<script lang="ts">', 'const message = "hello";'])[1];
  expect(light.color('const')).toBe('cf222e');
});

test('equivalent multiline grammar states stop invalidation; comments and long lines preserve the correct state', () => {
  const lines = tokenize(['<script lang="ts">', 'let first = 1;', 'let second = 2;', '/* comment', 'still comment', '*/ let last = 3;']);
  expect(lines[1].state.equals(lines[2].state)).toBe(true);
  expect(lines[1].state.clone().equals(lines[1].state)).toBe(true);
  expect(lines[2].state.equals(lines[3].state)).toBe(false);
  expect(lines[4].color('still')).toBe('6e7781'); expect(lines[5].color('let')).toBe('cf222e');
  const provider = providers.get('svelte')!, long = provider.tokenize('x'.repeat(20_000), lines[3].state);
  expect(long.endState.equals(lines[3].state)).toBe(true);
  expect(provider.tokenize('still comment', long.endState).tokens[0].scopes).toContain('comment');
});

test('registration coalesces concurrent requests and retries a failed grammar load', async () => {
  const local = await createTextMateRuntime(api as unknown as typeof M);
  const load = vi.fn(async () => { throw Error('fixture load failure'); });
  const a = local.register('svelte', load), b = local.register('svelte', load);
  expect(a).toBe(b); await expect(a).rejects.toThrow('fixture load failure'); expect(load).toHaveBeenCalledTimes(1);
  await local.register('svelte', () => import('@shikijs/langs/svelte').then(module => module.default));
});
