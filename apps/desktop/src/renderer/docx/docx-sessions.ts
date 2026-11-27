import { isWordEditorDocument } from '../../core/document/document-capabilities';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { DocxSource } from '../../protocol/docx-edit';
import { EditSessions, type EditSession, type EditSessionPorts, type EngineOptions } from '../office-edit/edit-sessions';
import type { DocxEngine } from './docx-engine';

export type DocxSession = EditSession<DocxEngine>;
export type DocxRuntime = { openDocx(bytes: Uint8Array, options: EngineOptions): DocxEngine };
/** The bytes stopped being a Word document package after the tab was opened; the editor never opens or saves them. */
export class NotWordDocumentError extends Error {
  constructor() { super('This file is no longer a Word (.docx) document. Reload it.'); this.name = 'NotWordDocumentError'; }
}
export type DocxSessionPorts = EditSessionPorts<DocxSource, DocxRuntime>;

/** The Word editor's sessions: one engine per open `.docx` that main verified (`office-edit/edit-sessions.ts`). */
export class DocxSessions extends EditSessions<DocxEngine, DocxSource, DocxRuntime> {
  accepts(tab: DocumentTab) { return isWordEditorDocument(tab.document); }
  // A spreadsheet or a legacy binary document under a .docx name would open as an empty page.
  protected verified(source: DocxSource) { if (!source.word) throw new NotWordDocumentError(); return source.bytes; }
  protected start(runtime: DocxRuntime, bytes: Uint8Array, options: EngineOptions) { return runtime.openDocx(bytes, options); }
}
export const docxSessions = new DocxSessions();
