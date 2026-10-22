import { NotebookDocument } from '../notebook/notebook-document';
import { isNotebookDocument } from './document-profile';
import type { DocumentSnapshot } from './document';
import { isMarkdownDocument, isTextCandidate, isReadOnlyDocument } from './document-profile';
import { decodeTextBytes, encodedText } from './text-codec';
import { rewriteAssetReferences } from '../markdown/asset-references';

/** Validate a newly selected text destination before any disk/state mutation. */
export function prepareDocumentSave(document: DocumentSnapshot, text: string, destination: string) {
  if (isNotebookDocument(destination)) {
    const notebook = new NotebookDocument(text);
    if (notebook.error) throw Error(`Cannot save this notebook: ${notebook.error}`);
  }
  if (document.kind) throw new Error('PDF and image documents are read-only.');
  if (isMarkdownDocument(destination)) {
    // Existing Markdown accepts its existing encodings/EOL policy unchanged.
    return { text, encoding: document.encoding, eol: document.eol,
      bytes: encodedText(text, document.encoding) };
  }
  if (!isTextCandidate(destination) || isReadOnlyDocument(destination)) throw new Error('Choose a text file extension, not a binary format.');
  const decoded = decodeTextBytes(new TextEncoder().encode(encodedText(text, document.encoding)));
  return { ...decoded, bytes: encodedText(decoded.text, decoded.encoding) };
}

/** Saving an older revision must not erase edits made while the dialog/IO ran. */
export function retainUnsavedRevision(saved: DocumentSnapshot, text: string, revision: number): DocumentSnapshot {
  const { assetRelocation, ...snapshot } = saved;
  return revision > saved.revision ? { ...snapshot,
    text: assetRelocation ? rewriteAssetReferences(text, assetRelocation) : text, revision } : snapshot;
}
