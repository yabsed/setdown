import { documentProfile, isEditableOfficeDocument, type DocumentProfile } from './document-profile';
import type { DocumentSnapshot } from './document';

/** A `.docx` whose content main verified as a Word document. The name alone is never enough:
 * a spreadsheet or a legacy binary file under that name must not reach an editor that could save over it. */
export const isWordEditorDocument = (document: Pick<DocumentSnapshot, 'kind' | 'path' | 'officeEditor'> | null | undefined): boolean =>
  !!document && document.kind === 'office' && document.officeEditor === 'word' && isEditableOfficeDocument(document.path);

/** Cache by snapshot identity/path. No content scan or registry lookup on input. */
const profiles = new WeakMap<object, { path: string; profile: DocumentProfile }>();
export function hasMarkdownPreview(document: { path: string } | null | undefined): boolean {
  if (!document) return false;
  let cached = profiles.get(document);
  if (!cached || cached.path !== document.path) {
    cached = { path: document.path, profile: documentProfile(document.path) };
    profiles.set(document, cached);
  }
  return cached.profile.preview === 'markdown';
}
