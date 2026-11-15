import { isMarkdownDocument } from '../../core/document/document-profile';

/** View > Markdown Word Wrap. Markdown keeps a paragraph on one long line, so its
 * source wraps unless the user turns this off; code and plain text stay unwrapped.
 * Alt+Z still overrides either state for one model. */
let enabled = true;
const listeners = new Set<() => void>();

export const sourceWordWrap = (filePath: string): 'on' | 'off' => enabled && isMarkdownDocument(filePath) ? 'on' : 'off';

export function setMarkdownWordWrap(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  for (const listener of listeners) listener();
}

/** Mounted source editors reapply their wrapping when the setting changes. */
export function onMarkdownWordWrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
