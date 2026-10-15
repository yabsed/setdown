import { completionDefaults } from '../../protocol/language-completion';
import { randomUUID } from 'node:crypto';
import { resolveMethods } from '../../protocol/language-features';

const handleKey = '$setdownItem';
type Origin = { document: string; generation: string; version: number };
type Stored = Origin & { method: string; value: Record<string, unknown>; time: number };

/** Opaque handles prevent renderer-supplied commands, data or hierarchy items reaching a server. */
export class ServerItems {
  private readonly items = new Map<string, Stored>();
  remember(method: string, result: unknown, origin: Origin): unknown {
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== 'object') return value;
      const object = value as Record<string, unknown>;
      const copy = Object.fromEntries(Object.entries(object).filter(([key]) => key !== handleKey).map(([key, entry]) => [key, visit(entry)]));
      // A handle is useful for items (including nested commands and hierarchy children), not huge numeric token arrays.
      if ('label' in object || 'title' in object || 'range' in object || 'name' in object || 'command' in object) {
        const handle = randomUUID();
        this.items.set(handle, { ...origin, method, value: object, time: Date.now() });
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
    while (this.items.size > 4096) this.items.delete(this.items.keys().next().value!);
    return resultWithHandles;
  }
  resolve(method: string, params: unknown, origin: Origin): Record<string, unknown> {
    const item = params as Record<string, unknown>;
    const incoming = method.startsWith('callHierarchy/') || method.startsWith('typeHierarchy/') ? item.item : item;
    const id = incoming && typeof incoming === 'object' ? (incoming as Record<string, unknown>)[handleKey] : undefined;
    const stored = typeof id === 'string' ? this.items.get(id) : undefined;
    if (!stored || stored.document !== origin.document || stored.generation !== origin.generation
      || method !== 'workspace/executeCommand' && stored.version !== origin.version || Date.now() - stored.time > 300_000)
      throw Error('Invalid or expired language item. Request it again.');
    if (method === 'workspace/executeCommand') {
      if (typeof stored.value.command !== 'string') throw Error('Invalid language command.');
      this.items.delete(id as string);
      return { command: stored.value.command, arguments: stored.value.arguments };
    }
    const expected = resolveMethods[method as keyof typeof resolveMethods];
    const family = method.startsWith('callHierarchy/') ? 'callHierarchy/' : method.startsWith('typeHierarchy/') ? 'typeHierarchy/' : undefined;
    if (stored.method !== expected && !(family && stored.method.startsWith(family)) && stored.method !== method)
      throw Error('Invalid language item kind.');
    return family ? { item: stored.value } : stored.value;
  }
  forget(document: string, commands = true): void { for (const [id, item] of this.items) if (item.document === document && (commands || typeof item.value.command !== 'string')) this.items.delete(id); }
}
