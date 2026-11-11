import { MARKDOWN_FONT_SIZE } from '../../core/theme/typography';
import { themeProfile } from '../../core/theme/theme-catalog';
import { vscodePreviewThemeCss } from '../../core/theme/preview-theme-css';

// Load the same installed Crossnote assets as native Markdown previews. Keep
// these lazy so opening a Markdown document does not load web-reader themes.
const preview = {
  'github-light.css': () => import('@crossnote-styles/preview_theme/github-light.css?inline'),
  'github-dark.css': () => import('@crossnote-styles/preview_theme/github-dark.css?inline'),
  'newsprint.css': () => import('@crossnote-styles/preview_theme/newsprint.css?inline'),
  'medium.css': () => import('@crossnote-styles/preview_theme/medium.css?inline'),
  'night.css': () => import('@crossnote-styles/preview_theme/night.css?inline'),
  'one-dark.css': () => import('@crossnote-styles/preview_theme/one-dark.css?inline'),
  'solarized-light.css': () => import('@crossnote-styles/preview_theme/solarized-light.css?inline'),
  'solarized-dark.css': () => import('@crossnote-styles/preview_theme/solarized-dark.css?inline'),
};
const code: Record<string, () => Promise<{ default: string }>> = {
  'github.css': () => import('@crossnote-styles/prism_theme/github.css?inline'),
  'github-dark.css': () => import('@crossnote-styles/prism_theme/github-dark.css?inline'),
  'pen-paper-coffee.css': () => import('@crossnote-styles/prism_theme/pen-paper-coffee.css?inline'),
  'darcula.css': () => import('@crossnote-styles/prism_theme/darcula.css?inline'),
  'one-dark.css': () => import('@crossnote-styles/prism_theme/one-dark.css?inline'),
  'solarized-light.css': () => import('@crossnote-styles/prism_theme/solarized-light.css?inline'),
  'solarized-dark.css': () => import('@crossnote-styles/prism_theme/solarized-dark.css?inline'),
};
const cache = new Map<string, Promise<string>>();

export function readerThemeCss(themeId: string): Promise<string> {
  const profile = themeProfile(themeId);
  let pending = cache.get(profile.id);
  if (!pending) {
    pending = Promise.all([preview[profile.preview.stylesheet](), code[profile.preview.prismStylesheet](),
      import('@crossnote-styles/style-template.css?inline')])
      .then(([preview, code, document]) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync([preview.default, code.default, document.default, vscodePreviewThemeCss(profile.id)].join('\n'));
        // Rebase parsed selectors through CSSOM. @scope confines even
        // unqualified Prism rules to this
        // article, without putting its text/selection inside a shadow root.
        const rebase = (rules: CSSRuleList) => {
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
              // :is keeps the original type-selector specificity. Replacing
              // body with a class would overpower Prism and imported colors.
              rule.selectorText = rule.selectorText.replace(/\bhtml\s+body\b|\bbody\b/g,
                selector => `:is(${selector}, :where(:scope))`)
                .replace(/\.markdown-preview/g, '.web-reader-content');
              // Native tab zoom scales fixed lengths too; rem is rooted at
              // Markdown's 14px document, rather than the shell's root size.
              // --reader-scale also carries Reader's larger body (20/14).
              for (const property of [...rule.style]) {
                const value = rule.style.getPropertyValue(property).replace(/(-?\d*\.?\d+)(px|rem)\b/g,
                  (_, number, unit) => `calc(var(--reader-scale) * ${Number(number) * (unit === 'rem' ? MARKDOWN_FONT_SIZE : 1)}px)`);
                rule.style.setProperty(property, value, rule.style.getPropertyPriority(property));
              }
            }
            else if (rule instanceof CSSGroupingRule) rebase(rule.cssRules);
          }
        };
        rebase(sheet.cssRules);
        return [...sheet.cssRules].map(rule => rule.cssText).join('\n');
      });
    cache.set(profile.id, pending);
    void pending.catch(() => cache.delete(profile.id));
  }
  return pending;
}
