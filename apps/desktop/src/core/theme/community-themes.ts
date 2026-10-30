import github from './upstream/github-dark-high-contrast.json' with { type: 'json' };
import nightOwl from './upstream/night-owl.json' with { type: 'json' };
import dracula from './upstream/dracula.json' with { type: 'json' };
import type { ThemeProfile } from './theme-catalog';
import { vscodeToken, type VscodeTheme, type VscodeTokenRule } from './vscode-token';

type SourceTheme = { colors: Record<string, unknown>; tokenColors: VscodeTokenRule[] };

function profile(id: ThemeProfile['id'], label: string, source: SourceTheme, accent: string,
  commentCorrection?: [string, string]): ThemeProfile {
  // VS Code ignores null/invalid color entries. Keep the checked-in source
  // intact, including GitHub's upstream array-valued symbolIcon entry.
  const raw = Object.fromEntries(Object.entries(source.colors)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^#[\da-f]{3,8}$/i.test(entry[1])));
  const background = raw['editor.background'], foreground = raw['editor.foreground'];
  const surface = raw['editorWidget.background'] ?? raw['sideBar.background'] ?? background;
  const border = raw['input.border'] ?? raw['panel.border'] ?? raw['editorWidget.border'] ?? accent;
  const colors: Record<string, string> = {
    'foreground': foreground, 'descriptionForeground': foreground, 'icon.foreground': foreground,
    'activityBar.inactiveForeground': foreground, 'activityBar.activeBorder': accent,
    'breadcrumb.background': background,
    'tab.hoverBackground': raw['tab.activeBackground'] ?? background, 'tab.hoverForeground': foreground,
    'list.inactiveSelectionForeground': foreground, 'list.activeSelectionForeground': foreground,
    'menu.background': surface, 'menu.foreground': foreground, 'menu.border': border,
    'menu.selectionBackground': raw['list.activeSelectionBackground'] ?? surface, 'menu.selectionForeground': foreground,
    'terminal.background': background, 'terminal.foreground': foreground,
    'terminalCursor.foreground': foreground, 'terminalCursor.background': background,
    'textLink.foreground': accent, 'textLink.activeForeground': accent,
    'textBlockQuote.background': raw['sideBar.background'] ?? background, 'textBlockQuote.border': border,
    'textPreformat.foreground': foreground, 'textPreformat.background': surface,
    'textCodeBlock.background': surface, 'textSeparator.foreground': border,
    ...raw,
  };
  const vscodeTheme: VscodeTheme = { colors, tokenColors: source.tokenColors.map(rule => ({ ...rule,
    // Preserve the notebook/editor 4.5:1 comment guarantee across lexical,
    // TextMate and Prism adapters, without changing the upstream files.
    settings: commentCorrection && rule.settings.foreground?.toLowerCase() === commentCorrection[0].toLowerCase()
      ? { ...rule.settings, foreground: commentCorrection[1] } : rule.settings,
  })) };
  const token = (scope: string) => vscodeToken(vscodeTheme, scope).foreground ?? foreground;
  return {
    id, label, appearance: 'dark',
    preview: { stylesheet: 'github-dark.css', prismStylesheet: 'github-dark.css', background },
    palette: { canvas: background, surface: background, raisedSurface: surface,
      chrome: colors['titleBar.activeBackground'] ?? background, editorBackground: background,
      text: foreground, mutedText: colors.descriptionForeground, subtleText: colors['editorLineNumber.foreground'] ?? foreground,
      border: colors['sideBar.border'] ?? border, strongBorder: border,
      hover: colors['list.hoverBackground'] ?? surface, selected: colors['tab.activeBackground'] ?? surface,
      accent: colors['textLink.foreground'], focusRing: colors.focusBorder ?? accent,
      warningSurface: colors['inputValidation.warningBackground'] ?? surface,
      warningText: colors['inputValidation.warningForeground'] ?? colors['terminal.ansiYellow'],
      warningBorder: colors['inputValidation.warningBorder'] ?? colors['terminal.ansiYellow'],
      dangerText: colors.errorForeground ?? colors['terminal.ansiRed'], shadow: 'rgba(0, 0, 0, .42)', overlay: 'rgba(0, 0, 0, .58)' },
    syntax: { foreground, comment: token('comment'), keyword: token('keyword'), string: token('string'),
      number: token('constant.numeric'), link: colors['textLink.foreground'], heading: token('markup.heading'),
      code: token('markup.inline.raw'), punctuation: token('punctuation') },
    workbenchColors: colors, vscodeTheme,
  };
}

export const COMMUNITY_THEMES: readonly ThemeProfile[] = [
  profile('github-dark-high-contrast', 'GitHub Dark High Contrast', github, '#71b7ff'),
  profile('night-owl', 'Night Owl', nightOwl, '#82aaff', ['#637777', '#7c9090']),
  profile('dracula', 'Dracula', dracula, '#8be9fd', ['#6272a4', '#8293bf']),
];
