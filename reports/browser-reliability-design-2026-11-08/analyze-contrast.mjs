import { readFile, writeFile } from 'node:fs/promises';
const input = new URL('./theme-artifacts/diagnostic-observe-gray-text-on-a-dark-surface-contrast/observations.json', import.meta.url);
const data = JSON.parse(await readFile(input, 'utf8'));
const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = value => rgb(value).map(n => n / 255)
  .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
const contrast = (foreground, background) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const result = Object.fromEntries(Object.entries(data).map(([mode, rows]) => [mode,
  [['#light .muted', '#light'], ['#dark .muted', '#dark'], ['#dark', '#dark']].map(([text, surface]) => {
    const foreground = rows.find(row => row.selector === text).foreground;
    const background = rows.find(row => row.selector === surface).background;
    return { text, surface, foreground, background, contrast: contrast(foreground, background) };
  })]));
await writeFile(new URL('./contrast-ratios.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
