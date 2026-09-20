import type { DocumentSnapshot } from './document';
import { isMarkdownDocument, isTextCandidate } from './document-profile';
import { decodeTextBytes, encodedText } from './text-codec';

/** Validate a newly selected text destination before any disk/state mutation. */
export function prepareDocumentSave(document: DocumentSnapshot, text: string, destination: string) {
  if (isMarkdownDocument(destination)) {
    // Existing Markdown accepts its existing encodings/EOL policy unchanged.
    return { text, encoding: document.encoding, eol: document.eol,
      bytes: encodedText(text, document.encoding) };
  }
  if (!isTextCandidate(destination)) throw new Error('Choose a text file extension, not a binary format.');
  const decoded = decodeTextBytes(new TextEncoder().encode(encodedText(text, document.encoding)));
  return { ...decoded, bytes: encodedText(decoded.text, decoded.encoding) };
}

/** Saving an older revision must not erase edits made while the dialog/IO ran. */
export function retainUnsavedRevision(saved: DocumentSnapshot, text: string, revision: number): DocumentSnapshot {
  return revision > saved.revision ? { ...saved, text, revision } : saved;
}
