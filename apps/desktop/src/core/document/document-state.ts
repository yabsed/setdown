import type { DocumentSnapshot } from './document';

export function applyTextRevision(
  document: DocumentSnapshot,
  text: string,
  revision: number,
): DocumentSnapshot {
  if (document.kind === 'pdf') return document;
  if (revision < document.revision) {
    return document;
  }
  return { ...document, text, revision };
}

export function isDirty(document: DocumentSnapshot): boolean {
  return document.kind !== 'pdf' && document.text !== document.savedText;
}

/** renderer처럼 현재 문자열을 snapshot 밖에 보관하는 경우의 dirty 판정. */
export function hasUnsavedText(document: DocumentSnapshot, currentText: string): boolean {
  return document.kind !== 'pdf' && currentText !== document.savedText;
}

export function lineCount(text: string): number {
  return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
}
