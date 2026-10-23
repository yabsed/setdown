import type { DocumentSnapshot } from '../document/document';
import { isNotebookDocument } from '../document/document-profile';

/** Content identity outlives individual file/diff views. Non-text owners keep
 * their existing lifetimes and are never coerced into this text store. */
export type DocumentContent = { id: string; documentId?: string; document: DocumentSnapshot; text: string; revision: number };
export type StoredDocument = DocumentContent & { documentId: string; references: Set<string> };
export const documentIdentity = (content: DocumentContent): string => content.documentId ?? content.id;
export const sharedTextDocument = (snapshot: DocumentSnapshot): boolean => snapshot.kind === undefined && !isNotebookDocument(snapshot.path);

export class DocumentStore {
  private readonly records = new Map<string, StoredDocument>();
  private readonly pending = new Map<string, Promise<StoredDocument>>();
  private readonly listeners = new Set<(record: StoredDocument) => void>();
  get documents(): StoredDocument[] { return [...this.records.values()]; }
  find(path: string): StoredDocument | undefined { return this.documents.find(record => record.document.path === path); }
  get(id: string): StoredDocument | undefined { return this.records.get(id); }
  contains(content: DocumentContent): boolean { return this.records.has(documentIdentity(content)); }
  onRelease(listener: (record: StoredDocument) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  adopt(snapshot: DocumentSnapshot): StoredDocument {
    if (!sharedTextDocument(snapshot)) throw Error('This document has its own content owner.');
    const existing = this.find(snapshot.path);
    if (existing) return existing; // A disk read cannot overwrite an existing dirty buffer.
    const id = crypto.randomUUID();
    const record = { id, documentId: id, document: snapshot, text: snapshot.text, revision: snapshot.revision, references: new Set<string>() };
    this.records.set(id, record);
    return record;
  }
  async acquire(path: string, reference: string, read: () => Promise<DocumentSnapshot>): Promise<StoredDocument> {
    let record = this.find(path);
    if (!record) {
      let pending = this.pending.get(path);
      if (!pending) {
        pending = read().then(snapshot => this.adopt(snapshot));
        this.pending.set(path, pending);
        void pending.finally(() => { if (this.pending.get(path) === pending) this.pending.delete(path); }).catch(() => {});
      }
      record = await pending;
    }
    record.references.add(reference);
    return record;
  }
  attach(view: DocumentContent): StoredDocument {
    const record = this.adopt(view.document);
    record.references.add(view.id);
    view.documentId = record.id;
    for (const key of ['document', 'text', 'revision'] as const) Object.defineProperty(view, key, {
      enumerable: true, configurable: true, get: () => record[key],
      set: value => { Object.assign(record, { [key]: value }); },
    });
    return record;
  }
  retain(id: string, reference: string): void {
    const record = this.records.get(id);
    if (!record) throw Error('Document is closed.');
    record.references.add(reference);
  }
  release(id: string, reference: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.references.delete(reference);
    if (record.references.size) return;
    this.records.delete(id);
    for (const listener of this.listeners) listener(record);
  }
}
