import { isPresentationEditorDocument } from '../../core/document/document-capabilities';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { PptxSource } from '../../protocol/pptx-edit';
import { EditSessions, type EditSession, type EditSessionPorts, type EngineOptions } from '../office-edit/edit-sessions';
import type { PptxEngine } from './pptx-engine';

export type PptxSession = EditSession<PptxEngine>;
export type PptxRuntime = { openPptx(bytes: Uint8Array, options: EngineOptions): PptxEngine };
/** The bytes stopped being a presentation package after the tab was opened; the editor never opens or saves them. */
export class NotPresentationError extends Error {
  constructor() { super('This file is no longer a PowerPoint (.pptx) presentation. Reload it.'); this.name = 'NotPresentationError'; }
}
export type PptxSessionPorts = EditSessionPorts<PptxSource, PptxRuntime>;

/** The presentation editor's sessions: one engine per open `.pptx` that main verified (`office-edit/edit-sessions.ts`). */
export class PptxSessions extends EditSessions<PptxEngine, PptxSource, PptxRuntime> {
  accepts(tab: DocumentTab) { return isPresentationEditorDocument(tab.document); }
  // A document, a workbook or a legacy binary deck under a .pptx name is not opened for editing.
  protected verified(source: PptxSource) { if (!source.presentation) throw new NotPresentationError(); return source.bytes; }
  protected start(runtime: PptxRuntime, bytes: Uint8Array, options: EngineOptions) { return runtime.openPptx(bytes, options); }
}
export const pptxSessions = new PptxSessions();
