import type { ITheme } from '@xterm/xterm';
import { themeProfile, type ThemeId } from './theme-catalog';

const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;
// ANSI colors are terminal roles, independent of syntax-token colors. Extended
// indexed/truecolor SGR remains intact; xterm adjusts its displayed contrast.
const palettes: Record<ThemeId, string> = {
  'github-light': '24292f cf222e 116329 7d4e00 0550ae 8250df 1b7c83 6e7781 57606a a40e26 1a7f37 633c01 0969da 6639ba 055d64 424a53',
  paper: '2d2520 a1322b 426329 86540b 275d82 80517e 346b68 746b60 645b50 a83930 4c6c2d 80551a 326c96 835287 397b77 514a43',
  medium: '202123 b52a35 28723a 806000 1b5aa3 7950a5 176d76 666666 555555 c22e3a 247338 785900 225eb0 834baa 176977 444444',
  'solarized-light': '073642 dc322f 657b00 946f00 268bd2 9d53a0 218079 586e75 657b83 cb4b16 586e00 806000 1670ac 6c71c4 19766f 475b62',
  'github-dark': '1b1f23 f97583 85e89d ffdf5d 79b8ff b392f0 76e3ea d1d5da 959da5 fdaeb7 bef5cb fff5b1 c8e1ff d1bcf9 b3f0ff fafbfc',
  night: '252a2f e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dedede 8b9299 ef939b b5d7a0 f0d8a6 8bc4f2 d7a2e6 87cbd3 ffffff',
  'one-dark': '282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 abb2bf 7f8799 e9969d b8d7a3 eed5a7 90c5f1 d7a5e5 89cdd5 e6e9ef',
  'solarized-dark': '073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 657b83 cb4b16 9caf31 c5a146 58a6d9 8a8ed1 59b9b0 fdf6e3',
};
export const TERMINAL_MINIMUM_CONTRAST = 4.5;
export function terminalTheme(id: unknown): ITheme {
  const profile = themeProfile(id), colors = palettes[profile.id].split(' ');
  return { ...Object.fromEntries(names.map((name, i) => [name, `#${colors[i]}`])),
    background: profile.palette.editorBackground, foreground: profile.palette.text,
    cursor: profile.palette.text, cursorAccent: profile.palette.editorBackground,
    selectionBackground: `${profile.palette.accent}55`, selectionForeground: profile.palette.text,
    selectionInactiveBackground: `${profile.palette.accent}33` };
}
