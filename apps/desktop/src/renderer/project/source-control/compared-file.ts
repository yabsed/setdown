// What a comparison says in words about its two versions: sizes, why text is absent, how it was read.
import type { GitDiff, GitSideNote } from '../../../protocol/desktop-api';

type Sided = Pick<GitDiff, 'sides' | 'originalText' | 'modifiedText'>;

export const byteSize = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
/** The name of a version as a person reads it. */
export const versionLabel = (label: string): string => label === 'WORKTREE' ? 'Working Tree' : label === 'INDEX' ? 'Index'
  : label === 'EMPTY' ? 'Nothing' : label;

/** One side in a phrase: its size, or that the file is not in that version. */
export function sideSummary(note: GitSideNote | undefined): string {
  if (!note) return '';
  if (note.missing) return 'not in this version';
  return note.size === undefined ? '' : byteSize(note.size);
}

/** How the size changed between the versions, when both are known. */
export function sizeChange(diff: Pick<GitDiff, 'sides'>): string | undefined {
  const before = diff.sides?.original, after = diff.sides?.modified;
  if (before?.missing && !after?.missing) return 'Added';
  if (after?.missing && !before?.missing) return 'Deleted';
  if (before?.size === undefined || after?.size === undefined) return undefined;
  const change = after.size - before.size;
  return change === 0 ? 'Same size' : `${byteSize(Math.abs(change))} ${change > 0 ? 'larger' : 'smaller'}`;
}

/** Why the two versions are not compared as text, or nothing when they are. */
export function withheld(diff: Sided): { title: string; detail: string } | undefined {
  if (diff.originalText !== null && diff.modifiedText !== null) return undefined;
  const notes = [diff.sides?.original, diff.sides?.modified];
  const unreadable = notes.find(note => note?.reason === 'unreadable');
  if (unreadable) return { title: 'This version could not be read', detail: unreadable.detail ?? 'Git gave no reason.' };
  if (notes.some(note => note?.reason === 'large'))
    return { title: 'Too large to compare as text', detail: 'Text files up to 16 MB are compared line by line.' };
  return { title: 'Binary file', detail: 'Its versions are not compared line by line.' };
}

/** The sentence above a comparison whose text was read past the strict decoder of editable documents. */
export function readingNote(diff: Pick<GitDiff, 'sides'>): string | undefined {
  const notes = [diff.sides?.original, diff.sides?.modified].filter((note): note is GitSideNote => !!note);
  if (notes.some(note => note.submodule)) return 'This is a submodule. Each side shows the commit it is at.';
  const note = notes.find(note => note.reason === 'encoding') ?? notes.find(note => note.reason === 'line-endings')
    ?? notes.find(note => note.reason === 'control');
  if (!note) return undefined;
  if (note.reason === 'encoding') return note.detail === 'UTF-16' ? 'This file is UTF-16 text. It is compared read-only.'
    : 'This file is not valid UTF-8. It is compared read-only; � marks bytes that could not be read as text.';
  return note.reason === 'line-endings' ? 'This file mixes line endings. It is compared read-only.'
    : 'This file contains control characters. It is compared read-only.';
}

/** A cheap identity of a version's bytes: a refreshed comparison with the same bytes keeps its reader. */
export function bytesIdentity(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) hash = Math.imul(hash ^ bytes[index], 0x01000193);
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}
