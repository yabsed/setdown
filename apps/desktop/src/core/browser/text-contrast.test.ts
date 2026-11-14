import { expect, test } from 'vitest';
import { carriesWhiteText, cssColor, over, contrast, readableText, type Color } from './text-contrast';
test('gray text is corrected against its own dark surface, independently of light content', () => {
  const gray: Color = [98, 117, 118, 1], dark: Color = [99, 123, 131, 1], light: Color = [253, 246, 227, 1];
  expect(contrast(gray, dark)).toBeLessThan(1.1);
  expect(contrast(cssColor(readableText(gray, dark)!)!, dark)).toBeGreaterThanOrEqual(4.5);
  expect(readableText([88, 110, 117, 1], light)).toBeNull();
  expect(readableText([0, 0, 0, 0], light)).toBeNull();
});
test('transparent surfaces and foregrounds use their painted composite', () => {
  const painted = over([0, 0, 0, .5], [255, 255, 255, 1]);
  expect(painted).toEqual([127.5, 127.5, 127.5, 1]);
  const result = readableText([255, 255, 255, .3], painted)!;
  expect(contrast(cssColor(result)!, painted)).toBeGreaterThanOrEqual(4.5);
  expect(cssColor('linear-gradient(black,white)')).toBeNull();
});
test('a fixed white foreground belongs to a dark panel, not to the light app surface', () => {
  // Solarized Light paints a dark site panel slate; white reaches 4.48:1 there.
  expect(carriesWhiteText([99, 123, 131, 1])).toBe(true);
  expect(carriesWhiteText([23, 23, 23, 1])).toBe(true);
  expect(carriesWhiteText([253, 246, 227, 1])).toBe(false);
  expect(carriesWhiteText([255, 255, 255, 1])).toBe(false);
});
