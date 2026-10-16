import DOMPurify from 'dompurify';
import { notebookText } from '../../core/notebook/notebook-document';

export const DISPLAY_TEXT_LIMIT = 200_000;
export function displayText(value: unknown): string {
  try { const text = notebookText(value); return text.length > DISPLAY_TEXT_LIMIT ? text.slice(0, DISPLAY_TEXT_LIMIT) + '\n… Display truncated; full content is preserved in the file.' : text; }
  catch { return ''; }
}
export function rasterData(mime: string, value: unknown): string | null {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) return null;
  let data: string; try { data = notebookText(value).replace(/\s/g, ''); } catch { return null; }
  return data.length <= 8 * 1024 * 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(data) ? `data:${mime};base64,${data}` : null;
}
/** Stored notebook output is untrusted, including outputs marked trusted by
 * another application. No scripts, active embeds, SVG, remote images or CSS. */
export function notebookHtml(html: string, baseHref = '', attachments: Record<string, unknown> = {}): string {
  const safe = DOMPurify.sanitize(html.slice(0, 1024 * 1024), {
    USE_PROFILES: { html: true, mathMl: true }, ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'svg', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'id', 'name'],
    ADD_ATTR: ['data-source-line'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|attachment|marktex-resource):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
  const fragment = new DOMParser().parseFromString(safe, 'text/html');
  // Native MathML gives us readable equations without accepting output CSS.
  for (const htmlMath of fragment.querySelectorAll('.katex-html')) htmlMath.remove();
  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    // Crossnote resolves attachment: as a relative file reference. Restore its
    // cell-local identity before interpreting any ordinary resource URL.
    let reference = src;
    try { reference = decodeURIComponent(baseHref && src.startsWith(baseHref) ? src.slice(baseHref.length) : src); } catch { /* Invalid escapes are not attachments. */ }
    let resolved: string | null = null;
    if (reference.startsWith('attachment:')) {
      const key = reference.slice('attachment:'.length);
      const bundle = Object.hasOwn(attachments, key) ? attachments[key] : null;
      if (bundle && typeof bundle === 'object') for (const [mime, data] of Object.entries(bundle)) { resolved = rasterData(mime, data); if (resolved) break; }
    } else if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(src) && src.length <= 8 * 1024 * 1024) resolved = src;
    else if (baseHref) {
      try { const url = new URL(src, baseHref); if (url.protocol === 'marktex-resource:') resolved = url.href; } catch { /* Broken URL is represented by its alt text. */ }
    }
    if (resolved) { image.src = resolved; image.loading = 'lazy'; image.decoding = 'async'; }
    else image.replaceWith(fragment.createTextNode(image.alt || '[Image preserved in notebook]'));
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) link.removeAttribute('href');
    link.removeAttribute('target');
  }
  return fragment.body.innerHTML;
}
export type StaticOutput = { kind: 'text' | 'error' | 'html' | 'markdown' | 'image' | 'unsupported'; content: string };
export function staticOutput(output: unknown): StaticOutput {
  if (!output || typeof output !== 'object') return { kind: 'unsupported', content: 'Unrecognized output is preserved in the notebook.' };
  const item = output as Record<string, unknown>;
  if (item.output_type === 'stream') return { kind: 'text', content: displayText(item.text) };
  if (item.output_type === 'error') return { kind: 'error', content: (Array.isArray(item.traceback) ? item.traceback.join('\n')
    : `${item.ename ?? 'Error'}: ${item.evalue ?? ''}`).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, DISPLAY_TEXT_LIMIT) };
  const data = item.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const image = rasterData(mime, data[mime]); if (image) return { kind: 'image', content: image };
    }
    if (data['text/html']) return { kind: 'html', content: notebookHtml(displayText(data['text/html'])) };
    if (data['text/markdown']) return { kind: 'markdown', content: displayText(data['text/markdown']) };
    if (data['text/latex']) return { kind: 'markdown', content: displayText(data['text/latex']) };
    if (Object.hasOwn(data, 'application/json')) return { kind: 'text', content: JSON.stringify(data['application/json'], null, 2).slice(0, DISPLAY_TEXT_LIMIT) };
    if (data['text/plain']) return { kind: 'text', content: displayText(data['text/plain']) };
    return { kind: 'unsupported', content: `Stored output (${Object.keys(data).join(', ')}) — preserved; interactive rendering is not enabled.` };
  }
  return { kind: 'unsupported', content: `Stored ${String(item.output_type ?? 'unknown')} output is preserved.` };
}
