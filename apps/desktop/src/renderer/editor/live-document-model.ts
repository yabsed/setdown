import type * as Monaco from 'monaco-editor';

export type ModelLease<M> = { model: M; beginEditing(surface: string): void; release(): void };
type DisposableModel = { dispose(): void; pushStackElement(): void };

/** The document owns content/history; views borrow it, never dispose it. */
export class DocumentModelOwner<M extends DisposableModel> {
  private borrowers = 0;
  private retired = false;
  private disposed = false;
  private editingSurface: string | null = null;
  constructor(readonly model: M, private readonly stopListening: () => void) {}

  beginEditing(surface: string): void {
    if (this.retired) return;
    // Do not merge a typing group across two independently focused surfaces.
    if (this.editingSurface !== null && this.editingSurface !== surface) this.model.pushStackElement();
    this.editingSurface = surface;
  }
  borrow(): ModelLease<M> {
    if (this.retired) throw new Error('The document model is closing.');
    this.borrowers += 1;
    let released = false;
    return { model: this.model,
      beginEditing: (surface) => { if (!released) this.beginEditing(surface); },
      release: () => {
        if (released) return;
        released = true;
        this.borrowers -= 1;
        this.collect();
      } };
  }
  releaseOwner(): void {
    if (this.retired) return;
    this.retired = true;
    this.stopListening();
    this.collect();
  }
  private collect(): void {
    if (this.retired && this.borrowers === 0 && !this.disposed) {
      this.disposed = true;
      this.model.dispose();
    }
  }
}

export type LiveDocumentEvent =
  | { type: 'changed'; path: string; text: string }
  | { type: 'closed'; path: string }
  | { type: 'retargeted'; path: string; nextPath: string };
type Provider = (path: string, api: typeof Monaco) => ModelLease<Monaco.editor.ITextModel> | null;

/** Renderer-local port: no IPC, second text buffer, or private Undo API. */
export class LiveDocumentModelPort {
  private provider: Provider | null = null;
  private readonly listeners = new Set<(event: LiveDocumentEvent) => void>();
  register(provider: Provider): () => void {
    this.provider = provider;
    return () => { if (this.provider === provider) this.provider = null; };
  }
  acquire(path: string, api: typeof Monaco): ModelLease<Monaco.editor.ITextModel> | null {
    return this.provider?.(path, api) ?? null;
  }
  subscribe(listener: (event: LiveDocumentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(event: LiveDocumentEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
export const liveDocumentModels = new LiveDocumentModelPort();
