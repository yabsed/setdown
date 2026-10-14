/** Self-contained DOM adapter, also serialized into the remote main frame.
 * Current Namu pages use hashed classes and nested divs; semantic section
 * anchors remain usable. Never mutate the original document. */
export function removeNamuSvg(doc: Document): void {
  doc.querySelectorAll('svg').forEach(el => el.remove());
  doc.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    // A raster fallback must not pick an SVG from its responsive candidates.
    if (/data:image\/svg\+xml|\.svgz?(?:[?#\s,]|$)/i.test(image.getAttribute('srcset') ?? '')) image.removeAttribute('srcset');
    const source = image.getAttribute('src')?.trim() ?? '';
    if (/^data:image\/svg\+xml(?:[;,]|$)/i.test(source)) { image.remove(); return; }
    try {
      if (/\.svgz?$/i.test(decodeURIComponent(new URL(source, doc.baseURI).pathname))) image.remove();
    } catch { /* An unparseable image URL is handled by the normal sanitizer. */ }
  });
}

export function namuArticleRoot(doc: Document): HTMLElement | null {
  const headings = [...doc.querySelectorAll<HTMLAnchorElement>('h2 a[id^="s-"],h3 a[id^="s-"],h4 a[id^="s-"],h5 a[id^="s-"],h6 a[id^="s-"]')];
  let root = doc.querySelector<HTMLElement>('.wiki-content, .wiki-inner-content');
  if (!root && headings.length) {
    root = headings[0].closest<HTMLElement>('h2,h3,h4,h5,h6')?.parentElement ?? null;
    while (root && (!headings.every(heading => root!.contains(heading)) || (root.textContent ?? '').trim().length < 80)) root = root.parentElement;
  }
  if (!root || root === doc.body || root === doc.documentElement || (root.textContent ?? '').trim().length < 80) return null;
  root.querySelectorAll('script,style,noscript,nav,aside,button,input,iframe').forEach(el => el.remove());
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
    const href = link.getAttribute('href') ?? '';
    if (/^\/(?:edit|discuss|history|backlink)\//.test(href)) link.remove();
  });
  root.querySelectorAll('details').forEach(el => { el.open = true; });
  // Remove empty obfuscation scaffolding, then turn leaf div paragraphs into
  // paragraphs and unwrap remaining layout wrappers. Keep semantic tables,
  // lists, code, footnotes and their original position stamps.
  for (const div of [...root.querySelectorAll('div')].reverse()) {
    if (!div.textContent?.replace(/[\s\u00a0]/g, '') && !div.querySelector('img,table,hr,pre,[id]') && !div.id) { div.remove(); continue; }
    if (!div.querySelector('div,p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,details') && !div.closest('pre')) {
      const paragraph = doc.createElement('p');
      for (const attr of [...div.attributes]) paragraph.setAttribute(attr.name, attr.value);
      paragraph.append(...div.childNodes); div.replaceWith(paragraph);
    } else if (!div.id) div.replaceWith(...div.childNodes);
  }
  return root;
}

/** Namu's paragraphs are divs, unlike ordinary article p elements. Include
 * only leaf content divs in the shared live/reader anchor coordinate system. */
export function readerBlocks(doc: Document, namu: boolean, selector: string): Element[] {
  return [...doc.querySelectorAll(namu ? `${selector},div` : selector)].filter(el => el.tagName !== 'DIV'
    || (!el.querySelector('div,p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,details') && !!el.textContent?.trim()));
}
