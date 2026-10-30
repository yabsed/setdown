import { themeProfile } from '../core/theme/theme-catalog';
import { vscodeToken } from '../core/theme/vscode-token';
import { vscodeDark2026Colors as colors, vscodeDark2026Token } from '../core/theme/vscode-dark-2026';

const token = (scope: string) => vscodeDark2026Token(scope).foreground;
// Crossnote retains its document layout. Only this theme's colors supplement
// its GitHub Dark base, including Prism code blocks in ordinary/Git readers.
const previewCss = (colors: Readonly<Record<string, string>>, token: (scope: string) => string | undefined) => `
  .markdown-preview.markdown-preview { color: ${colors['editor.foreground']}; background-color: ${colors['editor.background']}; }
  .markdown-preview :is(h1,h2,h3,h4,h5,h6) { color: ${colors['editor.foreground']}; border-color: ${colors['textSeparator.foreground']}; }
  .markdown-preview a { color: ${colors['textLink.foreground']}; }
  .markdown-preview a:hover { color: ${colors['textLink.activeForeground']}; }
  .markdown-preview blockquote { color: ${colors.foreground}; background-color: ${colors['textBlockQuote.background']}; border-color: ${colors['textBlockQuote.border']}; }
  .markdown-preview :is(code,tt,kbd) { color: ${colors['textPreformat.foreground']}; background-color: ${colors['textPreformat.background']}; }
  .markdown-preview pre, .markdown-preview pre[class*="language-"] { color: ${colors['editor.foreground']}; background-color: ${colors['textCodeBlock.background']}; }
  .markdown-preview pre > code, .markdown-preview code[class*="language-"] { color: ${colors['editor.foreground']}; background: transparent; text-shadow: none; }
  .markdown-preview :is(th,td,hr) { border-color: ${colors['textSeparator.foreground']}; }
  .markdown-preview table tr { background: transparent; border-color: ${colors['textSeparator.foreground']}; }
  .markdown-preview table tr:nth-child(2n) { background: ${colors['textBlockQuote.background']}; }
  .markdown-preview .token.comment, .markdown-preview .token.prolog { color: ${token('comment')}; font-style: normal; }
  .markdown-preview .token.keyword { color: ${token('keyword')}; }
  .markdown-preview .token.string, .markdown-preview .token.attr-value { color: ${token('string')}; }
  .markdown-preview .token.number { color: ${token('constant.numeric')}; }
  .markdown-preview .token.boolean { color: ${token('constant.language')}; }
  .markdown-preview .token.function { color: ${token('entity.name.function')}; }
  .markdown-preview .token.class-name { color: ${token('entity.name.type')}; }
  .markdown-preview .token.tag { color: ${token('entity.name.tag')}; }
  .markdown-preview .token.attr-name { color: ${token('entity.other.attribute-name')}; }
  .markdown-preview .token.operator, .markdown-preview .token.punctuation { color: ${colors['editor.foreground']}; }
`;

const styles = new Map<string, string>([['vscode-dark-2026', previewCss(colors, token)]]);

export function applyVscodePreviewTheme(themeId: string): void {
  const existing = document.getElementById('setdown-vscode-preview-theme');
  const theme = themeProfile(themeId).vscodeTheme;
  if (themeId !== 'vscode-dark-2026' && !theme) { existing?.remove(); return; }
  if (!styles.has(themeId) && theme) styles.set(themeId, previewCss({ ...theme.colors, 'textCodeBlock.background': theme.colors['editor.background'] }, scope =>
    vscodeToken(theme, scope).foreground ?? theme.colors['editor.foreground']));
  const css = styles.get(themeId)!;
  if (existing?.textContent === css) return;
  const style = existing ?? document.createElement('style');
  style.id = 'setdown-vscode-preview-theme'; style.textContent = css;
  if (!existing) document.head.append(style);
}
