import { cssColor, type Color } from '../core/browser/text-contrast';

/** Decode computed solid colors in Chromium's sRGB paint space. Relative rgb()
 * serializes as color(srgb ...), and color-mix() can serialize as oklab(). These
 * are still solid colors, not images or gradients. The common RGB path avoids
 * canvas work; native conversions are bounded to recently used colors.
 */
export function computedColorReader(): (value: string) => Color | null {
  const cache = new Map<string, Color | null>();
  let context: OffscreenCanvasRenderingContext2D | null | undefined;
  return value => {
    const rgb = cssColor(value);
    if (rgb) return rgb;
    if (cache.has(value)) return cache.get(value)!;
    let result: Color | null = null;
    // Only absolute computed forms: resolving currentColor/var() or a relative
    // expression on a detached canvas would lose the element's own context.
    if (/^(?:color|lab|lch|oklab|oklch)\(/.test(value) && CSS.supports('color', value)) {
      context ??= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        result = [r, g, b, a / 255];
      }
    }
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(value, result);
    return result;
  };
}
