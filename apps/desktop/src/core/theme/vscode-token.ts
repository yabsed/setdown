export type VscodeTokenStyle = { foreground?: string; background?: string; fontStyle?: string };
export type VscodeTokenRule = { scope?: string | string[]; settings: VscodeTokenStyle };
export type VscodeTheme = {
  type?: 'light' | 'dark';
  colors: Record<string, string>;
  tokenColors: VscodeTokenRule[];
  semanticTokenColors?: Record<string, string>;
};

/** Resolve a single lexical/LSP role; full TextMate scope stacks stay in Shiki. */
export function vscodeToken(theme: VscodeTheme, scope: string): VscodeTokenStyle {
  const result: VscodeTokenStyle = {};
  const specificity = { foreground: -1, background: -1, fontStyle: -1 };
  for (const rule of theme.tokenColors) {
    const selectors = (Array.isArray(rule.scope) ? rule.scope : [rule.scope ?? ''])
      .flatMap(selector => selector.split(',').map(value => value.trim()));
    for (const selector of selectors) {
      if (selector && selector !== scope && !scope.startsWith(`${selector}.`)) continue;
      for (const property of ['foreground', 'background', 'fontStyle'] as const) {
        if (rule.settings[property] !== undefined && selector.length >= specificity[property]) {
          result[property] = rule.settings[property]; specificity[property] = selector.length;
        }
      }
    }
  }
  return result;
}
