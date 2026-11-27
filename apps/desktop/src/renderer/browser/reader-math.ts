import katex from 'katex';
// The text as KaTeX ships it: the fonts are named below, so only the WOFF2 files become part of the application.
import katexCss from 'katex/dist/katex.min.css?raw';
import { katexCssWithFonts, READER_MATH, readerMathOptions } from '../../core/browser/reader-math';

const fonts = import.meta.glob<string>('@katex-fonts/*.woff2', { query: '?url', import: 'default', eager: true });
const fontAddress = new Map(Object.entries(fonts).map(([file, address]) => [file.slice(file.lastIndexOf('/') + 1), address]));

let style: { faces: string; rules: string } | undefined;
/**
 * KaTeX's style sheet in two parts. The font faces belong to the document. The rules are for the
 * reader to confine to its own article: a notebook shows KaTeX's MathML, which these rules hide.
 */
export function readerMathStyle(): { faces: string; rules: string } {
  if (!style) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(katexCssWithFonts(katexCss, file => {
      const address = fontAddress.get(file);
      if (!address) throw new Error(`KaTeX font ${file} is not part of the application.`);
      return JSON.stringify(new URL(address, document.baseURI).href);
    }));
    const faces: string[] = [], rules: string[] = [];
    for (const rule of sheet.cssRules) (rule instanceof CSSFontFaceRule ? faces : rules).push(rule.cssText);
    style = { faces: faces.join('\n'), rules: rules.join('\n') };
  }
  return style;
}

/** Draws each formula the article carries as TeX, in place. Returns how many it drew. */
export function drawReaderMath(content: HTMLElement): number {
  let drawn = 0;
  for (const carrier of content.querySelectorAll<HTMLElement>(`span[${READER_MATH}]`)) {
    const mode = carrier.getAttribute(READER_MATH), tex = carrier.textContent?.trim() ?? '';
    // Only what the extraction wrote: one text node. Anything else is the page's own element with this attribute.
    if (!tex || carrier.childElementCount || (mode !== 'inline' && mode !== 'display')) continue;
    try { katex.render(tex, carrier, readerMathOptions(mode === 'display')); drawn++; }
    catch { carrier.textContent = tex; }
  }
  return drawn;
}
