const readers = new Map<string, () => { text: string; directory: string }>();
export function registerTerminalOutput(id: string, read: () => { text: string; directory: string }): () => void {
  readers.set(id, read); return () => { if (readers.get(id) === read) readers.delete(id); };
}
export function terminalOutput(id: string) { return readers.get(id)?.(); }
