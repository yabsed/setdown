import upstream from './upstream/vscode-dark-2026.json' with { type: 'json' };

/** Pinned VS Code theme, including Dark Modern → Dark+ → Dark inheritance. */
export const vscodeDark2026Colors: Readonly<Record<string, string>> = upstream.colors;

type TokenStyle = { foreground?: string; fontStyle?: string };
/** Resolve the single TextMate scopes used by our Monaco/Prism adapters.
 * More-specific inherited rules win over a later, broader rule, as in VS Code. */
export function vscodeDark2026Token(scope: string): TokenStyle {
  const result: TokenStyle = {};
  const specificity = { foreground: -1, fontStyle: -1 };
  for (const rule of upstream.tokenColors) {
    for (const selector of typeof rule.scope === 'string' ? [rule.scope] : rule.scope) {
      if (selector !== scope && !scope.startsWith(`${selector}.`)) continue;
      const settings: TokenStyle = rule.settings;
      for (const property of ['foreground', 'fontStyle'] as const) {
        if (settings[property] !== undefined && selector.length >= specificity[property]) {
          result[property] = settings[property]; specificity[property] = selector.length;
        }
      }
    }
  }
  return result;
}

export const vscodeDark2026SemanticColors = upstream.semanticTokenColors;
