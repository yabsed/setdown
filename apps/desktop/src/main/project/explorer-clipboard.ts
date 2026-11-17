import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { clipboard, ClipboardItem } from 'electron';
import type { ExplorerClipboard, ExplorerOperationResult, ExplorerTransfer } from '../../protocol/explorer';
import type { WindowState } from '../windows/window-state';
import { imageCandidates, pastedImageName, type ClipboardImage } from './clipboard-image';
import type { ExplorerService } from './explorer-service';

// Store only a nonce on the OS clipboard. Paths are a main-process capability,
// never a renderer-supplied file URI interpreted as permission to delete files.
const FORMAT = 'web application/x-setdown-file-selection';
export class ExplorerClipboardStore {
  private value: (ExplorerClipboard & { token: string }) | null = null;
  /** What Paste would use now. Image data is reported by its formats only; nothing is decoded here. */
  async read(): Promise<ExplorerClipboard | null> {
    const value = await this.snapshot();
    if (value) return { paths: [...value.paths], cut: value.cut };
    const image = (await clipboard.read()).some(item => imageCandidates(item.types).length > 0);
    return image ? { paths: [], cut: false, image: true } : null;
  }
  /**
   * Copied files win: they keep their names and formats. Otherwise image data
   * (browser “Copy image”, a screenshot, an image viewer) becomes a new file.
   */
  async paste(explorer: Pick<ExplorerService, 'transfer' | 'createFile'>, state: WindowState, target: string,
    conflict?: ExplorerTransfer['conflict']): Promise<ExplorerOperationResult> {
    const selection = await this.snapshot();
    if (selection) {
      const result = await explorer.transfer(state, { kind: selection.external ? 'import' : selection.cut ? 'move' : 'copy', paths: selection.paths, target, conflict });
      await this.consume(selection, result);
      return result;
    }
    const image = await this.image();
    if (!image) throw new Error('Nothing to paste. Copy files or an image first.');
    return explorer.createFile(state, target, image.name, image.bytes);
  }
  async image(): Promise<ClipboardImage | null> {
    for (const item of await clipboard.read()) for (const candidate of imageCandidates(item.types)) {
      try {
        const data = await item.getType(candidate.type);
        if (!('arrayBuffer' in data)) continue;
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (!candidate.format.valid(bytes)) continue;
        return { name: pastedImageName(candidate.format.extension, await this.html(item)), bytes };
      } catch { /* A platform may advertise a format it cannot convert. */ }
    }
    return null;
  }
  private async html(item: ClipboardItem): Promise<string> {
    if (!item.types.includes('text/html')) return '';
    try { const data = await item.getType('text/html'); return 'text' in data ? await data.text() : ''; } catch { return ''; }
  }
  async snapshot(): Promise<(ExplorerClipboard & { token: string }) | null> {
    const value = this.value;
    if (!value) return this.external();
    if (!await clipboard.has(FORMAT)) { if (this.value === value) this.value = null; return this.external(); }
    for (const item of await clipboard.read()) {
      if (item.types.includes(FORMAT) && await (await item.getType(FORMAT)).text() === value.token) {
        return this.value === value ? { ...value, paths: [...value.paths] } : null;
      }
    }
    // Copying text, an image, or a file in another program invalidates pending Cut.
    if (this.value === value) this.value = null;
    return this.external();
  }
  private async external(): Promise<(ExplorerClipboard & { token: string }) | null> {
    const paths: string[] = [];
    for (const item of await clipboard.read()) for (const format of item.types) {
      if (!/uri-list|gnome-copied-files|public\.file-url/i.test(format)) continue;
      try {
        const data = await item.getType(format);
        if (!('text' in data)) continue;
        for (const line of (await data.text()).replace(/\0/g, '').split(/\r?\n/)) {
          try { if (line.startsWith('file:')) paths.push(fileURLToPath(line)); } catch { /* Invalid URL. */ }
        }
      } catch { /* Unavailable platform conversion. */ }
    }
    return paths.length ? { paths: [...new Set(paths)], cut: false, external: true, token: 'external' } : null;
  }
  async write(paths: string[], cut: boolean): Promise<ExplorerClipboard> {
    const value = { paths: [...paths], cut, token: randomUUID() };
    await clipboard.write([new ClipboardItem({ [FORMAT]: new Blob([value.token]), 'text/plain': paths.join('\n'),
      'electron application/osclipboard;format="text/uri-list"': new Blob([paths.map(file => pathToFileURL(file).href).join('\r\n')]) })]);
    this.value = value;
    return { paths: [...paths], cut };
  }
  async clear(token = this.value?.token): Promise<void> {
    const current = await this.snapshot();
    if (current && current.token === token && this.value?.token === token) {
      this.value = null; clipboard.clear();
    }
  }
  async consume(original: ExplorerClipboard & { token: string }, result: ExplorerOperationResult): Promise<void> {
    if (!original.cut) return;
    const current = await this.snapshot();
    if (!current?.cut || current.token !== original.token || this.value?.token !== original.token) return;
    const moved = result.items.filter(item => item.status === 'completed');
    const remaining = current.paths.filter(candidate => !moved.some(item => candidate === item.from
      || candidate.startsWith(`${item.from}/`) || candidate.startsWith(`${item.from}\\`)));
    if (remaining.length) this.value = { ...current, paths: remaining };
    else await this.clear(original.token);
  }
}
