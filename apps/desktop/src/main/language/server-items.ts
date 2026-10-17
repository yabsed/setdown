import { completionDefaults } from '../../protocol/language-completion';
import { randomUUID } from 'node:crypto';
import { resolveMethods } from '../../protocol/language-features';

const handleKey = '$setdownItem';
type Origin = { document: string; generation: string; version: number };
type Stored = Origin & { method: string; value: Record<string, unknown>; bytes: number };
const resolvable = new Set<string>([...Object.keys(resolveMethods), ...Object.values(resolveMethods)]);

/** Opaque handles prevent renderer-supplied commands, data or hierarchy items reaching a server. */
export class ServerItems {
  private readonly items = new Map<string, Stored>();
  private bytes = 0;
  constructor(private readonly byteLimit = 32 * 1024 * 1024) {}
  remember(method: string, result: unknown, origin: Origin): unknown {
    if (!resolvable.has(method)) return result;
    const pending = new Map<string, Stored>();
    let bytes = 0;
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== 'object') return value;
      const object = value as Record<string, unknown>;
      // data belongs to the server; text edits/ranges are not resolvable items.
      const copy = Object.fromEntries(Object.entries(object).filter(([key]) => key !== handleKey).map(([key, entry]) => [key, key === 'data' ? entry : visit(entry)]));
      if ('label' in object || 'title' in object || 'name' in object || typeof object.command === 'string'
        || ['textDocument/documentLink', 'documentLink/resolve', 'textDocument/codeLens', 'codeLens/resolve'].includes(method) && 'range' in object) {
        const handle = randomUUID();
        const size = JSON.stringify(object).length * 2 + 256;
        bytes += size;
        if (this.bytes + bytes > this.byteLimit) throw Error('Language results exceed the active item budget. Close results or narrow the query.');
        pending.set(handle, { ...origin, method, value: object, bytes: size });
        copy[handleKey] = handle;
      }
      return copy;
    };
    // Token arrays do not contain resolvable objects.
    if (method.startsWith('textDocument/semanticTokens')) return result;
    if (method === 'textDocument/completion' && result && typeof result === 'object' && 'items' in result) {
      const list = result as import('vscode-languageserver-protocol').CompletionList;
      result = { ...list, items: list.items.map(item => completionDefaults(item, list.itemDefaults)) };
    }
    const resultWithHandles = visit(result);
    // Reserve the whole reply atomically. Never publish a handle that was evicted
    // while creating this response, or evict a still-visible earlier result.
    for (const [id, item] of pending) this.items.set(id, item);
    this.bytes += bytes;
    return resultWithHandles;
  }
  resolve(method: string, params: unknown, origin: Origin): Record<string, unknown> {
    const item = params as Record<string, unknown>;
    const incoming = method.startsWith('callHierarchy/') || method.startsWith('typeHierarchy/') ? item.item : item;
    const id = incoming && typeof incoming === 'object' ? (incoming as Record<string, unknown>)[handleKey] : undefined;
    const stored = typeof id === 'string' ? this.items.get(id) : undefined;
    if (!stored || stored.document !== origin.document || stored.generation !== origin.generation
      || method !== 'workspace/executeCommand' && stored.version !== origin.version)
      throw Error('Invalid or expired language item. Request it again.');
    if (method === 'workspace/executeCommand') {
      if (typeof stored.value.command !== 'string') throw Error('Invalid language command.');
      this.remove(id as string);
      return { command: stored.value.command, arguments: stored.value.arguments };
    }
    const expected = resolveMethods[method as keyof typeof resolveMethods];
    const family = method.startsWith('callHierarchy/') ? 'callHierarchy/' : method.startsWith('typeHierarchy/') ? 'typeHierarchy/' : undefined;
    if (stored.method !== expected && !(family && stored.method.startsWith(family)) && stored.method !== method)
      throw Error('Invalid language item kind.');
    return family ? { item: stored.value } : stored.value;
  }
  private remove(id: string): void { const item = this.items.get(id); if (item) { this.bytes -= item.bytes; this.items.delete(id); } }
  release(ids: string[], origin: { document: string; generation?: string }): void {
    for (const id of ids) {
      const item = this.items.get(id);
      // Completion disposal can precede its post-insertion command.
      if (item?.document === origin.document && (origin.generation === undefined || item.generation === origin.generation) && typeof item.value.command !== 'string') this.remove(id);
    }
  }
  forget(document: string, commands = true): void { for (const [id, item] of this.items) if (item.document === document && (commands || typeof item.value.command !== 'string')) this.remove(id); }
}
