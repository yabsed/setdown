import { vscodeToken, type VscodeTheme } from '../../core/theme/vscode-token';
import type { editor } from 'monaco-editor';
import { vscodeDark2026Colors, vscodeDark2026Token, vscodeDark2026SemanticColors } from '../../core/theme/vscode-dark-2026';

// Monaco's lexical/LSP token names differ from TextMate. Resolve their VS Code
// scopes instead of collapsing types, functions and variables into one color.
const scopes: Record<string, string> = {
  comment: 'comment', keyword: 'keyword', 'keyword.control': 'keyword.control', modifier: 'storage.modifier',
  string: 'string', 'string.escape': 'constant.character.escape', number: 'constant.numeric',
  regexp: 'string.regexp', 'regexp.escape': 'constant.character.escape',
  type: 'entity.name.type', class: 'entity.name.type.class', interface: 'entity.name.type.interface',
  enum: 'entity.name.type.enum', struct: 'entity.name.type.struct', typeParameter: 'entity.name.type',
  namespace: 'entity.name.namespace', function: 'entity.name.function', method: 'entity.name.function',
  macro: 'entity.name.function.preprocessor', decorator: 'entity.name.function',
  variable: 'variable.other.readwrite', parameter: 'variable.parameter.function',
  property: 'variable.other.property', event: 'variable.other.event',
  'variable.readonly': 'variable.other.constant', 'property.readonly': 'variable.other.constant', enumMember: 'variable.other.enummember',
  tag: 'entity.name.tag', 'attribute.name': 'entity.other.attribute-name', 'attribute.value': 'string',
  'string.key.json': 'support.type.property-name.json', 'string.value.json': 'string',
  'keyword.json': 'constant.language', 'string.link': 'string.other.link',
  'markup.heading.markdown': 'markup.heading', 'markup.inline.raw.markdown': 'markup.inline.raw',
  'keyword.md': 'markup.heading', 'string.md': 'markup.inline.raw',
};

export const vscodeMonacoTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark', inherit: true,
  // Keep every upstream editor/widget/selection/diff color verbatim. Unknown
  // workbench roles are harmless; Monaco uses the same color registry names.
  colors: { ...vscodeDark2026Colors },
  rules: [
    { token: '', foreground: vscodeDark2026Colors['editor.foreground'].slice(1), fontStyle: '' },
    { token: 'delimiter', foreground: vscodeDark2026Colors['editor.foreground'].slice(1) },
    { token: 'operator', foreground: vscodeDark2026Colors['editor.foreground'].slice(1) },
    ...Object.entries(scopes).map(([token, scope]) => {
      const style = vscodeDark2026Token(scope);
      return { token, foreground: style.foreground?.slice(1), fontStyle: style.fontStyle ?? '' };
    }),
    ...Object.entries(vscodeDark2026SemanticColors).map(([token, color]) => ({ token, foreground: color.slice(1) })),
  ],
};

export function communityMonacoTheme(theme: VscodeTheme): editor.IStandaloneThemeData {
  const foreground = theme.colors['editor.foreground'].slice(1);
  return { base: theme.type === 'light' ? 'vs' : 'vs-dark', inherit: true, colors: { ...theme.colors }, rules: [
    { token: '', foreground, fontStyle: '' },
    ...Object.entries({ ...scopes, delimiter: 'punctuation', operator: 'keyword.operator' }).map(([token, scope]) => {
      const style = vscodeToken(theme, scope);
      return { token, foreground: style.foreground?.slice(1) ?? foreground, fontStyle: style.fontStyle ?? '' };
    }),
    ...Object.entries(theme.semanticTokenColors ?? {}).map(([token, color]) => ({ token, foreground: color.slice(1) })),
  ] };
}
