// A command line a new terminal types into its shell once the shell has drawn its prompt: a test
// or a binary a language tool knows how to start. The terminal's own surface takes it, once. It
// is kept beside the session and not in it, so a restored or moved terminal never runs it again.

const lines = new Map<string, string>();

export function startWith(id: string, commandLine: string): void { lines.set(id, commandLine); }
export function takeStart(id: string): string | undefined {
  const line = lines.get(id);
  lines.delete(id);
  return line;
}
