import type { DocumentSnapshot } from '../core/document/document';
import type { SaveResult } from './desktop-api';
import type { PreviewBounds } from './preview-preparation';

export type HwpState = { id: string; path: string; generation: string; revision: number; savedRevision: number;
  ready: boolean; position?: import('../core/reading/reading-position').HwpReadingPosition; error?: string };
export type HwpArtifact = { revision: number; bytes: Uint8Array;
  contentLoss: { schemaVersion: number; outputFormat: 'hwp' | 'hwpx'; count: number; losses: unknown[] } };
export type HwpApi = {
  backup?(id: string): Promise<HwpArtifact>;
  open(id: string, document: DocumentSnapshot): Promise<HwpState>;
  present(id: string, bounds: PreviewBounds | null): void;
  focus(id: string): void;
  command(id: string, command: 'undo' | 'redo' | 'find' | 'cut' | 'copy' | 'paste' | 'select-all'): void;
  zoom(id: string, steps: number): void;
  save(id: string, saveAs: boolean): Promise<SaveResult>;
  reload(id: string, document: DocumentSnapshot): Promise<HwpState>;
  retarget(id: string, document: DocumentSnapshot): Promise<void>;
  release(id: string): void;
  onState(listener: (state: HwpState) => void): () => void;
  onAction(listener: (action: { id: string; command: 'focus' | 'save' | 'save-as' }) => void): () => void;
};
