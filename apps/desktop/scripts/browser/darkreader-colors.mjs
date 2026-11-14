/** Dark Reader's pinned parser predates CSS light-dark(). Normalize the light
 * source palette before its existing background/text/variable transforms. This
 * changes only values read by the engine, never the site's original stylesheet.
 * Quotes, URLs, nested functions and var() fallback commas are preserved. */
export function lightColorSource(value) {
  let result = '', offset = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"' || value[i] === "'") {
      const quote = value[i];
      while (++i < value.length) { if (value[i] === '\\') i++; else if (value[i] === quote) break; }
      continue;
    }
    if (value.slice(i, i + 4).toLowerCase() === 'url(') {
      let depth = 1;
      for (i += 4; i < value.length && depth; i++) {
        if (value[i] === '\\') i++;
        else if (value[i] === '(') depth++;
        else if (value[i] === ')') depth--;
      }
      i--; continue;
    }
    if (value.slice(i, i + 11).toLowerCase() !== 'light-dark(' || (i && /[\w-]/.test(value[i - 1]))) continue;
    let depth = 1, comma = -1, end = i + 11;
    for (; end < value.length; end++) {
      const c = value[end];
      if (c === '"' || c === "'") {
        while (++end < value.length) { if (value[end] === '\\') end++; else if (value[end] === c) break; }
      } else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
      else if (c === ',' && depth === 1) comma = comma === -1 ? end : -2;
    }
    if (depth || comma < 0) continue;
    result += value.slice(offset, i) + lightColorSource(value.slice(i + 11, comma).trim());
    i = end; offset = end + 1;
  }
  return result + value.slice(offset);
}

// The API's light-mode transform uses one ramp for backgrounds and text. With
// Solarized Light this turns medium gray placeholders yellow and brightens
// blue links. Keep originally dark, opaque text legible on the app surface;
// originally light text (for colored headers/buttons) retains its polarity.
export function readableLightText(source, value, background, foreground) {
  if ((source.a ?? 1) !== 1 || !/^#[\da-f]{6}$/i.test(value)) return value;
  const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  if (luminance([source.r, source.g, source.b]) > .5) return value;
  const bg = luminance(parse(background)), original = parse(value), pole = parse(foreground);
  const contrast = rgb => { const fg = luminance(rgb); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); };
  if (contrast(original) >= 4.5 || contrast(pole) < 4.5) return value;
  let low = 0, high = 1;
  const blend = t => original.map((n, i) => Math.round(n + (pole[i] - n) * t));
  for (let i = 0; i < 12; i++) { const mid = (low + high) / 2; if (contrast(blend(mid)) >= 4.5) high = mid; else low = mid; }
  return '#' + blend(high).map(n => n.toString(16).padStart(2, '0')).join('');
}

