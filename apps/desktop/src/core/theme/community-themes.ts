import github from './upstream/github-dark-high-contrast.json' with { type: 'json' };
import nightOwl from './upstream/night-owl.json' with { type: 'json' };
import dracula from './upstream/dracula.json' with { type: 'json' };
import githubLight from './upstream/github-light-high-contrast.json' with { type: 'json' };
import vscodeLight from './upstream/vscode-light-2026.json' with { type: 'json' };
import lightOwl from './upstream/light-owl.json' with { type: 'json' };
import atomOneLight from './upstream/atom-one-light.json' with { type: 'json' };
import type { ThemeProfile } from './theme-catalog';
import { vscodeToken, type VscodeTheme, type VscodeTokenRule } from './vscode-token';

type SourceTheme = { colors: Record<string, unknown>; tokenColors: VscodeTokenRule[]; semanticTokenColors?: Record<string, string> };

function profile(id: ThemeProfile['id'], label: string, source: SourceTheme, accent: string,
  { appearance = 'dark', commentCorrection }: { appearance?: ThemeProfile['appearance']; commentCorrection?: [string, string] } = {}): ThemeProfile {
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
    'sideBar.foreground': foreground, 'input.foreground': foreground,
    'tab.inactiveForeground': foreground,
    'tab.hoverBackground': raw['tab.activeBackground'] ?? background, 'tab.hoverForeground': foreground,
    'list.inactiveSelectionForeground': foreground, 'list.activeSelectionForeground': foreground,
    'menu.background': surface, 'menu.foreground': foreground, 'menu.border': border,
    'menu.selectionBackground': raw['list.activeSelectionBackground'] ?? surface, 'menu.selectionForeground': foreground,
    'terminal.background': appearance === 'light' ? raw['panel.background'] ?? background : background,
    'terminal.foreground': foreground,
    'terminalCursor.foreground': foreground, 'terminalCursor.background': background,
    'textLink.foreground': accent, 'textLink.activeForeground': accent,
    'textBlockQuote.background': raw['sideBar.background'] ?? background, 'textBlockQuote.border': border,
    'textPreformat.foreground': foreground, 'textPreformat.background': surface,
    'textCodeBlock.background': surface, 'textSeparator.foreground': border,
    ...raw,
  };
  const vscodeTheme: VscodeTheme = { type: appearance, colors, semanticTokenColors: source.semanticTokenColors,
    tokenColors: source.tokenColors.map(rule => ({ ...rule,
    // Preserve the notebook/editor 4.5:1 comment guarantee across lexical,
    // TextMate and Prism adapters, without changing the upstream files.
    settings: { ...rule.settings,
      // Normalize legacy tmTheme white/inherit values for Monaco and Shiki.
      ...(rule.settings.foreground === 'white' ? { foreground: '#ffffff' } : {}),
      ...(rule.settings.foreground === 'inherit' ? { foreground: undefined } : {}),
      ...(commentCorrection && rule.settings.foreground?.toLowerCase() === commentCorrection[0].toLowerCase()
        ? { foreground: commentCorrection[1] } : {}),
    },
  })) };
  const token = (scope: string) => vscodeToken(vscodeTheme, scope).foreground ?? foreground;
  return {
    id, label, appearance,
    preview: { stylesheet: appearance === 'light' ? 'github-light.css' : 'github-dark.css',
      prismStylesheet: appearance === 'light' ? 'github.css' : 'github-dark.css', background },
    palette: { canvas: background, surface: background, raisedSurface: surface,
      chrome: colors['titleBar.activeBackground'] ?? background, editorBackground: background,
      text: foreground, mutedText: colors.descriptionForeground, subtleText: colors['editorLineNumber.foreground'] ?? foreground,
      border: colors['sideBar.border'] ?? border, strongBorder: border,
      hover: colors['list.hoverBackground'] ?? surface, selected: colors['tab.activeBackground'] ?? surface,
      accent: colors['textLink.foreground'], focusRing: colors.focusBorder ?? accent,
      warningSurface: colors['inputValidation.warningBackground'] ?? surface,
      warningText: colors['inputValidation.warningForeground'] ?? colors['terminal.ansiYellow'] ?? token('constant.numeric'),
      warningBorder: colors['inputValidation.warningBorder'] ?? colors['terminal.ansiYellow'] ?? token('constant.numeric'),
      dangerText: colors.errorForeground ?? colors['terminal.ansiRed'] ?? '#ad0707',
      shadow: appearance === 'light' ? 'rgba(28, 28, 24, .18)' : 'rgba(0, 0, 0, .42)',
      overlay: appearance === 'light' ? 'rgba(25, 25, 23, .4)' : 'rgba(0, 0, 0, .58)' },
    syntax: { foreground, comment: token('comment'), keyword: token('keyword'), string: token('string'),
      number: token('constant.numeric'), link: colors['textLink.foreground'], heading: token('markup.heading'),
      code: token('markup.inline.raw'), punctuation: token('punctuation') },
    workbenchColors: colors, vscodeTheme,
  };
}

export const COMMUNITY_THEMES: readonly ThemeProfile[] = [
  profile('github-dark-high-contrast', 'GitHub Dark High Contrast', github, '#71b7ff'),
  profile('night-owl', 'Night Owl', nightOwl, '#82aaff', { commentCorrection: ['#637777', '#7c9090'] }),
  profile('dracula', 'Dracula', dracula, '#8be9fd', { commentCorrection: ['#6272a4', '#8293bf'] }),
];

export const IMPORTED_LIGHT_THEMES: readonly ThemeProfile[] = [
  profile('github-light-high-contrast', 'GitHub Light High Contrast', githubLight, '#0349b4', { appearance: 'light' }),
  profile('vscode-light-2026', 'VS Code Light 2026', vscodeLight, '#0069cc', { appearance: 'light' }),
  profile('light-owl', 'Light Owl', lightOwl, '#288ed7', { appearance: 'light', commentCorrection: ['#989fb1', '#6a7181'] }),
  profile('atom-one-light', 'Atom One Light', atomOneLight, '#4078f2', { appearance: 'light', commentCorrection: ['#a0a1a7', '#696c77'] }),
];
