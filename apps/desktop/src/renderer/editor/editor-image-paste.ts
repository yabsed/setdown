import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';

type Context = {
  desktop: DesktopPort;
  host: HTMLElement;
  editor: () => Monaco.editor.IStandaloneCodeEditor | null;
  monaco: () => typeof Monaco | null;
  model: () => Monaco.editor.ITextModel | null;
  document: () => DocumentSnapshot | null;
};

const IMAGE_URL = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;

function remoteImageUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function installEditorImagePaste(context: Context) {
  let busy = false;

  function applyMarkdown(markdown: string, selection: Monaco.Selection | null) {
    const editor = context.editor();
    const monaco = context.monaco();
    const model = context.model();
    if (!editor || !monaco || !model) return;
    const range = selection ? monaco.Range.lift(selection) : new monaco.Range(1, 1, 1, 1);
    const end = model.getOffsetAt(range.getStartPosition()) + markdown.length;
    editor.executeEdits('paste-image', [{ range, text: markdown, forceMoveMarkers: true }]);
    editor.setPosition(model.getPositionAt(end));
    editor.focus();
  }

  async function pasteImage(remote: string | null) {
    const editor = context.editor();
    if (!editor || !context.model() || !context.document() || busy) return;
    busy = true;
    const selection = editor.getSelection();
    try {
      if (remote) applyMarkdown(`![Remote image](<${remote}>)`, selection);
      else {
        const result = await context.desktop.pasteClipboardImage();
        if (!result.canceled && result.markdown) applyMarkdown(result.markdown, selection);
      }
    } catch (error) {
      window.alert(`Could not paste the image.\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
    }
  }

  context.host.addEventListener('paste', (event) => {
    if (event.defaultPrevented) return;
    if (!context.editor()) return;
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
    void pasteImage(remote);
  }, { capture: true });
}
