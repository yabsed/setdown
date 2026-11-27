// @vitest-environment jsdom
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { readerMarkdown, sanitizedReaderHtml } from './reader-export';
import { carryMath, drawReaderMath, hasReaderMath, katexCssWithFonts, READER_MATH, READER_TEX, readerMathOptions, texMarkdown } from './reader-math';

const page = (body: string) => new DOMParser().parseFromString(`<!doctype html><body>${body}</body>`, 'text/html');
const carried = (body: string, typeset: Parameters<typeof carryMath>[1] = []) => { const doc = page(body); carryMath(doc, typeset); return doc.body; };
/** What the installed KaTeX writes into a page: MathML with the TeX annotation, then the drawing. */
const drawn = (tex: string, display = false) => katex.renderToString(tex, { displayMode: display });
const HEURISTIC = String.raw`\exp\left(O\left(n^{1/3}(\log n)^{2/3}\right)\right)`;
const article = (content: string) => ({ url: 'https://example.com/a', title: 'T', byline: null, siteName: null, content });

describe('formulas in a reader snapshot', () => {
  it('keeps one copy of a KaTeX formula: the TeX it was written in', () => {
    const body = carried(`<p>비트 길이를 ${drawn('n')}이라고 하면</p><p>${drawn(HEURISTIC, true)}</p>`);
    const carriers = [...body.querySelectorAll(`span[${READER_MATH}]`)];
    expect(carriers.map(carrier => [carrier.getAttribute(READER_MATH), carrier.textContent])).toEqual([['inline', 'n'], ['display', HEURISTIC]]);
    // Neither the drawing nor the MathML is left to be read as text beside it.
    expect(body.querySelector('.katex, .katex-display, math, annotation')).toBeNull();
    expect(body.querySelector('p')!.textContent).toBe('비트 길이를 n이라고 하면');
  });

  it('takes the TeX of MathJax 2 from its script and removes the drawing and the preview', () => {
    const body = carried(`<p>Let <span class="MathJax_Preview"></span><span class="MathJax" id="MathJax-Element-1-Frame"><nobr>x</nobr><span class="MJX_Assistive_MathML"><math><mi>x</mi></math></span></span>`
      + `<script type="math/tex" id="MathJax-Element-1">x</script> be</p>`
      + `<span class="MathJax_Preview"></span><div class="MathJax_Display"><span class="MathJax" id="MathJax-Element-2-Frame"><nobr>sum</nobr></span></div>`
      + `<script type="math/tex; mode=display" id="MathJax-Element-2">\\sum_i x_i</script>`);
    expect([...body.querySelectorAll(`span[${READER_MATH}]`)].map(carrier => [carrier.getAttribute(READER_MATH), carrier.textContent]))
      .toEqual([['inline', 'x'], ['display', '\\sum_i x_i']]);
    expect(body.querySelector('.MathJax, .MathJax_Display, .MathJax_Preview, script, math')).toBeNull();
    expect(body.querySelector('p')!.textContent).toBe('Let x be');
  });

  it('takes the TeX of MathJax 3 from its own record, and its MathML when there is no record', () => {
    const container = (display: boolean) => `<mjx-container class="MathJax" jax="CHTML"${display ? ' display="true"' : ''}><mjx-math aria-hidden="true">drawing</mjx-math>`
      + `<mjx-assistive-mml><math${display ? ' display="block"' : ''}><msup><mi>x</mi><mn>2</mn></msup></math></mjx-assistive-mml></mjx-container>`;
    const body = carried(`<p>a ${container(false)} b</p>${container(true)}<p>c ${container(false)}</p>`, [{ tex: 'x^2', display: false }, { tex: 'x^2', display: true }]);
    expect([...body.querySelectorAll(`span[${READER_MATH}]`)].map(carrier => [carrier.getAttribute(READER_MATH), carrier.textContent]))
      .toEqual([['inline', 'x^2'], ['display', 'x^2']]);
    // The third formula has no record: the page's MathML is what remains of it.
    expect(body.querySelectorAll('math')).toHaveLength(1);
    expect(body.querySelector('mjx-container, mjx-math, mjx-assistive-mml')).toBeNull();
    expect(body.textContent).not.toContain('drawing');
  });

  it('keeps MathML a page wrote itself, without the annotations a text reader would print', () => {
    const body = carried(`<p>Energy <math display="block"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>`
      + `<annotation-xml encoding="MathML-Content"><apply><eq></eq></apply></annotation-xml><annotation encoding="application/x-tex">E=mc^{2}</annotation></semantics></math></p>`);
    const math = body.querySelector('math')!;
    expect(math.getAttribute(READER_TEX)).toBe('E=mc^{2}');
    expect(math.getAttribute('display')).toBe('block');
    expect(math.querySelector('annotation, annotation-xml, semantics')).toBeNull();
    expect(math.textContent).toBe('E=mc2');
    expect(body.querySelector(`span[${READER_MATH}]`)).toBeNull();
  });

  it('leaves a page without formulas as it is', () => {
    const html = '<p>No formula, only a <span class="note">note</span> and <code>x^2</code>.</p>';
    expect(carried(html).innerHTML).toBe(html);
  });

  it('serializes into a page as a function that names nothing outside itself', () => {
    const doc = page(`<p>${drawn('a+b')}</p>`);
    // The remote frame gets the source text alone.
    new Function('root', `(${carryMath.toString()})(root, [])`)(doc);
    expect(doc.querySelector(`span[${READER_MATH}]`)!.textContent).toBe('a+b');
  });
});

