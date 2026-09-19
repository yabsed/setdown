import type { DesktopPort } from '../ports/desktop-port';
import { pasteTarget, replaceSelection, stillCurrent,
  type EditingContext, type InsertionTarget } from './markdown-editing-target';

type Context = EditingContext & { desktop: DesktopPort; host: HTMLElement };
const IMAGE_URL = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;

function remoteImageUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function installEditorImagePaste(context: Context): () => void {
  let busy = false;
  let disposed = false;

  async function pasteImage(remote: string | null, target: InsertionTarget) {
    if (busy) return;
    busy = true;
    try {
      const result = remote ? { canceled: false, markdown: `![Remote image](<${remote}>)` }
        : await context.desktop.pasteClipboardImage();
      if (disposed || result.canceled || !result.markdown) return;
      if (!stillCurrent(context, target)) {
        window.alert('The document changed while the image was being prepared. Paste again at the intended location.');
        return;
      }
      const start = replaceSelection(target, 'paste-image', result.markdown);
      target.editor.setPosition(target.model.getPositionAt(start + result.markdown.length));
      target.editor.focus();
    } catch (error) {
      if (!disposed) window.alert(`Could not paste the image.\n${error instanceof Error ? error.message : String(error)}`);
    } finally { busy = false; }
  }

  const paste = (event: ClipboardEvent) => {
    if (disposed) return;
    const target = pasteTarget(context, event);
    if (!target) return;
    const plain = event.clipboardData?.getData('text/plain').trim() ?? '';
    const html = event.clipboardData?.getData('text/html');
    const htmlImage = html
      ? new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.getAttribute('src')
      : null;
    const remote = remoteImageUrl(htmlImage) ?? (IMAGE_URL.test(plain) ? remoteImageUrl(plain) : null);
    const types = Array.from(event.clipboardData?.types ?? [], (type) => type.toLowerCase());
    const stored = Array.from(event.clipboardData?.items ?? []).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    ) || types.some((type) => type === 'files' || type.includes('uri-list')
      || type.includes('gnome-copied-files'))
      || (plain.startsWith('file://') && IMAGE_URL.test(plain));
    if (!remote && !stored) return;
    event.preventDefault();
    event.stopPropagation();
    void pasteImage(remote, target);
  };
  context.host.addEventListener('paste', paste, { capture: true });
  return () => { disposed = true; context.host.removeEventListener('paste', paste, { capture: true }); };
}
