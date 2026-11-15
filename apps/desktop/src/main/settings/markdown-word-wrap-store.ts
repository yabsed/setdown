import { CheckboxStore } from './checkbox-store';

/** Persists the View > Markdown Word Wrap checkbox; on until the user disables it. */
export class MarkdownWordWrapStore extends CheckboxStore {
  constructor(file: string) { super(file, true); }
}
