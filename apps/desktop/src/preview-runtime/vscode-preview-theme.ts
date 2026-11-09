import { themeProfile } from '../core/theme/theme-catalog';
import { vscodeToken } from '../core/theme/vscode-token';

import { previewCss, styles } from '../core/theme/preview-theme-css';

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
