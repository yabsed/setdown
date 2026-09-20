import { documentProfile, type DocumentProfile } from './document-profile';

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