// Design tokens are often raw HSL components (`--bg: 48 33% 97%`) consumed as
// `hsl(var(--bg) / .8)`. The pinned engine only knows raw `r, g, b` tokens: it
// pasted the last definition found in any stylesheet into such a declaration,
// so a dark-mode token set written after the light one painted dark surfaces
// under the page's light text. These adapters keep the declaration on the
// engine's variable path, where every token definition is themed in place and
// the cascade still selects the one that applies to each element.
export function rawHSLColor(input) {
  const match = /^\s*(-?[\d.]+)(deg|grad|rad|turn)?(\s*,\s*|\s+)([\d.]+)%(?:\s*,\s*|\s+)([\d.]+)%\s*$/i.exec(input);
  if (!match) return null;
  const turn = { grad: 400, rad: 2 * Math.PI, turn: 1 }[(match[2] ?? '').toLowerCase()] ?? 360;
  const hue = ((Number(match[1]) / turn * 360) % 360 + 360) % 360, s = Number(match[4]) / 100, l = Number(match[5]) / 100;
  if (!Number.isFinite(hue) || !(s <= 1) || !(l <= 1)) return null;
  const channel = n => { const k = (n + hue / 30) % 12; return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return { rgb: { r: channel(0), g: channel(8), b: channel(4), a: 1 }, restore(color) {
    const hex = /^#([\da-f]{6})$/i.exec(color), fn = /^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/i.exec(color);
    if (!hex && !fn) return input;
    const [r, g, b] = (hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : fn.slice(1, 4).map(Number)).map(n => n / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2, delta = max - min;
    const h = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    const round = n => Math.round(n * 1000) / 1000;
    // The authored separator decides whether hsl(var(--x) / a) or hsla(var(--x), a) stays valid.
    return [round(h * 60), `${round(delta ? delta / (1 - Math.abs(2 * light - 1)) * 100 : 0)}%`, `${round(light * 100)}%`].join(match[3].includes(',') ? ', ' : ' ');
  } };
}

// One color token with at most an alpha. "hsl(var(--hs), 50%)" completes a
// two-component token with a lightness instead, so a comma only precedes a
// plain number. rgb() keeps the upstream definition.
export function simpleRawColor(value) {
  return /^rgba?\(var\(--[\-_A-Za-z0-9]+\)(\s*,?\/?\s*0?\.\d+)?\)$/.test(value)
    || /^hsla?\(var\(--[\-_A-Za-z0-9]+\)\s*(?:\/\s*(?:[\d.]+%?|var\(--[\-_A-Za-z0-9]+(?:\s*,\s*[\d.]+%?)?\))|,\s*[\d.]+)?\s*\)$/i.test(value);
}

// Fallback for a token that no stylesheet defines, in the form its function reads.
export function rawColorDefault(value, white) {
  if (!/^\s*hsla?\(/i.test(value)) return white ? '255, 255, 255' : '0, 0, 0';
  return ['0', '0%', white ? '100%' : '0%'].join(/\)\s*,/.test(value) ? ', ' : ' ');
}

export function patchDarkReaderColors(source, file) {
  if (file === 'variables.ts') {
    const sites = [
      ['const isSimpleConstructedColor = sourceValue.match(/^rgba?\\(var\\(--[\\-_A-Za-z0-9]+\\)(\\s*,?\\/?\\s*0?\\.\\d+)?\\)$/);',
        'const isSimpleConstructedColor = simpleRawColor(sourceValue);'],
      ['if (isConstructedColorVar(sourceValue)) {', 'if (isConstructedColorVar(sourceValue) && !simpleRawColor(sourceValue)) {'],
      ["tryModifyBgColor(isConstructedColor ? '255, 255, 255' : '#ffffff', theme) :", "tryModifyBgColor(isConstructedColor ? rawColorDefault(sourceValue, true) : '#ffffff', theme) :"],
      ["tryModifyTextColor(isConstructedColor ? '0, 0, 0' : '#000000', theme);", "tryModifyTextColor(isConstructedColor ? rawColorDefault(sourceValue, false) : '#000000', theme);"],
      ['    const {isRaw, color} = parseRawColorValue(input);', `    const hsl = rawHSLColor(input);
    if (hsl) return hsl.restore(modifyFunction(hsl.rgb, theme, false));
    const {isRaw, color} = parseRawColorValue(input);`],
    ];
    for (const [site, replacement] of sites) {
      if (source.split(site).length !== 2) throw Error('Review the Dark Reader raw color token adapter.');
      source = source.replace(site, () => replacement);
    }
    return `${rawHSLColor.toString()}\n${simpleRawColor.toString()}\n${rawColorDefault.toString()}\n${source}`;
  }
  if (file === 'index.ts') {
    const site = 'if (__CHROMIUM_MV3__) {\n        // Notify the dedicated injector of the data.';
    if (source.split(site).length !== 2) throw Error('Review the Dark Reader isolated proxy adapter.');
    return source.replace(site, 'if (true) {\n        // The isolated preload installs the bundled proxy in the page world.');
  }
  if (file === 'stylesheet-proxy.ts') {
    const site = 'const sheet = adoptedDeclarationSheets.get(this);';
    if (source.split(site).length !== 2) throw Error('Review the Dark Reader CSSOM declaration adapter.');
    return source.replace(site, `${site}\n                const authoredSheet = this.parentRule?.parentStyleSheet;
                if (authoredSheet) reportSheetChange(authoredSheet);`);
  }
  if (file === 'modify-colors.ts') {
    const site = 'const value = modifier(rgb, theme);';
    if (source.split(site).length !== 2) throw Error(`Review the Dark Reader contrast adapter in ${file}.`);
    return `${readableLightText.toString()}\n${source.replace(site, `let value = modifier(rgb, theme);
    if (type === 'text' && theme.mode === 0) value = readableLightText(rgb, value, theme.lightSchemeBackgroundColor, theme.lightSchemeTextColor);`)}`;
  }
  const site = file === 'css-rules.ts'
    ? 'export function iterateCSSDeclarations(style: CSSStyleDeclaration, iterate: (property: string, value: string) => void): void {'
    : '    let modifier: ModifiableCSSDeclaration[\'value\'] | null = null;';
  if (source.split(site).length !== 2) throw Error(`Review the Dark Reader light-dark adapter in ${file}.`);
  const insertion = file === 'css-rules.ts'
    ? '\n    const originalIterate = iterate; iterate = (property, value) => originalIterate(property, lightColorSource(value));'
    : '\n    value = lightColorSource(value);';
  return `${lightColorSource.toString()}\n${source.replace(site, () => site + insertion)}`;
}
