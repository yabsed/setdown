import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ReaderArticle } from './reader-article';
import { READER_MATH, READER_TEX, texMarkdown } from './reader-math';

/** MathML Core's elements, and the attributes that change how they are drawn. */
const MATHML_TAGS = ['math', 'merror', 'mfrac', 'mi', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot', 'mrow',
  'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover', 'none'];
const MATHML_ATTRIBUTES = ['mathvariant', 'displaystyle', 'scriptlevel', 'dir'];
const MATHML_ELEMENT_ATTRIBUTES: Record<string, string[]> = {
  math: ['display', READER_TEX], mo: ['fence', 'form', 'largeop', 'lspace', 'maxsize', 'minsize', 'movablelimits', 'rspace', 'separator', 'stretchy', 'symmetric'],
  mfrac: ['linethickness'], mspace: ['width', 'height', 'depth'], mpadded: ['width', 'height', 'depth', 'lspace', 'voffset'],
  mover: ['accent'], munder: ['accentunder'], munderover: ['accent', 'accentunder'], mtd: ['columnspan', 'rowspan'],
};

export function readerFileName(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 120);
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? 'article' : name;
}
export function sanitizedReaderHtml(article: ReaderArticle): string {
  const absolute = (value: string) => { try { return new URL(value, article.url).href; } catch { return ''; } };
  return sanitizeHtml(article.content, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 's', 'del', ...MATHML_TAGS],
    allowedAttributes: { a: ['href', 'id', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['id'], code: ['class'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'], details: ['open'],
      // A formula is carried as its TeX (core/browser/reader-math.ts) or as the page's own MathML.
      span: [{ name: READER_MATH, values: ['inline', 'display'] }],
      ...Object.fromEntries(MATHML_TAGS.map(tag => [tag, [...MATHML_ATTRIBUTES, ...(MATHML_ELEMENT_ATTRIBUTES[tag] ?? [])]])) },
    allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...attributes, href: attributes.href?.startsWith('#') ? attributes.href : absolute(attributes.href ?? '') } }),
      img: (_tag, attributes) => ({ tagName: 'img', attribs: { ...attributes, src: absolute(attributes.src ?? '') } }),
    },
  });
}
export function readerMarkdown(article: ReaderArticle): string {
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  converter.use(gfm);
  converter.addRule('complex-tables', { filter: node => node.nodeName === 'TABLE' && !!node.querySelector('[colspan],[rowspan]'),
    replacement: (_content, node) => `\n\n${node.outerHTML}\n\n` });
  // A formula is written as Markdown mathematics; MathML without TeX stays as the markup a preview can draw.
  converter.addRule('formulas', { filter: node => node.nodeName === 'SPAN' && !!node.getAttribute(READER_MATH),
    replacement: (_content, node) => texMarkdown(node.textContent ?? '', (node as Element).getAttribute(READER_MATH) === 'display') });
  converter.addRule('mathml', { filter: node => node.nodeName.toLowerCase() === 'math',
    replacement: (_content, node) => {
      const math = node as Element, tex = math.getAttribute(READER_TEX), display = math.getAttribute('display') === 'block';
      return tex ? texMarkdown(tex, display) : display ? `\n\n${math.outerHTML}\n\n` : math.outerHTML;
    } });
  converter.addRule('section-anchors', { filter: node => node.nodeName === 'A' && !!node.getAttribute('id') && !node.textContent,
    replacement: (_content, node) => `<a id="${node.getAttribute('id')!.replace(/["<>]/g, '')}"></a>` });
  converter.addRule('section-headings', { filter: node => /^H[1-6]$/.test(node.nodeName) && (!!node.id || !!node.querySelector('[id]')),
    replacement: (content, node) => {
      const anchors = [...new Set([node.id, ...[...node.querySelectorAll('[id]')].map(el => el.id)].filter(Boolean))]
        .map(id => `<a id="${id.replace(/["<>]/g, '')}"></a>`).join('');
      return `\n\n${anchors}\n\n${'#'.repeat(Number(node.nodeName.slice(1)))} ${content.replace(/<a id="[^"]*"><\/a>/g, '').trim()}\n\n`;
    } });
  const body = converter.turndown(sanitizedReaderHtml(article));
  const text = (value: string) => converter.escape(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const title = `# ${text(article.title.replace(/\s+/g, ' ').trim())}`;
  const metadata = [article.byline, article.siteName].filter(Boolean).join(' · ');
  return `${title}\n\n${metadata ? `${text(metadata)}\n\n` : ''}Source: <${article.url}>\n\n---\n\n${body}\n`;
}
