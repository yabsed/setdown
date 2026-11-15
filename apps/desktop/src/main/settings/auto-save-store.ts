import { CheckboxStore } from './checkbox-store';

/** Persists the Edit > Auto Save checkbox; off until the user enables it. */
export class AutoSaveStore extends CheckboxStore {
  constructor(file: string) { super(file, false); }
}