describe('formulas in reader exports', () => {
  const snapshot = () => { const body = carried(`<p>길이를 ${drawn('n')}이라고 하면</p><p>${drawn(HEURISTIC, true)}</p><p>${drawn('a<b \\& c')}</p>`); return article(body.innerHTML); };

  it('draws each carried formula once in the sanitized article', () => {
    const html = sanitizedReaderHtml(snapshot());
    expect(hasReaderMath(html)).toBe(true);
    const seen: [string, boolean][] = [];
    const out = drawReaderMath(html, (tex, display) => { seen.push([tex, display]); return katex.renderToString(tex, readerMathOptions(display)); });
    // The sanitizer's escaping is undone before the TeX is read.
    expect(seen).toEqual([['n', false], [HEURISTIC, true], ['a<b \\& c', false]]);
    expect(out).not.toContain(READER_MATH);
    expect(out.match(/class="katex"/g)).toHaveLength(3);
    expect(out).toContain('class="katex-display"');
    // The source appears only where KaTeX itself keeps it: the annotation of its MathML.
    expect(out.split(HEURISTIC.replace(/&/g, '&amp;'))).toHaveLength(2);
  });

  it('leaves an element that only resembles a carrier untouched', () => {
    const html = sanitizedReaderHtml(article(`<p><span ${READER_MATH}="inline"><b>x</b></span> <span ${READER_MATH}="other">y</span> <span ${READER_MATH}="inline" id="k">z</span></p>`));
    expect(drawReaderMath(html, () => 'DRAWN')).toBe(html);
  });

  it('writes formulas as Markdown mathematics', () => {
    const markdown = readerMarkdown(snapshot());
    expect(markdown).toContain('길이를 $n$이라고 하면');
    expect(markdown).toContain(`\n\n$$\n${HEURISTIC}\n$$\n\n`);
    expect(markdown).toContain('$a<b \\& c$');
    expect(texMarkdown('  a\n  + b ', false)).toBe('$a + b$');
    expect(texMarkdown('', true)).toBe('');
  });

  it('keeps MathML through the sanitizer and writes its TeX in Markdown when it has one', () => {
    const body = carried(`<p>E: <math><semantics><mrow><mi>E</mi><mo stretchy="false" onclick="x()">=</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">E=1</annotation></semantics></math></p>`
      + `<p>F: <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>`);
    const html = sanitizedReaderHtml(article(body.innerHTML));
    expect(html).toContain(`<math ${READER_TEX}="E=1"><mrow><mi>E</mi><mo stretchy="false">=</mo><mn>1</mn></mrow></math>`);
    expect(html).toContain('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
    const markdown = readerMarkdown(article(body.innerHTML));
    expect(markdown).toContain('E: $E=1$');
    expect(markdown).toContain('F: <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
  });

  it('points each KaTeX font face at one WOFF2 address', () => {
    const css = '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}.katex{color:red}';
    expect(katexCssWithFonts(css, file => `"/assets/${file}"`))
      .toBe('@font-face{font-family:KaTeX_Main;src:url("/assets/KaTeX_Main-Regular.woff2") format("woff2")}.katex{color:red}');
  });
});
