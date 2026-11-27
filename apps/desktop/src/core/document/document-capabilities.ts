import { documentProfile, officeEditorFor, type DocumentProfile, type OfficeEditor } from './document-profile';
import type { DocumentSnapshot } from './document';

type OfficeCandidate = Pick<DocumentSnapshot, 'kind' | 'path' | 'officeEditor'> | null | undefined;
/** The editor of an Office document whose content main verified: a `.docx` that is a Word document, a `.pptx` that is a
 * presentation. The name alone is never enough: a spreadsheet or a legacy binary file under that name must not reach an
 * editor that could save over it. */
export const officeEditorOf = (document: OfficeCandidate): OfficeEditor | undefined =>
  document && document.kind === 'office' && document.officeEditor && officeEditorFor(document.path) === document.officeEditor ? document.officeEditor : undefined;
export const isWordEditorDocument = (document: OfficeCandidate): boolean => officeEditorOf(document) === 'word';
export const isPresentationEditorDocument = (document: OfficeCandidate): boolean => officeEditorOf(document) === 'presentation';

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
