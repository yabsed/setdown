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
  private reader: (() => MarkdownEditorSurface | null) | null = null;
  register(reader: () => MarkdownEditorSurface | null): () => void {
    this.reader = reader;
    return () => { if (this.reader === reader) this.reader = null; };
  }
  read(): MarkdownEditorSurface | null { return this.reader?.() ?? null; }
}
export const workingTreeMarkdownEditor = new MarkdownEditorPort();

export function isMarkdownPath(filePath: string): boolean {
  return /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(filePath);
}
