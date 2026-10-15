import { randomUUID } from 'node:crypto';
import { clipboard, ClipboardItem } from 'electron';
import type { ExplorerClipboard, ExplorerOperationResult } from '../../protocol/explorer';

// Store only a nonce on the OS clipboard. Paths are a main-process capability,
// never a renderer-supplied file URI interpreted as permission to delete files.
const FORMAT = 'web application/x-setdown-file-selection';
export class ExplorerClipboardStore {
  private value: (ExplorerClipboard & { token: string }) | null = null;
  async read(): Promise<ExplorerClipboard | null> {
    const value = await this.snapshot();
    return value ? { paths: [...value.paths], cut: value.cut } : null;
  }
  async snapshot(): Promise<(ExplorerClipboard & { token: string }) | null> {
    const value = this.value;
    if (!value) return null;
    if (!await clipboard.has(FORMAT)) { if (this.value === value) this.value = null; return null; }
    for (const item of await clipboard.read()) {
      if (item.types.includes(FORMAT) && await (await item.getType(FORMAT)).text() === value.token) {
        return this.value === value ? { ...value, paths: [...value.paths] } : null;
      }
    }
    // Copying text, an image, or a file in another program invalidates pending Cut.
    if (this.value === value) this.value = null;
    return null;
  }
  async write(paths: string[], cut: boolean): Promise<ExplorerClipboard> {
    const value = { paths: [...paths], cut, token: randomUUID() };
    await clipboard.write([new ClipboardItem({ [FORMAT]: new Blob([value.token]), 'text/plain': paths.join('\n') })]);
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
