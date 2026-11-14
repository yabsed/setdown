export type Color = [number, number, number, number];
export function cssColor(value: string): Color | null {
  const match = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
}
export function over(foreground: Color, background: Color): Color {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [...foreground.slice(0, 3).map((n, i) => alpha ? (n * foreground[3] + background[i] * background[3] * (1 - foreground[3])) / alpha : 0), alpha] as Color;
}
const luminance = (color: Color) => color.slice(0, 3).map(n => n / 255)
  .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
export function contrast(foreground: Color, background: Color): number {
  const a = luminance(over(foreground, background)), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
/** A panel dark enough to carry a fixed white foreground: 3:1, the minimum for interface text. */
export function carriesWhiteText(surface: Color): boolean {
  return contrast([255, 255, 255, 1], surface) >= 3;
}
/** Correct the actual painted pair, never a theme-wide assumption about its surface. */
export function readableText(foreground: Color, background: Color): string | null {
  if (foreground[3] === 0 || contrast(foreground, background) >= 4.5) return null;
  const source = over(foreground, background);
  const candidates = [0, 255].flatMap(pole => {
    const mix = (amount: number): Color => [...source.slice(0, 3).map(n => Math.round(n + (pole - n) * amount)), 1] as Color;
    if (contrast(mix(1), background) < 4.5) return [];
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) { const middle = (low + high) / 2; if (contrast(mix(middle), background) >= 4.5) high = middle; else low = middle; }
    const color = mix(high);
    return [{ color, distance: color.slice(0, 3).reduce((sum, n, i) => sum + (n - source[i]) ** 2, 0) }];
  }).sort((a, b) => a.distance - b.distance);
  return candidates[0] ? `rgb(${candidates[0].color.slice(0, 3).join(', ')})` : null;
}
