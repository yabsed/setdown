import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import { docxSessions } from '../docx/docx-sessions';
import { pptxSessions } from '../pptx/pptx-sessions';

/** The session owners of the Office editors. Each answers only for the tabs main marked for it. */
export const officeEditSessions = [docxSessions, pptxSessions] as const;
/** The owner of a tab's edited document, or nothing for a tab no Office editor takes. */
export const officeEditOwner = (tab: DocumentTab) => officeEditSessions.find(sessions => sessions.accepts(tab));
/** The open session of a tab in whichever editor owns it. */
export const officeEditSession = (id: string) => docxSessions.get(id) ?? pptxSessions.get(id);
/** When the reader last committed an edit in any of them. */
export const lastOfficeEditAt = () => Math.max(...officeEditSessions.map(sessions => sessions.lastEditAt));
