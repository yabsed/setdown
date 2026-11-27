/**
 * Mathematics in a reader snapshot.
 *
 * A page that draws a formula holds it two or three times: the drawing (styled spans, hidden from
 * assistive technology), MathML for a screen reader, and the TeX it was written in. An extraction
 * that keeps text takes whichever copies it may see and puts them side by side ("nn", or a formula
 * followed by its own source). `carryMath` leaves one copy of each formula in the snapshot:
 *
 * - `<span data-setdown-math="inline|display">TeX</span>` where the page holds the TeX (KaTeX and
 *   MathJax pages). The reader and its PDF draw it again with KaTeX, and Markdown gets `$…$`.
 * - the page's own `<math>`, without annotations and with its TeX in `data-setdown-tex`, where
 *   MathML is what the page was written in. Chromium draws it; Markdown gets the TeX when there is one.
 */
export const READER_MATH = 'data-setdown-math';
export const READER_TEX = 'data-setdown-tex';

/** What MathJax 3 recorded about one formula it drew. */
export type TypesetMath = { tex: string; display: boolean };

/**
 * Self-contained: it is also serialized into the remote main frame, so it names no module binding.
 * `typeset` lists MathJax 3's own records in the order of the page's `mjx-container` elements.
 * `root` is a copy of the page; the page itself is never changed.
 */
export function carryMath(root: Document, typeset: readonly (TypesetMath | null | undefined)[] = []): void {
  const LIMIT = 20000;
  const carrier = (tex: string, display: boolean): Element => {
    const span = root.createElement('span');
    span.setAttribute('data-setdown-math', display ? 'display' : 'inline');
    span.textContent = tex;
    return span;
  };
  const texOf = (math: Element | null): string => {
    const tex = (math?.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '').trim();
    return tex.length <= LIMIT ? tex : '';
  };
  /** The MathML alone: an annotation is text to everything that does not know MathML. */
  const bare = (math: Element, display: boolean): Element => {
    const copy = math.cloneNode(true) as Element, tex = texOf(math);
    copy.querySelectorAll('annotation, annotation-xml').forEach(note => note.remove());
    copy.querySelectorAll('semantics').forEach(wrap => wrap.replaceWith(...Array.from(wrap.childNodes)));
    if (display) copy.setAttribute('display', 'block');
    if (tex) copy.setAttribute('data-setdown-tex', tex);
    return copy;
  };
  const put = (shown: Element, tex: string, display: boolean, math: Element | null) => {
    if (tex) shown.replaceWith(carrier(tex, display));
    else if (math) shown.replaceWith(bare(math, display));
  };
  // Listed before anything moves: the order is the page's.
  const containers = Array.from(root.querySelectorAll('mjx-container'));

  // KaTeX: span.katex holds the MathML with the TeX annotation, then the drawing. Display math has a wrapper.
  for (const drawn of Array.from(root.querySelectorAll('.katex'))) {
    if (!root.contains(drawn)) continue;
    const wrapper = drawn.parentElement?.classList.contains('katex-display') ? drawn.parentElement : null;
    const math = drawn.querySelector('math');
    put(wrapper ?? drawn, texOf(math), !!wrapper || math?.getAttribute('display') === 'block', math);
  }

  // MathJax 3: the container holds the drawing and, unless the page turned it off, MathML.
  containers.forEach((drawn, index) => {
    if (!root.contains(drawn)) return;
    const known = typeset[index], math = drawn.querySelector('mjx-assistive-mml math');
    const tex = known && typeof known.tex === 'string' && known.tex.trim().length <= LIMIT ? known.tex.trim() : '';
    put(drawn, tex || texOf(math), known ? !!known.display : drawn.getAttribute('display') === 'true', math);
  });

  // MathJax 2: the TeX stays in a script after the drawing, whose id is the script's with "-Frame".
  for (const source of Array.from(root.querySelectorAll('script[type^="math/tex"]'))) {
    const tex = (source.textContent ?? '').trim();
    if (!tex || tex.length > LIMIT) continue;
    const frame = source.id ? root.getElementById(`${source.id}-Frame`) : null;
    const outer = frame?.parentElement && /(?:^|\s)(?:MathJax(?:_SVG|_MathML)?_Display|MJXc-display)(?:\s|$)/.test(frame.parentElement.getAttribute('class') ?? '')
      ? frame.parentElement : frame;
    const preview = (outer ?? source).previousElementSibling;
    if (preview?.classList.contains('MathJax_Preview')) preview.remove();
    outer?.remove();
    source.replaceWith(carrier(tex, /;\s*mode\s*=\s*display/i.test(source.getAttribute('type') ?? '')));
  }

  // MathML the page wrote itself.
  for (const math of Array.from(root.querySelectorAll('math'))) {
    if (!root.contains(math) || math.parentElement?.closest('math')) continue;
    math.replaceWith(bare(math, math.getAttribute('display') === 'block' || math.getAttribute('mode') === 'display'));
  }
}

/** How the reader draws a formula from an untrusted page: no commands that load or link, errors shown as the source. */
export const readerMathOptions = (display: boolean) => ({
  displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxSize: 100,
} as const);

const CARRIER = /<span data-setdown-math="(inline|display)">([^<]*)<\/span>/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plain = (text: string) => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hex, name) => {
  if (name) return NAMED[name.toLowerCase()] ?? whole;
  const code = decimal ? Number(decimal) : parseInt(hex, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
});

export const hasReaderMath = (html: string): boolean => html.includes(`${READER_MATH}="`);

/**
 * Sanitized article HTML with each TeX carrier replaced by what `draw` returns for it. A carrier
 * is exactly the element `carryMath` writes; anything else that only resembles one stays as it is.
 */
export function drawReaderMath(html: string, draw: (tex: string, display: boolean) => string): string {
  return html.replace(CARRIER, (whole, mode: string, text: string) => {
    const tex = plain(text).trim();
    if (!tex) return whole;
    try { return draw(tex, mode === 'display'); } catch { return whole; }
  });
}

/** A formula as Markdown writes it. */
export function texMarkdown(tex: string, display: boolean): string {
  const source = tex.trim();
  if (!source) return '';
  return display ? `\n\n$$\n${source}\n$$\n\n` : `$${source.replace(/\s+/g, ' ')}$`;
}

/** KaTeX's style sheet with each font face reduced to its WOFF2 file, at the address `font` gives for that file. */
export function katexCssWithFonts(css: string, font: (file: string) => string): string {
  return css.replace(/src:url\(fonts\/([\w-]+\.woff2)\) format\("woff2"\)(?:,url\([^)]*\) format\("[^"]*"\))*/g,
    (_whole, file: string) => `src:url(${font(file)}) format("woff2")`);
}
