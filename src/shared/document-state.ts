import type { DocumentSnapshot } from './contracts';

export function applyTextRevision(
  document: DocumentSnapshot,
  text: string,
  revision: number,
): DocumentSnapshot {
  if (revision < document.revision) {
    return document;
  }
  return { ...document, text, revision };
}

export function isDirty(document: DocumentSnapshot): boolean {
  return document.revision !== document.savedRevision;
}

export function lineCount(text: string): number {
  return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
}
