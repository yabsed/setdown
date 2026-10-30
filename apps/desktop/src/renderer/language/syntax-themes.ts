import type { ThemeRegistration } from '@shikijs/core';
import type { editor } from 'monaco-editor';
import { THEME_PROFILES } from '../../core/theme/theme-catalog';
import vscode from '../../core/theme/upstream/vscode-dark-2026.json' with { type: 'json' };

// TextMate tokens have their own namespace. Existing Monarch and LSP rules
// remain authoritative for their providers, even when they share a color.
export const syntaxScope = (scope: string) => `setdown.syntax${scope ? `.${scope}` : ''}`;
export const syntaxThemes: ThemeRegistration[] = THEME_PROFILES.map(({ id, appearance, palette, syntax, vscodeTheme }) => ({
  name: `setdown-${id}`, type: appearance,
  colors: { 'editor.foreground': syntax.foreground, 'editor.background': palette.editorBackground },
  tokenColors: vscodeTheme?.tokenColors ?? (id === 'vscode-dark-2026' ? vscode.tokenColors : [
    { scope: 'comment', settings: { foreground: syntax.comment, fontStyle: 'italic' } },
    { scope: ['keyword', 'storage'], settings: { foreground: syntax.keyword } },
    { scope: ['string', 'constant.other.symbol'], settings: { foreground: syntax.string } },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: syntax.number } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.name.tag'], settings: { foreground: syntax.heading } },
    { scope: ['entity.name.function', 'support.function', 'variable.function'], settings: { foreground: syntax.link } },
    { scope: ['entity.other.attribute-name', 'support.type.property-name'], settings: { foreground: syntax.code } },
    { scope: ['variable', 'meta.object-literal.key'], settings: { foreground: syntax.foreground } },
    { scope: ['punctuation', 'keyword.operator'], settings: { foreground: syntax.punctuation } },
    { scope: 'constant.character.escape', settings: { foreground: syntax.number } },
  ]),
}));

/** No engine import: registering the app's themes must stay cheap for Markdown. */
export function syntaxThemeRules(name: string): editor.ITokenThemeRule[] {
  const theme = syntaxThemes.find(theme => theme.name === name);
  if (!theme) return [];
  const rules = new Map<string, editor.ITokenThemeRule>();
  rules.set('', { token: syntaxScope(''), foreground: theme.colors!['editor.foreground'].slice(1), fontStyle: '' });
  for (const { scope, settings } of theme.tokenColors ?? []) {
    for (const token of Array.isArray(scope) ? scope : scope ? [scope] : []) {
      // A later font-only rule (Night Owl uses these) retains the earlier
      // color of that exact scope, just as Monaco's token trie does.
      const rule = rules.get(token) ?? { token: syntaxScope(token) };
      if (settings.foreground) rule.foreground = settings.foreground.slice(1);
      rule.fontStyle = settings.fontStyle ?? '';
      rules.set(token, rule);
    }
  }
  return [...rules.values()];
}
