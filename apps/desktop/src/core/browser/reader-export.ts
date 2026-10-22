import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ReaderArticle } from './reader-article';

export function readerFileName(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 120);
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? 'article' : name;
}
export function sanitizedReaderHtml(article: ReaderArticle): string {
  const absolute = (value: string) => { try { return new URL(value, article.url).href; } catch { return ''; } };
  return sanitizeHtml(article.content, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 's', 'del'],
    allowedAttributes: { a: ['href', 'id', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['id'], code: ['class'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'], details: ['open'] },
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
