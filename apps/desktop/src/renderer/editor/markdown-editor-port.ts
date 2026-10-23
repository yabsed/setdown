import type * as Monaco from 'monaco-editor';

export type MarkdownEditorSurface = {
  identity: string;
  filePath: string;
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  model: Monaco.editor.ITextModel;
};

/** Synchronous renderer-local access; registering does not create models or touch focus. */
export class MarkdownEditorPort {
  private readonly readers = new Set<() => MarkdownEditorSurface | null>();
  register(reader: () => MarkdownEditorSurface | null): () => void {
    this.readers.add(reader);
    return () => { this.readers.delete(reader); };
  }
  read(): MarkdownEditorSurface | null { for (const read of this.readers) { const surface = read(); if (surface) return surface; } return null; }
}
export const workingTreeMarkdownEditor = new MarkdownEditorPort();

export function isMarkdownPath(filePath: string): boolean {
  return /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(filePath);
}
